#!/usr/bin/env node
/**
 * ssh-driver CLI 入口
 * @Author Martin
 * @Date 2026/10/19
 */

import { Command } from 'commander';

import { runInstall } from './commands/install';
import { registerConfigCommand } from './commands/config';
import { connectRun, execRun } from './commands/exec';
import { runConsole } from './commands/console';
import { logger } from './utils/logger';

async function main(): Promise<void> {
  const program = new Command();

  program
    .name('ssh-driver')
    .description(
      'SSH connection & command execution driver with AI agent skill support',
    )
    .version('0.2.0');

  program
    .command('install')
    .description('安装 ssh-driver 的 SKILL.md 到 ~/.agents/skills（默认覆盖旧版本）')
    .option('-t, --target <dir>', '指定安装目标根目录，默认 ~/.agents/skills')
    .option('--no-force', '已存在时不覆盖（默认直接覆盖）')
    .option('--with-web', '同时把 dist-server/web/ 复制到 skill 目录', false)
    .action(async (opts: { target?: string; force?: boolean; withWeb?: boolean }) => {
      try {
        await runInstall(opts);
      } catch (err) {
        logger.error(`安装失败：${(err as Error).message}`);
        process.exitCode = 1;
      }
    });

  registerConfigCommand(program);

  program
    .command('connect <hostId>')
    .description('Test SSH connectivity to a saved host')
    .action(async (hostId: string) => {
      try {
        await connectRun(hostId);
      } catch (err) {
        logger.error(`连接失败：${(err as Error).message}`);
        process.exitCode = 1;
      }
    });

  program
    .command('exec <hostId> <command...>')
    .description('Execute a single command on a saved host (auto disconnect after)')
    .option('--json', 'emit a JSON object {stdout, stderr, code}', false)
    .option('--timeout <ms>', 'command-level timeout in milliseconds', parseInt)
    .action(
      async (
        hostId: string,
        commandParts: string[],
        opts: { json?: boolean; timeout?: number },
      ) => {
        const command = commandParts.join(' ');
        try {
          await execRun(hostId, command, {
            json: opts.json === true,
            timeoutMs: opts.timeout,
          });
        } catch (err) {
          logger.error(`执行失败：${(err as Error).message}`);
          process.exitCode = 1;
        }
      },
    );

  program
    .command('console')
    .description('Open the local web console for managing connections')
    .option('-p, --port <n>', 'override HTTP port (default 7843)', parseInt)
    .option('--host <addr>', 'bind address (default 127.0.0.1)')
    .option('--dev', 'also start vite dev server for HMR (requires `npm run build:web` built once)', false)
    .option('--no-open', 'do not auto-open the browser')
    .action(async (opts: { port?: number; host?: string; dev?: boolean; open?: boolean }) => {
      try {
        await runConsole({
          port: opts.port,
          host: opts.host,
          dev: opts.dev,
          open: opts.open,
        });
      } catch (err) {
        logger.error(`控制台启动失败：${(err as Error).message}`);
        process.exitCode = 1;
      }
    });

  await program.parseAsync(process.argv);
}

main().catch((err) => {
  logger.error(`严重错误：${(err as Error).message}`);
  process.exit(1);
});
