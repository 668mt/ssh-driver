/**
 * SSH 连接池 —— 缓存已建立的连接，避免每次操作都重新握手。
 *
 * 为什么需要：
 *   MCP server / 网页控制台是长驻进程。如果每执行一条命令就
 *   connect → exec → disconnect，握手开销（尤其是密钥认证 + 高延迟
 *   网络）会让 AI 连续调用时非常慢，而且部分服务器会限制并发会话数。
 *   缓存连接后，第二条命令起就是零握手开销。
 *
 * 缓存的连接也必须能自己失效：
 *   - 远端可能因为 idle 超时主动断开（sshd 的 ClientAliveInterval）
 *   - 网络抖动、网络切换会让老连接变成「假活」
 *   所以：连接断开时立刻从池里摘除；执行失败时自动重连重试一次。
 * @Author Martin
 * @Date 2026/10/26
 */

import { NodeSSH } from 'node-ssh';
import type { Client } from 'ssh2';

import { HostConfig } from '../config/schema';
import { CommandTimeoutError, connectSsh } from './client';

export interface PoolOptions {
  /** 空闲多久后自动断开（毫秒），默认 5 分钟 */
  idleTimeoutMs?: number;
  /** 最多同时缓存多少条连接，默认 8 */
  maxSessions?: number;
  /** 空闲清理扫描间隔（毫秒） */
  sweepIntervalMs?: number;
  /**
   * 同一条连接上允许并发执行多少条命令，默认 8。
   *
   * 为什么需要：sshd 的 MaxSessions 默认是 10（每条 TCP 连接最多 10 个
   * session channel）。超过就直接报 `(SSH) Channel open failure: open failed`
   * —— 是硬失败，不是排队。所以这里主动限流，把超出的请求排进队列。
   */
  maxConcurrentPerSession?: number;
}

interface Session {
  hostId: string;
  ssh: NodeSSH;
  client: Client | null;
  createdAt: number;
  lastUsedAt: number;
  /** 本次 acquire 是复用已有连接还是新建的 */
  reused: boolean;
  /** 连接是否还活着（由 close/end/error 事件维护） */
  alive: boolean;
}

const DEFAULT_IDLE_TIMEOUT = 5 * 60 * 1000;
const DEFAULT_MAX_SESSIONS = 8;
const DEFAULT_SWEEP_INTERVAL = 30 * 1000;
/**
 * 单连接并发上限，默认 8。
 *
 * sshd 的 MaxSessions 默认 10 —— 每条 TCP 连接最多 10 个 session channel。
 * 超过就是硬失败 `(SSH) Channel open failure: open failed`（不是排队）。
 * 留 2 个余量给它自己用。
 */
const DEFAULT_MAX_CONCURRENT_PER_SESSION = 8;

/** 「远端没给开 channel」后的重试等待时间（毫秒） */
const CHANNEL_OPEN_RETRY_DELAY_MS = 250;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** 看起来像「连接层面的问题」的错误 —— 这些值得重连重试 */
const CONNECTION_ERROR_HINTS = [
  'not connected',
  'no response from server',
  'econnreset',
  'econnrefused',
  'econnaborted',
  'connection closed',
  'connection lost',
  'channel closed',
  'socket hang up',
  'not open',
  'epipe',
  'etimedout',
  'timed out',
  'handshake failed',
];

/**
 * 「远端拒绝开新 channel」的错误 —— 典型是并发超过了 sshd 的 MaxSessions。
 *
 * 这类错误**不是**连接坏了：连接本身是好的，只是这次没排上号。
 */
const CHANNEL_OPEN_ERROR_HINTS = ['channel open failure', 'open failed'];

/** 判断错误是不是「远端不给你开 channel」 */
export function isChannelOpenError(err: unknown): boolean {
  const msg = ((err as Error)?.message ?? String(err)).toLowerCase();
  if (!msg) return false;
  return CHANNEL_OPEN_ERROR_HINTS.some(hint => msg.includes(hint));
}

/**
 * 判断一个错误是否由连接失效引起（值得重连后重试一次）。
 *
 * ⚠️ 命令超时**不算**连接错误：命令可能已经产生了副作用
 * （写了半个文件、改了半个配置），重试等于把副作用做两遍。
 */
export function isConnectionError(err: unknown): boolean {
  // 超时是「命令跑太久」，不是「连接坏了」
  if (err instanceof CommandTimeoutError) return false;
  const msg = ((err as Error)?.message ?? String(err)).toLowerCase();
  if (!msg) return false;
  // 认证失败重试也没用，直接判定为非连接问题
  if (msg.includes('all configured authentication methods failed')) return false;
  if (msg.includes('permission denied')) return false;
  return CONNECTION_ERROR_HINTS.some(hint => msg.includes(hint));
}

/**
 * 简单的计数信号量 —— 限制同一条连接上的并发操作数。
 *
 * 用它把「超出 sshd MaxSessions 的并发」从硬失败变成排队等待。
 */
