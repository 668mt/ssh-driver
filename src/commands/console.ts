/**
 * console 命令 —— 启动带前端的本地服务
 *
 *   ssh-driver console            # 默认端口 7843，自动打开浏览器
 *   ssh-driver console --port 9000
 *   ssh-driver console --dev      # 同时起 vite dev server（CLI 接管两进程）
 *   ssh-driver console --no-open  # 不自动开浏览器
 *
 * 安全：控制台 API 会读写 SSH 明文凭据，因此启动时会生成一个访问令牌，
 * 打印在终端并写入 ~/.ssh-driver/console-token（0600）。浏览器页面由
 * 服务端注入令牌，前端自动带上；其它工具用 curl 时带 -H 头即可。
 * @Author Martin
 * @Date 2026/10/19
 */

import { spawn, ChildProcess } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';

import { startServer } from '../backend/server';
import { getStoreDir } from '../config/store';
import { logger } from '../utils/logger';

export interface ConsoleOptions {
  port?: number;
  dev?: boolean;
  open?: boolean;
  host?: string;
  /** 指定访问令牌；默认自动生成 */
  token?: string;
}

interface StartedServer {
  port: number;
  token: string;
  close: () => Promise<void>;
  viteProc?: ChildProcess;
}

/** 令牌落盘位置，方便 curl / 其它脚本取用 */
export function getTokenFile(): string {
  return path.join(getStoreDir(), 'console-token');
}

async function spawnViteDev(root: string, token: string): Promise<ChildProcess> {
  // vite 可执行文件来自 node_modules/.bin/vite
  const npmBinDir = path.resolve(root, 'node_modules', '.bin');
  const isWin = process.platform === 'win32';
  const viteCmd = isWin ? 'vite.cmd' : 'vite';
  const vitePath = path.join(npmBinDir, viteCmd);

  const proc = spawn(vitePath, [], {
    cwd: root,
    stdio: 'inherit',
    shell: isWin,
    env: {
      ...process.env,
      SSH_DRIVER_BACKEND: `http://127.0.0.1:${process.env.SSH_DRIVER_PORT ?? 7843}`,
      SSH_DRIVER_TOKEN: token,
    },
  });

  proc.on('exit', (code) => {
    logger.info(`vite dev server exited with code ${code ?? 'null'}`);
  });

  return proc;
}

export async function runConsole(opts: ConsoleOptions = {}): Promise<void> {
  const port = opts.port ?? Number(process.env.SSH_DRIVER_PORT ?? 7843);
  // 把端口也透传给 vite proxy
  process.env.SSH_DRIVER_PORT = String(port);

  const projectRoot = path.resolve(__dirname, '..', '..');

  const server: StartedServer = await startServer({
    port,
    host: opts.host ?? '127.0.0.1',
    dev: opts.dev ?? false,
    token: opts.token,
  });

  // 令牌落盘（0600），方便 curl 之类调用
  const tokenFile = getTokenFile();
  try {
    await fs.mkdir(path.dirname(tokenFile), { recursive: true });
    await fs.writeFile(tokenFile, server.token, { encoding: 'utf-8', mode: 0o600 });
    await fs.chmod(tokenFile, 0o600).catch(() => undefined);
  } catch {
    /* 落盘失败不影响使用 */
  }

  if (opts.dev) {
    server.viteProc = await spawnViteDev(projectRoot, server.token);
  }

  const url = `http://${opts.host ?? '127.0.0.1'}:${server.port}`;
  // eslint-disable-next-line no-console
  console.log(`\nssh-driver console ready at ${url}\n`);
  // eslint-disable-next-line no-console
  console.log(`访问令牌（API 调试用）：${server.token}`);
  // eslint-disable-next-line no-console
  console.log(`  curl -H "X-Ssh-Driver-Token: ${server.token}" ${url}/api/hosts`);
  // eslint-disable-next-line no-console
  console.log(`  令牌文件：${tokenFile}\n`);

  if (opts.open !== false) {
    const cmd = process.platform === 'darwin' ? 'open'
      : process.platform === 'win32' ? 'start'
        : 'xdg-open';
    try {
      spawn(cmd, [url], { stdio: 'ignore', shell: process.platform === 'win32' });
    } catch {
      /* 打开浏览器失败不致命 */
    }
  }

  // 优雅退出
  const shutdown = async (): Promise<void> => {
    if (server.viteProc && !server.viteProc.killed) {
      server.viteProc.kill('SIGTERM');
    }
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}
