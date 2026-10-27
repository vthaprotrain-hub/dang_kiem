/**
 * Lớp truy cập Firebase Realtime Database dùng chung:
 *  - đọc/ghi có ánh xạ lỗi sang tiếng Việt,
 *  - ghi nhiều đường dẫn NGUYÊN TỬ (update tại gốc) để tránh dữ liệu dở dang,
 *  - quản lý listener theo "phạm vi" (route/global) để hủy khi chuyển màn hình/đăng xuất,
 *  - các helper tạo bản ghi kiểm toán, lịch sử và thông báo đi kèm trong cùng một lần ghi.
 */
import { db } from './firebase.js';
import { ref, get, update, onValue, push, query, serverTimestamp } from './sdk.js';
import { ctx } from '../state.js';
import { cleanUndefined } from '../utils.js';

export const NOW = () => serverTimestamp();
export const DENIED = Symbol('denied');

export class AppError extends Error {
  constructor(userMessage, cause) {
    super(userMessage);
    this.userMessage = userMessage;
    this.cause = cause;
    this.permissionDenied = isPermissionDenied(cause);
  }
}

export function isPermissionDenied(e) {
  if (!e) return false;
  return e.code === 'PERMISSION_DENIED' || /permission[_ ]denied/i.test(String(e.message || e));
}

export function mapError(e) {
  if (!e) return 'Đã có lỗi không xác định.';
  if (e.userMessage) return e.userMessage;
  const msg = String(e.message || e);
  const code = String(e.code || '');
  if (isPermissionDenied(e)) return 'Thao tác bị từ chối bởi quy tắc bảo mật (Database Rules): bạn không có quyền, hoặc hồ sơ đã chuyển sang trạng thái khác.';
  if (/network|offline|unavailable|disconnected|Failed to fetch/i.test(msg + code)) return 'Mất kết nối tới Firebase. Vui lòng kiểm tra mạng và thử lại.';
  const auth = {
    'auth/invalid-credential': 'Email hoặc mật khẩu không đúng.',
    'auth/invalid-login-credentials': 'Email hoặc mật khẩu không đúng.',
    'auth/wrong-password': 'Mật khẩu không đúng.',
    'auth/user-not-found': 'Tài khoản chưa được tạo trong Firebase Authentication.',
    'auth/invalid-email': 'Email không hợp lệ.',
    'auth/user-disabled': 'Tài khoản đã bị vô hiệu hóa.',
    'auth/too-many-requests': 'Đăng nhập sai quá nhiều lần. Vui lòng thử lại sau ít phút.',
    'auth/network-request-failed': 'Không kết nối được Firebase Authentication.',
    'auth/email-already-in-use': 'Email đã có tài khoản trong Firebase Authentication.',
    'auth/weak-password': 'Mật khẩu quá yếu (tối thiểu 6 ký tự).',
    'auth/operation-not-allowed': 'Phương thức Email/Password chưa được bật trong Firebase Authentication.',
    'auth/configuration-not-found': 'Firebase Authentication chưa được cấu hình cho dự án.',
    'auth/api-key-not-valid.-please-pass-a-valid-api-key.': 'firebaseConfig chưa đúng (API key không hợp lệ).',
  };
  if (auth[code]) return auth[code];
  if (code.startsWith('auth/')) return `Lỗi xác thực (${code}).`;
  return msg;
}

const wrap = (e) => (e instanceof AppError ? e : new AppError(mapError(e), e));

export const dbRef = (path) => ref(db, path);
export const newKey = (path) => push(ref(db, path)).key;

/** Đọc 1 lần. Nếu allowDenied = true thì trả về DENIED thay vì ném lỗi khi bị Rules từ chối. */
export async function read(path, { allowDenied = false } = {}) {
  try {
    const snap = await get(ref(db, path));
    return snap.exists() ? snap.val() : null;
  } catch (e) {
    if (allowDenied && isPermissionDenied(e)) return DENIED;
    throw wrap(e);
  }
}

/** Ghi nhiều đường dẫn trong MỘT giao dịch nguyên tử (tất cả thành công hoặc tất cả bị từ chối). */
export async function write(updates) {
  const clean = cleanUndefined(updates);
  if (!Object.keys(clean).length) return;
  try {
    await update(ref(db), clean);
  } catch (e) {
    console.warn('[write] bị từ chối', Object.keys(clean), e?.message);
    throw wrap(e);
  }
}

