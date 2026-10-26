/**
 * Express 服务入口 —— 既能独立 `node dist/backend/server.js` 跑，也被 CLI 拉起
 *
 * 安全要点（2026-10-26 加固）：
 *   1. **访问令牌**：所有 /api 请求必须带 `X-Ssh-Driver-Token` 头或同源 cookie。
 *      之前是裸奔的 —— 任意网页都能 fetch('http://127.0.0.1:7843/api/hosts')
 *      把你的 SSH 明文密码全部读走。
 *   2. **跨域白名单**：只放行 loopback 来源和同源来源，不再 `origin: true` 全开。
 *   3. **Host 头校验**：只绑 loopback 时校验 Host，防 DNS rebinding 绕过。
 * @Author Martin
 * @Date 2026/10/19
 */

import * as crypto from 'crypto';
import { promises as fs } from 'fs';
import express, { Request, Response, NextFunction } from 'express';
import * as path from 'path';

import { getStoreFile, loadStore } from '../config/store';
import { globalPool } from '../ssh/pool';
import { execRouter } from './routes/exec';
import { historyRouter } from './routes/history';
import { hostsRouter } from './routes/hosts';
import { ioRouter } from './routes/io';

export interface ServerOptions {
  port?: number;
  /** dev 模式下不挂前端静态资源（CORS 即可），让 vite 自己 serve。 */
  dev?: boolean;
  host?: string;
  /** 访问令牌；不传则自动生成 */
  token?: string;
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const TOKEN_HEADER = 'x-ssh-driver-token';
const TOKEN_COOKIE = 'ssh_driver_token';

/** 常量时间比较，避免令牌被逐字节爆破 */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf-8');
  const bb = Buffer.from(b, 'utf-8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/** origin 是否是 loopback（开发时 vite 端口可能变，所以只看主机名） */
function isLoopbackOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    const h = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    return LOOPBACK_HOSTS.has(h);
  } catch {
    return false;
  }
}

/**
 * 自定义 CORS 中间件。
 *
 * 没有直接用 cors 包，因为它的 origin 回调拿不到 request，
 * 没法判断「是否与请求同源」—— 而同源判断对「绑定 0.0.0.0 后从别的
 * 机器访问控制台」这种场景是必需的。
 */
function corsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin;
  if (origin) {
    const sameOrigin = (() => {
      try {
        return new URL(origin).host.toLowerCase() === (req.headers.host ?? '').toLowerCase();
      } catch {
        return false;
      }
    })();

    if (!isLoopbackOrigin(origin) && !sameOrigin) {
      res.status(403).json({ error: `不允许的跨域来源：${origin}` });
      return;
    }

    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', `Content-Type, ${TOKEN_HEADER}`);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  }
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
}

