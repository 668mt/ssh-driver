/**
 * 浏览器端 fetch 封装
 * @Author Martin
 * @Date 2026/10/19
 */

export interface HostConfigDto {
  hostId: string;
  description?: string;
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  readyTimeout?: number;
  tags?: string[] | string;
  createdAt?: string;
  updatedAt?: string;
}

export type TestResult =
  | { ok: true; banner?: string }
  | { ok: false; error: string };

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(url, init);
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = (data && data.error) || `${method} ${url} failed: HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

export const api = {
  health: () => request<{ ok: boolean; configPath: string }>('GET', '/api/health'),
  listHosts: () => request<HostConfigDto[]>('GET', '/api/hosts'),
  getHost: (hostId: string) => request<HostConfigDto>('GET', `/api/hosts/${encodeURIComponent(hostId)}`),
  createHost: (host: HostConfigDto) => request<{ created: boolean }>('POST', '/api/hosts', host),
  updateHost: (hostId: string, patch: Partial<HostConfigDto>) =>
    request<{ updated: boolean }>('PUT', `/api/hosts/${encodeURIComponent(hostId)}`, patch),
  removeHost: (hostId: string) => request<{ removed: boolean }>('DELETE', `/api/hosts/${encodeURIComponent(hostId)}`),
  testHost: (hostId: string, candidate?: HostConfigDto) =>
    request<TestResult>('POST', `/api/hosts/${encodeURIComponent(hostId)}/test`, candidate ?? {}),

  exportConfig: () => request<unknown>('GET', '/api/io/export'),
  importConfig: (hosts: HostConfigDto[], mode: 'replace' | 'merge') =>
    request<{ imported: number; total: number; mode: 'replace' | 'merge' }>('POST', '/api/io/import', { hosts, mode }),
};
