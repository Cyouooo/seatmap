import { useState } from 'react';
import { useStore } from '../store';
import { DEFAULT_COLORS } from '../lib/layout';
import type { Match, Seat } from '../types';

interface Props {
  matches: Map<string, Match>;
  onFocusSeat: (floorId: string, blockId: string, seatIndex: number) => void;
}

function NumField({
  label,
  value,
  step = 1,
  disabled,
  onChange,
  onCommit,
}: {
  label: string;
  value: number;
  step?: number;
  disabled?: boolean;
  onChange: (v: number) => void;
  onCommit?: () => void;
}) {
  return (
    <div className="num-field">
      <span className="num-label">{label}</span>
      <div className="num-input">
        <button
          className="num-btn"
          disabled={disabled}
          onClick={() => onChange(Math.round(value - step))}
        >
          −
        </button>
        <input
          type="number"
          value={Math.round(value)}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          onBlur={onCommit}
        />
        <button
          className="num-btn"
          disabled={disabled}
          onClick={() => onChange(Math.round(value + step))}
        >
          ＋
        </button>
      </div>
    </div>
  );
}

function BatchEditor() {
  const batchIds = useStore((s) => s.batchIds);
  const doc = useStore((s) => s.doc);
  const floorId = useStore((s) => s.floorId);
  const batchDelete = useStore((s) => s.batchDelete);
  const batchUpdate = useStore((s) => s.batchUpdate);
  const batchAlign = useStore((s) => s.batchAlign);
  const batchSameSize = useStore((s) => s.batchSameSize);
  const batchSpaceEvenly = useStore((s) => s.batchSpaceEvenly);
  const batchSelect = useStore((s) => s.batchSelect);

  const floor = doc.floors.find((f) => f.id === floorId);
  const blocks = (floor?.blocks ?? []).filter((b) => batchIds.includes(b.id));
  if (!blocks.length) {
    return (
      <div className="inspector-empty">
        <h3>批量编辑</h3>
        <p className="muted small">在画布空白处拖动框选多个控件（也可点击单个控件加选）。</p>
        <p className="muted">
          选中后可以批量删除、改主题色、统一宽度/高度、调节间隔、对齐，也可以直接拖动整体移动。
        </p>
      </div>
    );
  }

  const maxW = Math.max(...blocks.map((b) => b.width));
  const maxH = Math.max(...blocks.map((b) => b.height));

  return (
    <>
      <div className="inspector-head">
        <h3>批量编辑</h3>
        <span className="badge">已选 {blocks.length} 个控件</span>
      </div>

      <section className="section">
        <h4>对齐</h4>
        <div className="batch-actions">
          <button className="btn btn-sm" onClick={() => batchAlign('left')}>
            左对齐
          </button>
          <button className="btn btn-sm" onClick={() => batchAlign('centerX')}>
            水平居中
          </button>
          <button className="btn btn-sm" onClick={() => batchAlign('right')}>
            右对齐
          </button>
          <button className="btn btn-sm" onClick={() => batchAlign('top')}>
            顶对齐
          </button>
          <button className="btn btn-sm" onClick={() => batchAlign('centerY')}>
            垂直居中
          </button>
          <button className="btn btn-sm" onClick={() => batchAlign('bottom')}>
            底对齐
          </button>
        </div>
      </section>

      <section className="section">
        <h4>统一尺寸与间隔</h4>
        <div className="batch-actions">
          <button className="btn btn-sm" onClick={() => batchUpdate({ width: maxW })}>
            统一宽度 {maxW}
          </button>
          <button className="btn btn-sm" onClick={() => batchUpdate({ height: maxH })}>
            统一高度 {maxH}
          </button>
          <button className="btn btn-sm" onClick={() => batchSameSize('max')}>
            统一宽高（最大）
          </button>
          <button className="btn btn-sm" onClick={() => batchSameSize('first')}>
            统一宽高（首个）
          </button>
          <button className="btn btn-sm" onClick={() => batchSpaceEvenly('x')}>
            横向间隔一致
          </button>
          <button className="btn btn-sm" onClick={() => batchSpaceEvenly('y')}>
            纵向间隔一致
          </button>
        </div>
        <p className="muted small">“间隔一致”会按当前从左到右 / 从上到下的顺序把间距均分。</p>
      </section>

      <section className="section">
        <h4>批量主题色</h4>
        <div className="swatches">
          {DEFAULT_COLORS.map((c) => (
            <button
              key={c}
              className="swatch"
              style={{ background: c }}
              onClick={() => batchUpdate({ color: c })}
            />
          ))}
          <input type="color" onChange={(e) => batchUpdate({ color: e.target.value })} />
        </div>
      </section>

      <section className="section">
        <p className="muted small">
          拖动已选中的任一控件即可整体移动所有选中控件（拖动时同样有辅助线吸附）。
        </p>
        <p className="muted small">已选：{blocks.map((b) => b.text).join('、')}</p>
        <button className="btn btn-ghost full" onClick={() => batchSelect([])}>
          取消选择
        </button>
        <button className="btn btn-danger full" onClick={batchDelete}>
          删除所选 {blocks.length} 个控件
        </button>
      </section>
    </>
  );
}

