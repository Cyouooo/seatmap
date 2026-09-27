import { describe, it, expect } from 'vitest';
import {
  CELL_W,
  CELL_H,
  GAP,
  PAD,
  TITLE_H,
  BLOCK_GAP,
  hexToRgba,
  titleHeight,
  snap,
  clamp,
  contentSize,
  autoBlockSize,
  seatRect,
  overlapRatio,
  collides,
  findFreeSpot,
  resolveOverlaps,
  hasOverlap,
  resizeSeats,
  makeBlock,
  seatLabelText,
  alignmentSnap,
  colsRowsFromSize,
  seatStats,
  type Rect,
} from './layout';
import type { Block, Seat } from '../types';

const seat = (seatNo = '', machineSN = '', portNo = ''): Seat => ({
  seatNo,
  machineSN,
  portNo,
  fields: [],
});
const chk = (b: Partial<Block> & { x: number; y: number }): Block => makeBlock(b);

describe('基础几何常量与工具', () => {
  it('hexToRgba 正确转换', () => {
    expect(hexToRgba('#2563eb', 0.5)).toBe('rgba(37, 99, 235, 0.5)');
  });
  it('snap / clamp', () => {
    expect(snap(23)).toBe(20);
    expect(snap(26)).toBe(30);
    expect(clamp(5, 1, 3)).toBe(3);
    expect(clamp(-1, 0, 10)).toBe(0);
  });
  it('titleHeight 仅在显示座位且有文案时非零', () => {
    expect(titleHeight({ showSeats: true, text: 'X区' })).toBe(TITLE_H);
    expect(titleHeight({ showSeats: true, text: '  ' })).toBe(0);
    expect(titleHeight({ showSeats: false, text: 'X' })).toBe(0);
  });
});

describe('尺寸计算', () => {
  it('contentSize 按行列推导内容区', () => {
    expect(contentSize(2, 2)).toEqual({ width: 2 * CELL_W + GAP, height: 2 * CELL_H + GAP });
  });
  it('autoBlockSize：带座位含标题栏', () => {
    expect(autoBlockSize({ cols: 2, rows: 2, showSeats: true, text: 'X区' })).toEqual({
      width: 2 * CELL_W + GAP + PAD * 2,
      height: 2 * CELL_H + GAP + PAD * 2 + TITLE_H,
    });
  });
  it('autoBlockSize：纯文本控件 = 一个座位格 + 内边距（112×80）', () => {
    expect(autoBlockSize({ cols: 2, rows: 2, showSeats: false, text: 'X' })).toEqual({
      width: 112,
      height: 80,
    });
  });
  it('colsRowsFromSize 与 contentSize 可逆', () => {
    const b = { showSeats: true, text: 'X区', cols: 3, rows: 4 };
    const { width, height } = contentSize(3, 4);
    expect(colsRowsFromSize(b, width + PAD * 2, height + PAD * 2 + TITLE_H)).toEqual({
      cols: 3,
      rows: 4,
    });
  });
});

describe('座位栅格', () => {
  it('seatRect 按行优先定位并含内边距', () => {
    expect(seatRect(0, 2, 0)).toEqual({ x: PAD, y: PAD, width: CELL_W, height: CELL_H });
    expect(seatRect(1, 2, 0).x).toBe(PAD + CELL_W + GAP);
    expect(seatRect(2, 2, 0).y).toBe(PAD + CELL_H + GAP);
  });
  it('resizeSeats 保留已有并补默认 / 截断', () => {
    const b = chk({ x: 0, y: 0, cols: 2, rows: 2, showSeats: true, text: 'A区', seatPrefix: 'A' });
    b.seats = [seat('A-01'), seat('A-02'), seat('A-03'), seat('A-04')];
    const shrink = resizeSeats(b, 1, 2);
    expect(shrink).toHaveLength(2);
    expect(shrink[0].seatNo).toBe('A-01');
    const grow = resizeSeats(b, 2, 3);
    expect(grow).toHaveLength(6);
    expect(grow[3].seatNo).toBe('A-04');
    expect(grow[5].seatNo).toBeTruthy();
  });
  it('seatLabelText 按显示属性取值并回退座位号', () => {
    const s: Seat = {
      seatNo: 'A-01',
      machineSN: '',
      portNo: 'P9',
      fields: [{ key: 'k', label: '项目', value: 'X' }],
    };
    expect(seatLabelText(s, '座位号')).toBe('A-01');
    expect(seatLabelText(s, '机器SN')).toBe('A-01');
    expect(seatLabelText(s, '网口号')).toBe('P9');
    expect(seatLabelText(s, '项目')).toBe('X');
  });
});

