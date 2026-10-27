/**
 * Kho danh mục KPI: tìm kiếm/lọc, tạo – sửa – sao chép – phiên bản mới, Public/Private & cấp quyền,
 * ngừng sử dụng/lưu trữ, lịch sử chỉnh sửa, các kế hoạch đang dùng KPI; quản lý nhóm KPI.
 */
import { mapError } from '../services/database.service.js';
import { ctx, nameOf } from '../state.js';
import { can } from '../permissions.js';
import { html, render, ui, fmt, toast, busy, confirmDialog, openModal, mountPage, on, formValues, raw, matches, multiline } from '../utils.js';
import { pageHead, options, kv, tabs } from '../components.js';
import { badge, groupName, policyName, directionLabel, sortedDict, demoBadge, titleGroupLabel } from '../labels.js';
import { icon } from '../icons.js';
import { watchCatalog, catalogList, saveKpi, newVersion, copyKpi, setKpiStatus, deleteKpi, findUsage, readHistory, saveGroup, scopeLabel } from '../services/catalog.service.js';
import { unitOptions, profilesSorted } from '../services/organization.service.js';
import { numOrNull } from '../utils.js';

export function checkList(name, items, selected = {}, { height = 180, search = true } = {}) {
  return html`<div class="check-list" data-checklist="${name}">
    ${search ? html`<input type="search" class="sm mb-1" placeholder="Lọc…" data-cl-filter>` : ''}
    <div style="max-height:${height}px;overflow:auto;border:1px solid var(--border);border-radius:6px;padding:6px 8px">
      ${items.map((o) => html`<label class="check" style="display:flex;margin:3px 0" data-cl-item="${o.label}"><input type="checkbox" name="${name}" value="${o.value}" data-group="1" ${selected?.[o.value] ? raw('checked') : ''}> ${o.label}</label>`)}
    </div></div>`;
}
export function wireCheckLists(root) {
  root.querySelectorAll('[data-cl-filter]').forEach((inp) => inp.addEventListener('input', () => {
    const q = inp.value.toLowerCase();
    inp.closest('[data-checklist]').querySelectorAll('[data-cl-item]').forEach((l) => { l.style.display = !q || l.dataset.clItem.toLowerCase().includes(q) ? 'flex' : 'none'; });
  }));
}

