// 共享 xlsx 工具：基于页面全局 window.XLSX（SheetJS）的 workbook 构建、读取与下载样板。
// 各页面只传纯数据（AOA / ArrayBuffer），不重复写 SheetJS 细节；未加载时由调用方负责提示。

/** 是否已加载 SheetJS（xlsx.full.min.js 由 index.html 引入） */
export function xlsxReady() {
  return !!window.XLSX;
}

/** 读取二进制内容的首个工作表为对象数组（defval:'' 让空单元格保留空串） */
export function readFirstSheetRows(arrayBuffer) {
  const wb = window.XLSX.read(arrayBuffer, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return window.XLSX.utils.sheet_to_json(ws, { defval: '' });
}

/** 把二维数组（AOA）包成单工作表 workbook */
export function buildWorkbook(aoa, sheetName) {
  const ws = window.XLSX.utils.aoa_to_sheet(aoa);
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return wb;
}

/** 下载 workbook 为 xlsx 文件 */
export function downloadWorkbook(wb, filename) {
  window.XLSX.writeFile(wb, filename);
}

/** 便捷：AOA → 单表 workbook → 下载 xlsx */
export function downloadAoaXlsx(aoa, sheetName, filename) {
  downloadWorkbook(buildWorkbook(aoa, sheetName), filename);
}