/** 从请求里取令牌：优先 header，其次 cookie */
function extractToken(req: Request): string | undefined {
  const header = req.headers[TOKEN_HEADER];
  if (typeof header === 'string' && header.trim()) return header.trim();

  const cookie = req.headers.cookie;
  if (!cookie) return undefined;
  for (const part of cookie.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== TOKEN_COOKIE) continue;
    return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

/** 注入令牌到前端 HTML —— 让浏览器 JS 能拿到它并放进请求头 */
function injectToken(html: string, token: string): string {
  const meta = `<meta name="ssh-driver-token" content="${token}">`;
  if (html.includes('</head>')) return html.replace('</head>', `${meta}</head>`);
  return meta + html;
}

export async function startServer(
  opts: ServerOptions = {},
): Promise<{ close: () => Promise<void>; port: number; token: string }> {
  const app = express();
  const port = opts.port ?? Number(process.env.SSH_DRIVER_PORT ?? 7843);
  const host = opts.host ?? '127.0.0.1';
  const token = opts.token?.trim() || crypto.randomBytes(24).toString('hex');

  const boundToLoopback = LOOPBACK_HOSTS.has(host.toLowerCase());

  app.use(corsMiddleware);
  app.use(express.json({ limit: '4mb' }));

  // Host 头校验（防 DNS rebinding）：只绑 loopback 时才需要
  if (boundToLoopback) {
    app.use((req: Request, res: Response, next: NextFunction) => {
      const raw = req.headers.host ?? '';
      const hostname = raw.replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase();
      if (!LOOPBACK_HOSTS.has(hostname)) {
        res.status(403).json({ error: `非法的 Host 头：${raw}` });
        return;
      }
      next();
    });
  }

  // 访问令牌校验 —— 覆盖所有 /api
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    const provided = extractToken(req);
    if (!provided || !safeEqual(provided, token)) {
      res.status(401).json({
        error:
          '缺少或无效的访问令牌。' +
          '请使用 `ssh-driver console` 启动时输出的令牌，' +
          `通过 ${TOKEN_HEADER} 请求头（或同源 cookie）传入。`,
      });
      return;
    }
    next();
  });

  // 健康检查
  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      configPath: getStoreFile(),
      sessions: globalPool.stats(),
    });
  });

  // 业务路由
  app.use('/api/hosts', execRouter);
  app.use('/api/hosts', hostsRouter);
  app.use('/api/io', ioRouter);
  app.use('/api/history', historyRouter);

  // 生产模式下 serve 前端
  if (!opts.dev) {
    const webDist = path.resolve(__dirname, '..', '..', 'dist-server', 'web');
    let cachedHtml: string | null = null;
    app.use(
      express.static(webDist, {
        index: false,
        setHeaders(res) {
          // 让浏览器把令牌 cookie 带上（同源请求）
          res.setHeader(
            'Set-Cookie',
            `${TOKEN_COOKIE}=${encodeURIComponent(token)}; Path=/; SameSite=Strict; HttpOnly`,
          );
        },
      }),
    );
    // SPA fallback —— 这里要把令牌注入到 HTML 里
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      const send = (html: string): void => {
        res.setHeader(
          'Set-Cookie',
          `${TOKEN_COOKIE}=${encodeURIComponent(token)}; Path=/; SameSite=Strict; HttpOnly`,
        );
        res.type('html').send(injectToken(html, token));
      };
      if (cachedHtml) return send(cachedHtml);
      const indexFile = path.join(webDist, 'index.html');
      fs.readFile(indexFile, 'utf-8')
        .then(html => {
          cachedHtml = html;
          send(html);
        })
        .catch(() => {
          res.status(404).send('前端构建产物不存在，请先执行 `npm run build:web`');
        });
    });
  }

  // 通用错误处理
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    // eslint-disable-next-line no-console
    console.error('[server] error:', err);
    res.status(500).json({ error: err.message });
  });

  let boundPort = port;
  await new Promise<void>((resolve, reject) => {
    const server = app.listen(port, host, () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') boundPort = addr.port;
      resolve();
    });
    server.on('error', (err) => {
      // eslint-disable-next-line no-console
      console.error('[server] listen error:', err);
      reject(err);
    });
    // 把 server 句柄绑到 app 上，供外部关闭
    (app as unknown as { _server: unknown })._server = server;
  });

  // 启动后测试一下 store 能读
  try {
    await loadStore();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[server] config store unreadable:', (err as Error).message);
  }

  if (!boundToLoopback) {
    // eslint-disable-next-line no-console
    console.warn(
      `[server] 警告：服务绑定在 ${host}，控制台与 API 已经暴露到网络上。` +
      '请务必自行加访问控制（防火墙 / 反向代理 / 仅内网）。',
    );
  }

  // eslint-disable-next-line no-console
  console.log(`[server] ssh-driver console listening at http://${host}:${port}`);

  return {
    port: boundPort,
    token,
    close: async (): Promise<void> => {
      await globalPool.closeAll();
      await new Promise<void>((resolve, reject) => {
        const s = (app as unknown as { _server?: { close: (cb: (err?: Error) => void) => void } })._server;
        if (!s) return resolve();
        s.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}

if (require.main === module) {
  startServer().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[server] fatal:', err);
    process.exit(1);
  });
}
