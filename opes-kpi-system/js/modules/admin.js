/**
 * Quản trị: người dùng (hồ sơ nhân sự, liên kết tài khoản, vai trò) và ma trận phân quyền.
 */
import { listen, mapError, write, NOW, auditUpdate, newKey } from '../services/database.service.js';
import { ctx, nameOf } from '../state.js';
import { can, isSysAdmin } from '../permissions.js';
import { html, render, ui, fmt, toast, busy, confirmDialog, openModal, mountPage, on, formValues, raw, matches, isValidKey, clone } from '../utils.js';
import { pageHead, options, userCell } from '../components.js';
import { badge, roleLabel, titleGroupLabel, sortedDict } from '../labels.js';
import { icon } from '../icons.js';
import { saveProfile, saveAccess, applyMatrixToAll, unlinkAccount, provisionAuthAccounts, computePerms } from '../services/user.service.js';
import { unitOptions, profilesSorted } from '../services/organization.service.js';
import { activeFirebaseConfig } from '../services/firebase.js';

function profileForm(id, p, demo) {
  return html`<form id="user-form" class="form-grid" novalidate>
    <div class="field"><label class="req">Mã nhân viên</label><input name="employeeCode" value="${p.employeeCode || ''}"></div>
    <div class="field"><label class="req">Họ và tên</label><input name="name" value="${p.name || ''}"></div>
    <div class="field"><label class="req">Email đăng nhập</label><input type="email" name="email" value="${p.email || ''}"><span class="help">Phải trùng email tài khoản Firebase Authentication.</span></div>
    <div class="field"><label class="req">Chức danh</label><input name="title" value="${p.title || ''}"></div>
    <div class="field"><label>Nhóm chức danh</label><select name="titleGroup">${options(sortedDict(ctx.config.appSettings?.titleGroups || {}).map(([k, g]) => ({ value: k, label: g.label })), p.titleGroup, { placeholder: '—' })}</select></div>
    <div class="field"><label class="req">Đơn vị chính</label><select name="unitId">${options(unitOptions().map((u) => ({ value: u.id, label: u.label })), p.unitId, { placeholder: '— Chọn —' })}</select></div>
    <div class="field"><label>Quản lý trực tiếp</label><select name="managerId">${options(profilesSorted().filter((x) => x.id !== id).map((x) => ({ value: x.id, label: `${x.name} – ${x.title || ''}` })), p.managerId, { placeholder: '— Không có (cấp cao nhất) —' })}</select></div>
    <div class="field"><label>Quản lý trên một cấp</label><select name="skipManagerId">${options(profilesSorted().filter((x) => x.id !== id).map((x) => ({ value: x.id, label: `${x.name} – ${x.title || ''}` })), p.skipManagerId, { placeholder: '— Mặc định: quản lý của quản lý trực tiếp —' })}</select></div>
    <div class="field"><label>Trạng thái</label><select name="status">${options([{ value: 'active', label: 'Đang hoạt động' }, { value: 'inactive', label: 'Ngừng hoạt động' }], p.status || 'active')}</select></div>
    <div class="field"><label class="check"><input type="checkbox" name="evaluationExempt" ${p.evaluationExempt ? raw('checked') : ''}> Không tham gia đánh giá KPI/KBI</label><span class="help">Dùng cho tài khoản hệ thống/kiểm soát – không đưa vào danh sách nhân sự khi khởi tạo kỳ.</span></div>
    <div class="field"><label class="check"><input type="checkbox" name="demo" ${demo ? raw('checked') : ''}> Hiển thị trong danh sách đăng nhập demo</label><input name="roleLabel" placeholder="Nhãn vai trò hiển thị" value="${demo?.roleLabel || ''}"><input type="number" name="demoOrder" placeholder="Thứ tự" value="${demo?.order ?? ''}"></div>
    <div class="span-2 small muted">Thay đổi quan hệ quản lý chỉ áp dụng cho kỳ đánh giá khi HR khởi tạo/cập nhật danh sách nhân sự của kỳ (mỗi kỳ lưu bản chụp riêng).</div>
    <div class="span-2" id="user-err"></div>
  </form>`;
}

