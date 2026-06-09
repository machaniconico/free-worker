import { useEffect, useState } from 'react';
import { api } from '../api.js';

interface BackupEntry {
  id?: string;
  createdAt?: string;
  filePath?: string;
  note?: string;
  [k: string]: unknown;
}

interface RestoreTestResult {
  success: boolean;
  message?: string;
  [k: string]: unknown;
}

export function BackupPage() {
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [passphrase, setPassphrase] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Restore test state
  const [restoreFilePath, setRestoreFilePath] = useState('');
  const [restorePass, setRestorePass] = useState('');
  const [restoreResult, setRestoreResult] = useState<RestoreTestResult | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    api.get<BackupEntry[]>('/api/backup')
      .then(setBackups)
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const createBackup = async () => {
    if (!passphrase) { setError('パスフレーズを入力してください'); return; }
    setError(null);
    setMsg(null);
    try {
      await api.post('/api/backup', { passphrase, note: note || undefined });
      setMsg('バックアップを作成しました');
      setPassphrase('');
      setNote('');
      load();
    } catch (e: unknown) {
      setError(String(e));
    }
  };

  const runRestoreTest = async () => {
    if (!restoreFilePath || !restorePass) { setRestoreError('ファイルパスとパスフレーズを入力してください'); return; }
    setRestoreError(null);
    setRestoreResult(null);
    try {
      const res = await api.post<RestoreTestResult>('/api/backup/restore-test', {
        filePath: restoreFilePath,
        passphrase: restorePass,
      });
      setRestoreResult(res);
    } catch (e: unknown) {
      setRestoreError(String(e));
    }
  };

  return (
    <div>
      <h1>バックアップ管理</h1>
      <p className="lead">暗号化バックアップの作成・復元テストを行います。</p>

      <section className="card" style={{ borderColor: 'var(--danger)', borderWidth: 1 }}>
        <h2 style={{ color: 'var(--danger)' }}>⚠️ 重要な注意事項</h2>
        <p style={{ color: 'var(--text)', margin: '0 0 4px' }}>
          <b>パスフレーズは保存されません。忘れると復元できません。</b>
        </p>
        <p style={{ color: 'var(--muted)', margin: 0, fontSize: 13 }}>
          パスフレーズは安全な場所(パスワードマネージャー等)に必ず保管してください。
        </p>
      </section>

      {error && <p className="error">{error}</p>}
      {msg && <p style={{ color: 'var(--accent-2)' }}>{msg}</p>}

      <section className="card">
        <h2>バックアップ作成</h2>
        <label className="field">
          <span>パスフレーズ *</span>
          <input
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            placeholder="強力なパスフレーズを入力"
            autoComplete="new-password"
          />
        </label>
        <label className="field">
          <span>メモ</span>
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="任意のメモ" />
        </label>
        <button className="btn primary" style={{ marginTop: 8 }} onClick={() => void createBackup()}>
          バックアップ作成
        </button>
      </section>

      <section className="card">
        <h2>復元テスト</h2>
        <label className="field">
          <span>ファイルパス *</span>
          <input type="text" value={restoreFilePath} onChange={(e) => setRestoreFilePath(e.target.value)} placeholder="/path/to/backup.enc" />
        </label>
        <label className="field">
          <span>パスフレーズ *</span>
          <input
            type="password"
            value={restorePass}
            onChange={(e) => setRestorePass(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        {restoreError && <p className="error">{restoreError}</p>}
        {restoreResult && (
          <div style={{
            marginTop: 8,
            padding: '10px 14px',
            borderRadius: 8,
            background: restoreResult.success ? 'rgba(43,191,138,0.12)' : 'rgba(255,107,107,0.12)',
            border: `1px solid ${restoreResult.success ? 'var(--accent-2)' : 'var(--danger)'}`,
            color: restoreResult.success ? 'var(--accent-2)' : 'var(--danger)',
          }}>
            {restoreResult.success ? '✓ 復元テスト成功' : '✗ 復元テスト失敗'}
            {restoreResult.message && <span style={{ marginLeft: 8, fontSize: 13 }}>{restoreResult.message}</span>}
          </div>
        )}
        <button className="btn" style={{ marginTop: 8 }} onClick={() => void runRestoreTest()}>
          復元テスト実行
        </button>
      </section>

      <section className="card">
        <h2>バックアップ履歴</h2>
        {loading && <p style={{ color: 'var(--muted)' }}>読み込み中…</p>}
        {!loading && backups.length === 0 && <p style={{ color: 'var(--muted)' }}>バックアップがありません。</p>}
        {backups.length > 0 && (
          <table className="data-table">
            <thead>
              <tr>
                <th>作成日時</th>
                <th>ファイルパス</th>
                <th>メモ</th>
              </tr>
            </thead>
            <tbody>
              {backups.map((b, i) => (
                <tr key={b.id ?? i}>
                  <td>{String(b.createdAt ?? '—')}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{String(b.filePath ?? '—')}</td>
                  <td>{String(b.note ?? '—')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
