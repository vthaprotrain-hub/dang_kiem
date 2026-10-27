/**
 * Nhãn & màu trạng thái. Ưu tiên cấu hình trong config/appSettings (do quản trị viên sửa);
 * bảng dưới đây chỉ là giá trị dự phòng kỹ thuật khi cấu hình bị thiếu (có cảnh báo cho admin).
 */
import { ctx, appSettings } from './state.js';
import { html } from './utils.js';

export const FALLBACK_STATUS = {
  plan: { none: ['Chưa có kế hoạch', 'gray'], draft: ['Nháp', 'gray'], submitted: ['Chờ phê duyệt', 'amber'], manager_approved: ['Chờ QL trên 1 cấp duyệt', 'amber'], approved: ['Đã giao', 'teal'], returned: ['Cần bổ sung', 'red'] },
  evaluation: { not_started: ['Chưa bắt đầu', 'gray'], draft: ['Đang đánh giá', 'blue'], submitted: ['Chờ quản lý đánh giá', 'amber'], manager_reviewed: ['Chờ phê duyệt', 'amber'], returned: ['Cần bổ sung', 'red'], approved: ['Đã phê duyệt', 'green'], locked: ['Đã khóa', 'slate'] },
  assignment: { draft: ['Chờ giao', 'purple'], assigned: ['Đã giao – chờ tiếp nhận', 'teal'], accepted: ['Đã tiếp nhận', 'green'], change_requested: ['Yêu cầu điều chỉnh', 'red'], revoked: ['Đã thu hồi', 'slate'] },
  ack: { pending: ['Chờ tiếp nhận', 'purple'], accepted: ['Đã tiếp nhận', 'green'], change_requested: ['Yêu cầu điều chỉnh', 'red'] },
  period: { draft: ['Nháp', 'gray'], configured: ['Đã cấu hình', 'purple'], open: ['Đang mở', 'green'], paused: ['Tạm dừng', 'amber'], consolidating: ['Đang tổng hợp', 'blue'], locked: ['Đã khóa', 'slate'], archived: ['Đã lưu trữ', 'gray'] },
  catalog: { active: ['Đang sử dụng', 'green'], inactive: ['Ngừng sử dụng', 'amber'], archived: ['Lưu trữ', 'slate'] },
  unit: { active: ['Đang hoạt động', 'green'], inactive: ['Ngừng hoạt động', 'amber'], archived: ['Lưu trữ', 'slate'] },
  user: { active: ['Đang hoạt động', 'green'], inactive: ['Ngừng hoạt động', 'slate'] },
};

export function statusInfo(type, code) {
  const conf = appSettings().statusLabels?.[type]?.[code];
  if (conf?.label) return { label: conf.label, color: conf.color || 'gray' };
  const fb = FALLBACK_STATUS[type]?.[code];
  if (fb) return { label: fb[0], color: fb[1] };
  return { label: code || '—', color: 'gray' };
}
export const statusLabel = (type, code) => statusInfo(type, code).label;
export function badge(type, code, title = '') {
  const s = statusInfo(type, code);
  return html`<span class="badge c-${s.color}" title="${title}">${s.label}</span>`;
}
export function colorBadge(label, color = 'gray', title = '') {
  return html`<span class="badge c-${color}" title="${title}">${label}</span>`;
}
export const demoBadge = (on = true, text = 'Cấu hình demo – cần HR xác nhận') => (on ? html`<span class="badge demo" title="Tham số minh họa, chưa phải quy định chính thức">${text}</span>` : '');

export function sourceBadge(source) {
  const s = appSettings().sourceLabels?.[source] || { assigned: { label: 'Cấp trên giao', color: 'teal' }, catalog: { label: 'Tự chọn từ kho', color: 'blue' }, custom: { label: 'Tự tạo mới', color: 'purple' }, sub: { label: 'Sub-KPI', color: 'amber' } }[source] || { label: source, color: 'gray' };
  return html`<span class="badge c-${s.color} kpi-source">${s.label}</span>`;
}
const dict = (key, fallback) => appSettings()[key] || fallback;
export const roleLabel = (r) => dict('roles', {})[r]?.label || r;
export const unitTypeLabel = (t) => dict('unitTypes', {})[t]?.label || t || '—';
export const titleGroupLabel = (t) => dict('titleGroups', {})[t]?.label || t || '—';
export const directionLabel = (d) => dict('kpiDirections', { higher: { label: 'Càng cao càng tốt' }, lower: { label: 'Càng thấp càng tốt' }, scale: { label: 'Theo thang điểm' }, pass_fail: { label: 'Đạt / Không đạt' } })[d]?.label || d || '—';
export const frequencyLabel = (f) => dict('frequencies', {})[f]?.label || f || '—';
export const periodTypeLabel = (t) => dict('periodTypes', {})[t]?.label || t || '—';
export const groupName = (id) => ctx.config.kpiGroups?.[id]?.name || (id ? id : 'Khác');
export const policyName = (id, policies = ctx.period?.policies?.scoring || ctx.config.scoringPolicies) => policies?.[id]?.name || (id ? `${id} (không tồn tại)` : 'Chưa chọn');
export function sortedDict(obj) {
  return Object.entries(obj || {}).sort((a, b) => (a[1]?.order ?? 99) - (b[1]?.order ?? 99));
}
export const gradeBadge = (grade) => {
  if (!grade) return html`<span class="muted">—</span>`;
  if (grade.status === 'official' || grade.status === 'provisional') {
    return html`<span class="badge c-${grade.color || 'blue'}" title="${grade.status === 'provisional' ? 'Tạm tính – chưa đủ dữ liệu chính thức' : ''}">${grade.label}${grade.status === 'provisional' ? ' (tạm tính)' : ''}</span>`;
  }
  const msg = { incomplete: 'Chưa đủ dữ liệu', undefined: 'Ngoài bảng xếp loại', invalid_config: 'Chưa cấu hình' }[grade.status] || 'Chưa xác định';
  return html`<span class="badge c-gray" title="${(grade.reasons || []).join('; ')}">${msg}</span>`;
};
