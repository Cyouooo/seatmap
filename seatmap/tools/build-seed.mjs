/**
 * 从工位表（Excel）生成初始布局数据（server/data/layout.json）。
 * 用法： node tools/build-seed.mjs <xlsx路径> [--force]
 *      例如： node tools/build-seed.mjs samples/seatmap-sample.xlsx --force
 *
 * 规则：
 *  - 工作表 "5F/6F" 作为布局地图，"5F座位数据/6F座位数据" 提供 座位号→机器SN/网口号
 *  - 地图中的座位号单元格按 4 邻接聚合为控件（Block），控件内空位作为“空座位”占位
 *  - 控件外的说明性文字（如 柱子、观光电梯旋转门）生成纯文本控件
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ExcelJS = require('exceljs');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'server', 'data', 'layout.json');

const CELL_W = 84;
const CELL_H = 52;
const GAP = 10;
const PAD = 14;
const TITLE_H = 30;
const GRID_SNAP = 10;
const BLOCK_GAP = 14;
const ORIGIN_X = 60;
const ORIGIN_Y = 60;

const COLORS = ['#2563eb', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#64748b'];

const snap = (v) => Math.round(v / GRID_SNAP) * GRID_SNAP;

/** 纯文本控件最小宽度：保证文案不被裁切 */
function textWidth(text) {
  let w = 0;
  for (const ch of [...String(text).trim()]) {
    w += /[\u4e00-\u9fa5\uff00-\uffef]/.test(ch) ? 15 : 8.5;
  }
  return Math.max(CELL_W, Math.ceil(w) + 14);
}

function collides(a, b, gap) {
  return (
    a.x - gap < b.x + b.width &&
    a.x + a.width + gap > b.x &&
    a.y - gap < b.y + b.height &&
    a.y + a.height + gap > b.y
  );
}

function findFreeSpot(placed, size, preferred, gap = BLOCK_GAP) {
  const probe = (x, y) => ({ x, y, width: size.width, height: size.height });
  const px = snap(Math.max(0, preferred.x));
  const py = snap(Math.max(0, preferred.y));
  if (!placed.some((r) => collides(probe(px, py), r, gap))) return { x: px, y: py };
  for (let ring = 1; ring <= 90; ring += 1) {
    const cands = [];
    for (let d = -ring; d <= ring; d += 1) {
      cands.push({ x: px + d * GRID_SNAP, y: py - ring * GRID_SNAP });
      cands.push({ x: px + d * GRID_SNAP, y: py + ring * GRID_SNAP });
      cands.push({ x: px - ring * GRID_SNAP, y: py + d * GRID_SNAP });
      cands.push({ x: px + ring * GRID_SNAP, y: py + d * GRID_SNAP });
    }
    cands.sort(
      (a, b) => Math.abs(a.x - px) + Math.abs(a.y - py) - (Math.abs(b.x - px) + Math.abs(b.y - py)),
    );
    for (const c of cands) {
      if (c.x < 0 || c.y < 0) continue;
      if (!placed.some((r) => collides(probe(c.x, c.y), r, gap))) return c;
    }
  }
  return { x: px, y: py };
}

/** 消除同层控件重叠：按从上到下顺序摆放，重叠的就近错开 */
function resolveOverlaps(blocks, gap = BLOCK_GAP) {
  const placed = [];
  const sorted = [...blocks].sort((a, b) => a.y - b.y || a.x - b.x);
  for (const b of sorted) {
    const spot = findFreeSpot(
      placed,
      { width: b.width, height: b.height },
      { x: b.x, y: b.y },
      gap,
    );
    b.x = spot.x;
    b.y = spot.y;
    placed.push({ x: spot.x, y: spot.y, width: b.width, height: b.height });
  }
}

