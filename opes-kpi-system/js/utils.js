/**
 * Tiện ích giao diện dùng chung: HTML an toàn, định dạng, hộp thoại, thông báo, xuất file.
 * Mọi dữ liệu người dùng đưa vào HTML đều đi qua html`` (tự động escape).
 */

// ---------------------------------------------------------------------------
// HTML an toàn
// ---------------------------------------------------------------------------
class SafeHtml {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
export function esc(v) {
  return String(v ?? '').replace(/[&<>"'`]/g, (c) => ESC[c]);
}
/** Đánh dấu chuỗi HTML đã an toàn (chỉ dùng cho HTML do mã nguồn tạo, không dùng cho dữ liệu người dùng). */
export const raw = (s) => new SafeHtml(String(s ?? ''));
function toHtml(v) {
  if (v === null || v === undefined || v === false || v === true) return '';
  if (v instanceof SafeHtml) return v.s;
  if (Array.isArray(v)) return v.map(toHtml).join('');
  return esc(v);
}
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += toHtml(values[i]) + strings[i + 1];
  return new SafeHtml(out);
}
export function render(el, content) {
  if (!el) return;
  el.innerHTML = toHtml(content);
}
/** Tạo vùng trang mới trong #view – sự kiện gắn vào vùng này tự bị hủy khi chuyển màn hình. */
export function mountPage(view) {
  const page = document.createElement('div');
  page.className = 'page';
  view.replaceChildren(page);
  return page;
}
/** Văn bản nhiều dòng (giữ xuống dòng). */
export const multiline = (s) => html`<span class="pre">${s ?? ''}</span>`;

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
/** Gắn sự kiện ủy quyền; trả về hàm gỡ. */
export function on(root, event, selector, handler) {
  const fn = (e) => {
    const target = e.target.closest(selector);
    if (target && root.contains(target)) handler(e, target);
  };
  root.addEventListener(event, fn);
  return () => root.removeEventListener(event, fn);
}
export function formValues(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.type === 'checkbox') {
      if (el.dataset.group) {
        out[el.name] ||= {};
        if (el.checked) out[el.name][el.value] = true;
      } else out[el.name] = el.checked;
    } else if (el.type === 'radio') {
      if (el.checked) out[el.name] = el.value;
    } else if (el.tagName === 'SELECT' && el.multiple) {
      out[el.name] = Array.from(el.selectedOptions).map((o) => o.value);
    } else out[el.name] = el.value;
  }
  return out;
}
export const initials = (name) => String(name || '?').trim().split(/\s+/).slice(-2).map((w) => w[0]).join('').toUpperCase();

