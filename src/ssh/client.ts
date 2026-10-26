/**
 * SSH 客户端封装，基于 node-ssh
 * @Author Martin
 * @Date 2026/10/19
 */

import { NodeSSH, Config as SshConfig } from 'node-ssh';
import type { ClientChannel } from 'ssh2';

import { HostConfig } from '../config/schema';

export interface ExecResult {
  stdout: string;
  stderr: string;
  /** 进程退出码；node-ssh 在失败时可能为 undefined */
  code: number | null;
}

/**
 * 命令执行超时。
 *
 * 单独一个类型（而不是普通 Error）是为了让连接池能区分两种失败：
 *   - 超时 → 命令**可能已经产生了副作用**，不能自动重试
 *   - 连接错误 → 重连重试是安全的
 */
export class CommandTimeoutError extends Error {
  readonly code = 'ETIMEDOUT';

  constructor(timeoutMs: number) {
    super(`命令执行超时（${timeoutMs}ms），已终止远端进程`);
    this.name = 'CommandTimeoutError';
  }
}

export function buildSshConfig(host: HostConfig): SshConfig {
  const cfg: SshConfig = {
    host: host.host,
    port: host.port ?? 22,
    username: host.username,
    readyTimeout: host.readyTimeout ?? 15000,
  };
  if (host.privateKey) {
    cfg.privateKey = host.privateKey;
    if (host.passphrase) cfg.passphrase = host.passphrase;
  } else if (host.password) {
    cfg.password = host.password;
  } else {
    throw new Error(
      `host '${host.hostId}' has neither privateKey nor password set`,
    );
  }
  // 主机密钥指纹校验（可选）。配置了就必须匹配，防止中间人。
  if (host.hostHash) cfg.hostHash = host.hostHash;
  return cfg;
}

/** 一次远程执行的参数 */
export interface ExecOptions {
  /** 远端工作目录 */
  cwd?: string;
  /** 追加到远端环境变量 */
  env?: Record<string, string>;
  /** 超时（毫秒）。超时后会主动断开连接，远端进程随之终止 */
  timeoutMs?: number;
  /** 通过 stdin 喂给远端进程的内容（脚本执行用） */
  stdin?: string;
  /** 流式 stdout 回调 */
  onStdout?: (chunk: string) => void;
  /** 流式 stderr 回调 */
  onStderr?: (chunk: string) => void;
}

/**
 * 在**已经建立好的连接**上执行命令。
 *
 * 拆出来是为了让连接池（ssh/pool.ts）能复用同一条连接执行多条命令，
 * 不用每条命令都重新握手。
 *
 * 超时处理（重要）：
 *   超时不能只是「本地不等了」—— 远端进程会继续跑，成为孤儿
 *   （还会一直占着 sshd 的 MaxSessions channel 配额）。
 *   所以超时要**主动给远端进程发信号**。
 *
 *   为什么不能只 close channel：
 *   sshd 收到 channel 关闭后只会清理它自己的会话状态，
 *   **不会**杀掉已经 setsid 脱离的远端命令（实测：进程仍在，ppid=1）。
 *   真正能杀掉它的是 SSH 的 "signal" 请求（RFC 4254 §6.9）。
 *
 *   为什么不能直接用 channel.signal()：
 *   node-ssh 在没有 stdin 时会立刻 channel.end()，
 *   于是 channel 变成 `state='eof' / writable=false`，
 *   而 ssh2 的 signal() 要求 `state==='open' && writable` —— 直接调用是**静默 no-op**。
 *   所以这里直接走协议层发信号，绕开 ssh2 的状态检查。
 */
