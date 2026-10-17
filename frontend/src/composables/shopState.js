// 店铺授权状态元数据：开放平台店铺表与「获取退单仓库」页共用的状态标签映射（单一来源）。
// 口径与改造前两处各自实现一致：valid=有效 / expiring=即将过期 / re_auth=需重新授权 / 其余=已过期。
export function shopStateMeta(s) {
  if (s.state === 'valid') return { type: 'success', label: '有效' };
  if (s.state === 'expiring') return { type: 'warning', label: '即将过期' };
  if (s.state === 're_auth') return { type: 'danger', label: '需重新授权' };
  return { type: 'danger', label: '已过期' };
}
