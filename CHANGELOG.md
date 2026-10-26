# Changelog

本项目的所有重要变更都会记录在此文件。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 计划中

- 多主机批量执行（并发上限 + 聚合 JSON）
- 从 `~/.ssh/config` 导入主机
- ProxyJump 跳板机支持
- 配置加密存储（配合系统 keychain）
- 命令护栏（黑名单 / 只读模式）

## [0.4.0] - 2026-10-26

> **破坏性变更**：控制台 API 现在需要访问令牌。网页控制台不受影响（服务端自动注入），
> 但用 `curl` / 脚本调 REST API 的场景需要加 `X-Ssh-Driver-Token` 头。
> 令牌在 `ssh-driver console` 启动时打印，并写入 `~/.ssh-driver/console-token`。

### 新增

- **历史记录展示增强**
  - 网页控制台「最近执行记录」：默认 50 条（原 10 条），可「加载更多」每次 +50
  - 可切换「只看当前主机 / 全部主机」
  - 命令完整换行显示，不再截断成一行省略号；失败记录直接显示错误原因
  - 表格加了滚动容器（最高 460px），记录再多也不会把页面撑爆
  - 标题显示「显示 N / 共 M 条」
  - `ssh-driver history` 默认 50 条，`--limit 0` 查看全部
  - `GET /api/history` 返回 `total`（符合过滤条件的总条数）
- **MCP Server 模式** — `ssh-driver mcp` 以 MCP (stdio) 暴露 10 个工具
  - `list_hosts` / `test_host` / `exec_command` / `exec_script`
  - `list_files` / `read_file` / `write_file`（SFTP）
  - `session_status` / `close_session` / `get_history`
  - 相比「AI 拼 shell 命令」：参数结构化、进程常驻、错误结构化返回
- **连接会话缓存**（SSH 连接池）
  - MCP / 控制台进程内的连接会被缓存复用，连续执行不再重复握手
  - 实测：首次执行 ~430ms，第二次 ~54ms
  - 空闲 5 分钟自动断开；连接被远端掐断时自动重连重试一次
  - 池上限 8 条，超出时淘汰最久未使用的连接
- **脚本执行** — `ssh-driver exec <hostId> --script <file>`
  - 通过 stdin 把脚本喂给远端解释器，**不在远端留临时文件**
  - 解释器默认按 shebang 推断（`#!/bin/bash` / `#!/usr/bin/env python3`），没有则用 bash
  - `--arg` 传位置参数（`$1 $2`），`--interpreter` 手动指定解释器
  - `--script -` 从标准输入读取
  - 网页控制台新增「远程执行」页，支持命令 / 脚本两种模式 + 最近执行记录
- **操作审计日志** — `~/.ssh-driver/history.log`（JSONL）
  - 记录每一次远程操作：时间、来源（cli/api/mcp）、主机、命令、退出码、耗时
  - 命令中的密码会自动脱敏（`--password=` / `-pXXX` / `sshpass -p` / `token=` 等）
  - `ssh-driver history` 查看，`GET /api/history` 供程序消费
  - MCP 工具 `get_history` 可让 AI 自己回溯「之前跑过什么」
- **REST API** — `POST /api/hosts/:hostId/exec`（命令 / 脚本）、`GET /api/history`
- **配置备份** — 每次写入前自动留一份 `config.json.bak`
- **文件锁** — 配置的「读 → 改 → 写」加了跨进程锁，避免并发写互相覆盖
- **主机密钥指纹校验** — `hostHash` 字段，配了就强制校验，防中间人
- `SSH_DRIVER_CONFIG` / `SSH_DRIVER_HISTORY` 环境变量可覆盖配置与日志路径（测试、多 profile 用）
- `config list --json` 输出结构化 JSON，便于程序消费

### 修复

- **命令超时后远端进程不再变孤儿** 🔴
  - 之前超时只是「本地不等了」—— 远端命令继续跑，成为孤儿进程，
    还一直占着 sshd 的 MaxSessions channel 配额。
  - 现在超时会通过 SSH 的 signal 请求（RFC 4254 §6.9）杀掉远端进程组：
    `SIGTERM` → 300ms 宽限期 → `SIGKILL`。
  - ⚠️ 坑：node-ssh 在没有 stdin 时会立刻 `channel.end()`，
    channel 变成 `state='eof' / writable=false`，
    而 ssh2 公开的 `signal()` 要求 `state==='open'` —— 直接调用是**静默 no-op**。
    所以实现走协议层发信号，绕开这个状态检查。
  - 也**不是** `channel.close()` 能解决的：sshd 收到 channel 关闭只清理自己的
    会话状态，不会杀掉已经 setsid 脱离的远端命令（实测远端进程仍在，ppid=1）。
  - 实测：超时后远端 `sleep 300` 进程消失，连接仍可继续复用。
