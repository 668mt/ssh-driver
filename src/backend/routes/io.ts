/**
 * /api/io —— 整份配置导入/导出
 *
 * 设计：
 *   GET  /api/io/export     -> application/json: 返回 StoreFile
 *                              用 backupView 把敏感字段替换为 '***'，避免备份到文件落盘。
 *   POST /api/io/import     -> body: StoreFile 或 { hosts: HostConfig[] }
 *                              { mode: 'replace' | 'merge' }，默认 'replace'
 *
 * 导入的凭据语义（见 config/merge.ts）：
 *   脱敏文件里的 '***' 表示「我不知道这个凭据」，
 *   只有本地已有同名主机时才能补齐；否则导入会被明确拒绝，
 *   而不是把 '***' 当密码存进去。
 * @Author Martin
 * @Date 2026/10/21
 */

import { Router, Request, Response } from 'express';

import {
  HostConfig,
  backupView,
  StoreFile,
  STORE_VERSION,
} from '../../config/schema';
import { isMasked, mergeHostConfig } from '../../config/merge';
import { findHost, loadStore, saveStore } from '../../config/store';

export const ioRouter = Router();

function validateHost(h: unknown, idx: number): asserts h is HostConfig {
  if (!h || typeof h !== 'object') {
    throw new Error(`hosts[${idx}] 不是一个对象`);
  }
  const x = h as Record<string, unknown>;
  if (typeof x.hostId !== 'string' || !x.hostId) {
    throw new Error(`hosts[${idx}] 缺少 hostId，或它不是字符串`);
  }
  if (typeof x.host !== 'string' || !x.host) {
    throw new Error(`hosts[${idx}].host 缺失，或它不是字符串`);
  }
  if (typeof x.username !== 'string' || !x.username) {
    throw new Error(`hosts[${idx}].username 缺失，或它不是字符串`);
  }
  if (!x.password && !x.privateKey) {
    throw new Error(`hosts[${idx}] 需要提供 password 或 privateKey 其中之一`);
  }
}

// GET /api/io/export
ioRouter.get('/export', async (_req: Request, res: Response) => {
  const store = await loadStore();
  const payload: StoreFile = {
    version: STORE_VERSION,
    hosts: backupView(store.hosts),
  };
  res.setHeader('Content-Disposition', 'attachment; filename="ssh-driver-config.json"');
  res.json(payload);
});

// POST /api/io/import
ioRouter.post('/import', async (req: Request, res: Response) => {
  const body = req.body as { hosts?: unknown[]; mode?: 'replace' | 'merge' };
  const mode: 'replace' | 'merge' = body.mode === 'merge' ? 'merge' : 'replace';

  if (!Array.isArray(body.hosts)) {
    return res.status(400).json({ error: '请求体的 hosts 必须是数组' });
  }

  const current = await loadStore();

  // 校验 + 脱敏占位符处理
  const incoming: HostConfig[] = [];
  for (let i = 0; i < body.hosts.length; i += 1) {
    try {
      validateHost(body.hosts[i], i);
      const h = body.hosts[i] as HostConfig;
      // 掩码占位符 ('***') 不应被持久化 —— 当作未提供
      const sanitized: HostConfig = {
        ...h,
        password: isMasked(h.password) ? undefined : h.password,
        privateKey: isMasked(h.privateKey) ? undefined : h.privateKey,
        passphrase: isMasked(h.passphrase) ? undefined : h.passphrase,
      };

      // 脱敏文件里没有真实凭据：本地已有同名主机才能补齐
      if (!sanitized.password && !sanitized.privateKey) {
        const existing = findHost(current, sanitized.hostId);
        if (!existing) {
          throw new Error(
            `hosts[${i}] '${sanitized.hostId}' 的凭据是脱敏的（***），` +
            `而本地没有同名主机，无法导入。请先在本机配置好这台主机，或改用不脱敏的导出文件。`,
          );
        }
      }

      incoming.push(sanitized);
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message });
    }
  }

  let merged: HostConfig[];
  if (mode === 'replace') {
    // replace 是「整份覆盖」，但对**已存在**的主机仍然保留本地凭据 ——
    // 否则拿一份脱敏导出做 replace 会把本地所有密码清空。
    merged = incoming.map(h => {
      const existing = findHost(current, h.hostId);
      return existing ? mergeHostConfig(existing, h) : h;
    });
  } else {
    // merge：按 hostId 合并，**逐字段**保留本地已有的凭据
    const byId = new Map(current.hosts.map(h => [h.hostId.toLowerCase(), h]));
    for (const h of incoming) {
      const key = h.hostId.toLowerCase();
      byId.set(key, mergeHostConfig(byId.get(key), h));
    }
    merged = Array.from(byId.values());
  }

  const next: StoreFile = { version: STORE_VERSION, hosts: merged };
  await saveStore(next);

  res.json({
    imported: incoming.length,
    total: merged.length,
    mode,
  });
});