export async function execOnSsh(
  ssh: NodeSSH,
  command: string,
  opts: ExecOptions = {},
): Promise<ExecResult> {
  // node-ssh 的 execCommand 不把 channel 返回给调用方，
  // 只能靠 onChannel 回调拿到 —— 没有它就没法终止远端进程。
  let channel: ClientChannel | undefined;
  let timedOut = false;

  const work = ssh.execCommand(command, {
    cwd: opts.cwd,
    // ssh2 的环境变量走 execOptions.env
    execOptions: opts.env ? { env: opts.env } : undefined,
    stdin: opts.stdin,
    onChannel: (ch: ClientChannel) => {
      channel = ch;
      // 超时可能发生在 channel 建立之前 —— 这时立刻把它杀掉，
      // 否则远端进程会在超时之后才启动，然后永远没人管。
      if (timedOut) killRemoteProcess(ch);
    },
    // node-ssh 的回调收到的是 Buffer，这里转成字符串再交给调用方
    onStdout: opts.onStdout ? (chunk: Buffer) => opts.onStdout?.(chunk.toString('utf-8')) : undefined,
    onStderr: opts.onStderr ? (chunk: Buffer) => opts.onStderr?.(chunk.toString('utf-8')) : undefined,
  });

  let timer: NodeJS.Timeout | undefined;
  try {
    const timeoutP = opts.timeoutMs
      ? new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            timedOut = true;
            // 杀掉远端进程（SIGTERM → 宽限期 → SIGKILL）
            if (channel) killRemoteProcess(channel);
            reject(new CommandTimeoutError(opts.timeoutMs as number));
          }, opts.timeoutMs);
        })
      : null;

    const result = timeoutP ? await Promise.race([work, timeoutP]) : await work;
    return {
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      code: typeof result.code === 'number' ? result.code : null,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * 关闭 channel（幂等；失败不影响调用方）。
 *
 * 用 setImmediate 推迟一拍：node-ssh 的 onChannel 是在
 * `channel.on('close')` 注册**之前**调用的，同步 close 会让
 * 它的 promise 永远不 settle（事件在监听器挂上之前就发完了）。
 */
function scheduleChannelClose(channel: ClientChannel): void {
  setImmediate(() => {
    try {
      channel.close();
    } catch {
      /* 已经关了 */
    }
  });
}

/** SIGTERM 之后多久升级到 SIGKILL（毫秒） */
const SIGKILL_GRACE_MS = 300;

/**
 * 杀掉远端命令进程。
 *
 * 走 SSH 的 "signal" 请求（RFC 4254 §6.9），sshd 会把信号转给
 * 远端进程的进程组 —— 这是唯一能干掉 setsid 脱离进程的可靠手段。
 *
 * ⚠️ 为什么不用 `channel.signal()`：
 *   node-ssh 在没有 stdin 时会立刻 `channel.end()`，
 *   channel 变成 `state='eof' / writable=false`，
 *   而 ssh2 的 signal() 要求 `state==='open' && writable` —— 直接调用是静默 no-op
 *   （实测：远端进程活得好好的）。
 *
 * ⚠️ 为什么不用 `channel.close()`：
 *   sshd 收到 channel 关闭只清理自己的会话状态，**不会**杀掉
 *   已经 setsid 脱离的远端命令（实测：进程仍在，ppid=1）。
 */
function killRemoteProcess(channel: ClientChannel): void {
  sendSignal(channel, 'SIGTERM');
  // 给它一点时间优雅退出；不行就 SIGKILL
  const t = setTimeout(() => {
    sendSignal(channel, 'SIGKILL');
    scheduleChannelClose(channel);
  }, SIGKILL_GRACE_MS);
  t.unref?.();
}

/**
 * ssh2 的 Channel 内部状态。
 *
 * `@types/ssh2` 把 `outgoing` 标成了 `{}`，但实际运行时它有
 * `state`（'open' / 'eof' / 'closing' / 'closed'）和 `id`（远端 channel 号）。
 */
interface ChannelInternals {
  outgoing?: { state?: string; id?: number };
  _client?: { _protocol?: { signal?: (id: number, name: string) => void } };
}

/**
 * 发一个 SSH signal 请求。
 *
 * 优先用 ssh2 的公开 API（channel 还 open 时有效），
 * 否则直接调协议层 —— 绕过 ssh2 对 `state==='open'` 的限制。
 *
 * ⚠️ 绝不能对已经 closed 的 channel 发请求：
 *    服务端会回 "unknown channel" 并直接 DISCONNECT 整条连接。
 */
function sendSignal(channel: ClientChannel, signalName: string): void {
  const internals = channel as unknown as ChannelInternals;
  const state = internals.outgoing?.state;
  // 只在 channel 还活着（open / eof）时发 —— closed 会导致连接被服务端踢掉
  if (state !== 'open' && state !== 'eof') return;

  try {
    if (state === 'open' && channel.writable) {
      // 公开 API 走这条（channel 状态正常时优先用它）
      channel.signal(signalName);
      return;
    }
  } catch {
    /* 落到下面的协议层 */
  }

  try {
    // 协议层：ssh2 内部用的就是这一条路径。
    // node-ssh 在没有 stdin 时会立刻 channel.end() → state 变成 'eof'，
    // 而 ssh2 的公开 signal() 要求 state==='open' —— 直接调用是静默 no-op。
    const proto = internals._client?._protocol;
    const id = internals.outgoing?.id;
    if (proto?.signal && typeof id === 'number') {
      proto.signal(id, signalName);
      return;
    }
  } catch {
    /* 通道已经没了 —— 远端进程可能自己结束了 */
  }

  // 最后兜底：至少把 channel 关掉，释放 sshd 的 channel 配额
  scheduleChannelClose(channel);
}

/**
 * 建立连接，并挂好兜底的 error 监听器。
 *
 * 所有需要 SSH 连接的入口都应该走这里 —— 见 `guardConnectionErrors` 的说明。
 */
export async function connectSsh(host: HostConfig): Promise<NodeSSH> {
  const ssh = new NodeSSH();
  await ssh.connect(buildSshConfig(host));
  guardConnectionErrors(ssh);
  return ssh;
}

/**
 * 建立一次连接并执行一条命令，结束后自动断开。
 *
 * 超时后 `execOnSsh` 会杀掉远端进程，这里再 `ssh.dispose()` 兜底。
 */
export async function execOn(
  host: HostConfig,
  command: string,
  opts: ExecOptions = {},
): Promise<ExecResult> {
  const ssh = await connectSsh(host);
  try {
    return await execOnSsh(ssh, command, opts);
  } finally {
    ssh.dispose();
  }
}

/** 建立一次连接并执行一条命令，结束后自动断开。 */
export async function execOnce(host: HostConfig, command: string): Promise<ExecResult> {
  return execOn(host, command);
}

/** 仅做连通性测试，返回 server 端识别到的信息（若可能）。 */
export async function pingOnce(
  host: HostConfig,
): Promise<{ ok: true; banner?: string } | { ok: false; error: string }> {
  let ssh: NodeSSH | undefined;
  try {
    ssh = await connectSsh(host);
    // 跑一条无害命令，确认 shell 可用
    const r = await ssh.execCommand('uname -a');
    return { ok: true, banner: (r.stdout ?? '').trim() };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  } finally {
    ssh?.dispose();
  }
}

/**
 * 挂一个兜底的 error 监听器。
 *
 * 为什么需要：node-ssh 在连接 ready 之后会把它的 `error` 监听器摘掉
 * （见 node-ssh/lib/cjs/index.js 的 `removeListener('error', reject)`）。
 * 这之后连接上再出任何 error，Node 会当成「未处理的 error 事件」
 * **直接终止整个进程** —— MCP server 会当场崩掉。
 *
 * 连接池里的连接有同样的问题（见 ssh/pool.ts 的 createSession），
 * 那里已经挂了 `client.on('error', drop)`；这里是给「一次性连接」用的。
 */
function guardConnectionErrors(ssh: NodeSSH): void {
  const client = ssh.connection;
  if (!client) return;
  client.on('error', () => {
    /* 吞掉：连接层面的错误由各自的调用点负责处理，
       这里只是防止 Node 因未处理的 error 事件而退出进程。 */
  });
}

/* ------------------------------------------------------------------ *
 * 脚本执行
 * ------------------------------------------------------------------ */

/** 走 `-s`（从 stdin 读脚本）的 shell */
const STDIN_SCRIPT_SHELLS = new Set(['bash', 'sh', 'dash', 'ash', 'ksh', 'zsh', 'busybox']);

/**
 * 从脚本内容的 shebang 推断解释器。
 *
 *   #!/bin/bash            -> /bin/bash
 *   #!/usr/bin/env python3 -> python3
 *   （没有 shebang）        -> null（交给调用方兜底）
 */
export function detectInterpreter(script: string): string | null {
  const first = script.split(/\r?\n/, 1)[0]?.trim();
  if (!first || !first.startsWith('#!')) return null;
  const raw = first.slice(2).trim();
  if (!raw) return null;
  // 取第一个 token 作为命令，剩下的作为参数
  const parts = raw.split(/\s+/);
  const cmd = parts[0];
  const rest = parts.slice(1).join(' ');
  // `#!/usr/bin/env python3` -> python3（env 后面的部分整体作为解释器）
  if (/(^|\/)env$/.test(cmd)) {
    return rest || 'env';
  }
  return rest ? `${cmd} ${rest}` : cmd;
}

/** 解释器命令的最后一段（用于判断是不是 bash 家族） */
function interpreterBase(interpreter: string): string {
  const first = interpreter.trim().split(/\s+/)[0] ?? '';
  return (first.split('/').pop() ?? first).toLowerCase();
}

/** 给参数加引号，避免空格 / 特殊字符把远端命令搞坏 */
export function shellQuote(arg: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(arg)) return arg;
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

/**
 * 拼出远端命令行。
 *
 * bash 家族用 `bash -s -- args`（`-s` 表示从 stdin 读脚本）；
 * 其它解释器（python3 / perl / ruby …）用 `cmd - args`
 * —— 它们的约定是 `-` 表示「程序从 stdin 读」，后面的参数进 argv。
 *
 * 注意不能写成 `python3 -- args`：python 会把第一个参数当成脚本文件名。
 */
export function buildScriptCommand(interpreter: string, args: string[] = []): string {
  const base = interpreterBase(interpreter);
  const flag = STDIN_SCRIPT_SHELLS.has(base) ? '-s' : '-';
  const argPart = args.length ? ` ${args.map(shellQuote).join(' ')}` : '';
  return `${interpreter} ${flag}${argPart}`.trim();
}

export interface ScriptExecOptions {
  /** 解释器；不给则从 shebang 推断，再不给用 bash */
  interpreter?: string;
  /** 传给脚本的位置参数（$1 $2 ...） */
  args?: string[];
  /** 超时（毫秒） */
  timeoutMs?: number;
  /** 远端工作目录 */
  cwd?: string;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}

export interface ScriptExecResult extends ExecResult {
  /** 实际使用的解释器 */
  interpreter: string;
  /** 实际执行的远端命令 */
  remoteCommand: string;
}

/** 决定脚本用哪个解释器执行 */
export function resolveInterpreter(script: string, override?: string): string {
  if (override && override.trim()) return override.trim();
  return detectInterpreter(script) ?? 'bash';
}

/**
 * 在**已经建立好的连接**上，通过 stdin 把脚本喂给解释器执行。
 */
export async function execScriptOnSsh(
  ssh: NodeSSH,
  script: string,
  opts: ScriptExecOptions = {},
): Promise<ScriptExecResult> {
  const interpreter = resolveInterpreter(script, opts.interpreter);
  const remoteCommand = buildScriptCommand(interpreter, opts.args ?? []);
  const result = await execOnSsh(ssh, remoteCommand, {
    cwd: opts.cwd,
    stdin: script,
    timeoutMs: opts.timeoutMs,
    onStdout: opts.onStdout,
    onStderr: opts.onStderr,
  });
  return { ...result, interpreter, remoteCommand };
}

/**
 * 建立一次连接，把本地脚本内容通过 stdin 喂给远端解释器执行。
 *
 * 相比「先 SFTP 上传再执行」的好处：不在远端留临时文件，不受
 * 远端是否有可写目录 / 是否装了 sftp-server 的影响。
 */
export async function execScript(
  host: HostConfig,
  script: string,
  opts: ScriptExecOptions = {},
): Promise<ScriptExecResult> {
  const ssh = await connectSsh(host);
  try {
    return await execScriptOnSsh(ssh, script, opts);
  } finally {
    ssh.dispose();
  }
}
