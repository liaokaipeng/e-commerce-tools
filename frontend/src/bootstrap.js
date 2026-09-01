// 页面统一挂载入口：Element Plus 注册 + 挂载 #app
// 八个页面入口（portal / tiktok / bidding / bidding-cancel / product-export / video / openapi / monitor）共用，
// 各页 main.js 只需引入本文件、主题样式与页面 App，避免重复的 createApp 样板。
import { createApp } from 'vue';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';

/** 创建应用并挂载到 #app（Element Plus 已全局注册） */
export function mount(App) {
  return createApp(App).use(ElementPlus).mount('#app');
}
