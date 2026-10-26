/**
 * 审计日志 —— 单元测试
 * @Author Martin
 * @Date 2026/10/26
 */

import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { appendAudit, readAudit, redactSecrets } from '../src/audit/log';

let tmpDir: string;
let historyPath: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ssh-driver-audit-'));
  historyPath = path.join(tmpDir, 'history.log');
  process.env.SSH_DRIVER_HISTORY = historyPath;
});

afterEach(async () => {
  delete process.env.SSH_DRIVER_HISTORY;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('redactSecrets', () => {
  it('脱敏 --password=xxx', () => {
    expect(redactSecrets('mysql --password=hunter2 -u root')).toContain('--password=***');
    expect(redactSecrets('mysql --password=hunter2')).not.toContain('hunter2');
  });

  it('脱敏 mysql -pXXX', () => {
    const out = redactSecrets('mysql -uroot -phunter2 db');
    expect(out).not.toContain('hunter2');
    expect(out).toContain('-p***');
  });

  it('脱敏 sshpass -p xxx', () => {
    expect(redactSecrets('sshpass -p hunter2 ssh host')).not.toContain('hunter2');
  });

  it('脱敏 key=value 形态', () => {
    expect(redactSecrets('deploy password=hunter2')).not.toContain('hunter2');
    expect(redactSecrets('api_key=abcdef123')).not.toContain('abcdef123');
  });

  it('普通命令不受影响', () => {
    const cmd = 'docker ps -a && systemctl status nginx';
    expect(redactSecrets(cmd)).toBe(cmd);
  });

  it('docker 的 -p 端口映射不应该被误伤', () => {
    const cmd = 'docker run -p 8080:80 nginx';
    expect(redactSecrets(cmd)).toContain('8080:80');
  });
});

describe('appendAudit / readAudit', () => {
  it('写入后能读回来（最新的在前）', async () => {
    await appendAudit({
      ts: '2026-10-26T10:00:00.000Z',
      source: 'cli',
      action: 'exec',
      hostId: 'a',
      command: 'ls',
      code: 0,
      ok: true,
    });
    await appendAudit({
      ts: '2026-10-26T11:00:00.000Z',
      source: 'mcp',
      action: 'exec',
      hostId: 'b',
      command: 'pwd',
      code: 1,
      ok: false,
    });

    const { entries } = await readAudit();
    expect(entries).toHaveLength(2);
    expect(entries[0].hostId).toBe('b');
    expect(entries[1].hostId).toBe('a');
  });

  it('按主机过滤', async () => {
    await appendAudit({
      ts: '2026-10-26T10:00:00.000Z',
      source: 'cli',
      action: 'exec',
      hostId: 'a',
      ok: true,
    });
    await appendAudit({
      ts: '2026-10-26T10:01:00.000Z',
      source: 'cli',
      action: 'exec',
      hostId: 'b',
      ok: true,
    });

    const { entries } = await readAudit({ hostId: 'A' });
    expect(entries).toHaveLength(1);
    expect(entries[0].hostId).toBe('a');
  });

  it('只看失败的', async () => {
    await appendAudit({
      ts: '2026-10-26T10:00:00.000Z',
      source: 'cli',
      action: 'exec',
      hostId: 'a',
      ok: true,
    });
    await appendAudit({
      ts: '2026-10-26T10:01:00.000Z',
      source: 'cli',
      action: 'exec',
      hostId: 'b',
      ok: false,
      error: 'boom',
    });

    const { entries } = await readAudit({ failedOnly: true });
    expect(entries).toHaveLength(1);
    expect(entries[0].error).toBe('boom');
  });

  it('limit 生效，且 total 统计的是全部匹配条数', async () => {
    for (let i = 0; i < 10; i += 1) {
      await appendAudit({
        ts: `2026-10-26T10:0${i}:00.000Z`,
        source: 'cli',
        action: 'exec',
        hostId: 'a',
        ok: true,
      });
    }
    const { entries, total } = await readAudit({ limit: 3 });
    expect(entries).toHaveLength(3);
    expect(total).toBe(10);
  });

  it('limit = 0 表示不限条数', async () => {
    for (let i = 0; i < 5; i += 1) {
      await appendAudit({
        ts: `2026-10-26T10:0${i}:00.000Z`,
        source: 'cli',
        action: 'exec',
        hostId: 'a',
        ok: true,
      });
    }
    const { entries } = await readAudit({ limit: 0 });
    expect(entries).toHaveLength(5);
  });

  it('日志文件不存在时返回空数组', async () => {
    const res = await readAudit();
    expect(res.entries).toEqual([]);
    expect(res.total).toBe(0);
  });
});
