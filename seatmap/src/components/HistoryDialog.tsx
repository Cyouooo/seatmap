import { useEffect, useState } from 'react';
import { api } from '../lib/api';

interface Props {
  open: boolean;
  token: string;
  busy: boolean;
  onClose: () => void;
  onRestore: (file: string) => void;
}

interface Item {
  file: string;
  version: number;
  size: number;
  mtime: string;
}

/** 历史快照：列出保存前自动备份，可一键恢复任一版本 */
export default function HistoryDialog({ open, token, busy, onClose, onRestore }: Props) {
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError('');
    api
      .history(token)
      .then((r) => setItems(r.items))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [open, token]);

  if (!open) return null;

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <h3>历史快照</h3>
        <p className="muted small">
          每次保存前自动备份，保留最近 10 份。恢复会把所选版本设为当前布局（当前布局会先被备份）。
        </p>
        {error ? <p className="error">{error}</p> : null}
        {loading ? <p className="muted small">加载中…</p> : null}
        <div className="diff-table" style={{ maxHeight: 380 }}>
          <table>
            <thead>
              <tr>
                <th>版本</th>
                <th>时间</th>
                <th>大小</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.file}>
                  <td>v{it.version}</td>
                  <td>{new Date(it.mtime).toLocaleString()}</td>
                  <td>{(it.size / 1024).toFixed(1)} KB</td>
                  <td>
                    <button
                      className="btn btn-sm"
                      disabled={busy}
                      onClick={() => onRestore(it.file)}
                    >
                      恢复此版本
                    </button>
                  </td>
                </tr>
              ))}
              {!items.length && !loading ? (
                <tr>
                  <td colSpan={4} className="muted small">
                    暂无快照。
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
