/**
 * REST API —— 回归测试
 *
 * 覆盖三件事：
 *   1. 访问令牌鉴权（之前 API 是裸奔的）
 *   2. 脱敏占位符 '***' 不会被当成密码存进去
 *   3. import 的 merge / replace 不会抹掉本地已有凭据
 * @Author Martin
 * @Date 2026/10/26
 */

import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { startServer } from '../src/backend/server';
import { loadStore, upsertHost, withStoreLock } from '../src/config/store';

const TOKEN = 'test-token-0123456789';

let tmpDir: string;
let configPath: string;
let base: string;
let closeServer: () => Promise<void>;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ssh-driver-api-'));
  configPath = path.join(tmpDir, 'config.json');
  process.env.SSH_DRIVER_CONFIG = configPath;

  await upsertHost({
    hostId: 'prod-web-01',
    host: '10.0.1.10',
    port: 22,
    username: 'deploy',
    password: 'SECRET',
    tags: ['prod'],
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

function auth(extra: Record<string, string> = {}): Record<string, string> {
  return { 'Content-Type': 'application/json', 'X-Ssh-Driver-Token': TOKEN, ...extra };
}

describe('访问令牌', () => {
  it('没有令牌 → 401', async () => {
    const res = await fetch(`${base}/api/hosts`);
    expect(res.status).toBe(401);
  });

  it('错误令牌 → 401', async () => {
    const res = await fetch(`${base}/api/hosts`, {
      headers: { 'X-Ssh-Driver-Token': 'wrong' },
    });
    expect(res.status).toBe(401);
  });

  it('正确令牌 → 200', async () => {
    const res = await fetch(`${base}/api/hosts`, { headers: auth() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].hostId).toBe('prod-web-01');
  });

  it('cookie 也算凭证', async () => {
    const res = await fetch(`${base}/api/hosts`, {
      headers: { Cookie: `ssh_driver_token=${TOKEN}` },
    });
    expect(res.status).toBe(200);
  });
});

describe('跨域', () => {
  it('陌生来源 → 403', async () => {
    const res = await fetch(`${base}/api/hosts`, {
      headers: auth({ Origin: 'https://evil.example.com' }),
    });
    expect(res.status).toBe(403);
  });

  it('loopback 来源 → 放行', async () => {
    const res = await fetch(`${base}/api/hosts`, {
      headers: auth({ Origin: 'http://127.0.0.1:5174' }),
    });
    expect(res.status).toBe(200);
  });
});

describe("脱敏占位符 '***'", () => {
  it('PUT 提交 *** 不会把密码改成 ***', async () => {
    const res = await fetch(`${base}/api/hosts/prod-web-01`, {
      method: 'PUT',
      headers: auth(),
      body: JSON.stringify({ port: 2222, password: '***', privateKey: '***', passphrase: '***' }),
    });
    expect(res.status).toBe(200);

    const store = await loadStore();
    expect(store.hosts[0].password).toBe('SECRET');
    expect(store.hosts[0].port).toBe(2222);
  });

  it('POST 提交 *** 不会把密码改成 ***', async () => {
    const res = await fetch(`${base}/api/hosts`, {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({
        hostId: 'prod-web-01',
        host: '10.0.1.10',
        username: 'deploy',
        password: '***',
      }),
    });
    expect(res.status).toBe(200);

    const store = await loadStore();
    expect(store.hosts[0].password).toBe('SECRET');
  });
});

describe('导入导出', () => {
  it('导出时凭据是脱敏的', async () => {
    const res = await fetch(`${base}/api/io/export`, { headers: auth() });
    const body = await res.json();
    expect(body.hosts[0].password).toBe('***');
  });

  it('merge 导入脱敏文件不会抹掉本地密码（历史 bug）', async () => {
    const res = await fetch(`${base}/api/io/import`, {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({
        mode: 'merge',
        hosts: [
          { hostId: 'prod-web-01', host: '10.0.1.10', username: 'deploy', password: '***' },
        ],
      }),
    });
    expect(res.status).toBe(200);

    const store = await loadStore();
    expect(store.hosts[0].password).toBe('SECRET');
  });

  it('replace 导入脱敏文件也不会抹掉本地已有主机的密码', async () => {
    const res = await fetch(`${base}/api/io/import`, {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({
        mode: 'replace',
        hosts: [
          { hostId: 'prod-web-01', host: '10.0.1.10', username: 'deploy', password: '***' },
        ],
      }),
    });
    expect(res.status).toBe(200);

    const store = await loadStore();
    expect(store.hosts[0].password).toBe('SECRET');
  });

  it('导入本地不存在的脱敏主机 → 400 并说明原因', async () => {
    const res = await fetch(`${base}/api/io/import`, {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({
        mode: 'merge',
        hosts: [{ hostId: 'ghost', host: '1.1.1.1', username: 'root', password: '***' }],
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('脱敏');
  });

  it('导入会等配置锁，不会与其它写操作互相覆盖', async () => {
    // 模拟「另一个进程正在改配置」：先占住锁
    let release: (() => void) | undefined;
    const lockHeld = new Promise<void>(resolve => {
      release = resolve;
    });
    const holder = withStoreLock(async () => {
      await lockHeld;
    });
    // 等锁真的被拿到
    await new Promise(r => setTimeout(r, 50));

    // 导入请求应该被阻塞（而不是绕过锁直接写）
    let settled = false;
    const pending = fetch(`${base}/api/io/import`, {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({
        mode: 'merge',
        hosts: [{ hostId: 'prod-web-01', host: '10.0.1.10', username: 'deploy', password: '***' }],
      }),
    }).then(r => {
      settled = true;
      return r;
    });

    await new Promise(r => setTimeout(r, 200));
    expect(settled).toBe(false);

    release?.();
    await holder;
    const res = await pending;
    expect(res.status).toBe(200);

    const store = await loadStore();
    expect(store.hosts[0].password).toBe('SECRET');
  });
});

describe('主机 CRUD', () => {
  it('改名后旧 id 消失、新 id 生效', async () => {
    const res = await fetch(`${base}/api/hosts/prod-web-01`, {
      method: 'PUT',
      headers: auth(),
      body: JSON.stringify({ hostId: 'prod-web-02' }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).renamed).toBe(true);

    const store = await loadStore();
    expect(store.hosts).toHaveLength(1);
    expect(store.hosts[0].hostId).toBe('prod-web-02');
    expect(store.hosts[0].password).toBe('SECRET');
  });

  it('改名撞车 → 409 且不修改数据', async () => {
    await upsertHost({ hostId: 'other', host: 'h', username: 'u', password: 'p' });
    const res = await fetch(`${base}/api/hosts/prod-web-01`, {
      method: 'PUT',
      headers: auth(),
      body: JSON.stringify({ hostId: 'other' }),
    });
    expect(res.status).toBe(409);

    const store = await loadStore();
    expect(store.hosts).toHaveLength(2);
  });
});
