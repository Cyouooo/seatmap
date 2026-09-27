import { describe, it, expect } from 'vitest';
import { searchSeats, seatAttributes, matchKey } from './fuzzy';
import type { Floor, Seat } from '../types';

const seat = (seatNo: string, machineSN = '', portNo = ''): Seat => ({
  seatNo,
  machineSN,
  portNo,
  fields: [],
});

const floors: Floor[] = [
  {
    id: 'f1',
    name: '5F',
    blocks: [
      {
        id: 'b1',
        x: 0,
        y: 0,
        width: 206,
        height: 172,
        text: 'A区',
        color: '#2563eb',
        cols: 2,
        rows: 2,
        showSeats: true,
        seatPrefix: 'A',
        seats: [
          seat('A-01', 'SN1', 'P1'),
          seat('A-02', 'SN2', 'P2'),
          seat('A-03', 'SN3', 'P3'),
          seat('A-04', 'SN4', 'P4'),
        ],
      },
    ],
  },
];

describe('seatAttributes', () => {
  it('返回座位号 / 机器SN / 网口号 等非空属性', () => {
    expect(seatAttributes(floors[0].blocks[0], 0).map((a) => a.label)).toEqual([
      '座位号',
      '机器SN',
      '网口号',
    ]);
  });
});

describe('searchSeats', () => {
  it('单个搜索：子串精确命中为强命中（座位号）', () => {
    const m = searchSeats(floors, 'A-01', 'single');
    expect(m.get('f1:b1:0')?.level).toBe('strong');
    expect(m.get('f1:b1:0')?.hitField).toBe('座位号');
  });
  it('单个搜索：可按机器SN 命中', () => {
    const m = searchSeats(floors, 'SN3', 'single');
    expect(m.get('f1:b1:2')?.level).toBe('strong');
  });
  it('批量搜索：按换行拆分并去重', () => {
    const m = searchSeats(floors, 'A-01\nA-02\nA-01', 'batch');
    expect(m.has('f1:b1:0')).toBe(true);
    expect(m.has('f1:b1:1')).toBe(true);
  });
  it('空 / 空白查询返回空结果', () => {
    expect(searchSeats(floors, '   ', 'single').size).toBe(0);
    expect(searchSeats(floors, '', 'batch').size).toBe(0);
  });
  it('不搜索「未显示座位」的控件', () => {
    const hidden: Floor[] = [
      { id: 'f2', name: 'X', blocks: [{ ...floors[0].blocks[0], id: 'b2', showSeats: false }] },
    ];
    expect(searchSeats(hidden, 'A-01', 'single').size).toBe(0);
  });
  it('精确命中优先：存在精确座位时不牽连子串（A-01 不再命中 A-011）', () => {
    const f: Floor[] = [
      {
        id: 'f3',
        name: 'X',
        blocks: [
          {
            ...floors[0].blocks[0],
            id: 'b3',
            seats: [seat('A-01', 'S1', 'P1'), seat('A-011', 'S2', 'P2')],
          },
        ],
      },
    ];
    const m = searchSeats(f, 'A-01', 'single');
    expect(m.has('f3:b3:0')).toBe(true);
    expect(m.has('f3:b3:1')).toBe(false);
  });
  it('无精确命中时回退子串（前缀检索）', () => {
    const m = searchSeats(floors, 'A-0', 'single');
    expect(m.has('f1:b1:0')).toBe(true);
    expect(m.has('f1:b1:1')).toBe(true);
  });
});

describe('matchKey', () => {
  it('组合 blockId 与座位序号', () => {
    expect(matchKey('b1', 3)).toBe('b1:3');
  });
});
