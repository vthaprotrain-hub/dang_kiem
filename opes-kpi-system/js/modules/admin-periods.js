/**
 * Quản lý kỳ đánh giá: cấu hình, mốc thời gian, phạm vi & đối tượng, bộ KBI, chính sách áp dụng,
 * khởi tạo danh sách nhân sự (kèm chuỗi quản lý & phiên bản cơ cấu), chuyển trạng thái, sao chép cấu hình.
 */
import { mapError, listen } from '../services/database.service.js';
import { ctx, nameOf } from '../state.js';
import { can } from '../permissions.js';
import { html, render, ui, fmt, toast, busy, confirmDialog, openModal, mountPage, on, formValues, raw, clone } from '../utils.js';
import { pageHead, options, kv } from '../components.js';
import { badge, periodTypeLabel, sortedDict, statusLabel, demoBadge } from '../labels.js';
import { icon } from '../icons.js';
import { PERIOD_FLOW, emptyPeriod, savePeriod, changeStatus, computeParticipants, initializeParticipants, refreezePolicies, copyConfig, snapshotPolicies } from '../services/period.service.js';
import { unitOptions, profilesSorted } from '../services/organization.service.js';
import { checkList, wireCheckLists } from './catalog.js';

function periodForm(p) {
  const ms = p.milestones || {};
  const rules = p.rules || {};
  const refs = p.policyRefs || {};
  const c = ctx.config;
  const refSel = (name, dict, label) => html`<div class="field"><label>${label}</label><select name="ref_${name}">${options(Object.entries(dict || {}).map(([id, x]) => ({ value: id, label: `${x.name || id}${x.isDemo ? ' (demo)' : ''}` })), refs[name] || 'default')}</select></div>`;
  return html`<form id="period-form" class="stack" novalidate>
    <div class="form-grid cols-4">
      <div class="field"><label class="req">Mã kỳ</label><input name="code" value="${p.code || ''}"></div>
      <div class="field" style="grid-column:span 2"><label class="req">Tên kỳ</label><input name="name" value="${p.name || ''}"></div>
      <div class="field"><label class="req">Năm</label><input type="number" name="year" value="${p.year || ''}"></div>
      <div class="field"><label>Loại kỳ</label><select name="type">${options(sortedDict(c.appSettings?.periodTypes || {}).map(([k, t]) => ({ value: k, label: t.label })), p.type || 'year')}</select></div>
      <div class="field"><label class="req">Ngày bắt đầu</label><input type="date" name="startDate" value="${p.startDate || ''}"></div>
      <div class="field"><label class="req">Ngày kết thúc</label><input type="date" name="endDate" value="${p.endDate || ''}"></div>
    </div>
    <fieldset><legend>Phạm vi & đối tượng được đánh giá</legend><div class="form-grid">
      <div class="field"><label>Đơn vị gốc của phạm vi (bao gồm đơn vị con)</label><select name="rootUnitId">${options(unitOptions().map((u) => ({ value: u.id, label: u.label })), p.scope?.rootUnitId, { placeholder: 'Toàn bộ tổ chức' })}</select></div>
      <div class="field"><label>Nhóm chức danh áp dụng (để trống = tất cả)</label>${checkList('titleGroups', sortedDict(c.appSettings?.titleGroups || {}).map(([k, g]) => ({ value: k, label: g.label })), p.scope?.titleGroups || {}, { search: false, height: 140 })}</div>
      <div class="field span-2"><label>Loại trừ nhân sự</label>${checkList('excludeUserIds', profilesSorted().map((x) => ({ value: x.id, label: `${x.name} – ${x.title || ''}` })), p.scope?.excludeUserIds || {}, { height: 150 })}</div>
    </div></fieldset>
    <fieldset><legend>Bộ KPI / KBI áp dụng</legend><div class="form-grid">
      <div class="field"><label>Ghi chú bộ KPI áp dụng</label><textarea name="kpiSetNote" rows="2">${p.kpiSetNote || ''}</textarea></div>
      <div class="field"><label>Giá trị cốt lõi KBI áp dụng</label>${checkList('kbiValueIds', Object.entries(ctx.kbiCatalog).sort((a, b) => (a[1].order || 0) - (b[1].order || 0)).map(([id, v]) => ({ value: id, label: `${v.name}${v.status !== 'active' ? ' (ngừng)' : ''}` })), p.kbiValueIds || {}, { search: false, height: 140 })}</div>
    </div></fieldset>
    <fieldset><legend>Chính sách áp dụng (được chụp lại khi mở kỳ)</legend><div class="form-grid cols-3">
      ${refSel('kpiAggregation', c.kpiAggregation, 'Quy tắc tổng hợp KPI')}${refSel('kbi', c.kbiPolicies, 'Chính sách KBI')}${refSel('grading', c.gradingBands, 'Bảng xếp loại & tỷ trọng KPI/KBI')}
      ${refSel('weight', c.weightPolicies, 'Chính sách trọng số (X%)')}${refSel('workflow', c.workflowTemplates, 'Quy trình phê duyệt')}${refSel('form', c.formTemplates, 'Mẫu đánh giá')}
    </div><div class="small muted mt-1">Bộ công thức tính điểm KPI (toàn bộ scoringPolicies) cũng được chụp lại. Kỳ đã mở chỉ đổi chính sách qua thao tác "Cập nhật chính sách áp dụng" có lý do.</div></fieldset>
    <fieldset><legend>Mốc thời gian</legend><div class="form-grid cols-4">
      <div class="field"><label>Hạn giao KPI</label><input type="date" name="assignDeadline" value="${ms.assignDeadline || ''}"></div>
      <div class="field"><label>Hạn tự đánh giá</label><input type="date" name="selfAssessDeadline" value="${ms.selfAssessDeadline || ''}"></div>
      <div class="field"><label>Hạn quản lý đánh giá</label><input type="date" name="managerAssessDeadline" value="${ms.managerAssessDeadline || ''}"></div>
      <div class="field"><label>Hạn trình ký/phê duyệt</label><input type="date" name="approvalDeadline" value="${ms.approvalDeadline || ''}"></div>
    </div></fieldset>
    <fieldset><legend>Quy tắc sửa / trả lại</legend><div class="row">
      <label class="check"><input type="checkbox" name="allowReturn" ${rules.allowReturn !== false ? raw('checked') : ''}> Cho phép trả lại hồ sơ</label>
      <label class="check"><input type="checkbox" name="allowEditAfterSubmit" ${rules.allowEditAfterSubmit ? raw('checked') : ''}> Cho phép sửa sau khi gửi (không khuyến nghị)</label>
      <label class="check"><input type="checkbox" name="enforceDeadlines" ${rules.enforceDeadlines ? raw('checked') : ''}> Cảnh báo quá hạn trên dashboard</label>
    </div></fieldset>
    <div id="period-err"></div>
  </form>`;
}

