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

/** 统一的"主机不存在"提示 */
function hostNotFound(res: Response, hostId: string): void {
  notFound(res, `主机 '${hostId}' 不存在`);
}

/** 校验主机连接的必要字段（不含 hostId —— 测试连接时 hostId 可以还没填） */
function requireConnectionFields(body: Partial<HostConfig>): void {
  if (!body.host || typeof body.host !== 'string') {
    throw new Error('host（主机/IP）是必填项');
  }
  if (!body.username || typeof body.username !== 'string') {
    throw new Error('username（用户名）是必填项');
  }
  if (!body.password && !body.privateKey) {
    throw new Error('password 和 privateKey 至少要填一个');
  }
}

/** 保存主机时的完整校验，必须有 hostId */
function requireHostId(body: Partial<HostConfig>): asserts body is HostConfig {
  if (!body.hostId || typeof body.hostId !== 'string') {
    throw new Error('hostId（唯一标识）是必填项');
  }
  requireConnectionFields(body);
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
  if (!host) return hostNotFound(res, String(req.params.hostId));
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
    if (!existing) return hostNotFound(res, oldId);

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
  if (!ok) return hostNotFound(res, String(req.params.hostId));
  res.json({ removed: true });
});

// POST /api/hosts/:hostId/test
//
// 两种用法：
//   1. 只传路径参数           -> 测已保存的主机
//   2. body 带完整连接信息    -> 测未保存的（新增表单里直接点"测试"）
//
// 注意：必须先判断 body，路径里的 hostId 在新增场景下只是个占位符。
hostsRouter.post('/:hostId/test', async (req: Request, res: Response) => {
  const pathHostId = String(req.params.hostId);

  // 优先用 body 里传的连接信息（新增/编辑表单的"测试"按钮走这条路）
  if (req.body && (req.body.host || req.body.username)) {
    try {
      requireConnectionFields(req.body);
    } catch (err) {
      return badRequest(res, (err as Error).message);
    }
    // body 里的敏感字段可能是 '***' 占位符（编辑已有主机且用户没改密码），
    // 这时回退到 store 里已保存的主机补齐凭据。
    const candidate = normalize(req.body) as HostConfig;
    if (candidate.password === '***' || candidate.privateKey === '***' || candidate.passphrase === '***') {
      const store = await loadStore();
      const saved = findHost(store, pathHostId) ?? (candidate.hostId ? findHost(store, candidate.hostId) : undefined);
      if (saved) {
        if (candidate.password === '***') candidate.password = saved.password;
        if (candidate.privateKey === '***') candidate.privateKey = saved.privateKey;
        if (candidate.passphrase === '***') candidate.passphrase = saved.passphrase;
      }
    }
    const r = await pingOnce(candidate);
    return res.json(r);
  }

  // 没有 body，退回测已保存的主机
  const store = await loadStore();
  const host = findHost(store, pathHostId);
  if (!host) {
    return hostNotFound(res, pathHostId);
  }
  const r = await pingOnce(host);
  res.json(r);
});
