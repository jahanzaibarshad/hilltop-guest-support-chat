import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    environmentOptions: { jsdom: { pretendToBeVisual: true } },
    setupFiles: ['./src/test/setup.js'],
    include: ['src/test/**/*.test.jsx'],
  },
  server: {
    host: '127.0.0.1',
    port: 5175,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:5001', changeOrigin: true },
      '/socket.io': { target: 'http://127.0.0.1:5001', ws: true, changeOrigin: false },
    },
  },
});
