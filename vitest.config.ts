import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    environment: 'node',
    // 実行時にネットワークへ出ない方針。テストもネット不要。
    globals: false,
  },
});
