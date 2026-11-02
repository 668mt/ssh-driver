/**
 * MCP 禁用主机 —— 冒烟测试（手工脚本）
 *   node scripts/mcp-disabled-smoke.js
 *
 * 验证：
 *   1. list_hosts 返回 disabled 标记
 *   2. set_host_disabled 能禁用 / 启用
 *   3. 禁用后 exec_command 被拒绝
 */

const { spawn } = require('child_process');
const path = require('path');

const CLI = path.resolve(__dirname, '..', 'dist', 'cli.js');
const HOST = process.argv[2] || 'mcp-smoke-host';

const proc = spawn(process.execPath, [CLI, 'mcp'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env },
});

let buffer = '';
const pending = new Map();
let nextId = 1;

proc.stdout.on('data', chunk => {
  buffer += chunk.toString('utf-8');
  let idx;
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});

function call(method, params) {
  const id = nextId++;
  return new Promise(resolve => {
    pending.set(id, resolve);
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}

function notify(method, params) {
  proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
}

function tool(name, args) {
  return call('tools/call', { name, arguments: args });
}

function text(msg) {
  const c = msg.result?.content?.[0]?.text ?? '';
  try {
    return JSON.parse(c);
  } catch {
    return c;
  }
}

(async () => {
  notify('notifications/initialized', {});

  await call('tools/list', {});

  // 1. 禁用
  const dis = await tool('set_host_disabled', { hostId: HOST, disabled: true });
  console.log('set_host_disabled(true) →', JSON.stringify(text(dis)));

  // 2. 列表里应带 disabled
  const list = await tool('list_hosts', {});
  const hosts = text(list).hosts ?? [];
  const found = hosts.find(h => h.hostId === HOST);
  console.log('list_hosts → disabled =', found?.disabled);

  // 3. 被禁用后 exec 必须失败
  const exec = await tool('exec_command', { hostId: HOST, command: 'echo hi' });
  console.log('exec_command → isError =', exec.result?.isError, '|', text(exec));

  // 4. 恢复
  const en = await tool('set_host_disabled', { hostId: HOST, disabled: false });
  console.log('set_host_disabled(false) →', JSON.stringify(text(en)));

  proc.kill();
  process.exit(0);
})().catch(err => {
  console.error(err);
  proc.kill();
  process.exit(1);
});
