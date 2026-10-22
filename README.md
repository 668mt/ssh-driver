# ssh-driver

一个轻量的 SSH 连接管理 + 远程命令执行 CLI + 本地网页 console，内置一段可以被 AI Agent 直接消费的 SKILL。

主要功能：

- `install` — 把 `SKILL.md` 安装到 `~/.agents/skills/ssh-driver`，让 AI 知道怎么用
- `config` — 增删改查 SSH 主机（持久化在 `~/.ssh-driver/config.json`，权限 `0600`）
- `connect` — 测活
- `exec` — 在已保存的主机上跑一条命令并取回 stdout/stderr/exit code
- `console` — 启动本地网页 console（Hosts 增删改查 + Import / Export）

底层使用 [node-ssh](https://github.com/steelbrain/node-ssh)（基于 ssh2）。

## 快速开始

```bash
cd ssh-driver
npm install
npm run build               # 同时编译后端 (tsc) 与构建前端 (vite)
npm link                    # 让全局的 `ssh-driver` 指向这里

ssh-driver install
ssh-driver console          # 浏览器自动打开

# 或纯命令行：
ssh-driver config add \
  --hostId dev \
  --host 1.2.3.4 \
  --username root \
  --privateKey ~/.ssh/id_ed25519 \
  --description "测试机" \
  --test

ssh-driver connect dev
ssh-driver exec dev "uname -a" --json
```

## 命令一览

| 命令 | 作用 |
| --- | --- |
| `ssh-driver install [--with-web] [--force] [--target dir]` | 安装 SKILL |
| `ssh-driver config add \| list \| show \| update \| remove \| test` | 维护 host 列表 |
| `ssh-driver connect <hostId>` | 测活 |
| `ssh-driver exec <hostId> "<cmd>" [--json] [--timeout ms]` | 执行命令 |
| `ssh-driver console [--port n] [--host addr] [--dev] [--no-open]` | 启动网页 console |

## 开发

```bash
npm run build:server        # 后端 tsc -> dist/
npm run build:web           # 前端 vite build -> dist-server/web/
npm run dev                 # 后端 watch 模式
npm run dev:web             # vite dev server (HMR)
npm run dev:console         # 同时启动 backend + vite dev server (推荐改前端时用)
```

调试：

```bash
SSH_DRIVER_DEBUG=1 ssh-driver exec ...
SSH_DRIVER_PORT=9000 ssh-driver console
```

## 架构速览

```
src/
├── cli.ts                 # CLI 入口
├── backend/               # Express HTTP 服务 + REST API + 静态资源
├── commands/              # install / config / exec / console
├── config/                # schema + 持久化
├── ssh/                   # node-ssh 封装
├── utils/
└── web/                   # React + TS 前端 (vite)
skill/
└── SKILL.md               # install 命令复制给 AI 的资源
```

- 后端：Express + cors，路由在 `src/backend/routes/`。敏感字段（password/privateKey/passphrase）在响应中以 `***` 掩码。
- 前端：Vite + React 18 + TS；HMR 走 vite dev server；构建产物在 `dist-server/web/`。
- 持久化：所有改动都落到 `~/.ssh-driver/config.json`，文本格式，权限 `0600`。

## 安全与凭据

- 配置文件 `~/.ssh-driver/config.json` 以 `0600` 写入
- 默认存明文；生产环境建议走 `privateKey` 而非密码，并把 config 文件单独加 ACL
- 任何 `--password` 都只走命令行参数，避免写到 prompt 文本里
- 网页 console 不会暴露原密码——服务端响应里始终是 `***`

详见 `~/.agents/skills/ssh-driver/SKILL.md`（安装后即可给 AI 阅读）。
