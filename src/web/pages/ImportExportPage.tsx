import React, { useState } from 'react';

import { HostConfigDto, api } from '../api';
import { t } from '../i18n';

interface Props {
  notify: (kind: 'ok' | 'fail', msg: string) => void;
  onChanged: () => void;
}

export const ImportExportPage: React.FC<Props> = ({ notify, onChanged }) => {
  const [exportedText, setExportedText] = useState<string>('');
  const [importText, setImportText] = useState<string>('');
  const [importMode, setImportMode] = useState<'replace' | 'merge'>('replace');
  const [busy, setBusy] = useState(false);

  async function handleExport(): Promise<void> {
    setBusy(true);
    try {
      const data = await api.exportConfig();
      const text = JSON.stringify(data, null, 2);
      setExportedText(text);
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'ssh-driver-config.json';
      a.click();
      URL.revokeObjectURL(url);
      notify('ok', '已生成下载文件，请检查浏览器下载目录');
    } catch (err) {
      notify('fail', (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleImport(): Promise<void> {
    setBusy(true);
    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(importText);
      } catch (err) {
        notify('fail', t('importInvalidJson', (err as Error).message));
        return;
      }
      const obj = parsed as { hosts?: HostConfigDto[] };
      if (!obj || !Array.isArray(obj.hosts)) {
        notify('fail', t('importInvalidJson', 'expected an object with a "hosts" array'));
        return;
      }
      const r = await api.importConfig(obj.hosts, importMode);
      notify('ok', t('importOk', r.imported, r.total, r.mode));
      onChanged();
    } catch (err) {
      notify('fail', (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="import-export">
      <div className="io-card">
        <h3>{t('exportTitle')}</h3>
        <p>{t('exportDesc')}</p>
        <button className="btn primary" onClick={handleExport} disabled={busy}>
          {t('exportDownload')}
        </button>
        {exportedText && (
          <textarea
            readOnly
            style={{ marginTop: 12 }}
            value={exportedText}
            onFocus={(e) => e.target.select()}
          />
        )}
      </div>

      <div className="io-card">
        <h3>{t('importTitle')}</h3>
        <p>{t('importDesc')}</p>
        <textarea
          placeholder={t('importPlaceholder')}
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
        />
        <div className="mode-row">
          <label>
            <input
              type="radio"
              name="mode"
              value="replace"
              checked={importMode === 'replace'}
              onChange={() => setImportMode('replace')}
            />
            {t('importModeReplace')}
          </label>
          <label>
            <input
              type="radio"
              name="mode"
              value="merge"
              checked={importMode === 'merge'}
              onChange={() => setImportMode('merge')}
            />
            {t('importModeMerge')}
          </label>
          <span style={{ flex: 1 }} />
          <button
            className="btn primary"
            onClick={handleImport}
            disabled={busy || !importText.trim()}
          >
            {busy ? t('working') : t('importRun')}
          </button>
        </div>
      </div>
    </div>
  );
};
