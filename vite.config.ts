import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import * as path from 'path';

// 在 dev 模式下，把 /api 代理到后端（默认 http://127.0.0.1:7843）。
// 在生产模式下，后端自己 serve dist-server/web/。
const BACKEND = process.env.SSH_DRIVER_BACKEND ?? 'http://127.0.0.1:7843';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, 'dist-server', 'web'),
    emptyOutDir: true,
  },
  server: {
    port: 5174,
    strictPort: false,
    proxy: {
      '/api': {
        target: BACKEND,
        changeOrigin: true,
        // dev 模式下前端跑在 vite 上，没有服务端注入的令牌 meta，
        // 由代理统一把令牌塞进请求头。
        configure: proxy => {
          proxy.on('proxyReq', (proxyReq) => {
            const token = process.env.SSH_DRIVER_TOKEN;
            if (token) proxyReq.setHeader('x-ssh-driver-token', token);
          });
        },
      },
    },
  },
});
