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
