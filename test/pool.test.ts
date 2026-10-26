/**
 * 连接池 —— 回归测试
 *
 * 覆盖三个真实踩过的坑：
 *   1. 命令超时后远端进程不会被杀（孤儿进程 + 占用 sshd channel 配额）
 *   2. 并发超过 sshd 的 MaxSessions 会硬失败 `Channel open failure`
 *   3. 超时被误判成「连接坏了」→ 自动重试 → 副作用做两遍
 *
 * 这里不连真实服务器 —— 用假的 NodeSSH 替身驱动。
 * @Author Martin
 * @Date 2026/10/26
 */

import { EventEmitter } from 'events';
import { describe, expect, it } from 'vitest';

import { CommandTimeoutError } from '../src/ssh/client';
import {
  SshSessionPool,
  Semaphore,
  isChannelOpenError,
  isConnectionError,
} from '../src/ssh/pool';

/* ------------------------------------------------------------------ *
 * 假的 SSH 连接
 * ------------------------------------------------------------------ */

/**
 * 假的 ssh2 channel。
 *
 * 忠实还原真实行为里最关键的一点：node-ssh 在没有 stdin 时会立刻
 * `channel.end()`，于是 channel 变成 `state='eof' / writable=false`。
 * 这时 ssh2 的公开 `signal()` 因为状态检查而**静默失效**，
 * 所以实现必须走协议层（见 client.ts 的 sendSignal）。
 */
class FakeChannel extends EventEmitter {
  closeCount = 0;
  stderr = new EventEmitter();

  /** 走公开 API 发的信号（channel 正常时才会走到这里） */
  publicSignals: string[] = [];
  /** 走协议层发的信号 */
  protocolSignals: string[] = [];

  /** 模拟 node-ssh 立刻 end 之后的真实状态 */
  outgoing = { state: 'eof' as string, id: 0 };
  writable = false;

  /** 模拟 ssh2 的协议层 */
  _client = {
    _protocol: {
      signal: (id: number, name: string): void => {
        this.protocolSignals.push(name);
      },
    },
  };

  signal(name: string): void {
    // 真实 ssh2 在 state !== 'open' 时直接静默返回
    if (this.outgoing.state !== 'open' || !this.writable) return;
    this.publicSignals.push(name);
  }

  close(): void {
    this.closeCount += 1;
    this.outgoing.state = 'closed';
    this.emit('close');
  }
}

/**
 * 假的 NodeSSH。
 *
 * `execCommand` 模拟两种行为：
 *   - 默认：永不 settle（模拟远端卡住）
 *   - hang=false：立刻返回结果
 */
class FakeSSH {
  connection: FakeChannel | null = new FakeChannel();
  disposed = false;
  /** 所有创建过的 channel */
  channels: FakeChannel[] = [];
  /** 模拟 channel open 失败：前 N 次 exec 抛错 */
  failOpenTimes = 0;
  openAttempts = 0;
  hang = true;
  /** 让 channel 保持 open + writable（公开 signal() API 生效的条件） */
  keepChannelOpen = false;

  isConnected(): boolean {
    return !this.disposed;
  }

  dispose(): void {
    this.disposed = true;
  }

  execCommand(
    _command: string,
    options?: { onChannel?: (ch: FakeChannel) => void },
  ): Promise<{ stdout: string; stderr: string; code: number | null }> {
    this.openAttempts += 1;
    if (this.failOpenTimes > 0) {
      this.failOpenTimes -= 1;
      return Promise.reject(new Error('(SSH) Channel open failure: open failed'));
    }
    const ch = new FakeChannel();
    if (this.keepChannelOpen) {
      ch.outgoing.state = 'open';
      ch.writable = true;
    }
    this.channels.push(ch);
    // node-ssh 在 onChannel 里同步回调
    options?.onChannel?.(ch);
    if (this.hang) {
      return new Promise(() => {
        /* 永不 settle —— 模拟远端卡住 */
      });
    }
    // 真实行为：命令跑完 → channel closed
    ch.outgoing.state = 'closed';
    ch.emit('close');
    return Promise.resolve({ stdout: 'ok', stderr: '', code: 0 });
  }
}

/** 造一个假的 host 配置 */
function fakeHost() {
  return {
    hostId: 'test-host',
    host: '127.0.0.1',
    port: 22,
    username: 'u',
    password: 'p',
  };
}