function kpiForm(k = {}, { canPublic }) {
  const t = k.targets || {};
  const a = k.appliesTo || { scope: 'company' };
  const scoring = ctx.config.scoringPolicies || {};
  const lv = k.levelDescriptions || {};
  return html`<form id="kpi-form" class="stack" novalidate>
    <div class="form-grid cols-3">
      <div class="field"><label class="req">Mã KPI</label><input name="code" value="${k.code || ''}"></div>
      <div class="field" style="grid-column:span 2"><label class="req">Tên chỉ tiêu</label><input name="name" value="${k.name || ''}"></div>
      <div class="field"><label class="req">Nhóm chỉ tiêu</label><select name="groupId">${options(sortedDict(ctx.config.kpiGroups).map(([id, g]) => ({ value: id, label: g.name + (g.status === 'inactive' ? ' (ngừng)' : '') })), k.groupId, { placeholder: '— Chọn —' })}</select></div>
      <div class="field"><label class="req">Phân loại</label><select name="visibility">${options([...(canPublic ? [{ value: 'public', label: 'Public – mọi người trong phạm vi được chọn' }] : []), { value: 'private', label: 'Private – chỉ người được cấp quyền' }], k.visibility || (canPublic ? 'public' : 'private'))}</select></div>
      <div class="field"><label>Trạng thái</label><select name="status">${options([{ value: 'active', label: 'Đang sử dụng' }, { value: 'inactive', label: 'Ngừng sử dụng' }, { value: 'archived', label: 'Lưu trữ' }], k.status || 'active')}</select></div>
    </div>
    <div class="form-grid">
      <div class="field span-2"><label>Mô tả mục tiêu và ý nghĩa</label><textarea name="description">${k.description || ''}</textarea></div>
      <div class="field"><label>Định nghĩa chi tiết</label><textarea name="definition">${k.definition || ''}</textarea></div>
      <div class="field"><label>Nội dung đo lường</label><textarea name="measurement">${k.measurement || ''}</textarea></div>
    </div>
    <div class="form-grid cols-4">
      <div class="field"><label>Đơn vị đo</label><input name="unit" value="${k.unit || ''}"></div>
      <div class="field"><label>Chiều đánh giá</label><select name="direction">${options(sortedDict(ctx.config.appSettings?.kpiDirections || {}).map(([id, d]) => ({ value: id, label: d.label })), k.direction || 'higher')}</select></div>
      <div class="field"><label>Chu kỳ đo lường</label><select name="frequency">${options(sortedDict(ctx.config.appSettings?.frequencies || {}).map(([id, d]) => ({ value: id, label: d.label })), k.frequency || 'year')}</select></div>
      <div class="field"><label>Phương pháp thu thập số liệu</label><input name="dataSource" value="${k.dataSource || ''}"></div>
      <div class="field" style="grid-column:span 2"><label class="req">Phương pháp tính điểm</label><select name="scoringPolicyId">${options(Object.entries(scoring).map(([id, p]) => ({ value: id, label: `${p.name}${p.isDemo ? ' (demo)' : ''}` })), k.scoringPolicyId, { placeholder: '— Chọn —' })}</select></div>
      <div class="field"><label>Trọng số mặc định (%)</label><input type="number" name="defaultWeight" value="${k.defaultWeight ?? ''}"></div>
      <div class="field"><label>Tỷ trọng tối thiểu (%)</label><input type="number" name="minWeight" value="${k.minWeight ?? ''}"></div>
      <div class="field"><label>Mục tiêu mẫu – Ngưỡng</label><input type="number" step="any" name="threshold" value="${t.threshold ?? ''}"></div>
      <div class="field"><label>Cơ bản</label><input type="number" step="any" name="base" value="${t.base ?? ''}"></div>
      <div class="field"><label>Đẩy mạnh</label><input type="number" step="any" name="stretch" value="${t.stretch ?? ''}"></div>
      <div class="field"><label>Ngày hiệu lực</label><input type="date" name="effectiveFrom" value="${k.effectiveFrom || ''}"></div>
      <div class="field span-2" style="grid-column:1/-1"><label>Công thức quy đổi / ghi chú tính điểm</label><input name="conversionNote" value="${k.conversionNote || ''}"></div>
    </div>
    <details ${Object.keys(lv).length ? raw('open') : ''}><summary><b>Mô tả các mức (chỉ tiêu định tính)</b></summary><div class="form-grid mt-1">${[1, 2, 3, 4, 5].map((l) => html`<div class="field"><label>Mức ${l}</label><textarea rows="2" name="level${l}">${lv[l] || ''}</textarea></div>`)}</div></details>
    <div class="form-grid">
      <div class="field"><label class="check"><input type="checkbox" name="evidenceRequired" ${k.evidenceRequired ? raw('checked') : ''}> Yêu cầu minh chứng</label><input name="evidenceNote" placeholder="Loại minh chứng" value="${k.evidenceNote || ''}"></div>
      <div class="field"><label>Đối tượng áp dụng</label><select name="scope">${options([{ value: 'company', label: 'Toàn công ty' }, { value: 'units', label: 'Nhóm đơn vị' }, { value: 'titleGroups', label: 'Nhóm chức danh' }, { value: 'managers', label: 'Cấp quản lý' }, { value: 'users', label: 'Cá nhân cụ thể' }], a.scope)}</select></div>
      <div class="field" data-scope-part="units"><label>Đơn vị áp dụng (bao gồm đơn vị con)</label>${checkList('unitIds', unitOptions().map((u) => ({ value: u.id, label: u.label })), a.unitIds)}</div>
      <div class="field" data-scope-part="titleGroups"><label>Nhóm chức danh</label>${checkList('titleGroups', sortedDict(ctx.config.appSettings?.titleGroups || {}).map(([id, g]) => ({ value: id, label: g.label })), a.titleGroups, { search: false })}</div>
      <div class="field" data-scope-part="users"><label>Cá nhân áp dụng</label>${checkList('userIds', profilesSorted().map((p) => ({ value: p.id, label: `${p.name} – ${p.title || ''}` })), a.userIds)}</div>
      <div class="field" data-private-part><label>Người được xem/chọn (KPI Private)</label>${checkList('allowedUsers', profilesSorted().map((p) => ({ value: p.id, label: `${p.name} – ${p.title || ''}` })), k.allowedUsers)}<span class="help">Chủ sở hữu luôn có quyền. Quyền được kiểm soát bởi Database Rules (chỉ mục kpiCatalogAccessIndex).</span></div>
      ${can('manageCatalog') ? html`<div class="field"><label>Chủ sở hữu KPI</label><select name="ownerId">${options(profilesSorted().map((p) => ({ value: p.id, label: p.name })), k.ownerId || ctx.userId)}</select></div>` : ''}
    </div>
    <div class="field"><label>Lý do / ghi chú thay đổi</label><input name="reason" placeholder="Ghi vào lịch sử chỉnh sửa"></div>
    <div id="kpi-err"></div>
  </form>`;
}