function openProfile(id, demoOptions) {
  const prev = id ? ctx.profiles[id] : null;
  const demo = id ? demoOptions?.[id] : null;
  openModal({
    title: id ? `Hồ sơ – ${prev.name}` : 'Thêm người dùng', size: 'lg', body: profileForm(id, prev || {}, demo),
    actions: [{ label: 'Hủy', value: null }, {
      label: 'Lưu', kind: 'primary', onClick: async ({ el, close }) => {
        const f = formValues(el.querySelector('#user-form'));
        const errs = [];
        ['employeeCode', 'name', 'email', 'title', 'unitId'].forEach((k) => { if (!String(f[k] || '').trim()) errs.push(`Thiếu ${({ employeeCode: 'mã nhân viên', name: 'họ tên', email: 'email', title: 'chức danh', unitId: 'đơn vị' })[k]}.`); });
        if (f.email && (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email) || /[#$\[\]\/]/.test(f.email))) errs.push('Email không hợp lệ.');
        const dup = Object.entries(ctx.profiles).find(([uid, p]) => uid !== id && p.email === f.email.trim().toLowerCase());
        if (dup) errs.push(`Email đã dùng cho ${dup[1].name}.`);
        const dupCode = Object.entries(ctx.profiles).find(([uid, p]) => uid !== id && p.employeeCode === f.employeeCode.trim());
        if (dupCode) errs.push(`Mã nhân viên đã dùng cho ${dupCode[1].name}.`);
        if (errs.length) { render(el.querySelector('#user-err'), html`<div class="alert danger"><ul>${errs.map((x) => html`<li>${x}</li>`)}</ul></div>`); return false; }
        const uid = id || `u_${newKey('userProfiles').toLowerCase().replace(/[^a-z0-9]/g, '')}`;
        if (!isValidKey(uid)) return false;
        const data = { employeeCode: f.employeeCode.trim(), name: f.name.trim(), email: f.email.trim(), title: f.title.trim(), titleGroup: f.titleGroup || null, unitId: f.unitId, managerId: f.managerId || null, skipManagerId: f.skipManagerId || null, status: f.status, evaluationExempt: f.evaluationExempt ? true : null };
        const demoOption = f.demo ? { roleLabel: f.roleLabel || '', order: Number(f.demoOrder) || 99, unitName: ctx.units[f.unitId]?.name || '', ...(demo?.authUid ? { authUid: demo.authUid } : {}) } : (demo ? null : undefined);
        try {
          await saveProfile(uid, data, { previous: prev, demoOption });
          if (!id && isSysAdmin()) await saveAccess(uid, { employee: true }, null, 'Vai trò mặc định khi tạo người dùng');
          toast('Đã lưu hồ sơ người dùng.');
          close(true);
        } catch (e) { render(el.querySelector('#user-err'), html`<div class="alert danger"><div>${mapError(e)}</div></div>`); }
        return true;
      },
    }],
  });
}

function openRoles(id, access) {
  const roles = sortedDict(ctx.config.appSettings?.roles || {});
  const cur = access?.roles || {};
  const editable = isSysAdmin();
  openModal({
    title: `Vai trò – ${ctx.profiles[id]?.name}`, size: 'lg',
    body: html`<form id="role-form" class="stack">${!editable ? html`<div class="alert info"><div>Chỉ System Admin được thay đổi vai trò (Database Rules).</div></div>` : ''}
      ${roles.map(([r, def]) => html`<label class="check" style="align-items:flex-start"><input type="checkbox" name="roles" value="${r}" data-group="1" ${cur[r] ? raw('checked') : ''} ${editable ? '' : raw('disabled')}><span><b>${def.label}</b><div class="small muted">${def.description || ''}</div></span></label>`)}
      <div class="field"><label>Lý do</label><input name="reason"></div>
      <div><b>Quyền hiệu lực hiện tại:</b><div class="pill-list mt-1">${Object.keys(access?.perms || {}).map((p) => html`<span class="chip">${ctx.config.appSettings?.actions?.[p]?.label || p}</span>`)}</div></div></form>`,
    actions: editable ? [{ label: 'Hủy', value: null }, { label: 'Lưu vai trò', kind: 'primary', onClick: async ({ el, close }) => {
      const f = formValues(el.querySelector('#role-form'));
      try { await saveAccess(id, f.roles || {}, access, f.reason); toast('Đã cập nhật vai trò.'); close(true); } catch (e) { toast(mapError(e), 'error'); }
      return true;
    } }] : [{ label: 'Đóng', value: null }],
  });
}

function openProvision(rows) {
  const candidates = rows.filter((r) => !r.authUid && r.status === 'active');
  openModal({
    title: 'Tạo tài khoản Firebase Authentication (provision demo)', size: 'lg',
    body: html`<div class="stack">
      <div class="alert warning"><div>Công cụ hỗ trợ POC: tạo tài khoản Email/Password bằng Firebase Auth SDK trên trình duyệt (App phụ – không ảnh hưởng phiên của bạn). Yêu cầu bật <b>Email/Password</b> và <b>cho phép đăng ký (sign-up)</b> trong Firebase Console; nên tắt sign-up sau khi tạo xong. Tài khoản mới không có quyền gì cho tới khi tự liên kết với hồ sơ cùng email (Rules kiểm tra). Mật khẩu không được lưu.</div></div>
      <div class="small muted">Dự án: <span class="mono">${activeFirebaseConfig.projectId}</span></div>
      <div class="field"><label class="req">Mật khẩu cho các tài khoản được tạo</label><input type="password" id="pv-pass" autocomplete="new-password" placeholder="Nhập mật khẩu POC"></div>
      <div style="max-height:260px;overflow:auto;border:1px solid var(--border);border-radius:6px;padding:6px 10px">
        ${candidates.length ? candidates.map((r) => html`<label class="check" style="display:flex;margin:4px 0"><input type="checkbox" class="pv-user" value="${r.email}" checked> ${r.name} – <span class="mono small">${r.email}</span></label>`) : html`<div class="muted">Mọi hồ sơ đang hoạt động đều đã liên kết tài khoản.</div>`}
      </div><div id="pv-result"></div></div>`,
    actions: [{ label: 'Đóng', value: null }, { label: 'Tạo tài khoản', kind: 'primary', onClick: async ({ el }) => {
      const pass = el.querySelector('#pv-pass').value;
      const emails = [...el.querySelectorAll('.pv-user:checked')].map((x) => x.value);
      if (pass.length < 6) { toast('Mật khẩu tối thiểu 6 ký tự.', 'error'); return false; }
      if (!emails.length) return false;
      const out = el.querySelector('#pv-result');
      render(out, ui.loading('Đang tạo tài khoản…'));
      const res = await provisionAuthAccounts(emails, pass, (n, t) => render(out, ui.loading(`Đã xử lý ${n}/${t}…`)));
      render(out, html`<table class="data mt-2"><thead><tr><th>Email</th><th>Kết quả</th></tr></thead><tbody>${res.map((r) => html`<tr><td class="mono small">${r.email}</td><td>${r.ok ? html`<span class="badge c-green">Đã tạo</span>` : html`<span class="badge ${r.code === 'auth/email-already-in-use' ? 'c-gray' : 'c-red'}">${r.message}</span>`}</td></tr>`)}</tbody></table>
        <div class="small muted mt-1">Mỗi người dùng tự liên kết hồ sơ ở lần đăng nhập đầu tiên.</div>`);
      return false;
    } }],
  });
}

async function usersPage(container) {
  const page = mountPage(container);
  let access = {}, demoOptions = {}, links = {};
  const f = { q: '', status: 'active', unit: '' };
  const draw = () => {
    const rows = profilesSorted().filter((p) => (!f.status || p.status === f.status) && (!f.unit || p.unitId === f.unit) && matches(f.q, p.name, p.email, p.employeeCode, p.title));
    render(page, html`${pageHead({ title: 'Quản lý người dùng', sub: 'Hồ sơ nhân sự, quan hệ quản lý, vai trò và liên kết tài khoản Firebase Authentication', crumbs: [['Quản trị'], ['Người dùng']],
      actions: html`${isSysAdmin() ? html`<button class="btn" data-act="provision">${icon('shield', 16)} Tạo tài khoản Auth (demo)</button>` : ''}<button class="btn primary" data-act="new">${icon('plus', 16)} Thêm người dùng</button>` })}
      <div class="toolbar"><div class="field search"><label>Tìm kiếm</label><input type="search" data-f="q" value="${f.q}" placeholder="Tên, email, mã NV"></div>
        <div class="field"><label>Đơn vị</label><select data-f="unit">${options(unitOptions().map((u) => ({ value: u.id, label: u.label })), f.unit, { placeholder: 'Tất cả' })}</select></div>
        <div class="field"><label>Trạng thái</label><select data-f="status">${options([{ value: 'active', label: 'Đang hoạt động' }, { value: 'inactive', label: 'Ngừng hoạt động' }], f.status, { placeholder: 'Tất cả' })}</select></div></div>
      <div class="table-wrap tall"><table class="data"><thead><tr><th>Mã NV</th><th>Người dùng</th><th>Email</th><th>Đơn vị</th><th>QL trực tiếp</th><th>QL trên 1 cấp</th><th>Vai trò</th><th>Tài khoản Auth</th><th>Demo</th><th>Trạng thái</th><th></th></tr></thead><tbody>
        ${rows.map((p) => html`<tr><td class="mono">${p.employeeCode}</td><td>${userCell(p.id)}</td><td class="small mono">${p.email}</td><td>${ctx.units[p.unitId]?.name || ''}</td>
          <td>${p.managerId ? nameOf(p.managerId) : html`<span class="muted">—</span>`}</td><td>${p.skipManagerId ? nameOf(p.skipManagerId) : html`<span class="muted small">mặc định</span>`}</td>
          <td><div class="pill-list">${Object.keys(access[p.id]?.roles || {}).map((r) => html`<span class="badge c-teal">${roleLabel(r)}</span>`)}</div></td>
          <td class="small">${p.authUid ? html`<span class="badge c-green" title="${p.authUid}">Đã liên kết</span><div class="mono muted">${String(p.authUid).slice(0, 10)}…</div>` : html`<span class="badge c-gray">Chưa đăng nhập</span>`}</td>
          <td>${demoOptions[p.id] ? '✓' : ''}</td><td>${badge('user', p.status)}</td>
          <td class="actions"><button class="btn xs" data-edit="${p.id}">Sửa</button> <button class="btn xs" data-roles="${p.id}">Vai trò</button>${isSysAdmin() && p.authUid ? html` <button class="btn xs outline-danger" data-unlink="${p.id}">Hủy liên kết</button>` : ''}</td></tr>`)}
      </tbody></table></div>`);
  };
  on(page, 'input', '[data-f=q]', (e, el) => { f.q = el.value; const pos = el.selectionStart; draw(); const n = page.querySelector('[data-f=q]'); n.focus(); n.setSelectionRange(pos, pos); });
  on(page, 'change', 'select[data-f]', (e, el) => { f[el.dataset.f] = el.value; draw(); });
  on(page, 'click', '[data-act=new]', () => openProfile(null, demoOptions));
  on(page, 'click', '[data-act=provision]', () => openProvision(profilesSorted()));
  on(page, 'click', '[data-edit]', (e, el) => openProfile(el.dataset.edit, demoOptions));
  on(page, 'click', '[data-roles]', (e, el) => openRoles(el.dataset.roles, access[el.dataset.roles]));
  on(page, 'click', '[data-unlink]', (e, el) => busy(el, async () => {
    const p = ctx.profiles[el.dataset.unlink];
    const r = await confirmDialog({ title: 'Hủy liên kết tài khoản', message: `Tài khoản Firebase Auth của ${p.name} sẽ không còn truy cập dữ liệu cho tới khi liên kết lại (đăng nhập lần sau với cùng email).`, requireReason: true, danger: true });
    if (!r) return;
    try { await unlinkAccount(el.dataset.unlink, p.authUid, r.reason); toast('Đã hủy liên kết.'); } catch (err) { toast(mapError(err), 'error'); }
  }));
  listen('userProfiles', (v) => { ctx.profiles = v || {}; draw(); }, { key: 'admin-profiles' });
  listen('userAccess', (v) => { access = v || {}; draw(); }, { key: 'admin-access', onError: () => {} });
  listen('public/demoLoginOptions', (v) => { demoOptions = v || {}; draw(); }, { key: 'admin-demo', onError: () => {} });
  draw();
  return links;
}

async function rolesPage(container) {
  const page = mountPage(container);
  let matrix = clone(ctx.config.permissionPolicies?.roles || {});
  let access = {};
  let dirty = false;
  const editable = isSysAdmin();
  const draw = () => {
    const roles = sortedDict(ctx.config.appSettings?.roles || {});
    const actions = sortedDict(ctx.config.appSettings?.actions || {});
    const groups = [...new Set(actions.map(([, a]) => a.group || 'Khác'))];
    render(page, html`${pageHead({ title: 'Vai trò & ma trận phân quyền', sub: 'Quyền theo vai trò; quyền theo quan hệ quản lý (trực tiếp, trên 1 cấp, chuỗi quản lý) và trạng thái hồ sơ được Database Rules kiểm tra thêm', crumbs: [['Quản trị'], ['Vai trò & phân quyền']],
      actions: editable ? html`<button class="btn" data-act="apply" title="Tính lại quyền hiệu lực cho toàn bộ người dùng">Áp dụng cho toàn bộ người dùng</button><button class="btn primary" data-act="save" ${dirty ? '' : raw('disabled')}>Lưu ma trận</button>` : '' })}
      ${!editable ? html`<div class="alert info mb-2"><div>Chế độ xem – chỉ System Admin sửa được ma trận phân quyền.</div></div>` : ''}
      ${dirty ? html`<div class="alert warning mb-2"><div>Có thay đổi chưa lưu. Sau khi lưu, bấm "Áp dụng cho toàn bộ người dùng" để cập nhật quyền hiệu lực.</div></div>` : ''}
      <div class="table-wrap tall"><table class="matrix"><thead><tr><th class="rowhead">Chức năng / hành động</th>${roles.map(([r, d]) => html`<th title="${d.description || ''}">${d.label}</th>`)}</tr></thead><tbody>
        ${groups.map((g) => html`<tr><td class="rowhead" colspan="${roles.length + 1}" style="background:#eef3f2;font-weight:700">${g}</td></tr>
          ${actions.filter(([, a]) => (a.group || 'Khác') === g).map(([k, a]) => html`<tr><td class="rowhead">${a.label}<div class="small muted mono">${k}</div></td>${roles.map(([r]) => html`<td><input type="checkbox" data-cell="${r}|${k}" ${matrix[r]?.[k] ? raw('checked') : ''} ${editable ? '' : raw('disabled')}></td>`)}</tr>`)}`)}
        <tr><td class="rowhead">Số người dùng</td>${roles.map(([r]) => html`<td>${Object.values(access).filter((x) => x.roles?.[r]).length}</td>`)}</tr>
      </tbody></table></div>
      <div class="small muted mt-1">Một người dùng có thể có nhiều vai trò – quyền hiệu lực là hợp của các vai trò. Quyền quản trị vai trò & ma trận luôn yêu cầu vai trò System Admin (quy tắc nền tảng trong Rules).</div>`);
  };
  on(page, 'change', '[data-cell]', (e, el) => { const [r, k] = el.dataset.cell.split('|'); matrix[r] ||= {}; if (el.checked) matrix[r][k] = true; else delete matrix[r][k]; dirty = true; draw(); });
  on(page, 'click', '[data-act=save]', (e, el) => busy(el, async () => {
    try {
      await write({ 'config/permissionPolicies/roles': matrix, 'config/permissionPolicies/updatedAt': NOW(), 'config/permissionPolicies/updatedBy': ctx.userId, ...auditUpdate({ type: 'permission_matrix_change', entity: 'permissionPolicies', entityId: 'roles', before: ctx.config.permissionPolicies?.roles || null, after: matrix }) });
      dirty = false; toast('Đã lưu ma trận phân quyền.'); draw();
    } catch (err) { toast(mapError(err), 'error'); }
  }));
  on(page, 'click', '[data-act=apply]', (e, el) => busy(el, async () => {
    const r = await confirmDialog({ title: 'Áp dụng ma trận quyền', message: `Tính lại quyền hiệu lực cho ${Object.keys(access).length} người dùng theo ma trận đã lưu?` });
    if (!r) return;
    try { await applyMatrixToAll(access, ctx.config.permissionPolicies?.roles || matrix); toast('Đã áp dụng ma trận quyền.'); } catch (err) { toast(mapError(err), 'error'); }
  }));
  listen('userAccess', (v) => { access = v || {}; draw(); }, { key: 'roles-access', onError: () => draw() });
  draw();
}

export const routes = [
  { path: '/admin/users', title: 'Người dùng', allow: () => can('manageUsers'), render: usersPage },
  { path: '/admin/roles', title: 'Vai trò & phân quyền', allow: () => isSysAdmin() || can('manageUsers'), render: rolesPage },
];