const args = process.argv.slice(2);
const force = args.includes('--force');
const fileArg = args.find((a) => !a.startsWith('--'));
if (!fileArg) {
  console.error('用法: node tools/build-seed.mjs <xlsx路径> [--force]');
  process.exit(1);
}
if (fs.existsSync(OUT) && !force) {
  console.error(`已存在布局文件 ${OUT}，如需覆盖请加 --force`);
  process.exit(1);
}

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(path.resolve(fileArg));
const norm = (v) =>
  String(v ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');

function cellText(v) {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join('');
    if (v.text != null) return String(v.text);
    if (v.result != null) return String(v.result);
    if (v instanceof Date) return v.toISOString();
    return '';
  }
  return String(v).replace(/\r?\n/g, '\r\n');
}

function sheetRows(name) {
  const ws = wb.getWorksheet(name);
  if (!ws) return [];
  const colCount = Math.max(ws.columnCount || 0, 1);
  const rows = [];
  ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const out = [];
    for (let i = 1; i <= colCount; i += 1) {
      const cell = row.getCell(i);
      const nonAnchor = cell.isMerged && cell.master && cell.master.address !== cell.address;
      out.push(nonAnchor ? '' : cellText(cell.value).trim());
    }
    rows[rowNumber - 1] = out;
  });
  return rows;
}

function readSeatData(sheetName) {
  const map = new Map();
  const rows = sheetRows(sheetName);
  if (!rows.length) return map;
  const header = rows[0].map((c) => c.toLowerCase());
  const seatCol = header.findIndex((c) => c.includes('座位') || c.includes('工位'));
  const snCol = header.findIndex((c) => c.includes('sn'));
  const portCol = header.findIndex((c) => c.includes('网口') || c.includes('端口'));
  if (seatCol < 0) return map;
  for (const row of rows.slice(1)) {
    const seatNo = row[seatCol];
    if (!seatNo) continue;
    const key = norm(seatNo);
    if (!map.has(key)) {
      map.set(key, {
        seatNo: String(seatNo).trim(),
        machineSN: snCol >= 0 ? row[snCol] : '',
        portNo: portCol >= 0 ? row[portCol] : '',
      });
    }
  }
  return map;
}

const SEAT_WITH_LETTER = /^[A-Za-z]{1,3}[-_]?\d{1,4}$/;
const SEAT_NUMERIC = /^\d{1,4}$/;