function readKpiForm(el, prev) {
  const f = formValues(el.querySelector('#kpi-form'));
  const errs = [];
  if (!f.code?.trim()) errs.push('Nhập mã KPI.');
  if (!f.name?.trim()) errs.push('Nhập tên chỉ tiêu.');
  if (!f.groupId) errs.push('Chọn nhóm.');
  if (!f.scoringPolicyId) errs.push('Chọn phương pháp tính điểm.');
  const levels = {};
  [1, 2, 3, 4, 5].forEach((l) => { if (f[`level${l}`]?.trim()) levels[l] = f[`level${l}`].trim(); });
  const targets = {};
  ['threshold', 'base', 'stretch'].forEach((k) => { const v = numOrNull(f[k]); if (v !== null) targets[k] = v; });
  const scope = f.scope || 'company';
  const appliesTo = { scope, ...(scope === 'units' ? { unitIds: f.unitIds || {} } : {}), ...(scope === 'titleGroups' ? { titleGroups: f.titleGroups || {} } : {}), ...(scope === 'users' ? { userIds: f.userIds || {} } : {}) };
  const data = {
    code: f.code?.trim(), name: f.name?.trim(), groupId: f.groupId, visibility: f.visibility, status: f.status, description: f.description, definition: f.definition,
    measurement: f.measurement, unit: f.unit, direction: f.direction, frequency: f.frequency, dataSource: f.dataSource, scoringPolicyId: f.scoringPolicyId,
    defaultWeight: numOrNull(f.defaultWeight), minWeight: numOrNull(f.minWeight), targets, effectiveFrom: f.effectiveFrom || null, conversionNote: f.conversionNote,
    levelDescriptions: Object.keys(levels).length ? levels : null, evidenceRequired: !!f.evidenceRequired, evidenceNote: f.evidenceNote, appliesTo,
    allowedUsers: f.visibility === 'private' ? f.allowedUsers || {} : null, ownerId: f.ownerId || prev?.ownerId || ctx.userId, version: prev?.version || 1,
  };
  const dup = catalogState.list.find((x) => x.code?.toLowerCase() === data.code?.toLowerCase() && x.id !== prev?.id && x.status !== 'archived');
  if (dup) errs.push(`Mã ${data.code} đã tồn tại (${dup.name}).`);
  return { data, errs, reason: f.reason };
}

const catalogState = { list: [] };

