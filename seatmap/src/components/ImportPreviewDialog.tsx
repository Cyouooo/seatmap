import type { ImportPreview } from '../types';

interface Props {
  preview: ImportPreview | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function ImportPreviewDialog({ preview, busy, onCancel, onConfirm }: Props) {
  if (!preview) return null;

  const rows = preview.rows;
  const updateRows = rows.filter((r) => r.status === 'update');
  const sameRows = rows.filter((r) => r.status === 'same');
  const missingRows = rows.filter((r) => r.status === 'notfound');

  return (
    <div className="modal-mask" onClick={onCancel}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <h3>导入预览 · 工作表「{preview.sheet}」</h3>
        <p className="muted small">
          以基准属性「<b>{preview.keyField}</b>
          」为准进行比对，确认后才会写入。更新项会覆盖对应属性，新的属性列会自动追加为自定义属性。
        </p>

        <div className="chip-row">
          <span className="chip">共 {preview.total} 行</span>
          <span className="chip chip-warn">将更新 {preview.updated}</span>
          <span className="chip">无变化 {preview.same}</span>
          <span className="chip chip-danger">未匹配 {preview.notFound.length}</span>
          {preview.newFields.length ? (
            <span className="chip chip-ok">新增字段 {preview.newFields.length}</span>
          ) : null}
        </div>

        {preview.newFields.length ? (
          <p className="muted small">新增自定义属性：{preview.newFields.join('、')}</p>
        ) : null}

        <div className="diff-head">
          <span className="diff-flag strong">更新（{updateRows.length}）</span>
          <span className="diff-flag">无变化（{sameRows.length}）</span>
          <span className="diff-flag danger">未匹配（{missingRows.length}）</span>
        </div>

        <div className="diff-table">
          <table>
            <thead>
              <tr>
                <th>{preview.keyField}</th>
                <th>位置</th>
                <th>状态</th>
                <th>变更内容（现状 → 导入值）</th>
              </tr>
            </thead>
            <tbody>
              {[...updateRows, ...sameRows, ...missingRows].map((r, i) => (
                <tr key={`${r.seatNo}-${i}`} className={`diff-row is-${r.status}`}>
                  <td className="diff-seat">{r.seatNo}</td>
                  <td>{r.floorName ? `${r.floorName} · ${r.blockText}` : '—'}</td>
                  <td>
                    {r.status === 'update' ? '将更新' : r.status === 'same' ? '无变化' : '未匹配'}
                  </td>
                  <td>
                    {r.changes.length
                      ? r.changes.map((c) => (
                          <div key={c.field} className="diff-change">
                            <em>{c.field}</em>
                            <span className="diff-from">{c.from || '（空）'}</span>
                            <span className="diff-arrow">→</span>
                            <span className="diff-to">{c.to || '（空）'}</span>
                          </div>
                        ))
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 ? <p className="muted small">没有可导入的数据行。</p> : null}
        </div>

        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            取消
          </button>
          <button
            className="btn btn-primary"
            onClick={onConfirm}
            disabled={busy || preview.updated === 0}
          >
            {busy ? '导入中…' : `确认导入（更新 ${preview.updated} 个工位）`}
          </button>
        </div>
      </div>
    </div>
  );
}
