/**
 * 审计日志 —— 记录每一次远程操作的痕迹。
 *
 * 为什么要有：ssh-driver 的主要使用者是 AI Agent。Agent 在你的生产机上
 * 跑什么命令、什么时候跑的、结果是什么，必须可回溯 —— 否则没人敢在
 * 生产环境放开执行权限。
 *
 * 落盘格式：JSONL（每行一条），便于 grep / jq 处理。
 * @Author Martin
 * @Date 2026/10/26
 */

import { promises as fs } from 'fs';
import * as path from 'path';

import { getStoreDir } from '../config/store';

/** 操作来源 */
export type AuditSource = 'cli' | 'api' | 'mcp' | 'console' | 'unknown';

/** 操作类型 */
export type AuditAction =
  | 'exec'
  | 'exec-script'
  | 'connect'
  | 'test'
  | 'upload'
  | 'download'
  | 'config';

export interface AuditEntry {
  /** ISO 时间戳 */
  ts: string;
  source: AuditSource;
  action: AuditAction;
  hostId: string;
  /** 执行的命令（已脱敏） */
  command?: string;
  /** 脚本来源描述：本地文件路径 / MCP 传入的内容摘要 */
  script?: string;
  /** 脚本参数 */
  args?: string[];
  /** 远端退出码 */
  code?: number | null;
  /** 耗时（毫秒） */
  durationMs?: number;
  ok: boolean;
  error?: string;
}

/** 审计日志文件路径（可用 SSH_DRIVER_HISTORY 覆盖） */
export function getHistoryFile(): string {
  const custom = (process.env.SSH_DRIVER_HISTORY ?? '').trim();
  if (custom) return path.resolve(custom);
  return path.join(getStoreDir(), 'history.log');
}

/** 单文件上限，超过就轮转一份 .1 */
const MAX_HISTORY_BYTES = 8 * 1024 * 1024;

/**
 * 命令脱敏 —— 把常见的「密码明文」形态替换成 ***。
 *
 * 审计日志是要长期留存的，绝不能把凭据写进去。
 * 宁可过度脱敏（漏掉一条真实信息），也不能漏出密码。
 */
export function redactSecrets(input: string): string {
  if (!input) return input;
  let out = input;
  const rules: Array<[RegExp, string]> = [
    // --password=xxx / --password xxx
    [/(--password[= ])(["']?)[^\s"']+\2/gi, '$1***'],
    // -pXXX（mysql 风格）；-p 后面跟空格的形式交给 sshpass 规则。
    // 用负向前瞻避免把 --password=xxx 里的 "-p" 也吃掉
    [/((?<![-\w])-p)(?=[^\s-])[^\s]+/g, '$1***'],
    // sshpass -p xxx
    [/(sshpass\s+-p\s+)(["']?)[^\s"']+\2/gi, '$1***'],
    // key=value 形态
    [/((?:pass(?:wd|word)?|passphrase|secret|token|api[_-]?key)[=:\s]+)(["']?)[^\s"']+\2/gi, '$1***'],
    // curl -u user:pass
    [/(-u\s+)(["']?)[^\s:"']+:[^\s"']+\2/gi, '$1***'],
  ];
  for (const [re, rep] of rules) out = out.replace(re, rep);
  return out;
}

/** 写入队列：保证并发写入时不会互相穿插 */
let writeChain: Promise<void> = Promise.resolve();

/**
 * 追加一条审计记录。
 *
 * 审计失败**绝不能**影响主流程（不能因为写日志把 exec 搞挂），
 * 所以这里吞掉异常，只在 debug 模式下提示。
 */
export function appendAudit(entry: AuditEntry): Promise<void> {
  const line = `${JSON.stringify(entry)}\n`;
  writeChain = writeChain
    .then(async () => {
      const file = getHistoryFile();
      await fs.mkdir(path.dirname(file), { recursive: true });
      // 轮转
      try {
        const st = await fs.stat(file);
        if (st.size > MAX_HISTORY_BYTES) {
          await fs.rename(file, `${file}.1`).catch(() => undefined);
        }
      } catch {
        /* 文件不存在，正常 */
      }
      await fs.appendFile(file, line, { encoding: 'utf-8', mode: 0o600 });
    })
    .catch(() => undefined);
  return writeChain;
}

export interface AuditQuery {
  /** 按主机过滤 */
  hostId?: string;
  /** 按操作类型过滤 */
  action?: AuditAction;
  /** 只看失败 */
  failedOnly?: boolean;
  /** 最多返回条数（从最新往回取） */
  limit?: number;
}

/**
 * 读取审计记录，按时间倒序返回（最新在前）。
 */
export async function readAudit(query: AuditQuery = {}): Promise<AuditEntry[]> {
  const file = getHistoryFile();
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf-8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }

  const limit = query.limit && query.limit > 0 ? query.limit : 50;
  const out: AuditEntry[] = [];
  const lines = raw.split('\n');

  // 从后往前扫，命中 limit 条就停 —— 大文件也能快速返回
  for (let i = lines.length - 1; i >= 0 && out.length < limit; i -= 1) {
    const line = lines[i]?.trim();
    if (!line) continue;
    let entry: AuditEntry;
    try {
      entry = JSON.parse(line) as AuditEntry;
    } catch {
      continue; // 跳过写了一半的行
    }
    if (query.hostId && entry.hostId?.toLowerCase() !== query.hostId.toLowerCase()) continue;
    if (query.action && entry.action !== query.action) continue;
    if (query.failedOnly && entry.ok) continue;
    out.push(entry);
  }
  return out;
}
