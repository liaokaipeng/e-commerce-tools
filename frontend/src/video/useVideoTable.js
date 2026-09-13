// 视频上传页 · 表格状态与解析/导出：持有列头与预览行状态，解析选中文件、生成模板、导出结果。
// 纯函数（CSV 解析 / 行校验 / 常量）见 video-table.js；workbook 构建与下载样板见 utils/xlsx.js。
import { ref } from 'vue';
import { ElMessage } from 'element-plus';
import { REQUIRED_HEADERS, STATUS_TEXT, validateRow, parseCSV } from './video-table.js';
import { xlsxReady, readFirstSheetRows, downloadAoaXlsx } from '../utils/xlsx.js';

// 保持原有对外导出（VideoSteps 等消费方按名导入），单一来源仍是 video-table.js
export { REQUIRED_HEADERS, CAPTION_MAX_LENGTH, STATUS_TEXT, validateRow, parseCSV } from './video-table.js';

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
    if (isExcel && !xlsxReady()) {
      ElMessage.error('SheetJS 未加载，请确认 xlsx.full.min.js 存在');
      return false;
    }
    const buf = await file.arrayBuffer();
    let raw = [];
    if (isExcel) {
      raw = readFirstSheetRows(buf);
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
    if (!xlsxReady()) { ElMessage.error('SheetJS 未加载，无法生成模板'); return; }
    const aoa = [
      ['视频路径', '视频说明', '商品编码'],
      ['C:\\Users\\84463\\Videos\\video1.mp4', '夏季新款连衣裙展示', '18673144460'],
      ['C:\\Users\\84463\\Videos\\video2.mp4', '男士运动鞋开箱', '18673144461'],
      ['C:\\Users\\84463\\Videos\\video3.mp4', '', ''],
    ];
    downloadAoaXlsx(aoa, '视频上传', '视频批量上传模板.xlsx');
  }

  /** 导出带【状态】列的结果表格：保留原表全部列与行序，追加/覆盖「状态」列后下载 <原名>_结果.xlsx。
   *  浏览器无法改写磁盘上的原文件，以「下载结果副本」的方式落到实际表格里。 */
  function exportResult() {
    if (!xlsxReady()) { ElMessage.error('SheetJS 未加载，无法导出结果表格'); return; }
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
    downloadAoaXlsx(aoa, '视频上传', `${sourceName}_结果.xlsx`);
  }

  return {
    headers, rows,
    parseFile, rebuildRows, downloadTemplate, exportResult,
  };
}
