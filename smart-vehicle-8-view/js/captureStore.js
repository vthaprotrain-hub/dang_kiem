/**
 * captureStore.js — Lưu ảnh + metadata phiên chụp CỤC BỘ bằng IndexedDB.
 *
 * - Ảnh lưu dạng Blob trong IndexedDB (không Base64, không localStorage).
 * - Nếu IndexedDB không khả dụng (chế độ riêng tư…) tự chuyển sang bộ nhớ RAM và báo `isPersistent() === false`.
 * - Không có upload lên máy chủ. Không ghi GPS hay dữ liệu cá nhân ngoài những gì người dùng nhập.
 * - Lưu ý: xóa dữ liệu ở đây chỉ xóa bản sao trong IndexedDB của ứng dụng; các bản ảnh người dùng đã
 *   tải xuống thiết bị hoặc bản sao do trình duyệt/hệ điều hành quản lý nằm ngoài khả năng của ứng dụng.
 */
import { APP_INFO, ANGLES } from './config.js';
import { ObjectUrlPool, log } from './utils.js';

const STORE_SESSIONS = 'sessions';
const STORE_CAPTURES = 'captures';

let dbPromise = null;
let persistent = true;
const mem = { sessions: new Map(), captures: new Map() };
const urlPool = new ObjectUrlPool(24);

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      persistent = false;
      return resolve(null);
    }
    let req;
    try {
      req = indexedDB.open(APP_INFO.dbName, APP_INFO.dbVersion);
    } catch (e) {
      log.warn('IndexedDB open lỗi, dùng bộ nhớ tạm:', e.message);
      persistent = false;
      return resolve(null);
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_SESSIONS)) db.createObjectStore(STORE_SESSIONS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE_CAPTURES)) {
        const s = db.createObjectStore(STORE_CAPTURES, { keyPath: 'key' });
        s.createIndex('bySession', 'sessionId', { unique: false });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => {
      log.warn('IndexedDB không khả dụng, dùng bộ nhớ tạm:', req.error?.message);
      persistent = false;
      resolve(null);
    };
    req.onblocked = () => log.warn('IndexedDB bị chặn bởi tab khác');
  });
  return dbPromise;
}

const reqP = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

async function tx(storeName, mode, fn) {
  const db = await openDB();
  if (!db) return null;
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, mode);
    const store = t.objectStore(storeName);
    let result;
    Promise.resolve(fn(store)).then((r) => { result = r; }).catch(reject);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error ?? new Error('Transaction bị hủy'));
  });
}

export const isPersistent = () => persistent;
export async function initStore() {
  await openDB();
  return persistent;
}

const capKey = (sessionId, angleKey) => `${sessionId}:${angleKey}`;

/* ------------------------------ Session ------------------------------ */
export async function saveCaptureSession(session) {
  const rec = { ...session, updatedAt: Date.now() };
  const db = await openDB();
  if (!db) {
    mem.sessions.set(rec.id, rec);
    return rec;
  }
  await tx(STORE_SESSIONS, 'readwrite', (s) => reqP(s.put(rec)));
  return rec;
}

export async function listSessions() {
  const db = await openDB();
  if (!db) return [...mem.sessions.values()];
  return (await tx(STORE_SESSIONS, 'readonly', (s) => reqP(s.getAll()))) ?? [];
}

export async function getLatestSession() {
  const all = await listSessions();
  if (!all.length) return null;
  return all.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0];
}

/**
 * Khôi phục phiên: trả về { session, captures: { [angleKey]: { meta, blob } } } hoặc null.
 * Bản ghi ảnh lỗi/không hợp lệ bị bỏ qua thay vì làm hỏng cả phiên.
 */
export async function loadCaptureSession(id) {
  const session = id ? await getSession(id) : await getLatestSession();
  if (!session) return null;
  const captures = {};
  for (const rec of await listCaptureRecords(session.id)) {
    if (rec?.blob instanceof Blob && rec.blob.size > 0 && rec.meta) captures[rec.angleKey] = { meta: rec.meta, blob: rec.blob };
  }
  return { session, captures };
}

export async function getSession(id) {
  const db = await openDB();
  if (!db) return mem.sessions.get(id) ?? null;
  return (await tx(STORE_SESSIONS, 'readonly', (s) => reqP(s.get(id)))) ?? null;
}

/* ------------------------------ Captures ------------------------------ */
export async function putCapture(sessionId, angleKey, blob, meta, thumb = null) {
  const rec = { key: capKey(sessionId, angleKey), sessionId, angleKey, blob, thumb, meta, updatedAt: Date.now() };
  urlPool.revoke(rec.key); // ảnh cũ của góc này không còn hợp lệ
  urlPool.revoke(`${rec.key}:t`);
  const db = await openDB();
  if (!db) {
    mem.captures.set(rec.key, rec);
    return rec;
  }
  await tx(STORE_CAPTURES, 'readwrite', (s) => reqP(s.put(rec)));
  return rec;
}

export async function getCapture(sessionId, angleKey) {
  const db = await openDB();
  if (!db) return mem.captures.get(capKey(sessionId, angleKey)) ?? null;
  return (await tx(STORE_CAPTURES, 'readonly', (s) => reqP(s.get(capKey(sessionId, angleKey))))) ?? null;
}

