import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // 集成测试会起 HTTP 服务，给足超时
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
