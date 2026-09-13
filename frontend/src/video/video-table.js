// 视频上传页 · 表格纯函数与常量（无副作用、不依赖 Vue）。
// CSV 解析、预览行校验、状态文案常量都集中在此，供 useVideoTable 与展示组件共享。
// 注意：校验文案与阈值必须与后端 server/lib/video-utils.js 的 validateUploadRow 保持一致；
// 文件是否存在等需访问文件系统的检查由后端兜底。

/** 必需表头（缺一不可，不做列名映射） */
export const REQUIRED_HEADERS = ['视频路径', '视频说明', '商品编码'];

export const CAPTION_MAX_LENGTH = 250;

/** 行状态 → 展示文案（VideoSteps 状态列与结果表格导出共用单一来源） */
export const STATUS_TEXT = { run: '上传中', ok: '成功', err: '失败', 'no-product': '失败，商品为空' };

/** 即时预览校验（纯规则，与后端 video-utils.validateUploadRow 同步） */
export function validateRow({ path, caption }) {
  if (!path) return '缺少视频路径';
  if (caption && caption.length > CAPTION_MAX_LENGTH) return `视频说明超过${CAPTION_MAX_LENGTH}字符，请精简后再上传`;
  if (caption && /tiktok/i.test(caption)) return '视频说明不能包含 tiktok 字样';
  return '';
}

/** 解析 CSV 文本（支持引号包裹与转义 ""） */
export function parseCSV(text) {
  const out = [];
  let row = [], cur = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n') { row.push(cur); out.push(row); row = []; cur = ''; }
    else if (ch !== '\r') cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); out.push(row); }
  if (!out.length) return [];
  const head = out[0];
  return out.slice(1).map((r) => {
    const o = {};
    head.forEach((h, i) => (o[h] = (r[i] ?? '').trim()));
    return o;
  });
}
