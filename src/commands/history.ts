/**
 * history 命令 —— 查看操作审计日志
 *
 *   ssh-driver history
 *   ssh-driver history --host prod-web-01 --limit 10
 *   ssh-driver history --failed --json
 *
 * 审计日志落在 ~/.ssh-driver/history.log（JSONL）。
 * @Author Martin
 * @Date 2026/10/26
 */

import { AuditEntry, getHistoryFile, readAudit } from '../audit/log';
import { logger } from '../utils/logger';

export interface HistoryOptions {
  limit?: number;
  hostId?: string;
  failedOnly?: boolean;
  json?: boolean;
}

function formatDuration(ms?: number): string {
  if (typeof ms !== 'number') return '-';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m${Math.round((ms % 60000) / 1000)}s`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number): string => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  );
}

function summarize(entry: AuditEntry): string {
  if (entry.action === 'exec' || entry.action === 'exec-script') {
    const what = entry.command ?? entry.script ?? '(脚本)';
    return what.length > 60 ? `${what.slice(0, 57)}...` : what;
  }
  return entry.action;
}

/** 失败原因：优先错误信息，没有就退化成退出码 */
function failureReason(entry: AuditEntry): string {
  if (entry.error) return entry.error;
  if (entry.code !== undefined && entry.code !== null) return `退出码 ${entry.code}`;
  return '未知';
}

export async function historyRun(opts: HistoryOptions = {}): Promise<void> {
  const limit = Number.isFinite(opts.limit) ? (opts.limit as number) : 50;
  const { entries, total } = await readAudit({
    limit,
    hostId: opts.hostId,
    failedOnly: opts.failedOnly,
  });

  if (opts.json) {
    console.log(JSON.stringify(entries, null, 2));
    return;
  }

  if (entries.length === 0) {
    logger.info(`暂无审计记录（日志文件：${getHistoryFile()}）`);
    return;
  }

  for (const e of entries) {
    const status = e.ok ? 'OK  ' : 'FAIL';
    const code = e.code === undefined || e.code === null ? '' : ` exit=${e.code}`;
    const host = e.hostId.padEnd(16);
    const dur = formatDuration(e.durationMs).padStart(8);
    const src = (e.source ?? 'unknown').padEnd(6);
    const detail = e.ok ? summarize(e) : failureReason(e);
    console.log(
      `${formatTime(e.ts)}  ${status}  ${host}  ${src}  ${e.action.padEnd(11)}${code.padEnd(10)}${dur}  ${detail}`,
    );
  }
  console.log(
    `\n显示 ${entries.length} 条` +
      (total > entries.length ? `（共 ${total} 条，用 --limit 0 查看全部）` : '') +
      ` · 日志文件：${getHistoryFile()}`,
  );
}
