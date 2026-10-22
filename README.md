<div align="center">

# ssh-driver

**让 AI Agent 安全地连接远程服务器并执行命令**

[![npm](https://img.shields.io/npm/v/ssh-driver.svg)](https://www.npmjs.com/package/ssh-driver)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D18-green.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6.svg)](https://www.typescriptlang.org)

一个轻量的 SSH 连接管理 CLI，附带本地网页控制台和一段可被 AI 直接消费的 Skill。

[快速开始](#快速开始) · [命令一览](#命令一览) · [网页控制台](#网页控制台) · [安全说明](#安全说明)

</div>

---

## 这是什么

把 SSH 连接信息集中管理在一处，让命令行和 AI Agent 都能安全地连接远程服务器执行命令。

```
┌──────────────┐     ┌──────────────────┐     ┌─────────────┐
│  你 / AI     │────▶│   ssh-driver     │────▶│  远程服务器  │
│              │     │  config / exec   │     │             │
└──────────────┘     └──────────────────┘     └─────────────┘
                            │
                            ▼
                   ~/.ssh-driver/config.json
                   ~/.agents/skills/ssh-driver/
```

## 特性

| 能力 | 说明 |
| --- | --- |
| **AI 原生** | 内置 `SKILL.md`，AI Agent 读完就知道怎么用；`ssh-driver install` 一键安装 |
| **连接管理** | 主机以 `hostId` 为唯一标识保存，支持增删改查、改名、标签分组 |
| **远程执行** | 单条命令执行，返回 stdout / stderr / exit code，支持 JSON 输出 |
| **网页控制台** | Vite + React 界面，中文、浅色主题，可视化编辑与导入导出 |
| **连通性测试** | 密码 / 私钥双模式，配置前就能验证是否可达 |
| **导入导出** | 整份配置 JSON 导入导出，`replace` / `merge` 两种策略 |

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
```

## 命令一览

```text
ssh-driver install [--with-web] [--force] [--target <dir>]
ssh-driver config add --hostId <id> --host <host> --username <user> [...]
ssh-driver config list | show | update | remove | test
ssh-driver connect <hostId>
ssh-driver exec <hostId> "<cmd>" [--json] [--timeout <ms>]
ssh-driver console [--port <n>] [--host <addr>] [--dev] [--no-open]
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

## 网页控制台

```bash
ssh-driver console                  # 默认 http://127.0.0.1:7843
ssh-driver console --port 9000      # 换端口
ssh-driver console --dev            # 开发模式（vite HMR）
```

### 功能

- **主机列表** — 按 hostId / 主机 / 用户 / 标签 过滤，测试、编辑、删除
- **主机编辑** — 表单内直接测试连通性，hostId 支持修改（重命名）
- **导入导出** — 下载 `ssh-driver-config.json`，或粘贴 JSON 导入（`replace` / `merge`）
- **密码可见** — 点击眼睛图标切换明文 / 掩码显示

### REST API

控制台启动后同时提供 REST API，可被其他工具直接调用：

| Method | Path | 说明 |
| --- | --- | --- |
| `GET` | `/api/health` | 健康检查 |
| `GET` | `/api/hosts` | 主机列表 |
| `GET` | `/api/hosts/:hostId` | 主机详情 |
| `POST` | `/api/hosts` | 创建 / 覆盖 |
| `PUT` | `/api/hosts/:hostId` | 更新（支持改名 hostId） |
| `DELETE` | `/api/hosts/:hostId` | 删除 |
| `POST` | `/api/hosts/:hostId/test` | 测试连通性 |
| `GET` | `/api/io/export` | 导出配置 |
| `POST` | `/api/io/import` | 导入配置 |

## 给 AI Agent 的用法

安装 skill 后，AI 可以这样使用：

```bash
ssh-driver config list                                   # 看有哪些机器
ssh-driver connect prod-web-01                           # 确认能连
ssh-driver exec prod-web-01 "systemctl status nginx" --json
```

完整的 AI 使用约定（配置流程、注意事项、禁止事项）都写在 `~/.agents/skills/ssh-driver/SKILL.md` 里，AI 首次使用会自动读取。

## 项目结构

```
ssh-driver/
├── src/
│   ├── cli.ts              # CLI 入口，注册所有子命令
│   ├── commands/           # install / config / exec / console
│   ├── backend/            # Express 服务 + REST 路由
│   ├── config/             # 配置的数据契约与持久化
│   ├── ssh/                # node-ssh 封装
│   ├── utils/              # 日志等工具
│   └── web/                # React 前端（Vite）
├── skill/SKILL.md          # AI Skill 定义，install 会复制它
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
```

调试开关：

```bash
SSH_DRIVER_DEBUG=1 ssh-driver config list
SSH_DRIVER_PORT=9000 ssh-driver console
```

## 安全说明

> ⚠️ 请认真阅读这一节。

- **配置明文存储**。密码保存在 `~/.ssh-driver/config.json`（文件权限 `0600`）。
  这是为了让你能在控制台里随时看到和修改密码，代价是**不要把这个文件提交到 Git 或分享出去**。
- **优先使用私钥**。生产环境的服务器通常禁用密码登录，用 `--privateKey` 更安全。
- **导出文件已脱敏**。`GET /api/io/export` 和控制台的下载功能会把密码 / 私钥口令替换成 `***`，可以安全地用于备份和迁移。
- **导出的 `***` 不会被重新导入**。如果用导出的文件覆盖配置，密码字段会变成空，需要重新填写或改用 `merge` 策略。
- **不要把密码写进命令行历史**。用网页控制台填写最安全。
- **默认只监听 `127.0.0.1`**，控制台不会暴露到外网。如果用 `--host` 改成 `0.0.0.0`，请自行加访问控制。

## 路线图

- [ ] SFTP 上传 / 下载
- [ ] 长连接会话，多次命令复用
- [ ] 多主机批量执行
- [ ] 主机分组 / 标签筛选增强
- [ ] 配置加密存储（配合系统 keychain）

## 贡献

欢迎提交 Issue 和 Pull Request。详见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

[MIT](LICENSE) © ssh-driver contributors

## 相关项目

如果你在做类似的事，也许会喜欢：

- [db-driver](https://github.com/668mt/db-driver) — 数据库访问 CLI，带 AI Skill