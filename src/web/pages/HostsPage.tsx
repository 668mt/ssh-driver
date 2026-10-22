import React, { useEffect, useState } from 'react';

import { HostConfigDto, api } from '../api';
import { t } from '../i18n';
import { HostForm } from '../components/HostForm';

interface Props {
  notify: (kind: 'ok' | 'fail', msg: string) => void;
}

export const HostsPage: React.FC<Props> = ({ notify }) => {
  const [hosts, setHosts] = useState<HostConfigDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [initialForEdit, setInitialForEdit] = useState<HostConfigDto | undefined>();

  async function refresh(): Promise<void> {
    setLoading(true);
    try {
      setHosts(await api.listHosts());
    } catch (err) {
      notify('fail', t('fetchListFail', (err as Error).message));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function remove(id: string): Promise<void> {
    if (!confirm(t('confirmRemove', id))) return;
    try {
      await api.removeHost(id);
      notify('ok', t('removedOk', id));
      refresh();
    } catch (err) {
      notify('fail', t('removedFail', id) + ' · ' + (err as Error).message);
    }
  }

  async function test(id: string): Promise<void> {
    try {
      const r = await api.testHost(id);
      notify(r.ok ? 'ok' : 'fail', r.ok ? t('testOkMsg', id, r.banner ?? '') : t('testFailMsg', id, r.error));
    } catch (err) {
      notify('fail', (err as Error).message);
    }
  }

  async function startEdit(id: string): Promise<void> {
    try {
      const detail = await api.getHost(id);
      setInitialForEdit(detail);
      setEditing(id);
    } catch (err) {
      notify('fail', (err as Error).message);
    }
  }

  const filtered = hosts.filter((h) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return (
      h.hostId.toLowerCase().includes(q) ||
      h.host.toLowerCase().includes(q) ||
      h.username.toLowerCase().includes(q) ||
      (h.description ?? '').toLowerCase().includes(q) ||
      (Array.isArray(h.tags) ? h.tags.join(' ').toLowerCase() : '').includes(q)
    );
  });

  return (
    <div>
      <div className="toolbar">
        <input
          type="text"
          placeholder={t('searchPlaceholder')}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <button
          className="btn primary"
          onClick={() => {
            setInitialForEdit(undefined);
            setEditing('new');
          }}
        >
          {t('newHost')}
        </button>
        <button className="btn" onClick={refresh} disabled={loading}>
          {loading ? '…' : t('refresh')}
        </button>
      </div>

      {filtered.length === 0 && !loading && <div className="empty-tip">{t('emptyHosts')}</div>}

      <div className="host-list">
        {filtered.map((h) => {
          const tagArr = Array.isArray(h.tags)
            ? h.tags
            : String(h.tags ?? '').split(',').map((s) => s.trim()).filter(Boolean);
          return (
            <div className="host-row" key={h.hostId}>
              <div>
                <span className="title">{h.hostId}</span>
                <span style={{ color: 'var(--muted)' }}> · </span>
                <code>
                  {h.username}@{h.host}:{h.port ?? 22}
                </code>
                {h.description && <div className="meta">{h.description}</div>}
                {tagArr.length > 0 && (
                  <div className="meta">
                    {tagArr.map((tag) => (
                      <span className="tag" key={tag}>
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
                <div className="meta" style={{ fontSize: 11 }}>
                  更新于 {h.updatedAt ?? '(未知)'}
                </div>
              </div>
              <div className="actions">
                <button className="btn" onClick={() => test(h.hostId)}>
                  {t('test')}
                </button>
                <button className="btn" onClick={() => startEdit(h.hostId)}>
                  {t('edit')}
                </button>
                <button className="btn danger" onClick={() => remove(h.hostId)}>
                  {t('remove')}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {editing === 'new' && (
        <div
          className="modal-backdrop"
          onClick={(e) => e.target === e.currentTarget && setEditing(null)}
        >
          <HostForm
            onSaved={(id) => {
              setEditing(null);
              notify('ok', t('saveOk', id));
              refresh();
            }}
            onCancel={() => setEditing(null)}
          />
        </div>
      )}

      {editing && editing !== 'new' && (
        <div
          className="modal-backdrop"
          onClick={(e) => e.target === e.currentTarget && setEditing(null)}
        >
          <HostForm
            hostIdFixed={editing}
            initial={initialForEdit}
            onSaved={(id) => {
              setEditing(null);
              notify('ok', id === editing ? t('saveOk', id) : t('saveOk', id) + '（已重命名）');
              refresh();
            }}
            onCancel={() => setEditing(null)}
          />
        </div>
      )}
    </div>
  );
};