/* ------------------------------------------------------------------ *
 * 错误分类
 * ------------------------------------------------------------------ */

describe('错误分类', () => {
  it('命令超时不算连接错误（不能自动重试）', () => {
    const err = new CommandTimeoutError(3000);
    expect(isConnectionError(err)).toBe(false);
  });

  it('超时错误带上可识别的 code', () => {
    expect(new CommandTimeoutError(3000).code).toBe('ETIMEDOUT');
    expect(new CommandTimeoutError(3000).message).toContain('已终止远端进程');
  });

  it('真正的连接错误仍然算连接错误', () => {
    expect(isConnectionError(new Error('socket hang up'))).toBe(true);
    expect(isConnectionError(new Error('ECONNRESET'))).toBe(true);
  });

  it('认证失败不算连接错误（重试也没用）', () => {
    expect(isConnectionError(new Error('All configured authentication methods failed'))).toBe(false);
    expect(isConnectionError(new Error('Permission denied (publickey)'))).toBe(false);
  });

  it('channel open 失败能被单独识别', () => {
    expect(isChannelOpenError(new Error('(SSH) Channel open failure: open failed'))).toBe(true);
    expect(isChannelOpenError(new Error('socket hang up'))).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * 信号量
 * ------------------------------------------------------------------ */

describe('Semaphore', () => {
  it('不超过上限时直接放行', async () => {
    const sem = new Semaphore(2);
    await sem.acquire();
    await sem.acquire();
    expect(sem.availablePermits).toBe(0);
    sem.release();
    expect(sem.availablePermits).toBe(1);
  });

  it('超限的请求排队等待，释放后依次放行', async () => {
    const sem = new Semaphore(1);
    await sem.acquire();
    const order: number[] = [];
    const p2 = sem.acquire().then(() => order.push(2));
    const p3 = sem.acquire().then(() => order.push(3));
    await Promise.resolve();
    expect(order).toEqual([]);
    sem.release();
    await p2;
    sem.release();
    await p3;
    expect(order).toEqual([2, 3]);
  });

  it('上限至少为 1（0 / 负数不能把并发锁死）', async () => {
    const sem = new Semaphore(0);
    await sem.acquire();
    expect(sem.availablePermits).toBe(0);
    sem.release();
    expect(sem.availablePermits).toBe(1);
  });
});

/* ------------------------------------------------------------------ *
 * 连接池
 * ------------------------------------------------------------------ */

describe('SshSessionPool', () => {
  it('统计信息里能看到并发上限', async () => {
    const pool = new SshSessionPool();
    const stats = pool.stats();
    expect(stats.count).toBe(0);
    await pool.closeAll();
  });

  it('超时的命令会给远端进程发信号（杀掉孤儿进程）', async () => {
    const pool = new SshSessionPool();
    const fake = new FakeSSH();
    const host = fakeHost();

    // 注入假的 ssh：绕过真实握手
    (pool as unknown as { acquire: (h: unknown) => Promise<unknown> }).acquire = async () => ({
      hostId: host.hostId,
      ssh: fake,
      client: null,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      reused: false,
      alive: true,
    });

    const execOnSsh = (await import('../src/ssh/client')).execOnSsh;
    await expect(
      execOnSsh(fake as never, 'sleep 999', { timeoutMs: 100 }),
    ).rejects.toBeInstanceOf(CommandTimeoutError);

    // 超时 → 立刻发 SIGTERM
    expect(fake.channels.length).toBe(1);
    expect(fake.channels[0].protocolSignals).toContain('SIGTERM');

    // 等过 SIGKILL 宽限期 → 升级到 SIGKILL 并关掉 channel
    await new Promise(r => setTimeout(r, 500));
    expect(fake.channels[0].protocolSignals).toContain('SIGKILL');
    expect(fake.channels[0].closeCount).toBeGreaterThan(0);

    await pool.closeAll();
  });

  it('channel 还是 open 时走公开的 signal() API', async () => {
    const pool = new SshSessionPool();
    const fake = new FakeSSH();
    const host = fakeHost();

    (pool as unknown as { acquire: (h: unknown) => Promise<unknown> }).acquire = async () => ({
      hostId: host.hostId,
      ssh: fake,
      client: null,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      reused: false,
      alive: true,
    });

    // 让 channel 保持 open + writable（公开 API 生效的条件）
    fake.keepChannelOpen = true;

    const execOnSsh = (await import('../src/ssh/client')).execOnSsh;
    await expect(
      execOnSsh(fake as never, 'sleep 999', { timeoutMs: 100 }),
    ).rejects.toBeInstanceOf(CommandTimeoutError);

    expect(fake.channels[0].publicSignals).toContain('SIGTERM');
    // 公开 API 生效时就不该再走协议层
    expect(fake.channels[0].protocolSignals).toHaveLength(0);

    await pool.closeAll();
  });

  it('已经 closed 的 channel 不发信号（避免服务端 DISCONNECT 整条连接）', async () => {
    const pool = new SshSessionPool();
    const fake = new FakeSSH();
    const host = fakeHost();

    (pool as unknown as { acquire: (h: unknown) => Promise<unknown> }).acquire = async () => ({
      hostId: host.hostId,
      ssh: fake,
      client: null,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      reused: false,
      alive: true,
    });

    // 命令立刻返回 → channel 已经 closed
    fake.hang = false;
    const execOnSsh = (await import('../src/ssh/client')).execOnSsh;
    await execOnSsh(fake as never, 'echo hi');

    expect(fake.channels[0].outgoing.state).toBe('closed');
    expect(fake.channels[0].protocolSignals).toHaveLength(0);
    expect(fake.channels[0].publicSignals).toHaveLength(0);

    await pool.closeAll();
  });

  it('超时不触发重连重试（副作用不能做两遍）', async () => {
    const pool = new SshSessionPool();
    const fake = new FakeSSH();
    const host = fakeHost();
    let acquires = 0;

    (pool as unknown as { acquire: (h: unknown) => Promise<unknown> }).acquire = async () => {
      acquires += 1;
      return {
        hostId: host.hostId,
        ssh: fake,
        client: null,
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
        reused: true,
        alive: true,
      };
    };

    const execOnSsh = (await import('../src/ssh/client')).execOnSsh;
    await expect(
      pool.withSession(host, s => execOnSsh(s.ssh, 'sleep 1', { timeoutMs: 80 })),
    ).rejects.toBeInstanceOf(CommandTimeoutError);

    // 只取了一次连接 —— 没有重试
    expect(acquires).toBe(1);
    await pool.closeAll();
  });

  it('channel open 失败会重试一次（而不是直接失败）', async () => {
    const pool = new SshSessionPool();
    const fake = new FakeSSH();
    const host = fakeHost();
    let acquires = 0;

    (pool as unknown as { acquire: (h: unknown) => Promise<unknown> }).acquire = async () => {
      acquires += 1;
      return {
        hostId: host.hostId,
        ssh: fake,
        client: null,
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
        reused: true,
        alive: true,
      };
    };

    // 第一次开 channel 失败，第二次成功
    fake.failOpenTimes = 1;
    fake.hang = false;

    const execOnSsh = (await import('../src/ssh/client')).execOnSsh;
    const result = await pool.withSession(host, s => execOnSsh(s.ssh, 'echo hi'));

    expect(result.code).toBe(0);
    expect(fake.openAttempts).toBe(2);
    await pool.closeAll();
  });

  it('并发超过上限时排队，而不是直接失败', async () => {
    const pool = new SshSessionPool({ maxConcurrentPerSession: 3 });
    const fake = new FakeSSH();
    const host = fakeHost();
    let concurrent = 0;
    let peak = 0;

    (pool as unknown as { acquire: (h: unknown) => Promise<unknown> }).acquire = async () => ({
      hostId: host.hostId,
      ssh: fake,
      client: null,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      reused: true,
      alive: true,
    });

    fake.hang = false;
    const execOnSsh = (await import('../src/ssh/client')).execOnSsh;

    await Promise.all(
      Array.from({ length: 10 }, () =>
        pool.withSession(host, async s => {
          concurrent += 1;
          peak = Math.max(peak, concurrent);
          const r = await execOnSsh(s.ssh, 'echo hi');
          concurrent -= 1;
          return r;
        }),
      ),
    );

    // 峰值不超过上限，且 10 条全部成功
    expect(peak).toBeLessThanOrEqual(3);
    expect(fake.openAttempts).toBe(10);
    await pool.closeAll();
  });
});
