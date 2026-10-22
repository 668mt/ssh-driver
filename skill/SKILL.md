---
name: ssh-driver
description: |
  通过 ssh-driver CLI 连接远程服务器并执行命令。也可以打开本地网页 console
  管理连接（增删改查、测试、导入/导出）。当你需要 ssh 到一台服务器、在远程
  机器上跑命令、查看远程文件、上传/下载文件、批量管理多台主机时使用本 skill。
  配置存放在 ~/.ssh-driver/config.json，使用前必须先 install 并完成配置。
---

# ssh-driver Skill

`ssh-driver` 是 npm 包 `ssh-driver` 提供的 CLI 命令，为 AI Agent 提供 **SSH 连接管理 + 远程命令执行 + 本地网页 console** 能力。

- 包名 / CLI 命令 / 安装目录 三者同名：`ssh-driver`
- 配置文件：`~/.ssh-driver/config.json`（明文，权限 `0600`）
- 连接库：node-ssh（基于 ssh2）
- 默认从 stdout 抓结果，错误码会作为进程退出码返回

## 安装

```bash
npm install -g ssh-driver
ssh-driver install          # 把本 SKILL.md 复制到 ~/.agents/skills/ssh-driver
# 可选：把构建好的 web 资源也复制过去（仅供本地预览）
ssh-driver install --with-web --force
```

> 如果是从源码安装：`cd ssh-driver && npm i && npm run build && npm link`。

## 命令一览

```text
ssh-driver install [--with-web] [--force] [--target <dir>]
ssh-driver console [--port <n>] [--host <addr>] [--dev] [--no-open]
                    # 打开本地网页 console，浏览器中管理 connections

ssh-driver config add    --hostId <id> --host <host> --username <user> [--port <p>] [--password <pwd> | --privateKey <path>] [--passphrase <pp>] [--description <desc>] [--tags <a,b>] [--test]
ssh-driver config list                              # 列已保存的 host
ssh-driver config show   <hostId>                   # 查看单项（敏感字段掩码）
ssh-driver config update <hostId> [--port 2222] ...
ssh-driver config remove <hostId>
ssh-driver config test   <hostId>                   # 测活

ssh-driver connect <hostId>                         # 测活
ssh-driver exec   <hostId> "<cmd>" [--json] [--timeout <ms>]
```

### 字段约定

| 字段 | 含义 | 备注 |
| --- | --- | --- |
| `hostId` | 用户给连接起的唯一 id | 不区分大小写，便于引用 |
| `host` / `port` | 主机名/IP、SSH 端口 | 默认 22 |
| `username` | SSH 用户 | 必填 |
| `password` | 密码登录 | 与 privateKey 二选一 |
| `privateKey` | 私钥文件绝对路径 | **推荐**；密码登录一般在生产被禁 |
| `passphrase` | 私钥口令 | 可选 |
| `description` | 人类可读描述 | 不影响逻辑 |
| `tags` | 标签，`a,b,c` | 不影响逻辑 |

## Console（网页）

`ssh-driver console` 会启动一个本地 HTTP 服务（默认 `http://127.0.0.1:7843`），浏览器里操作：

| 功能 | 说明 |
| --- | --- |
| **Hosts** 页 | 列出所有 hosts，按 hostId/host/user/tag 过滤；新增、编辑（含测试按钮）、删除 |
| **测试连接** | 编辑表单里有"Test connection"按钮，会用表单里的字段（未保存的也可试）立刻跑 `uname -a` |
| **Import / Export** 页 | 一键下载 `ssh-driver-config.json`；粘贴 JSON 导入，提供 `replace` / `merge` 两种策略 |
| **敏感字段** | 服务端返回时 password/privateKey/passphrase 全部以 `***` 掩码，导入时再次识别 `***` 并跳过（不会写回） |

> 不要把 `--password` 写到 prompt 文本里 —— 直接调用 `console` 命令，让用户在浏览器里填。

### Dev 模式

```bash
ssh-driver console --dev
```

- 同时启动 vite dev server（端口 5174）和 backend（7843），前端走 vite HMR。
- 修改 `src/web/**/*` 后浏览器自动热重载；修改 backend 需要重启 CLI。

### 调用 REST API（无需浏览器）

console 暴露一组 REST 接口，可被其它工具调用：

