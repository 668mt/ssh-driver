/**
 * 读取/写入 ~/.ssh-driver/config.json
 * @Author Martin
 * @Date 2026/10/19
 */

import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

import { HostConfig, StoreFile, STORE_VERSION } from './schema';
import { mergeHostConfig } from './merge';

/**
 * 配置文件所在目录。
 *
 * 用函数而不是常量，是为了支持 `SSH_DRIVER_CONFIG` 运行时覆盖 ——
 * 测试、多 profile（prod / staging 各一份）都需要。
 */
export function getStoreDir(): string {
  const custom = (process.env.SSH_DRIVER_CONFIG ?? '').trim();
  if (custom) return path.dirname(path.resolve(custom));
  return path.join(os.homedir(), '.ssh-driver');
}

/** 配置文件完整路径 */
export function getStoreFile(): string {
  const custom = (process.env.SSH_DRIVER_CONFIG ?? '').trim();
  if (custom) return path.resolve(custom);
  return path.join(getStoreDir(), 'config.json');
}

function emptyStore(): StoreFile {
  return { version: STORE_VERSION, hosts: [] };
}

/**
 * 合并两个对象，**跳过值为 undefined 的字段**。
 *
 * 主机配置的合并请用 `mergeHostConfig`（config/merge.ts）—— 它还额外
 * 处理了 `'***'` 掩码占位符和空串清空的语义。
 */
export function mergeDefined<T extends object>(base: T, patch: Partial<T>): T {
  const out = { ...base } as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) out[key] = value;
  }
  return out as T;
}

/**
 * 读取整个 store；不存在则返回空。
 * 读取后顺便把权限收紧到 0o600（Windows 上尽量做）。
 *
 * 文件损坏时不把工具彻底砖死：把坏文件备份成 config.json.corrupt-<时间戳>，
 * 然后以空 store 继续，让用户还能从控制台重新配置。
 */
export async function loadStore(): Promise<StoreFile> {
  const file = getStoreFile();
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf-8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return emptyStore();
    throw err;
  }

  try {
    const parsed = JSON.parse(raw) as StoreFile;
    if (!parsed || parsed.version !== STORE_VERSION || !Array.isArray(parsed.hosts)) {
      throw new Error('store schema 不匹配（version / hosts）');
    }
    // best-effort: 收紧权限（Windows 下 fs.chmod 是 no-op）
    fs.chmod(file, 0o600).catch(() => undefined);
    return parsed;
  } catch (err) {
    const backup = `${file}.corrupt-${Date.now()}`;
    await fs.rename(file, backup).catch(() => undefined);
    throw new Error(
      `配置文件损坏，已备份到 ${backup}。` +
      `请检查该文件内容后重新配置。原因：${(err as Error).message}`,
    );
  }
}

/** 原子写入整个 store：写临时文件 → fsync → 覆盖前留一份 .bak → rename。 */
export async function saveStore(store: StoreFile): Promise<void> {
  const dir = getStoreDir();
  const file = getStoreFile();
  await fs.mkdir(dir, { recursive: true });

  const tmp = `${file}.tmp`;
  const data = JSON.stringify(store, null, 2);
  const fh = await fs.open(tmp, 'w', 0o600);
  try {
    await fh.writeFile(data, 'utf-8');
    await fh.sync();
  } finally {
    await fh.close();
  }
  await fs.chmod(tmp, 0o600).catch(() => undefined);

  // 覆盖前留一份上一版，出问题可以手工回滚
  await fs.copyFile(file, `${file}.bak`).catch(() => undefined);
  await fs.rename(tmp, file);
  await fs.chmod(file, 0o600).catch(() => undefined);
}

/** hostId 不区分大小写查重。 */
export function findHost(store: StoreFile, hostId: string): HostConfig | undefined {
  const want = hostId.toLowerCase();
  return store.hosts.find(h => h.hostId.toLowerCase() === want);
}

const LOCK_TIMEOUT_MS = 8000;
const LOCK_STALE_MS = 30000;

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 跨进程文件锁。
 *
 * 没有它的话，CLI / MCP / 控制台同时写配置时会出现
 * 「读 → 改 → 写」的竞态，后写的覆盖先写的，凭据可能凭空消失。
 */
