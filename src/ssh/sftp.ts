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
import type { FileEntryWithStats, SFTPWrapper, Stats } from 'ssh2';

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

/** 判断错误是不是「文件不存在」 */
function isNotFound(err: unknown): boolean {
  const e = err as { code?: number; message?: string };
  // ssh2 的 SFTP 用 status code 2 表示 "no such file"
  if (e?.code === 2) return true;
  const msg = (e?.message ?? '').toLowerCase();
  return msg.includes('no such file') || msg.includes('not found') || msg.includes('enoent');
}

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
function writeFile(sftp: SFTPWrapper, file: string, data: string | Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.writeFile(file, data, err => {
      if (err) reject(err);
      else resolve();
    });
  });
}

/** ssh2 的 stat 只有回调版本 */
function stat(sftp: SFTPWrapper, path: string): Promise<Stats> {
  return new Promise((resolve, reject) => {
    sftp.stat(path, (err, stats) => {
      if (err) reject(err);
      else resolve(stats);
    });
  });
}

/** ssh2 的 chmod 只有回调版本 */
function chmod(sftp: SFTPWrapper, path: string, mode: number): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.chmod(path, mode, err => {
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

export interface RemoteStat {
  /** 文件是否存在 */
  exists: boolean;
  size: number;
  mode: number;
  mtime?: string;
  isDir: boolean;
}

/** 查询远端文件状态（不存在时 exists=false，不抛异常） */
export async function statRemoteFile(ssh: NodeSSH, path: string): Promise<RemoteStat> {
  let result: RemoteStat = { exists: false, size: 0, mode: 0, isDir: false };
  await ssh.withSFTP(async sftp => {
    try {
      const st = await stat(sftp, path);
      const mode = st.mode ?? 0;
      result = {
        exists: true,
        size: st.size ?? 0,
        mode,
        mtime: st.mtime ? new Date(st.mtime * 1000).toISOString() : undefined,
        isDir: (mode & 0o040000) === 0o040000,
      };
    } catch (err) {
      if (!isNotFound(err)) throw err;
      // 文件不存在 —— 正常情况
    }
  });
  return result;
}

export interface RemoteFileContent {
  /** utf-8 解码后的内容（超长会截断） */
  content: string;
  /** 原始字节数（截断前的真实大小） */
  bytes: number;
  /** 是否因为超过上限被截断 */
  truncated: boolean;
  /** 截断后内容的 base64（二进制文件用） */
  base64: string;
  /** 是否看起来是二进制（含 NUL 字节） */
  binary: boolean;
}

/** 粗略判断是不是二进制文件：前 8KB 里有 NUL 字节就算 */
function looksBinary(buf: Buffer): boolean {
  const limit = Math.min(buf.length, 8192);
  for (let i = 0; i < limit; i += 1) {
    if (buf[i] === 0) return true;
  }
  return false;
}

/** 读取远端文件内容（超长会截断） */
export async function readRemoteFile(
  ssh: NodeSSH,
  file: string,
  maxBytes: number = DEFAULT_MAX_READ_BYTES,
): Promise<RemoteFileContent> {
  let result: RemoteFileContent = {
    content: '',
    bytes: 0,
    truncated: false,
    base64: '',
    binary: false,
  };
  await ssh.withSFTP(async sftp => {
    const buf = await readFile(sftp, file);
    const truncated = buf.length > maxBytes;
    const slice = truncated ? buf.subarray(0, maxBytes) : buf;
    result = {
      content: slice.toString('utf-8'),
      bytes: buf.length,
      truncated,
      base64: slice.toString('base64'),
      binary: looksBinary(buf),
    };
  });
  return result;
}

export interface WriteOptions {
  /**
   * 允许覆盖已存在的文件。
   *
   * 默认 **false** —— 文件已存在时报错退出，不覆盖。
   * 这是「写文件」最安全的默认值：Agent 写错路径不会把生产配置冲掉。
   */
  overwrite?: boolean;
  /** 写入后的权限（如 0o644）；不传则沿用服务器默认 */
  mode?: number;
  /** 父目录不存在时自动创建 */
  createDir?: boolean;
}

export interface WriteResult {
  path: string;
  /** 实际写入的字节数 */
  bytes: number;
  /** 是否覆盖了已存在的文件 */
  overwritten: boolean;
  /** 写入后的权限（如果指定了 mode） */
  mode?: number;
}

/** 文件已存在且不允许覆盖时抛这个 */
export class RemoteFileExistsError extends Error {
  readonly code = 'EEXIST';

  constructor(public readonly path: string) {
    super(`远端文件 '${path}' 已存在。加 --overwrite 覆盖，或换一个路径。`);
    this.name = 'RemoteFileExistsError';
  }
}

/**
 * 写入远端文件。
 *
 * 默认**不覆盖**已存在的文件（overwrite=false 时抛 RemoteFileExistsError）。
 */
export async function writeRemoteFile(
  ssh: NodeSSH,
  file: string,
  content: string | Buffer,
  opts: WriteOptions = {},
): Promise<WriteResult> {
  let result: WriteResult = { path: file, bytes: 0, overwritten: false };
  await ssh.withSFTP(async sftp => {
    // 先看文件在不在
    let exists = false;
    try {
      await stat(sftp, file);
      exists = true;
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }

    if (exists && !opts.overwrite) {
      throw new RemoteFileExistsError(file);
    }

    // 父目录不存在就建
    if (opts.createDir) {
      const dir = file.replace(/[/\\]+$/, '').split(/[/\\]/).slice(0, -1).join('/');
      if (dir) {
        try {
          // node-ssh 的 mkdir 是递归的（会补齐缺失的父目录）
          await ssh.mkdir(dir, 'sftp', sftp);
        } catch (err) {
          // 目录已存在等情况忽略
          if (!isNotFound(err)) throw err;
        }
      }
    }

    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf-8');
    await writeFile(sftp, file, data);

    if (opts.mode !== undefined) {
      await chmod(sftp, file, opts.mode);
    }

    result = {
      path: file,
      bytes: data.length,
      overwritten: exists,
      mode: opts.mode,
    };
  });
  return result;
}
