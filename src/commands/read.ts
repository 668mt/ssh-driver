/**
 * read 命令 —— 读取远程主机上的文件
 *
 *   ssh-driver read prod-web-01 /etc/hostname
 *   ssh-driver read prod-web-01 /etc/hostname --json
 *   ssh-driver read prod-web-01 /tmp/app.log --output ./app.log
 *   ssh-driver read prod-web-01 /tmp/photo.png --base64
 *
 * @Author Martin
 * @Date 2026/10/27
 */

import { promises as fs } from 'fs';
import * as path from 'path';

import { appendAudit } from '../audit/log';
import { findHost, loadStore } from '../config/store';
import { connectSsh } from '../ssh/client';
import { DEFAULT_MAX_READ_BYTES, readRemoteFile } from '../ssh/sftp';
import { logger } from '../utils/logger';
import { resolveLocalPath } from '../utils/localpath';
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

export interface ReadOptions {
  /** 保存到本地文件（默认打印到标准输出） */
  output?: string;
  /** 最大读取字节数 */
  maxBytes?: number;
  /** 以 base64 输出（二进制文件） */
  base64?: boolean;
  json?: boolean;
}

export async function readRun(
  hostId: string,
  remotePath: string,
  opts: ReadOptions = {},
): Promise<void> {
  const host = await resolveHost(hostId);
  const maxBytes =
    Number.isFinite(opts.maxBytes) && (opts.maxBytes as number) > 0
      ? (opts.maxBytes as number)
      : DEFAULT_MAX_READ_BYTES;
  const started = Date.now();

  const ssh = await connectSsh(host);
  try {
    const file = await readRemoteFile(ssh, remotePath, maxBytes);

    if (opts.output) {
      const abs = resolveLocalPath(opts.output);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      // base64 模式下也存原始字节，别把 base64 文本写进文件
      await fs.writeFile(abs, Buffer.from(file.base64, 'base64'));
    }

    await appendAudit({
      ts: new Date().toISOString(),
      source: 'cli',
      action: 'download',
      hostId: host.hostId,
      script: remotePath,
      durationMs: Date.now() - started,
      ok: true,
    });

    if (opts.json) {
      console.log(
        JSON.stringify({
          hostId: host.hostId,
          path: remotePath,
          bytes: file.bytes,
          truncated: file.truncated,
          binary: file.binary,
          content: file.content,
          base64: file.base64,
          savedTo: opts.output ? resolveLocalPath(opts.output) : undefined,
        }),
      );
      return;
    }

    if (opts.output) {
      logger.info(
        `已读取 ${remotePath}（${file.bytes} 字节）并保存到 ${resolveLocalPath(opts.output)}`,
      );
      return;
    }

    if (opts.base64) {
      process.stdout.write(file.base64);
      return;
    }

    if (file.binary) {
      logger.warn('文件看起来是二进制内容，建议加 --base64 或 --output 保存原始字节。');
    }
    process.stdout.write(file.content);
  } catch (err) {
    await appendAudit({
      ts: new Date().toISOString(),
      source: 'cli',
      action: 'download',
      hostId: host.hostId,
      script: remotePath,
      durationMs: Date.now() - started,
      ok: false,
      error: (err as Error).message,
    });
    logger.error(`读取失败：${(err as Error).message}`);
    process.exitCode = 1;
  } finally {
    ssh.dispose();
  }
}
