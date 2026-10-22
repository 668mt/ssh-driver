/**
 * 极简日志工具，区分用户输出与调试输出。
 * 时间使用本地时区（国内即北京时间），不使用 ISO 的 UTC。
 * @Author Martin
 * @Date 2026/10/19
 */

const DEBUG = process.env.SSH_DRIVER_DEBUG === '1';

function timestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  );
}

export const logger = {
  info(msg: string, ...rest: unknown[]): void {
    console.log(`[${timestamp()}] ${msg}`, ...rest);
  },
  warn(msg: string, ...rest: unknown[]): void {
    console.warn(`[${timestamp()}] WARN ${msg}`, ...rest);
  },
  error(msg: string, ...rest: unknown[]): void {
    console.error(`[${timestamp()}] ERROR ${msg}`, ...rest);
  },
  debug(msg: string, ...rest: unknown[]): void {
    if (!DEBUG) return;
    console.log(`[${timestamp()}] DEBUG ${msg}`, ...rest);
  },
};