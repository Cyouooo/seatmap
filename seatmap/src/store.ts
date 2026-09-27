import { create } from 'zustand';
import type { Block, Floor, LayoutDoc, Selection, Seat, SeatField } from './types';
import {
  BLOCK_GAP,
  autoBlockSize,
  collides,
  colsRowsFromSize,
  findFreeSpot,
  makeBlock,
  nextSeatNo,
  overlapRatio,
  rectOf,
  resizeSeats,
  resolveOverlaps,
  snap,
  type Rect,
} from './lib/layout';

const HISTORY_LIMIT = 60;

type Theme = 'light' | 'dark';
const initialTheme: Theme =
  typeof localStorage !== 'undefined' && localStorage.getItem('seatmap-theme') === 'dark'
    ? 'dark'
    : 'light';

export type Mode = 'view' | 'edit';

interface OverlapWarning {
  blockId: string;
  conflicts: string[];
}

interface AppState {
  doc: LayoutDoc;
  floorId: string;
  mode: Mode;
  sel: Selection | null;
  query: string;
  matchMode: 'single' | 'batch';
  past: Floor[][];
  future: Floor[][];
  dirty: boolean;
  token: string | null;
  reauth: string | null;
  user: string | null;
  /** 全局自动吸附（辅助对齐线 + 网格吸附） */
  globalSnap: boolean;
  /** 重叠提示（手动修改数值后统一检测） */
  overlapWarn: OverlapWarning | null;
  /** 工位上显示哪个属性（全局） */
  seatLabelField: string;
  /** 批量编辑模式 */
  batchMode: boolean;
  batchIds: string[];
  /** 剪贴板中待粘贴的控件个数 */
  clipboardCount: number;

  setDoc: (doc: LayoutDoc) => void;
  setFloor: (floorId: string) => void;
  /** 楼层管理（编辑模式） */
  addFloor: () => string;
  removeFloor: (id: string) => void;
  renameFloor: (id: string, name: string) => void;
  setMode: (mode: Mode) => void;
  /** 进入编辑模式前的查看态选中（退出时还原属性面板） */
  viewSel: Selection | null;
  setQuery: (q: string) => void;
  setMatchMode: (m: 'single' | 'batch') => void;
  select: (sel: Selection | null) => void;
  setAuth: (token: string, reauth: string, user: string) => void;
  clearAuth: () => void;
  markSaved: (version: number, updatedAt: string) => void;
  setGlobalSnap: (v: boolean) => void;
  theme: Theme;
  setTheme: (t: Theme) => void;
  clearOverlapWarn: () => void;
  setSeatLabelField: (v: string) => void;
  setBatchMode: (v: boolean) => void;
  batchSelect: (ids: string[]) => void;
  batchToggle: (id: string) => void;
  batchDelete: () => void;
  batchUpdate: (patch: { color?: string; width?: number; height?: number }) => void;
  batchAlign: (mode: 'left' | 'right' | 'top' | 'bottom' | 'centerX' | 'centerY') => void;
  batchSameSize: (which: 'max' | 'first') => void;
  /** 横向 / 纵向间隔一致 */
  batchSpaceEvenly: (axis: 'x' | 'y') => void;
  /** 整体平移选中的控件 */
  batchMove: (dx: number, dy: number) => void;
  /** 复制 / 粘贴控件 */
  copySelection: () => void;
  pasteClipboard: () => void;
  /** 在空位上添加工位 */
  addSeatAt: (blockId: string, index: number) => void;

  /** 工位批量编辑：多选若干工位后批量清空 / 设置某属性 */
  seatBatchMode: boolean;
  seatIds: string[];
  setSeatBatchMode: (v: boolean) => void;
  seatToggle: (blockId: string, index: number) => void;
  seatSelectMany: (ids: string[]) => void;
  seatClearMany: () => void;
  seatClearField: (label: string) => void;
  seatSetField: (label: string, value: string) => void;

  mutate: (fn: (floors: Floor[]) => void, coalesceKey?: string) => void;
  undo: () => void;
  redo: () => void;

