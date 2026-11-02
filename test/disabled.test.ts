/**
 * 「禁用主机」—— 回归测试
 *
 * 验证三件事：
 *   1. 禁用状态能持久化，且 enable 能恢复
 *   2. 被禁用的主机在任何连接入口都被拦下（connectSsh / 连接池）
 *   3. REST API 的 disable / enable 可用，exec 被拒绝
 * @Author Martin
 * @Date 2026/11/02
 */

import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { startServer } from '../src/backend/server';
import { HostDisabledError, isHostDisabled } from '../src/config/schema';
import { loadStore, setHostDisabled, upsertHost } from '../src/config/store';
import { connectSsh } from '../src/ssh/client';
import { globalPool } from '../src/ssh/pool';

const TOKEN = 'test-token-disabled-012345';

let tmpDir: string;
let configPath: string;
let base: string;
let closeServer: () => Promise<void>;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ssh-driver-disabled-'));
  configPath = path.join(tmpDir, 'config.json');
  process.env.SSH_DRIVER_CONFIG = configPath;

  await upsertHost({
    hostId: 'prod-web-01',
    host: '10.0.1.10',
    port: 22,
    username: 'deploy',
    password: 'SECRET',
  });

  const server = await startServer({ port: 0, host: '127.0.0.1', dev: true, token: TOKEN });
  base = `http://127.0.0.1:${server.port}`;
  closeServer = server.close;
});

afterEach(async () => {
  await closeServer();
  delete process.env.SSH_DRIVER_CONFIG;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function auth(): Record<string, string> {
  return { 'Content-Type': 'application/json', 'X-Ssh-Driver-Token': TOKEN };
}

describe('禁用状态持久化', () => {
  it('disable 后打上标记，enable 后恢复', async () => {
    expect(await setHostDisabled('prod-web-01', true)).toBe(true);
    let store = await loadStore();
    expect(store.hosts[0].disabled).toBe(true);
    expect(isHostDisabled(store.hosts[0])).toBe(true);

    expect(await setHostDisabled('prod-web-01', false)).toBe(false);
    store = await loadStore();
    expect(isHostDisabled(store.hosts[0])).toBe(false);
  });

  it('hostId 不区分大小写', async () => {
    expect(await setHostDisabled('PROD-WEB-01', true)).toBe(true);
    const store = await loadStore();
    expect(store.hosts[0].disabled).toBe(true);
  });

  it('主机不存在 → 返回 undefined', async () => {
    expect(await setHostDisabled('ghost', true)).toBeUndefined();
  });

  it('disable 不会抹掉凭据', async () => {
    await setHostDisabled('prod-web-01', true);
    const store = await loadStore();
    expect(store.hosts[0].password).toBe('SECRET');
  });
});

describe('连接入口拦截', () => {
  it('connectSsh 对被禁用的主机抛 HostDisabledError', async () => {
    await setHostDisabled('prod-web-01', true);
    const store = await loadStore();
    await expect(connectSsh(store.hosts[0])).rejects.toBeInstanceOf(HostDisabledError);
  });

  it('连接池对被禁用的主机抛错（即使已有缓存连接）', async () => {
    await setHostDisabled('prod-web-01', true);
    // 每次操作都是重新从 store 解析主机，所以这里读到的一定带 disabled 标记
    const store = await loadStore();
    await expect(globalPool.withSession(store.hosts[0], async () => 'ok')).rejects.toBeInstanceOf(
      HostDisabledError,
    );
  });
});

describe('REST API', () => {
  it('POST /api/hosts/:hostId/disable → 禁用', async () => {
    const res = await fetch(`${base}/api/hosts/prod-web-01/disable`, {
      method: 'POST',
      headers: auth(),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).disabled).toBe(true);

    const store = await loadStore();
    expect(store.hosts[0].disabled).toBe(true);
  });

  it('POST /api/hosts/:hostId/enable → 恢复', async () => {
    await setHostDisabled('prod-web-01', true);
    const res = await fetch(`${base}/api/hosts/prod-web-01/enable`, {
      method: 'POST',
      headers: auth(),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).disabled).toBe(false);

    const store = await loadStore();
    expect(isHostDisabled(store.hosts[0])).toBe(false);
  });

  it('禁用不存在的主机 → 404', async () => {
    const res = await fetch(`${base}/api/hosts/ghost/disable`, {
      method: 'POST',
      headers: auth(),
    });
    expect(res.status).toBe(404);
  });

  it('GET /api/hosts 返回 disabled 标记', async () => {
    await setHostDisabled('prod-web-01', true);
    const res = await fetch(`${base}/api/hosts`, { headers: auth() });
    const body = await res.json();
    expect(body[0].disabled).toBe(true);
  });

  it('被禁用主机的 exec → 403', async () => {
    await setHostDisabled('prod-web-01', true);
    const res = await fetch(`${base}/api/hosts/prod-web-01/exec`, {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ command: 'ls' }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain('禁用');
  });

  it('被禁用主机的 test → 403', async () => {
    await setHostDisabled('prod-web-01', true);
    const res = await fetch(`${base}/api/hosts/prod-web-01/test`, {
      method: 'POST',
      headers: auth(),
    });
    expect(res.status).toBe(403);
  });

  it('编辑表单取消勾选（disabled:false）→ 恢复启用', async () => {
    // 这是「取消禁用」的完整链路：PUT 会先 merge 一次，replaceHost 再 merge 一次。
    // 中间任何一层把 false 当成「没传」都会导致禁用状态解不掉。
    await setHostDisabled('prod-web-01', true);

    const res = await fetch(`${base}/api/hosts/prod-web-01`, {
      method: 'PUT',
      headers: auth(),
      body: JSON.stringify({ disabled: false }),
    });
    expect(res.status).toBe(200);

    const store = await loadStore();
    expect(isHostDisabled(store.hosts[0])).toBe(false);
    // 落盘时不该留下一堆 disabled:false 的噪音
    expect(store.hosts[0].disabled).toBeUndefined();
  });

  it('编辑表单勾选（disabled:true）→ 禁用', async () => {
    const res = await fetch(`${base}/api/hosts/prod-web-01`, {
      method: 'PUT',
      headers: auth(),
      body: JSON.stringify({ disabled: true }),
    });
    expect(res.status).toBe(200);

    const store = await loadStore();
    expect(store.hosts[0].disabled).toBe(true);
  });

  it('没传 disabled 字段 → 禁用状态保持不变', async () => {
    await setHostDisabled('prod-web-01', true);
    await fetch(`${base}/api/hosts/prod-web-01`, {
      method: 'PUT',
      headers: auth(),
      body: JSON.stringify({ port: 2222 }),
    });
    const store = await loadStore();
    expect(store.hosts[0].disabled).toBe(true);
    expect(store.hosts[0].port).toBe(2222);
  });
});
