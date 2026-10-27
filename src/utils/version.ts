/**
 * 读取包版本号 —— 单一事实来源
 *
 * 之前 CLI 里把版本号写死成 '0.2.0'，发布到 0.3.0 后 `--version` 还在报旧版本；
 * MCP server 里也写死了一份。统一改成从 package.json 读。
 * @Author Martin
 * @Date 2026/10/27
 */

import { readFileSync } from 'fs';
import * as path from 'path';

/**
 * 解析包根目录下的 package.json。
 *
 * 路径说明：
 *   - 编译产物：dist/utils/version.js → 上溯两级是包根
 *   - 源码：    src/utils/version.ts  → 上溯两级是包根
 * 两者一致。
 */
export function readPackageVersion(): string {
  const candidates = [
    path.resolve(__dirname, '..', '..', 'package.json'),
    path.resolve(__dirname, '..', 'package.json'),
  ];
  for (const file of candidates) {
    try {
      const pkg = JSON.parse(readFileSync(file, 'utf-8')) as { version?: string };
      if (pkg.version) return pkg.version;
    } catch {
      /* 试下一个 */
    }
  }
  return '0.0.0';
}
