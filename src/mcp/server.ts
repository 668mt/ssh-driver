/**
 * MCP Server —— 把 ssh-driver 暴露成 MCP 工具
 *
 * 为什么要有：
 *   原来的接入方式是「AI 拼 shell 命令 → CLI」。这有几个问题：
 *   shell 转义地狱、每次调用都要重新启动 node 进程、错误信息只能靠
 *   解析 stderr。改成 MCP 之后：
 *     - 参数是结构化的，不用拼字符串
 *     - 进程常驻，连接可以缓存复用（见 ssh/pool.ts）
 *     - 错误以 isError 的形式结构化返回
 *
 * 启动方式：ssh-driver mcp
 * @Author Martin
 * @Date 2026/10/26
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as nodePath from 'path';
import { z } from 'zod';

import { appendAudit, readAudit, redactSecrets } from '../audit/log';
import { HostConfig } from '../config/schema';
import { findHost, loadStore } from '../config/store';
import { execOnSsh, execScriptOnSsh } from '../ssh/client';
import { globalPool, SshSessionPool } from '../ssh/pool';
import { listRemoteDir, readRemoteFile, RemoteFileExistsError, writeRemoteFile } from '../ssh/sftp';

/** MCP 工具里不允许出现明文凭据，列表接口一律脱敏 */
function maskHost(h: HostConfig): Record<string, unknown> {
  return {
    hostId: h.hostId,
    description: h.description,
    host: h.host,
    port: h.port ?? 22,
    username: h.username,
    tags: h.tags ?? [],
    auth: h.privateKey ? 'privateKey' : h.password ? 'password' : 'none',
    readyTimeout: h.readyTimeout ?? 15000,
    createdAt: h.createdAt,
    updatedAt: h.updatedAt,
  };
}

async function resolveHost(hostId: string): Promise<HostConfig> {
  const store = await loadStore();
  const host = findHost(store, hostId);
  if (!host) {
    const known = store.hosts.map(h => h.hostId).join(', ') || '（空）';
    throw new Error(`主机 '${hostId}' 不存在。已配置的主机：${known}`);
  }
  return host;
}

