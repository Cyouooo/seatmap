import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Stage, Layer, Group, Rect, Text, Transformer } from 'react-konva';
import type Konva from 'konva';
import KonvaLib from 'konva';
import { useStore } from '../store';
import {
  CELL_H,
  CELL_W,
  PAD,
  TITLE_H,
  alignmentSnap,
  clamp,
  findFreeSpot,
  findFreeSpotInView,
  hexToRgba,
  makeBlock,
  rectOf,
  seatLabelText,
  seatRect,
  snap,
  titleHeight,
  type Guide,
  type Rect as WorldRect,
} from '../lib/layout';
import { matchKey } from '../lib/fuzzy';
import type { Block, Floor, Match, Seat } from '../types';

interface TransformBox {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

interface Props {
  matches: Map<string, Match>;
}

const SELECT_COLOR = '#0f172a';
/**
 * 搜索高亮：
 * 强命中 = 洋红 #d946ef，弱命中 = 浅洋红 #f0abfc。
 * 洋红系整套界面配色（蓝/天蓝/绿/琥珀/红/紫/灰、选中深灰、警示琥珀、危险红、辅助线玫红）中均未使用，
 * 色相与明度都与既有颜色明显区分，且不易与「未分配」琥珀徽标混淆。
 */
const STRONG_COLOR = '#d946ef';
const WEAK_COLOR = '#f0abfc';
const GUIDE_COLOR = '#e11d48';
const BATCH_COLOR = '#6366f1';

interface FocusDetail {
  center?: { x: number; y: number };
  zoom?: number;
  rect?: WorldRect;
}

interface HoverInfo {
  blockId: string;
  seatIndex: number;
  x: number;
  y: number;
}

function pointerInLayer(
  layer: Konva.Layer | null,
  fallback: { x: number; y: number },
): { x: number; y: number } {
  if (!layer) return fallback;
  const p = layer.getRelativePointerPosition();
  return p ?? fallback;
}

function intersects(a: WorldRect, b: WorldRect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export default function FloorCanvas({ matches }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<Konva.Stage | null>(null);
  const layerRef = useRef<Konva.Layer | null>(null);
  const guideLayerRef = useRef<Konva.Layer | null>(null);
  const trRef = useRef<Konva.Transformer | null>(null);
  const nodeRefs = useRef(new Map<string, Konva.Node>());
  const marqueeStart = useRef<{ x: number; y: number } | null>(null);
  const transformGuides = useRef<Guide[]>([]);
  const [size, setSize] = useState({ width: 900, height: 600 });
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const lastFocusAt = useRef(0);

  const doc = useStore((s) => s.doc);
  const floorId = useStore((s) => s.floorId);
  const mode = useStore((s) => s.mode);
  const sel = useStore((s) => s.sel);
  const select = useStore((s) => s.select);
  const globalSnap = useStore((s) => s.globalSnap);
  const seatLabelField = useStore((s) => s.seatLabelField);
  const batchMode = useStore((s) => s.batchMode);
  const batchIds = useStore((s) => s.batchIds);
  const seatBatchMode = useStore((s) => s.seatBatchMode);
  const seatIds = useStore((s) => s.seatIds);

  const floor = useMemo(() => doc.floors.find((f) => f.id === floorId), [doc, floorId]);
  const floorRef = useRef<Floor | undefined>(floor);
  floorRef.current = floor;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const selectedBlockRef = useRef<Block | undefined>(undefined);
  selectedBlockRef.current =
    sel?.kind === 'block' ? floor?.blocks.find((b) => b.id === sel.blockId) : undefined;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ width: el.clientWidth, height: el.clientHeight });
    });
    ro.observe(el);
    setSize({ width: el.clientWidth, height: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  /** 绘制辅助线（直接操作 Konva，避免频繁 setState） */
  const drawGuides = useCallback((guides: Guide[], marquee?: WorldRect | null) => {
    const layer = guideLayerRef.current;
    if (!layer) return;
    layer.destroyChildren();
    for (const g of guides) {
      const points =
        g.orientation === 'v'
          ? [g.position, g.start - 24, g.position, g.end + 24]
          : [g.start - 24, g.position, g.end + 24, g.position];
      layer.add(
        new KonvaLib.Line({
          points,
          stroke: GUIDE_COLOR,
          strokeWidth: 1.2,
          dash: [6, 4],
          listening: false,
        }),
      );
    }
    if (marquee) {
      layer.add(
        new KonvaLib.Rect({
          x: marquee.x,
          y: marquee.y,
          width: marquee.width,
          height: marquee.height,
          stroke: BATCH_COLOR,
          strokeWidth: 1.2,
          dash: [5, 4],
          fill: 'rgba(99,102,241,0.10)',
          listening: false,
        }),
      );
    }
    layer.batchDraw();
  }, []);

  const fit = (force = false) => {
    if (!force && Date.now() - lastFocusAt.current < 1500) return;
    const stage = stageRef.current;
    const blocks = floorRef.current?.blocks ?? [];
    if (!stage || !blocks.length) return;
    const minX = Math.min(...blocks.map((b) => b.x)) - 50;
    const minY = Math.min(...blocks.map((b) => b.y)) - 50;
    const maxX = Math.max(...blocks.map((b) => b.x + b.width)) + 50;
    const maxY = Math.max(...blocks.map((b) => b.y + b.height)) + 50;
    const scale = Math.max(
      0.15,
      Math.min(size.width / (maxX - minX), size.height / (maxY - minY), 2),
    );
    stage.scale({ x: scale, y: scale });
    stage.position({
      x: (size.width - (maxX - minX) * scale) / 2 - minX * scale,
      y: (size.height - (maxY - minY) * scale) / 2 - minY * scale,
    });
    stage.batchDraw();
  };

  const zoomBy = (factor: number) => {
    const stage = stageRef.current;
    if (!stage) return;
    const oldScale = stage.scaleX();
    const next = Math.min(3, Math.max(0.15, oldScale * factor));
    const center = { x: size.width / 2, y: size.height / 2 };
    const pointTo = {
      x: (center.x - stage.x()) / oldScale,
      y: (center.y - stage.y()) / oldScale,
    };
    stage.scale({ x: next, y: next });
    stage.position({ x: center.x - pointTo.x * next, y: center.y - pointTo.y * next });
    stage.batchDraw();
  };

  const focusOn = (detail: FocusDetail) => {
    const stage = stageRef.current;
    if (!stage) return;
    lastFocusAt.current = Date.now();
    if (detail.center && detail.zoom) {
      const z = detail.zoom;
      stage.scale({ x: z, y: z });
      stage.position({
        x: size.width / 2 - detail.center.x * z,
        y: size.height / 2 - detail.center.y * z,
      });
    } else if (detail.rect) {
      const pad = 110;
      const w = Math.max(200, detail.rect.width + pad * 2);
      const h = Math.max(160, detail.rect.height + pad * 2);
      const scale = clamp(Math.min(size.width / w, size.height / h), 0.2, 1.25);
      const cx = detail.rect.x + detail.rect.width / 2;
      const cy = detail.rect.y + detail.rect.height / 2;
      stage.scale({ x: scale, y: scale });
      stage.position({ x: size.width / 2 - cx * scale, y: size.height / 2 - cy * scale });
    }
    stage.batchDraw();
  };

  /** 拉伸时的对齐吸附：宽/高或边与其它控件对齐（含辅助线） */
  const boundBoxFunc = (oldBox: TransformBox, newBox: TransformBox): TransformBox => {
    const stage = stageRef.current;
    const block = selectedBlockRef.current;
    const snapping = globalSnap && block && block.snapEnabled !== false;
    const minSize = 2;
    if (!stage || !snapping || !block) {
      if (newBox.width < minSize || newBox.height < minSize) {
        return {
          ...newBox,
          width: Math.max(minSize, newBox.width),
          height: Math.max(minSize, newBox.height),
        };
      }
      return newBox;
    }
    const sx = stage.scaleX();
    const sy = stage.scaleY();
    const ox = stage.x();
    const oy = stage.y();
    const world = {
      x: (newBox.x - ox) / sx,
      y: (newBox.y - oy) / sy,
      width: newBox.width / sx,
      height: newBox.height / sy,
    };
    const others = (floorRef.current?.blocks ?? [])
      .filter((b) => b.id !== block.id)
      .map((b) => ({ x: b.x, y: b.y, width: b.width, height: b.height }));
    if (!others.length) return newBox;

    const edgesX = others.flatMap((b) => [b.x, b.x + b.width / 2, b.x + b.width]);
    const edgesY = others.flatMap((b) => [b.y, b.y + b.height / 2, b.y + b.height]);
    const threshold = 8;
    const nearestDelta = (v: number, list: number[]): { delta: number; target: number } | null => {
      let best: { delta: number; target: number } | null = null;
      for (const c of list) {
        const d = c - v;
        if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.delta))) {
          best = { delta: d, target: c };
        }
      }
      return best;
    };

    const leftMoved = Math.abs(newBox.x - oldBox.x) > 0.5;
    const rightMoved = Math.abs(newBox.x + newBox.width - (oldBox.x + oldBox.width)) > 0.5;
    const topMoved = Math.abs(newBox.y - oldBox.y) > 0.5;
    const bottomMoved = Math.abs(newBox.y + newBox.height - (oldBox.y + oldBox.height)) > 0.5;

    const guides: Guide[] = [];
    let { x, y, width, height } = world;

    if (rightMoved) {
      const hit = nearestDelta(x + width, edgesX);
      if (hit) {
        width = Math.max(minSize, hit.target - x);
        guides.push({
          orientation: 'v',
          position: hit.target,
          start: y,
          end: y + height,
        });
      }
    } else if (leftMoved) {
      const hit = nearestDelta(x, edgesX);
      if (hit) {
        const right = x + width;
        width = Math.max(minSize, right - hit.target);
        x = right - width;
        guides.push({ orientation: 'v', position: hit.target, start: y, end: y + height });
      }
    }
    if (bottomMoved) {
      const hit = nearestDelta(y + height, edgesY);
      if (hit) {
        height = Math.max(minSize, hit.target - y);
        guides.push({ orientation: 'h', position: hit.target, start: x, end: x + width });
      }
    } else if (topMoved) {
      const hit = nearestDelta(y, edgesY);
      if (hit) {
        const bottom = y + height;
        height = Math.max(minSize, bottom - hit.target);
        y = bottom - height;
        guides.push({ orientation: 'h', position: hit.target, start: x, end: x + width });
      }
    }

    if (width < minSize) width = minSize;
    if (height < minSize) height = minSize;
    transformGuides.current = guides;
    drawGuides(guides);

    return {
      x: x * sx + ox,
      y: y * sy + oy,
      width: width * sx,
      height: height * sy,
      rotation: 0,
    };
  };

  // 调试 / 自动化测试入口：window.__seatmap
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__seatmap = {
      store: useStore,
      Konva: KonvaLib,
      getStage: () => stageRef.current,
      getLayer: () => layerRef.current,
    };
  }, []);

  useEffect(() => {
    const onFit = () => fit(true);
    const onZoom = (e: Event) => zoomBy((e as CustomEvent).detail?.factor ?? 1.1);
    const onFocus = (e: Event) => focusOn((e as CustomEvent).detail as FocusDetail);
    /** 新增控件：直接放在当前可视区域的空白处 */
    const onAddBlock = () => {
      const stage = stageRef.current;
      const el = containerRef.current;
      if (!stage || !el) return;
      const scale = stage.scaleX();
      const view: WorldRect = {
        x: (0 - stage.x()) / scale,
        y: (0 - stage.y()) / scale,
        width: el.clientWidth / scale,
        height: el.clientHeight / scale,
      };
      const blocks = floorRef.current?.blocks ?? [];
      const size = makeBlock({ x: 0, y: 0 });
      const spot =
        findFreeSpotInView(blocks, { width: size.width, height: size.height }, view) ??
        findFreeSpot(
          blocks.map(rectOf),
          { width: size.width, height: size.height },
          { x: view.x + 40, y: view.y + 40 },
        );
      useStore.getState().addBlock(spot.x, spot.y);
    };
    window.addEventListener('seatmap:fit', onFit);
    window.addEventListener('seatmap:zoom', onZoom as EventListener);
    window.addEventListener('seatmap:focus', onFocus as EventListener);
    window.addEventListener('seatmap:addBlock', onAddBlock);
    return () => {
      window.removeEventListener('seatmap:fit', onFit);
      window.removeEventListener('seatmap:zoom', onZoom as EventListener);
      window.removeEventListener('seatmap:focus', onFocus as EventListener);
      window.removeEventListener('seatmap:addBlock', onAddBlock);
    };
  });

  useEffect(() => {
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floorId, doc.floors.length, size.width, size.height]);

  useEffect(() => {
    const tr = trRef.current;
    if (!tr) return;
    if (mode === 'edit' && !batchMode && sel && sel.kind === 'block') {
      const node = nodeRefs.current.get(`block:${sel.blockId}`);
      tr.nodes(node ? [node] : []);
    } else {
      tr.nodes([]);
    }
    tr.getLayer()?.batchDraw();
  }, [sel, mode, doc, batchMode]);

  useEffect(() => {
    if (mode !== 'view') setHover(null);
  }, [mode]);

  const register = useCallback((key: string, node: Konva.Node | null) => {
    if (node) nodeRefs.current.set(key, node);
    else nodeRefs.current.delete(key);
  }, []);

  const handleHover = useCallback((info: HoverInfo | null) => setHover(info), []);

  const handleWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    const oldScale = stage.scaleX();
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    const pointTo = {
      x: (pointer.x - stage.x()) / oldScale,
      y: (pointer.y - stage.y()) / oldScale,
    };
    const next = Math.min(3, Math.max(0.15, oldScale * (e.evt.deltaY > 0 ? 0.93 : 1.07)));
    stage.scale({ x: next, y: next });
    stage.position({ x: pointer.x - pointTo.x * next, y: pointer.y - pointTo.y * next });
    stage.batchDraw();
  };

  const edit = mode === 'edit';

  const onStageClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (e.target === e.target.getStage() && !batchMode) select(null);
  };

  /* ---------------- 框选（批量模式） ---------------- */
  const onStageMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (!batchMode || !edit) return;
    if (e.target !== e.target.getStage()) return;
    const p = stageRef.current?.getRelativePointerPosition();
    if (!p) return;
    marqueeStart.current = { x: p.x, y: p.y };
  };

  const onStageMouseMove = () => {
    if (!marqueeStart.current) return;
    const p = stageRef.current?.getRelativePointerPosition();
    if (!p) return;
    const s = marqueeStart.current;
    drawGuides([], {
      x: Math.min(s.x, p.x),
      y: Math.min(s.y, p.y),
      width: Math.abs(p.x - s.x),
      height: Math.abs(p.y - s.y),
    });
  };

  const onStageMouseUp = () => {
    if (!marqueeStart.current) return;
    const p = stageRef.current?.getRelativePointerPosition();
    const s = marqueeStart.current;
    marqueeStart.current = null;
    drawGuides([]);
    if (!p) return;
    const rect = {
      x: Math.min(s.x, p.x),
      y: Math.min(s.y, p.y),
      width: Math.abs(p.x - s.x),
      height: Math.abs(p.y - s.y),
    };
    if (rect.width < 4 && rect.height < 4) {
      useStore.getState().batchSelect([]);
      return;
    }
    const ids = (floorRef.current?.blocks ?? [])
      .filter((b) => intersects(rectOf(b), rect))
      .map((b) => b.id);
    useStore.getState().batchSelect(ids);
  };

  const hoverBlock = hover ? floor?.blocks.find((b) => b.id === hover.blockId) : undefined;
  const hoverSeat = hover && hoverBlock ? hoverBlock.seats[hover.seatIndex] : undefined;

  return (
    <div className="canvas-wrap" ref={containerRef}>
      <Stage
        ref={stageRef}
        width={size.width}
        height={size.height}
        draggable={!batchMode}
        onWheel={handleWheel}
        onClick={onStageClick}
        onMouseDown={onStageMouseDown}
        onMouseMove={onStageMouseMove}
        onMouseUp={onStageMouseUp}
        onDragEnd={(e) => {
          if (e.target === e.target.getStage()) stageRef.current?.batchDraw();
        }}
        style={{ cursor: batchMode ? 'crosshair' : 'grab' }}
      >
        <Layer ref={layerRef}>
          {(floor?.blocks ?? []).map((block) => (
            <MemoBlockNode
              key={block.id}
              block={block}
              edit={edit}
              batchMode={batchMode}
              batchSelected={batchIds.includes(block.id)}
              selected={sel?.kind === 'block' && sel.blockId === block.id}
              selectedSeatIndex={
                sel?.kind === 'seat' && sel.blockId === block.id ? sel.seatIndex : -1
              }
              hoverSeatIndex={hover && hover.blockId === block.id ? hover.seatIndex : -1}
              seatBatchMode={seatBatchMode}
              seatIds={seatIds}
              matches={matches}
              seatLabelField={seatLabelField}
              register={register}
              nodeRefs={nodeRefs}
              layerRef={layerRef}
              floorRef={floorRef}
              globalSnap={globalSnap}
              drawGuides={drawGuides}
              onHover={handleHover}
            />
          ))}
          <Transformer
            ref={trRef}
            rotateEnabled={false}
            flipEnabled={false}
            keepRatio={false}
            padding={5}
            borderStroke={SELECT_COLOR}
            anchorStroke={SELECT_COLOR}
            anchorSize={9}
            anchorCornerRadius={3}
            boundBoxFunc={boundBoxFunc}
            onTransformEnd={() => {
              transformGuides.current = [];
              drawGuides([]);
            }}
          />
        </Layer>
        <Layer ref={guideLayerRef} listening={false} />
      </Stage>

      {hover && hoverBlock && hoverSeat ? (
        <div
          className="seat-tip"
          style={{
            left: clamp(hover.x, 130, Math.max(130, size.width - 130)),
            top: Math.max(8, hover.y - 12),
          }}
        >
          <div className="seat-tip-head">
            <strong>{hoverSeat.seatNo || '—'}</strong>
            <span>{hoverBlock.text}</span>
            {!hoverSeat.machineSN ? <em className="seat-tip-warn">未分配</em> : null}
          </div>
          <table className="seat-tip-table">
            <tbody>
              <tr>
                <td>机器SN</td>
                <td>{hoverSeat.machineSN || '—'}</td>
              </tr>
              <tr>
                <td>网口号</td>
                <td>{hoverSeat.portNo || '—'}</td>
              </tr>
              {hoverSeat.fields.map((f) => (
                <tr key={f.key}>
                  <td>{f.label || f.key}</td>
                  <td>{f.value || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="canvas-hint">
        {seatBatchMode
          ? '工位批量：点击工位加选 / 取消（可跨控件）· 右侧面板可批量清空 / 设置属性'
          : batchMode
            ? '控件批量：在空白处拖动框选控件（也可点击单个控件加选）· 右侧面板可批量删除 / 改色 / 统一尺寸 / 对齐'
            : edit
              ? globalSnap
                ? '编辑模式：拖动控件（辅助线自动吸附，重叠自动互换）· 拖控制点拉伸（带吸附辅助线）'
                : '编辑模式：自动吸附已关闭 · 拖动控件自由摆放（重叠自动互换）'
              : '滚轮缩放 · 拖拽平移 · 悬停工位查看详情 · 搜索时自动定位命中区域'}
      </div>
    </div>
  );
}

interface BlockNodeProps {
  block: Block;
  edit: boolean;
  batchMode: boolean;
  batchSelected: boolean;
  selected: boolean;
  selectedSeatIndex: number;
  hoverSeatIndex: number;
  seatBatchMode: boolean;
  seatIds: string[];
  matches: Map<string, Match>;
  seatLabelField: string;
  register: (key: string, node: Konva.Node | null) => void;
  nodeRefs: React.MutableRefObject<Map<string, Konva.Node>>;
  layerRef: React.MutableRefObject<Konva.Layer | null>;
  floorRef: React.MutableRefObject<Floor | undefined>;
  globalSnap: boolean;
  drawGuides: (guides: Guide[], marquee?: WorldRect | null) => void;
  onHover: (info: HoverInfo | null) => void;
}

function BlockNode({
  block,
  edit,
  batchMode,
  batchSelected,
  selected,
  selectedSeatIndex,
  hoverSeatIndex,
  seatBatchMode,
  seatIds,
  matches,
  seatLabelField,
  register,
  nodeRefs,
  layerRef,
  floorRef,
  globalSnap,
  drawGuides,
  onHover,
}: BlockNodeProps) {
  const select = useStore((s) => s.select);
  const th = titleHeight(block);
  const selfRef = useRef<Konva.Group | null>(null);
  const batchStart = useRef<{
    dragged: { x: number; y: number };
    others: { id: string; x: number; y: number }[];
  } | null>(null);

  const snapping = globalSnap && block.snapEnabled !== false;

  const onDragMove = (e: Konva.KonvaEventObject<DragEvent>) => {
    if (e.target !== selfRef.current) return;
    const node = e.target as Konva.Group;
    if (snapping) {
      const others = (floorRef.current?.blocks ?? []).filter((b) => b.id !== block.id).map(rectOf);
      const current = { x: node.x(), y: node.y(), width: block.width, height: block.height };
      const res = alignmentSnap(current, others);
      const aligned = Math.abs(res.x - current.x) > 0.01 || Math.abs(res.y - current.y) > 0.01;
      node.position({ x: aligned ? res.x : snap(current.x), y: aligned ? res.y : snap(current.y) });
      drawGuides(aligned ? res.guides : []);
    } else {
      drawGuides([]);
    }
    // 批量拖动：带着其它选中控件一起移动
    const start = batchStart.current;
    if (batchMode && start) {
      const dx = node.x() - start.dragged.x;
      const dy = node.y() - start.dragged.y;
      for (const o of start.others) {
        const n = nodeRefs.current.get(`block:${o.id}`) as Konva.Group | undefined;
        n?.position({ x: o.x + dx, y: o.y + dy });
      }
    }
  };

  const onDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    if (e.target !== selfRef.current) return;
    const node = e.target as Konva.Group;
    drawGuides([]);
    const store = useStore.getState();
    const start = batchStart.current;
    batchStart.current = null;
    if (batchMode && start) {
      store.batchMove(
        Math.round(node.x() - start.dragged.x),
        Math.round(node.y() - start.dragged.y),
      );
      return;
    }
    store.placeBlock(block.id, node.x(), node.y(), false);
  };

  const onDragStart = (e: Konva.KonvaEventObject<DragEvent>) => {
    if (e.target !== selfRef.current) return;
    if (batchMode) {
      const st = useStore.getState();
      const floor = st.doc.floors.find((f) => f.id === st.floorId);
      const node = e.target as Konva.Group;
      batchStart.current = {
        dragged: { x: node.x(), y: node.y() },
        others: (floor?.blocks ?? [])
          .filter((b) => st.batchIds.includes(b.id) && b.id !== block.id)
          .map((b) => ({ id: b.id, x: b.x, y: b.y })),
      };
      return;
    }
    select({ kind: 'block', blockId: block.id });
  };

  const onTransformEnd = (e: Konva.KonvaEventObject<Event>) => {
    if (e.target !== selfRef.current) return;
    const node = e.target as Konva.Group;
    const store = useStore.getState();
    const width = Math.max(2, block.width * node.scaleX());
    const height = Math.max(2, block.height * node.scaleY());
    node.scaleX(1);
    node.scaleY(1);
    store.resizeBlock(block.id, node.x(), node.y(), width, height);
  };

  const contentW = Math.max(2, block.width - PAD * 2);

  return (
    <Group
      x={block.x}
      y={block.y}
      draggable={edit && (!batchMode || batchSelected)}
      ref={(node) => {
        selfRef.current = node;
        register(`block:${block.id}`, node);
      }}
      onClick={(e) => {
        e.cancelBubble = true;
        if (batchMode) {
          useStore.getState().batchToggle(block.id);
          return;
        }
        select({ kind: 'block', blockId: block.id });
      }}
      onTap={(e) => {
        e.cancelBubble = true;
        if (batchMode) {
          useStore.getState().batchToggle(block.id);
          return;
        }
        select({ kind: 'block', blockId: block.id });
      }}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onTransformEnd={onTransformEnd}
      onMouseDown={(e) => {
        e.cancelBubble = true;
      }}
      onTouchStart={(e) => {
        e.cancelBubble = true;
      }}
    >
      <Rect
        width={block.width}
        height={block.height}
        cornerRadius={Math.min(14, block.width / 3, block.height / 3)}
        fill={hexToRgba(block.color, 0.09)}
        stroke={
          batchSelected ? BATCH_COLOR : selected ? SELECT_COLOR : hexToRgba(block.color, 0.55)
        }
        strokeWidth={batchSelected ? 3 : selected ? 2.5 : 1.4}
        dash={batchSelected ? [7, 4] : undefined}
        shadowColor={batchSelected ? BATCH_COLOR : '#0f172a'}
        shadowOpacity={selected || batchSelected ? 0.16 : 0.09}
        shadowBlur={selected || batchSelected ? 18 : 12}
        shadowOffsetY={3}
      />
      {block.text ? (
        <Text
          text={block.text}
          x={PAD}
          y={block.showSeats ? 5 : 0}
          width={contentW}
          height={block.showSeats ? TITLE_H : block.height}
          align={block.showSeats ? 'left' : 'center'}
          verticalAlign="middle"
          fontSize={block.showSeats ? 14 : 15}
          fontStyle="bold"
          fill={block.color}
          listening={false}
        />
      ) : null}
      {block.showSeats
        ? block.seats.map((seat, index) => (
            <MemoSeatNode
              key={`${block.id}-${index}`}
              block={block}
              seat={seat}
              index={index}
              titleH={th}
              edit={edit}
              selected={selectedSeatIndex === index}
              hovered={hoverSeatIndex === index}
              seatBatchMode={seatBatchMode}
              seatBatchSelected={seatIds.includes(`${block.id}:${index}`)}
              match={matches.get(matchKey(block.id, index))}
              seatLabelField={seatLabelField}
              register={register}
              layerRef={layerRef}
              onHover={onHover}
            />
          ))
        : null}
    </Group>
  );
}

const MemoBlockNode = memo(BlockNode);

interface SeatNodeProps {
  block: Block;
  seat: Seat;
  index: number;
  titleH: number;
  edit: boolean;
  selected: boolean;
  hovered: boolean;
  seatBatchMode: boolean;
  seatBatchSelected: boolean;
  match?: Match;
  seatLabelField: string;
  register: (key: string, node: Konva.Node | null) => void;
  layerRef: React.MutableRefObject<Konva.Layer | null>;
  onHover: (info: HoverInfo | null) => void;
}

function SeatNode({
  block,
  seat,
  index,
  titleH,
  edit,
  selected,
  hovered,
  seatBatchMode,
  seatBatchSelected,
  match,
  seatLabelField,
  register,
  layerRef,
  onHover,
}: SeatNodeProps) {
  const select = useStore((s) => s.select);
  const r = seatRect(index, block.cols, titleH);
  const isEmpty = !seat.seatNo && !seat.machineSN && !seat.portNo && seat.fields.length === 0;
  const selfRef = useRef<Konva.Group | null>(null);
  const unassigned = Boolean(seat.seatNo) && !seat.machineSN;

  const fill = isEmpty
    ? 'rgba(148,163,184,0.08)'
    : match
      ? hexToRgba(
          match.level === 'strong' ? STRONG_COLOR : WEAK_COLOR,
          match.level === 'strong' ? 0.62 : 0.34,
        )
      : hovered
        ? hexToRgba(block.color, 0.16)
        : '#ffffff';
  const stroke = isEmpty
    ? selected
      ? SELECT_COLOR
      : 'rgba(148,163,184,0.4)'
    : selected
      ? SELECT_COLOR
      : match
        ? match.level === 'strong'
          ? STRONG_COLOR
          : WEAK_COLOR
        : hovered
          ? SELECT_COLOR
          : hexToRgba(block.color, 0.42);

  const onDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    if (e.target !== selfRef.current) return;
    const node = e.target as Konva.Group;
    const store = useStore.getState();
    const floor = store.doc.floors.find((f) => f.id === store.floorId);
    const pointer = pointerInLayer(layerRef.current, {
      x: block.x + r.x + r.width / 2,
      y: block.y + r.y + r.height / 2,
    });
    let target: { blockId: string; index: number } | null = null;
    floor?.blocks.forEach((b) => {
      if (!b.showSeats) return;
      const tH = titleHeight(b);
      b.seats.forEach((_seat, i) => {
        const rr = seatRect(i, b.cols, tH);
        const x = b.x + rr.x;
        const y = b.y + rr.y;
        if (
          pointer.x >= x &&
          pointer.x <= x + rr.width &&
          pointer.y >= y &&
          pointer.y <= y + rr.height
        ) {
          target = { blockId: b.id, index: i };
        }
      });
    });
    const hit = target as { blockId: string; index: number } | null;
    if (hit && (hit.blockId !== block.id || hit.index !== index)) {
      store.swapSeats(block.id, index, hit.blockId, hit.index);
    }
    node.position({ x: r.x, y: r.y });
  };

  const showHover = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (edit) return;
    const node = e.target as Konva.Group;
    const stage = node.getStage();
    if (!stage) return;
    const abs = node.getAbsolutePosition();
    onHover({
      blockId: block.id,
      seatIndex: index,
      x: abs.x + (r.width * stage.scaleX()) / 2,
      y: abs.y,
    });
  };

  const label = seatLabelText(seat, seatLabelField);
  const canSelect = !isEmpty || edit;

  return (
    <Group
      x={r.x}
      y={r.y}
      draggable={edit && !isEmpty}
      ref={(node) => {
        selfRef.current = node;
        register(`seat:${block.id}:${index}`, node);
      }}
      onClick={(e) => {
        e.cancelBubble = true;
        if (seatBatchMode) {
          useStore.getState().seatToggle(block.id, index);
          return;
        }
        if (!canSelect) return;
        select({ kind: 'seat', blockId: block.id, seatIndex: index });
      }}
      onTap={(e) => {
        e.cancelBubble = true;
        if (seatBatchMode) {
          useStore.getState().seatToggle(block.id, index);
          return;
        }
        if (!canSelect) return;
        select({ kind: 'seat', blockId: block.id, seatIndex: index });
      }}
      onDragStart={() => select({ kind: 'seat', blockId: block.id, seatIndex: index })}
      onDragEnd={onDragEnd}
      onMouseOver={showHover}
      onMouseMove={showHover}
      onMouseOut={() => onHover(null)}
      onMouseDown={(e) => {
        e.cancelBubble = true;
      }}
      onTouchStart={(e) => {
        e.cancelBubble = true;
      }}
    >
      <Rect
        width={CELL_W}
        height={CELL_H}
        cornerRadius={8}
        fill={fill}
        stroke={seatBatchSelected ? BATCH_COLOR : stroke}
        strokeWidth={
          seatBatchSelected
            ? 3
            : selected || hovered
              ? 2.5
              : match
                ? match.level === 'strong'
                  ? 3
                  : 2.5
                : 1
        }
        dash={isEmpty ? [3, 3] : undefined}
        shadowColor={
          match
            ? match.level === 'strong'
              ? STRONG_COLOR
              : WEAK_COLOR
            : hovered
              ? SELECT_COLOR
              : undefined
        }
        shadowOpacity={match ? (match.level === 'strong' ? 0.85 : 0.4) : hovered ? 0.25 : 0}
        shadowBlur={match ? (match.level === 'strong' ? 18 : 11) : hovered ? 12 : 0}
        listening={canSelect}
      />
      {isEmpty ? (
        edit ? (
          <Text
            text="＋"
            width={CELL_W}
            height={CELL_H}
            align="center"
            verticalAlign="middle"
            fontSize={18}
            fill="#94a3b8"
            listening={false}
          />
        ) : null
      ) : (
        <Text
          text={label.length > 12 ? `${label.slice(0, 11)}…` : label}
          width={CELL_W}
          height={CELL_H}
          align="center"
          verticalAlign="middle"
          fontSize={label.length > 6 ? 12 : 14}
          fontStyle="bold"
          fill={match ? (match.level === 'strong' ? '#86198f' : '#a21caf') : '#0f172a'}
          listening={false}
        />
      )}
      {!isEmpty && unassigned && !match ? (
        <Rect
          x={CELL_W - 24}
          y={4}
          width={20}
          height={6}
          cornerRadius={3}
          fill={hexToRgba('#f59e0b', 0.9)}
          listening={false}
        />
      ) : null}
    </Group>
  );
}

const MemoSeatNode = memo(SeatNode);
