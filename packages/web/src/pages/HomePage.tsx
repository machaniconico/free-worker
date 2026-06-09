import { useEffect, useState } from 'react';
import { api, type Health } from '../api.js';

export function HomePage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Health>('/api/health')
      .then(setHealth)
      .catch((e: unknown) => setError(String(e)));
  }, []);

  return (
    <div>
      <h1>ホーム</h1>
      <p className="lead">
        クラウドAIが使えなくなっても、この画面のすべての機能はローカルだけで動きます。
        データは端末内の SQLite に保存され、外部へ送信されません。
      </p>

      <section className="card">
        <h2>稼働状況</h2>
        {error && <p className="error">サーバへ接続できません: {error}</p>}
        {health ? (
          <ul className="kv">
            <li><span>状態</span><b>{health.status}</b></li>
            <li><span>オフライン動作</span><b>{health.offline ? 'はい' : 'いいえ'}</b></li>
            <li><span>適用済みマイグレーション</span><b>{health.migrations}</b></li>
          </ul>
        ) : (
          !error && <p>確認中…</p>
        )}
      </section>

      <section className="card">
        <h2>MVP 機能(順次実装)</h2>
        <ul className="epics">
          <li>事業プロフィール</li>
          <li>法令・税務チェックリスト</li>
          <li>商品・サブスク管理(掲載項目の欠落警告)</li>
          <li>売上・請求(CSV入出力・月次集計)</li>
          <li>暗号化ローカルバックアップ(復元テストログ)</li>
        </ul>
      </section>
    </div>
  );
}
