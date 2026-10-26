/**
 * 本地路径解析 + 文件写入参数 —— 单元测试
 * @Author Martin
 * @Date 2026/10/27
 */

import * as path from 'path';
import { describe, expect, it } from 'vitest';

import { parseMode } from '../src/commands/write';
import { RemoteFileExistsError } from '../src/ssh/sftp';
import { resolveLocalPath } from '../src/utils/localpath';

describe('parseMode', () => {
  it('解析八进制权限', () => {
    expect(parseMode('0644')).toBe(0o644);
    expect(parseMode('644')).toBe(0o644);
    expect(parseMode('755')).toBe(0o755);
    expect(parseMode('600')).toBe(0o600);
  });

  it('不传就是 undefined', () => {
    expect(parseMode(undefined)).toBeUndefined();
    expect(parseMode('')).toBeUndefined();
  });

  it('非法值抛错', () => {
    expect(() => parseMode('abc')).toThrow(/八进制/);
  });
});

describe('RemoteFileExistsError', () => {
  it('消息里带上路径和 --overwrite 提示', () => {
    const err = new RemoteFileExistsError('/etc/app.conf');
    expect(err.code).toBe('EEXIST');
    expect(err.path).toBe('/etc/app.conf');
    expect(err.message).toContain('/etc/app.conf');
    expect(err.message).toContain('--overwrite');
  });
});

describe('resolveLocalPath', () => {
  it('Windows 风格路径按原样解析', () => {
    const abs = path.resolve('C:\\temp\\x.txt');
    expect(resolveLocalPath(abs)).toBe(abs);
  });

  it('相对路径按当前工作目录解析', () => {
    expect(resolveLocalPath('a/b.txt')).toBe(path.resolve('a/b.txt'));
  });

  it('POSIX 路径在非 MSYS 环境保持绝对路径语义', () => {
    const resolved = resolveLocalPath('/tmp/x.txt');
    // 有 cygpath（Git Bash）时会被映射成 Windows 路径，否则保持 /tmp/x.txt
    expect(resolved.endsWith('x.txt')).toBe(true);
    expect(path.isAbsolute(resolved)).toBe(true);
  });

  it('空字符串原样返回', () => {
    expect(resolveLocalPath('')).toBe('');
  });
});
