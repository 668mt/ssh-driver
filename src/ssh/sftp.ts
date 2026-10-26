/**
 * SFTP 文件操作（基于 node-ssh 的 withSFTP）
 *
 * 单独抽出来是为了让 MCP 和控制台共用同一套实现，
 * 并且统一走「一次操作、一个 SFTP 会话」的模型，不留悬挂会话。
 *
 * 注意：ssh2 的 SFTP 接口只有回调版本（@types/ssh2 也没提供 Promise
 * 重载），所以这里手工包一层 Promise。
 * @Author Martin
 * @Date 2026/10/26
 */

import type { NodeSSH } from 'node-ssh';
import type { FileEntryWithStats, SFTPWrapper } from 'ssh2';

export interface RemoteFileInfo {
  name: string;
  size: number;
  mode: number;
  /** 修改时间（ISO），取不到则为 undefined */
  mtime?: string;
  isDir: boolean;
  isLink: boolean;
}

/** 读取单个文件时的默认上限：256 KB */
export const DEFAULT_MAX_READ_BYTES = 256 * 1024;

/** ssh2 的 readdir 只有回调版本，这里包一层 Promise */
function readdir(sftp: SFTPWrapper, dir: string): Promise<FileEntryWithStats[]> {
  return new Promise((resolve, reject) => {
    sftp.readdir(dir, (err, list) => {
      if (err) reject(err);
      else resolve(list ?? []);
    });
  });
}

/** ssh2 的 readFile 只有回调版本 */
function readFile(sftp: SFTPWrapper, file: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    sftp.readFile(file, (err, handle) => {
      if (err) reject(err);
      else resolve(handle);
    });
  });
}

/** ssh2 的 writeFile 只有回调版本 */
function writeFile(sftp: SFTPWrapper, file: string, data: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.writeFile(file, data, err => {
      if (err) reject(err);
      else resolve();
    });
  });
}

/** 列出远端目录 */
export async function listRemoteDir(ssh: NodeSSH, dir: string): Promise<RemoteFileInfo[]> {
  let result: RemoteFileInfo[] = [];
  await ssh.withSFTP(async sftp => {
    const entries = await readdir(sftp, dir);
    result = entries.map(e => {
      const mode = e.attrs?.mode ?? 0;
      const isDir = (mode & 0o040000) === 0o040000;
      const isLink = (mode & 0o120000) === 0o120000;
      return {
        name: e.filename,
        size: e.attrs?.size ?? 0,
        mode,
        mtime: e.attrs?.mtime ? new Date(e.attrs.mtime * 1000).toISOString() : undefined,
        isDir,
        isLink,
      };
    });
  });
  return result;
}

export interface RemoteFileContent {
  content: string;
  bytes: number;
  truncated: boolean;
}

/** 读取远端文件内容（超长会截断） */
export async function readRemoteFile(
  ssh: NodeSSH,
  file: string,
  maxBytes: number = DEFAULT_MAX_READ_BYTES,
): Promise<RemoteFileContent> {
  let result: RemoteFileContent = { content: '', bytes: 0, truncated: false };
  await ssh.withSFTP(async sftp => {
    const buf = await readFile(sftp, file);
    const truncated = buf.length > maxBytes;
    const slice = truncated ? buf.subarray(0, maxBytes) : buf;
    result = {
      content: slice.toString('utf-8'),
      bytes: buf.length,
      truncated,
    };
  });
  return result;
}

/** 写入远端文件 */
export async function writeRemoteFile(ssh: NodeSSH, file: string, content: string): Promise<void> {
  await ssh.withSFTP(async sftp => {
    await writeFile(sftp, file, content);
  });
}
