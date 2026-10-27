/**
 * Cơ cấu tổ chức OPES: sơ đồ dạng cây và dạng bảng; thêm/sửa/chuyển cấp/ngừng hoạt động/lưu trữ đơn vị;
 * chụp phiên bản cơ cấu. Chỉ người có quyền manageOrg được thay đổi (Rules kiểm tra).
 */
import { mapError, listen } from '../services/database.service.js';
import { ctx, nameOf } from '../state.js';
import { can } from '../permissions.js';
import { html, render, ui, fmt, toast, busy, confirmDialog, openModal, mountPage, on, formValues, raw, matches } from '../utils.js';
import { pageHead, options, tabs, kv } from '../components.js';
import { badge, unitTypeLabel, sortedDict } from '../labels.js';
import { icon } from '../icons.js';
import { buildUnitTree, flatUnits, unitLevel, unitPath, validateUnit, saveUnit, setUnitStatus, snapshotOrgVersion, unitOptions, profilesSorted, unitDescendants } from '../services/organization.service.js';

function unitForm(id, u, parentId = null) {
  const exclude = id ? unitDescendants(id) : new Set();
  return html`<form id="unit-form" class="form-grid" novalidate>
    <div class="field"><label class="req">Mã đơn vị</label><input name="code" value="${u.code || ''}"></div>
    <div class="field"><label class="req">Tên đơn vị</label><input name="name" value="${u.name || ''}"></div>
    <div class="field"><label>Đơn vị cha</label><select name="parentId">${options(unitOptions().filter((o) => !exclude.has(o.id)).map((o) => ({ value: o.id, label: o.label })), u.parentId ?? parentId ?? '', { placeholder: '— Đơn vị gốc —' })}</select></div>
    <div class="field"><label>Loại đơn vị</label><select name="type">${options(sortedDict(ctx.config.appSettings?.unitTypes || {}).map(([k, t]) => ({ value: k, label: t.label })), u.type || 'department')}</select></div>
    <div class="field"><label>Người đứng đầu</label><select name="headId">${options(profilesSorted().map((p) => ({ value: p.id, label: `${p.name} – ${p.title || ''}` })), u.headId, { placeholder: '— Chưa xác định —' })}</select></div>
    <div class="field"><label>Thứ tự hiển thị</label><input type="number" name="order" value="${u.order ?? ''}"></div>
    <div class="field"><label>Hiệu lực từ</label><input type="date" name="effectiveFrom" value="${u.effectiveFrom || ''}"></div>
    <div class="field"><label>Hiệu lực đến</label><input type="date" name="effectiveTo" value="${u.effectiveTo || ''}"></div>
    <div class="field"><label>Trạng thái</label><select name="status">${options([{ value: 'active', label: 'Đang hoạt động' }, { value: 'inactive', label: 'Ngừng hoạt động' }, { value: 'archived', label: 'Lưu trữ' }], u.status || 'active')}</select></div>
    <div class="field span-2"><label>Ghi chú</label><textarea name="note" rows="2">${u.note || ''}</textarea></div>
    <div class="field span-2"><label>Lý do thay đổi</label><input name="reason"></div>
    <div class="span-2" id="unit-err"></div>
  </form>`;
}

function openUnitForm(id, parentId = null) {
  const prev = id ? ctx.units[id] : null;
  openModal({
    title: id ? `Sửa đơn vị – ${prev.name}` : 'Thêm đơn vị', size: 'lg', body: unitForm(id, prev || {}, parentId),
    actions: [{ label: 'Hủy', value: null }, {
      label: 'Lưu', kind: 'primary', onClick: async ({ el, close }) => {
        const f = formValues(el.querySelector('#unit-form'));
        const errs = validateUnit(id, f);
        if (errs.length) { render(el.querySelector('#unit-err'), html`<div class="alert danger"><ul>${errs.map((x) => html`<li>${x}</li>`)}</ul></div>`); return false; }
        if (prev && prev.parentId !== (f.parentId || undefined) && prev.parentId !== f.parentId) {
          const ok = await confirmDialog({ title: 'Chuyển cấp đơn vị', message: `Chuyển "${prev.name}" sang đơn vị cha mới. Lịch sử KPI/đánh giá của các kỳ trước được giữ nguyên theo bản chụp cơ cấu của từng kỳ.` });
          if (!ok) return false;
        }
        try { await saveUnit(id, f, prev, f.reason); toast('Đã lưu đơn vị.'); close(true); } catch (e) { render(el.querySelector('#unit-err'), html`<div class="alert danger"><div>${mapError(e)}</div></div>`); }
        return true;
      },
    }],
  });
}

