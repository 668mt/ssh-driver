/**
 * 主机配置合并语义 —— 回归测试
 *
 * 这些用例守的是**真实发生过的数据丢失 bug**：
 *   「没填密码」把已保存的密码抹掉、「脱敏占位符 ***」被当成密码存进去。
 * @Author Martin
 * @Date 2026/10/26
 */

import { describe, expect, it } from 'vitest';

import { MASK, mergeHostConfig } from '../src/config/merge';
import { HostConfig } from '../src/config/schema';

const base: HostConfig = {
  hostId: 'prod-web-01',
  host: '10.0.1.10',
  port: 22,
  username: 'deploy',
  password: 'SECRET',
  privateKey: '/home/me/.ssh/id_ed25519',
  passphrase: 'PP',
  description: '生产 web-01',
  tags: ['prod', 'web'],
};

describe('mergeHostConfig', () => {
  it('undefined 字段不会覆盖已保存的值', () => {
    const merged = mergeHostConfig(base, {
      host: '10.0.1.11',
      password: undefined,
      privateKey: undefined,
      passphrase: undefined,
    });
    expect(merged.password).toBe('SECRET');
    expect(merged.privateKey).toBe('/home/me/.ssh/id_ed25519');
    expect(merged.passphrase).toBe('PP');
    expect(merged.host).toBe('10.0.1.11');
  });

  it("掩码占位符 '***' 视为「没提供」，保留原值", () => {
    const merged = mergeHostConfig(base, {
      password: MASK,
      privateKey: MASK,
      passphrase: MASK,
      port: 2222,
    });
    expect(merged.password).toBe('SECRET');
    expect(merged.privateKey).toBe('/home/me/.ssh/id_ed25519');
    expect(merged.passphrase).toBe('PP');
    expect(merged.port).toBe(2222);
  });

  it('空串表示显式清空', () => {
    const merged = mergeHostConfig(base, { password: '' });
    expect(merged.password).toBeUndefined();
    expect('password' in merged).toBe(false);
  });

  it('新增主机时 undefined 字段不会出现', () => {
    const merged = mergeHostConfig(undefined, {
      hostId: 'new-host',
      host: '1.2.3.4',
      username: 'root',
      password: undefined,
    });
    expect(merged.hostId).toBe('new-host');
    expect('password' in merged).toBe(false);
    expect('privateKey' in merged).toBe(false);
  });

  it('createdAt 不会被外部覆盖', () => {
    const merged = mergeHostConfig(
      { ...base, createdAt: '2026-01-01T00:00:00.000Z' },
      { createdAt: '2099-01-01T00:00:00.000Z' } as Partial<HostConfig>,
    );
    expect(merged.createdAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('hostId 可以通过 patch 改名', () => {
    const merged = mergeHostConfig(base, { hostId: 'prod-web-02' });
    expect(merged.hostId).toBe('prod-web-02');
    expect(merged.password).toBe('SECRET');
  });
});
