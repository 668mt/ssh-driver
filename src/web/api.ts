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
  hostHash?: string;
  readyTimeout?: number;
  tags?: string[] | string;
  createdAt?: string;
  updatedAt?: string;
}

export type TestResult =
  | { ok: true; banner?: string }
  | { ok: false; error: string };

export interface ExecResultDto {
  stdout: string;
  stderr: string;
  code: number | null;
  interpreter?: string;
}

export interface AuditEntryDto {
  ts: string;
  source: string;
  action: string;
  hostId: string;
  command?: string;
  script?: string;
  code?: number | null;
  durationMs?: number;
  ok: boolean;
  error?: string;
}

/**
 * 读取访问令牌。
 *
 * 生产模式下服务端把令牌注入到了 HTML 的 meta 标签里；
 * dev 模式下由 vite 代理统一加请求头，前端拿不到令牌也无所谓。
 */
function getToken(): string {
  if (typeof document === 'undefined') return '';
  const meta = document.querySelector('meta[name="ssh-driver-token"]');
  return meta?.getAttribute('content') ?? '';
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers['X-Ssh-Driver-Token'] = token;

  const init: RequestInit = { method, headers };
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

const enc = encodeURIComponent;

export const api = {
  health: () =>
    request<{ ok: boolean; configPath: string; sessions?: { count: number } }>('GET', '/api/health'),
  listHosts: () => request<HostConfigDto[]>('GET', '/api/hosts'),
  getHost: (hostId: string) => request<HostConfigDto>('GET', `/api/hosts/${enc(hostId)}`),
  createHost: (host: HostConfigDto) => request<{ created: boolean }>('POST', '/api/hosts', host),
  updateHost: (hostId: string, patch: Partial<HostConfigDto>) =>
    request<{ updated: boolean }>('PUT', `/api/hosts/${enc(hostId)}`, patch),
  removeHost: (hostId: string) => request<{ removed: boolean }>('DELETE', `/api/hosts/${enc(hostId)}`),
  testHost: (hostId: string, candidate?: HostConfigDto) =>
    request<TestResult>('POST', `/api/hosts/${enc(hostId)}/test`, candidate ?? {}),

  /** 在远端执行一条命令 */
  execCommand: (hostId: string, command: string, opts: { timeoutMs?: number; cwd?: string } = {}) =>
    request<ExecResultDto>('POST', `/api/hosts/${enc(hostId)}/exec`, { command, ...opts }),
  /** 在远端执行脚本内容 */
  execScript: (
    hostId: string,
    script: string,
    opts: { interpreter?: string; args?: string[]; timeoutMs?: number; cwd?: string } = {},
  ) => request<ExecResultDto>('POST', `/api/hosts/${enc(hostId)}/exec`, { script, ...opts }),

  exportConfig: () => request<unknown>('GET', '/api/io/export'),
  importConfig: (hosts: HostConfigDto[], mode: 'replace' | 'merge') =>
    request<{ imported: number; total: number; mode: 'replace' | 'merge' }>('POST', '/api/io/import', { hosts, mode }),

  /** 操作审计日志 */
  history: (limit = 50, hostId?: string) =>
    request<{ count: number; total: number; file: string; entries: AuditEntryDto[] }>(
      'GET',
      `/api/history?limit=${limit}${hostId ? `&hostId=${enc(hostId)}` : ''}`,
    ),
};
