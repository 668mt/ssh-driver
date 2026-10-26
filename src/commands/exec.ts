/**
 * connect / exec 命令 —— AI 主要调用入口
 *
 *   ssh-driver connect <hostId>            # 测活
 *   ssh-driver exec   <hostId> "ls -la"    # 执行命令，把 stdout 打印到终端
 *   ssh-driver exec   <hostId> --script ./deploy.sh   # 执行本地脚本文件
 *
 * 所有远程操作都会写一条审计记录到 ~/.ssh-driver/history.log。
 * @Author Martin
 * @Date 2026/10/19
 */

import { promises as fs } from 'fs';
import * as path from 'path';

import { appendAudit, redactSecrets } from '../audit/log';
import { findHost, loadStore } from '../config/store';
import { execOn, execScript, pingOnce } from '../ssh/client';
import { logger } from '../utils/logger';
import { HostConfig } from '../config/schema';

async function resolveHost(hostId: string): Promise<HostConfig> {
  const store = await loadStore();
  const host = findHost(store, hostId);
  if (!host) {
    throw new Error(
      `主机 '${hostId}' 不存在，请先运行 'ssh-driver config list' 查看已保存的主机。`,
    );
  }
  return host;
}

export async function connectRun(hostId: string): Promise<void> {
  const host = await resolveHost(hostId);
  const started = Date.now();
  const r = await pingOnce(host);
  await appendAudit({
    ts: new Date().toISOString(),
    source: 'cli',
    action: 'connect',
    hostId: host.hostId,
    durationMs: Date.now() - started,
    ok: r.ok,
    error: r.ok ? undefined : r.error,
  });
  if (!r.ok) {
    logger.error(`连接失败：${r.error}`);
    process.exitCode = 1;
    return;
  }
  logger.info(`已连接到 ${hostId}（${host.username}@${host.host}:${host.port ?? 22}）`);
  if (r.banner) console.log(r.banner);
}

export interface ExecOptions {
  /** 以 JSON 输出 {stdout, stderr, code}，便于程序化调用（AI 主要走这个） */
  json?: boolean;
  /** 单次命令执行的超时(ms) */
  timeoutMs?: number;
  /** 本地脚本文件路径；'-' 表示从 stdin 读 */
  script?: string;
  /** 脚本位置参数 $1 $2 ... */
  args?: string[];
  /** 脚本解释器；不给则按 shebang 推断 */
  interpreter?: string;
}

interface LoadedScript {
  content: string;
  origin: string;
}

/** 读取本地脚本内容 */
async function loadScript(scriptPath: string): Promise<LoadedScript> {
  if (scriptPath === '-') {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(Buffer.from(chunk as Buffer));
    }
    return { content: Buffer.concat(chunks).toString('utf-8'), origin: 'stdin' };
  }
  const abs = path.resolve(scriptPath);
  const content = await fs.readFile(abs, 'utf-8');
  return { content, origin: abs };
}

export async function execRun(
  hostId: string,
  command: string,
  opts: ExecOptions = {},
): Promise<void> {
  const host = await resolveHost(hostId);
  const started = Date.now();

  const isScript = typeof opts.script === 'string' && opts.script !== '';
  const action = isScript ? 'exec-script' : 'exec';

  try {
    if (isScript) {
      const loaded = await loadScript(opts.script as string);
      if (!loaded.content.trim()) {
        throw new Error(`脚本 '${loaded.origin}' 是空的`);
      }
      const result = await execScript(host, loaded.content, {
        interpreter: opts.interpreter,
        args: opts.args,
        timeoutMs: opts.timeoutMs,
      });

      await appendAudit({
        ts: new Date().toISOString(),
        source: 'cli',
        action,
        hostId: host.hostId,
        script: loaded.origin === 'stdin' ? 'stdin' : loaded.origin,
        args: opts.args,
        code: result.code,
        durationMs: Date.now() - started,
        ok: result.code === 0 || result.code === null,
      });

      if (opts.json) {
        console.log(
          JSON.stringify({
            stdout: result.stdout,
            stderr: result.stderr,
            code: result.code,
            interpreter: result.interpreter,
          }),
        );
      } else {
        if (result.stdout) process.stdout.write(result.stdout);
        if (result.stderr) process.stderr.write(result.stderr);
      }
      if (typeof result.code === 'number' && result.code !== 0) {
        process.exitCode = result.code;
      }
      return;
    }

    const result = await execOn(host, command, { timeoutMs: opts.timeoutMs });

    await appendAudit({
      ts: new Date().toISOString(),
      source: 'cli',
      action,
      hostId: host.hostId,
      command: redactSecrets(command),
      code: result.code,
      durationMs: Date.now() - started,
      ok: result.code === 0 || result.code === null,
    });

    if (opts.json) {
      console.log(JSON.stringify(result));
    } else {
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
    }
    if (typeof result.code === 'number' && result.code !== 0) {
      process.exitCode = result.code;
    }
  } catch (err) {
    const message = (err as Error).message;
    await appendAudit({
      ts: new Date().toISOString(),
      source: 'cli',
      action,
      hostId: host.hostId,
      command: isScript ? undefined : redactSecrets(command),
      script: isScript ? (opts.script as string) : undefined,
      durationMs: Date.now() - started,
      ok: false,
      error: message,
    });
    if (opts.json) {
      console.log(JSON.stringify({ error: message }));
    } else {
      logger.error(`执行失败：${message}`);
    }
    process.exitCode = 1;
  }
}