export class Semaphore {
  private available: number;
  private readonly waiters: Array<() => void> = [];

  constructor(limit: number) {
    this.available = Math.max(1, limit);
  }

  async acquire(): Promise<void> {
    if (this.available > 0) {
      this.available -= 1;
      return;
    }
    await new Promise<void>(resolve => this.waiters.push(resolve));
  }

  release(): void {
    const next = this.waiters.shift();
    if (next) next();
    else this.available += 1;
  }

  /** 当前可用的名额（测试用） */
  get availablePermits(): number {
    return this.available;
  }
}

export class SshSessionPool {
  private readonly sessions = new Map<string, Session>();
  /** 正在建立中的连接，避免并发时重复握手 */
  private readonly connecting = new Map<string, Promise<Session>>();
  private readonly idleTimeoutMs: number;
  private readonly maxSessions: number;
  private readonly sweepIntervalMs: number;
  private readonly maxConcurrentPerSession: number;
  /**
   * 每台主机一个并发闸门。
   *
   * sshd 的 MaxSessions 是**每条 TCP 连接**的限制，而池里每台主机只有
   * 一条连接 —— 所以闸门也必须按主机分，否则多主机场景下会互相拖累。
   */
  private readonly gates = new Map<string, Semaphore>();
  private sweeper?: NodeJS.Timeout;

  constructor(opts: PoolOptions = {}) {
    this.idleTimeoutMs = opts.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT;
    this.maxSessions = opts.maxSessions ?? DEFAULT_MAX_SESSIONS;
    this.sweepIntervalMs = opts.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL;
    this.maxConcurrentPerSession =
      opts.maxConcurrentPerSession ?? DEFAULT_MAX_CONCURRENT_PER_SESSION;
  }

  /** 取（并按需创建）某台主机的并发闸门 */
  private gate(hostId: string): Semaphore {
    const key = this.key(hostId);
    let g = this.gates.get(key);
    if (!g) {
      g = new Semaphore(this.maxConcurrentPerSession);
      this.gates.set(key, g);
    }
    return g;
  }

  private key(hostId: string): string {
    return hostId.toLowerCase();
  }

  /** 启动空闲清理定时器（unref，不阻止进程退出） */
  start(): void {
    if (this.sweeper) return;
    this.sweeper = setInterval(() => {
      void this.sweep();
    }, this.sweepIntervalMs);
    this.sweeper.unref?.();
  }

  /** 关闭全部连接并停止定时器 */
  async closeAll(): Promise<void> {
    if (this.sweeper) {
      clearInterval(this.sweeper);
      this.sweeper = undefined;
    }
    const all = Array.from(this.sessions.values());
    this.sessions.clear();
    for (const s of all) {
      try {
        s.ssh.dispose();
      } catch {
        /* 忽略关闭错误 */
      }
    }
  }

  /**
   * 拿到一条可用连接（复用优先，没有就新建）。
   */
  async acquire(host: HostConfig): Promise<Session> {
    const key = this.key(host.hostId);

    const existing = this.sessions.get(key);
    if (existing) {
      if (existing.alive && existing.ssh.isConnected()) {
        existing.lastUsedAt = Date.now();
        existing.reused = true;
        return existing;
      }
      // 连接已经死了（远端 idle 超时 / 网络抖动）—— 清掉重建
      this.sessions.delete(key);
      try {
        existing.ssh.dispose();
      } catch {
        /* 忽略 */
      }
    }

    // 同一个 host 正在建连 —— 等它，别重复握手
    const pending = this.connecting.get(key);
    if (pending) {
      const s = await pending;
      s.reused = true;
      return s;
    }

    const task = this.createSession(host);
    this.connecting.set(key, task);
    try {
      const session = await task;
      return session;
    } finally {
      this.connecting.delete(key);
    }
  }

  private async createSession(host: HostConfig): Promise<Session> {
    await this.evictIfNeeded(host.hostId);

    // connectSsh 已经挂好了兜底的 error 监听器（见 client.ts 的说明）
    const ssh = await connectSsh(host);
    const client = ssh.connection ?? null;

    const session: Session = {
      hostId: host.hostId,
      ssh,
      client,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      reused: false,
      alive: true,
    };

    // 远端主动断开 / 出错时，立刻把这条连接从池里摘掉
    const drop = (): void => {
      session.alive = false;
      const cur = this.sessions.get(this.key(host.hostId));
      if (cur === session) this.sessions.delete(this.key(host.hostId));
    };
    client?.on('close', drop);
    client?.on('end', drop);
    client?.on('error', drop);

    this.sessions.set(this.key(host.hostId), session);
    this.start();
    return session;
  }

  /** 池满时把最久没用的空闲连接踢掉 */
  private async evictIfNeeded(exceptHostId: string): Promise<void> {
    if (this.sessions.size < this.maxSessions) return;
    let victim: Session | undefined;
    for (const s of this.sessions.values()) {
      if (this.key(s.hostId) === this.key(exceptHostId)) continue;
      if (!victim || s.lastUsedAt < victim.lastUsedAt) victim = s;
    }
    if (!victim) return;
    this.sessions.delete(this.key(victim.hostId));
    try {
      victim.ssh.dispose();
    } catch {
      /* 忽略 */
    }
  }

