import express from 'express';
import cors from 'cors';
import multer from 'multer';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ExcelJS = require('exceljs');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(__dirname, 'data');
const HISTORY_DIR = path.join(DATA_DIR, 'history');
const LAYOUT_FILE = path.join(DATA_DIR, 'layout.json');
const SECRET_FILE = path.join(DATA_DIR, 'secret.key');

const PORT = Number(process.env.PORT || 8787);
const ADMIN_USER = process.env.SEATMAP_USER || 'admin';
const ADMIN_PASSWORD = process.env.SEATMAP_PASSWORD || 'admin123';
const TOKEN_TTL = '8h';
const REAUTH_TTL = '5m';

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(HISTORY_DIR, { recursive: true });

const passwordHash = bcrypt.hashSync(ADMIN_PASSWORD, 10);

function getSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (fs.existsSync(SECRET_FILE)) return fs.readFileSync(SECRET_FILE, 'utf8').trim();
  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(SECRET_FILE, secret, 'utf8');
  return secret;
}
const SECRET = getSecret();

function emptyDoc() {
  return {
    version: 0,
    updatedAt: new Date().toISOString(),
    floors: [{ id: 'f1', name: '5F', blocks: [] }],
  };
}

/** 结构迁移：为缺失字段补默认值（保证旧布局文件也能安全加载） */
function migrateDoc(input) {
  const doc = input && typeof input === 'object' ? input : {};
  doc.version = Number.isFinite(doc.version) ? doc.version : 0;
  doc.updatedAt = typeof doc.updatedAt === 'string' ? doc.updatedAt : '';
  if (typeof doc.seatLabelField !== 'string' || !doc.seatLabelField) doc.seatLabelField = '座位号';
  doc.floors = Array.isArray(doc.floors) ? doc.floors : [];
  for (const floor of doc.floors) {
    floor.id = String(floor.id ?? '');
    floor.name = String(floor.name ?? '');
    floor.blocks = Array.isArray(floor.blocks) ? floor.blocks : [];
    for (const block of floor.blocks) {
      block.seats = Array.isArray(block.seats) ? block.seats : [];
      for (const seat of block.seats) {
        seat.seatNo = String(seat.seatNo ?? '');
        seat.machineSN = String(seat.machineSN ?? '');
        seat.portNo = String(seat.portNo ?? '');
        seat.fields = Array.isArray(seat.fields) ? seat.fields : [];
      }
    }
  }
  return doc;
}

/** 结构校验：返回错误信息，或 null 表示通过 */
function validateDoc(doc) {
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.floors)) {
    return '布局数据格式不正确';
  }
  if (!doc.floors.length) return '布局至少需要一个楼层';
  for (const floor of doc.floors) {
    if (!floor || typeof floor !== 'object' || !floor.id || !Array.isArray(floor.blocks)) {
      return '楼层数据结构不正确';
    }
    for (const block of floor.blocks) {
      if (!block || !block.id || typeof block.x !== 'number' || !Array.isArray(block.seats)) {
        return '控件数据结构不正确';
      }
    }
  }
  return null;
}

function readLayout() {
  if (!fs.existsSync(LAYOUT_FILE)) {
    const doc = emptyDoc();
    fs.writeFileSync(LAYOUT_FILE, JSON.stringify(doc, null, 2), 'utf8');
    return doc;
  }
  return migrateDoc(JSON.parse(fs.readFileSync(LAYOUT_FILE, 'utf8')));
}

/* ------------------------------------------------------------------ */
/* 布局写入：进程内串行化 + 原子替换（防并发 last-write-wins 与半截文件）   */
/* ------------------------------------------------------------------ */

/** 写操作串行化：简单的进程内 Promise 队列，保证同一时刻只有一个写者 */
let writeChain = Promise.resolve();
function withWriteLock(fn) {
  const run = writeChain.then(fn, fn);
  writeChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** 原子写：先写同目录临时文件，再 rename 覆盖（同分区 rename 为原子操作） */
function atomicWrite(file, content) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(tmp, content, 'utf8');
    fs.renameSync(tmp, file);
  } finally {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }
}

/** 历史备份中出现的最大版本号（版本号兜底，防止回退/并发造成重复版本） */
function maxHistoryVersion() {
  let max = 0;
  try {
    for (const f of fs.readdirSync(HISTORY_DIR)) {
      const m = /-v(\d+)\.json$/.exec(f);
      if (m) max = Math.max(max, Number(m[1]));
    }
  } catch {
    /* ignore */
  }
  return max;
}

