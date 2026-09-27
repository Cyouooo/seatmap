import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Toolbar from './components/Toolbar';
import EditBar from './components/EditBar';
import FloorCanvas from './components/FloorCanvas';
import InspectorPanel from './components/InspectorPanel';
import PasswordDialog from './components/PasswordDialog';
import ImportPreviewDialog from './components/ImportPreviewDialog';
import HistoryDialog from './components/HistoryDialog';
import { api } from './lib/api';
import { matchKey, searchSeats } from './lib/fuzzy';
import { seatWorldRect, unionRect, type Rect } from './lib/layout';
import { useStore } from './store';
import type { ImportPreview, Match } from './types';

type Toast = { msg: string; kind: 'ok' | 'err' };
type FocusDetail = {
  center?: { x: number; y: number };
  zoom?: number;
  rect?: Rect;
};

export default function App() {
  const doc = useStore((s) => s.doc);
  const floorId = useStore((s) => s.floorId);
  const query = useStore((s) => s.query);
  const matchMode = useStore((s) => s.matchMode);
  const mode = useStore((s) => s.mode);
  const token = useStore((s) => s.token);
  const setDoc = useStore((s) => s.setDoc);
  const setFloor = useStore((s) => s.setFloor);
  const setMode = useStore((s) => s.setMode);
  const setAuth = useStore((s) => s.setAuth);
  const clearAuth = useStore((s) => s.clearAuth);
  const markSaved = useStore((s) => s.markSaved);
  const resolveAllOverlaps = useStore((s) => s.resolveAllOverlaps);
  const copySelection = useStore((s) => s.copySelection);
  const pasteClipboard = useStore((s) => s.pasteClipboard);
  const clipboardCount = useStore((s) => s.clipboardCount);
  const select = useStore((s) => s.select);
  const dirty = useStore((s) => s.dirty);
  const theme = useStore((s) => s.theme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [reauthOpen, setReauthOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importKeyField, setImportKeyField] = useState('座位号');
  const pendingEdit = useRef(false);
  const reauthResolver = useRef<((v: string | null) => void) | null>(null);
  const pendingFocus = useRef<FocusDetail | null>(null);

  const floor = useMemo(() => doc.floors.find((f) => f.id === floorId), [doc, floorId]);

  /** 搜索输入防抖：输入停顿 150ms 后再计算命中（清空时立即生效） */
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  useEffect(() => {
    const delay = query ? 150 : 0;
    const timer = window.setTimeout(() => setDebouncedQuery(query), delay);
    return () => window.clearTimeout(timer);
  }, [query]);

  /** 全楼层搜索 */
  const allMatches = useMemo(
    () => searchSeats(doc.floors, debouncedQuery, matchMode),
    [doc.floors, debouncedQuery, matchMode],
  );
  /** 当前楼层命中（画布高亮用） */
  const floorMatches = useMemo(() => {
    const m = new Map<string, Match>();
    allMatches.forEach((v) => {
      if (v.floorId === floorId) m.set(matchKey(v.blockId, v.seatIndex), v);
    });
    return m;
  }, [allMatches, floorId]);

  const matchCount = allMatches.size;

  /** 可选属性列：固定三个 + 布局里出现过的自定义属性 */
  const keyOptions = useMemo(() => {
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

  const showToast = useCallback((msg: string, kind: 'ok' | 'err' = 'ok') => {
    setToast({ msg, kind });
    window.setTimeout(() => setToast(null), 4200);
  }, []);

  const dispatchFocus = (detail: FocusDetail) =>
    window.dispatchEvent(new CustomEvent('seatmap:focus', { detail }));

  /** 定位到某楼层某工位（必要时切换楼层） */
  const applyFocus = useCallback((targetFloorId: string, detail: FocusDetail) => {
    const state = useStore.getState();
    if (state.floorId !== targetFloorId) {
      pendingFocus.current = detail;
      state.setFloor(targetFloorId);
    } else {
      dispatchFocus(detail);
    }
  }, []);

  const focusSeat = useCallback(
    (targetFloorId: string, blockId: string, seatIndex: number) => {
      const state = useStore.getState();
      const blocks = state.doc.floors.find((f) => f.id === targetFloorId)?.blocks ?? [];
      const block = blocks.find((b) => b.id === blockId);
      if (!block) return;
      const rect = seatWorldRect(block, seatIndex);
      const detail: FocusDetail = {
        center: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
        zoom: 1.15,
      };
      applyFocus(targetFloorId, detail);
    },
    [applyFocus],
  );

  // 楼层切换完成后补发定位
  useEffect(() => {
    if (!pendingFocus.current) return;
    const detail = pendingFocus.current;
    pendingFocus.current = null;
    const timer = window.setTimeout(() => dispatchFocus(detail), 80);
    return () => window.clearTimeout(timer);
  }, [floorId]);

  useEffect(() => {
    api
      .loadLayout()
      .then((r) => {
        setDoc(r.doc);
        setLoading(false);
      })
      .catch((e: Error) => {
        setLoading(false);
        showToast(`加载布局失败：${e.message}`, 'err');
      });
  }, [setDoc, showToast]);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (useStore.getState().dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState();
      if (s.mode !== 'edit') return;
      const target = e.target as HTMLElement;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
      }
      if (mod && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        s.copySelection();
      }
      if (mod && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        s.pasteClipboard();
      }
      if (e.key === 'Delete' && s.sel?.kind === 'block') {
        s.removeBlock(s.sel.blockId);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 搜索定位：回车或切换模式时触发；单个搜索精确命中则居中，否则（批量/仅模糊命中）适配结果区域
  const locate = useCallback(() => {
    const state = useStore.getState();
    if (!state.query.trim()) return;
    const matches = searchSeats(state.doc.floors, state.query, state.matchMode);
    if (matches.size === 0) return;

    const list = Array.from(matches.values());
    const countByFloor = (items: Match[]) => {
      const map = new Map<string, number>();
      items.forEach((m) => map.set(m.floorId, (map.get(m.floorId) ?? 0) + 1));
      return map;
    };

    let targetFloor = state.floorId;
    if (state.matchMode === 'batch') {
      // 批量搜索：切到命中总数最多的楼层（强、弱命中都计入），尽量展示所有命中工位
      targetFloor = Array.from(countByFloor(list).entries()).sort((a, b) => b[1] - a[1])[0][0];
    } else {
      const strong = list.filter((m) => m.level === 'strong');
      if (strong.length) {
        const strongByFloor = countByFloor(strong);
        if (!strongByFloor.has(state.floorId)) {
          targetFloor = Array.from(strongByFloor.entries()).sort((a, b) => b[1] - a[1])[0][0];
        }
      } else if (!list.some((m) => m.floorId === state.floorId)) {
        targetFloor = Array.from(countByFloor(list).entries()).sort((a, b) => b[1] - a[1])[0][0];
      }
    }

    const onTarget = list.filter((m) => m.floorId === targetFloor);
    const strongOnTarget = onTarget.filter((m) => m.level === 'strong');
    const first = strongOnTarget[0] ?? onTarget[0] ?? list[0];

    if (targetFloor !== state.floorId) setFloor(targetFloor);
    select({ kind: 'seat', blockId: first.blockId, seatIndex: first.seatIndex });

    if (state.matchMode === 'single' && strongOnTarget.length) {
      focusSeat(targetFloor, first.blockId, first.seatIndex);
    } else {
      const blocks = state.doc.floors.find((f) => f.id === targetFloor)?.blocks ?? [];
      // 有强命中时聚焦到强命中区域（放大更明显、更聚焦）；否则适配该楼层全部命中
      const focusSet = strongOnTarget.length ? strongOnTarget : onTarget;
      const rects = focusSet
        .map((m) => {
          const b = blocks.find((x) => x.id === m.blockId);
          return b ? seatWorldRect(b, m.seatIndex) : null;
        })
        .filter((r): r is Rect => Boolean(r));
      const union = unionRect(rects);
      if (union) applyFocus(targetFloor, { rect: union });
    }
  }, [focusSeat, applyFocus, select, setFloor]);

  // 切换搜索模式时（有查询词）自动重新定位
  useEffect(() => {
    if (query.trim()) locate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchMode]);

  const askReauth = () =>
    new Promise<string | null>((resolve) => {
      reauthResolver.current = resolve;
      setError('');
      setReauthOpen(true);
    });

  const finishReauth = (value: string | null) => {
    setReauthOpen(false);
    const resolve = reauthResolver.current;
    reauthResolver.current = null;
    resolve?.(value);
  };

  const withReauth = async <T,>(fn: (reauth: string) => Promise<T>): Promise<T | null> => {
    if (!useStore.getState().token) {
      pendingEdit.current = true;
      setLoginOpen(true);
      return null;
    }
    const first = useStore.getState().reauth || (await askReauth());
    if (!first) return null;
    try {
      return await fn(first);
    } catch (err) {
      const message = (err as Error).message || '';
      if (/二次身份验证|未登录|过期/.test(message)) {
        const second = await askReauth();
        if (!second) return null;
        return fn(second);
      }
      throw err;
    }
  };

  const handleLogin = async (password: string) => {
    setBusy(true);
    setError('');
    try {
      const r = await api.login(password);
      setAuth(r.token, r.reauthToken, 'admin');
      setLoginOpen(false);
      setError('');
      showToast('身份验证成功，已进入编辑模式');
      if (pendingEdit.current) {
        pendingEdit.current = false;
        setMode('edit');
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleReauth = async (password: string) => {
    setBusy(true);
    setError('');
    const token = useStore.getState().token;
    try {
      const r = await api.reauth(password, token || '');
      setAuth(token || '', r.reauthToken, 'admin');
      setError('');
      finishReauth(r.reauthToken);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleToggleEdit = () => {
    if (mode === 'edit') {
      setMode('view');
      return;
    }
    if (!token) {
      pendingEdit.current = true;
      setError('');
      setLoginOpen(true);
      return;
    }
    setMode('edit');
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const result = await withReauth((reauth) =>
        api.saveLayout(
          { ...useStore.getState().doc, seatLabelField: useStore.getState().seatLabelField },
          useStore.getState().token || '',
          reauth,
        ),
      );
      if (result) {
        markSaved(result.version, result.updatedAt);
        showToast(`布局已保存（版本 v${result.version}）`);
      }
    } catch (e) {
      showToast(`保存失败：${(e as Error).message}`, 'err');
    } finally {
      setSaving(false);
    }
  };

  /** 第一步：上传 → 预览对比 */
  const handleImport = async (file: File) => {
    if (!useStore.getState().token) {
      pendingEdit.current = true;
      setError('');
      setLoginOpen(true);
      return;
    }
    setImporting(true);
    try {
      const r = await api.importPreview(file, importKeyField, useStore.getState().token || '');
      setPreview(r.preview);
    } catch (e) {
      showToast(`解析失败：${(e as Error).message}`, 'err');
    } finally {
      setImporting(false);
    }
  };

  /** 第二步：确认后写入（需二次验证） */
  const handleConfirmImport = async () => {
    if (!preview) return;
    setImporting(true);
    try {
      const result = await withReauth((reauth) =>
        api.importApply(preview.importId, useStore.getState().token || '', reauth),
      );
      if (!result) return;
      setDoc(result.doc);
      const s = result.summary;
      const fields = s.newFields.length ? `，新增属性字段：${s.newFields.join('、')}` : '';
      showToast(`导入完成：更新 ${s.updated} 个工位${fields}`);
      setPreview(null);
    } catch (e) {
      showToast(`导入失败：${(e as Error).message}`, 'err');
    } finally {
      setImporting(false);
    }
  };

  const handleDownloadTemplate = async () => {
    if (!useStore.getState().token) {
      pendingEdit.current = true;
      setError('');
      setLoginOpen(true);
      return;
    }
    try {
      const blob = await api.downloadTemplate(floorId, importKeyField, useStore.getState().token);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `座位导入模板-${floor?.name ?? '全部'}-${importKeyField}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast('导入模板已下载（以座位号为准，含现有属性列）');
    } catch (e) {
      showToast(`下载模板失败：${(e as Error).message}`, 'err');
    }
  };

  const handleRestoreHistory = async (file: string) => {
    if (!window.confirm(`恢复快照「${file}」？当前布局会先被备份。`)) return;
    setSaving(true);
    try {
      const result = await withReauth((reauth) =>
        api.restoreHistory(file, useStore.getState().token || '', reauth),
      );
      if (result) {
        setDoc(result.doc);
        setHistoryOpen(false);
        showToast('已恢复所选历史快照');
      }
    } catch (e) {
      showToast(`恢复失败：${(e as Error).message}`, 'err');
    } finally {
      setSaving(false);
    }
  };

  const handleAddBlock = () => {
    if (mode !== 'edit') return;
    window.dispatchEvent(new Event('seatmap:addBlock'));
    showToast('已添加控件（放在当前视野的空白处）');
  };

  const handleArrange = () => {
    if (mode !== 'edit') return;
    resolveAllOverlaps();
    window.dispatchEvent(new Event('seatmap:fit'));
    showToast('已整理本层控件，重叠已自动错开');
  };

  const handleCopy = () => {
    copySelection();
    showToast('已复制所选控件（Ctrl+V 或左侧编辑栏粘贴）');
  };

  const handlePaste = () => {
    pasteClipboard();
    showToast('已粘贴控件');
  };

  return (
    <div className="app">
      <Toolbar
        onToggleEdit={handleToggleEdit}
        onSave={handleSave}
        onFit={() => window.dispatchEvent(new Event('seatmap:fit'))}
        onZoom={(factor) =>
          window.dispatchEvent(new CustomEvent('seatmap:zoom', { detail: { factor } }))
        }
        onSearch={locate}
        onLogout={() => {
          clearAuth();
          showToast('已退出登录');
        }}
        saving={saving || importing}
        matchCount={{ total: matchCount }}
      />

      <main className="body">
        {mode === 'edit' ? (
          <EditBar
            onAddBlock={handleAddBlock}
            onOpenHistory={() => setHistoryOpen(true)}
            onArrange={handleArrange}
            onCopy={handleCopy}
            onPaste={handlePaste}
            clipboardCount={clipboardCount}
            onImport={handleImport}
            onDownloadTemplate={handleDownloadTemplate}
            importKeyField={importKeyField}
            onImportKeyField={setImportKeyField}
            keyOptions={keyOptions}
          />
        ) : null}
        <FloorCanvas matches={floorMatches} />
        <InspectorPanel matches={allMatches} onFocusSeat={focusSeat} />
      </main>

      {dirty ? <div className="dirty-dot">未保存</div> : null}
      {loading ? <div className="overlay">正在加载布局…</div> : null}

      <ImportPreviewDialog
        preview={preview}
        busy={importing}
        onCancel={() => setPreview(null)}
        onConfirm={handleConfirmImport}
      />

      <HistoryDialog
        open={historyOpen}
        token={token || ''}
        busy={busy || saving}
        onClose={() => setHistoryOpen(false)}
        onRestore={handleRestoreHistory}
      />

      <PasswordDialog
        open={loginOpen}
        title="身份验证"
        hint="进入编辑模式需要管理员密码（默认 admin123，可通过环境变量 SEATMAP_PASSWORD 修改）。"
        confirmText="验证并进入编辑"
        loading={busy}
        error={error}
        onSubmit={handleLogin}
        onCancel={() => {
          pendingEdit.current = false;
          setLoginOpen(false);
          setError('');
        }}
      />

      <PasswordDialog
        open={reauthOpen}
        title="二次身份验证"
        hint="保存布局、执行导入属于敏感操作，需要再次验证身份。"
        confirmText="验证并继续"
        loading={busy}
        error={error}
        onSubmit={handleReauth}
        onCancel={() => {
          setError('');
          finishReauth(null);
        }}
      />

      {toast ? <div className={`toast toast-${toast.kind}`}>{toast.msg}</div> : null}
    </div>
  );
}