function readPeriodForm(el, prev) {
  const f = formValues(el.querySelector('#period-form'));
  const errs = [];
  if (!f.code?.trim() || !f.name?.trim() || !f.year) errs.push('Nhập mã, tên và năm.');
  if (!f.startDate || !f.endDate || f.endDate < f.startDate) errs.push('Ngày bắt đầu/kết thúc không hợp lệ.');
  const data = {
    ...(prev ? {} : emptyPeriod()), code: f.code.trim(), name: f.name.trim(), year: Number(f.year), type: f.type, startDate: f.startDate, endDate: f.endDate,
    scope: { rootUnitId: f.rootUnitId || null, includeAllActive: true, excludeUserIds: f.excludeUserIds || {}, titleGroups: Object.keys(f.titleGroups || {}).length ? f.titleGroups : null },
    kbiValueIds: f.kbiValueIds || {}, kpiSetNote: f.kpiSetNote,
    policyRefs: { kpiAggregation: f.ref_kpiAggregation, kbi: f.ref_kbi, grading: f.ref_grading, weight: f.ref_weight, workflow: f.ref_workflow, form: f.ref_form },
    milestones: { assignDeadline: f.assignDeadline, selfAssessDeadline: f.selfAssessDeadline, managerAssessDeadline: f.managerAssessDeadline, approvalDeadline: f.approvalDeadline },
    rules: { allowReturn: !!f.allowReturn, allowEditAfterSubmit: !!f.allowEditAfterSubmit, enforceDeadlines: !!f.enforceDeadlines },
  };
  if (!Object.keys(data.kbiValueIds).length) errs.push('Chọn ít nhất một giá trị cốt lõi KBI.');
  return { data, errs };
}