| Method | Path | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查 + 当前 config 路径 |
| GET | `/api/hosts` | 列表（敏感字段掩码） |
| GET | `/api/hosts/:hostId` | 详情 |
| POST | `/api/hosts` | 创建 / 覆盖（按 hostId） |
| PUT | `/api/hosts/:hostId` | 局部更新 |
| DELETE | `/api/hosts/:hostId` | 删除 |
| POST | `/api/hosts/:hostId/test` | 测试连接；body 可省略（不省略则用 body 试） |
| GET | `/api/io/export` | 导出 `StoreFile` JSON（敏感字段掩码） |
| POST | `/api/io/import` | body: `{ hosts: HostConfig[], mode: 'replace' \| 'merge' }` |

## 调用示例（AI 视角）

### 1. 第一次配一台机器（命令行）

```bash
ssh-driver config add \
  --hostId prod-web-01 \
  --host 10.0.1.10 \
  --username deploy \
  --privateKey /home/me/.ssh/id_ed25519 \
  --description "生产 web-01" \
  --tags prod,web \
  --test
```

### 2. 第一次配一台机器（网页，推荐给人类用户）

```bash
ssh-driver console
# 浏览器自动打开 → Hosts → "+ New host" → 填表 → Test connection → Create
```

### 3. 测活

```bash
ssh-driver connect prod-web-01
# 输出: connected to prod-web-01 (deploy@10.0.1.10:22)
```

### 4. 执行命令并解析结果

```bash
ssh-driver exec prod-web-01 "df -h | head -20"
ssh-driver exec prod-web-01 "systemctl status nginx | head -30" --json
```

`--json` 输出形如：

```json
{"stdout":"...","stderr":"","code":0}
```

### 5. 备份/迁移配置

```bash
ssh-driver console            # 在浏览器里下载 ssh-driver-config.json
# 或： curl http://127.0.0.1:7843/api/io/export > config.json

# 还原时在浏览器 Import 页贴入；或在另一台机器起 console 后：
curl -X POST http://127.0.0.1:7843/api/io/import \
  -H 'Content-Type: application/json' \
  -d @config.json
```

## 注意事项（AI 必读）

- **不要把 `--password` 写到 prompt 文本里** —— 提醒用户在终端或浏览器里填。
- **网页 console 是中文的**（zh-CN），hostId 在编辑模式下**允许改名**（PUT 走 rename 语义；如果目标 hostId 已存在会 409 返回，前端报错不修改任何数据）。
- **长任务尽量拆短**：`exec` 每次开新连接，十几秒内的命令体验最好；超过分钟级的任务，建议在远程机器上写脚本并 `nohup &` 后台跑，再 exec 查 PID / 日志。
- **不要省略 `--json` 的同时把 stdout 当 JSON 解析**：默认输出就是命令本身的 stdout。
- **超时**：`--timeout` 是 best-effort（用 Promise.race 包了一层），到点就报错退出，**不会真的杀死远程进程**。对长时间命令慎用。
- **文件权限**：`config.json` 以 `0600` 写入；私钥请自行保持 `600`。
- **导入合并**：导入 `merge` 是按 hostId 去重，新条目覆盖旧条目；`replace` 会清空现有再覆盖。**永远不要把 `replace` 静默跑**，必须明确告诉用户。

## 典型对话流程

> 用户：帮我看看 prod-web-01 上 nginx 挂了没。

你应该：

1. 跑 `ssh-driver config list`；如果 `prod-web-01` 不在，停下来问用户要连接信息，或提示用户跑 `ssh-driver console` 自己配。
2. 跑 `ssh-driver connect prod-web-01`，失败要把 stderr 原样回报。
3. 跑 `ssh-driver exec prod-web-01 "systemctl status nginx --no-pager" --json`。
4. 用 `code != 0` 之外的 stderr / stdout 内容判断，不引用 `nginx` 以外的命令结果。

> 用户：帮我把一组开发机的连接信息批量加上。

你应该：

1. 一次性 `ssh-driver config add` 多次；或者
2. 提示用户跑 `ssh-driver console`，在网页 Hosts 页逐条填；或者
3. 引导用户用 console 下载模板 JSON，改好后在 Import 页粘入、选 `merge`。

## 后续可扩展（当前未实现）

- SFTP 上传 / 下载（`node-ssh` 的 `putFile` / `getFile`）
- 长连接会话 + 多次命令复用
- 多 host 批量执行（前端勾选 → 后端并发 exec）
