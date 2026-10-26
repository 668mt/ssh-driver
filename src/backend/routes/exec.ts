/**
 * /api/hosts/:hostId/exec —— 在远程主机上执行命令 / 脚本
 *
 * 与 CLI 的 `exec` 走同一套逻辑，但复用控制台进程里的连接池 ——
 * 连续执行多条命令时不会反复握手。
 * @Author Martin
 * @Date 2026/10/26
 */

import { Router, Request, Response } from 'express';

import { appendAudit, redactSecrets } from '../../audit/log';
import { findHost, loadStore } from '../../config/store';
import { execOnSsh, execScriptOnSsh } from '../../ssh/client';
import { globalPool } from '../../ssh/pool';

export const execRouter = Router();

interface ExecBody {
  /** 要执行的命令（与 script 二选一） */
  command?: string;
  /** 脚本内容（与 command 二选一） */
  script?: string;
  /** 脚本解释器；不给则按 shebang 推断 */
  interpreter?: string;
  /** 脚本位置参数 */
  args?: string[];
  /** 超时（毫秒） */
  timeoutMs?: number;
  /** 远端工作目录 */
  cwd?: string;
}

const MAX_TIMEOUT_MS = 30 * 60 * 1000;

execRouter.post('/:hostId/exec', async (req: Request, res: Response) => {
  const hostId = String(req.params.hostId);
  const body = (req.body ?? {}) as ExecBody;

  const store = await loadStore();
  const host = findHost(store, hostId);
  if (!host) {
    return res.status(404).json({ error: `主机 '${hostId}' 不存在` });
  }

  const hasCommand = typeof body.command === 'string' && body.command.trim() !== '';
  const hasScript = typeof body.script === 'string' && body.script !== '';
  if (!hasCommand && !hasScript) {
    return res.status(400).json({ error: 'command 与 script 至少要提供一个' });
  }

  const timeoutMs =
    typeof body.timeoutMs === 'number' && body.timeoutMs > 0
      ? Math.min(body.timeoutMs, MAX_TIMEOUT_MS)
      : undefined;
  const started = Date.now();

  try {
    if (hasScript) {
      const scriptContent = body.script as string;
      const result = await globalPool.withSession(host, session =>
        execScriptOnSsh(session.ssh, scriptContent, {
          interpreter: body.interpreter,
          args: body.args,
          timeoutMs,
          cwd: body.cwd,
        }),
      );
      await appendAudit({
        ts: new Date().toISOString(),
        source: 'api',
        action: 'exec-script',
        hostId: host.hostId,
        script: `inline(${scriptContent.length} bytes)`,
        args: body.args,
        code: result.code,
        durationMs: Date.now() - started,
        ok: result.code === 0 || result.code === null,
      });
      return res.json({
        stdout: result.stdout,
        stderr: result.stderr,
        code: result.code,
        interpreter: result.interpreter,
      });
    }

    const command = body.command as string;
    const result = await globalPool.withSession(host, session =>
      execOnSsh(session.ssh, command, { timeoutMs, cwd: body.cwd }),
    );
    await appendAudit({
      ts: new Date().toISOString(),
      source: 'api',
      action: 'exec',
      hostId: host.hostId,
      command: redactSecrets(command),
      code: result.code,
      durationMs: Date.now() - started,
      ok: result.code === 0 || result.code === null,
    });
    return res.json({ stdout: result.stdout, stderr: result.stderr, code: result.code });
  } catch (err) {
    await appendAudit({
      ts: new Date().toISOString(),
      source: 'api',
      action: hasScript ? 'exec-script' : 'exec',
      hostId: host.hostId,
      command: hasCommand ? redactSecrets(body.command as string) : undefined,
      script: hasScript ? `inline(${(body.script as string).length} bytes)` : undefined,
      durationMs: Date.now() - started,
      ok: false,
      error: (err as Error).message,
    });
    return res.status(500).json({ error: (err as Error).message });
  }
});