function openPeriodForm(id, base = null) {
  const prev = id ? ctx.periods[id] : null;
  const p = prev || base || emptyPeriod();
  openModal({
    title: id ? `Cấu hình kỳ – ${p.name}` : base ? 'Tạo kỳ mới (sao chép cấu hình)' : 'Tạo kỳ đánh giá', size: 'xl', body: periodForm(p),
    actions: [{ label: 'Hủy', value: null }, { label: 'Lưu', kind: 'primary', onClick: async ({ el, close }) => {
      const { data, errs } = readPeriodForm(el, prev);
      if (errs.length) { render(el.querySelector('#period-err'), html`<div class="alert danger"><ul>${errs.map((x) => html`<li>${x}</li>`)}</ul></div>`); return false; }
      try { await savePeriod(id, { ...(base ? { copiedFrom: base.copiedFrom } : {}), ...data }, prev); toast('Đã lưu kỳ đánh giá.'); close(true); } catch (e) { render(el.querySelector('#period-err'), html`<div class="alert danger"><div>${mapError(e)}</div></div>`); }
      return true;
    } }],
    onMount: (b) => wireCheckLists(b),
  });
}

async function participantsDialog(id) {
  const p = ctx.periods[id];
  const { users, warnings } = computeParticipants(p);
  const existing = ctx.periodId === id ? ctx.periodUsers : null;
  const changes = existing ? Object.keys(users).filter((u) => !existing[u] || existing[u].managerId !== users[u].managerId).length : null;
  const removed = existing ? Object.keys(existing).filter((u) => !users[u]).length : null;
  openModal({
    title: `Khởi tạo danh sách nhân sự – ${p.name}`, size: 'lg',
    body: html`<div class="stack">
      <div>Hệ thống tạo danh sách nhân sự đang hoạt động thuộc phạm vi kỳ, kèm quản lý trực tiếp, quản lý trên một cấp và chuỗi quản lý (dùng cho phân quyền). Đồng thời lưu phiên bản cơ cấu tổ chức áp dụng cho kỳ.</div>
      ${kv([['Số nhân sự', Object.keys(users).length], ['Có thay đổi so với hiện tại', changes ?? 'Chưa có danh sách'], ['Bị loại khỏi kỳ', removed ?? '—']])}
      ${warnings.length ? html`<div class="alert warning"><ul>${warnings.map((w) => html`<li>${w}</li>`)}</ul></div>` : ''}
      ${p.status === 'open' ? html`<div class="alert warning"><div>Kỳ đang mở – cập nhật quan hệ quản lý sẽ thay đổi người được quyền duyệt các hồ sơ đang xử lý.</div></div>` : ''}
      <div class="table-wrap medium"><table class="data"><thead><tr><th>Nhân sự</th><th>Đơn vị</th><th>QL trực tiếp</th><th>QL trên 1 cấp</th><th class="num">Số cấp quản lý</th></tr></thead><tbody>
        ${Object.entries(users).map(([uid, u]) => html`<tr><td>${u.name}</td><td>${u.unitName}</td><td>${u.managerName || '—'}</td><td>${u.skipManagerName || '—'}</td><td class="num">${Object.keys(u.chain || {}).length}</td></tr>`)}
      </tbody></table></div></div>`,
    actions: [{ label: 'Hủy', value: null }, { label: 'Khởi tạo / cập nhật', kind: 'primary', onClick: async ({ close }) => {
      try { await initializeParticipants(id, p, users); toast('Đã khởi tạo danh sách nhân sự.'); close(true); } catch (e) { toast(mapError(e), 'error'); }
      return true;
    } }],
  });
}