  addBlock: (x: number, y: number) => string;
  updateBlock: (id: string, patch: Partial<Block>) => void;
  /** 编辑数值过程中使用：不检测碰撞、不自动位移 */
  updateBlockRaw: (id: string, patch: Partial<Block>) => void;
  checkOverlap: (id: string) => void;
  fixOverlapBlock: (id: string) => void;
  removeBlock: (id: string) => void;
  swapBlocks: (aId: string, bId: string) => void;
  /** 拖拽落点：与其它控件重叠则互换位置，必要时让位到最近空位 */
  placeBlock: (id: string, x: number, y: number, snapGrid?: boolean) => void;
  /** 拉伸：座位控件按新尺寸自动增减工位 */
  resizeBlock: (id: string, x: number, y: number, width: number, height: number) => void;
  /** 整理本层：消除所有控件重叠 */
  resolveAllOverlaps: () => void;

  updateSeat: (blockId: string, index: number, patch: Partial<Seat>) => void;
  addSeatField: (blockId: string, index: number, field?: SeatField) => void;
  updateSeatField: (
    blockId: string,
    index: number,
    fieldIndex: number,
    patch: Partial<SeatField>,
  ) => void;
  removeSeatField: (blockId: string, index: number, fieldIndex: number) => void;
  applyFieldsToBlock: (blockId: string, index: number) => void;
  swapSeats: (blockId: string, i: number, otherBlockId: string, j: number) => void;
}

const EMPTY_DOC: LayoutDoc = {
  version: 0,
  updatedAt: '',
  floors: [{ id: 'default', name: '默认楼层', blocks: [] }],
};

const clone = <T>(v: T): T =>
  typeof structuredClone === 'function' ? structuredClone(v) : (JSON.parse(JSON.stringify(v)) as T);

/** 让某个控件避开其它控件（只在真重叠时就近移开，否则保持原位） */
function fixOverlap(floor: Floor, block: Block): void {
  const others: Rect[] = floor.blocks.filter((b) => b.id !== block.id).map(rectOf);
  const me = rectOf(block);
  if (!others.some((o) => collides(me, o, 4))) return;
  const spot = findFreeSpot(
    others,
    { width: block.width, height: block.height },
    { x: block.x, y: block.y },
    4,
  );
  block.x = spot.x;
  block.y = spot.y;
}

/** 找出与该控件重叠的其它控件 id */
function conflictsOf(floor: Floor, block: Block, gap = 2): string[] {
  const me = rectOf(block);
  return floor.blocks
    .filter((b) => b.id !== block.id)
    .filter((b) => collides(me, rectOf(b), gap) && overlapRatio(me, rectOf(b)) > 0.02)
    .map((b) => b.id);
}

let checkTimer: ReturnType<typeof setTimeout> | undefined;
/** 最近一次可合并的编辑（同一目标同一字段 1 秒内的连续输入合并为一步撤销） */
let lastMutate: { key: string; at: number } | null = null;
/** 剪贴板（控件深拷贝） */
let clipboard: Block[] = [];

