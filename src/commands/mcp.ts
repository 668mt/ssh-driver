/**
 * mcp 命令 —— 以 MCP (stdio) 模式启动 ssh-driver
 *
 * ⚠️ stdio 传输下 **stdout 是协议通道**，任何往 stdout 写的日志都会
 * 破坏 MCP 消息。所以这里只用 stderr 输出。
 *
 *   ssh-driver mcp
 *
 * 在 MCP 客户端里这样配：
 *   {
 *     "mcpServers": {
 *       "ssh-driver": { "command": "ssh-driver", "args": ["mcp"] }
 *     }
 *   }
 * @Author Martin
 * @Date 2026/10/26
 */

import { startMcpServer } from '../mcp/server';

export async function runMcp(): Promise<void> {
  // 注意：只写 stderr
  process.stderr.write('[ssh-driver] MCP server starting on stdio...\n');

  const server = await startMcpServer();

  const shutdown = async (): Promise<void> => {
    process.stderr.write('[ssh-driver] MCP server shutting down...\n');
    try {
      await server.close();
    } catch {
      /* 忽略关闭错误 */
    }
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}
