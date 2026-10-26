/**
 * 主机配置的合并语义 —— 整个项目里最容易被写错的一块。
 *
 * 三种「特殊值」必须区分清楚：
 *
 *   undefined  →  调用方没提供这个字段          → 保留原值
 *   '***'      →  掩码占位符（来自脱敏导出）    → 保留原值
 *   ''         →  显式清空                      → 真的删掉
 *
 * 历史 bug：用 `{...existing, ...patch}` 展开合并时，**显式存在的
 * undefined 键也会覆盖原值**，于是「没填密码」把已保存的密码抹掉了。
 * 现在所有合并都必须走这里。
 * @Author Martin
 * @Date 2026/10/26
 */

import { HostConfig } from './schema';

/** 脱敏占位符 */
export const MASK = '***';

/** 敏感字段（合并时特殊对待） */
export const SECRET_FIELDS = ['password', 'privateKey', 'passphrase'] as const;

/** 判断是不是掩码占位符 */
export function isMasked(value: unknown): boolean {
  return value === MASK;
}

/**
 * 把主机配置合并到已有记录上。
 *
 * @param existing 已保存的记录；新增时传 undefined
 * @param patch    新提交的字段
 */
export function mergeHostConfig(
  existing: HostConfig | undefined,
  patch: Partial<HostConfig>,
): HostConfig {
  const out = { ...(existing ?? {}) } as HostConfig;

  for (const [key, value] of Object.entries(patch) as Array<[string, unknown]>) {
    if (value === undefined) continue;
    // 掩码占位符：当作「没提供」，保留原值
    if ((SECRET_FIELDS as readonly string[]).includes(key) && value === MASK) continue;
    // 创建时间不可被外部覆盖
    if (key === 'createdAt') continue;
    (out as unknown as Record<string, unknown>)[key] = value;
  }

  // 敏感字段被显式置空 → 删掉这个键（而不是留个空串）
  for (const key of SECRET_FIELDS) {
    if (out[key] === '') delete out[key];
  }

  return out;
}
