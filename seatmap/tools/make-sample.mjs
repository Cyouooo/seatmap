/**
 * 生成一份「合成」示例工位表（samples/seatmap-sample.xlsx），用于公开演示与联调。
 *
 * 该文件中的所有座位号、机器 SN、网口号均为程序生成的虚构数据，不含任何真实
 * 人员信息或设备序列号，可安全入库。
 *
 * 用法： node tools/make-sample.mjs [输出路径]
 * 默认输出： samples/seatmap-sample.xlsx
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ExcelJS = require('exceljs');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'samples', 'seatmap-sample.xlsx'));

/** 虚构的机器 SN（形似真实序列号，但为固定前缀 + 序号，非真实设备） */
const fakeSN = (n) => `DEMO${String(n).padStart(2, '0')}X${(n * 7) % 97}X`;
/** 虚构网口号 */
const fakePort = (n) => `C${String(100 + n).padStart(3, '0')}`;

/** 写入「座位数据」表：座位号 / 主机SN / 网口号 */
function writeSeatData(wb, sheetName, prefix, count) {
  const ws = wb.addWorksheet(sheetName);
  ws.addRow(['座位号', '主机SN', '网口号']);
  for (let i = 1; i <= count; i += 1) {
    ws.addRow([`${prefix}${i}`, fakeSN(i), fakePort(i)]);
  }
  ws.getColumn(1).width = 12;
  ws.getColumn(2).width = 18;
  ws.getColumn(3).width = 12;
}

/** 写入「楼层地图」表：把座位号摆成 4 列 × 3 行的区块，另加一个中文文本控件 */
function writeFloorMap(wb, sheetName, prefix, cols, rows, label) {
  const ws = wb.addWorksheet(sheetName);
  let n = 1;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      ws.getCell(r + 1, c + 1).value = `${prefix}${n}`;
      n += 1;
    }
  }
  ws.getCell(rows + 2, 1).value = label; // 中文 → 纯文本控件
  ws.getCell(rows + 3, 1).value = `${label}2`;
}

const wb = new ExcelJS.Workbook();
wb.creator = 'seatmap sample generator';
wb.created = new Date(0);

writeFloorMap(wb, '5F', 'A', 4, 3, '示例区');
writeSeatData(wb, '5F座位数据', 'A', 12);
writeFloorMap(wb, '6F', 'B', 4, 3, '演示区');
writeSeatData(wb, '6F座位数据', 'B', 12);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
await wb.xlsx.writeFile(OUT);
console.log('已生成合成示例表：', OUT);
