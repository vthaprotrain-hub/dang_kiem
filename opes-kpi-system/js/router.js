/**
 * Bộ định tuyến hash (#/duong-dan/:tham-so). Khi chuyển màn hình sẽ hủy toàn bộ listener phạm vi "route"
 * để không đăng ký trùng lặp, và kiểm tra quyền truy cập trước khi hiển thị.
 */
import { clearScope } from './services/database.service.js';
import { html, render, ui } from './utils.js';

const routes = [];
let token = 0;
let hooks = { onRoute: () => {} };
let started = false;

function compile(path) {
  const keys = [];
  const re = new RegExp(`^${path.replace(/\//g, '\\/').replace(/:(\w+)\??/g, (m, k) => { keys.push(k); return m.endsWith('?') ? '([^/]*)?' : '([^/]+)'; })}\\/?$`);
  return { re, keys };
}

export function addRoutes(list) {
  for (const r of list) routes.push({ ...r, ...compile(r.path) });
}
export function setHooks(h) { hooks = { ...hooks, ...h }; }
export const currentPath = () => decodeURI(location.hash.replace(/^#/, '')) || '/dashboard';
export function navigate(path) {
  const target = path.startsWith('#') ? path : `#${path}`;
  if (location.hash === target) handle();
  else location.hash = target;
}
export function parseQuery(qs) {
  return Object.fromEntries(new URLSearchParams(qs || ''));
}
export function setQuery(params) {
  const [p] = currentPath().split('?');
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v !== null && v !== undefined)).toString();
  history.replaceState(null, '', `#${p}${q ? `?${q}` : ''}`);
}

export async function handle() {
  const full = currentPath();
  const [path, qs] = full.split('?');
  const t = ++token;
  clearScope('route');
  let match = null, params = {};
  for (const r of routes) {
    const m = path.match(r.re);
    if (m) { match = r; r.keys.forEach((k, i) => { params[k] = m[i + 1] ? decodeURIComponent(m[i + 1]) : undefined; }); break; }
  }
  const view = document.getElementById('view');
  if (!view) return;
  hooks.onRoute(match, path);
  window.scrollTo(0, 0);
  if (!match) { render(view, html`<div class="card"><div class="card-body">${ui.empty('Không tìm thấy trang yêu cầu.', '🧭')}</div></div>`); return; }
  if (match.allow && !match.allow(params)) { render(view, ui.denied()); return; }
  render(view, ui.loading());
  try {
    await match.render(view, params, parseQuery(qs), { isCurrent: () => t === token });
  } catch (e) {
    console.error(e);
    if (t === token) render(view, e?.permissionDenied ? ui.denied('Dữ liệu bị Database Rules từ chối – hồ sơ không thuộc phạm vi của bạn hoặc không tồn tại.') : ui.error(e));
  }
}

export function start() {
  if (!started) { window.addEventListener('hashchange', handle); started = true; }
  return handle();
}
export function stop() {
  if (started) window.removeEventListener('hashchange', handle);
  started = false;
}
export const refresh = () => handle();
