/**
 * 极简 i18n：当前只支持 zh-CN，留个 hooks 方便以后扩 en
 * @Author Martin
 * @Date 2026/10/21
 */

import zhCN, { Strings } from './zh-CN';

export type Lang = 'zh-CN';

const STRINGS: Record<Lang, Strings> = {
  'zh-CN': zhCN,
};

const currentLang: Lang = 'zh-CN';

/** 纯字符串字段名 */
type StringKey = {
  [K in keyof Strings]: Strings[K] extends string ? K : never;
}[keyof Strings];

/** 函数字段（含参数） */
type FuncKey = {
  [K in keyof Strings]: Strings[K] extends (...args: never[]) => string ? K : never;
}[keyof Strings];

export function t(key: StringKey): string;
export function t<A1>(key: FuncKey, a1: A1): string;
export function t<A1, A2>(key: FuncKey, a1: A1, a2: A2): string;
export function t<A1, A2, A3>(key: FuncKey, a1: A1, a2: A2, a3: A3): string;
export function t(key: string, ...args: unknown[]): string {
  const value = (STRINGS[currentLang] as unknown as Record<string, unknown>)[key];
  if (typeof value === 'function') {
    return (value as (...a: unknown[]) => string)(...args);
  }
  return typeof value === 'string' ? value : key;
}

export function lang(): Lang {
  return currentLang;
}
