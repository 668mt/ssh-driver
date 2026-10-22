# Changelog

本项目的所有重要变更都会记录在此文件。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 计划中

- SFTP 上传 / 下载
- 长连接会话，支持多次命令复用
- 多主机批量执行
- 配置加密存储（配合系统 keychain）

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

[Unreleased]: https://github.com/668mt/ssh-driver/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/668mt/ssh-driver/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/668mt/ssh-driver/releases/tag/v0.1.0