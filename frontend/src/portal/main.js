import { mount } from '../bootstrap.js';
// 门户是独立 HTML 文档：显式引入浅色令牌（base.css，含 Element Plus 变量覆盖，供 UpdateDrawer 取值）
// 与深色令牌（dark-tokens.css，侧栏 --d-*）；portal.css 只保留门户布局与侧栏专属令牌。
import '../styles/base.css';
import '../styles/dark-tokens.css';
import App from './App.vue';

mount(App);
