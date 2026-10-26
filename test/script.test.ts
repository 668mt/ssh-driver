/**
 * 脚本执行辅助函数 —— 单元测试
 * @Author Martin
 * @Date 2026/10/26
 */

import { describe, expect, it } from 'vitest';

import {
  buildScriptCommand,
  detectInterpreter,
  resolveInterpreter,
  shellQuote,
} from '../src/ssh/client';

describe('detectInterpreter', () => {
  it('识别 #!/bin/bash', () => {
    expect(detectInterpreter('#!/bin/bash\necho hi')).toBe('/bin/bash');
  });

  it('识别 #!/usr/bin/env python3', () => {
    expect(detectInterpreter('#!/usr/bin/env python3\nprint(1)')).toBe('python3');
  });

  it('没有 shebang → null', () => {
    expect(detectInterpreter('echo hi')).toBeNull();
  });

  it('空脚本 → null', () => {
    expect(detectInterpreter('')).toBeNull();
  });

  it('带参数的 shebang', () => {
    expect(detectInterpreter('#!/usr/bin/env bash -e')).toBe('bash -e');
  });
});

describe('resolveInterpreter', () => {
  it('显式指定优先', () => {
    expect(resolveInterpreter('#!/bin/sh', 'python3')).toBe('python3');
  });

  it('没有指定则按 shebang 推断', () => {
    expect(resolveInterpreter('#!/usr/bin/env python3')).toBe('python3');
  });

  it('都没有 → bash', () => {
    expect(resolveInterpreter('echo hi')).toBe('bash');
  });
});

describe('buildScriptCommand', () => {
  it('bash 家族用 -s 从 stdin 读脚本', () => {
    expect(buildScriptCommand('bash')).toBe('bash -s');
    expect(buildScriptCommand('/bin/bash')).toBe('/bin/bash -s');
    expect(buildScriptCommand('sh')).toBe('sh -s');
  });

  it('其它解释器用 - 表示程序从 stdin 读', () => {
    // python3 -- args 会被 python 当成「脚本文件名是 args」，
    // 必须用 `python3 - args`
    expect(buildScriptCommand('python3')).toBe('python3 -');
    expect(buildScriptCommand('perl')).toBe('perl -');
  });

  it('参数正确分隔并转义', () => {
    expect(buildScriptCommand('bash', ['a', 'b'])).toBe('bash -s a b');
    expect(buildScriptCommand('bash', ['a b'])).toBe("bash -s 'a b'");
    expect(buildScriptCommand('python3', ['x', 'y'])).toBe('python3 - x y');
  });
});

describe('shellQuote', () => {
  it('普通 token 不加引号', () => {
    expect(shellQuote('abc-123_x.y')).toBe('abc-123_x.y');
  });

  it('含空格 / 特殊字符要加引号', () => {
    expect(shellQuote('a b')).toBe("'a b'");
    // POSIX 标准转义：'it' + \' + 's'
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
  });
});
