/**
 * /api/hosts 系列路由
 * @Author Martin
 * @Date 2026/10/19
 */

import { Router, Request, Response } from 'express';

import {
  HostConfig,
  plainView,
} from '../../config/schema';
import {
  deleteHost,
  findHost,
  loadStore,
  saveStore,
  upsertHost,
} from '../../config/store';
import { pingOnce } from '../../ssh/client';
import { CreateHostBody, UpdateHostBody } from '../types';

function badRequest(res: Response, msg: string): void {
  res.status(400).json({ error: msg });
}

function notFound(res: Response, msg: string): void {
  res.status(404).json({ error: msg });
}

function requireHostId(body: Partial<HostConfig>): asserts body is HostConfig {
  if (!body.hostId || typeof body.hostId !== 'string') {
    throw new Error('hostId is required and must be a string');
  }
  if (!body.host || typeof body.host !== 'string') {
    throw new Error('host is required');
  }
  if (!body.username || typeof body.username !== 'string') {
    throw new Error('username is required');
  }
  if (!body.password && !body.privateKey) {
    throw new Error('either password or privateKey is required');
  }
}

function normalize(body: Partial<CreateHostBody>): Partial<CreateHostBody> {
  const out: Partial<CreateHostBody> = { ...body };
  if (out.port != null) out.port = Number(out.port);
  if (out.readyTimeout != null) out.readyTimeout = Number(out.readyTimeout);
  if (typeof out.tags === 'string') {
    out.tags = String(out.tags).split(',').map(s => s.trim()).filter(Boolean);
  }
  return out;
}

export const hostsRouter = Router();

// GET /api/hosts
hostsRouter.get('/', async (_req: Request, res: Response) => {
  const store = await loadStore();
  res.json(plainView(store.hosts));
});

// GET /api/hosts/:hostId
hostsRouter.get('/:hostId', async (req: Request, res: Response) => {
  const store = await loadStore();
  const host = findHost(store, String(req.params.hostId));
  if (!host) return notFound(res, `hostId '${req.params.hostId}' not found`);
  res.json(plainView(host));
});

// POST /api/hosts
hostsRouter.post('/', async (req: Request, res: Response) => {
  try {
    const body = normalize(req.body as CreateHostBody);
    requireHostId(body);
    const { created } = await upsertHost(body);
    res.status(created ? 201 : 200).json({ created });
  } catch (err) {
    badRequest(res, (err as Error).message);
  }
});

// PUT /api/hosts/:hostId
hostsRouter.put('/:hostId', async (req: Request, res: Response) => {
  try {
    const oldId = String(req.params.hostId);
    const store = await loadStore();
    const existing = findHost(store, oldId);
    if (!existing) return notFound(res, `hostId '${oldId}' not found`);

    const body = normalize(req.body as UpdateHostBody);
    // 用户编辑表单时 hostId 字段在 body 里。允许它和路径里的 oldId 不相等，
    // 这等同于把这条记录改名（rename）。
    const candidateNewId =
      typeof body.hostId === 'string' && body.hostId.trim()
        ? body.hostId.trim()
        : existing.hostId;

    if (candidateNewId.toLowerCase() !== existing.hostId.toLowerCase()) {
      // 改名：先确认新 id 没有冲突
      const conflict = findHost(store, candidateNewId);
      if (conflict) {
        return res
          .status(409)
          .json({ error: `目标 hostId '${candidateNewId}' 已存在，未做任何修改。请改名后重试。` });
      }
    }

    // 合并：保留原 createdAt；其余字段以 body 为准
    const { hostId: _ignored, ...rest } = body;
    const merged: HostConfig = {
      ...existing,
      ...rest,
      hostId: candidateNewId,
    };
    requireHostId(merged);

    // 先把旧记录从 store 拿掉（如果是 rename，避免同时存在两条），再写新的
    await deleteHost(existing.hostId);
    await upsertHost(merged);

    res.json({ updated: true, hostId: merged.hostId, renamed: merged.hostId !== oldId });
  } catch (err) {
    badRequest(res, (err as Error).message);
  }
});

// DELETE /api/hosts/:hostId
hostsRouter.delete('/:hostId', async (req: Request, res: Response) => {
  const ok = await deleteHost(String(req.params.hostId));
  if (!ok) return notFound(res, `hostId '${req.params.hostId}' not found`);
  res.json({ removed: true });
});

// POST /api/hosts/:hostId/test
hostsRouter.post('/:hostId/test', async (req: Request, res: Response) => {
  const store = await loadStore();
  const host = findHost(store, String(req.params.hostId));
  if (!host) return notFound(res, `hostId '${req.params.hostId}' not found`);

  // 支持测试一个未保存的连接（前端表单直传）
  if (req.body && req.body.host) {
    try {
      requireHostId(req.body);
    } catch (err) {
      return badRequest(res, (err as Error).message);
    }
    const candidate = normalize(req.body);
    const r = await pingOnce(candidate as HostConfig);
    return res.json(r);
  }

  const r = await pingOnce(host);
  res.json(r);
});
