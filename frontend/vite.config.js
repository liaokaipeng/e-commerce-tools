// Vite 多页应用配置：门户 + 工具页，构建到 dist/ 由后端 main.js 托管
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  base: '/',
  server: {
    port: 5173,
    // 开发模式下把后端 API 代理到 main.js（8765），前端页面即可直接联调
    proxy: {
      '/api': 'http://127.0.0.1:8765',
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        portal: 'index.html',
        tiktok: 'tiktok/index.html',
        bidding: 'bidding/index.html',
        'bidding-cancel': 'bidding-cancel/index.html',
        video: 'video/index.html',
        openapi: 'openapi/index.html',
      },
    },
  },
});