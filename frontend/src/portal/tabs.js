// 门户页 Tab 清单：每个工具对应一个常驻 iframe 入口。
// 视频上传按站点拆「跨境 / 本土」两个入口，共用 /video/ 页面，经 ?mode=cn|ph 区分站点。
export const TABS = [
  { key: 'bidding', label: '竞价导出', sub: '获胜数据 → Excel', group: 'Shopee', src: '/bidding/' },
  { key: 'bidding-cancel', label: '取消竞价', sub: '批量撤销待改进竞价', group: 'Shopee', src: '/bidding-cancel/' },
  { key: 'hotlisting-cancel', label: '取消Hot Listing', sub: '批量取消注册已注册 SKU', group: 'Shopee', src: '/hotlisting-cancel/' },
  { key: 'video-cn', label: '跨境视频上传', sub: '批量上传并关联商品', group: 'Shopee', src: '/video/?mode=cn' },
  { key: 'video-ph', label: '本土视频上传', sub: '菲律宾站点批量上传', group: 'Shopee', src: '/video/?mode=ph' },
  { key: 'openapi', label: '开放平台', sub: 'App 授权与 Token 管理', group: 'Shopee', src: '/openapi/' },
  { key: 'monitor', label: '监控大屏', sub: '多店巡检三级告警', group: 'Shopee', src: '/monitor/' },
  { key: 'tiktok', label: '视频下载', sub: '批量无水印下载', group: 'TikTok', src: '/tiktok/' },
];