async function acquireLock(lockPath: string): Promise<() => Promise<void>> {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      const fh = await fs.open(lockPath, 'wx');
      await fh.writeFile(String(process.pid), 'utf-8');
      await fh.close();
      return async () => {
        await fs.unlink(lockPath).catch(() => undefined);
      };
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      // 进程崩溃会留下孤儿锁，超过阈值就当成陈旧锁清掉
      try {
        const st = await fs.stat(lockPath);
        if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
          await fs.unlink(lockPath).catch(() => undefined);
          continue;
        }
      } catch {
        /* 锁刚好被别人释放了，重试即可 */
      }
      if (Date.now() > deadline) {
        throw new Error('获取配置锁超时，可能有另一个 ssh-driver 进程正在写配置，请稍后重试。');
      }
      await delay(30 + Math.floor(Math.random() * 60));
    }
  }
}

/** 在锁保护下执行一段「读 → 改 → 写」的事务。 */
export async function withStoreLock<T>(fn: () => Promise<T>): Promise<T> {
  const dir = getStoreDir();
  await fs.mkdir(dir, { recursive: true });
  const release = await acquireLock(path.join(dir, 'config.lock'));
  try {
    return await fn();
  } finally {
    await release();
  }
}

/**
 * 在锁保护下「读 → 改 → 写」整个 store。
 *
 * 为什么要它：`upsertHost` / `replaceHost` / `deleteHost` 各自带锁，
 * 但调用方常常需要「先读出来算一算，再写回去」——
 * 如果读在锁外、写在锁内，中间就被别的进程插进来了（丢更新）。
 * 这个函数把整个过程收进同一把锁。
 *
 * @param mutator 拿到当前 store（可原地修改），返回给调用方的结果。
 *   抛异常 → 不写盘，锁自动释放。
 */
export async function mutateStore<T>(mutator: (store: StoreFile) => T | Promise<T>): Promise<T> {
  return withStoreLock(async () => {
    const store = await loadStore();
    const result = await mutator(store);
    await saveStore(store);
    return result;
  });
}

/**
 * 新增 / 更新一台主机。
 *
 * 合并语义：**只有显式提供的字段才会覆盖**（见 mergeHostConfig），
 * 所以 `config add` 重复执行不会把已保存的密码 / 私钥抹掉。
 */
export async function upsertHost(
  host: Partial<HostConfig> & { hostId: string },
): Promise<{ created: boolean }> {
  return withStoreLock(async () => {
    const store = await loadStore();
    const idx = store.hosts.findIndex(h => h.hostId.toLowerCase() === host.hostId.toLowerCase());
    const now = new Date().toISOString();
    if (idx >= 0) {
      const merged = mergeHostConfig(store.hosts[idx], host);
      merged.createdAt = store.hosts[idx].createdAt ?? now;
      merged.updatedAt = now;
      store.hosts[idx] = merged;
      await saveStore(store);
      return { created: false };
    }
    const created = mergeHostConfig(undefined, host);
    created.createdAt = now;
    created.updatedAt = now;
    store.hosts.push(created);
    await saveStore(store);
    return { created: true };
  });
}

/**
 * 原地替换一台主机（支持改 hostId）。
 *
 * 必须在**同一个锁**里完成「删旧 + 写新」，否则中途崩溃会留下
 * 「旧记录已删、新记录没写」的空洞。
 */
export async function replaceHost(oldHostId: string, next: HostConfig): Promise<void> {
  await withStoreLock(async () => {
    const store = await loadStore();
    const idx = store.hosts.findIndex(h => h.hostId.toLowerCase() === oldHostId.toLowerCase());
    if (idx < 0) throw new Error(`主机 '${oldHostId}' 不存在`);
    const merged = mergeHostConfig(store.hosts[idx], next);
    merged.hostId = next.hostId;
    merged.createdAt = store.hosts[idx].createdAt ?? merged.createdAt;
    merged.updatedAt = new Date().toISOString();
    store.hosts[idx] = merged;
    await saveStore(store);
  });
}

export async function deleteHost(hostId: string): Promise<boolean> {
  return withStoreLock(async () => {
    const store = await loadStore();
    const before = store.hosts.length;
    store.hosts = store.hosts.filter(h => h.hostId.toLowerCase() !== hostId.toLowerCase());
    if (store.hosts.length === before) return false;
    await saveStore(store);
    return true;
  });
}
