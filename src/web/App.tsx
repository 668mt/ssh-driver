import React, { useEffect, useState } from 'react';

import { HostsPage } from './pages/HostsPage';
import { ImportExportPage } from './pages/ImportExportPage';
import { api } from './api';
import { t } from './i18n';

type Tab = 'hosts' | 'io';

interface Toast {
  id: number;
  kind: 'ok' | 'fail';
  msg: string;
}

let toastSeq = 0;

export const App: React.FC = () => {
  const [tab, setTab] = useState<Tab>('hosts');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [backendOk, setBackendOk] = useState<boolean | null>(null);
  const [configPath, setConfigPath] = useState<string>('');

  useEffect(() => {
    api.health().then(
      (r) => {
        setBackendOk(r.ok);
        setConfigPath(r.configPath);
      },
      () => setBackendOk(false),
    );
  }, []);

  function notify(kind: 'ok' | 'fail', msg: string): void {
    const id = ++toastSeq;
    setToasts((ts) => [...ts, { id, kind, msg }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 4000);
  }

  function dismiss(id: number): void {
    setToasts((ts) => ts.filter((x) => x.id !== id));
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <h1>ssh-driver</h1>
        <nav>
          <button
            className={tab === 'hosts' ? 'active' : ''}
            onClick={() => setTab('hosts')}
          >
            {t('tabHosts')}
          </button>
          <button
            className={tab === 'io' ? 'active' : ''}
            onClick={() => setTab('io')}
          >
            {t('tabImportExport')}
          </button>
        </nav>
        <div className="footer">
          <div>
            {backendOk === null
              ? t('healthLoading')
              : backendOk
                ? t('healthOk')
                : t('healthDown')}
          </div>
          <div style={{ marginTop: 4 }}>{configPath}</div>
        </div>
      </aside>

      <main className="main">
        <h2 className="section-title">
          {tab === 'hosts' ? t('sectionHosts') : t('sectionIO')}
        </h2>
        {tab === 'hosts' ? (
          <HostsPage notify={notify} />
        ) : (
          <ImportExportPage notify={notify} onChanged={() => setTab('hosts')} />
        )}
      </main>

      <div className="toast-stack">
        {toasts.map((x) => (
          <div key={x.id} className={`toast ${x.kind}`}>
            {x.msg}
            <button className="close" onClick={() => dismiss(x.id)} aria-label="关闭">
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
