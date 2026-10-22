import React, { useId, useState } from 'react';

import { t } from '../i18n';

interface Props {
  label: string;
  value?: string;
  placeholder?: string;
  onChange: (next: string) => void;
  full?: boolean;
  rows?: number;
  /**
   * 兼容字段：当前后端直接返明文，没有 mask 的概念。
   * 保留这个 prop 只是为了不破坏旧调用，但不再有逻辑分支。
   * @deprecated 不再使用；保留以兼容旧代码
   */
  maskedInitial?: boolean;
}

/**
 * 通用输入；带个"显示 / 隐藏"开关，用于密码 / 私钥路径 / 私钥口令。
 *
 * 设计要点：
 * - React 不喜欢"原地切换 input 的 type"（受控组件 + value 不变时浏览器可能不重绘）。
 *   解决方案：show=true 时单独渲染一个新的 input，type=text，避免复用和重绘之间的状态错乱。
 * - 后端已直接返明文，这里只是普通的"显示 / 隐藏"切换。
 */
export const SecretInput: React.FC<Props> = ({
  label,
  value,
  placeholder,
  onChange,
  full,
  rows,
}) => {
  const [show, setShow] = useState(false);
  const isSecret = rows === undefined;
  const initialValue = value ?? '';
  const reactId = useId();
  const inputId = `sec-${reactId}`;

  if (!isSecret) {
    return (
      <label className={full ? 'full' : ''}>
        <span>{label}</span>
        <textarea
          value={initialValue}
          placeholder={placeholder ?? ''}
          onChange={(e) => onChange(e.target.value)}
          rows={rows}
        />
      </label>
    );
  }

  return (
    <label
      htmlFor={inputId}
      className={full ? 'full' : ''}
      style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
    >
      <span style={{ fontSize: 12, color: 'var(--muted)' }}>{label}</span>
      <div style={{ display: 'flex', gap: 6, alignItems: 'stretch' }}>
        {show ? (
          <input
            id={inputId}
            type="text"
            value={initialValue}
            placeholder={placeholder ?? ''}
            onChange={(e) => onChange(e.target.value)}
            style={{ flex: 1 }}
            autoComplete="off"
            spellCheck={false}
            data-secret-mode="text"
          />
        ) : (
          <input
            id={inputId}
            type="password"
            value={initialValue}
            placeholder={placeholder ?? ''}
            onChange={(e) => onChange(e.target.value)}
            style={{ flex: 1 }}
            autoComplete="off"
            spellCheck={false}
            data-secret-mode="password"
          />
        )}
        <button
          type="button"
          className="btn ghost"
          aria-pressed={show}
          aria-label={show ? t('hidePassword') : t('showPassword')}
          title={show ? t('hidePassword') : t('showPassword')}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setShow((v) => !v)}
          style={{ padding: '0 10px', minWidth: 56 }}
        >
          {show ? '🙈 隐藏' : '👁 显示'}
        </button>
      </div>
    </label>
  );
};