function openKpiForm(k = null) {
  const canPublic = can('manageCatalog');
  if (k && k.visibility === 'public' && !canPublic) { toast('Bạn không có quyền sửa KPI Public.', 'error'); return; }
  openModal({
    title: k ? `Sửa KPI ${k.code}` : 'Tạo KPI mới', size: 'xl', body: kpiForm(k || {}, { canPublic }),
    actions: [{ label: 'Hủy', value: null }, {
      label: 'Lưu KPI', kind: 'primary', onClick: async ({ el, close }) => {
        const { data, errs, reason } = readKpiForm(el, k);
        if (errs.length) { render(el.querySelector('#kpi-err'), html`<div class="alert danger"><ul>${errs.map((x) => html`<li>${x}</li>`)}</ul></div>`); return false; }
        try {
          await saveKpi({ id: k?.id, data, previous: k, reason });
          toast('Đã lưu KPI vào kho.');
          close(true);
        } catch (e) { render(el.querySelector('#kpi-err'), html`<div class="alert danger"><div>${mapError(e)}</div></div>`); }
        return true;
      },
    }],
    onMount: (b) => {
      wireCheckLists(b);
      const sync = () => {
        const sc = b.querySelector('[name=scope]').value;
        b.querySelectorAll('[data-scope-part]').forEach((x) => { x.style.display = x.dataset.scopePart === sc ? '' : 'none'; });
        b.querySelector('[data-private-part]').style.display = b.querySelector('[name=visibility]').value === 'private' ? '' : 'none';
      };
      b.querySelector('[name=scope]').addEventListener('change', sync);
      b.querySelector('[name=visibility]').addEventListener('change', sync);
      sync();
    },
  });
}

function canEdit(k) {
  return can('manageCatalog') || (k.visibility === 'private' && k.ownerId === ctx.userId && can('createPrivateKpi'));
}

async function showDetail(k) {
  const m = openModal({ title: `${k.code} – ${k.name}`, drawer: true, body: ui.loading(), actions: [{ label: 'Đóng', value: null }] });
  const [hist, usage] = await Promise.all([readHistory(k.id).catch(() => null), canEdit(k) ? findUsage(k.id).catch(() => null) : Promise.resolve(null)]);
  const p = ctx.config.scoringPolicies?.[k.scoringPolicyId];
  render(m.body, html`<div class="stack">
    <div class="row">${badge('catalog', k.status)}${k.visibility === 'private' ? html`<span class="badge c-purple">Private</span>` : html`<span class="badge c-blue">Public</span>`}<span class="badge c-gray">Phiên bản ${k.version || 1}</span></div>
    ${kv([
      ['Nhóm', groupName(k.groupId)], ['Mô tả', k.description ? multiline(k.description) : ''], ['Định nghĩa', k.definition ? multiline(k.definition) : ''],
      ['Đo lường', k.measurement ? multiline(k.measurement) : ''], ['Đơn vị đo', k.unit], ['Chiều đánh giá', directionLabel(k.direction)],
      ['Phương pháp tính', p ? html`${p.name} ${demoBadge(p.isDemo)}` : policyName(k.scoringPolicyId, ctx.config.scoringPolicies)],
      ['Mục tiêu mẫu', `Ngưỡng ${k.targets?.threshold ?? '—'} · Cơ bản ${k.targets?.base ?? '—'} · Đẩy mạnh ${k.targets?.stretch ?? '—'}`],
      ['Trọng số mặc định / tối thiểu', `${k.defaultWeight ?? '—'}% / ${k.minWeight ?? '—'}%`],
      ['Đối tượng áp dụng', scopeLabel(k.appliesTo)], ['Chủ sở hữu', nameOf(k.ownerId)],
      k.visibility === 'private' ? ['Người được cấp quyền', Object.keys(k.allowedUsers || {}).map(nameOf).join(', ') || '—'] : null,
      ['Yêu cầu minh chứng', k.evidenceRequired ? `Có${k.evidenceNote ? ` – ${k.evidenceNote}` : ''}` : 'Không'],
      ['Hiệu lực từ', fmt.date(k.effectiveFrom)], ['Cập nhật', `${nameOf(k.updatedBy)} · ${fmt.datetime(k.updatedAt)}`],
      k.previousVersionId ? ['Phiên bản trước', k.previousVersionId] : null,
    ])}
    <h4>Kế hoạch đang sử dụng KPI</h4>
    ${usage ? (usage.usage.length ? html`<table class="data"><thead><tr><th>Kỳ</th><th>Nhân sự</th><th>Chỉ tiêu</th><th class="num">TS</th><th>KH</th></tr></thead><tbody>${usage.usage.map((u) => html`<tr><td>${u.periodName}</td><td>${nameOf(u.userId)}</td><td>${u.title}</td><td class="num">${u.weight}%</td><td>${badge('plan', u.planStatus || 'draft')}</td></tr>`)}</tbody></table>` : html`<div class="muted">Chưa có kế hoạch nào dùng KPI này.</div>`) : html`<div class="muted">Chỉ người quản lý danh mục xem được thông tin sử dụng.</div>`}
    ${usage?.partial ? html`<div class="small muted">Một số kỳ không đọc được do giới hạn quyền.</div>` : ''}
    <h4>Lịch sử chỉnh sửa</h4>
    ${hist ? (hist.length ? html`<ul class="timeline">${hist.map((h) => html`<li><b>${h.action}</b> · ${h.byName || nameOf(h.by)} · ${fmt.datetime(h.at)}${h.reason ? html`<div class="small">Lý do: ${h.reason}</div>` : ''}</li>`)}</ul>` : html`<div class="muted">Chưa có lịch sử.</div>`) : html`<div class="muted">Không có quyền xem lịch sử.</div>`}
  </div>`);
}