async function periodsPage(container) {
  const page = mountPage(container);
  const draw = () => {
    const list = Object.entries(ctx.periods).map(([id, p]) => ({ id, ...p })).sort((a, b) => (b.year || 0) - (a.year || 0));
    render(page, html`${pageHead({ title: 'Quản lý kỳ đánh giá', sub: 'Cấu hình kỳ, mốc thời gian, chính sách áp dụng và trạng thái kỳ', crumbs: [['Quản trị'], ['Kỳ đánh giá']],
      actions: html`<button class="btn primary" data-act="new">${icon('plus', 16)} Tạo kỳ</button>` })}
      ${list.map((p) => {
        const next = PERIOD_FLOW[p.status] || [];
        const pol = p.policies;
        return html`<div class="card mb-2"><div class="card-header"><div><h3>${p.name} <span class="muted small">${p.code}</span></h3><div class="small muted">${periodTypeLabel(p.type)} · ${fmt.date(p.startDate)} – ${fmt.date(p.endDate)} · ${p.participantCount ?? 0} nhân sự</div></div>
          <div class="row">${badge('period', p.status)}</div></div>
          <div class="card-body grid cols-3">
            <div>${kv([['Phạm vi', p.scope?.rootUnitId ? ctx.units[p.scope.rootUnitId]?.name : 'Toàn bộ'], ['Giá trị cốt lõi', Object.keys(p.kbiValueIds || {}).map((k) => ctx.kbiCatalog[k]?.name || k).join(', ')], ['Khởi tạo nhân sự', p.initializedAt ? fmt.datetime(p.initializedAt) : 'Chưa'], ['Phiên bản cơ cấu', p.orgVersionId || '—']])}</div>
            <div>${kv([['Hạn giao KPI', fmt.date(p.milestones?.assignDeadline)], ['Hạn tự đánh giá', fmt.date(p.milestones?.selfAssessDeadline)], ['Hạn QL đánh giá', fmt.date(p.milestones?.managerAssessDeadline)], ['Hạn phê duyệt', fmt.date(p.milestones?.approvalDeadline)]])}</div>
            <div>${kv([['Chính sách đã chụp', pol ? html`${fmt.datetime(pol.meta?.frozenAt)} ${demoBadge(pol.grading?.isDemo || pol.kbi?.isDemo)}` : 'Chưa (sẽ chụp khi mở kỳ)'], ['Người tạo', nameOf(p.createdBy)], ['Người phê duyệt kỳ', nameOf(p.approvedBy)], ['Sao chép từ', p.copiedFrom || '—']])}</div>
          </div>
          <div class="card-footer row between"><div class="btn-group">
            ${['draft', 'configured', 'open', 'paused'].includes(p.status) ? html`<button class="btn sm" data-edit="${p.id}">Sửa cấu hình</button>` : ''}
            ${!['locked', 'archived'].includes(p.status) ? html`<button class="btn sm" data-init="${p.id}">Khởi tạo danh sách nhân sự</button>` : ''}
            ${pol && !['locked', 'archived'].includes(p.status) ? html`<button class="btn sm" data-refreeze="${p.id}">Cập nhật chính sách áp dụng…</button>` : ''}
            <button class="btn sm" data-copy="${p.id}">Sao chép cấu hình sang kỳ mới</button>
            ${p.statusLog ? html`<button class="btn sm" data-log="${p.id}">Lịch sử trạng thái</button>` : ''}
          </div><div class="btn-group">${next.map((to) => html`<button class="btn sm ${to === 'open' ? 'primary' : to === 'locked' ? 'outline-danger' : ''}" data-status="${p.id}|${to}">→ ${statusLabel('period', to)}</button>`)}</div></div>
        </div>`;
      })}
      ${!list.length ? ui.empty('Chưa có kỳ đánh giá.') : ''}`);
  };
  const guard = (fn) => (e, el) => busy(el, async () => { try { await fn(el); } catch (err) { toast(mapError(err), 'error'); } });
  on(page, 'click', '[data-act=new]', () => openPeriodForm(null));
  on(page, 'click', '[data-edit]', (e, el) => openPeriodForm(el.dataset.edit));
  on(page, 'click', '[data-copy]', (e, el) => openPeriodForm(null, copyConfig(ctx.periods[el.dataset.copy])));
  on(page, 'click', '[data-init]', (e, el) => participantsDialog(el.dataset.init));
  on(page, 'click', '[data-log]', (e, el) => {
    const log = Object.values(ctx.periods[el.dataset.log].statusLog || {}).sort((a, b) => (b.at || 0) - (a.at || 0));
    openModal({ title: 'Lịch sử trạng thái kỳ', body: html`<ul class="timeline">${log.map((l) => html`<li>${statusLabel('period', l.from)} → <b>${statusLabel('period', l.to)}</b><div class="small muted">${nameOf(l.by)} · ${fmt.datetime(l.at)}</div>${l.reason ? html`<div class="small">${l.reason}</div>` : ''}</li>`)}</ul>` });
  });
  on(page, 'click', '[data-refreeze]', guard(async (el) => {
    const id = el.dataset.refreeze;
    const { missing } = snapshotPolicies(ctx.periods[id].policyRefs);
    const r = await confirmDialog({ title: 'Cập nhật chính sách áp dụng cho kỳ', message: 'Chụp lại công thức, xếp loại, trọng số, quy trình và mẫu biểu hiện hành vào kỳ. Bản cũ được lưu lại. Kết quả của các hồ sơ chưa phê duyệt sẽ được tính theo chính sách mới; hồ sơ đã phê duyệt giữ kết quả đã lưu và được cảnh báo nếu lệch.', requireReason: true, danger: true, confirmText: 'Cập nhật', details: missing.length ? html`<div class="alert danger"><div>Thiếu: ${missing.join(', ')}</div></div>` : '' });
    if (!r) return;
    await refreezePolicies(id, ctx.periods[id], r.reason);
    toast('Đã cập nhật chính sách cho kỳ.');
  }));
  on(page, 'click', '[data-status]', guard(async (el) => {
    const [id, to] = el.dataset.status.split('|');
    const p = ctx.periods[id];
    const needReason = to === 'locked' || p.status === 'locked' || to === 'paused';
    const r = await confirmDialog({ title: `Chuyển kỳ sang "${statusLabel('period', to)}"`, message: to === 'open' && !p.policies ? 'Chính sách hiện hành sẽ được chụp lại và áp dụng cố định cho kỳ.' : to === 'locked' ? 'Kỳ đã khóa không cho phép sửa kết quả thông thường. Mở khóa ngoại lệ cần lý do và được ghi kiểm toán.' : p.status === 'locked' ? 'Mở lại kỳ đã khóa là thao tác ngoại lệ.' : '', requireReason: needReason, danger: to === 'locked' || p.status === 'locked' });
    if (!r) return;
    await changeStatus(id, p, to, r.reason);
    toast('Đã chuyển trạng thái kỳ.');
  }));
  listen('evaluationPeriods', (v) => { ctx.periods = v || {}; draw(); }, { key: 'admin-periods' });
  draw();
}

export const routes = [{ path: '/admin/periods', title: 'Kỳ đánh giá', allow: () => can('managePeriods'), render: periodsPage }];