describe('防重叠', () => {
  it('overlapRatio / collides', () => {
    const a: Rect = { x: 0, y: 0, width: 100, height: 100 };
    expect(overlapRatio(a, { ...a })).toBe(1);
    expect(overlapRatio(a, { x: 200, y: 0, width: 100, height: 100 })).toBe(0);
    expect(collides(a, { x: 110, y: 0, width: 100, height: 100 }, 0)).toBe(false);
    expect(collides(a, { x: 110, y: 0, width: 100, height: 100 }, BLOCK_GAP)).toBe(true);
  });
  it('findFreeSpot：空位返回吸附后的首选点', () => {
    expect(findFreeSpot([], { width: 190, height: 180 }, { x: 23, y: 37 })).toEqual({
      x: 20,
      y: 40,
    });
  });
  it('findFreeSpot：首选点被占用时返回不冲突的位置', () => {
    const placed: Rect[] = [{ x: 0, y: 0, width: 190, height: 180 }];
    const spot = findFreeSpot(placed, { width: 190, height: 180 }, { x: 0, y: 0 });
    expect(collides({ ...spot, width: 190, height: 180 }, placed[0], BLOCK_GAP)).toBe(false);
  });
  it('resolveOverlaps：整理后互不重叠', () => {
    const blocks = [
      chk({ x: 0, y: 0, text: 'A', width: 190, height: 180, showSeats: false }),
      chk({ x: 0, y: 0, text: 'B', width: 190, height: 180, showSeats: false }),
      chk({ x: 0, y: 0, text: 'C', width: 190, height: 180, showSeats: false }),
    ];
    const spots = resolveOverlaps(blocks);
    const rects = blocks.map((b) => ({
      ...(spots.get(b.id) as { x: number; y: number }),
      width: b.width,
      height: b.height,
    }));
    for (let i = 0; i < rects.length; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) {
        expect(overlapRatio(rects[i], rects[j])).toBe(0);
      }
    }
  });
  it('hasOverlap 列出重叠控件', () => {
    const a = chk({ x: 0, y: 0, width: 190, height: 180, showSeats: false, text: 'A' });
    const b = chk({ x: 10, y: 10, width: 190, height: 180, showSeats: false, text: 'B' });
    expect(hasOverlap([a, b])).toEqual(expect.arrayContaining([a.id, b.id]));
    expect(hasOverlap([a])).toEqual([]);
  });
});

describe('统计与吸附', () => {
  it('seatStats 统计已分配 / 未分配 / 空位 / 文本控件', () => {
    const b = chk({ x: 0, y: 0, cols: 2, rows: 2, showSeats: true, text: 'A区', seatPrefix: 'A' });
    b.seats = [seat('A-01', 'SN1'), seat('A-02'), seat(''), seat('A-04', 'SN4')];
    const t = chk({ x: 0, y: 0, showSeats: false, text: '会议室' });
    const s = seatStats([b, t]);
    expect(s.total).toBe(3);
    expect(s.assigned).toBe(2);
    expect(s.unassigned).toBe(1);
    expect(s.emptySlots).toBe(1);
    expect(s.textBlocks).toBe(1);
  });
  it('alignmentSnap 吸附到相邻控件边缘并给出辅助线', () => {
    const rect: Rect = { x: 103, y: 0, width: 100, height: 100 };
    const others: Rect[] = [{ x: 200, y: 0, width: 100, height: 100 }];
    const r = alignmentSnap(rect, others);
    expect(r.x).toBe(100);
    expect(r.guides.length).toBeGreaterThan(0);
  });
});