- **命令超时不再被误判成「连接坏了」** 🔴
  - 超时是「命令跑太久」，不是「连接失效」。
  - 之前重连逻辑会重试一次 —— 但超时的命令**可能已经产生了副作用**
    （写了半个文件、改了半个配置），重试等于把副作用做两遍。
  - 现在超时用独立的 `CommandTimeoutError` 类型（`code=ETIMEDOUT`），
    明确不参与重连重试。
- **并发超过 sshd MaxSessions 不再硬失败** 🔴
  - sshd 的 `MaxSessions` 默认 10（每条 TCP 连接最多 10 个 session channel），
    超过直接报 `(SSH) Channel open failure: open failed` —— 是硬失败，不排队。
  - 现在连接池给每台主机加了并发闸门（默认 8，留 2 个余量），
    超出的请求排队等待而不是直接失败。
  - 万一还是撞上（比如远端把 MaxSessions 调到更小），会识别成
    「远端不给你开 channel」（连接本身是好的），等 250ms 后重试一次，
    **不会**重建连接。
  - 实测：同一台机器并发 20 条命令，20/20 全部成功（修复前 12 条并发就有 3 条失败）。
- **控制台导入配置不再绕过文件锁** 🟡
  - `POST /api/io/import` 之前直接 `saveStore()`，没走 `withStoreLock`，
    与 CLI / MCP 同时改配置时会丢更新，凭据可能凭空消失。
  - 现在整个「读 → 合并 → 写」都在同一把锁里完成
    （新增 `mutateStore()` 原语）。
- **SSH 连接报错不再让整个进程崩掉** 🟡
  - node-ssh 在连接 ready 之后会摘掉它的 `error` 监听器，
    此后连接上再出任何 error，Node 会当成「未处理的 error 事件」**直接终止进程**
    —— MCP server 会当场崩掉。
  - 现在所有连接入口都走 `connectSsh()`，统一挂上兜底的 error 监听器。
- **`--limit` / `--timeout` 之前是静默失效的** 🔴
  - 根因：commander 在选项**带默认值**时会把默认值作为第二个参数传给转换函数，
    而 `parseInt` 的第二个参数是**进制** → `parseInt('6', 50)` = `NaN`
  - 后果：`ssh-driver history --limit 6` 什么都读不出来；`exec --timeout 2000` 完全不起作用
  - 现在统一用 `parseIntArg`（显式 10 进制），并对 NaN 做兜底
- **`config add` 重复执行不再抹掉已保存的密码 / 私钥** 🔴
  - 根因：用 `{...existing, ...patch}` 展开合并时，**显式存在的 `undefined` 键也会覆盖原值**
  - 现在所有合并统一走 `config/merge.ts`：`undefined` = 没提供、`'***'` = 掩码占位符、`''` = 显式清空
- **导入配置不再抹掉本地已有主机的密码** 🔴
  - `merge` 之前是整条替换，`replace` 更是直接清空
  - 现在两种模式都会**逐字段**保留本地凭据；脱敏文件里本地不存在的机器会被明确拒绝导入
- **`PUT /api/hosts/:hostId` 不会把 `'***'` 当成密码存进去** 🔴
  - 脱敏占位符现在统一回填为已保存的真实凭据
- **控制台 API 加访问令牌鉴权** 🔴
  - 之前是裸奔的：任意网页都能 `fetch('http://127.0.0.1:7843/api/hosts')` 读走全部 SSH 明文密码
  - 现在必须带 `X-Ssh-Driver-Token` 头或同源 cookie
- **跨域收紧** — CORS 从 `origin: true`（任意来源）改为只放行 loopback 与同源
- **Host 头校验** — 只绑 loopback 时校验 Host，防 DNS rebinding
- `--version` 改为从 `package.json` 读取（之前写死 `0.2.0`，与实际版本不符）
- `config add --port` 现在正确存成数字（之前存的是字符串 `"2222"`）
- `exec --timeout` 超时后真正断开连接，远端进程不再继续挂着
- CLI 帮助文本全面中文化（`connect` / `exec` / `console` 之前还是英文）
- 配置文件损坏时自动备份为 `config.json.corrupt-<时间戳>`，不再让整个工具不可用

