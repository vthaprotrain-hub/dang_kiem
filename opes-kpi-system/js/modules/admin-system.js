/**
 * Quản trị hệ thống: lịch sử thao tác (kiểm toán), cấu hình ứng dụng & giao diện, bật/tắt đăng nhập demo,
 * bảo trì & khởi tạo dữ liệu demo.
 */
import { listen, write, auditUpdate, mapError, NOW } from '../services/database.service.js';
import { limitToLast, orderByChild } from '../services/sdk.js';
import { ctx, nameOf } from '../state.js';
import { can, isSysAdmin } from '../permissions.js';
import { html, render, ui, fmt, toast, busy, openModal, mountPage, on, formValues, raw, matches } from '../utils.js';
import { pageHead, options, kv } from '../components.js';
import { maintenancePanel } from '../seed/seed.js';
import { listenerCount } from '../services/database.service.js';

async function auditPage(container) {
  const page = mountPage(container);
  let logs = null;
  let limit = 300;
  const f = { q: '', type: '', period: '' };
  const draw = () => {
    if (!logs) { render(page, ui.loading()); return; }
    const all = Object.entries(logs).map(([id, l]) => ({ id, ...l })).sort((a, b) => (b.at || 0) - (a.at || 0));
    const types = [...new Set(all.map((l) => l.type))].sort();
    const list = all.filter((l) => (!f.type || l.type === f.type) && (!f.period || l.periodId === f.period) && matches(f.q, l.actorName, l.entityId, l.reason, l.type));
    render(page, html`${pageHead({ title: 'Lịch sử thao tác (kiểm toán)', sub: 'Bản ghi do client ghi khi thực hiện nghiệp vụ; người thực hiện và thời điểm được Database Rules xác thực (actorId = người đăng nhập, at = giờ máy chủ). Nội dung trước/sau do client cung cấp.', crumbs: [['Quản trị'], ['Lịch sử thao tác']] })}
      <div class="toolbar"><div class="field search"><label>Tìm kiếm</label><input type="search" data-f="q" value="${f.q}"></div>
        <div class="field"><label>Loại nghiệp vụ</label><select data-f="type">${options(types, f.type, { placeholder: 'Tất cả' })}</select></div>
        <div class="field"><label>Kỳ</label><select data-f="period">${options(Object.entries(ctx.periods).map(([id, p]) => ({ value: id, label: p.name })), f.period, { placeholder: 'Tất cả' })}</select></div>
        <div class="field"><label>Số bản ghi gần nhất</label><select id="limit">${options([100, 300, 1000, 3000].map((n) => ({ value: n, label: n })), limit)}</select></div></div>
      <div class="table-wrap tall"><table class="data"><thead><tr><th>Thời điểm</th><th>Loại</th><th>Đối tượng</th><th>Người thực hiện</th><th>Kỳ</th><th>Lý do</th><th>Nguồn</th><th></th></tr></thead><tbody>
        ${list.length ? list.map((l) => html`<tr><td class="nowrap">${fmt.datetime(l.at)}</td><td class="mono small">${l.type}</td><td class="small">${l.entity}<div class="mono muted">${l.entityId}</div></td><td>${l.actorName || nameOf(l.actorId)}</td><td>${l.periodId || ''}</td><td class="small">${l.reason || ''}</td><td><span class="badge ${l.source === 'seed' ? 'c-purple' : 'c-gray'}">${l.source || 'client'}</span></td><td class="actions"><button class="btn xs" data-log="${l.id}">Chi tiết</button></td></tr>`) : html`<tr><td colspan="8">${ui.empty('Không có bản ghi.')}</td></tr>`}
      </tbody></table></div>`);
  };
  const subscribe = () => listen('auditLogs', (v) => { logs = v || {}; draw(); }, { key: 'audit-logs', query: [orderByChild('at'), limitToLast(limit)], onError: (e) => render(page, e.permissionDenied ? ui.denied() : ui.error(e)) });
  on(page, 'change', '[data-f]', (e, el) => { f[el.dataset.f] = el.value; draw(); });
  on(page, 'change', '#limit', (e, el) => { limit = Number(el.value); subscribe(); });
  on(page, 'click', '[data-log]', (e, el) => {
    const l = logs[el.dataset.log];
    openModal({ title: `Sự kiện ${l.type}`, size: 'lg', body: html`${kv([['ID', el.dataset.log], ['Thời điểm (máy chủ)', fmt.datetime(l.at)], ['Người thực hiện', `${l.actorName || ''} (${l.actorId})`], ['Đối tượng', `${l.entity} / ${l.entityId}`], ['Kỳ', l.periodId], ['Lý do', l.reason]])}
      <div class="grid cols-2 mt-2"><div><h4>Trước</h4><div class="diff">${JSON.stringify(l.before ?? null, null, 2)}</div></div><div><h4>Sau</h4><div class="diff">${JSON.stringify(l.after ?? null, null, 2)}</div></div></div>
      <div class="small muted mt-2">Lưu ý: không có backend tin cậy nên nội dung trước/sau không phải bằng chứng chống sửa đổi tuyệt đối; Rules chỉ bảo đảm bản ghi không bị sửa/xóa sau khi tạo và đúng người, đúng thời điểm.</div>` });
  });
  subscribe();
  draw();
}

