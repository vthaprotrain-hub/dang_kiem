/**
 * uiKit.js — Thành phần giao diện dùng chung: toast, bottom sheet (một sheet tại một thời điểm),
 * hộp thoại xác nhận và trình xem ảnh có thu phóng. Không chứa logic nghiệp vụ.
 */
import { CONFIG } from './config.js';
import { $, clamp, clearNode, h, svg } from './utils.js';

/** Biểu tượng từ bộ sprite trong index.html. */
export function icon(name, cls = 'ic') {
  const s = svg('svg', { class: cls, 'aria-hidden': 'true' });
  const u = svg('use', { href: `#i-${name}` });
  s.append(u);
  return s;
}

/* ----------------------------- toast ----------------------------- */
export function toast(message, { level = 'info', ms = CONFIG.ui.toastMs } = {}) {
  const root = $('#toastRoot');
  if (!root || !message) return;
  // giữ tối đa 2 toast cùng lúc
  while (root.children.length >= 2) root.firstElementChild.remove();
  const el = h('div', { class: 'toast', role: 'status', dataset: { level } }, message);
  root.append(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 260);
  }, ms);
}

/* ----------------------------- sheet ----------------------------- */
let activeSheet = null;

/**
 * @param {object} o
 * @param {string} o.title
 * @param {string} [o.text]
 * @param {(Node|string|null)[]} [o.body]     các node tùy ý đặt giữa tiêu đề và nút
 * @param {{label:string, value?:any, kind?:string, icon?:string, disabled?:boolean}[]} [o.actions]
 * @param {boolean} [o.row]                    xếp 2 nút trên một hàng
 * @param {boolean} [o.dismissible=true]       chạm nền để đóng (trả về null)
 * @returns {{closed:Promise<any>, close:(v?:any)=>void, root:HTMLElement, setDisabled:(value:any, disabled:boolean)=>void}}
 */
