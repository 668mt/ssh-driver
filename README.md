<div align="center">

# ssh-driver

**让 AI Agent 安全地连接远程服务器并执行命令**

[![npm](https://img.shields.io/npm/v/ssh-driver.svg)](https://www.npmjs.com/package/ssh-driver)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D18-green.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6.svg)](https://www.typescriptlang.org)

一个轻量的 SSH 连接管理 CLI，附带本地网页控制台、**MCP Server** 和一段可被 AI 直接消费的 Skill。

[快速开始](#快速开始) · [命令一览](#命令一览) · [MCP Server](#mcp-server) · [网页控制台](#网页控制台) · [审计日志](#审计日志) · [安全说明](#安全说明)

</div>

---

## 这是什么

把 SSH 连接信息集中管理在一处，让命令行、AI Agent（CLI / Skill / MCP）都能安全地连接远程服务器执行命令。

```
┌──────────────┐     ┌──────────────────┐     ┌─────────────┐
│  你 / AI     │────▶│   ssh-driver     │────▶│  远程服务器  │
│  CLI/Skill/  │     │  config / exec   │     │             │
│  MCP Client  │     │  mcp / console   │     │             │
└──────────────┘     └──────────────────┘     └─────────────┘
                             │
                             ▼
                    ~/.ssh-driver/config.json
                    ~/.ssh-driver/history.log
                    ~/.agents/skills/ssh-driver/
```

## 特性

| 能力 | 说明 |
| --- | --- |
| **AI 原生** | 内置 `SKILL.md`，AI Agent 读完就知道怎么用；`ssh-driver install` 一键安装 |
| **MCP Server** | `ssh-driver mcp` 直接暴露 10 个 MCP 工具给任意 MCP 客户端 |
| **连接复用** | MCP / 控制台进程内缓存 SSH 连接，连续操作不重复握手（实测快 8 倍） |
| **连接管理** | 主机以 `hostId` 为唯一标识保存，支持增删改查、改名、标签分组 |
| **远程执行** | 单条命令执行，返回 stdout / stderr / exit code，支持 JSON 输出 |
| **脚本执行** | `--script` 把本地脚本喂给远端解释器执行，不在远端留临时文件 |
| **审计日志** | 每次远程操作都留痕（谁、何时、跑了什么、结果如何），命令自动脱敏 |
| **网页控制台** | Vite + React 界面，中文、浅色主题，可视化编辑、执行与导入导出 |
| **连通性测试** | 密码 / 私钥双模式，配置前就能验证是否可达 |
| **导入导出** | 整份配置 JSON 导入导出，`replace` / `merge` 两种策略，**不丢凭据** |

## 快速开始

### 环境要求

- Node.js >= 18
- 一个能 SSH 登录的服务器（密码或私钥）

### 安装

```bash
# 从源码
git clone https://github.com/668mt/ssh-driver.git
cd ssh-driver
npm install
npm run build
npm link

# 或直接从 npm
npm install -g ssh-driver
```

### 安装 AI Skill

```bash
ssh-driver install
```

这会把 `SKILL.md` 复制到 `~/.agents/skills/ssh-driver/`，AI Agent 之后就能自动发现并使用本工具。

### 配置一台主机

```bash
# 用私钥（推荐）
ssh-driver config add \
  --hostId prod-web-01 \
  --host 10.0.1.10 \
  --username deploy \
  --privateKey ~/.ssh/id_ed25519 \
  --description "生产 web-01" \
  --tags prod,web \
  --test

# 用密码
ssh-driver config add \
  --hostId dev-server \
  --host 192.168.1.50 \
  --username root \
  --password 'your-password'
```

> `config add` 重复执行**不会**覆盖已保存的密码 / 私钥 —— 没传的字段一律保留原值。

也可以直接打开网页控制台配置：

```bash
ssh-driver console
```

浏览器会自动打开，在界面里填表、点「测试」验证连通性、再保存。

### 开始使用

```bash
# 查看已配置的主机
ssh-driver config list

# 测试连通性
ssh-driver connect prod-web-01

# 执行命令
ssh-driver exec prod-web-01 "uptime"
ssh-driver exec prod-web-01 "df -h" --json

# 执行本地脚本（通过 stdin 喂给远端解释器）
ssh-driver exec prod-web-01 --script ./deploy.sh --arg production

# 看 AI 到底在服务器上跑过什么
ssh-driver history --limit 20
```

## 命令一览

```text
ssh-driver install [--with-web] [--no-force] [--target <dir>]
ssh-driver config add --hostId <id> --host <host> --username <user> [...]
ssh-driver config list [--json] | show | update | remove | test
ssh-driver connect <hostId>
ssh-driver exec <hostId> "<cmd>" [--json] [--timeout <ms>]
ssh-driver exec <hostId> --script <file> [--arg <v>]... [--interpreter <cmd>]
ssh-driver history [--limit <n>] [--host <id>] [--failed] [--json]
ssh-driver console [--port <n>] [--host <addr>] [--dev] [--no-open] [--token <t>]
ssh-driver mcp
```

### `config add` 支持的字段

| 字段 | 必填 | 说明 |
| --- | :---: | --- |
| `--hostId` | ✅ | 唯一标识，用于命令行引用 |
| `--host` | ✅ | 主机名或 IP |
| `--username` | ✅ | SSH 用户名 |
| `--port` | | SSH 端口，默认 `22` |
| `--privateKey` | | 私钥文件路径（**推荐**） |
| `--password` | | 密码登录（与私钥二选一） |
| `--passphrase` | | 私钥口令 |
| `--hostHash` | | 主机密钥指纹，配置后强制校验 |
| `--description` | | 人类可读描述 |
| `--tags` | | 逗号分隔的标签 |
| `--readyTimeout` | | 连接超时毫秒，默认 `15000` |
| `--test` | | 保存后立即测试连通性 |

### `exec` 的输出模式

默认直接输出命令的 stdout：

```bash
$ ssh-driver exec prod-web-01 "docker ps"
CONTAINER ID   IMAGE   ...
```

`--json` 适合被程序（尤其是 AI）消费：

```bash
$ ssh-driver exec prod-web-01 "df -h" --json
{"stdout":"Filesystem ...","stderr":"","code":0}
```

进程退出码会透传远端命令的退出码，便于 shell 链式调用：

```bash
ssh-driver exec prod-web-01 "test -f /etc/passwd" && echo "存在"
```

### 脚本执行

```bash
# 本地脚本 → 远端执行
ssh-driver exec prod-web-01 --script ./deploy.sh

# 带参数（$1 $2 ...）
ssh-driver exec prod-web-01 --script ./deploy.sh --arg v2 --arg --force

# 从标准输入读
cat deploy.sh | ssh-driver exec prod-web-01 --script -

# 手动指定解释器（默认按 shebang 推断，没有则用 bash）
ssh-driver exec prod-web-01 --script ./deploy.py --interpreter python3
```

实现方式是把脚本内容通过 **stdin** 喂给远端解释器：

- bash 家族 → `bash -s <args>`
- python3 / perl / ruby → `python3 - <args>`（`-` 表示程序从 stdin 读）

好处是**不在远端留临时文件**，也不依赖远端有可写目录或装了 sftp-server。

## MCP Server

`ssh-driver mcp` 以 MCP (stdio) 协议启动，任何支持 MCP 的客户端（OpenCode / Claude Desktop / Codex …）都能直接调用。

```jsonc
{
  "mcpServers": {
    "ssh-driver": {
      "command": "ssh-driver",
      "args": ["mcp"]
    }
  }
}
```

### 工具清单

| 工具 | 说明 |
| --- | --- |
| `list_hosts` | 列出已保存的主机（凭据脱敏） |
| `test_host` | 测试连通性 |
| `exec_command` | 在远端执行一条命令 |
| `exec_script` | 执行脚本（内容或本机文件路径），可传参数 |
| `list_files` | SFTP 列出远端目录 |
| `read_file` | SFTP 读取远端文件（>256KB 截断） |
| `write_file` | SFTP 写入远端文件 |
| `session_status` | 查看当前缓存了哪些 SSH 连接 |
| `close_session` | 主动断开缓存的连接 |
| `get_history` | 查询操作审计日志 |

### 连接会话缓存

MCP server 是常驻进程，**SSH 连接会被缓存复用**，连续执行多条命令不需要重复握手：

```
第一次 exec_command   → 431ms   （建立连接 + 执行）
第二次 exec_command   →  54ms   （复用连接）      快 8 倍
```

缓存策略：

- 空闲 5 分钟自动断开
- 远端把连接掐断（sshd idle 超时）时，下一条命令自动重连并重试一次
- 最多同时缓存 8 条连接，超出时淘汰最久未使用的
- `close_session` 可主动释放

## 网页控制台

```bash
ssh-driver console                  # 默认 http://127.0.0.1:7843
ssh-driver console --port 9000      # 换端口
ssh-driver console --dev            # 开发模式（vite HMR）
```

### 功能

- **主机列表** — 按 hostId / 主机 / 用户 / 标签 过滤，测试、编辑、删除
- **主机编辑** — 表单内直接测试连通性，hostId 支持修改（重命名）
- **远程执行** — 选主机 → 跑命令或脚本 → 看输出与退出码 → 下方是最近执行记录
- **导入导出** — 下载 `ssh-driver-config.json`，或粘贴 JSON 导入（`replace` / `merge`）
- **密码可见** — 点击眼睛图标切换明文 / 掩码显示

### REST API

控制台启动后同时提供 REST API，可被其他工具直接调用。
**所有 `/api` 请求都需要访问令牌**（见 [安全说明](#安全说明)）。

| Method | Path | 说明 |
| --- | --- | --- |
| `GET` | `/api/health` | 健康检查 + 连接池状态 |
| `GET` | `/api/hosts` | 主机列表 |
| `GET` | `/api/hosts/:hostId` | 主机详情 |
| `POST` | `/api/hosts` | 创建 / 覆盖 |
| `PUT` | `/api/hosts/:hostId` | 更新（支持改名 hostId） |
| `DELETE` | `/api/hosts/:hostId` | 删除 |
| `POST` | `/api/hosts/:hostId/test` | 测试连通性 |
| `POST` | `/api/hosts/:hostId/exec` | 执行命令或脚本 |
| `GET` | `/api/io/export` | 导出配置（脱敏） |
| `POST` | `/api/io/import` | 导入配置 |
| `GET` | `/api/history` | 读取审计日志 |

```bash
TOKEN=$(cat ~/.ssh-driver/console-token)
curl -H "X-Ssh-Driver-Token: $TOKEN" http://127.0.0.1:7843/api/hosts
```

## 审计日志

每一次远程操作都会记录到 `~/.ssh-driver/history.log`（JSONL 格式）：

```bash
$ ssh-driver history --limit 5
2026-10-26 17:57:17  OK    8500   cli    exec        exit=0   429ms  echo hello && whoami
2026-10-26 17:57:30  OK    8500   cli    exec-script exit=0   521ms  /tmp/deploy.sh
2026-10-26 18:02:11  FAIL  8500   mcp    exec        exit=2   242ms  退出码 2
```

记录内容：时间、来源（`cli` / `api` / `mcp`）、主机、操作类型、命令、退出码、耗时、是否成功。

命令里的密码会**自动脱敏**（`--password=` / `-pXXX` / `sshpass -p` / `token=` / `secret=` 等）。

MCP 工具 `get_history` 让 AI 自己也能回溯「之前在这台机器上跑过什么」。

## 给 AI Agent 的用法

安装 skill 后，AI 可以这样使用：

```bash
ssh-driver config list                                   # 看有哪些机器
ssh-driver connect prod-web-01                           # 确认能连
ssh-driver exec prod-web-01 "systemctl status nginx" --json
```

完整的 AI 使用约定（配置流程、注意事项、禁止事项）都写在 `~/.agents/skills/ssh-driver/SKILL.md` 里，AI 首次使用会自动读取。

支持 MCP 的客户端则可以直接用工具，不用拼 shell。

## 项目结构

```
ssh-driver/
├── src/
│   ├── cli.ts              # CLI 入口，注册所有子命令
│   ├── commands/           # install / config / exec / history / console / mcp
│   ├── backend/            # Express 服务 + REST 路由
│   ├── mcp/                # MCP Server（工具定义）
│   ├── audit/              # 审计日志
│   ├── config/             # 配置的数据契约、合并语义与持久化
│   ├── ssh/                # node-ssh 封装 + 连接池 + SFTP
│   ├── utils/              # 日志等工具
│   └── web/                # React 前端（Vite）
├── skill/SKILL.md          # AI Skill 定义，install 会复制它
├── test/                   # Vitest 用例
├── index.html              # Vite 入口
├── vite.config.ts
├── tsconfig.json           # 前端 TS 配置
└── tsconfig.server.json    # 后端 TS 配置
```

## 开发

```bash
npm run build          # 同时构建后端（tsc）和前端（vite）
npm run build:server   # 只构建后端 → dist/
npm run build:web      # 只构建前端 → dist-server/web/
npm run dev            # 后端 watch 模式
npm run dev:web        # 前端 vite dev server（HMR）
npm run dev:console    # 同时启动后端 + vite，方便调前端
npm test               # Vitest 单元 / 集成测试
npm run typecheck      # 两套 tsconfig 的类型检查
```

调试开关：

```bash
SSH_DRIVER_DEBUG=1 ssh-driver config list
SSH_DRIVER_PORT=9000 ssh-driver console
SSH_DRIVER_CONFIG=/path/to/other-config.json ssh-driver config list
```

## 安全说明

> ⚠️ 请认真阅读这一节。

- **控制台 API 需要访问令牌**。`ssh-driver console` 启动时生成随机令牌并打印，同时写入
  `~/.ssh-driver/console-token`（`0600`）。调用 REST API 必须带 `X-Ssh-Driver-Token` 头。
  没有令牌，任意网页都无法读取你的 SSH 凭据。
- **配置明文存储**。密码保存在 `~/.ssh-driver/config.json`（文件权限 `0600`）。
  这是为了让你能在控制台里随时看到和修改密码，代价是**不要把这个文件提交到 Git 或分享出去**。
- **优先使用私钥**。生产环境的服务器通常禁用密码登录，用 `--privateKey` 更安全。
- **可以配置主机密钥指纹**（`hostHash`），配置后会强制校验，防止中间人攻击。
- **导出文件已脱敏**。`GET /api/io/export` 和控制台的下载功能会把密码 / 私钥口令替换成 `***`。
- **导入不会丢凭据**。脱敏文件里的 `***` 表示「我不知道这个凭据」：本地已有同名主机会保留原凭据；
  本地没有则会被明确拒绝导入（而不是把 `***` 当成密码存进去）。
- **不要把密码写进命令行历史**。用网页控制台填写最安全。
- **默认只监听 `127.0.0.1`**，控制台不会暴露到外网。如果用 `--host` 改成 `0.0.0.0`，请自行加访问控制。
- **审计日志会记录你执行过的每条命令**（命令中的密码自动脱敏）。日志文件本身也要注意保管。

## 路线图

- [ ] 多主机批量执行
- [ ] 从 `~/.ssh/config` 导入主机
- [ ] ProxyJump 跳板机支持
- [ ] 命令护栏（黑名单 / 只读模式 / 危险命令二次确认）
- [ ] 配置加密存储（配合系统 keychain）

## 贡献

欢迎提交 Issue 和 Pull Request。详见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

[MIT](LICENSE) © ssh-driver contributors

## 相关项目

如果你在做类似的事，也许会喜欢：

- [db-driver](https://github.com/668mt/db-driver) — 数据库访问 CLI，带 AI Skill