function SeatBatchEditor() {
  const seatIds = useStore((s) => s.seatIds);
  const seatClearMany = useStore((s) => s.seatClearMany);
  const seatClearField = useStore((s) => s.seatClearField);
  const seatSetField = useStore((s) => s.seatSetField);
  const seatSelectMany = useStore((s) => s.seatSelectMany);
  const [label, setLabel] = useState('网口号');
  const [value, setValue] = useState('');
  const count = seatIds.length;

  if (!count) {
    return (
      <div className="inspector-empty">
        <h3>工位批量编辑</h3>
        <p className="muted small">点击画布上的工位即可加选 / 取消（可跨控件多选）。</p>
        <p className="muted">选中后可批量清空、清空某属性、或把某属性统一设为同一值。</p>
      </div>
    );
  }

  return (
    <>
      <div className="inspector-head">
        <h3>工位批量编辑</h3>
        <span className="badge">已选 {count} 个工位</span>
      </div>

      <section className="section">
        <h4>批量设置属性值</h4>
        <div className="field-row">
          <select className="w40" value={label} onChange={(e) => setLabel(e.target.value)}>
            {['座位号', '机器SN', '网口号'].map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
          <input
            className="w60"
            value={value}
            placeholder="统一设为…"
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
        <button
          className="btn btn-sm full"
          disabled={!value}
          onClick={() => seatSetField(label, value)}
        >
          应用「{label}」= {value || '…'}
        </button>
      </section>

      <section className="section">
        <h4>批量清空</h4>
        <div className="batch-actions">
          <button className="btn btn-sm" onClick={() => seatClearField('机器SN')}>
            清空机器SN
          </button>
          <button className="btn btn-sm" onClick={() => seatClearField('网口号')}>
            清空网口号
          </button>
        </div>
        <button className="btn btn-sm full" onClick={() => seatSelectMany([])}>
          取消选择
        </button>
        <button className="btn btn-danger full" onClick={seatClearMany}>
          清空所选 {count} 个工位（变空位）
        </button>
      </section>
    </>
  );
}

function SearchResults({ matches, onFocusSeat }: Props) {
  const doc = useStore((s) => s.doc);
  const select = useStore((s) => s.select);
  const floorId = useStore((s) => s.floorId);

  const items = Array.from(matches.values())
    .map((m) => {
      const floor = doc.floors.find((f) => f.id === m.floorId);
      const block = floor?.blocks.find((b) => b.id === m.blockId);
      return { m, floor, block, seat: block?.seats[m.seatIndex] as Seat | undefined };
    })
    .filter((x) => x.floor && x.block && x.seat)
    .sort((a, b) => {
      if (a.m.level !== b.m.level) return a.m.level === 'strong' ? -1 : 1;
      if (a.m.floorId !== b.m.floorId)
        return String(a.m.floorId).localeCompare(String(b.m.floorId));
      return a.m.seatNo.localeCompare(b.m.seatNo);
    });

  const shown = items.slice(0, 80);

  const COLUMNS = [
    '楼层',
    '区域',
    '座位号',
    '机器SN',
    '网口号',
    '命中属性',
    '命中值',
    '强弱',
  ] as const;
  const exportRows = items.map(({ m, floor, block, seat }) => ({
    楼层: floor?.name ?? '',
    区域: block?.text ?? '',
    座位号: seat?.seatNo ?? '',
    机器SN: seat?.machineSN ?? '',
    网口号: seat?.portNo ?? '',
    命中属性: m.hitField,
    命中值: m.hitValue,
    强弱: m.level === 'strong' ? '强' : '弱',
  }));

  const copyResults = () => {
    const text = [
      COLUMNS.join('\t'),
      ...exportRows.map((r) => COLUMNS.map((c) => String(r[c] ?? '')).join('\t')),
    ].join('\n');
    void navigator.clipboard?.writeText(text).catch(() => undefined);
  };

  const exportCsv = () => {
    const esc = (v: string) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [
      COLUMNS.map(esc).join(','),
      ...exportRows.map((r) => COLUMNS.map((c) => esc(r[c])).join(',')),
    ].join('\r\n');
    const url = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'seatmap-搜索结果.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="section">
      <div className="section-head">
        <h4>搜索结果（全部楼层）</h4>
        <span className="badge">共 {items.length} 条</span>
      </div>
      <div className="result-actions">
        <button className="btn btn-sm" disabled={!items.length} onClick={copyResults}>
          复制结果
        </button>
        <button className="btn btn-sm" disabled={!items.length} onClick={exportCsv}>
          导出 CSV
        </button>
      </div>
      <div className="result-list">
        {shown.map(({ m, floor, block, seat }) => (
          <button
            key={`${m.floorId}:${m.blockId}:${m.seatIndex}`}
            className={`result-item ${m.level === 'strong' ? 'is-strong' : 'is-weak'} ${
              m.floorId === floorId ? '' : 'is-other-floor'
            }`}
            onClick={() => {
              if (m.floorId !== floorId) useStore.getState().setFloor(m.floorId);
              select({ kind: 'seat', blockId: m.blockId, seatIndex: m.seatIndex });
              onFocusSeat(m.floorId, m.blockId, m.seatIndex);
            }}
          >
            <span className="result-seat">{seat?.seatNo || '—'}</span>
            <span className="result-meta">
              {floor?.name} · {block?.text} · {m.hitField}
              {m.hitValue && m.hitValue !== seat?.seatNo ? `：${m.hitValue}` : ''}
            </span>
          </button>
        ))}
        {items.length > shown.length ? (
          <p className="muted small">仅显示前 {shown.length} 条，继续输入可缩小范围。</p>
        ) : null}
        {items.length === 0 ? <p className="muted small">没有命中工位。</p> : null}
      </div>
    </section>
  );
}

function BlockEditor() {
  const sel = useStore((s) => s.sel);
  const mode = useStore((s) => s.mode);
  const doc = useStore((s) => s.doc);
  const updateBlockRaw = useStore((s) => s.updateBlockRaw);
  const checkOverlap = useStore((s) => s.checkOverlap);
  const fixOverlapBlock = useStore((s) => s.fixOverlapBlock);
  const clearOverlapWarn = useStore((s) => s.clearOverlapWarn);
  const removeBlock = useStore((s) => s.removeBlock);
  const copySelection = useStore((s) => s.copySelection);
  const pasteClipboard = useStore((s) => s.pasteClipboard);
  const clipboardCount = useStore((s) => s.clipboardCount);
  const overlapWarn = useStore((s) => s.overlapWarn);
  const markDirtyCheck = () => checkOverlap(sel && sel.kind === 'block' ? sel.blockId : '');

  const block = sel
    ? doc.floors.flatMap((f) => f.blocks).find((b) => b.id === sel.blockId)
    : undefined;
  if (!block) return null;
  const edit = mode === 'edit';
  const conflictCount =
    overlapWarn && overlapWarn.blockId === block.id ? overlapWarn.conflicts.length : 0;
  const conflictText = conflictCount
    ? overlapWarn!.conflicts
        .map((id) => doc.floors.flatMap((f) => f.blocks).find((b) => b.id === id)?.text ?? '控件')
        .join('、')
    : '';

  return (
    <>
      <div className="inspector-head">
        <h3>控件属性</h3>
        <span className="badge">
          {block.showSeats ? `${block.cols}×${block.rows} 座位` : '纯文本区'}
        </span>
      </div>

      {conflictCount ? (
        <div className="warn-box">
          <div>
            与 <b>{conflictText}</b>（{conflictCount} 个控件）位置重叠，是否需要自动错开？
          </div>
          <div className="warn-actions">
            <button className="btn btn-sm btn-primary" onClick={() => fixOverlapBlock(block.id)}>
              自动错开
            </button>
            <button className="btn btn-sm" onClick={clearOverlapWarn}>
              保持现状
            </button>
          </div>
        </div>
      ) : null}

      <section className="section">
        <label className="field">
          <span>显示文本</span>
          <input
            value={block.text}
            disabled={!edit}
            onChange={(e) => updateBlockRaw(block.id, { text: e.target.value })}
            onBlur={markDirtyCheck}
          />
        </label>

        <div className="field">
          <span>主题色</span>
          <div className="swatches">
            {DEFAULT_COLORS.map((c) => (
              <button
                key={c}
                className={`swatch ${block.color.toLowerCase() === c.toLowerCase() ? 'swatch-active' : ''}`}
                style={{ background: c }}
                disabled={!edit}
                onClick={() => updateBlockRaw(block.id, { color: c })}
              />
            ))}
            <input
              type="color"
              value={block.color}
              disabled={!edit}
              onChange={(e) => updateBlockRaw(block.id, { color: e.target.value })}
            />
          </div>
        </div>

        <label className="field row">
          <span>显示座位</span>
          <input
            type="checkbox"
            checked={block.showSeats}
            disabled={!edit}
            onChange={(e) => updateBlockRaw(block.id, { showSeats: e.target.checked })}
          />
        </label>

        <label className="field row">
          <span>该控件自动吸附</span>
          <input
            type="checkbox"
            checked={block.snapEnabled !== false}
            disabled={!edit}
            onChange={(e) => updateBlockRaw(block.id, { snapEnabled: e.target.checked })}
          />
        </label>

        {block.showSeats ? (
          <>
            <NumField
              label="列数"
              value={block.cols}
              disabled={!edit}
              onChange={(v) => updateBlockRaw(block.id, { cols: Math.max(1, v) })}
              onCommit={markDirtyCheck}
            />
            <NumField
              label="行数"
              value={block.rows}
              disabled={!edit}
              onChange={(v) => updateBlockRaw(block.id, { rows: Math.max(1, v) })}
              onCommit={markDirtyCheck}
            />
            <label className="field">
              <span>座位号前缀</span>
              <input
                value={block.seatPrefix}
                disabled={!edit}
                onChange={(e) => updateBlockRaw(block.id, { seatPrefix: e.target.value })}
                onBlur={markDirtyCheck}
              />
            </label>
          </>
        ) : (
          <p className="muted small">未添加座位时，只显示居中文案，并占用一个座位的长度。</p>
        )}
      </section>

      <section className="section">
        <h4>精调位置与尺寸</h4>
        <div className="grid2">
          <NumField
            label="X"
            value={block.x}
            disabled={!edit}
            onChange={(v) => updateBlockRaw(block.id, { x: v })}
            onCommit={markDirtyCheck}
          />
          <NumField
            label="Y"
            value={block.y}
            disabled={!edit}
            onChange={(v) => updateBlockRaw(block.id, { y: v })}
            onCommit={markDirtyCheck}
          />
          <NumField
            label="宽"
            value={block.width}
            disabled={!edit}
            onChange={(v) => updateBlockRaw(block.id, { width: Math.max(2, v) })}
            onCommit={markDirtyCheck}
          />
          <NumField
            label="高"
            value={block.height}
            disabled={!edit}
            onChange={(v) => updateBlockRaw(block.id, { height: Math.max(2, v) })}
            onCommit={markDirtyCheck}
          />
        </div>
        <p className="muted small">
          宽高不设下限（至少 2
          个单位）；修改数值期间不会自动位移，改完统一检测是否重叠并提示；画布上拉伸有座位的控件会按尺寸自动增减工位。
        </p>
      </section>

      {edit ? (
        <section className="section">
          <div className="batch-actions">
            <button className="btn btn-sm" onClick={copySelection}>
              复制该控件
            </button>
            <button className="btn btn-sm" disabled={!clipboardCount} onClick={pasteClipboard}>
              粘贴{clipboardCount ? ` ${clipboardCount}` : ''}
            </button>
          </div>
          <p className="muted small">快捷键：Ctrl+C 复制，Ctrl+V 粘贴（会粘到附近空位）。</p>
          <button className="btn btn-danger full" onClick={() => removeBlock(block.id)}>
            删除该控件
          </button>
        </section>
      ) : null}
    </>
  );
}

function SeatEditor({ match }: { match?: Match }) {
  const sel = useStore((s) => s.sel);
  const mode = useStore((s) => s.mode);
  const doc = useStore((s) => s.doc);
  const updateSeat = useStore((s) => s.updateSeat);
  const addSeatField = useStore((s) => s.addSeatField);
  const updateSeatField = useStore((s) => s.updateSeatField);
  const removeSeatField = useStore((s) => s.removeSeatField);
  const applyFieldsToBlock = useStore((s) => s.applyFieldsToBlock);
  const addSeatAt = useStore((s) => s.addSeatAt);
  const select = useStore((s) => s.select);

  const edit = mode === 'edit';
  const block = sel
    ? doc.floors.flatMap((f) => f.blocks).find((b) => b.id === sel.blockId)
    : undefined;
  const seat = sel && sel.kind === 'seat' ? block?.seats[sel.seatIndex] : undefined;
  if (!block || !seat || !sel || sel.kind !== 'seat') return null;
  const isEmpty = !seat.seatNo && !seat.machineSN && !seat.portNo && seat.fields.length === 0;
  const unassigned = Boolean(seat.seatNo) && !seat.machineSN;

  if (isEmpty) {
    return (
      <>
        <div className="inspector-head">
          <h3>空位</h3>
          <span className="badge">
            {block.text} · 第 {Math.floor(sel.seatIndex / block.cols) + 1} 行 第{' '}
            {(sel.seatIndex % block.cols) + 1} 列
          </span>
        </div>
        <section className="section">
          <p className="muted small">
            该位置当前是空位（未编号）。可以在这里添加工位，也可以通过调整该控件的行列数来增减空位。
          </p>
          {edit ? (
            <button
              className="btn btn-primary full"
              onClick={() => addSeatAt(block.id, sel.seatIndex)}
            >
              ＋ 在此添加工位
            </button>
          ) : (
            <p className="muted small">切换到编辑模式后可添加工位。</p>
          )}
        </section>
      </>
    );
  }

  return (
    <>
      <div className="inspector-head">
        <h3>工位属性</h3>
        <span className="badge">
          {block.text} · 第 {Math.floor(sel.seatIndex / block.cols) + 1} 行 第{' '}
          {(sel.seatIndex % block.cols) + 1} 列
        </span>
      </div>

      {match ? (
        <p className="match-note">
          搜索命中：{match.hitField}
          {match.hitValue && match.hitValue !== seat.seatNo ? ` = ${match.hitValue}` : ''}
        </p>
      ) : null}

      {unassigned ? <p className="unassigned-note">该工位没有机器SN，标记为「未分配」。</p> : null}

      <section className="section">
        <label className="field">
          <span>座位号</span>
          <input
            value={seat.seatNo}
            disabled={!edit}
            onChange={(e) => updateSeat(block.id, sel.seatIndex, { seatNo: e.target.value })}
          />
        </label>
        <label className="field">
          <span>机器SN</span>
          <input
            value={seat.machineSN}
            disabled={!edit}
            onChange={(e) => updateSeat(block.id, sel.seatIndex, { machineSN: e.target.value })}
          />
        </label>
        <label className="field">
          <span>网口号</span>
          <input
            value={seat.portNo}
            disabled={!edit}
            onChange={(e) => updateSeat(block.id, sel.seatIndex, { portNo: e.target.value })}
          />
        </label>
      </section>

      <section className="section">
        <div className="section-head">
          <h4>自定义属性</h4>
          {edit ? (
            <button className="btn btn-sm" onClick={() => addSeatField(block.id, sel.seatIndex)}>
              ＋ 添加属性
            </button>
          ) : null}
        </div>
        {seat.fields.length === 0 ? <p className="muted small">暂无自定义属性。</p> : null}
        {seat.fields.map((f, i) => (
          <div className="field-row" key={`${f.key}-${i}`}>
            <input
              className="w40"
              value={f.label}
              placeholder="属性名"
              disabled={!edit}
              onChange={(e) =>
                updateSeatField(block.id, sel.seatIndex, i, { label: e.target.value })
              }
            />
            <input
              className="w60"
              value={f.value}
              placeholder="属性值"
              disabled={!edit}
              onChange={(e) =>
                updateSeatField(block.id, sel.seatIndex, i, { value: e.target.value })
              }
            />
            {edit ? (
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => removeSeatField(block.id, sel.seatIndex, i)}
              >
                删除
              </button>
            ) : null}
          </div>
        ))}
        {edit && seat.fields.length ? (
          <button
            className="btn btn-sm full"
            onClick={() => applyFieldsToBlock(block.id, sel.seatIndex)}
          >
            把这套属性结构应用到本区所有工位
          </button>
        ) : null}
      </section>

      {edit ? (
        <section className="section">
          <button
            className="btn btn-danger full"
            onClick={() => {
              updateSeat(block.id, sel.seatIndex, {
                seatNo: '',
                machineSN: '',
                portNo: '',
                fields: [],
              });
              select({ kind: 'block', blockId: block.id });
            }}
          >
            清空该工位（变为空位）
          </button>
        </section>
      ) : null}
    </>
  );
}