export const useStore = create<AppState>((set, get) => ({
  doc: EMPTY_DOC,
  floorId: 'default',
  mode: 'view',
  sel: null,
  viewSel: null,
  query: '',
  matchMode: 'single',
  past: [],
  future: [],
  dirty: false,
  token: null,
  reauth: null,
  user: null,
  globalSnap: true,
  theme: initialTheme,
  overlapWarn: null,
  seatLabelField: '座位号',
  batchMode: false,
  batchIds: [],
  clipboardCount: 0,
  seatBatchMode: false,
  seatIds: [],

  setDoc: (doc) =>
    set({
      doc,
      past: [],
      future: [],
      dirty: false,
      sel: null,
      overlapWarn: null,
      batchIds: [],
      batchMode: false,
      seatLabelField: doc.seatLabelField || '座位号',
      floorId: doc.floors.some((f) => f.id === get().floorId)
        ? get().floorId
        : (doc.floors[0]?.id ?? ''),
    }),

  setSeatLabelField: (seatLabelField) => set({ seatLabelField }),

  setBatchMode: (batchMode) =>
    set({ batchMode, batchIds: [], sel: null, seatBatchMode: false, seatIds: [] }),

  batchSelect: (ids) => set({ batchIds: ids }),

  batchToggle: (id) =>
    set((s) => ({
      batchIds: s.batchIds.includes(id) ? s.batchIds.filter((x) => x !== id) : [...s.batchIds, id],
    })),

  batchDelete: () => {
    const ids = get().batchIds;
    if (!ids.length) return;
    get().mutate((floors) => {
      const f = floors.find((it) => it.id === get().floorId);
      if (f) f.blocks = f.blocks.filter((b) => !ids.includes(b.id));
    });
    set({ batchIds: [], sel: null });
  },

  batchUpdate: (patch) => {
    const ids = get().batchIds;
    if (!ids.length) return;
    get().mutate((floors) => {
      const f = floors.find((it) => it.id === get().floorId);
      if (!f) return;
      for (const b of f.blocks) {
        if (!ids.includes(b.id)) continue;
        if (patch.color) b.color = patch.color;
        if (patch.width !== undefined) b.width = Math.max(2, Math.round(patch.width));
        if (patch.height !== undefined) b.height = Math.max(2, Math.round(patch.height));
      }
    });
  },

  batchAlign: (mode) => {
    const ids = get().batchIds;
    if (ids.length < 2) return;
    get().mutate((floors) => {
      const f = floors.find((it) => it.id === get().floorId);
      if (!f) return;
      const sel = f.blocks.filter((b) => ids.includes(b.id));
      if (sel.length < 2) return;
      const left = Math.min(...sel.map((b) => b.x));
      const right = Math.max(...sel.map((b) => b.x + b.width));
      const top = Math.min(...sel.map((b) => b.y));
      const bottom = Math.max(...sel.map((b) => b.y + b.height));
      const cx = (left + right) / 2;
      const cy = (top + bottom) / 2;
      for (const b of sel) {
        if (mode === 'left') b.x = left;
        if (mode === 'right') b.x = right - b.width;
        if (mode === 'top') b.y = top;
        if (mode === 'bottom') b.y = bottom - b.height;
        if (mode === 'centerX') b.x = Math.round(cx - b.width / 2);
        if (mode === 'centerY') b.y = Math.round(cy - b.height / 2);
      }
    });
  },

  batchSpaceEvenly: (axis) => {
    const ids = get().batchIds;
    if (ids.length < 2) return;
    get().mutate((floors) => {
      const f = floors.find((it) => it.id === get().floorId);
      if (!f) return;
      const sel = f.blocks
        .filter((b) => ids.includes(b.id))
        .sort((a, b) => (axis === 'x' ? a.x - b.x : a.y - b.y));
      if (sel.length < 2) return;
      if (axis === 'x') {
        const start = Math.min(...sel.map((b) => b.x));
        const end = Math.max(...sel.map((b) => b.x + b.width));
        const total = sel.reduce((s, b) => s + b.width, 0);
        const gap = Math.max(BLOCK_GAP, (end - start - total) / (sel.length - 1));
        let cur = start;
        for (const b of sel) {
          b.x = Math.max(0, Math.round(cur));
          cur += b.width + gap;
        }
      } else {
        const start = Math.min(...sel.map((b) => b.y));
        const end = Math.max(...sel.map((b) => b.y + b.height));
        const total = sel.reduce((s, b) => s + b.height, 0);
        const gap = Math.max(BLOCK_GAP, (end - start - total) / (sel.length - 1));
        let cur = start;
        for (const b of sel) {
          b.y = Math.max(0, Math.round(cur));
          cur += b.height + gap;
        }
      }
    });
  },

  batchMove: (dx, dy) => {
    const ids = get().batchIds;
    if (!ids.length || (!dx && !dy)) return;
    get().mutate((floors) => {
      const f = floors.find((it) => it.id === get().floorId);
      if (!f) return;
      for (const b of f.blocks) {
        if (!ids.includes(b.id)) continue;
        b.x = Math.max(0, Math.round(b.x + dx));
        b.y = Math.max(0, Math.round(b.y + dy));
      }
    });
  },

  copySelection: () => {
    const s = get();
    const floor = currentFloor(s);
    if (!floor) return;
    const ids = s.batchMode && s.batchIds.length ? s.batchIds : s.sel ? [s.sel.blockId] : [];
    clipboard = floor.blocks.filter((b) => ids.includes(b.id)).map((b) => clone(b));
    set({ clipboardCount: clipboard.length });
  },

  pasteClipboard: () => {
    if (!clipboard.length) return;
    const items = clipboard.map((b) => ({
      ...clone(b),
      id: `blk_${Math.random().toString(36).slice(2, 9)}`,
    }));
    get().mutate((floors) => {
      const f = floors.find((it) => it.id === get().floorId);
      if (!f) return;
      for (const item of items) {
        const spot = findFreeSpot(
          f.blocks.map(rectOf),
          { width: item.width, height: item.height },
          { x: item.x + 20, y: item.y + 20 },
        );
        item.x = spot.x;
        item.y = spot.y;
        f.blocks.push(item);
      }
    });
    set({
      sel: { kind: 'block', blockId: items[items.length - 1].id },
      batchMode: false,
      batchIds: [],
    });
  },

  batchSameSize: (which) => {
    const ids = get().batchIds;
    if (ids.length < 2) return;
    get().mutate((floors) => {
      const f = floors.find((it) => it.id === get().floorId);
      if (!f) return;
      const sel = f.blocks.filter((b) => ids.includes(b.id));
      if (sel.length < 2) return;
      const ref =
        which === 'first'
          ? sel[0]
          : sel.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a), sel[0]);
      for (const b of sel) {
        b.width = ref.width;
        b.height = ref.height;
        if (b.showSeats) {
          const { cols, rows } = colsRowsFromSize(b, ref.width, ref.height);
          b.cols = cols;
          b.rows = rows;
          b.seats = resizeSeats(b, cols, rows);
        }
      }
    });
  },

  addSeatAt: (blockId, index) => {
    get().mutate((floors) => {
      const f = floors.find((it) => it.id === get().floorId);
      const b = f?.blocks.find((it) => it.id === blockId);
      if (!b || !b.seats[index]) return;
      b.seats[index] = {
        seatNo: nextSeatNo(b, index),
        machineSN: '',
        portNo: '',
        fields: [],
      };
    });
  },

  setSeatBatchMode: (seatBatchMode) =>
    set({ seatBatchMode, seatIds: [], sel: null, batchMode: false, batchIds: [] }),

  seatToggle: (blockId, index) =>
    set((s) => {
      const key = `${blockId}:${index}`;
      return {
        seatIds: s.seatIds.includes(key) ? s.seatIds.filter((x) => x !== key) : [...s.seatIds, key],
      };
    }),

  seatSelectMany: (ids) => set({ seatIds: ids }),

  seatClearMany: () => {
    const ids = get().seatIds;
    if (!ids.length) return;
    const setIds = new Set(ids);
    get().mutate((floors) => {
      const f = floors.find((it) => it.id === get().floorId);
      if (!f) return;
      f.blocks.forEach((b) => {
        b.seats.forEach((seat, i) => {
          if (!setIds.has(`${b.id}:${i}`)) return;
          seat.seatNo = '';
          seat.machineSN = '';
          seat.portNo = '';
          seat.fields = [];
        });
      });
    });
    set({ seatIds: [] });
  },

  seatClearField: (label) => {
    const setIds = new Set(get().seatIds);
    if (!setIds.size) return;
    get().mutate((floors) => {
      const f = floors.find((it) => it.id === get().floorId);
      if (!f) return;
      f.blocks.forEach((b) => {
        b.seats.forEach((seat, i) => {
          if (!setIds.has(`${b.id}:${i}`)) return;
          if (label === '座位号') seat.seatNo = '';
          else if (label === '机器SN') seat.machineSN = '';
          else if (label === '网口号') seat.portNo = '';
          else seat.fields = seat.fields.filter((x) => x.label !== label && x.key !== label);
        });
      });
    });
  },

  seatSetField: (label, value) => {
    const setIds = new Set(get().seatIds);
    if (!setIds.size) return;
    get().mutate((floors) => {
      const f = floors.find((it) => it.id === get().floorId);
      if (!f) return;
      f.blocks.forEach((b) => {
        b.seats.forEach((seat, i) => {
          if (!setIds.has(`${b.id}:${i}`)) return;
          if (label === '座位号') seat.seatNo = value;
          else if (label === '机器SN') seat.machineSN = value;
          else if (label === '网口号') seat.portNo = value;
          else {
            const found = seat.fields.find((x) => x.label === label || x.key === label);
            if (found) found.value = value;
            else seat.fields.push({ key: `col_${label}`, label, value });
          }
        });
      });
    });
  },

  setFloor: (floorId) => set({ floorId, sel: null, overlapWarn: null, batchIds: [] }),

  addFloor: () => {
    const s = get();
    const names = new Set(s.doc.floors.map((f) => f.name));
    let name = '新楼层';
    let n = 2;
    while (names.has(name)) {
      name = `新楼层${n}`;
      n += 1;
    }
    const id = `f_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    get().mutate((floors) => {
      floors.push({ id, name, blocks: [] });
    });
    set({ floorId: id, sel: null, overlapWarn: null, batchIds: [], batchMode: false });
    return id;
  },

  removeFloor: (id) => {
    const s = get();
    if (s.doc.floors.length <= 1) return;
    const removingCurrent = s.floorId === id;
    get().mutate((floors) => {
      const idx = floors.findIndex((f) => f.id === id);
      if (idx >= 0) floors.splice(idx, 1);
    });
    if (removingCurrent) {
      set({
        floorId: get().doc.floors[0]?.id ?? '',
        sel: null,
        overlapWarn: null,
        batchIds: [],
        batchMode: false,
      });
    }
  },

  renameFloor: (id, name) => {
    const clean = name.trim();
    if (!clean) return;
    get().mutate((floors) => {
      const f = floors.find((it) => it.id === id);
      if (f) f.name = clean;
    });
  },

  setMode: (mode) =>
    set((s) =>
      mode === 'edit'
        ? {
            mode,
            viewSel: s.sel,
            sel: null,
            overlapWarn: null,
            batchMode: false,
            batchIds: [],
            seatBatchMode: false,
            seatIds: [],
          }
        : {
            mode,
            sel: s.viewSel,
            overlapWarn: null,
            batchMode: false,
            batchIds: [],
            seatBatchMode: false,
            seatIds: [],
          },
    ),
  setQuery: (query) => set({ query }),
  setMatchMode: (matchMode) => set({ matchMode }),
  select: (sel) => set({ sel }),
  setAuth: (token, reauth, user) => set({ token, reauth, user }),
  clearAuth: () =>
    set((s) => ({
      token: null,
      reauth: null,
      user: null,
      mode: 'view',
      sel: s.viewSel,
      overlapWarn: null,
      batchMode: false,
      batchIds: [],
      seatBatchMode: false,
      seatIds: [],
    })),
  markSaved: (version, updatedAt) =>
    set((s) => ({ doc: { ...s.doc, version, updatedAt }, dirty: false })),
  setGlobalSnap: (globalSnap) => set({ globalSnap }),
  setTheme: (theme) => {
    try {
      localStorage.setItem('seatmap-theme', theme);
    } catch {
      /* ignore */
    }
    set({ theme });
  },
  clearOverlapWarn: () => set({ overlapWarn: null }),

  mutate: (fn, coalesceKey) => {
    const s = get();
    const now = Date.now();
    // 同一目标同一字段 1 秒内的连续输入合并为一步撤销（如逐字键入座位号）
    const merge =
      coalesceKey != null &&
      lastMutate != null &&
      lastMutate.key === coalesceKey &&
      now - lastMutate.at < 1000;
    lastMutate = coalesceKey != null ? { key: coalesceKey, at: now } : null;
    const past = merge ? s.past : [...s.past, clone(s.doc.floors)].slice(-HISTORY_LIMIT);
    const floors = clone(s.doc.floors);
    fn(floors);
    set({ doc: { ...s.doc, floors }, past, future: [], dirty: true });
  },

  undo: () => {
    const s = get();
    if (!s.past.length) return;
    const prev = s.past[s.past.length - 1];
    set({
      doc: { ...s.doc, floors: prev },
      past: s.past.slice(0, -1),
      future: [clone(s.doc.floors), ...s.future].slice(0, HISTORY_LIMIT),
      dirty: true,
      overlapWarn: null,
    });
  },

  redo: () => {
    const s = get();
    if (!s.future.length) return;
    const next = s.future[0];
    set({
      doc: { ...s.doc, floors: next },
      past: [...s.past, clone(s.doc.floors)].slice(-HISTORY_LIMIT),
      future: s.future.slice(1),
      dirty: true,
      overlapWarn: null,
    });
  },

  addBlock: (x, y) => {
    const block = makeBlock({ x, y, text: 'X区', showSeats: false });
    const floor = currentFloor(get());
    const spot = findFreeSpot(
      (floor?.blocks ?? []).map(rectOf),
      { width: block.width, height: block.height },
      { x, y },
    );
    block.x = spot.x;
    block.y = spot.y;
    get().mutate((floors) => {
      const f = floors.find((it) => it.id === get().floorId);
      if (f) f.blocks.push(block);
    });
    set({ sel: { kind: 'block', blockId: block.id } });
    return block.id;
  },

  updateBlock: (id, patch) => {
    get().mutate((floors) => {
      const f = floors.find((it) => it.id === get().floorId);
      const b = f?.blocks.find((it) => it.id === id);
      if (!b || !f) return;
      Object.assign(b, patch);
      b.cols = Math.max(1, Math.floor(b.cols));
      b.rows = Math.max(1, Math.floor(b.rows));
      if (patch.cols !== undefined || patch.rows !== undefined || patch.seatPrefix !== undefined) {
        b.seats = resizeSeats(b, b.cols, b.rows);
      }
      if (
        (patch.cols !== undefined || patch.rows !== undefined || patch.showSeats === true) &&
        patch.width === undefined &&
        patch.height === undefined
      ) {
        const size = autoBlockSize(b);
        b.width = size.width;
        b.height = size.height;
      }
    });
    get().checkOverlap(id);
  },

  updateBlockRaw: (id, patch) => {
    get().mutate(
      (floors) => {
        const f = floors.find((it) => it.id === get().floorId);
        const b = f?.blocks.find((it) => it.id === id);
        if (!b) return;
        Object.assign(b, patch);
        b.cols = Math.max(1, Math.floor(b.cols));
        b.rows = Math.max(1, Math.floor(b.rows));
        if (
          patch.cols !== undefined ||
          patch.rows !== undefined ||
          patch.seatPrefix !== undefined
        ) {
          b.seats = resizeSeats(b, b.cols, b.rows);
        }
        if (
          (patch.cols !== undefined || patch.rows !== undefined || patch.showSeats === true) &&
          patch.width === undefined &&
          patch.height === undefined
        ) {
          const size = autoBlockSize(b);
          b.width = size.width;
          b.height = size.height;
        }
      },
      `block:${id}:${Object.keys(patch).join(',')}`,
    );
    // 数值编辑结束后统一检测（防抖，避免拖动过程中反复提示）
    if (checkTimer) clearTimeout(checkTimer);
    checkTimer = setTimeout(() => get().checkOverlap(id), 700);
  },

  checkOverlap: (id) => {
    const s = get();
    const floor = currentFloor(s);
    const block = floor?.blocks.find((b) => b.id === id);
    if (!floor || !block) return set({ overlapWarn: null });
    const conflicts = conflictsOf(floor, block);
    set({ overlapWarn: conflicts.length ? { blockId: id, conflicts } : null });
  },

  fixOverlapBlock: (id) => {
    get().mutate((floors) => {
      const f = floors.find((it) => it.id === get().floorId);
      const b = f?.blocks.find((it) => it.id === id);
      if (f && b) fixOverlap(f, b);
    });
    set({ overlapWarn: null });
  },

  removeBlock: (id) => {
    get().mutate((floors) => {
      const f = floors.find((it) => it.id === get().floorId);
      if (f) f.blocks = f.blocks.filter((b) => b.id !== id);
    });
    if (get().sel?.kind === 'block' && get().sel?.blockId === id) set({ sel: null });
  },

  swapBlocks: (aId, bId) => {
    get().mutate((floors) => {
      const f = floors.find((it) => it.id === get().floorId);
      if (!f) return;
      const a = f.blocks.find((b) => b.id === aId);
      const b = f.blocks.find((it) => it.id === bId);
      if (!a || !b) return;
      const ax = a.x;
      const ay = a.y;
      a.x = b.x;
      a.y = b.y;
      b.x = ax;
      b.y = ay;
    });
  },

  placeBlock: (id, x, y, snapGrid = true) => {
    get().mutate((floors) => {
      const f = floors.find((it) => it.id === get().floorId);
      if (!f) return;
      const b = f.blocks.find((it) => it.id === id);
      if (!b) return;
      const target = {
        x: Math.max(0, snapGrid ? snap(x) : Math.round(x)),
        y: Math.max(0, snapGrid ? snap(y) : Math.round(y)),
      };
      const me: Rect = { ...target, width: b.width, height: b.height };

      let best: Block | null = null;
      let bestRatio = 0;
      for (const other of f.blocks) {
        if (other.id === id) continue;
        const ratio = overlapRatio(me, rectOf(other));
        if (ratio > bestRatio) {
          bestRatio = ratio;
          best = other;
        }
      }

      if (best && bestRatio > 0.1) {
        // 重叠 → 两个控件互换位置（A 去 B 原来的位置，B 去 A 原来的位置）
        const ax = b.x;
        const ay = b.y;
        const bx = best.x;
        const by = best.y;
        b.x = bx;
        b.y = by;
        best.x = ax;
        best.y = ay;
        fixOverlap(f, b);
        fixOverlap(f, best);
      } else {
        b.x = target.x;
        b.y = target.y;
      }
    });
  },

  resizeBlock: (id, x, y, width, height) => {
    get().mutate((floors) => {
      const f = floors.find((it) => it.id === get().floorId);
      const b = f?.blocks.find((it) => it.id === id);
      if (!b) return;
      if (b.showSeats) {
        // 依据拉伸后的长宽自动计算行列数 → 自动增减工位
        const { cols, rows } = colsRowsFromSize(b, width, height);
        b.cols = cols;
        b.rows = rows;
        b.seats = resizeSeats(b, cols, rows);
        const size = autoBlockSize(b);
        b.width = size.width;
        b.height = size.height;
      } else {
        b.width = Math.max(2, Math.round(width));
        b.height = Math.max(2, Math.round(height));
      }
      b.x = Math.max(0, Math.round(x));
      b.y = Math.max(0, Math.round(y));
    });
    get().checkOverlap(id);
  },

  resolveAllOverlaps: () => {
    get().mutate((floors) => {
      const f = floors.find((it) => it.id === get().floorId);
      if (!f) return;
      const spots = resolveOverlaps(f.blocks);
      for (const b of f.blocks) {
        const spot = spots.get(b.id);
        if (spot) {
          b.x = spot.x;
          b.y = spot.y;
        }
      }
    });
    set({ overlapWarn: null });
  },

  updateSeat: (blockId, index, patch) => {
    get().mutate(
      (floors) => {
        const f = floors.find((it) => it.id === get().floorId);
        const b = f?.blocks.find((it) => it.id === blockId);
        if (!b || !b.seats[index]) return;
        Object.assign(b.seats[index], patch);
      },
      `seat:${blockId}:${index}:${Object.keys(patch).join(',')}`,
    );
  },

  addSeatField: (blockId, index, field) => {
    get().mutate((floors) => {
      const f = floors.find((it) => it.id === get().floorId);
      const seat = f?.blocks.find((it) => it.id === blockId)?.seats[index];
      if (!seat) return;
      const n = seat.fields.length + 1;
      seat.fields.push(field ?? { key: `field${n}`, label: `自定义属性${n}`, value: '' });
    });
  },

  updateSeatField: (blockId, index, fieldIndex, patch) => {
    get().mutate(
      (floors) => {
        const f = floors.find((it) => it.id === get().floorId);
        const seat = f?.blocks.find((it) => it.id === blockId)?.seats[index];
        if (!seat || !seat.fields[fieldIndex]) return;
        Object.assign(seat.fields[fieldIndex], patch);
      },
      `seatfield:${blockId}:${index}:${fieldIndex}:${Object.keys(patch).join(',')}`,
    );
  },

  removeSeatField: (blockId, index, fieldIndex) => {
    get().mutate((floors) => {
      const f = floors.find((it) => it.id === get().floorId);
      const seat = f?.blocks.find((it) => it.id === blockId)?.seats[index];
      if (!seat) return;
      seat.fields.splice(fieldIndex, 1);
    });
  },

  applyFieldsToBlock: (blockId, index) => {
    get().mutate((floors) => {
      const f = floors.find((it) => it.id === get().floorId);
      const block = f?.blocks.find((it) => it.id === blockId);
      const src = block?.seats[index];
      if (!block || !src) return;
      for (const seat of block.seats) {
        for (const field of src.fields) {
          if (!seat.fields.some((x) => x.key === field.key)) {
            seat.fields.push({ key: field.key, label: field.label, value: '' });
          }
        }
      }
    });
  },

  swapSeats: (blockId, i, otherBlockId, j) => {
    get().mutate((floors) => {
      const f = floors.find((it) => it.id === get().floorId);
      const a = f?.blocks.find((it) => it.id === blockId);
      const b = f?.blocks.find((it) => it.id === otherBlockId);
      if (!a || !b || !a.seats[i] || !b.seats[j]) return;
      const tmp = a.seats[i];
      a.seats[i] = b.seats[j];
      b.seats[j] = tmp;
    });
  },
}));

export function currentFloor(state: { doc: LayoutDoc; floorId: string }): Floor | undefined {
  return state.doc.floors.find((f) => f.id === state.floorId);
}
