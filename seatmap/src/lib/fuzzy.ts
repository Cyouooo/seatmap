import Fuse from 'fuse.js';
import type { Block, Floor, Match } from '../types';

interface SeatRecord {
  floorId: string;
  blockId: string;
  seatIndex: number;
  seatNo: string;
  machineSN: string;
  portNo: string;
  custom: string;
}

export const STRONG_THRESHOLD = 0.12;
export const WEAK_THRESHOLD = 0.32;

function norm(v: string): string {
  return (v || '').toString().trim().toLowerCase().replace(/\s+/g, '');
}

/** 座位上的所有可搜索属性（用于命中定位） */
export function seatAttributes(
  block: Block,
  seatIndex: number,
): { label: string; value: string }[] {
  const seat = block.seats[seatIndex];
  if (!seat) return [];
  const list = [
    { label: '座位号', value: seat.seatNo },
    { label: '机器SN', value: seat.machineSN },
    { label: '网口号', value: seat.portNo },
  ];
  for (const f of seat.fields) {
    list.push({ label: f.label || f.key, value: f.value });
  }
  return list.filter((x) => (x.value || '').trim() !== '');
}

interface SeatIndex {
  records: SeatRecord[];
  attrIndex: Map<string, { label: string; value: string }[]>;
  fuse: Fuse<SeatRecord>;
}

/** 座位索引缓存：仅当 floors 引用变化（布局改动）时才重建，避免每次输入重复建索引 */
let indexCache: { floors: Floor[]; index: SeatIndex } | null = null;

function buildSeatIndex(floors: Floor[]): SeatIndex {
  const records: SeatRecord[] = [];
  const attrIndex = new Map<string, { label: string; value: string }[]>();
  for (const floor of floors) {
    for (const block of floor.blocks) {
      if (!block.showSeats) continue;
      block.seats.forEach((seat, seatIndex) => {
        records.push({
          floorId: floor.id,
          blockId: block.id,
          seatIndex,
          seatNo: seat.seatNo || '',
          machineSN: seat.machineSN || '',
          portNo: seat.portNo || '',
          custom: seat.fields.map((f) => `${f.label}:${f.value}`).join(' '),
        });
        attrIndex.set(`${floor.id}:${block.id}:${seatIndex}`, seatAttributes(block, seatIndex));
      });
    }
  }
  const fuse = new Fuse(records, {
    includeScore: true,
    threshold: WEAK_THRESHOLD,
    ignoreLocation: true,
    keys: [
      { name: 'seatNo', weight: 0.5 },
      { name: 'machineSN', weight: 0.3 },
      { name: 'portNo', weight: 0.15 },
      { name: 'custom', weight: 0.05 },
    ],
  });
  return { records, attrIndex, fuse };
}

/** 取得（并缓存）座位索引 */
export function getSeatIndex(floors: Floor[]): SeatIndex {
  if (indexCache && indexCache.floors === floors) return indexCache.index;
  const index = buildSeatIndex(floors);
  indexCache = { floors, index };
  return index;
}

/**
 * 跨楼层搜索：
 * - 单个搜索（single）：把整段输入当作一个查询词。
 * - 批量搜索（batch）：按换行拆分（兼容 \r\n），每一行是一个查询词，
 *   匹配「从文本编辑器 / Excel 复制一列」的换行格式。
 * 命中仍按「精确包含（strong）/ 模糊相似（weak）」分级，仅用于排序与高亮。
 * key 形如 `floorId:blockId:seatIndex`。
 */
export function searchSeats(
  floors: Floor[],
  query: string,
  mode: 'single' | 'batch',
): Map<string, Match> {
  const result = new Map<string, Match>();

  // 拆分查询词：批量模式按换行拆分并去重，单个模式取整段
  const terms =
    mode === 'batch'
      ? Array.from(
          new Set(
            query
              .split(/\r?\n/)
              .map((t) => t.trim())
              .filter(Boolean),
          ),
        ).slice(0, 500)
      : [query.trim()].filter(Boolean);
  if (!terms.length) return result;

  // 索引（records / 属性表 / Fuse）按 floors 缓存，不随每次输入重建
  const { records, attrIndex, fuse } = getSeatIndex(floors);

  const keyOf = (rec: SeatRecord) => `${rec.floorId}:${rec.blockId}:${rec.seatIndex}`;
  const rank = (l: 'strong' | 'weak') => (l === 'strong' ? 2 : 1);
  const put = (rec: SeatRecord, level: 'strong' | 'weak', field: string, value: string) => {
    const key = keyOf(rec);
    const prev = result.get(key);
    // 多个查询词命中同一个工位时：保留更高精度、且不覆盖同精度的首个命中
    if (prev) {
      if (rank(level) < rank(prev.level)) return;
      if (rank(level) === rank(prev.level)) return;
    }
    result.set(key, {
      floorId: rec.floorId,
      blockId: rec.blockId,
      seatIndex: rec.seatIndex,
      seatNo: rec.seatNo,
      level,
      hitField: field,
      hitValue: value,
    });
  };

  for (const term of terms) {
    const q = norm(term);
    if (!q) continue;

    // 1) 精确命中（整字段相等）：命中则只取精确，避免 "A1" 误伤 "A10…A19"
    let exactHit = false;
    for (const rec of records) {
      for (const attr of attrIndex.get(keyOf(rec)) ?? []) {
        if (norm(attr.value) === q) {
          put(rec, 'strong', attr.label, attr.value);
          exactHit = true;
        }
      }
    }
    if (exactHit) continue;

    // 2) 子串命中：无精确命中时的回退，便于前缀 / 分组检索（如 "A" → 所有 A 区工位）
    for (const rec of records) {
      for (const attr of attrIndex.get(keyOf(rec)) ?? []) {
        if (norm(attr.value).includes(q)) {
          put(rec, 'strong', attr.label, attr.value);
          break;
        }
      }
    }

    // 3) 模糊命中（阈值已收紧，减少噪声）
    for (const hit of fuse.search(term)) {
      const rec = hit.item;
      const score = hit.score ?? 1;
      const level: 'strong' | 'weak' = score <= STRONG_THRESHOLD ? 'strong' : 'weak';
      put(rec, level, '模糊匹配', rec.seatNo);
    }
  }
  return result;
}

export function matchKey(blockId: string, seatIndex: number): string {
  return `${blockId}:${seatIndex}`;
}
