/**
 * 极简日志工具，区分用户输出与调试输出。
 * @Author Martin
 * @Date 2026/10/19
 */

const DEBUG = process.env.SSH_DRIVER_DEBUG === '1';

function timestamp(): string {
  return new Date().toISOString();
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
