import type { Block, Seat } from '../types';

/** 单个座位基础格尺寸（统一尺寸让整体更整齐美观） */
export const CELL_W = 84;
export const CELL_H = 52;
/** 座位间距 */
export const GAP = 10;
/** 控件内边距 */
export const PAD = 14;
/** 有座位时顶部标题栏高度 */
export const TITLE_H = 30;
/** 未显示座位时，文案占用的“一个座位”尺寸 */
export const TEXT_CELL_W = CELL_W;
export const TEXT_CELL_H = CELL_H;
/** 拖动/整理时的位置吸附步长 */
export const GRID_SNAP = 10;
/** 控件之间保留的安全间距（防重叠） */
export const BLOCK_GAP = 14;

export const DEFAULT_COLORS = [
  '#2563eb',
  '#0ea5e9',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#64748b',
];

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const full =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h;
  const r = parseInt(full.slice(0, 2), 16) || 0;
  const g = parseInt(full.slice(2, 4), 16) || 0;
  const b = parseInt(full.slice(4, 6), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function titleHeight(block: Pick<Block, 'showSeats' | 'text'>): number {
  return block.showSeats && block.text.trim() ? TITLE_H : 0;
}

export function snap(v: number, step = GRID_SNAP): number {
  return Math.round(v / step) * step;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** 内容区（标题栏之下）的宽高 */
export function contentSize(cols: number, rows: number): { width: number; height: number } {
  const c = Math.max(1, Math.floor(cols));
  const r = Math.max(1, Math.floor(rows));
  return {
    width: c * CELL_W + (c - 1) * GAP,
    height: r * CELL_H + (r - 1) * GAP,
  };
}

/** 纯文本控件的最小宽度：保证文案不被裁切，同时默认约等于一个座位长度 */
export function textWidth(text: string): number {
  const chars = [...(text || '').trim()];
  let w = 0;
  for (const ch of chars) w += /[\u4e00-\u9fa5\uff00-\uffef]/.test(ch) ? 15 : 8.5;
  return Math.max(TEXT_CELL_W, Math.ceil(w) + 14);
}

/** 按 cols/rows 推导控件外框尺寸（用于自动尺寸） */
export function autoBlockSize(block: Pick<Block, 'cols' | 'rows' | 'showSeats' | 'text'>): {
  width: number;
  height: number;
} {
  if (!block.showSeats) {
    return { width: textWidth(block.text) + PAD * 2, height: TEXT_CELL_H + PAD * 2 };
  }
  const { width, height } = contentSize(block.cols, block.rows);
  return { width: width + PAD * 2, height: height + PAD * 2 + titleHeight(block) };
}

/** 第 i 个座位（按行优先）在控件内的相对矩形 */
export function seatRect(
  i: number,
  cols: number,
  offsetY = 0,
): { x: number; y: number; width: number; height: number } {
  const c = Math.max(1, cols);
  const col = i % c;
  const row = Math.floor(i / c);
  return {
    x: PAD + col * (CELL_W + GAP),
    y: PAD + offsetY + row * (CELL_H + GAP),
    width: CELL_W,
    height: CELL_H,
  };
}

/** 座位在画布世界坐标里的矩形（用于搜索聚焦） */
export function seatWorldRect(block: Block, index: number): Rect {
  const r = seatRect(index, block.cols, titleHeight(block));
  return { x: block.x + r.x, y: block.y + r.y, width: r.width, height: r.height };
}

export function unionRect(rects: Rect[]): Rect | null {
  if (!rects.length) return null;
  const x1 = Math.min(...rects.map((r) => r.x));
  const y1 = Math.min(...rects.map((r) => r.y));
  const x2 = Math.max(...rects.map((r) => r.x + r.width));
  const y2 = Math.max(...rects.map((r) => r.y + r.height));
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

export function rectOf(b: Block): Rect {
  return { x: b.x, y: b.y, width: b.width, height: b.height };
}

export function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** 重叠面积占较小控件的比例（0~1） */
export function overlapRatio(a: Rect, b: Rect): number {
  const inter = overlapArea(a, b);
  if (!inter) return 0;
  const minArea = Math.min(a.width * a.height, b.width * b.height) || 1;
  return inter / minArea;
}

/** 带安全间距的相交判断 */
export function collides(a: Rect, b: Rect, gap = BLOCK_GAP): boolean {
  return (
    a.x - gap < b.x + b.width &&
    a.x + a.width + gap > b.x &&
    a.y - gap < b.y + b.height &&
    a.y + a.height + gap > b.y
  );
}

function isFree(placed: Rect[], rect: Rect, gap: number): boolean {
  return !placed.some((r) => collides(rect, r, gap));
}

/** 从 preferred 出发螺旋查找最近的空位（保证控件不重叠） */
export function findFreeSpot(
  placed: Rect[],
  size: { width: number; height: number },
  preferred: { x: number; y: number },
  gap = BLOCK_GAP,
): { x: number; y: number } {
  const probe = (x: number, y: number): Rect => ({ x, y, width: size.width, height: size.height });
  const px = snap(Math.max(0, preferred.x));
  const py = snap(Math.max(0, preferred.y));
  if (isFree(placed, probe(px, py), gap)) return { x: px, y: py };

  for (let ring = 1; ring <= 90; ring += 1) {
    const candidates: { x: number; y: number }[] = [];
    for (let d = -ring; d <= ring; d += 1) {
      candidates.push({ x: px + d * GRID_SNAP, y: py - ring * GRID_SNAP });
      candidates.push({ x: px + d * GRID_SNAP, y: py + ring * GRID_SNAP });
      candidates.push({ x: px - ring * GRID_SNAP, y: py + d * GRID_SNAP });
      candidates.push({ x: px + ring * GRID_SNAP, y: py + d * GRID_SNAP });
    }
    // 按距离原点的远近排序，优先贴近原位置
    candidates.sort(
      (a, b) => Math.abs(a.x - px) + Math.abs(a.y - py) - (Math.abs(b.x - px) + Math.abs(b.y - py)),
    );
    for (const cand of candidates) {
      if (cand.x < 0 || cand.y < 0) continue;
      if (isFree(placed, probe(cand.x, cand.y), gap)) return cand;
    }
  }
  return { x: px, y: py };
}

/**
 * 整层防重叠：按从上到下、从左到右的顺序摆放，重叠的控件顺延到最近空位。
 * 只做最小位移，尽量保持原布局形状。
 */
export function resolveOverlaps(
  blocks: Block[],
  gap = BLOCK_GAP,
): Map<string, { x: number; y: number }> {
  const result = new Map<string, { x: number; y: number }>();
  const placed: Rect[] = [];
  const sorted = [...blocks].sort((a, b) => a.y - b.y || a.x - b.x);
  for (const b of sorted) {
    const spot = findFreeSpot(
      placed,
      { width: b.width, height: b.height },
      { x: b.x, y: b.y },
      gap,
    );
    result.set(b.id, spot);
    placed.push({ ...spot, width: b.width, height: b.height });
  }
  return result;
}

export function hasOverlap(blocks: Block[], gap = 4): string[] {
  const rects = blocks.map(rectOf);
  const ids: string[] = [];
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      if (overlapRatio(rects[i], rects[j]) > 0.02 && collides(rects[i], rects[j], gap)) {
        ids.push(blocks[i].id, blocks[j].id);
      }
    }
  }
  return Array.from(new Set(ids));
}

export function emptySeat(index: number, prefix: string): Seat {
  const no = `${prefix || 'S'}-${String(index + 1).padStart(2, '0')}`;
  return { seatNo: no, machineSN: '', portNo: '', fields: [] };
}

/** 按 cols/rows 调整座位数组（保留已有座位数据，新增补默认，多余的截断） */
export function resizeSeats(block: Block, cols: number, rows: number): Seat[] {
  const total = Math.max(1, Math.floor(cols)) * Math.max(1, Math.floor(rows));
  const prefix = block.seatPrefix || block.text || 'S';
  const next: Seat[] = [];
  for (let i = 0; i < total; i += 1) {
    const old = block.seats[i];
    next.push(old ? { ...old, fields: old.fields.map((f) => ({ ...f })) } : emptySeat(i, prefix));
  }
  return next;
}

export function makeBlock(partial: Partial<Block> & { x: number; y: number }): Block {
  const base: Block = {
    id: `blk_${Math.random().toString(36).slice(2, 9)}`,
    width: 0,
    height: 0,
    text: 'X区',
    color: '#2563eb',
    cols: 2,
    rows: 2,
    showSeats: false,
    seatPrefix: 'A',
    seats: [],
    ...partial,
  } as Block;
  base.cols = Math.max(1, base.cols);
  base.rows = Math.max(1, base.rows);
  base.seats = resizeSeats(base, base.cols, base.rows);
  const size = autoBlockSize(base);
  if (!base.width) base.width = size.width;
  if (!base.height) base.height = size.height;
  return base;
}

/** 在可视区域内的空白处找一个落点（用于“添加控件”直接放在当前视野里） */
export function findFreeSpotInView(
  blocks: Block[],
  size: { width: number; height: number },
  view: Rect,
  gap = BLOCK_GAP,
): { x: number; y: number } | null {
  const placed = blocks.map(rectOf);
  const usableW = Math.max(0, view.width - size.width);
  const usableH = Math.max(0, view.height - size.height);
  if (usableW < 20 || usableH < 20) return null;
  // 控制候选点数量，避免视野很大时扫描过慢
  const step = Math.max(20, Math.ceil(Math.sqrt((usableW * usableH) / 2500) / 20) * 20);
  const candidates: { x: number; y: number }[] = [];
  for (let y = view.y + 20; y <= view.y + 20 + usableH; y += step) {
    for (let x = view.x + 20; x <= view.x + 20 + usableW; x += step) {
      candidates.push({ x: Math.round(x), y: Math.round(y) });
    }
  }
  const cx = view.x + view.width / 2;
  const cy = view.y + view.height / 2;
  candidates.sort(
    (a, b) => Math.abs(a.x - cx) + Math.abs(a.y - cy) - (Math.abs(b.x - cx) + Math.abs(b.y - cy)),
  );
  for (const c of candidates) {
    const rect: Rect = { x: c.x, y: c.y, width: size.width, height: size.height };
    if (!placed.some((p) => collides(rect, p, gap))) return c;
  }
  return null;
}

/** 工位上要显示的单行文本（按全局配置的属性） */
export function seatLabelText(seat: Seat, field: string): string {
  if (!field || field === '座位号') return seat.seatNo || '—';
  if (field === '机器SN') return seat.machineSN || seat.seatNo || '—';
  if (field === '网口号') return seat.portNo || seat.seatNo || '—';
  const custom = seat.fields.find((f) => f.label === field || f.key === field);
  return (custom && custom.value) || seat.seatNo || '—';
}

/** 为一个空位生成新的座位号 */
export function nextSeatNo(block: Block, index: number): string {
  const prefix = block.seatPrefix || block.text || 'S';
  let max = 0;
  for (const s of block.seats) {
    const m = String(s.seatNo || '').match(/(\d+)\s*$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  if (max > 0) return `${prefix}${max + 1}`;
  return `${prefix}-${String(index + 1).padStart(2, '0')}`;
}

/* ------------------------------------------------------------------ */
/* 对齐辅助线                                                            */
/* ------------------------------------------------------------------ */

export const ALIGN_THRESHOLD = 8;

export interface Guide {
  orientation: 'v' | 'h';
  position: number;
  start: number;
  end: number;
}

/** 计算与其它控件的对齐吸附位置，并返回需要绘制的辅助线 */
export function alignmentSnap(
  rect: Rect,
  others: Rect[],
  threshold = ALIGN_THRESHOLD,
): { x: number; y: number; guides: Guide[] } {
  const edgesX = (r: Rect) => [r.x, r.x + r.width / 2, r.x + r.width];
  const edgesY = (r: Rect) => [r.y, r.y + r.height / 2, r.y + r.height];
  const myX = edgesX(rect);
  const myY = edgesY(rect);

  let bestDX: number | null = null;
  let bestDY: number | null = null;
  for (const o of others) {
    for (const mx of myX) {
      for (const tx of edgesX(o)) {
        const d = tx - mx;
        if (Math.abs(d) <= threshold && (bestDX === null || Math.abs(d) < Math.abs(bestDX)))
          bestDX = d;
      }
    }
    for (const my of myY) {
      for (const ty of edgesY(o)) {
        const d = ty - my;
        if (Math.abs(d) <= threshold && (bestDY === null || Math.abs(d) < Math.abs(bestDY)))
          bestDY = d;
      }
    }
  }

  const x = rect.x + (bestDX ?? 0);
  const y = rect.y + (bestDY ?? 0);
  const snapped: Rect = { ...rect, x, y };
  const sx = edgesX(snapped);
  const sy = edgesY(snapped);

  const guides: Guide[] = [];
  const seen = new Set<string>();
  const push = (g: Guide) => {
    const key = `${g.orientation}:${Math.round(g.position)}:${Math.round(g.start)}:${Math.round(g.end)}`;
    if (!seen.has(key)) {
      seen.add(key);
      guides.push(g);
    }
  };

  for (const o of others) {
    for (const mx of sx) {
      for (const tx of edgesX(o)) {
        if (Math.abs(tx - mx) < 0.6) {
          push({
            orientation: 'v',
            position: tx,
            start: Math.min(snapped.y, o.y),
            end: Math.max(snapped.y + snapped.height, o.y + o.height),
          });
        }
      }
    }
    for (const my of sy) {
      for (const ty of edgesY(o)) {
        if (Math.abs(ty - my) < 0.6) {
          push({
            orientation: 'h',
            position: ty,
            start: Math.min(snapped.x, o.x),
            end: Math.max(snapped.x + snapped.width, o.x + o.width),
          });
        }
      }
    }
  }

  return { x, y, guides };
}

/* ------------------------------------------------------------------ */
/* 拉伸尺寸 → 行列数                                                    */
/* ------------------------------------------------------------------ */

/** 根据控件外框尺寸反推行列数（用于拉伸时自动增减工位） */
export function colsRowsFromSize(
  block: Pick<Block, 'showSeats' | 'text' | 'cols' | 'rows'>,
  width: number,
  height: number,
): { cols: number; rows: number } {
  const th = titleHeight(block);
  const cols = Math.max(1, Math.round((width - PAD * 2 + GAP) / (CELL_W + GAP)));
  const rows = Math.max(1, Math.round((height - PAD * 2 - th + GAP) / (CELL_H + GAP)));
  return { cols, rows };
}

/* ------------------------------------------------------------------ */
/* 工位统计（含未分配）                                                  */
/* ------------------------------------------------------------------ */

export interface BlockStat {
  id: string;
  text: string;
  total: number;
  assigned: number;
  unassigned: number;
}

export interface SeatStats {
  total: number;
  assigned: number;
  unassigned: number;
  emptySlots: number;
  textBlocks: number;
  blocks: BlockStat[];
}

/** 无机器SN 的工位记作“未分配” */
export function seatStats(blocks: Block[]): SeatStats {
  let total = 0;
  let assigned = 0;
  let emptySlots = 0;
  let textBlocks = 0;
  const list: BlockStat[] = [];
  for (const b of blocks) {
    if (!b.showSeats) {
      textBlocks += 1;
      continue;
    }
    let bTotal = 0;
    let bAssigned = 0;
    for (const s of b.seats) {
      if (!s.seatNo) {
        emptySlots += 1;
        continue;
      }
      bTotal += 1;
      if (s.machineSN && s.machineSN.trim()) bAssigned += 1;
    }
    total += bTotal;
    assigned += bAssigned;
    if (bTotal > 0) {
      list.push({
        id: b.id,
        text: b.text,
        total: bTotal,
        assigned: bAssigned,
        unassigned: bTotal - bAssigned,
      });
    }
  }
  return {
    total,
    assigned,
    unassigned: total - assigned,
    emptySlots,
    textBlocks,
    blocks: list,
  };
}
