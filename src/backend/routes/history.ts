/**
 * /api/history —— 读取操作审计日志
 * @Author Martin
 * @Date 2026/10/26
 */

import { Router, Request, Response } from 'express';

import { getHistoryFile, readAudit } from '../../audit/log';

export const historyRouter = Router();

historyRouter.get('/', async (req: Request, res: Response) => {
  const q = req.query;
  const limit = Number(q.limit ?? 50) || 0; // limit=0 → 全部
  const hostId = typeof q.hostId === 'string' && q.hostId ? q.hostId : undefined;
  const failedOnly = q.failedOnly === 'true' || q.failedOnly === '1';
  try {
    const { entries, total } = await readAudit({ limit, hostId, failedOnly });
    res.json({ count: entries.length, total, file: getHistoryFile(), entries });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});