async function catalogPage(container) {
  const page = mountPage(container);
  let cat = { public: {}, private: {}, loaded: false };
  const f = { q: '', group: '', vis: '', status: 'active', tab: 'kpi' };
  const draw = () => {
    const list = catalogList(cat);
    catalogState.list = list;
    const rows = list.filter((k) => (!f.group || k.groupId === f.group) && (!f.vis || k.visibility === f.vis) && (!f.status || k.status === f.status) && matches(f.q, k.code, k.name, k.measurement, k.description))
      .sort((a, b) => String(a.code).localeCompare(String(b.code), 'vi'));
    const groups = sortedDict(ctx.config.kpiGroups);
    render(page, html`${pageHead({ title: 'Kho danh mục KPI', sub: 'Danh mục KPI tập trung, tái sử dụng qua các kỳ. KPI Private chỉ hiển thị với người có quyền.', crumbs: [['Danh mục'], ['Kho KPI']],
      actions: (can('manageCatalog') || can('createPrivateKpi')) ? html`<button class="btn primary" data-act="new">${icon('plus', 16)} Tạo KPI</button>` : '' })}
      ${tabs([{ id: 'kpi', label: 'Danh mục KPI', count: list.length }, { id: 'groups', label: 'Nhóm chỉ tiêu', count: groups.length }], f.tab)}
      ${f.tab === 'groups' ? groupTab(groups) : html`
      <div class="toolbar">
        <div class="field search"><label>Tìm kiếm</label><input type="search" data-f="q" value="${f.q}" placeholder="Mã, tên, nội dung đo lường"></div>
        <div class="field"><label>Nhóm</label><select data-f="group">${options(groups.map(([id, g]) => ({ value: id, label: g.name })), f.group, { placeholder: 'Tất cả' })}</select></div>
        <div class="field"><label>Phân loại</label><select data-f="vis">${options([{ value: 'public', label: 'Public' }, { value: 'private', label: 'Private' }], f.vis, { placeholder: 'Tất cả' })}</select></div>
        <div class="field"><label>Trạng thái</label><select data-f="status">${options([{ value: 'active', label: 'Đang sử dụng' }, { value: 'inactive', label: 'Ngừng sử dụng' }, { value: 'archived', label: 'Lưu trữ' }], f.status, { placeholder: 'Tất cả' })}</select></div>
      </div>
      <div class="table-wrap tall"><table class="data"><thead><tr><th>Mã</th><th>Chỉ tiêu</th><th>Nhóm</th><th>Đơn vị đo</th><th>Chiều</th><th>Phương pháp</th><th>Mục tiêu mẫu</th><th>Áp dụng</th><th>Phân loại</th><th>Trạng thái</th><th></th></tr></thead><tbody>
        ${!cat.loaded ? html`<tr><td colspan="11">${ui.loading()}</td></tr>` : rows.length ? rows.map((k) => html`<tr>
          <td class="mono nowrap">${k.code}<div class="small muted">v${k.version || 1}</div></td>
          <td class="wrap-wide"><a href="javascript:void 0" data-view="${k.id}"><b>${k.name}</b></a><div class="small muted clamp">${k.measurement || k.description || ''}</div></td>
          <td>${groupName(k.groupId)}</td><td>${k.unit}</td><td class="small">${directionLabel(k.direction)}</td><td class="small">${policyName(k.scoringPolicyId, ctx.config.scoringPolicies)}</td>
          <td class="nowrap small">${k.targets?.threshold ?? '—'} / ${k.targets?.base ?? '—'} / ${k.targets?.stretch ?? '—'}</td><td class="small">${scopeLabel(k.appliesTo)}</td>
          <td>${k.visibility === 'private' ? html`<span class="badge c-purple" title="Chủ sở hữu: ${nameOf(k.ownerId)}">Private</span>` : html`<span class="badge c-blue">Public</span>`}</td>
          <td>${badge('catalog', k.status)}</td>
          <td class="actions">${canEdit(k) ? html`<button class="btn xs" data-edit="${k.id}">Sửa</button> <button class="btn xs" data-ver="${k.id}" title="Tạo phiên bản mới">Phiên bản mới</button> <button class="btn xs" data-status="${k.id}">${k.status === 'active' ? 'Ngừng' : 'Kích hoạt'}</button>` : ''}
            ${(can('manageCatalog') || can('createPrivateKpi')) ? html`<button class="btn xs" data-copy="${k.id}">Sao chép</button>` : ''}
            ${canEdit(k) ? html`<button class="btn xs outline-danger" data-del="${k.id}">Xóa</button>` : ''}</td></tr>`) : html`<tr><td colspan="11">${ui.empty('Không có KPI phù hợp.')}</td></tr>`}
      </tbody></table></div>`}`);
  };
  const groupTab = (groups) => html`<div class="row end mb-2">${can('manageCatalog') ? html`<button class="btn primary" data-act="new-group">${icon('plus', 16)} Thêm nhóm</button>` : ''}</div>
    <div class="table-wrap"><table class="data"><thead><tr><th class="num">Thứ tự</th><th>Tên nhóm</th><th>Mô tả</th><th class="num">Số KPI</th><th>Trạng thái</th><th></th></tr></thead><tbody>
    ${groups.map(([id, g]) => html`<tr><td class="num">${g.order}</td><td><b>${g.name}</b></td><td>${g.description || ''}</td><td class="num">${catalogState.list.filter((k) => k.groupId === id).length}</td><td>${badge('catalog', g.status || 'active')}</td>
      <td class="actions">${can('manageCatalog') ? html`<button class="btn xs" data-group="${id}">Sửa</button>` : ''}</td></tr>`)}
    </tbody></table></div><div class="small muted mt-1">Tỷ trọng theo nhóm (nếu có) được cấu hình tại chính sách trọng số của kỳ – không cố định trong mã nguồn.</div>`;
  const findK = (id) => catalogList(cat).find((x) => x.id === id);
  const guard = (fn) => async (e, el) => { try { await busy(el, () => fn(el)); } catch (err) { toast(mapError(err), 'error'); } };
  on(page, 'click', '[data-tab]', (e, el) => { f.tab = el.dataset.tab; draw(); });
  on(page, 'input', '[data-f=q]', (e, el) => { f.q = el.value; const pos = el.selectionStart; draw(); const n = page.querySelector('[data-f=q]'); n.focus(); n.setSelectionRange(pos, pos); });
  on(page, 'change', 'select[data-f]', (e, el) => { f[el.dataset.f] = el.value; draw(); });
  on(page, 'click', '[data-act=new]', () => openKpiForm(null));
  on(page, 'click', '[data-edit]', (e, el) => openKpiForm(findK(el.dataset.edit)));
  on(page, 'click', '[data-view]', (e, el) => showDetail(findK(el.dataset.view)));
  on(page, 'click', '[data-copy]', guard(async (el) => { await copyKpi(findK(el.dataset.copy)); toast('Đã sao chép KPI.'); }));
  on(page, 'click', '[data-ver]', guard(async (el) => {
    const k = findK(el.dataset.ver);
    const r = await confirmDialog({ title: 'Tạo phiên bản mới', message: `Tạo phiên bản ${(k.version || 1) + 1} của ${k.code}. Phiên bản hiện tại chuyển sang "Ngừng sử dụng"; các kế hoạch đã dùng vẫn giữ bản chụp cũ.`, requireReason: true });
    if (!r) return;
    await newVersion(k.id, k, { reason: r.reason });
    toast('Đã tạo phiên bản mới.');
  }));
  on(page, 'click', '[data-status]', guard(async (el) => {
    const k = findK(el.dataset.status);
    const to = k.status === 'active' ? 'inactive' : 'active';
    const r = await confirmDialog({ title: to === 'inactive' ? 'Ngừng sử dụng KPI' : 'Kích hoạt lại KPI', message: `${k.code} – ${k.name}`, requireReason: to === 'inactive' });
    if (!r) return;
    await setKpiStatus(k.id, k, to, r.reason);
  }));
  on(page, 'click', '[data-del]', guard(async (el) => {
    const k = findK(el.dataset.del);
    const { usage, partial } = await findUsage(k.id);
    if (usage.length) { toast(`KPI đang được dùng trong ${usage.length} kế hoạch – chỉ có thể ngừng sử dụng hoặc lưu trữ.`, 'error'); return; }
    const r = await confirmDialog({ title: 'Xóa vĩnh viễn KPI', message: `Xóa ${k.code}? ${partial ? 'Lưu ý: không kiểm tra được toàn bộ kỳ do giới hạn quyền.' : 'KPI chưa được dùng trong kế hoạch nào.'}`, danger: true, confirmText: 'Xóa' });
    if (!r) return;
    await deleteKpi(k.id, k, usage);
    toast('Đã xóa KPI.');
  }));
  const groupForm = (id) => {
    const g = id ? ctx.config.kpiGroups[id] : { order: Object.keys(ctx.config.kpiGroups || {}).length + 1, status: 'active' };
    openModal({
      title: id ? 'Sửa nhóm chỉ tiêu' : 'Thêm nhóm chỉ tiêu',
      body: html`<form id="g-form" class="form-grid"><div class="field span-2"><label class="req">Tên nhóm</label><input name="name" value="${g.name || ''}"></div>
        <div class="field"><label>Thứ tự</label><input type="number" name="order" value="${g.order}"></div><div class="field"><label>Trạng thái</label><select name="status">${options([{ value: 'active', label: 'Đang sử dụng' }, { value: 'inactive', label: 'Ngừng sử dụng' }], g.status)}</select></div>
        <div class="field span-2"><label>Mô tả</label><textarea name="description">${g.description || ''}</textarea></div></form>`,
      actions: [{ label: 'Hủy', value: null }, { label: 'Lưu', kind: 'primary', onClick: async ({ el, close }) => {
        const v = formValues(el.querySelector('#g-form'));
        if (!v.name.trim()) { toast('Nhập tên nhóm.', 'error'); return false; }
        try { await saveGroup(id, v, id ? g : null); toast('Đã lưu nhóm.'); close(true); } catch (err) { toast(mapError(err), 'error'); }
        return true;
      } }],
    });
  };
  on(page, 'click', '[data-act=new-group]', () => groupForm(null));
  on(page, 'click', '[data-group]', (e, el) => groupForm(el.dataset.group));
  watchCatalog((c) => { cat = c; draw(); });
  draw();
}

export const routes = [{ path: '/catalog/kpi', title: 'Kho KPI', allow: () => can('viewCatalog'), render: catalogPage }];
