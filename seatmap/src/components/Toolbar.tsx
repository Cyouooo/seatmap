import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { seatStats } from '../lib/layout';

interface Props {
  onToggleEdit: () => void;
  onSave: () => void;
  onFit: () => void;
  onZoom: (factor: number) => void;
  onSearch: () => void;
  onLogout: () => void;
  saving: boolean;
  matchCount: { total: number };
}

export default function Toolbar({
  onToggleEdit,
  onSave,
  onFit,
  onZoom,
  onSearch,
  onLogout,
  saving,
  matchCount,
}: Props) {
  const doc = useStore((s) => s.doc);
  const floorId = useStore((s) => s.floorId);
  const setFloor = useStore((s) => s.setFloor);
  const addFloor = useStore((s) => s.addFloor);
  const removeFloor = useStore((s) => s.removeFloor);
  const renameFloor = useStore((s) => s.renameFloor);
  const mode = useStore((s) => s.mode);
  const query = useStore((s) => s.query);
  const setQuery = useStore((s) => s.setQuery);
  const matchMode = useStore((s) => s.matchMode);
  const setMatchMode = useStore((s) => s.setMatchMode);
  const dirty = useStore((s) => s.dirty);
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const token = useStore((s) => s.token);
  const user = useStore((s) => s.user);

  const [statOpen, setStatOpen] = useState(false);
  const [editingFloorId, setEditingFloorId] = useState<string | null>(null);

  const floor = doc.floors.find((f) => f.id === floorId);
  const stats = useMemo(() => seatStats(floor?.blocks ?? []), [floor]);
  const edit = mode === 'edit';

  const allFloors = useMemo(
    () =>
      doc.floors.map((f) => {
        const s = seatStats(f.blocks);
        return { id: f.id, name: f.name, ...s };
      }),
    [doc.floors],
  );

  return (
    <header className="toolbar">
      <div className="brand">
        <span className="brand-mark">▦</span>
        <span className="brand-name">楼层工位图</span>
      </div>

      <div className="floor-tabs">
        {doc.floors.map((f) => (
          <div key={f.id} className={`tab-wrap ${f.id === floorId ? 'tab-active' : ''}`}>
            {edit && editingFloorId === f.id ? (
              <input
                className="floor-rename"
                autoFocus
                defaultValue={f.name}
                onBlur={(e) => {
                  renameFloor(f.id, e.target.value);
                  setEditingFloorId(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    renameFloor(f.id, (e.target as HTMLInputElement).value);
                    setEditingFloorId(null);
                  }
                  if (e.key === 'Escape') setEditingFloorId(null);
                }}
              />
            ) : (
              <button
                className="tab"
                onClick={() => setFloor(f.id)}
                onDoubleClick={() => edit && setEditingFloorId(f.id)}
                title={edit ? '点击切换，双击重命名' : f.name}
              >
                {f.name}
              </button>
            )}
            {edit ? (
              <button
                className="tab-close"
                disabled={doc.floors.length <= 1}
                title={doc.floors.length <= 1 ? '至少保留一个楼层' : '删除该楼层（可 Ctrl+Z 撤销）'}
                onClick={() => {
                  if (
                    window.confirm(
                      `删除楼层「${f.name}」及其 ${f.blocks.length} 个控件？此操作可撤销（Ctrl+Z）。`,
                    )
                  ) {
                    removeFloor(f.id);
                  }
                }}
              >
                ✕
              </button>
            ) : null}
          </div>
        ))}
        {edit ? (
          <button className="tab tab-add" onClick={addFloor} title="添加楼层">
            ＋楼层
          </button>
        ) : null}
      </div>

      <div className="search-box">
        <textarea
          className="search-input"
          rows={matchMode === 'batch' ? 2 : 1}
          wrap="off"
          placeholder="回车搜索具体属性"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              onSearch();
            }
            if (e.key === 'Escape') setQuery('');
          }}
        />
        <select
          className="search-mode"
          value={matchMode}
          onChange={(e) => setMatchMode(e.target.value as 'single' | 'batch')}
          title="单个搜索：一个值；批量搜索：每行一个值"
        >
          <option value="single">单个搜索</option>
          <option value="batch">批量搜索</option>
        </select>
        {query ? <span className="search-count">{matchCount.total} 命中</span> : null}
      </div>

      <div className="stat-wrap">
        <button
          className={`stat ${statOpen ? 'stat-open' : ''}`}
          onClick={() => setStatOpen((v) => !v)}
        >
          <span className="stat-value">{stats.total}</span>
          <span className="stat-label">
            工位 · 未分配 {stats.unassigned} <em>{statOpen ? '▲' : '▼'}</em>
          </span>
        </button>
        {statOpen ? (
          <div className="stat-panel">
            <div className="stat-row">
              <span>本层工位总数</span>
              <b>{stats.total}</b>
            </div>
            <div className="stat-row">
              <span>已分配（有机器SN）</span>
              <b className="ok">{stats.assigned}</b>
            </div>
            <div className="stat-row">
              <span>未分配（无机器SN）</span>
              <b className="warn">{stats.unassigned}</b>
            </div>
            <div className="stat-row">
              <span>空位（未编号）</span>
              <b>{stats.emptySlots}</b>
            </div>
            <div className="stat-row">
              <span>文本区控件</span>
              <b>{stats.textBlocks}</b>
            </div>

            <div className="stat-sub">按区域统计（{floor?.name}）</div>
            <div className="stat-list">
              {stats.blocks.map((b) => (
                <div className="stat-row small" key={b.id}>
                  <span>{b.text}</span>
                  <span>
                    共 {b.total}
                    {b.unassigned ? <em className="warn"> · 未分配 {b.unassigned}</em> : null}
                  </span>
                </div>
              ))}
              {stats.blocks.length === 0 ? <p className="muted small">暂无座位区域。</p> : null}
            </div>

            <div className="stat-sub">全部楼层</div>
            <div className="stat-list">
              {allFloors.map((f) => (
                <div className={`stat-row small ${f.id === floorId ? 'is-active' : ''}`} key={f.id}>
                  <button className="link-btn" onClick={() => setFloor(f.id)}>
                    {f.name}
                  </button>
                  <span>
                    共 {f.total} · 未分配 {f.unassigned}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div className="toolbar-actions">
        <button className="btn" aria-label="放大" onClick={() => onZoom(1.15)} title="放大">
          ＋
        </button>
        <button className="btn" aria-label="缩小" onClick={() => onZoom(0.87)} title="缩小">
          －
        </button>
        <button className="btn" onClick={onFit} title="适应窗口">
          适应
        </button>
        <button
          className="btn"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          title="切换深色 / 浅色主题"
        >
          {theme === 'dark' ? '浅色' : '深色'}
        </button>
        <span className="divider" />
        {edit ? (
          <button className="btn btn-primary" disabled={saving} onClick={onSave}>
            {saving ? '保存中…' : dirty ? '保存布局 *' : '保存布局'}
          </button>
        ) : null}
        <button className={`btn ${edit ? 'btn-warn' : 'btn-ghost'}`} onClick={onToggleEdit}>
          {edit ? '退出编辑' : '编辑模式'}
        </button>
        {token ? (
          <button className="btn btn-ghost" onClick={onLogout} title={`已登录：${user}`}>
            退出登录
          </button>
        ) : null}
      </div>
    </header>
  );
}