export function showSheet({ title, text = '', body = [], actions = [], row = false, dismissible = true } = {}) {
  const root = $('#sheetRoot');
  if (activeSheet) activeSheet.close(null);

  let resolve;
  const closed = new Promise((r) => { resolve = r; });
  const buttons = new Map();

  const actionEls = actions.map((a) => {
    const btn = h('button', { class: `btn ${a.kind ?? ''}`.trim(), type: 'button' }, a.icon ? icon(a.icon) : null, a.label);
    if (a.disabled) btn.disabled = true;
    btn.addEventListener('click', () => close(a.value ?? a.label));
    buttons.set(a.value ?? a.label, btn);
    return btn;
  });

  const sheet = h(
    'div',
    { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('h3', { text: title }),
    text ? h('p', { text }) : null,
    body.length ? h('div', { class: 'sheet-body' }, ...body) : null,
    actionEls.length ? h('div', { class: `sheet-actions${row ? ' row' : ''}` }, ...actionEls) : null,
  );

  clearNode(root);
  root.append(sheet);
  root.hidden = false;

  const onBackdrop = (e) => { if (dismissible && e.target === root) close(null); };
  const onKey = (e) => { if (dismissible && e.key === 'Escape') close(null); };
  root.addEventListener('click', onBackdrop);
  document.addEventListener('keydown', onKey);

  let done = false;
  function close(value = null) {
    if (done) return;
    done = true;
    root.removeEventListener('click', onBackdrop);
    document.removeEventListener('keydown', onKey);
    clearNode(root);
    root.hidden = true;
    if (activeSheet === handle) activeSheet = null;
    resolve(value);
  }
  const handle = {
    closed,
    close,
    root: sheet,
    setDisabled(value, disabled) {
      const b = buttons.get(value);
      if (b) b.disabled = Boolean(disabled);
    },
  };
  activeSheet = handle;
  // focus nút đầu tiên để dùng được bằng bàn phím
  setTimeout(() => actionEls.find((b) => !b.disabled)?.focus?.({ preventScroll: true }), 30);
  return handle;
}

export const closeActiveSheet = (v = null) => activeSheet?.close(v);
export const hasActiveSheet = () => Boolean(activeSheet);

export async function confirmDialog({ title, text, confirmLabel = 'Đồng ý', cancelLabel = 'Hủy', danger = false } = {}) {
  const v = await showSheet({
    title,
    text,
    row: true,
    actions: [
      { label: cancelLabel, value: false, kind: 'ghost' },
      { label: confirmLabel, value: true, kind: danger ? 'danger' : 'primary' },
    ],
  }).closed;
  return v === true;
}

/* ----------------------------- trình xem ảnh ----------------------------- */
let viewerBound = false;
const vs = { scale: 1, tx: 0, ty: 0, pointers: new Map(), pinch: null, drag: null, lastTap: 0 };

function applyViewer() {
  const img = $('#viewerImg');
  const stage = $('#viewerStage');
  const maxX = Math.max(0, (img.offsetWidth * vs.scale - stage.clientWidth) / 2);
  const maxY = Math.max(0, (img.offsetHeight * vs.scale - stage.clientHeight) / 2);
  vs.tx = clamp(vs.tx, -maxX, maxX);
  vs.ty = clamp(vs.ty, -maxY, maxY);
  img.style.transform = `translate(${vs.tx}px, ${vs.ty}px) scale(${vs.scale})`;
}
function resetViewer() {
  vs.scale = 1; vs.tx = 0; vs.ty = 0;
  applyViewer();
}
function zoomAt(newScale, px, py) {
  const s1 = vs.scale;
  const s2 = clamp(newScale, 1, 6);
  vs.tx = px - (px - vs.tx) * (s2 / s1);
  vs.ty = py - (py - vs.ty) * (s2 / s1);
  vs.scale = s2;
  applyViewer();
}
function stagePoint(e) {
  const r = $('#viewerStage').getBoundingClientRect();
  return { x: e.clientX - (r.left + r.width / 2), y: e.clientY - (r.top + r.height / 2) };
}

function bindViewer() {
  if (viewerBound) return;
  viewerBound = true;
  const stage = $('#viewerStage');
  const img = $('#viewerImg');
  img.style.transformOrigin = '50% 50%';
  img.draggable = false;

  stage.addEventListener('pointerdown', (e) => {
    stage.setPointerCapture?.(e.pointerId);
    vs.pointers.set(e.pointerId, stagePoint(e));
    if (vs.pointers.size === 2) {
      const [a, b] = [...vs.pointers.values()];
      vs.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: vs.scale };
      vs.drag = null;
    } else if (vs.pointers.size === 1) {
      vs.drag = { x: e.clientX, y: e.clientY, tx: vs.tx, ty: vs.ty, moved: false };
    }
  });
  stage.addEventListener('pointermove', (e) => {
    if (!vs.pointers.has(e.pointerId)) return;
    vs.pointers.set(e.pointerId, stagePoint(e));
    if (vs.pointers.size >= 2 && vs.pinch) {
      const [a, b] = [...vs.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      zoomAt(vs.pinch.s * (d / Math.max(1, vs.pinch.d)), (a.x + b.x) / 2, (a.y + b.y) / 2);
    } else if (vs.drag && vs.scale > 1) {
      vs.tx = vs.drag.tx + (e.clientX - vs.drag.x);
      vs.ty = vs.drag.ty + (e.clientY - vs.drag.y);
      if (Math.abs(e.clientX - vs.drag.x) + Math.abs(e.clientY - vs.drag.y) > 4) vs.drag.moved = true;
      applyViewer();
    }
  });
  const end = (e) => {
    const wasSingle = vs.pointers.size === 1;
    vs.pointers.delete(e.pointerId);
    if (vs.pointers.size < 2) vs.pinch = null;
    if (wasSingle && vs.drag && !vs.drag.moved && e.type === 'pointerup') {
      const t = Date.now();
      if (t - vs.lastTap < 300) {
        const p = stagePoint(e);
        if (vs.scale > 1.05) resetViewer(); else zoomAt(2.5, p.x, p.y);
        vs.lastTap = 0;
      } else vs.lastTap = t;
    }
    if (vs.pointers.size === 0) vs.drag = null;
  };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = stagePoint(e);
    zoomAt(vs.scale * (e.deltaY < 0 ? 1.18 : 1 / 1.18), p.x, p.y);
  }, { passive: false });

  $('#viewerClose').addEventListener('click', closeViewer);
  $('#viewerReset').addEventListener('click', resetViewer);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#viewer').hidden) closeViewer(); });
  window.addEventListener('resize', () => { if (!$('#viewer').hidden) applyViewer(); });
}

export function openViewer(url, title = '') {
  bindViewer();
  const img = $('#viewerImg');
  $('#viewerTitle').textContent = title;
  vs.scale = 1; vs.tx = 0; vs.ty = 0;
  img.style.transform = '';
  img.src = url;
  img.alt = title;
  $('#viewer').hidden = false;
}
export function closeViewer() {
  $('#viewer').hidden = true;
  $('#viewerImg').removeAttribute('src');
}
