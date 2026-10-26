/**
 * 命令行参数解析的小工具
 * @Author Martin
 * @Date 2026/10/26
 */

/**
 * 把命令行参数转成整数。
 *
 * ⚠️ 为什么不能直接用 `parseInt`：
 *   commander 在选项**带默认值**时，会把「默认值」作为第二个参数传给转换函数：
 *     .option('-n, --limit <n>', '...', parseInt, 50)
 *        ↓
 *     parseInt('6', 50)   // 第二个参数是「进制」！50 不是合法进制 → NaN
 *   结果就是 `--limit 6` 变成 NaN，条件判断全部失效，命令静默不工作。
 *   这里显式指定 10 进制，并且只接收一个参数，彻底规避这个坑。
 *
 * @returns 解析失败返回 undefined（commander 会当成「没传」，走默认值）
 */
export function parseIntArg(value: string): number | undefined {
  const n = Number.parseInt(value, 10);
  return Number.isNaN(n) ? undefined : n;
}
