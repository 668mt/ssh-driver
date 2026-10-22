/**
 * connect / exec 命令 —— AI 主要调用入口
 *
 *   ssh-driver connect <hostId>            # 测活
 *   ssh-driver exec   <hostId> "ls -la"    # 执行命令，把 stdout 打印到终端
 * @Author Martin
 * @Date 2026/10/19
 */

import { findHost, loadStore } from '../config/store';
import { execOnce, pingOnce } from '../ssh/client';
import { logger } from '../utils/logger';
import { HostConfig } from '../config/schema';

async function resolveHost(hostId: string): Promise<HostConfig> {
  const store = await loadStore();
  const host = findHost(store, hostId);
  if (!host) {
    throw new Error(
      `hostId '${hostId}' not found. Run 'ssh-driver config list' to see saved hosts.`,
    );
  }
  return host;
}

export async function connectRun(hostId: string): Promise<void> {
  const host = await resolveHost(hostId);
  const r = await pingOnce(host);
  if (!r.ok) {
    logger.error(`connect failed: ${r.error}`);
    process.exitCode = 1;
    return;
  }
  logger.info(`connected to ${hostId} (${host.username}@${host.host}:${host.port ?? 22})`);
  if (r.banner) console.log(r.banner);
}

export interface ExecOptions {
  /** 以 JSON 输出 {stdout, stderr, code}，便于程序化调用（AI 主要走这个） */
  json?: boolean;
  /** 单次命令执行的 server 端 timeout(ms) */
  timeoutMs?: number;
}

export async function execRun(hostId: string, command: string, opts: ExecOptions = {}): Promise<void> {
  const host = await resolveHost(hostId);

  // node-ssh 的 execCommand 没有超时参数，这里用 Promise.race 兜底
  const work = execOnce(host, command);
  let timer: NodeJS.Timeout | undefined;
  const timeoutP = opts.timeoutMs
    ? new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`exec timeout after ${opts.timeoutMs}ms`)),
          opts.timeoutMs,
        );
      })
    : null;

  try {
    const result = timeoutP
      ? await Promise.race([work, timeoutP])
      : await work;
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
    if (opts.json) {
      console.log(JSON.stringify({ error: (err as Error).message }));
    } else {
      logger.error(`exec failed: ${(err as Error).message}`);
    }
    process.exitCode = 1;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
