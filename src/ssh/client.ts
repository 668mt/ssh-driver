/**
 * SSH 客户端封装，基于 node-ssh
 * @Author Martin
 * @Date 2026/10/19
 */

import { NodeSSH, Config as SshConfig } from 'node-ssh';

import { HostConfig } from '../config/schema';

export interface ExecResult {
  stdout: string;
  stderr: string;
  /** 进程退出码；node-ssh 在失败时可能为 undefined */
  code: number | null;
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
 */
export async function execOnSsh(
  ssh: NodeSSH,
  command: string,
  opts: ExecOptions = {},
): Promise<ExecResult> {
  const work = ssh.execCommand(command, {
    cwd: opts.cwd,
    // ssh2 的环境变量走 execOptions.env
    execOptions: opts.env ? { env: opts.env } : undefined,
    stdin: opts.stdin,
    // node-ssh 的回调收到的是 Buffer，这里转成字符串再交给调用方
    onStdout: opts.onStdout ? (chunk: Buffer) => opts.onStdout?.(chunk.toString('utf-8')) : undefined,
    onStderr: opts.onStderr ? (chunk: Buffer) => opts.onStderr?.(chunk.toString('utf-8')) : undefined,
  });

  let timer: NodeJS.Timeout | undefined;
  try {
    const timeoutP = opts.timeoutMs
      ? new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`命令执行超时（${opts.timeoutMs}ms），连接已断开`)),
            opts.timeoutMs,
          );
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
 * 建立一次连接并执行一条命令，结束后自动断开。
 *
 * 超时后会 `ssh.dispose()` 真正断开连接（旧版只是本地放弃等待，
 * 连接和远端进程都还挂着）。
 */
export async function execOn(
  host: HostConfig,
  command: string,
  opts: ExecOptions = {},
): Promise<ExecResult> {
  const ssh = new NodeSSH();
  try {
    await ssh.connect(buildSshConfig(host));
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
  const ssh = new NodeSSH();
  try {
    await ssh.connect(buildSshConfig(host));
    // 跑一条无害命令，确认 shell 可用
    const r = await ssh.execCommand('uname -a');
    return { ok: true, banner: (r.stdout ?? '').trim() };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  } finally {
    ssh.dispose();
  }
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
  const ssh = new NodeSSH();
  try {
    await ssh.connect(buildSshConfig(host));
    return await execScriptOnSsh(ssh, script, opts);
  } finally {
    ssh.dispose();
  }
}
