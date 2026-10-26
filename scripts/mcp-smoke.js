/**
 * MCP server 冒烟测试（手工脚本）
 *   node scripts/mcp-smoke.js
 * 会依次调用 list_hosts / exec_command / session_status / exec_script，
 * 并对比两次 exec 的耗时，验证「连接被缓存复用」。
 */

const { spawn } = require('child_process');
const path = require('path');

const CLI = path.resolve(__dirname, '..', 'dist', 'cli.js');
const HOST = process.argv[2] || '8500';

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

proc.stderr.on('data', d => process.stderr.write(`[stderr] ${d.toString()}`));

function send(method, params) {
  const id = nextId++;
  const msg = { jsonrpc: '2.0', id, method, params };
  return new Promise(resolve => {
    pending.set(id, resolve);
    proc.stdin.write(`${JSON.stringify(msg)}\n`);
  });
}

function notify(method, params) {
  proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
}

function callTool(name, args) {
  return send('tools/call', { name, arguments: args });
}

(async () => {
  const init = await send('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'smoke', version: '1.0.0' },
  });
  console.log('=== initialize ===');
  console.log(JSON.stringify(init.result?.serverInfo ?? init, null, 2));

  notify('notifications/initialized');

  const tools = await send('tools/list', {});
  console.log('\n=== tools ===');
  for (const t of tools.result?.tools ?? []) {
    console.log(` - ${t.name}: ${t.description}`);
  }

  const hosts = await callTool('list_hosts', {});
  console.log('\n=== list_hosts ===');
  console.log(hosts.result?.content?.[0]?.text);

  console.log('\n=== 第一次 exec_command（建立连接）===');
  const t1 = Date.now();
  const r1 = await callTool('exec_command', { hostId: HOST, command: 'echo mcp-exec-1 && hostname' });
  console.log(`耗时 ${Date.now() - t1}ms`);
  console.log(r1.result?.content?.[0]?.text);

  console.log('\n=== 第二次 exec_command（应复用连接）===');
  const t2 = Date.now();
  const r2 = await callTool('exec_command', { hostId: HOST, command: 'echo mcp-exec-2 && hostname' });
  console.log(`耗时 ${Date.now() - t2}ms`);
  console.log(r2.result?.content?.[0]?.text);

  console.log('\n=== exec_script ===');
  const r3 = await callTool('exec_script', {
    hostId: HOST,
    script: '#!/bin/bash\necho "脚本跑通了: $1"',
    args: ['ok'],
  });
  console.log(r3.result?.content?.[0]?.text);

  console.log('\n=== session_status ===');
  const r4 = await callTool('session_status', {});
  console.log(r4.result?.content?.[0]?.text);

  console.log('\n=== get_history ===');
  const r5 = await callTool('get_history', { limit: 3 });
  console.log(r5.result?.content?.[0]?.text);

  console.log('\n=== close_session ===');
  const r6 = await callTool('close_session', { hostId: HOST });
  console.log(r6.result?.content?.[0]?.text);

  proc.stdin.end();
  setTimeout(() => proc.kill(), 500);
})().catch(err => {
  console.error('smoke failed:', err);
  proc.kill();
  process.exit(1);
});
