/**
 * Express 服务入口 —— 既能独立 `node dist/backend/server.js` 跑，也被 CLI 拉起
 * @Author Martin
 * @Date 2026/10/19
 */

import cors from 'cors';
import express, { Request, Response, NextFunction } from 'express';
import * as path from 'path';

import { loadStore, STORE_FILE } from '../config/store';
import { hostsRouter } from './routes/hosts';
import { ioRouter } from './routes/io';

export interface ServerOptions {
  port?: number;
  /** dev 模式下不挂前端静态资源（CORS 即可），让 vite 自己 serve。 */
  dev?: boolean;
  host?: string;
}

export async function startServer(opts: ServerOptions = {}): Promise<{ close: () => Promise<void>; port: number }> {
  const app = express();
  const port = opts.port ?? Number(process.env.SSH_DRIVER_PORT ?? 7843);
  const host = opts.host ?? '127.0.0.1';

  app.use(cors({ origin: true }));
  app.use(express.json({ limit: '4mb' }));

  // 健康检查
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, configPath: STORE_FILE });
  });

  // 业务路由
  app.use('/api/hosts', hostsRouter);
  app.use('/api/io', ioRouter);

  // 生产模式下 serve 前端
  if (!opts.dev) {
    const webDist = path.resolve(__dirname, '..', '..', 'dist-server', 'web');
    app.use(express.static(webDist));
    // SPA fallback
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.sendFile(path.join(webDist, 'index.html'), (err) => {
        if (err) res.status(404).end();
      });
    });
  }

  // 通用错误处理
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    // eslint-disable-next-line no-console
    console.error('[server] error:', err);
    res.status(500).json({ error: err.message });
  });

  await new Promise<void>((resolve, reject) => {
    const server = app.listen(port, host, () => resolve());
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

  // eslint-disable-next-line no-console
  console.log(`[server] ssh-driver console listening at http://${host}:${port}`);

  return {
    port,
    close: () => new Promise<void>((resolve, reject) => {
      const s = (app as unknown as { _server?: { close: (cb: (err?: Error) => void) => void } })._server;
      if (!s) return resolve();
      s.close((err) => (err ? reject(err) : resolve()));
    }),
  };
}

if (require.main === module) {
  startServer().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[server] fatal:', err);
    process.exit(1);
  });
}
