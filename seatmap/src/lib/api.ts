import type { ImportPreview, ImportResult, LayoutDoc } from '../types';

const BASE = '';

interface Opts {
  token?: string | null;
  reauth?: string | null;
}

async function req<T>(path: string, init: RequestInit & Opts = {}): Promise<T> {
  const { token, reauth, headers, ...rest } = init;
  const h: Record<string, string> = { ...(headers as Record<string, string>) };
  if (!(rest.body instanceof FormData)) h['Content-Type'] = 'application/json';
  if (token) h['Authorization'] = `Bearer ${token}`;
  if (reauth) h['X-Reauth'] = reauth;
  const res = await fetch(`${BASE}${path}`, { ...rest, headers: h });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }
  if (!res.ok) {
    const message = (data as { error?: string } | null)?.error;
    throw new Error(message || `请求失败 (${res.status})`);
  }
  return data as T;
}

export const api = {
  health: () => req<{ ok: boolean }>('/api/health'),
  loadLayout: () => req<{ doc: LayoutDoc }>('/api/layout'),
  history: (token: string) =>
    req<{ items: { file: string; version: number; size: number; mtime: string }[] }>(
      '/api/history',
      { token },
    ),
  restoreHistory: (file: string, token: string, reauth: string) =>
    req<{ doc: LayoutDoc }>('/api/history/restore', {
      method: 'POST',
      body: JSON.stringify({ file }),
      token,
      reauth,
    }),
  login: (password: string) =>
    req<{ token: string; reauthToken: string; expiresIn: number }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),
  reauth: (password: string, token: string) =>
    req<{ reauthToken: string }>('/api/auth/reauth', {
      method: 'POST',
      body: JSON.stringify({ password }),
      token,
    }),
  saveLayout: (doc: LayoutDoc, token: string, reauth: string) =>
    req<{ ok: boolean; version: number; updatedAt: string }>('/api/layout', {
      method: 'PUT',
      body: JSON.stringify(doc),
      token,
      reauth,
    }),

  /** 第一步：上传表格 → 返回与现有数据的对比预览（不写库） */
  importPreview: (file: File, keyField: string, token: string) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('keyField', keyField);
    return req<{ preview: ImportPreview }>('/api/import/preview', {
      method: 'POST',
      body: fd,
      token,
    });
  },

  /** 第二步：确认后应用（敏感操作，需要二次验证） */
  importApply: (importId: string, token: string, reauth: string) =>
    req<{ doc: LayoutDoc; summary: ImportResult }>('/api/import/apply', {
      method: 'POST',
      body: JSON.stringify({ importId }),
      token,
      reauth,
    }),

  /** 下载导入模板（以指定基准属性为准，带当前楼层已有属性列） */
  downloadTemplate: async (
    floorId: string,
    keyField: string,
    token: string | null,
  ): Promise<Blob> => {
    const res = await fetch(
      `${BASE}/api/template?floorId=${encodeURIComponent(floorId)}&keyField=${encodeURIComponent(keyField)}`,
      {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      },
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `导出失败 (${res.status})`);
    }
    return res.blob();
  },
};