async function orgPage(container, params, query) {
  const page = mountPage(container);
  let tab = query.view || 'tree';
  let q = '';
  let showArchived = false;
  const collapsed = new Set();
  let versions = {};
  const editable = can('manageOrg');
  const draw = () => {
    const tree = buildUnitTree(ctx.units, { includeArchived: showArchived });
    const members = (id) => Object.values(ctx.profiles).filter((p) => p.unitId === id && p.status === 'active').length;
    const node = (n) => html`<li class="${collapsed.has(n.id) ? 'collapsed' : ''}"><div class="node ${n.status !== 'active' ? 'inactive' : ''}">
        <button class="toggle ${n.children.length ? '' : 'leaf'}" data-toggle="${n.id}">${collapsed.has(n.id) ? '▶' : '▼'}</button>
        <b>${n.name}</b><span class="meta">${n.code} · ${unitTypeLabel(n.type)} · Cấp ${unitLevel(n.id)}</span>
        ${n.headId ? html`<span class="chip">${icon('user', 13)} ${nameOf(n.headId)}</span>` : ''}<span class="meta">${members(n.id)} nhân sự</span>
        ${n.status !== 'active' ? badge('unit', n.status) : ''}
        ${editable ? html`<span class="btn-group no-print"><button class="btn xs" data-add="${n.id}">+ Đơn vị con</button><button class="btn xs" data-edit="${n.id}">Sửa</button>${n.status === 'active' ? html`<button class="btn xs" data-deact="${n.id}">Ngừng</button>` : html`<button class="btn xs" data-act-unit="${n.id}">Kích hoạt</button>`}</span>` : ''}
      </div>${n.children.length ? html`<ul>${n.children.map(node)}</ul>` : ''}</li>`;
    const flat = flatUnits(ctx.units).filter((u) => (showArchived || u.status !== 'archived') && matches(q, u.code, u.name));
    const vlist = Object.entries(versions).map(([id, v]) => ({ id, ...v })).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    render(page, html`${pageHead({ title: 'Cơ cấu tổ chức', sub: 'Đơn vị gốc của chuỗi KPI TOP-DOWN: Phó Tổng Giám đốc thường trực. Số cấp tổ chức không cố định.', crumbs: [['Quản trị'], ['Cơ cấu tổ chức']],
      actions: editable ? html`<button class="btn" data-act="snapshot">${icon('copy', 16)} Chụp phiên bản cơ cấu</button><button class="btn primary" data-add="">${icon('plus', 16)} Thêm đơn vị</button>` : '' })}
      ${!editable ? html`<div class="alert info mb-2"><div>Bạn đang xem ở chế độ chỉ đọc.</div></div>` : ''}
      ${tabs([{ id: 'tree', label: 'Sơ đồ cây' }, { id: 'table', label: 'Dạng bảng', count: flat.length }, { id: 'versions', label: 'Phiên bản cơ cấu', count: vlist.length }], tab)}
      <div class="toolbar"><div class="field search"><label>Tìm đơn vị</label><input type="search" id="org-q" value="${q}"></div><label class="check" style="margin-bottom:8px"><input type="checkbox" id="org-arch" ${showArchived ? raw('checked') : ''}> Hiện đơn vị đã lưu trữ</label></div>
      ${tab === 'tree' ? html`<div class="card"><div class="card-body"><ul class="tree">${tree.map(node)}</ul></div></div>` : ''}
      ${tab === 'table' ? html`<div class="table-wrap tall"><table class="data"><thead><tr><th>Mã</th><th>Tên đơn vị</th><th>Đơn vị cha</th><th>Loại</th><th class="num">Cấp</th><th>Người đứng đầu</th><th class="num">Nhân sự</th><th>Hiệu lực</th><th>Trạng thái</th><th></th></tr></thead><tbody>
        ${flat.map((u) => html`<tr><td class="mono">${u.code}</td><td>${raw('&nbsp;'.repeat(u.depth * 3))}${u.name}</td><td>${u.parentId ? ctx.units[u.parentId]?.name : '—'}</td><td>${unitTypeLabel(u.type)}</td><td class="num">${u.depth + 1}</td>
          <td>${u.headId ? nameOf(u.headId) : ''}</td><td class="num">${members(u.id)}</td><td class="small">${fmt.date(u.effectiveFrom)}${u.effectiveTo ? ` – ${fmt.date(u.effectiveTo)}` : ''}</td><td>${badge('unit', u.status)}</td>
          <td class="actions">${editable ? html`<button class="btn xs" data-edit="${u.id}">Sửa</button> ${u.status !== 'archived' ? html`<button class="btn xs" data-archive="${u.id}">Lưu trữ</button>` : ''}` : ''}</td></tr>`)}
      </tbody></table></div>` : ''}
      ${tab === 'versions' ? html`<div class="table-wrap"><table class="data"><thead><tr><th>Tên phiên bản</th><th>Kỳ áp dụng</th><th class="num">Số đơn vị</th><th class="num">Quan hệ quản lý</th><th>Người tạo</th><th>Thời điểm</th><th></th></tr></thead><tbody>
        ${vlist.length ? vlist.map((v) => html`<tr><td>${v.name}</td><td>${v.periodId ? ctx.periods[v.periodId]?.name || v.periodId : '—'}</td><td class="num">${Object.keys(v.units || {}).length}</td><td class="num">${Object.keys(v.reporting || {}).length}</td><td>${nameOf(v.createdBy)}</td><td>${fmt.datetime(v.createdAt)}</td><td class="actions"><button class="btn xs" data-ver="${v.id}">Xem</button></td></tr>`) : html`<tr><td colspan="7">${ui.empty('Chưa có phiên bản.')}</td></tr>`}
      </tbody></table></div><div class="small muted mt-1">Mỗi kỳ đánh giá lưu phiên bản cơ cấu và quan hệ quản lý tại thời điểm khởi tạo – thay đổi tổ chức sau này không làm mất lịch sử.</div>` : ''}`);
  };
  const guard = (fn) => (e, el) => busy(el, async () => { try { await fn(el); } catch (err) { toast(mapError(err), 'error'); } });
  on(page, 'click', '[data-tab]', (e, el) => { tab = el.dataset.tab; draw(); });
  on(page, 'input', '#org-q', (e, el) => { q = el.value; tab = tab === 'tree' ? 'table' : tab; const pos = el.selectionStart; draw(); const n = page.querySelector('#org-q'); n.focus(); n.setSelectionRange(pos, pos); });
  on(page, 'change', '#org-arch', (e, el) => { showArchived = el.checked; draw(); });
  on(page, 'click', '[data-toggle]', (e, el) => { const k = el.dataset.toggle; if (collapsed.has(k)) collapsed.delete(k); else collapsed.add(k); draw(); });
  on(page, 'click', '[data-add]', (e, el) => openUnitForm(null, el.dataset.add || null));
  on(page, 'click', '[data-edit]', (e, el) => openUnitForm(el.dataset.edit));
  on(page, 'click', '[data-deact]', guard(async (el) => {
    const u = ctx.units[el.dataset.deact];
    const active = Object.values(ctx.profiles).filter((p) => p.unitId === el.dataset.deact && p.status === 'active').length;
    const r = await confirmDialog({ title: 'Ngừng hoạt động đơn vị', message: `${u.name}${active ? ` đang có ${active} nhân sự – cần điều chuyển nhân sự trước khi khởi tạo kỳ mới.` : ''}`, requireReason: true });
    if (r) await setUnitStatus(el.dataset.deact, u, 'inactive', r.reason);
  }));
  on(page, 'click', '[data-act-unit]', guard(async (el) => { const u = ctx.units[el.dataset.actUnit]; await setUnitStatus(el.dataset.actUnit, u, 'active', 'Kích hoạt lại'); }));
  on(page, 'click', '[data-archive]', guard(async (el) => {
    const u = ctx.units[el.dataset.archive];
    const r = await confirmDialog({ title: 'Lưu trữ đơn vị', message: `${u.name} sẽ ẩn khỏi danh sách chọn. Dữ liệu lịch sử vẫn được giữ.`, requireReason: true });
    if (r) await setUnitStatus(el.dataset.archive, u, 'archived', r.reason);
  }));
  on(page, 'click', '[data-act=snapshot]', guard(async () => {
    const r = await confirmDialog({ title: 'Chụp phiên bản cơ cấu', message: 'Lưu bản chụp cây đơn vị và quan hệ quản lý hiện hành.', requireReason: true, reasonLabel: 'Tên phiên bản' });
    if (r) { await snapshotOrgVersion(r.reason); toast('Đã lưu phiên bản cơ cấu.'); }
  }));
  on(page, 'click', '[data-ver]', (e, el) => {
    const v = versions[el.dataset.ver];
    openModal({ title: v.name, drawer: true, body: html`${kv([['Kỳ', v.periodId || '—'], ['Tạo bởi', nameOf(v.createdBy)], ['Thời điểm', fmt.datetime(v.createdAt)]])}
      <h4 class="mt-2">Đơn vị</h4><ul class="list-plain">${flatUnits(v.units || {}).map((u) => html`<li>${raw('&nbsp;'.repeat(u.depth * 3))}${u.name} <span class="muted small">${u.code}</span></li>`)}</ul>` });
  });
  listen('organizationUnits', (v) => { ctx.units = v || {}; draw(); }, { key: 'org-units' });
  listen('organizationVersions', (v) => { versions = v || {}; if (tab === 'versions') draw(); }, { key: 'org-versions' });
  draw();
}

export const routes = [{ path: '/admin/org', title: 'Cơ cấu tổ chức', render: orgPage }];
