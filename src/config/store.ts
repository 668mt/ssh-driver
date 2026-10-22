/**
 * 读取/写入 ~/.ssh-driver/config.json
 * @Author Martin
 * @Date 2026/10/19
 */

import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

import { HostConfig, StoreFile, STORE_VERSION } from './schema';

export const STORE_DIR = path.join(os.homedir(), '.ssh-driver');
export const STORE_FILE = path.join(STORE_DIR, 'config.json');

function emptyStore(): StoreFile {
  return { version: STORE_VERSION, hosts: [] };
}

/** 读取整个 store；不存在则返回空。读取后顺便把权限收紧到 0o600（Windows 上尽量做）。 */
export async function loadStore(): Promise<StoreFile> {
  try {
    const raw = await fs.readFile(STORE_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as StoreFile;
    if (!parsed || parsed.version !== STORE_VERSION || !Array.isArray(parsed.hosts)) {
      throw new Error(`invalid store schema at ${STORE_FILE}`);
    }
    // best-effort: 收紧权限（Windows 下 fs.chmod 是 no-op）
    fs.chmod(STORE_FILE, 0o600).catch(() => undefined);
    return parsed;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return emptyStore();
    }
    throw err;
  }
}

/** 原子写入整个 store。 */
export async function saveStore(store: StoreFile): Promise<void> {
  await fs.mkdir(STORE_DIR, { recursive: true });
  const tmp = STORE_FILE + '.tmp';
  const data = JSON.stringify(store, null, 2);
  await fs.writeFile(tmp, data, { encoding: 'utf-8', mode: 0o600 });
  await fs.rename(tmp, STORE_FILE);
}

/** hostId 不区分大小写查重。 */
export function findHost(store: StoreFile, hostId: string): HostConfig | undefined {
  const want = hostId.toLowerCase();
  return store.hosts.find(h => h.hostId.toLowerCase() === want);
}

export async function upsertHost(host: HostConfig): Promise<{ created: boolean }> {
  const store = await loadStore();
  const idx = store.hosts.findIndex(h => h.hostId.toLowerCase() === host.hostId.toLowerCase());
  const now = new Date().toISOString();
  if (idx >= 0) {
    store.hosts[idx] = { ...store.hosts[idx], ...host, updatedAt: now };
    await saveStore(store);
    return { created: false };
  }
  store.hosts.push({ ...host, createdAt: now, updatedAt: now });
  await saveStore(store);
  return { created: true };
}

export async function deleteHost(hostId: string): Promise<boolean> {
  const store = await loadStore();
  const before = store.hosts.length;
  store.hosts = store.hosts.filter(h => h.hostId.toLowerCase() !== hostId.toLowerCase());
  if (store.hosts.length === before) return false;
  await saveStore(store);
  return true;
}
