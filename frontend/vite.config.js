// Vite 多页应用配置：门户 + 工具页，构建到 dist/ 由后端 main.js 托管
// root 指向 src：HTML 入口与页面源码同目录（src/<page>/index.html + main.js + 组件），
// 避免「入口壳」与「源码」出现同名文件夹；产物仍落在 dist/<page>/index.html，页面 URL 不变。
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';

// rollupOptions.input 按配置文件位置解析为绝对路径（相对 cwd 会解析错）
const src = (p) => fileURLToPath(new URL('src/' + p, import.meta.url));

export default defineConfig({
  root: 'src',
  publicDir: '../public',
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
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        portal: src('index.html'),
        tiktok: src('tiktok/index.html'),
        bidding: src('bidding/index.html'),
        'bidding-cancel': src('bidding-cancel/index.html'),
        'hotlisting-cancel': src('hotlisting-cancel/index.html'),
        video: src('video/index.html'),
        openapi: src('openapi/index.html'),
        monitor: src('monitor/index.html'),
      },
    },
  },
});