### 测试

- 引入 Vitest，新增 50 个用例
  - 覆盖合并语义、导入导出、鉴权、跨域、审计脱敏、脚本命令拼装
  - CI 增加 `npm test` 步骤

## [0.3.0] - 2026-10-22

> **升级提示**：如果你之前用 `--force` 覆盖安装过 skill，现在直接 `ssh-driver install` 即可。
> `--force` 选项已移除，取而代之的是否定式的 `--no-force`。

### 变更

- `ssh-driver install` 改为**默认覆盖**已安装的旧版本
  - 之前重复执行会报错要求加 `--force`，不符合直觉
  - 现在直接 `ssh-driver install` 即可更新
  - 需要保留现场时用 `--no-force` 显式拒绝覆盖
- CLI 全部面向用户的输出中文化（提示、错误、帮助文本）

### 新增

- 时间显示本地化：主机列表显示 `2026-10-22 18:19:26 · 3 天前`，CLI 日志用本地时间
- `install` 命令的资源定位改为向上逐级探测包根目录，兼容任意目录布局与 pnpm 符号链接结构

### 修复

- 修复新增主机时在弹窗里点「测试」报 hostId 找不到
  - 后端原先先查 store，路径里的 hostId 在新增场景只是前端占位符，必然 404
  - 改为优先使用请求体里的连接信息；hostId 不再是测试连接的前置条件

## [0.2.0] - 2026-10-22

### 新增

- `ssh-driver console` — 本地网页控制台
  - Vite + React 18 + TypeScript 前端，中文界面、浅色主题
  - 主机列表：按 hostId / 主机 / 用户 / 标签 过滤，支持测试、编辑、删除
  - 主机编辑：表单内直接测试连通性
  - 导入导出：整份配置 JSON 导入（`replace` / `merge` 两种策略）与下载
  - 密码 / 私钥口令支持一键切换明文显示
- 后端 REST API（Express 4 + CORS）
  - `GET /api/health`、`GET/POST/PUT/DELETE /api/hosts`
  - `POST /api/hosts/:hostId/test`
  - `GET /api/io/export`、`POST /api/io/import`
- `ssh-driver install --with-web` — 一并复制构建产物到 skill 目录
- `ssh-driver console --dev` — 同时启动 vite dev server，方便前端调试

### 变更

- `PUT /api/hosts/:hostId` 支持修改 `hostId`（重命名）
  - 若目标 `hostId` 已被占用，返回 `409` 且不做任何修改
- `GET /api/hosts` 与 `GET /api/hosts/:hostId` 返回**明文**密码，便于在控制台查看和编辑
- `GET /api/io/export` 保持脱敏，敏感字段以 `***` 占位，避免备份文件泄露
- 配置权限：读取时 best-effort 收紧为 `0600`

### 修复

- 修复密码框「显示 / 隐藏」切换时受控组件不重绘的问题
  - 改为按显示状态分别渲染独立的 `input`，规避浏览器在受控组件上切换 `type` 时不刷新
  - 按钮文案补充「显示 / 隐藏」文字，避免 emoji 字体缺失时无法辨识

## [0.1.0] - 2026-10-19

### 新增

- `ssh-driver install` — 将 `SKILL.md` 安装到 `~/.agents/skills/ssh-driver`
- `ssh-driver config` — 主机配置的增删改查
  - `add` / `list` / `show` / `update` / `remove` / `test`
  - 配置持久化到 `~/.ssh-driver/config.json`，写入权限 `0600`
- `ssh-driver connect <hostId>` — 测试 SSH 连通性
- `ssh-driver exec <hostId> "<cmd>"` — 执行单条远程命令
  - `--json` 输出 `{stdout, stderr, code}`
  - `--timeout` 命令级超时（best-effort，不强制终止远端进程）
- AI Skill 定义 `skill/SKILL.md`，包含配置流程、字段约定与注意事项

[Unreleased]: https://github.com/668mt/ssh-driver/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/668mt/ssh-driver/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/668mt/ssh-driver/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/668mt/ssh-driver/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/668mt/ssh-driver/releases/tag/v0.1.0
