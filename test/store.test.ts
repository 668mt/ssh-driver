/**
 * 配置存储 —— 回归测试
 *
 * 重点验证「重复执行 config add 不会抹掉已保存的凭据」。
 * @Author Martin
 * @Date 2026/10/26
 */

import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { findHost, loadStore, upsertHost, deleteHost, replaceHost } from '../src/config/store';

let tmpDir: string;
let configPath: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ssh-driver-test-'));
  configPath = path.join(tmpDir, 'config.json');
  process.env.SSH_DRIVER_CONFIG = configPath;
});

afterEach(async () => {
  delete process.env.SSH_DRIVER_CONFIG;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('upsertHost', () => {
  it('新增主机', async () => {
    const { created } = await upsertHost({
      hostId: 'dev',
      host: '192.168.1.50',
      username: 'root',
      password: 'pwd',
    });
    expect(created).toBe(true);
    const store = await loadStore();
    expect(store.hosts).toHaveLength(1);
    expect(store.hosts[0].password).toBe('pwd');
    expect(store.hosts[0].createdAt).toBeTruthy();
  });

  it('重复 upsert 不会抹掉已保存的密码（历史 bug）', async () => {
    await upsertHost({
      hostId: 'dev',
      host: '192.168.1.50',
      username: 'root',
      password: 'pwd',
      privateKey: '/key',
      passphrase: 'pp',
      tags: ['a'],
    });

    // 模拟 `config add --hostId dev --host 192.168.1.50 --username root`（没带密码）
    const { created } = await upsertHost({
      hostId: 'dev',
      host: '192.168.1.50',
      username: 'root',
      password: undefined,
      privateKey: undefined,
      passphrase: undefined,
      tags: undefined,
    });

    expect(created).toBe(false);
    const store = await loadStore();
    expect(store.hosts).toHaveLength(1);
    expect(store.hosts[0].password).toBe('pwd');
    expect(store.hosts[0].privateKey).toBe('/key');
    expect(store.hosts[0].passphrase).toBe('pp');
    expect(store.hosts[0].tags).toEqual(['a']);
  });

  it('hostId 不区分大小写地视为同一台主机', async () => {
    await upsertHost({ hostId: 'Dev', host: 'h', username: 'u', password: 'p' });
    const { created } = await upsertHost({ hostId: 'dev', host: 'h2', username: 'u' });
    expect(created).toBe(false);
    const store = await loadStore();
    expect(store.hosts).toHaveLength(1);
    expect(store.hosts[0].host).toBe('h2');
  });
});

describe('replaceHost', () => {
  it('改名后旧 id 不再存在', async () => {
    await upsertHost({ hostId: 'old', host: 'h', username: 'u', password: 'p' });
    await replaceHost('old', { ...({ hostId: 'new', host: 'h', username: 'u' } as never) });
    const store = await loadStore();
    expect(store.hosts).toHaveLength(1);
    expect(store.hosts[0].hostId).toBe('new');
    expect(store.hosts[0].password).toBe('p');
  });
});

describe('deleteHost', () => {
  it('删除后 findHost 找不到', async () => {
    await upsertHost({ hostId: 'x', host: 'h', username: 'u', password: 'p' });
    expect(await deleteHost('X')).toBe(true);
    const store = await loadStore();
    expect(findHost(store, 'x')).toBeUndefined();
    expect(await deleteHost('x')).toBe(false);
  });
});

describe('saveStore 备份', () => {
  it('覆盖前会留一份 .bak', async () => {
    await upsertHost({ hostId: 'x', host: 'h1', username: 'u', password: 'p' });
    await upsertHost({ hostId: 'x', host: 'h2', username: 'u' });
    const bak = await fs.readFile(`${configPath}.bak`, 'utf-8');
    expect(JSON.parse(bak).hosts[0].host).toBe('h1');
  });
});
