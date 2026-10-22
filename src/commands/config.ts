/**
 * config 命令 —— 增删改查 SSH 主机配置
 *
 * 用例：
 *   ssh-driver config add     --hostId dev --host 1.2.3.4 --username root --password xxx
 *   ssh-driver config list
 *   ssh-driver config show    dev
 *   ssh-driver config update  dev --port 2222
 *   ssh-driver config remove  dev
 *   ssh-driver config test    dev
 * @Author Martin
 * @Date 2026/10/19
 */

import { Command } from 'commander';

import { HostConfig } from '../config/schema';
import { deleteHost, findHost, loadStore, saveStore, upsertHost } from '../config/store';
import { logger } from '../utils/logger';
import { pingOnce } from '../ssh/client';

function mask(v?: string): string {
  return v ? '***' : '';
}

async function loadHostOrThrow(hostId: string) {
  const store = await loadStore();
  const host = findHost(store, hostId);
  if (!host) {
    throw new Error(`主机 '${hostId}' 不存在，请先运行 'ssh-driver config list' 查看已保存的主机。`);
  }
  return host;
}

function printHost(h: HostConfig): void {
  console.log(JSON.stringify(
    {
      ...h,
      password: mask(h.password),
      privateKey: h.privateKey ? '***' : undefined,
      passphrase: mask(h.passphrase),
    },
    null,
    2,
  ));
}

export async function configAdd(opts: {
  hostId: string;
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  description?: string;
  readyTimeout?: number;
  tags?: string;
  test?: boolean;
}): Promise<void> {
  const host: HostConfig = {
    hostId: opts.hostId,
    host: opts.host,
    port: opts.port,
    username: opts.username,
    password: opts.password,
    privateKey: opts.privateKey,
    passphrase: opts.passphrase,
    description: opts.description,
    readyTimeout: opts.readyTimeout ? Number(opts.readyTimeout) : undefined,
    tags: opts.tags ? opts.tags.split(',').map(s => s.trim()).filter(Boolean) : undefined,
  };

  const { created } = await upsertHost(host);
  logger.info(created ? `已添加主机 '${host.hostId}'` : `已更新主机 '${host.hostId}'`);

  if (opts.test) {
    const stored = await loadHostOrThrow(host.hostId);
    const r = await pingOnce(stored);
    if (r.ok) logger.info(`测试成功：${r.banner ?? '已连接'}`);
    else logger.error(`测试失败：${r.error}`);
  }
}

export async function configList(): Promise<void> {
  const store = await loadStore();
  if (store.hosts.length === 0) {
    logger.info('还没有配置任何主机，使用 `ssh-driver config add ...` 添加。');
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
  const cmd = program.command('config').description('Manage saved SSH host configs');

  cmd
    .command('add')
    .requiredOption('--hostId <id>', 'unique id for this host')
    .requiredOption('--host <host>', 'hostname or IP')
    .requiredOption('--username <user>', 'SSH user')
    .option('--port <port>', 'SSH port')
    .option('--password <pwd>', 'password (prefer --privateKey)')
    .option('--privateKey <path>', 'path to private key file')
    .option('--passphrase <pp>', 'passphrase for the private key')
    .option('--description <desc>', 'human readable description')
    .option('--readyTimeout <ms>', 'connection ready timeout in ms')
    .option('--tags <tags>', 'comma separated tags')
    .option('--test', 'test the connection after saving', false)
    .action(async (opts) => configAdd(opts));

  cmd
    .command('list')
    .alias('ls')
    .description('List saved hosts')
    .action(async () => configList());

  cmd
    .command('show <hostId>')
    .description('Show one host config (secrets masked)')
    .action(async (hostId: string) => configShow(hostId));

  cmd
    .command('update <hostId>')
    .description('Update fields on a saved host')
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
    .description('Remove a saved host')
    .action(async (hostId: string) => configRemove(hostId));

  cmd
    .command('test <hostId>')
    .description('Test SSH connectivity to a saved host')
    .action(async (hostId: string) => configTest(hostId));
}