async function systemPage(container) {
  const page = mountPage(container);
  let demoEnabled = null;
  const draw = () => {
    const a = ctx.config.appSettings || {};
    render(page, html`${pageHead({ title: 'Cấu hình hệ thống & dữ liệu', sub: 'Thông tin ứng dụng, giao diện, đăng nhập demo, bảo trì và khởi tạo dữ liệu', crumbs: [['Quản trị'], ['Cấu hình & dữ liệu']] })}
      <div class="grid cols-2">
        <form class="card" id="app-form"><div class="card-header"><h3>Thông tin ứng dụng & giao diện</h3></div><div class="card-body form-grid">
          <div class="field span-2"><label>Tên ứng dụng</label><input name="appName" value="${a.appName || ''}" ${can('manageConfig') ? '' : raw('disabled')}></div>
          <div class="field span-2"><label>Tên công ty</label><input name="companyName" value="${a.companyName || ''}" ${can('manageConfig') ? '' : raw('disabled')}></div>
          <div class="field span-2"><label>Địa chỉ</label><input name="companyAddress" value="${a.companyAddress || ''}" ${can('manageConfig') ? '' : raw('disabled')}></div>
          <div class="field"><label>Màu chủ đạo</label><input type="text" name="primary" value="${a.theme?.primary || '#0b6b5d'}" ${can('manageConfig') ? '' : raw('disabled')}><span class="color-swatch" style="background:${a.theme?.primary || '#0b6b5d'}"></span></div>
          <div class="field"><label>Kỳ mặc định</label><select name="defaultPeriodId" ${can('manageConfig') ? '' : raw('disabled')}>${options(Object.entries(ctx.periods).map(([id, p]) => ({ value: id, label: p.name })), a.defaultPeriodId, { placeholder: '— Tự chọn kỳ đang mở —' })}</select></div>
          <div class="field span-2"><label class="check"><input type="checkbox" name="configWarningsVisibleToAdmins" ${a.configWarningsVisibleToAdmins !== false ? raw('checked') : ''}> Hiển thị cảnh báo cấu hình thiếu cho quản trị viên</label></div>
        </div>${can('manageConfig') ? html`<div class="card-footer row end"><button type="button" class="btn primary" data-save-app>Lưu</button></div>` : ''}</form>
        <div class="card"><div class="card-header"><h3>Đăng nhập demo</h3></div><div class="card-body stack">
          <div>Trạng thái danh sách chọn nhanh tài khoản demo trên trang đăng nhập: <b>${demoEnabled === null ? '…' : demoEnabled ? 'Đang bật' : 'Đang tắt'}</b></div>
          <div class="small muted">Danh sách chỉ chứa tên, chức danh, đơn vị, vai trò, email – không chứa mật khẩu. Nên tắt khi triển khai chính thức (dữ liệu này đọc được khi chưa đăng nhập).</div>
          ${can('manageUsers') ? html`<button class="btn" data-toggle-demo>${demoEnabled ? 'Tắt danh sách demo' : 'Bật danh sách demo'}</button>` : ''}
          <hr class="divider"><h4>Thông tin kỹ thuật</h4>
          ${kv([['Phiên bản dữ liệu', ctx.config.schemaVersion || '1'], ['Người dùng hiện tại', `${ctx.profile?.name} (${ctx.userId})`], ['Firebase Auth UID', ctx.authUser?.uid], ['Listener đang hoạt động', listenerCount()]])}
        </div></div>
      </div>
      ${isSysAdmin() || can('seedData') ? html`<div class="card mt-3"><div class="card-header"><h3>Bảo trì & khởi tạo dữ liệu demo</h3></div><div class="card-body" id="maint"></div></div>` : ''}
      <div class="card mt-3"><div class="card-header"><h3>Kiểm thử bảo mật</h3></div><div class="card-body small">
        <p>Quyền truy cập dữ liệu được thực thi bởi <span class="kbd">database.rules.json</span> (mặc định từ chối). Xem README mục "Kiểm thử Rules" để chạy bộ kịch bản tự động bằng Firebase Emulator, hoặc dùng Rules Playground trong Firebase Console với ví dụ có sẵn.</p>
      </div></div>`);
    const m = page.querySelector('#maint');
    if (m) maintenancePanel(m);
  };
  on(page, 'click', '[data-save-app]', (e, el) => busy(el, async () => {
    const f = formValues(page.querySelector('#app-form'));
    if (f.primary && !/^#[0-9a-f]{6}$/i.test(f.primary)) { toast('Mã màu phải dạng #RRGGBB.', 'error'); return; }
    try {
      await write({
        'config/appSettings/appName': f.appName, 'config/appSettings/companyName': f.companyName, 'config/appSettings/companyAddress': f.companyAddress,
        'config/appSettings/theme/primary': f.primary, 'config/appSettings/defaultPeriodId': f.defaultPeriodId || null, 'config/appSettings/configWarningsVisibleToAdmins': !!f.configWarningsVisibleToAdmins,
        'public/branding': { appName: f.appName, companyName: f.companyName },
        ...auditUpdate({ type: 'app_settings_change', entity: 'config', entityId: 'appSettings' }),
      });
      toast('Đã lưu cấu hình ứng dụng.');
    } catch (err) { toast(mapError(err), 'error'); }
  }));
  on(page, 'click', '[data-toggle-demo]', (e, el) => busy(el, async () => {
    try { await write({ 'public/demoEnabled': !demoEnabled, ...auditUpdate({ type: 'demo_login_toggle', entity: 'public', entityId: 'demoEnabled', after: { enabled: !demoEnabled } }) }); toast('Đã cập nhật.'); } catch (err) { toast(mapError(err), 'error'); }
  }));
  listen('public/demoEnabled', (v) => { demoEnabled = !!v; draw(); }, { key: 'sys-demo' });
  draw();
}

export const routes = [
  { path: '/admin/audit', title: 'Lịch sử thao tác', allow: () => can('viewAudit'), render: auditPage },
  { path: '/admin/system', title: 'Cấu hình & dữ liệu', allow: () => isSysAdmin() || can('manageConfig') || can('seedData'), render: systemPage },
];
