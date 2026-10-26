/**
 * MCP read_file / write_file 冒烟测试
 *   node scripts/mcp-file-smoke.js <hostId>
 */

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

const hostId = process.argv[2] || '8500';
const REMOTE = '/tmp/ssh-driver-mcp-file.txt';

/** 进度输出走 stderr —— stdout 可能被管道缓冲，进程被 kill 时会丢 */
const log = (...a) => process.stderr.write(a.map(String).join(' ') + '\n');

(async () => {
  const client = new Client({ name: 'file-smoke', version: '1.0.0' });
  await client.connect(new StdioClientTransport({ command: 'ssh-driver', args: ['mcp'] }));
  log('connected');

  const call = async (name, args) => {
    log(`→ ${name} ...`);
    const res = await Promise.race([
      client.callTool({ name, arguments: args }),
      new Promise((_, rej) => setTimeout(() => rej(new Error(`${name} 调用超时(30s)`)), 30000)),
    ]);
    const text = res.content[0].text;
    log(`← ${name}: ${String(text).slice(0, 200)}`);
    return { isError: res.isError === true, text };
  };

  log('\n=== 1. 写新文件（content）===');
  await call('write_file', { hostId, path: REMOTE, content: 'mcp write v1' });

  log('\n=== 2. 写已存在文件（不带 overwrite，应报错）===');
  await call('write_file', { hostId, path: REMOTE, content: 'should fail' });

  log('\n=== 3. 带 overwrite=true（应成功）===');
  await call('write_file', { hostId, path: REMOTE, content: 'mcp write v2', overwrite: true });

  log('\n=== 4. 读回 ===');
  await call('read_file', { hostId, path: REMOTE });

  log('\n=== 5. list_files /tmp ===');
  const ls = await call('list_files', { hostId, path: '/tmp' });

  log('\n=== 6. 关闭 ===');
  await client.close();
  log('closed');
  process.exit(0);
})().catch(err => {
  log('❌ 失败：' + err.message);
  process.exit(1);
});