function ok(payload: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

function fail(message: string): {
  content: Array<{ type: 'text'; text: string }>;
  isError: true;
} {
  return { content: [{ type: 'text', text: message }], isError: true };
}

export interface McpOptions {
  /** 连接池；默认用全局池 */
  pool?: SshSessionPool;
}

export async function startMcpServer(opts: McpOptions = {}): Promise<{ close: () => Promise<void> }> {
  const pool = opts.pool ?? globalPool;
  const server = new McpServer({
    name: 'ssh-driver',
    version: '0.4.0',
  });

  /* ------------------------------ 主机 ------------------------------ */

  server.registerTool(
    'list_hosts',
    {
      title: '列出已配置的 SSH 主机',
      description:
        '返回所有已保存的 SSH 连接（凭据已脱敏，不会返回明文密码/私钥）。' +
        '返回的 hostId 用于后续所有操作。',
      inputSchema: {},
    },
    async () => {
      const store = await loadStore();
      const stats = pool.stats();
      return ok({
        hosts: store.hosts.map(maskHost),
        cachedSessions: stats.sessions.map(s => s.hostId),
      });
    },
  );

  server.registerTool(
    'test_host',
    {
      title: '测试 SSH 连通性',
      description: '连接指定主机并执行一条无害命令（uname -a），确认凭据与网络是否正常。',
      inputSchema: {
        hostId: z.string().describe('主机 id（先用 list_hosts 查）'),
      },
    },
    async ({ hostId }) => {
      const started = Date.now();
      try {
        const host = await resolveHost(hostId);
        const result = await pool.withSession(host, session =>
          execOnSsh(session.ssh, 'uname -a', { timeoutMs: 20000 }),
        );
        await appendAudit({
          ts: new Date().toISOString(),
          source: 'mcp',
          action: 'test',
          hostId: host.hostId,
          command: 'uname -a',
          code: result.code,
          durationMs: Date.now() - started,
          ok: true,
        });
        return ok({ hostId: host.hostId, ok: true, banner: result.stdout, code: result.code });
      } catch (err) {
        await appendAudit({
          ts: new Date().toISOString(),
          source: 'mcp',
          action: 'test',
          hostId,
          durationMs: Date.now() - started,
          ok: false,
          error: (err as Error).message,
        });
        return fail(`连接失败：${(err as Error).message}`);
      }
    },
  );

  /* ------------------------------ 执行 ------------------------------ */

  server.registerTool(
    'exec_command',
    {
      title: '在远程主机上执行命令',
      description:
        '在指定主机上执行一条 shell 命令并返回 stdout / stderr / exit code。' +
        '连接会被缓存复用，连续调用时无需重复握手。',
      inputSchema: {
        hostId: z.string().describe('主机 id'),
        command: z.string().describe('要执行的 shell 命令'),
        timeoutMs: z.number().optional().describe('超时（毫秒），默认 60000'),
        cwd: z.string().optional().describe('远端工作目录'),
      },
    },
    async ({ hostId, command, timeoutMs, cwd }) => {
      const started = Date.now();
      let host: HostConfig;
      try {
        host = await resolveHost(hostId);
      } catch (err) {
        return fail((err as Error).message);
      }
      try {
        const result = await pool.withSession(host, session =>
          execOnSsh(session.ssh, command, {
            timeoutMs: timeoutMs ?? 60000,
            cwd,
          }),
        );
        await appendAudit({
          ts: new Date().toISOString(),
          source: 'mcp',
          action: 'exec',
          hostId: host.hostId,
          command: redactSecrets(command),
          code: result.code,
          durationMs: Date.now() - started,
          ok: result.code === 0 || result.code === null,
        });
        return ok({
          hostId: host.hostId,
          stdout: result.stdout,
          stderr: result.stderr,
          code: result.code,
          durationMs: Date.now() - started,
        });
      } catch (err) {
        await appendAudit({
          ts: new Date().toISOString(),
          source: 'mcp',
          action: 'exec',
          hostId: host.hostId,
          command: redactSecrets(command),
          durationMs: Date.now() - started,
          ok: false,
          error: (err as Error).message,
        });
        return fail(`执行失败：${(err as Error).message}`);
      }
    },
  );

  server.registerTool(
    'exec_script',
    {
      title: '在远程主机上执行脚本',
      description:
        '把脚本内容通过 stdin 喂给远端解释器执行（不在远端留临时文件）。' +
        '解释器默认按 shebang 推断，没有 shebang 时用 bash。' +
        '也可以用 scriptPath 指定本机脚本文件。',
      inputSchema: {
        hostId: z.string().describe('主机 id'),
        script: z.string().optional().describe('脚本内容（与 scriptPath 二选一）'),
        scriptPath: z.string().optional().describe('本机脚本文件路径（与 script 二选一）'),
        interpreter: z.string().optional().describe('解释器，如 bash / python3；不给则按 shebang 推断'),
        args: z.array(z.string()).optional().describe('脚本位置参数 $1 $2 ...'),
        timeoutMs: z.number().optional().describe('超时（毫秒），默认 60000'),
        cwd: z.string().optional().describe('远端工作目录'),
      },
    },
    async ({ hostId, script, scriptPath, interpreter, args, timeoutMs, cwd }) => {
      const started = Date.now();
      let host: HostConfig;
      try {
        host = await resolveHost(hostId);
      } catch (err) {
        return fail((err as Error).message);
      }

      let content = script ?? '';
      let origin = 'inline';
      if (!script && scriptPath) {
        try {
          const { promises: fs } = await import('fs');
          content = await fs.readFile(scriptPath, 'utf-8');
          origin = scriptPath;
        } catch (err) {
          return fail(`读取脚本文件失败：${(err as Error).message}`);
        }
      }
      if (!content) {
        return fail('必须提供 script（脚本内容）或 scriptPath（本机脚本文件路径）');
      }

      try {
        const result = await pool.withSession(host, session =>
          execScriptOnSsh(session.ssh, content, {
            interpreter,
            args,
            timeoutMs: timeoutMs ?? 60000,
            cwd,
          }),
        );
        await appendAudit({
          ts: new Date().toISOString(),
          source: 'mcp',
          action: 'exec-script',
          hostId: host.hostId,
          script: origin === 'inline' ? `inline(${content.length} bytes)` : origin,
          args,
          code: result.code,
          durationMs: Date.now() - started,
          ok: result.code === 0 || result.code === null,
        });
        return ok({
          hostId: host.hostId,
          interpreter: result.interpreter,
          remoteCommand: result.remoteCommand,
          stdout: result.stdout,
          stderr: result.stderr,
          code: result.code,
          durationMs: Date.now() - started,
        });
      } catch (err) {
        await appendAudit({
          ts: new Date().toISOString(),
          source: 'mcp',
          action: 'exec-script',
          hostId: host.hostId,
          script: origin === 'inline' ? `inline(${content.length} bytes)` : origin,
          durationMs: Date.now() - started,
          ok: false,
          error: (err as Error).message,
        });
        return fail(`脚本执行失败：${(err as Error).message}`);
      }
    },
  );

  /* ---------------------------- 文件操作 ---------------------------- */

  server.registerTool(
    'list_files',
    {
      title: '列出远端目录',
      description: '通过 SFTP 列出远端目录内容（文件名、大小、是否目录、修改时间）。',
      inputSchema: {
        hostId: z.string().describe('主机 id'),
        path: z.string().describe('远端目录路径'),
      },
    },
    async ({ hostId, path }) => {
      try {
        const host = await resolveHost(hostId);
        const files = await pool.withSession(host, session => listRemoteDir(session.ssh, path));
        return ok({ hostId: host.hostId, path, files });
      } catch (err) {
        return fail(`列目录失败：${(err as Error).message}`);
      }
    },
  );

  server.registerTool(
    'read_file',
    {
      title: '读取远端文件',
      description:
        '通过 SFTP 读取远端文件内容。超过 maxBytes 会截断（默认 256KB）。' +
        '给 localPath 时把原始字节保存到本机文件，不返回内容。',
      inputSchema: {
        hostId: z.string().describe('主机 id'),
        path: z.string().describe('远端文件路径'),
        maxBytes: z.number().optional().describe('最大读取字节数，默认 262144'),
        localPath: z.string().optional().describe('保存到本机文件（可选）；给了就不返回内容'),
      },
    },
    async ({ hostId, path, maxBytes, localPath }) => {
      try {
        const host = await resolveHost(hostId);
        const file = await pool.withSession(host, session =>
          readRemoteFile(session.ssh, path, maxBytes ?? undefined),
        );
        await appendAudit({
          ts: new Date().toISOString(),
          source: 'mcp',
          action: 'download',
          hostId: host.hostId,
          script: path,
          ok: true,
        });

        if (localPath) {
          const { promises: fs } = await import('fs');
          const abs = nodePath.resolve(localPath);
          await fs.mkdir(nodePath.dirname(abs), { recursive: true });
          await fs.writeFile(abs, Buffer.from(file.base64, 'base64'));
          return ok({
            hostId: host.hostId,
            path,
            bytes: file.bytes,
            truncated: file.truncated,
            binary: file.binary,
            savedTo: abs,
          });
        }

        return ok({
          hostId: host.hostId,
          path,
          bytes: file.bytes,
          truncated: file.truncated,
          binary: file.binary,
          content: file.content,
          base64: file.base64,
        });
      } catch (err) {
        return fail(`读取文件失败：${(err as Error).message}`);
      }
    },
  );

  server.registerTool(
    'write_file',
    {
      title: '写入远端文件',
      description:
        '把内容写入远端文件（SFTP）。内容可以来自 content（文本）或 localPath（本机文件）。' +
        '**默认不覆盖**已存在的文件 —— 已存在时会报错，需要显式传 overwrite=true。',
      inputSchema: {
        hostId: z.string().describe('主机 id'),
        path: z.string().describe('远端文件路径'),
        content: z.string().optional().describe('要写入的文本内容（与 localPath 二选一）'),
        localPath: z.string().optional().describe('本机文件路径（与 content 二选一）'),
        overwrite: z.boolean().optional().describe('允许覆盖已存在的远端文件，默认 false'),
        mode: z.number().optional().describe('文件权限，如 420 表示 0644'),
        createDir: z.boolean().optional().describe('父目录不存在时自动创建，默认 false'),
      },
    },
    async ({ hostId, path, content, localPath, overwrite, mode, createDir }) => {
      let data: Buffer;
      let source: string;
      try {
        if (content !== undefined) {
          data = Buffer.from(content, 'utf-8');
          source = 'inline';
        } else if (localPath) {
          const { promises: fs } = await import('fs');
          const abs = nodePath.resolve(localPath);
          data = await fs.readFile(abs);
          source = abs;
        } else {
          return fail('必须提供 content（文本内容）或 localPath（本机文件路径）');
        }
      } catch (err) {
        return fail(`准备内容失败：${(err as Error).message}`);
      }

      const started = Date.now();
      let host: HostConfig;
      try {
        host = await resolveHost(hostId);
      } catch (err) {
        return fail((err as Error).message);
      }
      try {
        const result = await pool.withSession(host, session =>
          writeRemoteFile(session.ssh, path, data, {
            overwrite: overwrite === true,
            mode,
            createDir: createDir === true,
          }),
        );
        await appendAudit({
          ts: new Date().toISOString(),
          source: 'mcp',
          action: 'upload',
          hostId: host.hostId,
          script: `${source} → ${path}`,
          durationMs: Date.now() - started,
          ok: true,
        });
        return ok({
          hostId: host.hostId,
          path: result.path,
          bytes: result.bytes,
          overwritten: result.overwritten,
          mode: result.mode,
        });
      } catch (err) {
        await appendAudit({
          ts: new Date().toISOString(),
          source: 'mcp',
          action: 'upload',
          hostId: host.hostId,
          script: `${source} → ${path}`,
          durationMs: Date.now() - started,
          ok: false,
          error: (err as Error).message,
        });
        if (err instanceof RemoteFileExistsError) {
          return fail(`${err.message}（如果确实要覆盖，请传 overwrite=true）`);
        }
        return fail(`写入文件失败：${(err as Error).message}`);
      }
    },
  );

  /* -------------------------- 会话 / 审计 -------------------------- */

  server.registerTool(
    'session_status',
    {
      title: '查看连接缓存状态',
      description: '返回当前缓存的 SSH 连接（哪些主机已连上、闲置多久）。',
      inputSchema: {},
    },
    async () => ok(pool.stats()),
  );

  server.registerTool(
    'close_session',
    {
      title: '关闭缓存的 SSH 连接',
      description: '主动断开某台主机（或全部主机）的缓存连接，释放服务器端会话。',
      inputSchema: {
        hostId: z.string().optional().describe('主机 id；不给则关闭全部'),
      },
    },
    async ({ hostId }) => {
      if (hostId) {
        const closed = await pool.close(hostId);
        return ok({ hostId, closed });
      }
      await pool.closeAll();
      return ok({ closed: 'all' });
    },
  );

  server.registerTool(
    'get_history',
    {
      title: '查询操作审计日志',
      description:
        '返回最近的执行记录（时间、主机、命令、退出码、耗时）。' +
        '可用于回顾「Agent 到底在服务器上跑过什么」。',
      inputSchema: {
        limit: z.number().optional().describe('最多返回条数，默认 20'),
        hostId: z.string().optional().describe('只看某台主机'),
        failedOnly: z.boolean().optional().describe('只看失败的记录'),
      },
    },
    async ({ limit, hostId, failedOnly }) => {
      try {
        const { entries, total } = await readAudit({
          limit: limit ?? 20,
          hostId,
          failedOnly: failedOnly === true,
        });
        return ok({ count: entries.length, total, entries });
      } catch (err) {
        return fail(`读取审计日志失败：${(err as Error).message}`);
      }
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);

  return {
    close: async (): Promise<void> => {
      await pool.closeAll();
      await server.close();
    },
  };
}
