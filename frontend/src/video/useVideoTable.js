// 视频上传页 · 表格解析与行校验。
// 从 video/App.vue 抽出：CSV / xlsx 解析、预览行重建与即时校验。
// 注意：校验文案与阈值必须与后端 server/lib/video-utils.js 的 validateUploadRow 保持一致；
// 文件是否存在等需访问文件系统的检查由后端兜底。
import { ref } from 'vue';
import { ElMessage } from 'element-plus';

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

export function useVideoTable() {
  const headers = ref([]);
  const rows = ref([]); // { path, caption, product, error, status }
  let rawRows = [];
  let sourceName = ''; // 原表格文件名（去扩展名），导出结果表格时用

  function rebuildRows(raw) {
    rawRows = raw;
    rows.value = raw.map((r) => {
      const path = (r['视频路径'] || '').toString().trim();
      const caption = (r['视频说明'] || '').toString().trim();
      const product = (r['商品编码'] || '').toString().trim();
      return { path, caption, product, error: validateRow({ path, caption }), status: '' };
    });
  }

  /** 解析选中的文件（xlsx 走 SheetJS，csv 走内置解析）。表头缺列直接报错，不解析。 */
  async function parseFile(file) {
    if (!file) { ElMessage.warning('请先选择表格文件'); return false; }
    const isExcel = /\.xlsx?$/i.test(file.name);
    if (isExcel && !window.XLSX) {
      ElMessage.error('SheetJS 未加载，请确认 xlsx.full.min.js 存在');
      return false;
    }
    const buf = await file.arrayBuffer();
    let raw = [];
    if (isExcel) {
      const wb = window.XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      raw = window.XLSX.utils.sheet_to_json(ws, { defval: '' });
    } else {
      raw = parseCSV(new TextDecoder('utf-8').decode(buf));
    }
    if (!raw.length) { ElMessage.warning('未解析到数据'); return false; }
    const missing = REQUIRED_HEADERS.filter((h) => !Object.keys(raw[0]).includes(h));
    if (missing.length) {
      ElMessage.error(`表格表头不符合要求，缺少：${missing.join('、')}。表头必须包含：视频路径、视频说明、商品编码。`);
      return false;
    }
    headers.value = Object.keys(raw[0]);
    sourceName = (file.name || '').replace(/\.(xlsx|xls|csv)$/i, '') || '视频上传';
    rebuildRows(raw);
    return true;
  }

  /** 下载 xlsx 模板（示例数据一行含说明、两行空说明） */
  function downloadTemplate() {
    if (!window.XLSX) { ElMessage.error('SheetJS 未加载，无法生成模板'); return; }
    const aoa = [
      ['视频路径', '视频说明', '商品编码'],
      ['C:\\Users\\84463\\Videos\\video1.mp4', '夏季新款连衣裙展示', '18673144460'],
      ['C:\\Users\\84463\\Videos\\video2.mp4', '男士运动鞋开箱', '18673144461'],
      ['C:\\Users\\84463\\Videos\\video3.mp4', '', ''],
    ];
    const ws = window.XLSX.utils.aoa_to_sheet(aoa);
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, '视频上传');
    window.XLSX.writeFile(wb, '视频批量上传模板.xlsx');
  }

  /** 导出带【状态】列的结果表格：保留原表全部列与行序，追加/覆盖「状态」列后下载 <原名>_结果.xlsx。
   *  浏览器无法改写磁盘上的原文件，以「下载结果副本」的方式落到实际表格里。 */
  function exportResult() {
    if (!window.XLSX) { ElMessage.error('SheetJS 未加载，无法导出结果表格'); return; }
    if (!rawRows.length || !headers.value.length) { ElMessage.warning('请先解析表格再导出结果'); return; }
    // 原表已有「状态」列则原位覆盖，避免出现两列状态
    const hs = headers.value.slice();
    let statusCol = hs.findIndex((h) => (h || '').toString().trim() === '状态');
    if (statusCol < 0) { statusCol = hs.length; hs.push('状态'); }
    const statusOf = (row) => (row && row.error) || STATUS_TEXT[row && row.status] || '';
    const aoa = [hs];
    rawRows.forEach((r, i) => {
      const vals = hs.map((h, j) => (j === statusCol ? '' : (r[h] ?? '')));
      vals[statusCol] = statusOf(rows.value[i]);
      aoa.push(vals);
    });
    const ws = window.XLSX.utils.aoa_to_sheet(aoa);
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, '视频上传');
    window.XLSX.writeFile(wb, `${sourceName}_结果.xlsx`);
  }

  return {
    headers, rows,
    parseFile, rebuildRows, downloadTemplate, exportResult,
  };
}
