/**
 * write 命令 —— 把内容写入远程主机上的文件
 *
 *   ssh-driver write prod-web-01 /etc/app.conf --file ./app.conf
 *   ssh-driver write prod-web-01 /etc/app.conf --content "hello"
 *   cat app.conf | ssh-driver write prod-web-01 /etc/app.conf --file -
 *   ssh-driver write prod-web-01 /etc/app.conf --file ./new.conf --overwrite
 *
 * 默认**不覆盖**已存在的远端文件 —— 写错路径不会把生产配置冲掉。
 * @Author Martin
 * @Date 2026/10/27
 */

import { promises as fs } from 'fs';
import * as path from 'path';

import { appendAudit } from '../audit/log';
import { findHost, loadStore } from '../config/store';
import { connectSsh } from '../ssh/client';
import { RemoteFileExistsError, writeRemoteFile } from '../ssh/sftp';
import { logger } from '../utils/logger';
import { localFileNotFound, resolveLocalPath } from '../utils/localpath';
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

export interface WriteOptions {
  /** 本地文件路径；'-' 表示从标准输入读取 */
  file?: string;
  /** 直接指定内容 */
  content?: string;
  /** 允许覆盖已存在的远端文件（默认不覆盖） */
  overwrite?: boolean;
  /** 文件权限，如 0644 */
  mode?: string;
  /** 父目录不存在时自动创建 */
  createDir?: boolean;
  json?: boolean;
}

/** 读取要写入的内容 */
async function loadContent(opts: WriteOptions): Promise<{ content: Buffer; source: string }> {
  if (opts.content !== undefined) {
    return { content: Buffer.from(opts.content, 'utf-8'), source: 'inline' };
  }
  if (opts.file !== undefined) {
    if (opts.file === '-') {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk as Buffer));
      return { content: Buffer.concat(chunks), source: 'stdin' };
    }
    const abs = resolveLocalPath(opts.file);
    try {
      return { content: await fs.readFile(abs), source: abs };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw localFileNotFound(opts.file, abs);
      }
      throw err;
    }
  }
  throw new Error('请用 --file <本地文件>（或 --file - 读标准输入）或 --content <内容> 指定要写入的内容。');
}

/** 解析八进制权限，如 "0644" / "644" */
export function parseMode(raw?: string): number | undefined {
  if (!raw) return undefined;
  const n = Number.parseInt(raw.trim(), 8);
  if (Number.isNaN(n)) throw new Error(`--mode 不是合法的八进制权限：${raw}`);
  return n;
}

export async function writeRun(
  hostId: string,
  remotePath: string,
  opts: WriteOptions = {},
): Promise<void> {
  const host = await resolveHost(hostId);
  const { content, source } = await loadContent(opts);
  const mode = parseMode(opts.mode);
  const started = Date.now();

  const ssh = await connectSsh(host);
  try {
    const result = await writeRemoteFile(ssh, remotePath, content, {
      overwrite: opts.overwrite === true,
      mode,
      createDir: opts.createDir === true,
    });

    await appendAudit({
      ts: new Date().toISOString(),
      source: 'cli',
      action: 'upload',
      hostId: host.hostId,
      script: `${source} → ${remotePath}`,
      durationMs: Date.now() - started,
      ok: true,
    });

    if (opts.json) {
      console.log(
        JSON.stringify({
          hostId: host.hostId,
          path: result.path,
          bytes: result.bytes,
          overwritten: result.overwritten,
          mode: result.mode,
        }),
      );
    } else {
      logger.info(
        `已写入 ${remotePath}（${result.bytes} 字节` +
          `${result.overwritten ? '，覆盖了原文件' : '，新文件'}）`,
      );
    }
  } catch (err) {
    await appendAudit({
      ts: new Date().toISOString(),
      source: 'cli',
      action: 'upload',
      hostId: host.hostId,
      script: `${source} → ${remotePath}`,
      durationMs: Date.now() - started,
      ok: false,
      error: (err as Error).message,
    });
    if (err instanceof RemoteFileExistsError) {
      logger.error(err.message);
    } else {
      logger.error(`写入失败：${(err as Error).message}`);
    }
    process.exitCode = 1;
  } finally {
    ssh.dispose();
  }
}
