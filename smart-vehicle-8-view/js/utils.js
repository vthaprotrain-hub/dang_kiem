/**
 * utils.js — Hàm tiện ích dùng chung, không phụ thuộc module khác (trừ config khi cần).
 */

/* ----------------------------- Toán học ----------------------------- */
export const DEG = Math.PI / 180;
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const wrap360 = (d) => ((d % 360) + 360) % 360;
/** Chuẩn hóa về (-180, 180]. */
export const wrap180 = (d) => {
  const w = wrap360(d);
  return w > 180 ? w - 360 : w;
};
/** Hiệu góc có dấu a − b trong (-180, 180]. */
export const angleDiff = (a, b) => wrap180(a - b);
export const mean = (arr) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0);
export const percentile = (arr, p) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const i = clamp(Math.round((s.length - 1) * p), 0, s.length - 1);
  return s[i];
};

/** IoU của hai bbox {x,y,w,h}. */
export function iou(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const uni = a.w * a.h + b.w * b.h - inter;
  return uni > 0 ? inter / uni : 0;
}
/** Diện tích phần bbox a nằm trong bbox b / diện tích a. */
export function containedRatio(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return a.w * a.h > 0 ? inter / (a.w * a.h) : 0;
}

/* ----------------------------- Thời gian / id ----------------------------- */
export const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const pad2 = (n) => String(n).padStart(2, '0');
export function uid(prefix = 'id') {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}
export function sessionStamp(d = new Date()) {
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}`;
}
export function formatDateTime(ts) {
  const d = new Date(ts);
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function debounce(fn, ms) {
  let t = null;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
}
export function throttle(fn, ms) {
  let last = 0;
  let timer = null;
  let pending = null;
  return (...args) => {
    const t = Date.now();
    if (t - last >= ms) {
      last = t;
      fn(...args);
    } else {
      pending = args;
      if (!timer) {
        timer = setTimeout(() => {
          timer = null;
          last = Date.now();
          if (pending) fn(...pending);
          pending = null;
        }, ms - (t - last));
      }
    }
  };
}

/* ----------------------------- Emitter ----------------------------- */
export class Emitter {
  constructor() {
    this._h = new Map();
  }
  on(evt, fn) {
    if (!this._h.has(evt)) this._h.set(evt, new Set());
    this._h.get(evt).add(fn);
    return () => this.off(evt, fn);
  }
  off(evt, fn) {
    this._h.get(evt)?.delete(fn);
  }
  emit(evt, payload) {
    this._h.get(evt)?.forEach((fn) => {
      try {
        fn(payload);
      } catch (e) {
        log.error('Emitter handler lỗi', evt, e);
      }
    });
  }
}

/* ----------------------------- Log (không ghi dữ liệu nhạy cảm) ----------------------------- */
const LOG_MAX = 300;
const logBuffer = [];
function push(level, args) {
  const msg = args
    .map((a) => {
      if (a instanceof Error) return `${a.name}: ${a.message}`;
      if (typeof a === 'object') {
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      }
      return String(a);
    })
    .join(' ');
  logBuffer.push({ t: Date.now(), level, msg });
  if (logBuffer.length > LOG_MAX) logBuffer.shift();
}
export const log = {
  level: 'info',
  debug: (...a) => { push('debug', a); if (log.level === 'debug') console.debug('[sv8]', ...a); },
  info: (...a) => { push('info', a); console.info('[sv8]', ...a); },
  warn: (...a) => { push('warn', a); console.warn('[sv8]', ...a); },
  error: (...a) => { push('error', a); console.error('[sv8]', ...a); },
  buffer: () => logBuffer.slice(),
};

/* ----------------------------- DOM ----------------------------- */
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  applyProps(el, props);
  appendChildren(el, children);
  return el;
}
const SVG_NS = 'http://www.w3.org/2000/svg';
export function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.setAttribute('class', v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  appendChildren(el, children);
  return el;
}
function applyProps(el, props) {
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
}
function appendChildren(el, children) {
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}
export function clearNode(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}
export function setText(el, text) {
  if (el && el.textContent !== text) el.textContent = text;
}
export function setHidden(el, hidden) {
  if (el && el.hidden !== hidden) el.hidden = hidden;
}
export function setAttr(el, name, value) {
  if (!el) return;
  if (value == null || value === false) {
    if (el.hasAttribute(name)) el.removeAttribute(name);
  } else if (el.getAttribute(name) !== String(value)) {
    el.setAttribute(name, value === true ? '' : String(value));
  }
}

/* ----------------------------- Môi trường ----------------------------- */
export const isAndroid = () => /Android/i.test(navigator.userAgent);
export const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isSecure = () => window.isSecureContext || ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

/* ----------------------------- Biển số ----------------------------- */
/** Chuẩn hóa biển số: chữ in hoa + số, bỏ ký tự phân cách. "30A-123.45" -> "30A12345". */
export function normalizePlate(s) {
  return String(s || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
}
/** Định dạng hiển thị gần đúng: 30A12345 -> 30A-123.45 (chỉ để hiển thị). */
export function formatPlate(norm) {
  const n = normalizePlate(norm);
  const m = n.match(/^(\d{2})([A-Z]{1,2}\d?)(\d{4,5})$/);
  if (!m) return n;
  const tail = m[3].length === 5 ? `${m[3].slice(0, 3)}.${m[3].slice(3)}` : m[3];
  return `${m[1]}${m[2]}-${tail}`;
}
export function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}
const OCR_FOLD = { O: '0', Q: '0', D: '0', I: '1', L: '1', B: '8', S: '5', Z: '2', G: '6', T: '7' };
const fold = (s) => s.replace(/[OQDILBSZGT]/g, (c) => OCR_FOLD[c]);
/** Độ tương đồng 0–1 giữa hai biển số (đã chuẩn hóa), có xét nhầm lẫn OCR phổ biến. */
export function plateSimilarity(a, b) {
  const x = normalizePlate(a);
  const y = normalizePlate(b);
  if (!x || !y) return 0;
  const raw = 1 - levenshtein(x, y) / Math.max(x.length, y.length);
  const folded = 1 - levenshtein(fold(x), fold(y)) / Math.max(x.length, y.length);
  // trọng số thấp hơn cho bản "fold" để không đánh giá quá cao
  return Math.max(raw, folded * 0.92);
}

/* ----------------------------- Canvas / Blob ----------------------------- */
const scratchPool = new Map();
/** Tái sử dụng canvas tạm theo khóa để tránh tạo canvas mới liên tục. */
export function scratchCanvas(key, w, h) {
  let c = scratchPool.get(key);
  if (!c) {
    c = document.createElement('canvas');
    scratchPool.set(key, c);
  }
  if (c.width !== w) c.width = w;
  if (c.height !== h) c.height = h;
  return c;
}
export function releaseScratch(key) {
  const c = scratchPool.get(key);
  if (c) {
    c.width = c.height = 0;
    scratchPool.delete(key);
  }
}
/**
 * canvas → Blob, có dự phòng: một số trình duyệt di động trả về null (thiếu bộ nhớ) hoặc không gọi callback.
 * Thử toBlob → toDataURL; vẫn lỗi thì ném lỗi có `stage = 'encode'` để giao diện báo đúng nguyên nhân.
 */
export function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.92) {
  const viaDataUrl = () => {
    const url = canvas.toDataURL(type, quality);
    const [head, b64] = url.split(',');
    if (!b64 || !head.includes(type.split('/')[1])) throw new Error('toDataURL trả về dữ liệu rỗng');
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type });
  };
  return new Promise((resolve, reject) => {
    let done = false;
    const fallback = (why) => {
      if (done) return;
      done = true;
      try { resolve(viaDataUrl()); } catch (e) {
        const err = new Error(`Không mã hóa được ảnh JPEG (${why}; ${e.message})`);
        err.stage = 'encode';
        reject(err);
      }
    };
    const timer = setTimeout(() => fallback('toBlob quá thời gian'), 8000);
    try {
      canvas.toBlob((b) => {
        clearTimeout(timer);
        if (done) return;
        if (b && b.size > 0) { done = true; resolve(b); } else fallback('toBlob trả về rỗng');
      }, type, quality);
    } catch (e) {
      clearTimeout(timer);
      fallback(e.message);
    }
  });
}
export function blobToImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Không đọc được ảnh')); };
    img.src = url;
  });
}
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Quản lý object URL: giới hạn số URL còn sống và thu hồi khi không dùng. */
export class ObjectUrlPool {
  constructor(max = 24) {
    this.max = max;
    this.map = new Map(); // key -> url (thứ tự chèn = LRU)
  }
  get(key, blob) {
    if (this.map.has(key)) {
      const u = this.map.get(key);
      this.map.delete(key);
      this.map.set(key, u);
      return u;
    }
    const url = URL.createObjectURL(blob);
    this.map.set(key, url);
    while (this.map.size > this.max) {
      const [oldK, oldU] = this.map.entries().next().value;
      URL.revokeObjectURL(oldU);
      this.map.delete(oldK);
    }
    return url;
  }
  revoke(key) {
    const u = this.map.get(key);
    if (u) URL.revokeObjectURL(u);
    this.map.delete(key);
  }
  revokeAll() {
    for (const u of this.map.values()) URL.revokeObjectURL(u);
    this.map.clear();
  }
}

/* ----------------------------- Nạp script ----------------------------- */
const scriptCache = new Map();
export function loadScript(url, timeoutMs = 30000) {
  if (scriptCache.has(url)) return scriptCache.get(url);
  const p = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = url;
    s.async = true;
    s.crossOrigin = 'anonymous';
    const timer = setTimeout(() => { s.remove(); reject(new Error(`Hết thời gian tải ${url}`)); }, timeoutMs);
    s.onload = () => { clearTimeout(timer); resolve(url); };
    s.onerror = () => { clearTimeout(timer); s.remove(); reject(new Error(`Không tải được ${url}`)); };
    document.head.appendChild(s);
  });
  scriptCache.set(url, p);
  p.catch(() => scriptCache.delete(url));
  return p;
}
/** Thử lần lượt các URL (CDN dự phòng). Trả về URL đã tải thành công. */
export async function loadScriptFirst(urls, timeoutMs) {
  let lastErr;
  for (const u of urls) {
    try {
      return await loadScript(u, timeoutMs);
    } catch (e) {
      lastErr = e;
      log.warn('Tải script thất bại, thử nguồn khác:', e.message);
    }
  }
  throw lastErr ?? new Error('Không có URL để tải');
}

export function withTimeout(promise, ms, message = 'Hết thời gian chờ') {
  let t;
  const timeout = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(message)), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

/** Bao một hàm async/sync để lỗi không làm sập toàn ứng dụng. */
export function safe(fn, fallback, label = 'safe') {
  return (...args) => {
    try {
      const r = fn(...args);
      if (r && typeof r.then === 'function') return r.catch((e) => { log.error(label, e); return fallback; });
      return r;
    } catch (e) {
      log.error(label, e);
      return fallback;
    }
  };
}
