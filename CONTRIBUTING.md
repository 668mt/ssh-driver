# Contributing to ssh-driver

感谢你考虑为 ssh-driver 贡献代码。

## 报告 Bug

开 Issue 前请先确认：

1. 搜索已有 Issue，避免重复
2. 使用最新版本复现（`npm install -g ssh-driver@latest`）
3. 开启调试日志重试：`SSH_DRIVER_DEBUG=1 ssh-driver <你的命令>`

Issue 请包含：

- 操作系统与 Node.js 版本（`node -v`）
- ssh-driver 版本（`ssh-driver --version`）
- 复现步骤
- 实际行为 vs 期望行为
- 相关日志输出（**请先脱敏掉密码、主机名等敏感信息**）

## 提交代码

### 开发环境

```bash
git clone https://github.com/668mt/ssh-driver.git
cd ssh-driver
npm install
npm run build
npm link
```

### 代码规范

- TypeScript 严格模式，不使用 `any`（除非有充分理由并注释说明）
- 遵循现有代码风格：2 空格缩进、单引号、尾随分号
- 提交前确保通过：

```bash
npx tsc -p tsconfig.server.json --noEmit   # 后端类型检查
npx tsc --noEmit                            # 前端类型检查
npm run build                               # 完整构建
```

### Commit message

采用 [Conventional Commits](https://www.conventionalcommits.org/) 规范：

```
feat: 新增 SFTP 上传下载
fix: 修复密码框显示切换不生效
docs: 补充 REST API 文档
refactor: 拆分 config store 与 schema
chore: 升级依赖到 commander v13
```

### Pull Request

1. 从 `main` 分支切出特性分支：`git checkout -b feat/my-feature`
2. 保持每个 PR 聚焦单一改动
3. 在 PR 描述中说明「改了什么」和「为什么」
4. 如果改动较大，更新 `README.md` 和 `CHANGELOG.md` 的对应章节

## 安全问题

**请不要通过公开 Issue 报告安全漏洞**，参见 [SECURITY.md](SECURITY.md)。

## 行为准则

参与本项目即表示同意遵守 [行为准则](CODE_OF_CONDUCT.md)。