async function listCaptureRecords(sessionId) {
  const db = await openDB();
  if (!db) return [...mem.captures.values()].filter((r) => r.sessionId === sessionId);
  return (await tx(STORE_CAPTURES, 'readonly', (s) => reqP(s.index('bySession').getAll(sessionId)))) ?? [];
}
export const listCaptures = listCaptureRecords;

export async function deleteCapture(sessionId, angleKey) {
  const key = capKey(sessionId, angleKey);
  urlPool.revoke(key);
  urlPool.revoke(`${key}:t`);
  const db = await openDB();
  if (!db) {
    mem.captures.delete(key);
    return;
  }
  await tx(STORE_CAPTURES, 'readwrite', (s) => reqP(s.delete(key)));
}

/** URL tạm để hiển thị ảnh. Được quản lý theo LRU (tối đa 24 URL còn sống). */
export async function getObjectUrl(sessionId, angleKey) {
  const key = capKey(sessionId, angleKey);
  const rec = await getCapture(sessionId, angleKey);
  if (!rec?.blob) return null;
  return urlPool.get(key, rec.blob);
}
/** URL ảnh thu nhỏ cho lưới preview (ảnh lưu chính vẫn là ảnh gốc đầy đủ). */
export async function getThumbUrl(sessionId, angleKey) {
  const rec = await getCapture(sessionId, angleKey);
  if (!rec) return null;
  const blob = rec.thumb || rec.blob;
  return blob ? urlPool.get(`${capKey(sessionId, angleKey)}:t`, blob) : null;
}
export function urlForBlob(sessionId, angleKey, blob) {
  return urlPool.get(capKey(sessionId, angleKey), blob);
}
export function revokeAllUrls() {
  urlPool.revokeAll();
}

/* ------------------------------ Xóa dữ liệu ------------------------------ */
export async function deleteSession(sessionId) {
  urlPool.revokeAll();
  const db = await openDB();
  if (!db) {
    mem.sessions.delete(sessionId);
    for (const k of [...mem.captures.keys()]) if (k.startsWith(`${sessionId}:`)) mem.captures.delete(k);
    return;
  }
  const recs = await listCaptureRecords(sessionId);
  await tx(STORE_CAPTURES, 'readwrite', async (s) => {
    for (const r of recs) await reqP(s.delete(r.key));
  });
  await tx(STORE_SESSIONS, 'readwrite', (s) => reqP(s.delete(sessionId)));
}

export async function clearAll() {
  urlPool.revokeAll();
  mem.sessions.clear();
  mem.captures.clear();
  const db = await openDB();
  if (!db) return;
  await tx(STORE_CAPTURES, 'readwrite', (s) => reqP(s.clear()));
  await tx(STORE_SESSIONS, 'readwrite', (s) => reqP(s.clear()));
}

/* ------------------------------ Metadata xuất JSON ------------------------------ */
/**
 * Xây dựng JSON metadata của phiên. Chỉ gồm dữ liệu cần cho nghiệp vụ, không có GPS.
 * @param {object} session  state.session + vehicle + settings đã gộp
 * @param {Record<string, object>} captures  angleKey -> meta
 */
export function exportSessionMetadata(session, captures) {
  const list = ANGLES.map((a, i) => {
    const c = captures[a.key];
    return {
      order: i + 1,
      angleKey: a.key,
      angleName: a.name,
      requiredOrientation: a.orientation,
      captured: Boolean(c?.accepted),
      fileName: c ? c.fileName : null,
      capturedAt: c?.capturedAt ? new Date(c.capturedAt).toISOString() : null,
      width: c?.width ?? null,
      height: c?.height ?? null,
      sizeBytes: c?.sizeBytes ?? null,
      screenOrientation: c?.screenOrientation ?? null,
      quality: c?.quality ?? null,
      angleVerification: c?.verification ?? null,
      angleConfidence: c?.angle?.confidence ?? null,
      angleEvidence: c?.angle?.evidence ?? null,
      manualConfirmed: Boolean(c?.manualConfirmed),
      qualityOverride: c?.qualityOverride ?? null,
      dataSource: c?.source ?? null,
    };
  });
  return {
    schema: 'sv8v-session/1',
    app: { name: APP_INFO.name, version: APP_INFO.version },
    sessionId: session.id,
    sessionName: session.name,
    createdAt: session.createdAt ? new Date(session.createdAt).toISOString() : null,
    exportedAt: new Date().toISOString(),
    mode: session.mode,
    demoNotice: session.mode === 'demo' ? 'DEMO — DỮ LIỆU GIẢ LẬP, không phải kết quả AI thật' : null,
    vehicle: { type: session.vehicleType, plateEntered: session.plate || null },
    startPoint: { startAngle: ANGLES[session.startIndex ?? 0].key, confirmation: session.startConfirmation ?? null },
    ocr: session.ocr ?? null,
    captureOrder: list.map((l) => l.angleKey),
    completed: list.every((l) => l.captured),
    captures: list,
    privacy: 'Ảnh và metadata chỉ lưu trên thiết bị. Không có GPS, không upload máy chủ.',
  };
}