// ---------------------------------------------------------------------------
// Định dạng
// ---------------------------------------------------------------------------
const nf = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 4 });
export const fmt = {
  number(v, digits = 4) {
    if (v === null || v === undefined || v === '' || Number.isNaN(Number(v))) return '—';
    return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: digits }).format(Number(v));
  },
  percent(ratio, digits = 2) {
    if (ratio === null || ratio === undefined || Number.isNaN(ratio)) return '—';
    return `${new Intl.NumberFormat('vi-VN', { minimumFractionDigits: 0, maximumFractionDigits: digits }).format(ratio * 100)}%`;
  },
  weight(w) {
    if (w === null || w === undefined || w === '') return '—';
    return `${nf.format(Number(w))}%`;
  },
  date(v) {
    if (!v) return '—';
    const d = typeof v === 'number' ? new Date(v) : new Date(`${v}T00:00:00`);
    if (Number.isNaN(d.getTime())) return String(v);
    return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
  },
  datetime(v) {
    if (!v || typeof v !== 'number') return '—';
    return new Date(v).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  },
  relative(v) {
    if (!v || typeof v !== 'number') return '';
    const s = Math.round((Date.now() - v) / 1000);
    if (s < 60) return 'vừa xong';
    if (s < 3600) return `${Math.floor(s / 60)} phút trước`;
    if (s < 86400) return `${Math.floor(s / 3600)} giờ trước`;
    if (s < 86400 * 30) return `${Math.floor(s / 86400)} ngày trước`;
    return fmt.date(v);
  },
};
export function normalizeText(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().trim();
}
export const matches = (query, ...fields) => {
  const q = normalizeText(query);
  if (!q) return true;
  return fields.some((f) => normalizeText(f).includes(q));
};
export const emailKey = (email) => String(email || '').trim().toLowerCase().replaceAll('.', ',');
export const isValidKey = (k) => typeof k === 'string' && k.length > 0 && !/[.#$\[\]\/]/.test(k);
export const todayISO = () => new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Dữ liệu
// ---------------------------------------------------------------------------
export const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
export const entries = (obj) => Object.entries(obj || {});
export const values = (obj) => Object.values(obj || {});
export function sortBy(arr, ...keys) {
  return [...arr].sort((a, b) => {
    for (const k of keys) {
      const fa = typeof k === 'function' ? k(a) : a?.[k];
      const fb = typeof k === 'function' ? k(b) : b?.[k];
      if (fa === fb) continue;
      if (fa === undefined || fa === null) return 1;
      if (fb === undefined || fb === null) return -1;
      if (typeof fa === 'number' && typeof fb === 'number') return fa - fb;
      return String(fa).localeCompare(String(fb), 'vi');
    }
    return 0;
  });
}
export function groupBy(arr, fn) {
  const out = new Map();
  for (const x of arr) {
    const k = fn(x);
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(x);
  }
  return out;
}
export function debounce(fn, ms = 400) {
  let t;
  const d = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  d.flush = (...args) => { clearTimeout(t); fn(...args); };
  return d;
}
/** Loại bỏ undefined (Firebase không chấp nhận undefined). */
export function cleanUndefined(v) {
  if (Array.isArray(v)) return v.map(cleanUndefined);
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    const out = {};
    for (const [k, x] of Object.entries(v)) if (x !== undefined) out[k] = cleanUndefined(x);
    return out;
  }
  return v;
}
export function numOrNull(v) {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export async function sha256(text) {
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    // môi trường không hỗ trợ subtle crypto (http không an toàn) – dùng băm đơn giản để đối chiếu
    let h = 0;
    for (let i = 0; i < text.length; i++) h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
    return `weak-${(h >>> 0).toString(16)}`;
  }
}

// ---------------------------------------------------------------------------
// Hiển thị trạng thái
// ---------------------------------------------------------------------------
export const ui = {
  loading(msg = 'Đang tải dữ liệu…') { return html`<div class="loading"><span class="spinner"></span>${msg}</div>`; },
  empty(msg = 'Không có dữ liệu', icon = '∅') { return html`<div class="empty"><span class="big">${icon}</span>${msg}</div>`; },
  error(err) {
    const msg = typeof err === 'string' ? err : err?.userMessage || err?.message || 'Đã có lỗi xảy ra';
    return html`<div class="alert danger"><div><b>Không tải được dữ liệu.</b> ${msg}</div></div>`;
  },
  denied(msg = 'Bạn không có quyền truy cập chức năng hoặc hồ sơ này.') {
    return html`<div class="card"><div class="card-body"><div class="empty"><span class="big">🔒</span><b>Không có quyền truy cập</b><br>${msg}</div></div></div>`;
  },
};

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------
export function toast(message, type = 'success', timeout = 3800) {
  const box = document.getElementById('toasts');
  if (!box) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.textContent = message;
  box.appendChild(el);
  setTimeout(() => el.remove(), type === 'error' ? timeout + 2500 : timeout);
}

// ---------------------------------------------------------------------------
// Modal / Drawer / Confirm
// ---------------------------------------------------------------------------
let modalDepth = 0;
/**
 * Mở hộp thoại.
 * @param {object} o {title, body (html), size: ''|'lg'|'xl', actions:[{label, kind, value, onClick(ctx)}], onMount(el, close), drawer}
 * @returns {{el, close, result: Promise}}
 */
