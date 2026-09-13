'use strict';
// 竞价 Excel 落盘：表头样式统一走 lib/export-utils.js。
const ExcelJS = require('exceljs');
const { styleExcelHeader } = require('../lib/export-utils');

async function writeExcel(rows, outPath) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'bidding-export';
  const ws = wb.addWorksheet('获胜竞价');
  const headers = ['商品编号（外层商品）', '编号', '系统竞价价格', '最终价格', '我的最佳价格', '我的活动价格'];
  ws.addRow(headers);
  for (const r of rows) {
    ws.addRow([r['商品编号'], r['编号'], r['系统竞价价格'], r['最终价格'], r['我的最佳价格'], r['我的活动价格']]);
  }
  ws.columns.forEach(col => { col.width = 20; });
  ws.getColumn(1).width = 18;
  ws.getColumn(2).width = 18;
  styleExcelHeader(ws);
  await wb.xlsx.writeFile(outPath);
  return outPath;
}

module.exports = { writeExcel };
