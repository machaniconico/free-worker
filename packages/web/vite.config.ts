import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 開発時は Vite(5173)→ サーバ(4319)へ /api をプロキシ。
// ビルド成果物(dist)はサーバが静的配信する(完全オフライン動作)。
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:4319',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
