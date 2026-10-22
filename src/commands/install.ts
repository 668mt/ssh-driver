/**
 * install 命令 —— 把打包好的 SKILL.md 复制到 ~/.agents/skills/ssh-driver
 * 可选 --with-web，把构建好的前端复制到同一个 skill 目录下（仅用于本地预览，与 AI 加载无关）。
 * @Author Martin
 * @Date 2026/10/19
 */

import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

import { logger } from '../utils/logger';

const SKILL_NAME = 'ssh-driver';

export interface InstallOptions {
  /** 安装目标根目录；默认 ~/.agents/skills */
  target?: string;
  /** 强制覆盖已有 skill。默认 true —— install 的语义就是装最新版 */
  force?: boolean;
  /** 同时复制 web/ 子目录（构建后的前端） */
  withWeb?: boolean;
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function copyDir(src: string, dst: string): Promise<void> {
  await fs.mkdir(dst, { recursive: true });
  for (const ent of await fs.readdir(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dst, ent.name);
    if (ent.isDirectory()) await copyDir(s, d);
    else await fs.copyFile(s, d);
  }
}

/**
 * 向上逐级查找包含 skill/SKILL.md 的包根目录。
 *
 * 为什么要探测而不是直接拼路径：
 *   - 开发态：__dirname = <repo>/src/commands  -> 上两级是 repo 根
 *   - 发布态：__dirname = <pkg>/dist/commands  -> 上两级是包根
 * 两者恰好都是"上两级"，但依赖这个巧合很脆弱。
 * 改成实际探测后兼容任意布局（包括 pnpm 的符号链接结构）。
 */
async function resolvePackageRoot(startDir: string): Promise<string | null> {
  let dir = startDir;
  for (let i = 0; i < 6; i += 1) {
    if (await exists(path.join(dir, 'skill', 'SKILL.md'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break; // 已到文件系统根
    dir = parent;
  }
  return null;
}

export async function runInstall(opts: InstallOptions = {}) {
  const targetRoot = opts.target ?? path.join(os.homedir(), '.agents', 'skills');
  const targetDir = path.join(targetRoot, SKILL_NAME);

  const packageRoot = await resolvePackageRoot(__dirname);
  if (!packageRoot) {
    throw new Error(
      '找不到 skill/SKILL.md，请确认安装完整；也可用 --target 指定安装目标目录。',
    );
  }
  const sourceDir = path.join(packageRoot, 'skill');

  const sourceFile = path.join(sourceDir, 'SKILL.md');
  const targetFile = path.join(targetDir, 'SKILL.md');

  // 检查源文件存在
  if (!(await exists(sourceFile))) {
    throw new Error(
      `SKILL.md not found at ${sourceFile}. Did you forget to ship the skill/ folder?`,
    );
  }

  // 已存在时默认覆盖；只有显式传 force: false 才拒绝
  const force = opts.force !== false;
  const alreadyExists = await exists(targetFile);
  if (alreadyExists && !force) {
    throw new Error(
      `Skill 已存在于 ${targetFile}。默认会覆盖，如需保留请去掉 --no-force。`,
    );
  }

  await fs.mkdir(targetDir, { recursive: true });
  await fs.copyFile(sourceFile, targetFile);
  logger.info(
    alreadyExists
      ? `已覆盖更新 skill：${targetFile}`
      : `已安装 skill：${targetFile}`,
  );

  if (opts.withWeb) {
    const srcWeb = path.join(packageRoot, 'dist-server', 'web');
    const dstWeb = path.join(targetDir, 'web');
    if (await exists(srcWeb)) {
      await copyDir(srcWeb, dstWeb);
      logger.info(`已复制 web 资源：${dstWeb}`);
    } else {
      logger.warn(`指定了 --with-web，但未找到构建产物：${srcWeb}`);
    }
  }

  logger.info(`AI Agent 现在可以使用 '${SKILL_NAME}' skill 了。`);
}