function buildFloor(mapSheet, dataSheet, floorId, floorName) {
  const seatsData = readSeatData(dataSheet);
  const rows = sheetRows(mapSheet);

  const cells = [];
  rows.forEach((row, r) => {
    row.forEach((value, c) => {
      if (!value) return;
      if (/[\u4e00-\u9fa5]/.test(value)) {
        cells.push({ r, c, value, kind: 'text' });
        return;
      }
      const isSeat =
        SEAT_WITH_LETTER.test(value) || (SEAT_NUMERIC.test(value) && seatsData.has(norm(value)));
      cells.push({ r, c, value, kind: isSeat ? 'seat' : 'text' });
    });
  });

  const seatCells = cells.filter((x) => x.kind === 'seat');
  const keyOf = (r, c) => `${r},${c}`;
  const seatSet = new Map(seatCells.map((x) => [keyOf(x.r, x.c), x]));

  // 4 邻接连通分量
  const visited = new Set();
  const components = [];
  for (const cell of seatCells) {
    const start = keyOf(cell.r, cell.c);
    if (visited.has(start)) continue;
    const queue = [cell];
    visited.add(start);
    const members = [];
    while (queue.length) {
      const cur = queue.pop();
      members.push(cur);
      const neighbors = [
        [cur.r - 1, cur.c],
        [cur.r + 1, cur.c],
        [cur.r, cur.c - 1],
        [cur.r, cur.c + 1],
      ];
      for (const [nr, nc] of neighbors) {
        const key = keyOf(nr, nc);
        const hit = seatSet.get(key);
        if (hit && !visited.has(key)) {
          visited.add(key);
          queue.push(hit);
        }
      }
    }
    components.push(members);
  }

  const blocks = [];
  const insideBlocks = new Set();
  components.forEach((members) => {
    const rowsIdx = members.map((m) => m.r);
    const colsIdx = members.map((m) => m.c);
    const r0 = Math.min(...rowsIdx);
    const r1 = Math.max(...rowsIdx);
    const c0 = Math.min(...colsIdx);
    const c1 = Math.max(...colsIdx);
    const cols = c1 - c0 + 1;
    const rowsCount = r1 - r0 + 1;

    const memberMap = new Map(members.map((m) => [`${m.r - r0},${m.c - c0}`, m]));
    const seats = [];
    for (let r = 0; r < rowsCount; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const hit = memberMap.get(`${r},${c}`);
        insideBlocks.add(keyOf(r0 + r, c0 + c));
        if (hit) {
          const data = seatsData.get(norm(hit.value));
          seats.push({
            seatNo: data?.seatNo ?? hit.value,
            machineSN: data?.machineSN ?? '',
            portNo: data?.portNo ?? '',
            fields: [],
          });
        } else {
          seats.push({ seatNo: '', machineSN: '', portNo: '', fields: [] });
        }
      }
    }
    const sample = members.map((m) => m.value).join(' ');
    const prefix = (sample.match(/[A-Za-z]{1,3}/) || ['A'])[0].toUpperCase();
    blocks.push({
      id: `blk_${floorId}_${blocks.length + 1}`,
      x: ORIGIN_X + c0 * (CELL_W + GAP),
      y: ORIGIN_Y + r0 * (CELL_H + GAP),
      width: PAD * 2 + cols * CELL_W + (cols - 1) * GAP,
      height: PAD * 2 + rowsCount * CELL_H + (rowsCount - 1) * GAP + TITLE_H,
      text: `${prefix}区`,
      color: COLORS[blocks.length % (COLORS.length - 1)],
      cols,
      rows: rowsCount,
      showSeats: true,
      seatPrefix: prefix,
      seats,
    });
  });

  // 控件外的文字 → 纯文本控件
  for (const cell of cells) {
    if (cell.kind !== 'text') continue;
    if (insideBlocks.has(keyOf(cell.r, cell.c))) continue;
    if (cell.value.length > 12) continue;
    if (/说明|工位|安排|共计|更新|区域|员工数|培训/.test(cell.value)) continue;
    blocks.push({
      id: `blk_${floorId}_t${blocks.length + 1}`,
      x: ORIGIN_X + cell.c * (CELL_W + GAP),
      y: ORIGIN_Y + cell.r * (CELL_H + GAP),
      width: textWidth(cell.value) + PAD * 2,
      height: CELL_H + PAD * 2,
      text: cell.value,
      color: '#64748b',
      cols: 1,
      rows: 1,
      showSeats: false,
      seatPrefix: 'T',
      seats: [],
    });
  }

  // 位置吸附到网格 + 消除控件重叠
  for (const b of blocks) {
    b.x = snap(b.x);
    b.y = snap(b.y);
  }
  resolveOverlaps(blocks);

  return {
    id: floorId,
    name: floorName,
    blocks,
  };
}

const floors = [
  buildFloor('5F', '5F座位数据', 'f5', '5F'),
  buildFloor('6F', '6F座位数据', 'f6', '6F'),
];

const doc = { version: 1, updatedAt: new Date().toISOString(), floors };
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(doc, null, 2), 'utf8');

for (const f of floors) {
  const seats = f.blocks.reduce((n, b) => n + b.seats.filter((s) => s.seatNo).length, 0);
  const empties = f.blocks.reduce((n, b) => n + b.seats.filter((s) => !s.seatNo).length, 0);
  const texts = f.blocks.filter((b) => !b.showSeats).length;
  console.log(
    `${f.name}: 控件 ${f.blocks.length} 个（文本控件 ${texts}），有效座位 ${seats} 个，空占位 ${empties} 个`,
  );
}
console.log('已写入', OUT);
