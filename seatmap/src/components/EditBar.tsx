import { useMemo } from 'react';
import { useStore } from '../store';

interface Props {
  onAddBlock: () => void;
  onOpenHistory: () => void;
  onArrange: () => void;
  onCopy: () => void;
  onPaste: () => void;
  clipboardCount: number;
  onImport: (file: File) => void;
  onDownloadTemplate: () => void;
  importKeyField: string;
  onImportKeyField: (v: string) => void;
  keyOptions: string[];
}

/**
 * 编辑模式下的左侧编辑栏：把编辑功能按类别分组放置，
 * 与右侧属性面板（控件 / 工位 / 批量详情）形成左右分工。
 */
export default function EditBar({
  onAddBlock,
  onOpenHistory,
  onArrange,
  onCopy,
  onPaste,
  clipboardCount,
  onImport,
  onDownloadTemplate,
  importKeyField,
  onImportKeyField,
  keyOptions,
}: Props) {
  const globalSnap = useStore((s) => s.globalSnap);
  const setGlobalSnap = useStore((s) => s.setGlobalSnap);
  const seatLabelField = useStore((s) => s.seatLabelField);
  const setSeatLabelField = useStore((s) => s.setSeatLabelField);
  const batchMode = useStore((s) => s.batchMode);
  const setBatchMode = useStore((s) => s.setBatchMode);
  const batchIds = useStore((s) => s.batchIds);
  const seatBatchMode = useStore((s) => s.seatBatchMode);
  const setSeatBatchMode = useStore((s) => s.setSeatBatchMode);
  const seatIds = useStore((s) => s.seatIds);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const past = useStore((s) => s.past.length);
  const future = useStore((s) => s.future.length);
  const doc = useStore((s) => s.doc);

  /** 可选属性列表：固定三个 + 布局里出现过的自定义属性 */
  const labelOptions = useMemo(() => {
    const set = new Set<string>(['座位号', '机器SN', '网口号']);
    for (const f of doc.floors) {
      for (const b of f.blocks) {
        for (const s of b.seats || []) {
          for (const fd of s.fields || []) {
            if (fd.label) set.add(fd.label);
          }
        }
      }
    }
    return Array.from(set);
  }, [doc.floors]);

  return (
    <aside className="edit-bar">
      <div className="edit-bar-title">编辑</div>

      <section className="edit-group">
        <h4>控件操作</h4>
        <button className="btn full" onClick={onAddBlock} title="在当前视野空白处新增一个控件">
          ＋ 控件
        </button>
        <div className="edit-grid2">
          <button className="btn" onClick={onCopy} title="复制所选控件（Ctrl+C）">
            复制
          </button>
          <button
            className="btn"
            disabled={!clipboardCount}
            onClick={onPaste}
            title="粘贴控件（Ctrl+V）"
          >
            粘贴{clipboardCount ? ` ${clipboardCount}` : ''}
          </button>
        </div>
        <button className="btn full" onClick={onArrange} title="整理本层控件，消除重叠">
          整理布局
        </button>
      </section>

      <section className="edit-group">
        <h4>批量编辑</h4>
        <button
          className={`btn full ${batchMode ? 'btn-on' : ''}`}
          onClick={() => setBatchMode(!batchMode)}
          title="批量编辑控件：框选多个控件后统一删除 / 改色 / 对齐 / 统一尺寸"
        >
          控件批量{batchMode && batchIds.length ? `（已选 ${batchIds.length}）` : ''}
        </button>
        <button
          className={`btn full ${seatBatchMode ? 'btn-on' : ''}`}
          onClick={() => setSeatBatchMode(!seatBatchMode)}
          title="批量编辑工位：点击多个工位后批量清空 / 设置属性"
        >
          工位批量{seatBatchMode && seatIds.length ? `（已选 ${seatIds.length}）` : ''}
        </button>
      </section>

      <section className="edit-group">
        <h4>历史记录</h4>
        <div className="edit-grid2">
          <button className="btn" disabled={!past} onClick={undo} title="撤销">
            ↶ 撤销
          </button>
          <button className="btn" disabled={!future} onClick={redo} title="重做">
            ↷ 重做
          </button>
        </div>
        <button className="btn full" onClick={onOpenHistory} title="查看 / 恢复历史快照">
          历史快照
        </button>
      </section>

      <section className="edit-group">
        <h4>显示与吸附</h4>
        <button
          className={`btn full ${globalSnap ? 'btn-on' : ''}`}
          onClick={() => setGlobalSnap(!globalSnap)}
          title="自动吸附：拖动 / 拉伸时对齐其它控件并显示辅助线"
        >
          吸附 {globalSnap ? '开' : '关'}
        </button>
        <label className="field row">
          <span>显示属性</span>
          <select
            className="edit-select"
            value={seatLabelField}
            onChange={(e) => setSeatLabelField(e.target.value)}
            title="工位上显示哪个属性"
          >
            {labelOptions.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="edit-group">
        <h4>数据导入</h4>
        <label className="field row">
          <span>基准属性</span>
          <select
            className="edit-select"
            value={importKeyField}
            onChange={(e) => onImportKeyField(e.target.value)}
            title="导入 / 模板以哪个属性作为基准"
          >
            {keyOptions.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>
        <button
          className="btn full"
          onClick={onDownloadTemplate}
          title="下载以基准属性为准的导入模板"
        >
          下载模板
        </button>
        <label className="btn full file-btn" title="导入 Excel（.xlsx / .xls / .csv）">
          导入 Excel
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onImport(f);
              e.target.value = '';
            }}
          />
        </label>
      </section>
    </aside>
  );
}
