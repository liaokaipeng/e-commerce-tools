import { mount } from '../bootstrap.js';
import 'element-plus/theme-chalk/dark/css-vars.css';
// 本页样式为页面级（非 scoped）：monitor 是独立 HTML 文档，不会影响其他工具页，
// 这样共用类只需定义一次，子组件无需各自重复样式。
import './monitor.css';
import App from './App.vue';

mount(App);
