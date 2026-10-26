/**
 * 本地文件路径解析 —— 兼容 Git Bash / MSYS 的路径转换坑
 *
 * 背景：Git Bash（MSYS2）在把参数交给 Windows 原生程序时，会自动把
 * `/tmp/x` 转换成 `C:\Program Files\Git\tmp\x`。
 * 这对**本地路径**是好事（省得自己写 Windows 路径），但对**远端路径**是灾难
 * （远端是 Linux，路径必须是 `/tmp/x`）。
 *
 * 于是就有了这个两难：
 *   - 不加 `MSYS_NO_PATHCONV=1` → 远端路径被改写
 *   - 加了 `MSYS_NO_PATHCONV=1` → 本地路径也不被改写，`/tmp/x` 变成 `D:\tmp\x`
 *
 * 解决：远端路径原样使用（永远正确），本地路径在这里做兜底 ——
 * 原样不存在时，尝试用 Git Bash 自带的 `cygpath -w` 转成真实路径。
 * @Author Martin
 * @Date 2026/10/27
 */

import { spawnSync } from 'child_process';
import * as path from 'path';

/**
 * 用 cygpath 把 MSYS 风格路径转成 Windows 路径；不可用时返回 null。
 *
 * 不要求转换后的路径存在 —— 写新文件时目标本来就不存在，
 * 但 cygpath 知道 MSYS 的根目录映射（/tmp → 真正的 Temp 目录）。
 */
function tryCygpath(input: string): string | null {
  try {
    const res = spawnSync('cygpath', ['-w', input], {
      encoding: 'utf-8',
      shell: false,
      windowsHide: true,
    });
    if (res.status !== 0 || !res.stdout) return null;
    const out = res.stdout.trim();
    return out || null;
  } catch {
    return null;
  }
}

/**
 * 解析本地文件路径。
 *
 *   - POSIX 风格（`/xxx`）：在 MSYS/Git Bash 下用 `cygpath` 映射到真实目录
 *     （cygpath 知道 /tmp → 真正的 Temp 目录这类根映射）；
 *     非 MSYS 环境（Linux / macOS / 纯 Windows）按系统语义解析。
 *   - Windows 风格或相对路径：按当前工作目录解析。
 */
export function resolveLocalPath(input: string): string {
  if (!input) return input;
  if (input.startsWith('/')) {
    const converted = tryCygpath(input);
    if (converted) return converted;
  }
  return path.resolve(input);
}

/** 本地文件不存在的错误提示（带上 MSYS 的坑，免得用户一头雾水） */
export function localFileNotFound(input: string, resolved: string): Error {
  return new Error(
    `本地文件不存在：${input}（解析后：${resolved}）。` +
    '如果你在 Git Bash / MSYS 下运行，注意加 MSYS_NO_PATHCONV=1 防止路径被改写；' +
    '也可以直接写 Windows 绝对路径。',
  );
}
