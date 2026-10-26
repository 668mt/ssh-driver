/**
 * config 命令 —— 增删改查 SSH 主机配置
 *
 * 用例：
 *   ssh-driver config add     --hostId dev --host 1.2.3.4 --username root --password xxx
 *   ssh-driver config list
 *   ssh-driver config list --json
 *   ssh-driver config show    dev
 *   ssh-driver config update  dev --port 2222
 *   ssh-driver config remove  dev
 *   ssh-driver config test    dev
 *
 * 合并语义（重要）：`config add` 重复执行**不会**覆盖已保存的密码 / 私钥。
 * 没传的字段一律保留原值，详见 config/merge.ts。
 * @Author Martin
 * @Date 2026/10/19
 */

import { Command } from 'commander';

import { HostConfig } from '../config/schema';
import { deleteHost, findHost, loadStore, upsertHost } from '../config/store';
import { logger } from '../utils/logger';
import { pingOnce } from '../ssh/client';

function mask(v?: string): string {
  return v ? '***' : '';
}

/** 对外展示时的脱敏视图（CLI 只给人看，不该回显凭据） */
function maskedView(h: HostConfig): Record<string, unknown> {
  return {
    ...h,
    password: mask(h.password),
    privateKey: h.privateKey ? '***' : undefined,
    passphrase: mask(h.passphrase),
  };
}

async function loadHostOrThrow(hostId: string): Promise<HostConfig> {
  const store = await loadStore();
  const host = findHost(store, hostId);
  if (!host) {
    throw new Error(`主机 '${hostId}' 不存在，请先运行 'ssh-driver config list' 查看已保存的主机。`);
  }
  return host;
}

function printHost(h: HostConfig): void {
  console.log(JSON.stringify(maskedView(h), null, 2));
}

export async function configAdd(opts: {
  hostId: string;
  host: string;
  port?: string | number;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  description?: string;
  readyTimeout?: string | number;
  tags?: string;
  test?: boolean;
}): Promise<void> {
  const host: HostConfig = {
    hostId: opts.hostId,
    host: opts.host,
    // commander 不带 parser 时给的是字符串 —— 必须显式转成数字，
    // 否则 config.json 里会存下 "2222" 这种字符串端口
    port: opts.port != null && opts.port !== '' ? Number(opts.port) : undefined,
    username: opts.username,
    password: opts.password,
    privateKey: opts.privateKey,
    passphrase: opts.passphrase,
    description: opts.description,
    readyTimeout:
      opts.readyTimeout != null && opts.readyTimeout !== ''
        ? Number(opts.readyTimeout)
        : undefined,
    tags: opts.tags ? opts.tags.split(',').map(s => s.trim()).filter(Boolean) : undefined,
  };

  // 合并语义：没传的字段保留已保存的值（不会把密码抹掉）
  const { created } = await upsertHost(host);
  logger.info(created ? `已添加主机 '${host.hostId}'` : `已更新主机 '${host.hostId}'`);

  if (opts.test) {
    const stored = await loadHostOrThrow(host.hostId);
    const r = await pingOnce(stored);
    if (r.ok) logger.info(`测试成功：${r.banner ?? '已连接'}`);
    else logger.error(`测试失败：${r.error}`);
  }
}

export async function configList(opts: { json?: boolean } = {}): Promise<void> {
  const store = await loadStore();
  if (store.hosts.length === 0) {
    if (opts.json) {
      console.log(JSON.stringify([]));
      return;
    }
    logger.info('还没有配置任何主机，使用 `ssh-driver config add ...` 添加。');
    return;
  }

  if (opts.json) {
    console.log(JSON.stringify(store.hosts.map(maskedView), null, 2));
    return;
  }

  for (const h of store.hosts) {
    console.log(
      `${h.hostId}\t${h.username}@${h.host}:${h.port ?? 22}` +
        (h.description ? `\t# ${h.description}` : ''),
    );
  }
}

export async function configShow(hostId: string): Promise<void> {
  const host = await loadHostOrThrow(hostId);
  printHost(host);
}

export async function configUpdate(
  hostId: string,
  patch: Partial<Omit<HostConfig, 'hostId' | 'createdAt' | 'updatedAt'>>,
): Promise<void> {
  const host = await loadHostOrThrow(hostId);
  await upsertHost({ ...host, ...patch });
  logger.info(`已更新主机 '${hostId}'`);
}

export async function configRemove(hostId: string): Promise<void> {
  const ok = await deleteHost(hostId);
  if (!ok) throw new Error(`主机 '${hostId}' 不存在`);
  logger.info(`已删除主机 '${hostId}'`);
}

export async function configTest(hostId: string): Promise<void> {
  const host = await loadHostOrThrow(hostId);
  const r = await pingOnce(host);
  if (r.ok) {
    logger.info(`连通  ${hostId}  ${r.banner ?? ''}`);
  } else {
    logger.error(`不通  ${hostId}：${r.error}`);
    process.exitCode = 1;
  }
}

export function registerConfigCommand(program: Command): void {
  const cmd = program.command('config').description('管理已保存的 SSH 主机配置');

  cmd
    .command('add')
    .requiredOption('--hostId <id>', '唯一标识')
    .requiredOption('--host <host>', '主机名或 IP')
    .requiredOption('--username <user>', 'SSH 用户名')
    .option('--port <port>', 'SSH 端口（默认 22）')
    .option('--password <pwd>', '密码（推荐用 --privateKey）')
    .option('--privateKey <path>', '私钥文件路径')
    .option('--passphrase <pp>', '私钥口令')
    .option('--description <desc>', '人类可读描述')
    .option('--readyTimeout <ms>', '连接就绪超时（毫秒）')
    .option('--tags <tags>', '逗号分隔的标签')
    .option('--test', '保存后立即测试连通性', false)
    .action(async (opts) => configAdd(opts));

  cmd
    .command('list')
    .alias('ls')
    .description('列出已保存的主机')
    .option('--json', '以 JSON 输出（凭据脱敏）', false)
    .action(async (opts: { json?: boolean }) => configList(opts));

  cmd
    .command('show <hostId>')
    .description('查看某台主机的配置（敏感字段脱敏）')
    .action(async (hostId: string) => configShow(hostId));

  cmd
    .command('update <hostId>')
    .description('更新已保存主机的字段')
    .option('--host <host>')
    .option('--port <port>')
    .option('--username <user>')
    .option('--password <pwd>')
    .option('--privateKey <path>')
    .option('--passphrase <pp>')
    .option('--description <desc>')
    .option('--readyTimeout <ms>')
    .option('--tags <tags>')
    .action(async (hostId: string, opts: Record<string, string>) => {
      const patch: Partial<HostConfig> = {};
      for (const [k, v] of Object.entries(opts)) {
        if (v === undefined) continue;
        if (k === 'readyTimeout') patch.readyTimeout = Number(v);
        else if (k === 'port') patch.port = Number(v);
        else if (k === 'tags') patch.tags = String(v).split(',').map(s => s.trim()).filter(Boolean);
        else (patch as Record<string, unknown>)[k] = v;
      }
      await configUpdate(hostId, patch);
    });

  cmd
    .command('remove <hostId>')
    .alias('rm')
    .description('删除已保存的主机')
    .action(async (hostId: string) => configRemove(hostId));

  cmd
    .command('test <hostId>')
    .description('测试某台主机的 SSH 连通性')
    .action(async (hostId: string) => configTest(hostId));
}