// ---------------------------------------------------------------------------
// Listener có quản lý
// ---------------------------------------------------------------------------
const scopes = new Map(); // scope -> Map(key -> unsub)
let anon = 0;

/**
 * Lắng nghe thay đổi thời gian thực.
 * @param {string} path
 * @param {(value, snap) => void} cb
 * @param {{scope?: 'route'|'global'|string, key?: string, query?: any[], onError?: (err)=>void}} opts
 * @returns {() => void} hàm hủy
 */
export function listen(path, cb, opts = {}) {
  const scope = opts.scope || 'route';
  const key = opts.key || `${path}#${++anon}`;
  if (!scopes.has(scope)) scopes.set(scope, new Map());
  const reg = scopes.get(scope);
  if (reg.has(key)) { try { reg.get(key)(); } catch { /* ignore */ } reg.delete(key); }
  let q = ref(db, path);
  if (opts.query?.length) q = query(q, ...opts.query);
  const unsub = onValue(q, (snap) => {
    try { cb(snap.exists() ? snap.val() : null, snap); } catch (e) { console.error('[listen] lỗi xử lý dữ liệu', path, e); }
  }, (err) => {
    if (opts.onError) opts.onError(wrap(err));
    else console.warn('[listen] lỗi', path, err?.message);
  });
  const off = () => { try { unsub(); } catch { /* ignore */ } reg.delete(key); };
  reg.set(key, off);
  return off;
}

/** Lắng nghe và chờ giá trị đầu tiên (dùng khi khởi tạo ngữ cảnh). */
export function listenFirst(path, cb, opts = {}) {
  return new Promise((resolve, reject) => {
    let first = true;
    listen(path, (v, s) => {
      cb(v, s);
      if (first) { first = false; resolve(v); }
    }, { ...opts, onError: (e) => { opts.onError?.(e); if (first) { first = false; reject(e); } } });
  });
}

export function clearScope(scope) {
  const reg = scopes.get(scope);
  if (!reg) return;
  for (const off of [...reg.values()]) off();
  reg.clear();
}
export function clearAll() {
  for (const s of [...scopes.keys()]) clearScope(s);
}
export const listenerCount = () => [...scopes.values()].reduce((s, r) => s + r.size, 0);

// ---------------------------------------------------------------------------
// Bản ghi đi kèm (kiểm toán, lịch sử, thông báo)
// ---------------------------------------------------------------------------
const actor = () => ({ id: ctx.userId, name: ctx.profile?.name || '' });

/** Nhật ký kiểm toán (do client ghi; người thực hiện & thời điểm được Rules xác thực). */
export function auditUpdate({ type, entity, entityId, periodId = null, before = null, after = null, reason = null }) {
  const id = newKey('auditLogs');
  const a = actor();
  return {
    [`auditLogs/${id}`]: cleanUndefined({ type, entity, entityId, periodId, actorId: a.id, actorName: a.name, at: NOW(), before, after, reason, source: 'client' }),
  };
}

/** Lịch sử gắn với hồ sơ (kpiPlans/... hoặc evaluations/...) – chỉ được ghi thêm. */
export function historyUpdate(basePath, { action, itemId = null, before = null, after = null, reason = null, note = null }) {
  const id = newKey(`${basePath}/history`);
  const a = actor();
  return { [`${basePath}/history/${id}`]: cleanUndefined({ action, itemId, before, after, reason, note, by: a.id, byName: a.name, at: NOW() }) };
}

/** Thông báo trong ứng dụng cho người nhận. */
export function notifyUpdate(toUserId, { type, title, message = '', link = '' }) {
  if (!toUserId || toUserId === ctx.userId) return {};
  const id = newKey(`notifications/${toUserId}`);
  const a = actor();
  return { [`notifications/${toUserId}/${id}`]: { type, title, message, link, fromId: a.id, fromName: a.name, at: NOW(), read: false } };
}

/** Chữ ký/xác nhận điện tử trong hệ thống (không phải chữ ký số). */
export function signature({ version, note = '', contentHash = null, role = '' }) {
  return cleanUndefined({ userId: ctx.userId, name: ctx.profile?.name || '', title: ctx.profile?.title || '', at: NOW(), version, note: note || null, contentHash, role: role || null });
}
