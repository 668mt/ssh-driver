/**
 * 用 MCP SDK 的 StdioClientTransport 连一次 ssh-driver mcp，验证「配置后能不能真的连上」
 *   node scripts/mcp-client-check.js [命令路径]
 */

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

const command = process.argv[2] || 'ssh-driver';

(async () => {
  const transport = new StdioClientTransport({
    command,
    args: ['mcp'],
    stderr: 'pipe',
  });

  const client = new Client({ name: 'check', version: '1.0.0' });
  await client.connect(transport);

  const { tools } = await client.listTools();
  console.log(`✅ 连接成功（${command} mcp），共 ${tools.length} 个工具：`);
  for (const t of tools) console.log(`   - ${t.name}`);

  const res = await client.callTool({ name: 'list_hosts', arguments: {} });
  console.log('\nlist_hosts →', res.content[0].text.slice(0, 200));

  await client.close();
  process.exit(0);
})().catch(err => {
  console.error('❌ 连接失败：', err.message);
  process.exit(1);
});