  /**
   * 在一条（最好是复用的）连接上执行操作。
   *
   * 三层保护：
   *   1. **并发闸门**：同一时刻最多 N 条命令在跑（默认 8，sshd MaxSessions 是 10）。
   *      超出排队，而不是硬失败 `(SSH) Channel open failure: open failed`。
   *   2. **连接级重试**：连接层面的失败会自动重建连接并重试一次 ——
   *      这解决了「远端 idle 超时把连接掐了，但本地池子还以为它是活的」。
   *   3. **命令超时**：由 client 层负责终止远端进程，且**不重试**
   *      （命令可能已经产生副作用，重试等于做两遍）。
   */
  async withSession<T>(
    host: HostConfig,
    fn: (session: Session) => Promise<T>,
    opts: { retry?: boolean } = {},
  ): Promise<T> {
    const retry = opts.retry !== false;
    // 先占闸门位，再拿连接 —— 顺序反了会出现「拿到了连接却在排队」，
    // 导致连接被 sweeper 当成空闲回收掉。
    const gate = this.gate(host.hostId);
    await gate.acquire();
    try {
      const session = await this.acquire(host);
      try {
        const out = await fn(session);
        session.lastUsedAt = Date.now();
        return out;
      } catch (err) {
        session.lastUsedAt = Date.now();
        // 「远端不给你开 channel」不是连接坏了 —— 连接是好的，
        // 只是这次没排上号。等一下重试，而不是重建连接。
        if (isChannelOpenError(err)) {
          await sleep(CHANNEL_OPEN_RETRY_DELAY_MS);
          const retrySession = await this.acquire(host);
          try {
            const out = await fn(retrySession);
            retrySession.lastUsedAt = Date.now();
            return out;
          } catch (err2) {
            retrySession.lastUsedAt = Date.now();
            if (isConnectionError(err2)) this.disposeSession(retrySession);
            throw err2;
          }
        }
        const canRetry = retry && session.reused && isConnectionError(err);
        if (!canRetry) {
          // 连接本身坏了就摘掉；业务错误（命令失败 / 超时）保留连接
          if (isConnectionError(err)) this.disposeSession(session);
          throw err;
        }
        this.disposeSession(session);
        const fresh = await this.acquire(host);
        try {
          const out = await fn(fresh);
          fresh.lastUsedAt = Date.now();
          return out;
        } catch (err2) {
          fresh.lastUsedAt = Date.now();
          if (isConnectionError(err2)) this.disposeSession(fresh);
          throw err2;
        }
      }
    } finally {
      gate.release();
    }
  }

  /** 丢弃一条连接 */
  disposeSession(session: Session): void {
    const key = this.key(session.hostId);
    if (this.sessions.get(key) === session) this.sessions.delete(key);
    try {
      session.ssh.dispose();
    } catch {
      /* 忽略 */
    }
  }

  /** 主动关闭某台主机的缓存连接 */
  async close(hostId: string): Promise<boolean> {
    const key = this.key(hostId);
    const s = this.sessions.get(key);
    if (!s) return false;
    this.sessions.delete(key);
    try {
      s.ssh.dispose();
    } catch {
      /* 忽略 */
    }
    return true;
  }

  /** 清理空闲超时的连接 */
  async sweep(): Promise<number> {
    const now = Date.now();
    let closed = 0;
    for (const [key, s] of Array.from(this.sessions.entries())) {
      if (now - s.lastUsedAt > this.idleTimeoutMs) {
        this.sessions.delete(key);
        closed += 1;
        try {
          s.ssh.dispose();
        } catch {
          /* 忽略 */
        }
      }
    }
    return closed;
  }

  /** 当前缓存状态（给 /api/health、CLI、MCP 展示用） */
  stats(): {
    count: number;
    max: number;
    idleTimeoutMs: number;
    /** 单台主机上的并发上限（sshd MaxSessions 通常是 10，这里留了余量） */
    maxConcurrentPerSession: number;
    sessions: Array<{
      hostId: string;
      ageMs: number;
      idleMs: number;
      reused: boolean;
      alive: boolean;
    }>;
  } {
    const now = Date.now();
    return {
      count: this.sessions.size,
      max: this.maxSessions,
      idleTimeoutMs: this.idleTimeoutMs,
      maxConcurrentPerSession: this.maxConcurrentPerSession,
      sessions: Array.from(this.sessions.values()).map(s => ({
        hostId: s.hostId,
        ageMs: now - s.createdAt,
        idleMs: now - s.lastUsedAt,
        reused: s.reused,
        alive: s.alive && s.ssh.isConnected(),
      })),
    };
  }
}

/** 进程级共享的连接池（MCP / 控制台用） */
export const globalPool = new SshSessionPool();
