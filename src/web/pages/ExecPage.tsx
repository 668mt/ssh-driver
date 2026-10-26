import React, { useCallback, useEffect, useState } from 'react';

import { api } from '../api';
import { t } from '../i18n';

interface Props {
  notify: (kind: 'ok' | 'fail', msg: string) => void;
}

interface RunResult {
  stdout: string;
  stderr: string;
  code: number | null;
  interpreter?: string;
}

interface HistoryRow {
  ts: string;
  hostId: string;
  action: string;
  command?: string;
  script?: string;
  code?: number | null;
  durationMs?: number;
  ok: boolean;
  error?: string;
}

type Mode = 'command' | 'script';

export const ExecPage: React.FC<Props> = ({ notify }) => {
  const [hosts, setHosts] = useState<Array<{ hostId: string; description?: string }>>([]);
  const [hostId, setHostId] = useState('');
  const [mode, setMode] = useState<Mode>('command');
  const [command, setCommand] = useState('');
  const [script, setScript] = useState('');
  const [interpreter, setInterpreter] = useState('');
  const [args, setArgs] = useState('');
  const [timeoutMs, setTimeoutMs] = useState(60000);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);

  const loadHosts = useCallback(async () => {
    try {
      const list = await api.listHosts();
      setHosts(list.map(h => ({ hostId: h.hostId, description: h.description })));
      setHostId(prev => prev || (list[0]?.hostId ?? ''));
    } catch (err) {
      notify('fail', (err as Error).message);
    }
  }, [notify]);

  const loadHistory = useCallback(async () => {
    try {
      const res = await api.history(10, hostId || undefined);
      setHistory(res.entries ?? []);
    } catch {
      /* 历史加载失败不影响主流程 */
    }
  }, [hostId]);

  useEffect(() => {
    void loadHosts();
  }, [loadHosts]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  async function run(): Promise<void> {
    if (!hostId) {
      notify('fail', t('execNoHost'));
      return;
    }
    if (mode === 'command' && !command.trim()) {
      notify('fail', t('execNoCommand'));
      return;
    }
    if (mode === 'script' && !script.trim()) {
      notify('fail', t('execNoScript'));
      return;
    }

    setRunning(true);
    setResult(null);
    try {
      const res =
        mode === 'command'
          ? await api.execCommand(hostId, command, { timeoutMs })
          : await api.execScript(hostId, script, {
              interpreter: interpreter.trim() || undefined,
              args: args.trim() ? args.trim().split(/\s+/) : undefined,
              timeoutMs,
            });
      setResult(res);
      notify(
        'ok',
        t('execDone', hostId, res.code ?? 0),
      );
      void loadHistory();
    } catch (err) {
      notify('fail', `${t('execFail')} · ${(err as Error).message}`);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="exec-page">
      <div className="exec-form">
        <div className="exec-row">
          <label className="exec-label">{t('execHost')}</label>
          <select value={hostId} onChange={(e) => setHostId(e.target.value)}>
            {hosts.length === 0 && <option value="">{t('execNoHosts')}</option>}
            {hosts.map(h => (
              <option key={h.hostId} value={h.hostId}>
                {h.hostId}
                {h.description ? ` · ${h.description}` : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="exec-row">
          <label className="exec-label">{t('execMode')}</label>
          <div className="mode-row">
            <label>
              <input
                type="radio"
                name="execMode"
                checked={mode === 'command'}
                onChange={() => setMode('command')}
              />
              {t('execModeCommand')}
            </label>
            <label>
              <input
                type="radio"
                name="execMode"
                checked={mode === 'script'}
                onChange={() => setMode('script')}
              />
              {t('execModeScript')}
            </label>
            <span style={{ flex: 1 }} />
            <label className="exec-inline">
              {t('execTimeout')}
              <input
                type="number"
                style={{ width: 110 }}
                value={timeoutMs}
                onChange={(e) => setTimeoutMs(Number(e.target.value) || 60000)}
              />
            </label>
          </div>
        </div>

        {mode === 'command' ? (
          <div className="exec-row">
            <label className="exec-label">{t('execCommand')}</label>
            <textarea
              rows={6}
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder={t('execCommandPh')}
              spellCheck={false}
            />
          </div>
        ) : (
          <>
            <div className="exec-row">
              <label className="exec-label">{t('execScript')}</label>
              <textarea
                rows={10}
                value={script}
                onChange={(e) => setScript(e.target.value)}
                placeholder={'#!/bin/bash\nset -e\necho "hello $1"'}
                spellCheck={false}
              />
            </div>
            <div className="exec-row">
              <label className="exec-label">{t('execInterpreter')}</label>
              <input
                value={interpreter}
                onChange={(e) => setInterpreter(e.target.value)}
                placeholder="bash"
              />
            </div>
            <div className="exec-row">
              <label className="exec-label">{t('execArgs')}</label>
              <input
                value={args}
                onChange={(e) => setArgs(e.target.value)}
                placeholder="arg1 arg2"
              />
            </div>
          </>
        )}

        <div className="exec-actions">
          <button className="btn primary" onClick={run} disabled={running || !hostId}>
            {running ? t('execRunning') : t('execRun')}
          </button>
        </div>
      </div>

      {result && (
        <div className="exec-result">
          <div className="exec-result-head">
            <span className={result.code === 0 ? 'code ok' : 'code fail'}>
              exit {result.code ?? 'null'}
            </span>
            {result.interpreter && <span className="muted"> · {result.interpreter}</span>}
          </div>
          {result.stdout && <pre className="stdout">{result.stdout}</pre>}
          {result.stderr && <pre className="stderr">{result.stderr}</pre>}
          {!result.stdout && !result.stderr && <div className="muted">（无输出）</div>}
        </div>
      )}

      {history.length > 0 && (
        <div className="exec-history">
          <h3>{t('execHistory')}</h3>
          <table>
            <tbody>
              {history.map((h, i) => (
                <tr key={`${h.ts}-${i}`}>
                  <td className="ts">{h.ts.replace('T', ' ').slice(0, 19)}</td>
                  <td className={h.ok ? 'ok' : 'fail'}>{h.ok ? 'OK' : 'FAIL'}</td>
                  <td>{h.hostId}</td>
                  <td className="cmd" title={h.command ?? h.script ?? ''}>
                    {h.command ?? h.script ?? h.action}
                  </td>
                  <td className="muted">{h.durationMs != null ? `${h.durationMs}ms` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