export function openModal(o) {
  let resolveResult;
  const result = new Promise((r) => { resolveResult = r; });
  const backdrop = document.createElement('div');
  backdrop.className = o.drawer ? 'drawer-backdrop' : 'modal-backdrop';
  const box = document.createElement('div');
  box.className = o.drawer ? 'drawer' : `modal ${o.size || ''}`;
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  const actions = o.actions || [{ label: 'Đóng', value: null }];
  box.innerHTML = toHtml(html`
    <div class="modal-header"><h3>${o.title || ''}</h3><button class="close-x" data-close aria-label="Đóng">×</button></div>
    <div class="modal-body"></div>
    ${actions.length ? html`<div class="modal-footer">${actions.map((a, i) => html`<button type="button" class="btn ${a.kind || ''}" data-action="${i}">${a.label}</button>`)}</div>` : ''}
  `);
  const body = box.querySelector('.modal-body');
  render(body, o.body || '');
  modalDepth++;
  let closed = false;
  const close = (value = null) => {
    if (closed) return;
    closed = true;
    modalDepth--;
    backdrop.remove();
    if (o.drawer) box.remove();
    document.removeEventListener('keydown', onKey);
    resolveResult(value);
    o.onClose?.(value);
  };
  const onKey = (e) => { if (e.key === 'Escape' && o.dismissible !== false) close(null); };
  document.addEventListener('keydown', onKey);
  box.addEventListener('click', async (e) => {
    if (e.target.closest('[data-close]')) { close(null); return; }
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const a = actions[Number(btn.dataset.action)];
    // onClick tự quyết định đóng hộp thoại (gọi close) – trả về false để giữ nguyên
    if (a.onClick) await busy(btn, () => a.onClick({ el: box, body, close }));
    else close(a.value ?? null);
  });
  if (o.drawer) {
    backdrop.addEventListener('click', () => { if (o.dismissible !== false) close(null); });
    document.body.append(backdrop, box);
  } else {
    backdrop.appendChild(box);
    backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop && o.dismissible !== false) close(null); });
    document.body.appendChild(backdrop);
  }
  o.onMount?.(body, close, box);
  // Tự focus ô đầu tiên – không giành focus nếu người dùng đã chọn một ô trong hộp thoại.
  setTimeout(() => {
    if (closed || box.contains(document.activeElement)) return;
    body.querySelector('input:not([type=hidden]):not([disabled]), textarea, select')?.focus();
  }, 30);
  return { el: box, body, close, result };
}

/** Hộp xác nhận. Trả về Promise<{reason}|null>. */
export function confirmDialog({ title = 'Xác nhận', message = '', confirmText = 'Xác nhận', cancelText = 'Hủy', danger = false, requireReason = false, reasonLabel = 'Lý do', reasonPlaceholder = '', details = null } = {}) {
  return new Promise((resolve) => {
    const m = openModal({
      title,
      body: html`<div class="stack">
        <div>${typeof message === 'string' ? multiline(message) : message}</div>
        ${details || ''}
        ${requireReason ? html`<div class="field"><label class="req" for="cf-reason">${reasonLabel}</label><textarea id="cf-reason" placeholder="${reasonPlaceholder}"></textarea><span class="help" id="cf-err"></span></div>` : ''}
      </div>`,
      actions: [
        { label: cancelText, value: null },
        {
          label: confirmText, kind: danger ? 'danger' : 'primary',
          onClick: ({ el, close }) => {
            let reason = '';
            if (requireReason) {
              reason = el.querySelector('#cf-reason').value.trim();
              if (!reason) { el.querySelector('#cf-err').textContent = 'Vui lòng nhập lý do.'; el.querySelector('#cf-reason').classList.add('invalid'); return false; }
            }
            close({ reason });
            return true;
          },
        },
      ],
      onClose: (v) => resolve(v),
    });
    return m;
  });
}

/** Chống bấm lặp: vô hiệu nút trong lúc chạy hàm async. */
export async function busy(button, fn) {
  if (!button) return fn();
  if (button.dataset.busy === '1') return undefined;
  button.dataset.busy = '1';
  const prev = button.innerHTML;
  button.disabled = true;
  button.classList.add('is-busy');
  button.insertAdjacentHTML('afterbegin', '<span class="spinner"></span>');
  try {
    return await fn();
  } finally {
    if (button.isConnected) {
      button.innerHTML = prev;
      button.disabled = false;
      button.classList.remove('is-busy');
    }
    delete button.dataset.busy;
  }
}

// ---------------------------------------------------------------------------
// Xuất file
// ---------------------------------------------------------------------------
export function download(filename, content, mime = 'text/plain;charset=utf-8') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export function toCSV(rows) {
  const cell = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
}
let xlsxPromise = null;
/** Nạp SheetJS từ CDN khi cần xuất XLSX. */
export function loadXLSX() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (!xlsxPromise) {
    xlsxPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      s.onload = () => (window.XLSX ? resolve(window.XLSX) : reject(new Error('Không nạp được thư viện XLSX')));
      s.onerror = () => { xlsxPromise = null; reject(new Error('Không tải được thư viện XLSX (kiểm tra kết nối mạng)')); };
      document.head.appendChild(s);
    });
  }
  return xlsxPromise;
}
export function safeFileName(s) {
  return normalizeText(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'xuat-du-lieu';
}
