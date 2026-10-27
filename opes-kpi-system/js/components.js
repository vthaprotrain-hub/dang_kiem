/** Thành phần giao diện dùng lại giữa các phân hệ. */
import { html, raw, initials, fmt, multiline } from './utils.js';
import { ctx, nameOf } from './state.js';
import { icon } from './icons.js';

export function pageHead({ title, sub = '', crumbs = [], actions = '' }) {
  return html`<div class="page-head">
    <div class="grow">
      ${crumbs.length ? html`<nav class="breadcrumb" aria-label="Breadcrumb"><a href="#/dashboard">Trang chủ</a>${crumbs.map(([label, href]) => html`<span class="sep">›</span>${href ? html`<a href="${href}">${label}</a>` : html`<span>${label}</span>`}`)}</nav>` : ''}
      <h1>${title}</h1>
      ${sub ? html`<div class="sub">${sub}</div>` : ''}
    </div>
    ${actions ? html`<div class="btn-group no-print">${actions}</div>` : ''}
  </div>`;
}

export function userCell(userId, extra = '') {
  const p = ctx.profiles[userId] || ctx.periodUsers[userId] || {};
  const name = p.name || nameOf(userId);
  return html`<div class="row nowrap" style="gap:8px"><span class="avatar sm">${initials(name)}</span><div style="min-width:0"><div class="strong">${name}</div><div class="small muted">${p.title || ''}${extra ? html` · ${extra}` : ''}</div></div></div>`;
}

export function kv(rows) {
  return html`<dl class="kv">${rows.filter(Boolean).map(([k, v]) => html`<dt>${k}</dt><dd>${v === undefined || v === null || v === '' ? html`<span class="muted">—</span>` : v}</dd>`)}</dl>`;
}

export function tabs(list, active, attr = 'data-tab') {
  return html`<div class="tabs" role="tablist">${list.map((t) => html`<button class="tab ${t.id === active ? 'active' : ''}" role="tab" ${raw(attr)}="${t.id}" aria-selected="${t.id === active}">${t.label}${t.count !== undefined && t.count !== null ? html` <span class="badge c-gray">${t.count}</span>` : ''}</button>`)}</div>`;
}

export function progress(ratio, tone = '') {
  const pct = Math.max(0, Math.min(100, Math.round((ratio || 0) * 100)));
  return html`<div class="progress ${tone}" title="${pct}%"><span style="width:${pct}%"></span></div>`;
}

export function stat({ label, value, hint = '', href = '', tone = '', id = '' }) {
  return html`<div class="stat ${href ? 'link' : ''} ${tone}" ${href ? raw(`data-href="${href}" role="link" tabindex="0"`) : ''} ${id ? raw(`data-stat="${id}"`) : ''}>
    <span class="label">${label}</span><span class="value">${value}</span>${hint ? html`<span class="hint">${hint}</span>` : ''}
  </div>`;
}

export function options(list, selected, { placeholder = null } = {}) {
  return html`${placeholder !== null ? html`<option value="">${placeholder}</option>` : ''}${list.map((o) => {
    const value = typeof o === 'object' ? o.value : o;
    const label = typeof o === 'object' ? o.label : o;
    return html`<option value="${value}" ${String(value) === String(selected ?? '') ? raw('selected') : ''} ${o.disabled ? raw('disabled') : ''}>${label}</option>`;
  })}`;
}

const ACTION_LABELS = {
  item_add: 'Thêm chỉ tiêu', sub_create: 'Tạo sub-KPI', item_update: 'Cập nhật chỉ tiêu', item_delete: 'Xóa chỉ tiêu', weight_change: 'Điều chỉnh trọng số',
  ack_accept: 'Tiếp nhận KPI', ack_change_request: 'Yêu cầu điều chỉnh', assign: 'Giao KPI', revoke: 'Thu hồi KPI', plan_submit: 'Trình duyệt kế hoạch',
  plan_approve_manager: 'QL trực tiếp phê duyệt', plan_approve_skip: 'QL trên 1 cấp phê duyệt', plan_return: 'Trả lại kế hoạch', plan_reopen: 'Mở sửa đổi kế hoạch',
  eval_submit: 'Gửi tự đánh giá', eval_manager_confirm: 'Quản lý xác nhận đánh giá', eval_approve: 'Phê duyệt kết quả', eval_return: 'Trả lại hồ sơ',
  eval_lock: 'Khóa hồ sơ', eval_unlock: 'Mở khóa ngoại lệ',
};
export const actionLabel = (a) => ACTION_LABELS[a] || a;

function summarize(v) {
  if (v === null || v === undefined) return '';
  if (typeof v !== 'object') return String(v);
  return Object.entries(v).filter(([, x]) => x !== null && x !== undefined).map(([k, x]) => `${k}: ${typeof x === 'object' ? JSON.stringify(x) : x}`).join(', ');
}

export function historyTimeline(entries, { itemTitles = {} } = {}) {
  if (!entries.length) return html`<div class="muted">Chưa có lịch sử.</div>`;
  return html`<ul class="timeline">${entries.map((h) => html`<li>
    <div><b>${actionLabel(h.action)}</b>${h.itemId && itemTitles[h.itemId] ? html` – <span>${itemTitles[h.itemId]}</span>` : ''}</div>
    <div class="small muted">${h.byName || nameOf(h.by)} · ${fmt.datetime(h.at)}</div>
    ${h.before || h.after ? html`<div class="small">${h.before ? html`<span class="muted">Trước:</span> ${summarize(h.before)} ` : ''}${h.after ? html`<span class="muted">Sau:</span> ${summarize(h.after)}` : ''}</div>` : ''}
    ${h.reason ? html`<div class="small"><span class="muted">Lý do:</span> ${multiline(h.reason)}</div>` : ''}
    ${h.note ? html`<div class="small"><span class="muted">Ghi chú:</span> ${multiline(h.note)}</div>` : ''}
  </li>`)}</ul>`;
}

export const sortedHistory = (obj) => Object.entries(obj || {}).map(([id, h]) => ({ id, ...h })).sort((a, b) => (b.at || 0) - (a.at || 0));

export function emptyRow(colspan, msg = 'Không có dữ liệu') {
  return html`<tr><td colspan="${colspan}"><div class="empty">${msg}</div></td></tr>`;
}

export function iconBtn(name, title, attrs = '', kind = 'ghost') {
  return html`<button type="button" class="btn ${kind} sm icon" title="${title}" aria-label="${title}" ${raw(attrs)}>${icon(name, 16)}</button>`;
}
