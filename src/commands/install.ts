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
  /** 强制覆盖已有 skill */
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

export async function runInstall(opts: InstallOptions = {}): Promise<void> {
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

  // 检查目标是否已存在
  if ((await exists(targetFile)) && !opts.force) {
    throw new Error(
      `Skill already installed at ${targetFile}. Pass --force to overwrite.`,
    );
  }

  await fs.mkdir(targetDir, { recursive: true });
  await fs.copyFile(sourceFile, targetFile);
  logger.info(`Installed skill to ${targetFile}`);

  if (opts.withWeb) {
    const srcWeb = path.join(packageRoot, 'dist-server', 'web');
    const dstWeb = path.join(targetDir, 'web');
    if (await exists(srcWeb)) {
      await copyDir(srcWeb, dstWeb);
      logger.info(`Copied web assets to ${dstWeb}`);
    } else {
      logger.warn(`--with-web requested but build output not found at ${srcWeb}`);
    }
  }

  logger.info(`Now your AI agent can use the '${SKILL_NAME}' skill.`);
}
