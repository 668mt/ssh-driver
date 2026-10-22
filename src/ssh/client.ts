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
  return cfg;
}

/** 建立一次连接并执行一条命令，结束后自动断开。 */
export async function execOnce(host: HostConfig, command: string): Promise<ExecResult> {
  const ssh = new NodeSSH();
  try {
    await ssh.connect(buildSshConfig(host));
    const result = await ssh.execCommand(command, { cwd: undefined });
    return {
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      code: typeof result.code === 'number' ? result.code : null,
    };
  } finally {
    ssh.dispose();
  }
}

/** 仅做连通性测试，返回 server 端识别到的信息（若可能）。 */
export async function pingOnce(host: HostConfig): Promise<{ ok: true; banner?: string } | { ok: false; error: string }> {
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
