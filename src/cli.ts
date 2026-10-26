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
import { runMcp } from './commands/mcp';
import { historyRun } from './commands/history';
import { readRun } from './commands/read';
import { writeRun } from './commands/write';
import { logger } from './utils/logger';
import { parseIntArg } from './utils/parse';

/**
 * 从 package.json 读版本号 —— 单一事实来源。
 * 之前这里是写死的 '0.2.0'，发布新版本后 `ssh-driver --version` 还在报旧版本。
 *
 * 路径说明：编译产物是 dist/cli.js，源码是 src/cli.ts，
 * 两者到包根的相对路径都是 '../package.json'。
 */
function readVersion(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pkg = require('../package.json') as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** 收集可重复的 --arg 选项 */
function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

async function main(): Promise<void> {
  const program = new Command();

  program
    .name('ssh-driver')
    .description('SSH 连接管理与远程命令执行 —— 带 AI Agent Skill 与 MCP 支持')
    .version(readVersion());

  program
    .command('install')
    .description('把 ssh-driver 的 SKILL.md 安装到 ~/.agents/skills（默认覆盖旧版本）')
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
    .description('测试到已保存主机的 SSH 连通性')
    .action(async (hostId: string) => {
      try {
        await connectRun(hostId);
      } catch (err) {
        logger.error(`连接失败：${(err as Error).message}`);
        process.exitCode = 1;
      }
    });

  program
    .command('exec <hostId> [command...]')
    .description('在已保存的主机上执行命令，或用 --script 执行本地脚本文件')
    .option('--json', '以 JSON 输出 {stdout, stderr, code}', false)
    .option('--timeout <ms>', '命令级超时（毫秒）', parseIntArg)
    .option('--script <path>', '执行本地脚本文件（"-" 表示从标准输入读取）')
    .option('--arg <value>', '传给脚本的位置参数 $1 $2 ...（可重复）', collect, [])
    .option('--interpreter <cmd>', '脚本解释器（默认按 shebang 推断，没有则用 bash）')
    .action(
      async (
        hostId: string,
        commandParts: string[],
        opts: {
          json?: boolean;
          timeout?: number;
          script?: string;
          arg?: string[];
          interpreter?: string;
        },
      ) => {
        const hasScript = typeof opts.script === 'string' && opts.script !== '';
        const command = (commandParts ?? []).join(' ');
        if (!hasScript && !command) {
          logger.error('请提供要执行的命令，或用 --script 指定脚本文件。');
          process.exitCode = 1;
          return;
        }
        try {
          await execRun(hostId, command, {
            json: opts.json === true,
            timeoutMs: opts.timeout,
            script: opts.script,
            args: opts.arg,
            interpreter: opts.interpreter,
          });
        } catch (err) {
          logger.error(`执行失败：${(err as Error).message}`);
          process.exitCode = 1;
        }
      },
    );

  program
    .command('read <hostId> <remotePath>')
    .description('读取远程主机上的文件')
    .option('-o, --output <localPath>', '保存到本地文件（默认输出到标准输出）')
    .option('--max-bytes <n>', `最大读取字节数（默认 ${262144}）`, parseIntArg)
    .option('--base64', '以 base64 输出（二进制文件）', false)
    .option('--json', '以 JSON 输出', false)
    .action(
      async (
        hostId: string,
        remotePath: string,
        opts: { output?: string; maxBytes?: number; base64?: boolean; json?: boolean },
      ) => {
        try {
          await readRun(hostId, remotePath, opts);
        } catch (err) {
          logger.error(`读取失败：${(err as Error).message}`);
          process.exitCode = 1;
        }
      },
    );

  program
    .command('write <hostId> <remotePath>')
    .description('把内容写入远程主机上的文件（默认不覆盖已存在的文件）')
    .option('-f, --file <localPath>', '从本地文件读取内容（"-" 表示从标准输入读取）')
    .option('-c, --content <text>', '直接指定要写入的内容')
    .option('--overwrite', '允许覆盖已存在的远端文件', false)
    .option('--mode <octal>', '设置文件权限，如 0644')
    .option('--create-dir', '父目录不存在时自动创建', false)
    .option('--json', '以 JSON 输出', false)
    .action(
      async (
        hostId: string,
        remotePath: string,
        opts: {
          file?: string;
          content?: string;
          overwrite?: boolean;
          mode?: string;
          createDir?: boolean;
          json?: boolean;
        },
      ) => {
        try {
          await writeRun(hostId, remotePath, opts);
        } catch (err) {
          logger.error(`写入失败：${(err as Error).message}`);
          process.exitCode = 1;
        }
      },
    );

  program
    .command('history')
    .description('查看操作审计日志（谁在什么时候跑了什么命令）')
    .option('-n, --limit <count>', '最多显示多少条（0 = 全部）', parseIntArg, 50)
    .option('--host <hostId>', '只看某台主机')
    .option('--failed', '只看失败的记录', false)
    .option('--json', '以 JSON 输出', false)
    .action(
      async (opts: { limit?: number; host?: string; failed?: boolean; json?: boolean }) => {
        try {
          await historyRun({
            limit: opts.limit,
            hostId: opts.host,
            failedOnly: opts.failed === true,
            json: opts.json === true,
          });
        } catch (err) {
          logger.error(`读取审计日志失败：${(err as Error).message}`);
          process.exitCode = 1;
        }
      },
    );

  program
    .command('console')
    .description('打开本地网页控制台管理连接')
    .option('-p, --port <n>', '覆盖 HTTP 端口（默认 7843）', parseIntArg)
    .option('--host <addr>', '绑定地址（默认 127.0.0.1）')
    .option('--dev', '同时启动 vite dev server 便于调试前端', false)
    .option('--no-open', '不自动打开浏览器')
    .option('--token <token>', '指定 API 访问令牌（默认自动生成）')
    .action(
      async (opts: { port?: number; host?: string; dev?: boolean; open?: boolean; token?: string }) => {
        try {
          await runConsole({
            port: opts.port,
            host: opts.host,
            dev: opts.dev,
            open: opts.open,
            token: opts.token,
          });
        } catch (err) {
          logger.error(`控制台启动失败：${(err as Error).message}`);
          process.exitCode = 1;
        }
      },
    );

  program
    .command('mcp')
    .description('以 MCP (stdio) 模式启动，供 AI Agent 直接调用工具')
    .action(async () => {
      try {
        await runMcp();
      } catch (err) {
        logger.error(`MCP 启动失败：${(err as Error).message}`);
        process.exitCode = 1;
      }
    });

  await program.parseAsync(process.argv);
}

main().catch((err) => {
  logger.error(`严重错误：${(err as Error).message}`);
  process.exit(1);
});