export default function InspectorPanel({ matches, onFocusSeat }: Props) {
  const sel = useStore((s) => s.sel);
  const mode = useStore((s) => s.mode);
  const query = useStore((s) => s.query);
  const batchMode = useStore((s) => s.batchMode);
  const seatBatchMode = useStore((s) => s.seatBatchMode);

  const match = sel?.kind === 'seat' ? matches.get(`${sel.blockId}:${sel.seatIndex}`) : undefined;

  return (
    <aside className="inspector">
      {seatBatchMode ? <SeatBatchEditor /> : null}
      {seatBatchMode ? null : batchMode ? <BatchEditor /> : null}
      {seatBatchMode || batchMode ? null : query.trim() ? (
        <SearchResults matches={matches} onFocusSeat={onFocusSeat} />
      ) : null}
      {seatBatchMode || batchMode ? null : sel ? (
        sel.kind === 'block' ? (
          <BlockEditor />
        ) : (
          <SeatEditor match={match} />
        )
      ) : (
        <div className="inspector-empty">
          <h3>属性面板</h3>
          <p>点击任意控件或工位查看 / 编辑属性；查看模式下鼠标悬停工位可看详情。</p>
          <p className="muted">
            {mode === 'edit'
              ? '编辑模式下可精调位置尺寸、编辑座位属性、拖拽互换工位与控件。'
              : '切换到编辑模式后可修改布局（需身份验证）。'}
          </p>
        </div>
      )}
    </aside>
  );
}
