import React, { useState } from 'react';

import { HostConfigDto, api } from '../api';
import { t } from '../i18n';
import { SecretInput } from './SecretInput';

interface Props {
  initial?: Partial<HostConfigDto>;
  /** 创建/更新完成后回调，传回最终的 hostId */
  onSaved: (hostId: string) => void;
  onCancel: () => void;
  /** 编辑模式：用此 hostId 调 PUT，并允许改名 */
  hostIdFixed?: string;
}

const blank: HostConfigDto = {
  hostId: '',
  host: '',
  port: 22,
  username: '',
  password: '',
  privateKey: '',
  passphrase: '',
  description: '',
  tags: [],
  readyTimeout: 15000,
};

export const HostForm: React.FC<Props> = ({ initial, onSaved, onCancel, hostIdFixed }) => {
  const [form, setForm] = useState<HostConfigDto>({ ...blank, ...initial });
  const [submitting, setSubmitting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<null | { ok: boolean; msg: string }>(null);
  const [error, setError] = useState<string | null>(null);
  const isEdit = !!hostIdFixed;
  // 后端现在直接返回明文；这里保留 maskedInitial=false 以让 SecretInput 接收真值。
  const renamed = isEdit && form.hostId.trim() !== hostIdFixed;

  function patch<K extends keyof HostConfigDto>(key: K, value: HostConfigDto[K]): void {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleTest(): Promise<void> {
    setTesting(true);
    setTestResult(null);
    setError(null);
    try {
      // hostId 可能还没填（新增场景），后端会优先用 body 里的连接信息，
      // 所以这里直接传表单当前状态即可。
      const r = await api.testHost(form.hostId.trim() || '_', form);
      setTestResult({
        ok: r.ok,
        msg: r.ok ? `成功 · ${r.banner ?? ''}` : `失败 · ${r.error}`,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setTesting(false);
    }
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const payload: HostConfigDto = {
        ...form,
        hostId: form.hostId.trim(),
        port: Number(form.port) || 22,
        readyTimeout: Number(form.readyTimeout) || 15000,
        tags: Array.isArray(form.tags)
          ? form.tags
          : String(form.tags ?? '').split(',').map((s) => s.trim()).filter(Boolean),
      };

      if (isEdit) {
        await api.updateHost(hostIdFixed!, payload);
        onSaved(payload.hostId);
      } else {
        await api.createHost(payload);
        onSaved(payload.hostId);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="modal" onSubmit={handleSubmit}>
      <h2>{isEdit ? t('formEditTitle', hostIdFixed!) : t('formNewTitle')}</h2>

      {renamed && <div className="hint">{t('formRenamedHint')}</div>}

      <div className="form-grid">
        <label>
          <span>
            {t('fieldHostId')} <span className="kbd">{t('fieldHostIdRequired')}</span>
          </span>
          <input
            value={form.hostId}
            onChange={(e) => patch('hostId', e.target.value)}
            placeholder={t('phHostId')}
            required
            autoFocus
          />
        </label>
        <label>
          <span>{t('fieldDescription')}</span>
          <input value={form.description ?? ''} onChange={(e) => patch('description', e.target.value)} />
        </label>

        <label>
          <span>{t('fieldHost')}</span>
          <input
            value={form.host}
            onChange={(e) => patch('host', e.target.value)}
            placeholder={t('phHost')}
            required
          />
        </label>
        <label>
          <span>{t('fieldPort')}</span>
          <input
            type="number"
            value={form.port ?? 22}
            onChange={(e) => patch('port', Number(e.target.value) as unknown as number)}
          />
        </label>

        <label>
          <span>{t('fieldUsername')}</span>
          <input value={form.username} onChange={(e) => patch('username', e.target.value)} required />
        </label>
        <label>
          <span>{t('fieldReadyTimeout')}</span>
          <input
            type="number"
            value={form.readyTimeout ?? 15000}
            onChange={(e) => patch('readyTimeout', Number(e.target.value) as unknown as number)}
          />
        </label>

        <SecretInput
          label={t('fieldPassword')}
          value={form.password}
          onChange={(v) => patch('password', v)}
          placeholder={t('phPassword')}
        />
        <SecretInput
          label={t('fieldPrivateKey')}
          value={form.privateKey}
          onChange={(v) => patch('privateKey', v)}
          placeholder={t('phPrivateKey')}
        />

        <SecretInput
          label={t('fieldPassphrase')}
          value={form.passphrase}
          onChange={(v) => patch('passphrase', v)}
        />
        <label className="full">
          <span>{t('fieldTags')}</span>
          <input
            value={Array.isArray(form.tags) ? form.tags.join(',') : (form.tags as unknown as string) ?? ''}
            onChange={(e) =>
              patch('tags', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))
            }
            placeholder={t('fieldTagsPh')}
          />
        </label>
      </div>

      {testResult && (
        <div className={`test-result ${testResult.ok ? 'ok' : 'fail'}`}>
          <code>{testResult.msg}</code>
        </div>
      )}
      {error && (
        <div className="test-result fail">
          <code>{error}</code>
        </div>
      )}

      <div className="modal-footer">
        <button type="button" className="btn" onClick={onCancel} disabled={submitting || testing}>
          {t('cancel')}
        </button>
        <button
          type="button"
          className="btn"
          onClick={handleTest}
          disabled={submitting || testing || !form.host || !form.username}
        >
          {testing ? t('testing') : t('test')}
        </button>
        <button type="submit" className="btn primary" disabled={submitting || testing}>
          {submitting ? t('saving') : isEdit ? t('save') : t('create')}
        </button>
      </div>
    </form>
  );
};
