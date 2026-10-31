// 门户页 Tab 清单：每个工具对应一个常驻 iframe 入口。
// 视频上传按站点拆「跨境 / 本土」两个入口，共用 /video/ 页面，经 ?mode=cn|ph 区分站点。
// group 决定侧栏分组，分组顺序见 portal/App.vue 的 GROUP_ORDER；icon 为侧栏菜单项图标（EP 图标组件）。
import {
  DataAnalysis,
  CircleClose,
  DeleteFilled,
  Box,
  UploadFilled,
  VideoCamera,
  Key,
  Monitor,
  Download,
} from '@element-plus/icons-vue';

export const TABS = [
  { key: 'bidding', label: '竞价导出', sub: '获胜数据 → Excel', group: 'Shopee', src: '/bidding/', icon: DataAnalysis },
  { key: 'bidding-cancel', label: '取消竞价', sub: '批量撤销待改进竞价', group: 'Shopee', src: '/bidding-cancel/', icon: CircleClose },
  { key: 'hotlisting-cancel', label: '取消Hot Listing', sub: '批量取消注册已注册 SKU', group: 'Shopee', src: '/hotlisting-cancel/', icon: DeleteFilled },
  { key: 'return-whs', label: '获取退单仓库', sub: 'Return ID → 退货仓 whs_id', group: 'Shopee', src: '/return-whs/', icon: Box },
  { key: 'video-cn', label: '跨境视频上传', sub: '批量上传并关联商品', group: 'Shopee', src: '/video/?mode=cn', icon: UploadFilled },
  { key: 'video-ph', label: '本土视频上传', sub: '菲律宾站点批量上传', group: 'Shopee', src: '/video/?mode=ph', icon: VideoCamera },
  { key: 'openapi', label: '开放平台', sub: 'App 授权与 Token 管理', group: 'Shopee', src: '/openapi/', icon: Key },
  { key: 'monitor', label: '监控大屏', sub: '多店巡检三级告警', group: 'Shopee', src: '/monitor/', icon: Monitor },
  { key: 'tiktok', label: '视频下载', sub: '批量无水印下载', group: 'TikTok', src: '/tiktok/', icon: Download },
];

/** 侧栏分组展示顺序（只影响顺序；某分组下没有 Tab 时不会被渲染） */
export const GROUP_ORDER = ['Shopee', 'TikTok', '其他'];
