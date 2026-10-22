/**
 * console 命令 —— 启动带前端的本地服务
 *
 *   ssh-driver console            # 默认端口 7843，自动打开浏览器
 *   ssh-driver console --port 9000
 *   ssh-driver console --dev      # 同时起 vite dev server（CLI 接管两进程）
 *   ssh-driver console --no-open  # 不自动开浏览器
 * @Author Martin
 * @Date 2026/10/19
 */

import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';

import { startServer } from '../backend/server';
import { logger } from '../utils/logger';

export interface ConsoleOptions {
  port?: number;
  dev?: boolean;
  open?: boolean;
  host?: string;
}

interface StartedServer {
  port: number;
  close: () => Promise<void>;
  viteProc?: ChildProcess;
}

async function spawnViteDev(root: string): Promise<ChildProcess> {
  // vite 可执行文件来自 node_modules/.bin/vite
  const npmBinDir = path.resolve(root, 'node_modules', '.bin');
  const isWin = process.platform === 'win32';
  const viteCmd = isWin ? 'vite.cmd' : 'vite';
  const vitePath = path.join(npmBinDir, viteCmd);

  const proc = spawn(vitePath, [], {
    cwd: root,
    stdio: 'inherit',
    shell: isWin,
    env: { ...process.env, SSH_DRIVER_BACKEND: `http://127.0.0.1:${process.env.SSH_DRIVER_PORT ?? 7843}` },
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
  });

  if (opts.dev) {
    server.viteProc = await spawnViteDev(projectRoot);
  }

  const url = `http://${opts.host ?? '127.0.0.1'}:${server.port}`;
  // eslint-disable-next-line no-console
  console.log(`\nssh-driver console ready at ${url}\n`);

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