/** 写入布局：串行 + 原子；版本号 = max(当前版本, 历史最大版本) + 1 */
function writeLayout(doc) {
  return withWriteLock(() => {
    const prev = fs.existsSync(LAYOUT_FILE)
      ? JSON.parse(fs.readFileSync(LAYOUT_FILE, 'utf8'))
      : null;
    if (prev) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      atomicWrite(
        path.join(HISTORY_DIR, `layout-${stamp}-v${prev.version ?? 0}.json`),
        JSON.stringify(prev, null, 2),
      );
      const files = fs
        .readdirSync(HISTORY_DIR)
        .filter((f) => f.startsWith('layout-'))
        .sort();
      for (const old of files.slice(0, Math.max(0, files.length - 10))) {
        fs.unlinkSync(path.join(HISTORY_DIR, old));
      }
    }
    doc.version = Math.max(prev?.version ?? 0, maxHistoryVersion()) + 1;
    doc.updatedAt = new Date().toISOString();
    atomicWrite(LAYOUT_FILE, JSON.stringify(doc, null, 2));
    return doc;
  });
}

/** 轻量结构化日志 */
function log(level, msg, extra) {
  const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${msg}`;
  const payload = extra ? ` ${JSON.stringify(extra)}` : '';
  if (level === 'error') console.error(line + payload);
  else console.log(line + payload);
}

const app = express();
app.set('trust proxy', 'loopback');
/* CORS：默认只放行同源（无 Origin）与本机来源；可用 SEATMAP_CORS_ORIGINS 追加白名单 */
const CORS_ORIGINS = (process.env.SEATMAP_CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true);
      if (CORS_ORIGINS.includes(origin)) return cb(null, true);
      if (LOCAL_ORIGIN.test(origin)) return cb(null, true);
      return cb(null, false);
    },
  }),
);
app.use(express.json({ limit: '25mb' }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

function sign(payload, ttl) {
  return jwt.sign(payload, SECRET, { expiresIn: ttl });
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  try {
    req.auth = jwt.verify(token, SECRET);
    next();
  } catch {
    res.status(401).json({ error: '未登录或登录已过期' });
  }
}

function requireReauth(req, res, next) {
  const token = req.headers['x-reauth'];
  try {
    const payload = jwt.verify(String(token || ''), SECRET);
    if (payload.scope !== 'reauth') throw new Error('bad scope');
    next();
  } catch {
    res.status(401).json({ error: '敏感操作需要二次身份验证' });
  }
}

app.get('/api/health', (_req, res) => res.json({ ok: true, user: ADMIN_USER }));

/* 登录 / 二次验证限流：同一 IP 每分钟最多 5 次，防止暴力撞库 */
const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: '登录尝试过于频繁，请稍后再试' },
});

app.post('/api/auth/login', loginLimiter, async (req, res) => {
  const { password } = req.body || {};
  if (typeof password !== 'string' || !(await bcrypt.compare(password, passwordHash))) {
    return res.status(401).json({ error: '密码错误' });
  }
  return res.json({
    token: sign({ user: ADMIN_USER, scope: 'session' }, TOKEN_TTL),
    reauthToken: sign({ user: ADMIN_USER, scope: 'reauth' }, REAUTH_TTL),
    expiresIn: 8 * 3600,
  });
});

app.post('/api/auth/reauth', requireAuth, loginLimiter, async (req, res) => {
  const { password } = req.body || {};
  if (typeof password !== 'string' || !(await bcrypt.compare(password, passwordHash))) {
    return res.status(401).json({ error: '密码错误' });
  }
  res.json({ reauthToken: sign({ user: ADMIN_USER, scope: 'reauth' }, REAUTH_TTL) });
});

app.get('/api/layout', (_req, res) => {
  res.json({ doc: readLayout() });
});

app.put('/api/layout', requireAuth, requireReauth, async (req, res) => {
  const doc = req.body;
  const invalid = validateDoc(doc);
  if (invalid) {
    return res.status(400).json({ error: invalid });
  }
  try {
    const saved = await writeLayout({
      ...doc,
      version: doc.version ?? 0,
      updatedAt: doc.updatedAt ?? '',
      floors: doc.floors,
    });
    log('info', 'layout saved', { version: saved.version });
    res.json({ ok: true, version: saved.version, updatedAt: saved.updatedAt });
  } catch (e) {
    res.status(500).json({ error: `保存失败：${e.message}` });
  }
});

/* ------------------------------------------------------------------ */
/* 历史快照：列出 / 恢复                                                 */
/* ------------------------------------------------------------------ */

app.get('/api/history', requireAuth, (_req, res) => {
  const items = fs
    .readdirSync(HISTORY_DIR)
    .filter((f) => f.startsWith('layout-') && f.endsWith('.json'))
    .sort()
    .reverse()
    .map((f) => {
      const m = /-v(\d+)\.json$/.exec(f);
      const st = fs.statSync(path.join(HISTORY_DIR, f));
      return {
        file: f,
        version: m ? Number(m[1]) : 0,
        size: st.size,
        mtime: st.mtime.toISOString(),
      };
    });
  res.json({ items });
});

app.post('/api/history/restore', requireAuth, requireReauth, async (req, res) => {
  const file = String((req.body || {}).file || '');
  if (!/^layout-[\w.-]+\.json$/.test(file)) {
    return res.status(400).json({ error: '非法的快照文件名' });
  }
  const target = path.join(HISTORY_DIR, path.basename(file));
  if (!fs.existsSync(target)) return res.status(404).json({ error: '快照不存在' });
  try {
    const snapshot = JSON.parse(fs.readFileSync(target, 'utf8'));
    const saved = await writeLayout(migrateDoc(snapshot));
    log('info', 'history restored', { file, version: saved.version });
    res.json({ doc: saved });
  } catch (e) {
    res.status(500).json({ error: `恢复失败：${e.message}` });
  }
});

/* ------------------------------------------------------------------ */
/* 导入模板：以“座位号”为基准，附带现有属性列                            */
/* ------------------------------------------------------------------ */

app.get('/api/template', requireAuth, async (req, res) => {
  const floorId = String(req.query.floorId || '');
  const keyField = String(req.query.keyField || '座位号');
  const doc = readLayout();
  const floors = floorId ? doc.floors.filter((f) => f.id === floorId) : doc.floors;
  const labels = [];
  const rows = [];
  const attrOf = (seat, label) => {
    if (label === '座位号') return seat.seatNo || '';
    if (label === '机器SN') return seat.machineSN || '';
    if (label === '网口号') return seat.portNo || '';
    const field = (seat.fields || []).find((f) => f.label === label || f.key === label);
    return field ? field.value || '' : '';
  };
  const isKey = (label) => label === keyField || (keyField === '座位号' && label === '工位号');

  for (const floor of floors) {
    for (const block of floor.blocks) {
      if (!block.showSeats) continue;
      for (const seat of block.seats || []) {
        if (!seat.seatNo && !seat.machineSN) continue;
        const row = { [keyField]: attrOf(seat, keyField) };
        for (const label of ['座位号', '机器SN', '网口号']) {
          if (!isKey(label)) row[label] = attrOf(seat, label);
        }
        for (const field of seat.fields || []) {
          const label = field.label || field.key;
          if (!label || isKey(label)) continue;
          if (!labels.includes(label)) labels.push(label);
          row[label] = field.value || '';
        }
        rows.push(row);
      }
    }
  }

  const header = [
    keyField,
    ...['座位号', '机器SN', '网口号'].filter((l) => !isKey(l)),
    ...labels.filter((l) => !isKey(l) && !['座位号', '机器SN', '网口号'].includes(l)),
  ];
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('座位导入模板');
  ws.addRow(header);
  for (const row of rows) ws.addRow(header.map((h) => row[h] ?? ''));
  header.forEach((_, i) => {
    ws.getColumn(i + 1).width = 18;
  });
  const buf = await wb.xlsx.writeBuffer();
  const name = `seat-template-${floorId || 'all'}-${encodeURIComponent(keyField)}.xlsx`;
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.send(Buffer.from(buf));
});

/* ------------------------------------------------------------------ */
/* Excel / CSV 导入：预览 → 确认                                                */
/* ------------------------------------------------------------------ */

const SEAT_HEADERS = ['座位号', '工位号', '工位', '座位', 'seatno', 'seat'];
const SN_HEADERS = ['主机sn', '机器sn', 'sn', '主机序列号'];
const PORT_HEADERS = ['网口号', '网口', '端口号', '端口'];

/** 解析上传文件 → { sheet, headers, rows }（exceljs） */
async function parseSheet(file) {
  const isCsv = /\.csv$/i.test(file.originalname || '') || /csv/i.test(file.mimetype || '');
  const wb = new ExcelJS.Workbook();
  if (isCsv) {
    const { Readable } = await import('node:stream');
    await wb.csv.read(Readable.from([file.buffer.toString('utf8')]));
  } else {
    await wb.xlsx.load(file.buffer);
  }

  const cellText = (v) => {
    if (v == null) return '';
    if (typeof v === 'object') {
      if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join('');
      if (v.text != null) return String(v.text);
      if (v.result != null) return String(v.result);
      if (v instanceof Date) return v.toISOString();
      return '';
    }
    return String(v).replace(/\r?\n/g, '\r\n');
  };

  const sheetToTable = (ws) => {
    const colCount = Math.max(ws.columnCount || 0, 1);
    const table = [];
    ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      const cells = [];
      for (let c = 1; c <= colCount; c += 1) {
        const cell = row.getCell(c);
        const nonAnchor = cell.isMerged && cell.master && cell.master.address !== cell.address;
        cells.push(nonAnchor ? '' : cellText(cell.value));
      }
      table[rowNumber - 1] = cells;
    });
    return table;
  };

  for (const ws of wb.worksheets) {
    const table = sheetToTable(ws);
    for (let r = 0; r < Math.min(table.length, 10); r += 1) {
      const cells = (table[r] || []).map((c) => String(c ?? '').trim());
      if (cells.some((c) => SEAT_HEADERS.includes(c.toLowerCase()))) {
        return { sheet: ws.name, headers: cells, rows: table.slice(r + 1) };
      }
    }
  }
  return null;
}

/** 建立 属性值 → 目标位置 索引（跨楼层，基准属性可指定） */
function buildSeatIndex(doc, keyField) {
  const norm = (v) =>
    String(v ?? '')
      .trim()
      .toUpperCase()
      .replace(/\s+/g, '');
  const valueOf = (seat, label) => {
    if (label === '座位号') return seat.seatNo || '';
    if (label === '机器SN') return seat.machineSN || '';
    if (label === '网口号') return seat.portNo || '';
    const field = (seat.fields || []).find((f) => f.label === label || f.key === label);
    return field ? field.value || '' : '';
  };
  const index = new Map();
  for (const floor of doc.floors) {
    for (const block of floor.blocks) {
      if (!block.showSeats) continue;
      block.seats.forEach((seat, seatIndex) => {
        const key = norm(valueOf(seat, keyField));
        if (key && !index.has(key)) {
          index.set(key, {
            floorId: floor.id,
            floorName: floor.name,
            blockId: block.id,
            blockText: block.text,
            seatIndex,
          });
        }
      });
    }
  }
  return { index, norm };
}

/** 待确认的导入（内存暂存，30 分钟有效） */
const pendingImports = new Map();
setInterval(
  () => {
    const now = Date.now();
    for (const [id, item] of pendingImports) {
      if (now - item.created > 30 * 60 * 1000) pendingImports.delete(id);
    }
  },
  5 * 60 * 1000,
).unref?.();

app.post('/api/import/preview', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '未收到文件' });
  let parsed;
  try {
    parsed = await parseSheet(req.file);
  } catch {
    return res.status(400).json({ error: '无法解析 Excel 文件' });
  }
  if (!parsed) {
    return res.status(400).json({ error: '未找到包含"座位号/工位号"表头的工作表' });
  }

  const headers = parsed.headers;
  const keyField = String((req.body && req.body.keyField) || '座位号').trim() || '座位号';
  const keyIsSeat = keyField === '座位号' || keyField === '工位号';
  const seatCol = headers.findIndex((h) => SEAT_HEADERS.includes(h.toLowerCase()));
  const snCol = headers.findIndex((h) => SN_HEADERS.includes(h.toLowerCase()));
  const portCol = headers.findIndex((h) => PORT_HEADERS.includes(h.toLowerCase()));
  const keyCol = keyIsSeat ? seatCol : headers.findIndex((h) => h === keyField);
  if (keyCol < 0) {
    return res.status(400).json({ error: `表格中没有找到基准属性列「${keyField}」` });
  }
  const customCols = headers
    .map((h, i) => ({ h, i }))
    .filter(({ h, i }) => h && i !== keyCol && i !== seatCol && i !== snCol && i !== portCol);

  const doc = readLayout();
  const { index, norm } = buildSeatIndex(doc, keyField);

  // 布局里已存在的自定义属性名
  const knownLabels = new Set();
  for (const floor of doc.floors) {
    for (const block of floor.blocks) {
      for (const seat of block.seats || []) {
        for (const field of seat.fields || []) {
          if (field.label) knownLabels.add(field.label);
        }
      }
    }
  }

  const rows = [];
  const newFields = [];
  const notFound = [];
  const payload = [];
  let updated = 0;
  let same = 0;

  for (const raw of parsed.rows) {
    const cells = (raw || []).map((c) => String(c ?? '').trim());
    const seatNo = cells[keyCol];
    if (!seatNo) continue;
    const changes = [];
    const target = {
      machineSN: snCol >= 0 ? cells[snCol] || '' : '',
      portNo: portCol >= 0 ? cells[portCol] || '' : '',
      fields: customCols.map(({ h, i }) => ({ label: h, value: cells[i] || '' })),
    };
    const hit = index.get(norm(seatNo));
    if (!hit) {
      if (notFound.length < 200) notFound.push(seatNo);
      rows.push({
        seatNo,
        floorId: '',
        floorName: '',
        blockText: '',
        status: 'notfound',
        changes: [],
      });
      continue;
    }
    const floor = doc.floors.find((f) => f.id === hit.floorId);
    const block = floor?.blocks.find((b) => b.id === hit.blockId);
    const seat = block?.seats[hit.seatIndex];
    if (!seat) continue;

    if (target.machineSN && target.machineSN !== (seat.machineSN || '')) {
      changes.push({ field: '机器SN', from: seat.machineSN || '', to: target.machineSN });
    }
    if (target.portNo && target.portNo !== (seat.portNo || '')) {
      changes.push({ field: '网口号', from: seat.portNo || '', to: target.portNo });
    }
    for (const f of target.fields) {
      if (!f.label || !f.value) continue;
      const existing = (seat.fields || []).find((x) => x.label === f.label || x.key === f.label);
      const from = existing ? existing.value || '' : '';
      if (from !== f.value) changes.push({ field: f.label, from, to: f.value });
      if (!knownLabels.has(f.label) && !newFields.includes(f.label)) newFields.push(f.label);
    }

    const status = changes.length ? 'update' : 'same';
    if (status === 'update') updated += 1;
    else same += 1;

    rows.push({
      seatNo,
      floorId: hit.floorId,
      floorName: hit.floorName,
      blockText: hit.blockText,
      status,
      changes,
    });
    payload.push({
      floorId: hit.floorId,
      blockId: hit.blockId,
      seatIndex: hit.seatIndex,
      machineSN: target.machineSN,
      portNo: target.portNo,
      fields: target.fields.filter((f) => f.label),
    });
  }

  const importId = crypto.randomBytes(8).toString('hex');
  pendingImports.set(importId, { created: Date.now(), payload });

  res.json({
    preview: {
      importId,
      keyField,
      sheet: parsed.sheet,
      total: rows.length,
      updated,
      same,
      newFields,
      notFound,
      rows: rows.slice(0, 500),
    },
  });
});

app.post('/api/import/apply', requireAuth, requireReauth, async (req, res) => {
  const importId = String((req.body || {}).importId || '');
  const pending = pendingImports.get(importId);
  if (!pending) {
    return res.status(400).json({ error: '导入预览已过期，请重新上传文件' });
  }
  const doc = readLayout();
  const floors = new Set();
  const newFields = [];
  let updated = 0;

  for (const item of pending.payload) {
    const floor = doc.floors.find((f) => f.id === item.floorId);
    const block = floor?.blocks.find((b) => b.id === item.blockId);
    const seat = block?.seats[item.seatIndex];
    if (!seat) continue;
    if (item.machineSN) seat.machineSN = item.machineSN;
    if (item.portNo) seat.portNo = item.portNo;
    for (const f of item.fields) {
      if (!f.value) continue;
      let field = (seat.fields || []).find((x) => x.label === f.label || x.key === f.label);
      if (!field) {
        field = { key: `col_${f.label}`, label: f.label, value: f.value };
        seat.fields = seat.fields || [];
        seat.fields.push(field);
        if (!newFields.includes(f.label)) newFields.push(f.label);
      }
      field.value = f.value;
    }
    updated += 1;
    floors.add(floor.name);
  }

  pendingImports.delete(importId);
  try {
    const saved = await writeLayout(doc);
    res.json({
      doc: saved,
      summary: {
        updated,
        newFields,
        notFound: [],
        floors: Array.from(floors),
      },
    });
  } catch (e) {
    res.status(500).json({ error: `写入失败：${e.message}` });
  }
});

const distDir = path.join(ROOT, 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get('*', (_req, res) => res.sendFile(path.join(distDir, 'index.html')));
}

const server = app.listen(PORT, () => {
  log('info', 'API ready', { url: `http://127.0.0.1:${PORT}`, user: ADMIN_USER });
  log('info', 'layout file', { file: LAYOUT_FILE });
});

/** 优雅退出：收到 SIGINT / SIGTERM 时停止接收新连接后退出 */
function shutdown(signal) {
  log('info', 'shutting down', { signal });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
