/**
 * /api/io —— 整份配置导入/导出
 *
 * 设计：
 *   GET  /api/io/export     -> application/json: 返回 StoreFile
 *                              用 backupView 把敏感字段替换为 '***'，避免备份到文件落盘。
 *                              浏览器 console 同时也能从 GET /api/hosts 直接拿到明文。
 *   POST /api/io/import     -> body: StoreFile 或 { hosts: HostConfig[] }
 *                              { mode: 'replace' | 'merge' }，默认 'replace'
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
import { loadStore, saveStore } from '../../config/store';

export const ioRouter = Router();

function validateHost(h: unknown, idx: number): asserts h is HostConfig {
  if (!h || typeof h !== 'object') {
    throw new Error(`hosts[${idx}] is not an object`);
  }
  const x = h as Record<string, unknown>;
  if (typeof x.hostId !== 'string' || !x.hostId) {
    throw new Error(`hosts[${idx}].hostId missing or not a string`);
  }
  if (typeof x.host !== 'string' || !x.host) {
    throw new Error(`hosts[${idx}].host missing or not a string`);
  }
  if (typeof x.username !== 'string' || !x.username) {
    throw new Error(`hosts[${idx}].username missing or not a string`);
  }
  if (!x.password && !x.privateKey) {
    throw new Error(`hosts[${idx}] needs either password or privateKey`);
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
    return res.status(400).json({ error: 'body.hosts must be an array' });
  }

  // 校验
  const incoming: HostConfig[] = [];
  for (let i = 0; i < body.hosts.length; i += 1) {
    try {
      validateHost(body.hosts[i], i);
      // 掩码占位符 ('***') 不应被持久化 —— 当作未提供
      const h = body.hosts[i] as HostConfig;
      incoming.push({
        ...h,
        password: h.password === '***' ? undefined : h.password,
        privateKey: h.privateKey === '***' ? undefined : h.privateKey,
        passphrase: h.passphrase === '***' ? undefined : h.passphrase,
      });
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message });
    }
  }

  const current = await loadStore();
  let merged: HostConfig[];
  if (mode === 'replace') {
    merged = incoming;
  } else {
    const byId = new Map(current.hosts.map(h => [h.hostId.toLowerCase(), h]));
    for (const h of incoming) byId.set(h.hostId.toLowerCase(), h);
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
