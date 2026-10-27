/**
 * Thành phần kế hoạch KPI cá nhân (dùng cho "KPI của tôi" và xem/duyệt kế hoạch của cấp dưới):
 * bảng chỉ tiêu theo nhóm, sub-KPI, trọng số, tiếp nhận KPI được giao, trình duyệt/phê duyệt, lịch sử.
 */
import { listen, mapError, clearScope, read, DENIED } from '../services/database.service.js';
import { ctx, nameOf, fillYear } from '../state.js';
import { can, planCaps, myTeam } from '../permissions.js';
import { html, render, ui, fmt, toast, busy, confirmDialog, openModal, $, on, formValues, raw, multiline, matches } from '../utils.js';
import { userCell, kv, options, historyTimeline, sortedHistory, iconBtn } from '../components.js';
import { badge, sourceBadge, groupName, policyName, directionLabel, frequencyLabel, sortedDict, demoBadge } from '../labels.js';
import { icon } from '../icons.js';
import {
  itemList, validatePlan, addOwnItem, updateItemSpec, deleteOwnItem, setWeight, acknowledge, normalizeSpec, specFromCatalog, planPath, carryOverItems,
} from '../services/kpi.service.js';
import { classifyCarryOver, buildCarryItems, effectiveSelection, CARRY, CARRY_LABEL } from '../core/carryover.js';
import { submitPlan, approvePlan, returnPlan, reopenPlan } from '../services/workflow.service.js';
import { watchCatalog, catalogList, appliesTo } from '../services/catalog.service.js';
import { METHODS } from '../core/scoring.js';

const policies = () => ctx.period?.policies || {};

// ---------------------------------------------------------------------------
// Biểu mẫu chỉ tiêu (tạo/sửa/sub-KPI)
// ---------------------------------------------------------------------------
export function itemEditor({ title, spec = {}, weight = '', mode = 'own', parentChoices = [], hasChildren = false, lockedFields = [], onSave }) {
  const scoring = policies().scoring || {};
  const groups = sortedDict(ctx.config.kpiGroups).filter(([, g]) => g.status !== 'inactive');
  const t = spec.targets || {};
  const lv = spec.levelDescriptions || {};
  const isSub = mode === 'sub' || !!spec.parentItemId;
  const ro = (f) => (lockedFields.includes(f) ? raw('disabled') : '');
  const body = html`<form id="item-form" class="stack" novalidate>
    ${spec.catalogRef ? html`<div class="alert info"><div>Nguồn danh mục: <b>${spec.catalogRef.code}</b> (phiên bản ${spec.catalogRef.version}, ${spec.catalogRef.visibility === 'private' ? 'Private' : 'Public'}). Nội dung được chụp lại tại thời điểm thêm vào kế hoạch – thay đổi danh mục sau này không ảnh hưởng kế hoạch.</div></div>` : ''}
    <div class="form-grid">
      <div class="field span-2"><label class="req">Tên chỉ tiêu</label><input name="title" value="${spec.title || ''}" required ${ro('title')}></div>
      <div class="field"><label class="req">Nhóm chỉ tiêu</label><select name="groupId" ${ro('groupId')}>${options(groups.map(([id, g]) => ({ value: id, label: g.name })), spec.groupId, { placeholder: '— Chọn nhóm —' })}</select></div>
      <div class="field"><label class="req">Phương pháp tính điểm</label><select name="policyId" ${ro('policyId')}>${options(Object.entries(scoring).filter(([, p]) => p.status !== 'inactive').map(([id, p]) => ({ value: id, label: `${p.name}${p.isDemo ? ' (demo)' : ''}` })), spec.scoring?.policyId, { placeholder: '— Chọn phương pháp —' })}</select><span class="help" id="policy-help"></span></div>
      <div class="field span-2"><label>Mô tả mục tiêu và ý nghĩa</label><textarea name="description" ${ro('description')}>${spec.description || ''}</textarea></div>
      <div class="field span-2"><label>Đo lường / định nghĩa chi tiết</label><textarea name="measurement" rows="5" ${ro('measurement')}>${spec.measurement || ''}</textarea></div>
      <div class="field"><label>Đơn vị đo</label><input name="unit" value="${spec.unit || ''}" ${ro('unit')}></div>
      <div class="field"><label>Chiều đánh giá</label><select name="direction" ${ro('direction')}>${options(sortedDict(ctx.config.appSettings?.kpiDirections || { higher: { label: 'Càng cao càng tốt' }, lower: { label: 'Càng thấp càng tốt' }, scale: { label: 'Theo thang điểm' }, pass_fail: { label: 'Đạt/Không đạt' } }).map(([id, d]) => ({ value: id, label: d.label })), spec.direction || 'higher')}</select></div>
    </div>
    <fieldset><legend>Mục tiêu cả năm</legend><div class="form-grid cols-3">
      <div class="field"><label>Ngưỡng</label><input name="threshold" type="number" step="any" value="${t.threshold ?? ''}" ${ro('targets')}></div>
      <div class="field"><label>Cơ bản</label><input name="base" type="number" step="any" value="${t.base ?? ''}" ${ro('targets')}></div>
      <div class="field"><label>Đẩy mạnh</label><input name="stretch" type="number" step="any" value="${t.stretch ?? ''}" ${ro('targets')}></div>
    </div><div class="small muted mt-1">Nhập theo đúng đơn vị đo. Với chỉ tiêu "càng thấp càng tốt": Ngưỡng ≥ Cơ bản ≥ Đẩy mạnh.</div></fieldset>
    <details ${lv[3] || lv[4] || lv[5] ? raw('open') : ''}><summary><b>Mô tả các mức (cho chỉ tiêu định tính 1–5)</b></summary><div class="form-grid mt-1">
      ${[1, 2, 3, 4, 5].map((l) => html`<div class="field ${l >= 3 ? '' : ''}"><label>Mức ${l}</label><textarea name="level${l}" rows="2" ${ro('levels')}>${lv[l] || ''}</textarea></div>`)}
    </div></details>
    <div class="form-grid">
      <div class="field"><label class="${isSub ? '' : 'req'}">${isSub ? 'Tỷ lệ trong KPI cha (%)' : 'Trọng số (%)'}</label><input name="weight" type="number" min="0" max="100" step="any" value="${weight}" ${ro('weight')}><span class="help">${isSub ? 'Tỷ lệ đóng góp của sub-KPI vào KPI cha (tổng các sub-KPI nên = 100%). Sub-KPI không cộng điểm riêng vào tổng KPI.' : ''}</span></div>
      <div class="field"><label>Chu kỳ đo lường</label><select name="frequency">${options(sortedDict(ctx.config.appSettings?.frequencies || {}).map(([id, f]) => ({ value: id, label: f.label })), spec.frequency || 'year')}</select></div>
      <div class="field"><label>Nguồn / phương pháp thu thập số liệu</label><input name="dataSource" value="${spec.dataSource || ''}"></div>
      <div class="field"><label>Thời hạn hoàn thành</label><input name="deadline" type="date" value="${spec.deadline || ''}"></div>
      <div class="field"><label class="check"><input type="checkbox" name="evidenceRequired" ${spec.evidenceRequired ? raw('checked') : ''}> Bắt buộc minh chứng</label><input name="evidenceNote" placeholder="Yêu cầu minh chứng" value="${spec.evidenceNote || ''}"></div>
      ${!isSub ? html`<div class="field"><label class="check"><input type="checkbox" name="trackOnly" ${spec.countInTotal === false ? raw('checked') : ''}> Chỉ theo dõi, không cộng điểm vào tổng KPI</label></div>` : html`<div class="field"><label class="req">KPI cha</label><select name="parentItemId">${options(parentChoices, spec.parentItemId)}</select></div>`}
    </div>
    ${hasChildren || mode === 'parent' ? html`<fieldset><legend>Tổng hợp từ sub-KPI (tránh tính trùng)</legend><div class="form-grid cols-3">
      <div class="field"><label>Phương pháp tổng hợp</label><select name="aggregationMethod" ${ro('aggregation')}>${options([
        { value: 'direct', label: 'Chấm trực tiếp KPI cha (sub-KPI chỉ theo dõi)' },
        { value: 'children_replace', label: 'Lấy kết quả sub-KPI thay cho KPI cha' },
        { value: 'children_weighted', label: 'Kết hợp KPI cha + sub-KPI theo tỷ lệ' }], spec.aggregation?.method || 'direct')}</select></div>
      <div class="field"><label>Sub-KPI thiếu dữ liệu</label><select name="missingChild" ${ro('aggregation')}>${options([
        { value: 'exclude', label: 'Bỏ qua và chuẩn hóa lại tỷ lệ' }, { value: 'block', label: 'Chưa tính KPI cha' }, { value: 'zero', label: 'Tính 0%' }], spec.aggregation?.missingChild || 'exclude')}</select></div>
      <div class="field"><label>Tỷ lệ phần KPI cha (0–1)</label><input name="parentShare" type="number" step="0.05" min="0" max="1" value="${spec.aggregation?.parentShare ?? 0.5}" ${ro('aggregation')}><span class="help">Chỉ dùng cho phương pháp kết hợp.</span></div>
    </div><div class="small muted">Sub-KPI bị thu hồi không được tính. Điểm KPI cha và sub-KPI không bao giờ được cộng đồng thời vào tổng.</div></fieldset>` : ''}
    <div id="item-errors"></div>
  </form>`;
  const m = openModal({
    title, size: 'lg', body,
    actions: [{ label: 'Hủy', value: null }, {
      label: 'Lưu chỉ tiêu', kind: 'primary', onClick: async ({ el, close }) => {
        const f = formValues(el.querySelector('#item-form'));
        const errs = [];
        if (!f.title?.trim() && !lockedFields.includes('title')) errs.push('Nhập tên chỉ tiêu.');
        if (!f.groupId && !lockedFields.includes('groupId')) errs.push('Chọn nhóm chỉ tiêu.');
        if (!f.policyId && !lockedFields.includes('policyId')) errs.push('Chọn phương pháp tính điểm.');
        const w = f.weight === undefined ? Number(weight) : Number(f.weight);
        if (!lockedFields.includes('weight') && (!Number.isFinite(w) || w < 0 || w > 100)) errs.push('Trọng số phải từ 0 đến 100.');
        if (errs.length) { render(el.querySelector('#item-errors'), html`<div class="alert danger"><ul>${errs.map((x) => html`<li>${x}</li>`)}</ul></div>`); return false; }
        f.countInTotal = !f.trackOnly;
        try {
          await onSave(f, w);
          close(true);
        } catch (e) {
          render(el.querySelector('#item-errors'), html`<div class="alert danger"><div>${mapError(e)}</div></div>`);
        }
        return true;
      },
    }],
    onMount: (b) => {
      const sel = b.querySelector('[name=policyId]');
      const help = b.querySelector('#policy-help');
      const upd = () => { const p = scoring[sel.value]; help.textContent = p ? `${METHODS[p.method]?.label || p.method}${p.note ? ` – ${p.note}` : ''}` : ''; };
      sel?.addEventListener('change', upd);
      upd();
    },
  });
  return m.result;
}

// ---------------------------------------------------------------------------
// Chọn KPI từ kho
// ---------------------------------------------------------------------------
export function catalogPicker({ title = 'Chọn KPI từ kho', periodUser = ctx.periodUser, onPick }) {
  let cat = { public: {}, private: {} };
  let q = '', group = '', onlyApplicable = true;
  const m = openModal({
    title, size: 'xl', body: ui.loading(), actions: [{ label: 'Đóng', value: null }],
    onMount: (b, close) => {
      const draw = () => {
        const list = catalogList(cat).filter((k) => k.status === 'active')
          .filter((k) => !group || k.groupId === group)
          .filter((k) => !onlyApplicable || appliesTo(k, periodUser))
          .filter((k) => matches(q, k.code, k.name, k.measurement));
        render(b, html`<div class="toolbar">
            <div class="field search"><label>Tìm kiếm</label><input type="search" id="cp-q" value="${q}" placeholder="Mã, tên, nội dung đo lường…"></div>
            <div class="field"><label>Nhóm</label><select id="cp-g">${options(sortedDict(ctx.config.kpiGroups).map(([id, g]) => ({ value: id, label: g.name })), group, { placeholder: 'Tất cả nhóm' })}</select></div>
            <label class="check" style="margin-bottom:8px"><input type="checkbox" id="cp-app" ${onlyApplicable ? raw('checked') : ''}> Chỉ KPI áp dụng cho tôi</label>
          </div>
          <div class="table-wrap medium"><table class="data"><thead><tr><th>Mã</th><th>Chỉ tiêu</th><th>Nhóm</th><th>Đơn vị</th><th>Phân loại</th><th>Phương pháp</th><th></th></tr></thead><tbody>
          ${list.length ? list.map((k) => html`<tr><td class="nowrap mono">${k.code}</td><td class="wrap-wide"><b>${k.name}</b><div class="small muted clamp">${k.measurement || k.description || ''}</div></td><td>${groupName(k.groupId)}</td><td>${k.unit}</td>
            <td>${k.visibility === 'private' ? html`<span class="badge c-purple">Private</span>` : html`<span class="badge c-blue">Public</span>`}</td><td class="small">${policyName(k.scoringPolicyId)}</td>
            <td class="actions"><button class="btn sm primary" data-pick="${k.id}">Chọn</button></td></tr>`) : html`<tr><td colspan="7">${ui.empty('Không có KPI phù hợp.')}</td></tr>`}
          </tbody></table></div>`);
        b.querySelector('#cp-q').addEventListener('input', (e) => { q = e.target.value; const pos = e.target.selectionStart; draw(); const n = b.querySelector('#cp-q'); n.focus(); n.setSelectionRange(pos, pos); });
        b.querySelector('#cp-g').addEventListener('change', (e) => { group = e.target.value; draw(); });
        b.querySelector('#cp-app').addEventListener('change', (e) => { onlyApplicable = e.target.checked; draw(); });
        b.querySelectorAll('[data-pick]').forEach((btn) => btn.addEventListener('click', () => {
          const k = catalogList(cat).find((x) => x.id === btn.dataset.pick);
          close(k);
          onPick(k);
        }));
      };
      watchCatalog((c) => { cat = c; if (b.isConnected) draw(); }, 'modal-catalog');
    },
    onClose: () => clearScope('modal-catalog'),
  });
  return m.result;
}

// ---------------------------------------------------------------------------
// Thêm KPI từ năm trước
// ---------------------------------------------------------------------------
export function previousPeriodsFor(periodId) {
  const cur = ctx.periods[periodId] || {};
  const y = Number(cur.year) || 0;
  return Object.entries(ctx.periods || {})
    .filter(([id, p]) => id !== periodId && (Number(p.year) || 0) < y)
    .sort(([, a], [, b]) => (Number(b.year) || 0) - (Number(a.year) || 0) || String(b.startDate || '').localeCompare(String(a.startDate || '')));
}

export function carryOverDialog({ periodId, userId, getPlan, periodUser }) {
  const prevList = previousPeriodsFor(periodId);
  if (!prevList.length) { toast('Chưa có kỳ đánh giá nào trước kỳ hiện tại để sao chép KPI.', 'error'); return null; }
  let srcId = prevList[0][0];
  let prevPlan, cat = null, rows = [], selected = new Set(), weights = {}, keepTargets = true, loadingPlan = true;
  const scoring = () => policies().scoring || ctx.config.scoringPolicies || {};
  const curTotal = () => itemList(getPlan() || { items: {} }, { includeRevoked: false })
    .filter((i) => !i.spec.parentItemId && i.spec.countInTotal !== false).reduce((s, i) => s + (Number(i.weight) || 0), 0);
  const m = openModal({
    title: 'Thêm KPI từ năm trước', size: 'xl', body: ui.loading(),
    actions: [{ label: 'Hủy', value: null }, { label: 'Thêm KPI đã chọn', kind: 'primary', onClick: async ({ close }) => {
      const items = buildCarryItems(rows, selected, { weights, keepTargets, catalogSpec: specFromCatalog, sourcePeriodId: srcId });
      if (!items.length) { toast('Chưa chọn KPI nào.', 'error'); return false; }
      try {
        await carryOverItems({ periodId, userId, plan: getPlan(), sourcePeriodId: srcId, sourcePeriodName: ctx.periods[srcId]?.name, items });
        const nCat = items.filter((i) => i.spec.copiedFrom.status === CARRY.CATALOG).length;
        toast(`Đã thêm ${items.length} KPI từ ${ctx.periods[srcId]?.name || 'kỳ trước'} (${nCat} từ danh mục, ${items.length - nCat} tạo mới). Hãy rà soát mục tiêu và trọng số trước khi trình duyệt.`);
        close(true);
      } catch (e) { toast(mapError(e), 'error'); }
      return true;
    } }],
    onClose: () => clearScope('modal-carry'),
  });
  const body = m.body;
  const recompute = () => {
    if (!cat?.loaded || loadingPlan) return;
    rows = prevPlan ? classifyCarryOver({
      prevPlan, catalog: cat, currentPlan: getPlan(), scoringPolicies: scoring(), kpiGroups: ctx.config.kpiGroups || {},
      isApplicable: (k) => appliesTo(k, periodUser),
    }) : [];
    selected = new Set(rows.filter((r) => r.defaultSelected).map((r) => r.id));
    weights = {};
  };
  const summary = () => {
    const chosen = effectiveSelection(rows, selected);
    const add = chosen.filter((r) => !r.parentId || !selected.has(r.parentId)).reduce((s, r) => s + (Number(weights[r.id] ?? r.weight) || 0), 0);
    const total = Math.round((curTotal() + add) * 1000) / 1000;
    const req = policies().weight?.totalRequired ?? 100;
    const nCat = chosen.filter((r) => r.status === CARRY.CATALOG).length;
    const subIssues = chosen.filter((r) => chosen.some((c) => c.parentId === r.id)).map((r) => {
      const sh = chosen.filter((c) => c.parentId === r.id).reduce((a, c) => a + (Number(weights[c.id] ?? c.weight) || 0), 0);
      return Math.abs(sh - 100) > 0.01 ? `Tổng tỷ lệ sub-KPI của "${r.title}" là ${Math.round(sh * 1000) / 1000}% – phải bằng 100% trước khi trình duyệt.` : null;
    }).filter(Boolean);
    render(body.querySelector('#co-sum'), html`<div class="alert ${Math.abs(total - req) > 0.01 || subIssues.length ? 'warning' : 'success'}"><div>
      Đã chọn <b>${chosen.length}</b> KPI (${nCat} từ danh mục, ${chosen.length - nCat} tạo mới). Tổng trọng số kế hoạch sau khi thêm: <b>${fmt.weight(total)}</b> (yêu cầu ${req}%).
      ${subIssues.map((x) => html`<div class="small">${x}</div>`)}
      ${Math.abs(total - req) > 0.01 || subIssues.length ? html`<div class="small">Có thể điều chỉnh trọng số ở bảng dưới hoặc sau khi thêm.</div>` : ''}</div></div>`);
  };
  const draw = () => {
    if (!cat?.loaded || loadingPlan) { render(body, ui.loading('Đang đọc kế hoạch kỳ trước và kiểm tra danh mục…')); return; }
    const counts = Object.fromEntries(Object.keys(CARRY_LABEL).map((k) => [k, rows.filter((r) => r.status === k).length]));
    render(body, html`<div class="stack">
      <div class="form-grid cols-3">
        <div class="field"><label>Lấy KPI từ kỳ</label><select id="co-src">${options(prevList.map(([id, p]) => ({ value: id, label: `${p.name}${p.status === 'locked' || p.status === 'archived' ? ' (đã khóa)' : ''}` })), srcId)}</select></div>
        <div class="field" style="grid-column:span 2"><label class="check" style="margin-top:22px"><input type="checkbox" id="co-keep" ${keepTargets ? raw('checked') : ''}> Giữ mục tiêu (Ngưỡng/Cơ bản/Đẩy mạnh) của năm trước cho KPI từ danh mục</label>
          <span class="help">Bỏ chọn để dùng mục tiêu mặc định của danh mục hiện hành. KPI tạo mới luôn giữ nội dung năm trước.</span></div>
      </div>
      <div class="small muted">KPI thuộc danh mục được kiểm tra lại: còn tồn tại, đang sử dụng, áp dụng cho vị trí/đơn vị hiện tại và (với KPI Private) còn được cấp quyền. KPI không có trong danh mục được thêm như KPI tạo mới. KPI do cấp trên giao năm trước không được chọn sẵn vì cấp trên có thể giao lại trong năm nay.</div>
      ${!prevPlan ? ui.empty(`Bạn không có kế hoạch KPI trong ${ctx.periods[srcId]?.name || 'kỳ đã chọn'}.`) : html`
      <div class="row">${Object.entries(CARRY_LABEL).map(([k, l]) => html`<span class="badge c-${l.color}">${l.label}: ${counts[k]}</span>`)}</div>
      <div class="table-wrap medium"><table class="data"><thead><tr><th style="width:34px"><input type="checkbox" id="co-all" aria-label="Chọn tất cả"></th><th>Chỉ tiêu năm trước</th><th>Nhóm</th><th>Kiểm tra</th><th class="num">Trọng số</th></tr></thead><tbody>
      ${rows.map((r) => html`<tr class="${r.selectable ? '' : 'muted'}">
        <td><input type="checkbox" data-co="${r.id}" ${selected.has(r.id) ? raw('checked') : ''} ${r.selectable ? '' : raw('disabled')} aria-label="Chọn"></td>
        <td class="wrap-wide" style="padding-left:${8 + (r.depth || 0) * 22}px">${r.depth ? html`<span class="muted">↳ </span>` : ''}<b>${r.title}</b>
          <div class="small">${sourceBadge(r.prevSource)}${r.catalog ? html` <span class="mono muted">${r.catalog.code}</span>` : ''}${r.prevSpec.assignedByName ? html` <span class="muted">· giao bởi ${r.prevSpec.assignedByName}</span>` : ''}</div></td>
        <td class="small">${groupName(r.groupOverride || r.catalog?.groupId || r.prevSpec.groupId)}</td>
        <td class="small"><span class="badge c-${CARRY_LABEL[r.status].color}">${CARRY_LABEL[r.status].label}</span><div>${r.reason}</div>${r.warnings.map((w) => html`<div class="state-missing">${w}</div>`)}</td>
        <td class="num">${r.selectable ? html`<input class="cell-input sm" type="number" min="0" max="100" step="any" data-cow="${r.id}" value="${weights[r.id] ?? r.weight}" style="width:76px" aria-label="Trọng số">${r.depth ? html`<div class="small muted">% trong KPI cha</div>` : ''}` : fmt.weight(r.weight)}</td>
      </tr>`)}
      </tbody></table></div>
      <div id="co-sum"></div>`}
    </div>`);
    body.querySelector('#co-src').addEventListener('change', async (e) => { srcId = e.target.value; await loadPlan(); });
    body.querySelector('#co-keep').addEventListener('change', (e) => { keepTargets = e.target.checked; });
    if (!prevPlan) return;
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    body.querySelectorAll('[data-co]').forEach((cb) => cb.addEventListener('change', () => {
      const id = cb.dataset.co;
      if (cb.checked) {
        selected.add(id);
        for (let p = byId[id].parentId; p; p = byId[p]?.parentId) if (byId[p]?.selectable) selected.add(p); // chọn sub-KPI thì chọn kèm KPI cha
      } else {
        selected.delete(id);
        const drop = (pid) => rows.filter((r) => r.parentId === pid).forEach((c) => { selected.delete(c.id); drop(c.id); });
        drop(id);
      }
      body.querySelectorAll('[data-co]').forEach((x) => { x.checked = selected.has(x.dataset.co); });
      summary();
    }));
    body.querySelector('#co-all')?.addEventListener('change', (e) => {
      selected = new Set(e.target.checked ? rows.filter((r) => r.selectable).map((r) => r.id) : []);
      body.querySelectorAll('[data-co]').forEach((x) => { x.checked = selected.has(x.dataset.co); });
      summary();
    });
    body.querySelectorAll('[data-cow]').forEach((inp) => inp.addEventListener('input', () => { weights[inp.dataset.cow] = inp.value; summary(); }));
    summary();
  };
  const loadPlan = async () => {
    loadingPlan = true; draw();
    try {
      const v = await read(`kpiPlans/${srcId}/${userId}`, { allowDenied: true });
      prevPlan = v && v !== DENIED && v.items ? v : null;
    } catch (e) { prevPlan = null; toast(mapError(e), 'error'); }
    loadingPlan = false; recompute(); draw();
  };
  watchCatalog((c) => { const first = !cat?.loaded && c.loaded; cat = c; if (first) { recompute(); draw(); } }, 'modal-carry');
  loadPlan();
  return m.result;
}

// ---------------------------------------------------------------------------
// Chi tiết chỉ tiêu
// ---------------------------------------------------------------------------
export function itemDetail(plan, itemId, ownerId) {
  const it = plan.items[itemId];
  if (!it) return;
  const s = it.spec;
  const p = policies().scoring?.[s.scoring?.policyId];
  const children = itemList(plan).filter((c) => c.spec.parentItemId === itemId);
  const hist = sortedHistory(plan.history).filter((h) => h.itemId === itemId);
  const lv = s.levelDescriptions || {};
  openModal({
    title: s.title, drawer: true,
    body: html`<div class="stack">
      <div class="row">${sourceBadge(s.source)}${s.state === 'revoked' ? html`<span class="badge c-slate">Đã thu hồi</span>` : ''}${s.source === 'assigned' ? badge('ack', it.ack?.status || 'pending') : ''}</div>
      ${kv([
        ['Nhóm chỉ tiêu', groupName(s.groupId)],
        ['Mục tiêu và ý nghĩa', s.description ? multiline(s.description) : ''],
        ['Định nghĩa / cách đo lường', s.measurement ? multiline(s.measurement) : ''],
        ['Đơn vị đo', s.unit], ['Chiều đánh giá', directionLabel(s.direction)],
        ['Kết quả cần đạt', html`Ngưỡng: <b>${s.targets?.threshold ?? '—'}</b> · Cơ bản: <b>${s.targets?.base ?? '—'}</b> · Đẩy mạnh: <b>${s.targets?.stretch ?? '—'}</b>`],
        ['Công thức / tiêu chí chấm', p ? html`${p.name} ${demoBadge(p.isDemo)}<div class="small muted">${p.note || ''}</div>` : html`<span class="state-invalid">Chưa có phương pháp hợp lệ</span>`],
        Object.keys(lv).length ? ['Mô tả các mức', html`${Object.entries(lv).map(([l, d]) => html`<div><b>Mức ${l}:</b> ${d}</div>`)}`] : null,
        [s.parentItemId ? 'Tỷ lệ trong KPI cha' : 'Trọng số', fmt.weight(it.weight)],
        s.source === 'assigned' ? ['Chế độ trọng số', s.weightMode === 'flex' ? `B – Cho phép điều chỉnh (tối thiểu ${s.minWeight}%${s.maxWeight ? `, tối đa ${s.maxWeight}%` : ''}). Trọng số gốc: ${s.originalWeight}%` : `A – Cố định do cấp trên giao (${s.originalWeight ?? it.weight}%)`] : null,
        ['Nguồn giao KPI', s.source === 'assigned' ? html`Giao bởi <b>${s.assignedByName || nameOf(s.assignedBy)}</b> lúc ${fmt.datetime(s.assignedAt)}${s.parentRef ? html`<br>Phân rã từ: “${s.parentRef.title}” (${nameOf(s.parentRef.userId)})` : ''}` : s.catalogRef ? `Kho KPI – ${s.catalogRef.code} (v${s.catalogRef.version})` : s.source === 'sub' ? 'Sub-KPI tự phân rã' : 'Tự tạo mới'],
        s.parentItemId ? ['KPI cha (trong kế hoạch)', plan.items[s.parentItemId]?.spec.title || s.parentItemId] : null,
        children.length ? ['Sub-KPI', html`${children.map((c) => html`<div>• ${c.spec.title} (${fmt.weight(c.weight)})</div>`)}<div class="small muted">Tổng hợp: ${s.aggregation?.method === 'children_replace' ? 'lấy kết quả sub-KPI thay cho KPI cha' : s.aggregation?.method === 'children_weighted' ? `kết hợp ${s.aggregation.parentShare} KPI cha` : 'chấm trực tiếp KPI cha'}</div>`] : null,
        ['Người chịu trách nhiệm', nameOf(ownerId)],
        ['Người đánh giá', ctx.periodUsers[ownerId]?.managerName || nameOf(ctx.periodUsers[ownerId]?.managerId)],
        ['Thời gian hiệu lực', `${fmt.date(ctx.period?.startDate)} – ${fmt.date(s.deadline || ctx.period?.endDate)}`],
        ['Chu kỳ đo', frequencyLabel(s.frequency)], ['Nguồn số liệu', s.dataSource],
        ['Yêu cầu minh chứng', s.evidenceRequired ? `Bắt buộc${s.evidenceNote ? ` – ${s.evidenceNote}` : ''}` : 'Không bắt buộc'],
        ['Trạng thái giao/phê duyệt', html`${badge('plan', plan.status || 'draft')}${s.source === 'assigned' ? html` · ${badge('ack', it.ack?.status || 'pending')}${it.ack?.note ? html`<div class="small">${it.ack.note}</div>` : ''}` : ''}`],
        s.state === 'revoked' ? ['Thu hồi', `${fmt.datetime(s.revokedAt)} – ${s.revokeReason || ''}`] : null,
      ])}
      <h4 class="mt-2">Lịch sử điều chỉnh</h4>${historyTimeline(hist)}
    </div>`,
    actions: [{ label: 'Đóng', value: null }],
  });
}

// ---------------------------------------------------------------------------
// Xem / chỉnh kế hoạch
// ---------------------------------------------------------------------------
export function renderPlanView(page, periodId, userId, { title = '' } = {}) {
  let plan = null;
  let loaded = false;
  const pu = () => ctx.periodUsers[userId];

  const draw = () => {
    if (!loaded) { render(page, ui.loading()); return; }
    const caps = planCaps(plan, userId);
    if (!caps.canView) { render(page, ui.denied()); return; }
    const p = pu() || {};
    const check = plan ? validatePlan(plan, policies()) : { errors: [], warnings: [], total: 0, groups: {} };
    const items = plan ? itemList(plan) : [];
    const form = policies().form || {};
    const sigLabels = form.planSignatureLabels || { employee: 'NHÂN SỰ TIẾP NHẬN BỘ KPI', manager: 'CẤP QUẢN LÝ', skip: 'QUẢN LÝ TRÊN 1 CẤP' };
    const groupsOrder = sortedDict(ctx.config.kpiGroups).map(([id]) => id);
    const tops = items.filter((i) => !i.spec.parentItemId || !plan.items[i.spec.parentItemId]);
    const byGroup = new Map();
    tops.forEach((i) => { const g = i.spec.groupId || '_'; if (!byGroup.has(g)) byGroup.set(g, []); byGroup.get(g).push(i); });
    const sortedGroups = [...byGroup.keys()].sort((a, b) => (groupsOrder.indexOf(a) + 1 || 99) - (groupsOrder.indexOf(b) + 1 || 99));
    const childrenOf = (id) => items.filter((c) => c.spec.parentItemId === id);
    let stt = 0;
    const editableItem = (i) => caps.editable && (caps.canAssign || (caps.canEditOwn && i.spec.source !== 'assigned'));
    const weightEditable = (i) => {
      if (!caps.editable || i.spec.state === 'revoked') return false;
      if (caps.canAssign) return true;
      if (!caps.canEditOwn && !caps.canAck) return false;
      if (i.spec.source !== 'assigned') return caps.canEditOwn;
      return i.spec.weightMode === 'flex';
    };
    const row = (i, depth) => {
      const s = i.spec;
      const revoked = s.state === 'revoked';
      const kids = childrenOf(i.id);
      const pol = policies().scoring?.[s.scoring?.policyId];
      const num = depth === 0 ? ++stt : '';
      return html`<tr class="${depth ? 'child-row' : ''} ${revoked ? 'revoked' : ''}" data-item="${i.id}">
        <td class="center">${num}</td>
        <td class="wrap-wide" style="${depth ? 'padding-left:28px' : ''}">${depth ? '↳ ' : ''}<a href="javascript:void 0" data-detail="${i.id}"><b>${s.title}</b></a>
          <div class="row" style="gap:4px;margin-top:3px">${sourceBadge(s.source)}${s.source === 'assigned' ? html`<span class="small muted">từ ${s.assignedByName || nameOf(s.assignedBy)}</span>` : ''}${kids.length ? (() => { const sh = check.subShares?.[i.id]; return html`<span class="badge ${sh && !sh.valid ? 'c-red' : 'c-gray'}" title="Tổng tỷ lệ các sub-KPI phải bằng 100%">${kids.length} sub-KPI${sh ? ` · ${fmt.weight(sh.share)}` : ''}</span>`; })() : ''}${s.countInTotal === false ? html`<span class="badge c-gray">Chỉ theo dõi</span>` : ''}${revoked ? html`<span class="badge c-slate">Đã thu hồi</span>` : ''}</div>
          ${s.parentRef ? html`<div class="small muted">Phân rã từ: ${s.parentRef.title} (${nameOf(s.parentRef.userId)})</div>` : ''}</td>
        <td class="wrap-xl"><div class="clamp small">${s.measurement || s.description || ''}</div></td>
        <td>${s.unit}</td>
        <td class="num">${weightEditable(i) ? html`<input class="cell-input sm" type="number" min="0" max="100" step="any" value="${i.weight}" data-weight="${i.id}" style="width:80px" aria-label="Trọng số">` : fmt.weight(i.weight)}
          ${s.source === 'assigned' ? html`<div class="small muted">${s.weightMode === 'flex' ? `B · ≥${s.minWeight}%` : 'A · cố định'}</div>` : depth ? html`<div class="small muted">trong KPI cha</div>` : ''}</td>
        <td class="num">${s.targets?.threshold ?? '—'}</td><td class="num">${s.targets?.base ?? '—'}</td><td class="num">${s.targets?.stretch ?? '—'}</td>
        <td class="small">${pol ? pol.name : html`<span class="state-invalid">Chưa hợp lệ</span>`}</td>
        <td>${s.source === 'assigned' ? html`${badge('ack', i.ack?.status || 'pending')}${i.ack?.requestedWeight ? html`<div class="small muted">Đề xuất ${i.ack.requestedWeight}%</div>` : ''}` : ''}</td>
        <td class="actions">
          ${s.source === 'assigned' && caps.canAck && !revoked && i.ack?.status !== 'accepted' ? html`<button class="btn xs primary" data-ack="${i.id}">Tiếp nhận</button> <button class="btn xs" data-change="${i.id}">Đề nghị điều chỉnh</button>` : ''}
          ${iconBtn('eye', 'Chi tiết', `data-detail="${i.id}"`)}
          ${editableItem(i) && !revoked ? iconBtn('edit', 'Sửa', `data-edit="${i.id}"`) : ''}
          ${caps.editable && (caps.canEditOwn || caps.canAssign) && can('createSubKpi') && !revoked && depth < 3 ? iconBtn('split', 'Tạo sub-KPI', `data-sub="${i.id}"`) : ''}
          ${caps.rel.self && can('assignKpi') && myTeam().length && !revoked && ctx.period?.status === 'open' ? iconBtn('send', 'Giao xuống cấp dưới', `data-down="${i.id}"`) : ''}
          ${caps.canEditOwn && s.source !== 'assigned' && !kids.length ? iconBtn('trash', 'Xóa', `data-del="${i.id}"`) : ''}
        </td></tr>
        ${kids.map((k) => row(k, depth + 1))}`;
    };
    const sig = (who) => {
      const sg = plan?.signatures?.[who];
      const valid = sg && plan.version && sg.version === plan.version;
      const person = who === 'employee' ? userId : who === 'manager' ? p.managerId : p.skipManagerId;
      return html`<div class="sign-box ${valid ? 'signed' : sg ? 'stale' : ''}"><div class="sign-role">${sigLabels[who]}</div>
        <div>${sg ? sg.name : person ? nameOf(person) : who === 'manager' ? '(Phê duyệt cấp cao nhất – HR/TGĐ)' : '—'}</div><div class="small muted">${sg?.title || ''}</div>
        <div class="sign-mark">${valid ? html`✔ Đã xác nhận điện tử<br><span class="small">${fmt.datetime(sg.at)} · phiên bản ${sg.version}</span>` : sg ? html`<span class="state-missing">Xác nhận phiên bản cũ (v${sg.version})</span>` : html`<span class="muted">Chưa xác nhận</span>`}</div>
        ${sg?.note ? html`<div class="small">“${sg.note}”</div>` : ''}</div>`;
    };
    render(page, html`
      <div class="card"><div class="card-body row between top">
        <div class="stack tight">${userCell(userId, p.unitName || '')}
          <div class="small muted">Quản lý trực tiếp: <b>${p.managerName || (p.managerId ? nameOf(p.managerId) : 'Cấp cao nhất trong phạm vi')}</b> · Quản lý trên 1 cấp: <b>${p.skipManagerName || (p.skipManagerId ? nameOf(p.skipManagerId) : '—')}</b></div>
        </div>
        <div class="stack tight" style="align-items:flex-end">
          <div class="row">${badge('plan', plan?.status || 'none')}${plan?.version ? html`<span class="badge c-gray">Phiên bản ${plan.version}</span>` : ''}</div>
          ${plan?.statusMeta ? html`<div class="small muted">${plan.statusMeta.note || ''} · ${nameOf(plan.statusMeta.by)} · ${fmt.datetime(plan.statusMeta.at)}</div>` : ''}
        </div>
      </div></div>
      ${plan?.status === 'returned' && plan.lastReturn ? html`<div class="alert warning mt-2"><div><b>Cần bổ sung:</b> ${plan.lastReturn.reason} <span class="small muted">(${nameOf(plan.lastReturn.by)}, ${fmt.datetime(plan.lastReturn.at)})</span></div></div>` : ''}
      ${plan?.status === 'returned' && plan.lastUnlock && (!plan.lastReturn || plan.lastUnlock.at > plan.lastReturn.at) ? html`<div class="alert info mt-2"><div><b>Kế hoạch đang mở sửa đổi:</b> ${plan.lastUnlock.reason}</div></div>` : ''}
      ${check.errors.length || check.warnings.length ? html`<div class="mt-2">${check.errors.length ? html`<div class="alert danger"><div><b>Cần xử lý trước khi trình duyệt:</b><ul>${check.errors.map((e) => html`<li>${e}</li>`)}</ul></div></div>` : ''}${check.warnings.length ? html`<div class="alert warning"><div><b>Lưu ý:</b><ul>${check.warnings.map((e) => html`<li>${e}</li>`)}</ul></div></div>` : ''}</div>` : ''}
      <div class="row between mt-2 no-print">
        <div class="btn-group">
          ${caps.canEditOwn ? html`<button class="btn" data-act="add-catalog">${icon('book', 16)} Thêm KPI từ kho</button>${previousPeriodsFor(periodId).length ? html`<button class="btn" data-act="add-previous">${icon('copy', 16)} Thêm KPI từ năm trước</button>` : ''}<button class="btn" data-act="add-custom">${icon('plus', 16)} Tạo KPI mới</button>` : ''}
          ${caps.canAssign && !caps.rel.self ? html`<a class="btn" href="#/kpi/assign?to=${userId}">${icon('send', 16)} Giao KPI cho ${p.name || 'nhân sự'}</a>` : ''}
          <button class="btn" data-act="print">${icon('printer', 16)} In bộ chỉ tiêu</button>
        </div>
        <div class="btn-group">
          ${caps.canSubmit ? html`<button class="btn primary" data-act="submit">Trình duyệt bộ KPI</button>` : ''}
          ${caps.canManagerAct ? html`<button class="btn outline-danger" data-act="return">Trả lại</button><button class="btn primary" data-act="approve-manager">${caps.reqSkip ? 'Phê duyệt & trình QL trên 1 cấp' : 'Phê duyệt chính thức'}</button>` : ''}
          ${caps.canSkipAct ? html`<button class="btn outline-danger" data-act="return-manager">Trả lại QL trực tiếp</button><button class="btn outline-danger" data-act="return">Trả lại nhân sự</button><button class="btn primary" data-act="approve-skip">Phê duyệt chính thức</button>` : ''}
          ${caps.canReopen ? html`<button class="btn" data-act="reopen">${icon('unlock', 16)} Mở sửa đổi kế hoạch</button>` : ''}
        </div>
      </div>
      <div class="print-only"><h2 class="center">${fillYear(form.planTitle || 'BỘ CHỈ TIÊU KPI NĂM {year}')}</h2></div>
      <div class="table-wrap tall mt-2"><table class="data">
        <thead><tr><th>STT</th><th>Chỉ tiêu</th><th>Đo lường</th><th>Đơn vị đo</th><th class="num">Trọng số</th><th class="num">Ngưỡng</th><th class="num">Cơ bản</th><th class="num">Đẩy mạnh</th><th>Phương pháp tính</th><th>Tiếp nhận</th><th class="no-print"></th></tr></thead>
        <tbody>
          ${items.length ? sortedGroups.map((g) => {
            const list = byGroup.get(g);
            const gw = list.filter((i) => i.spec.state !== 'revoked' && i.spec.countInTotal !== false).reduce((s, i) => s + (Number(i.weight) || 0), 0);
            return html`<tr class="group-row"><td colspan="4">${groupName(g)}</td><td class="num">${fmt.weight(Math.round(gw * 1000) / 1000)}</td><td colspan="6"></td></tr>${list.map((i) => row(i, 0))}`;
          }) : html`<tr><td colspan="11">${ui.empty(caps.canEditOwn ? 'Chưa có chỉ tiêu. Hãy tiếp nhận KPI được giao, thêm KPI từ kho hoặc thêm KPI từ năm trước.' : 'Chưa có chỉ tiêu nào trong kế hoạch.')}</td></tr>`}
          <tr class="total-row"><td colspan="4" class="right">TỔNG TRỌNG SỐ</td><td class="num ${check.errors.some((e) => e.startsWith('Tổng trọng số')) ? 'state-invalid' : ''}">${fmt.weight(check.total)}</td><td colspan="6" class="small muted">Yêu cầu: ${policies().weight?.totalRequired ?? '—'}% ${demoBadge(policies().weight?.isDemo)}</td></tr>
        </tbody></table></div>
      <h3 class="section-title mt-3">Thống nhất giữa cán bộ quản lý và nhân sự tiếp nhận bộ chỉ tiêu</h3>
      <div class="sign-grid">${sig('employee')}${sig('manager')}${p.skipManagerId ? sig('skip') : ''}</div>
      <div class="small muted mt-1">${form.legalNote || 'Xác nhận điện tử trong hệ thống POC – không phải chữ ký số.'}</div>
      <details class="card mt-3 no-print"><summary class="card-header" style="cursor:pointer"><h3>Lịch sử giao, điều chỉnh và phê duyệt</h3></summary><div class="card-body">
        ${historyTimeline(sortedHistory(plan?.history), { itemTitles: Object.fromEntries(items.map((i) => [i.id, i.spec.title])) })}
      </div></details>`);
  };

  // ---- Hành động
  const subParents = () => itemList(plan, { includeRevoked: false }).map((i) => ({ value: i.id, label: i.spec.title }));
  const blockedApproval = (check) => openModal({
    title: 'Chưa thể phê duyệt kế hoạch',
    body: html`<div class="stack"><div>Kế hoạch chưa đạt điều kiện. Hãy <b>trả lại</b> để người lập điều chỉnh:</div><div class="alert danger"><ul>${check.errors.map((w) => html`<li>${w}</li>`)}</ul></div></div>`,
  });
  const act = {
    'add-catalog': () => catalogPicker({ periodUser: pu(), onPick: (k) => {
      const spec = specFromCatalog(k, k.id);
      itemEditor({ title: 'Thêm KPI từ kho', spec, weight: k.defaultWeight ?? '', onSave: (f, w) => addOwnItem({ periodId, userId, plan, spec: normalizeSpec(f, spec), weight: w, source: 'catalog' }).then(() => toast('Đã thêm chỉ tiêu vào kế hoạch.')) });
    } }),
    'add-previous': () => carryOverDialog({ periodId, userId, getPlan: () => plan, periodUser: pu() }),
    'add-custom': () => itemEditor({ title: 'Tạo KPI mới', spec: { direction: 'higher' }, onSave: (f, w) => addOwnItem({ periodId, userId, plan, spec: normalizeSpec(f), weight: w, source: 'custom' }).then(() => toast('Đã tạo chỉ tiêu.')) }),
    print: () => window.print(),
    submit: async () => {
      const check = validatePlan(plan, policies());
      if (check.errors.length) { toast('Kế hoạch chưa đạt điều kiện trình duyệt – xem danh sách cần xử lý.', 'error'); return; }
      const r = await confirmDialog({ title: 'Trình duyệt bộ KPI', message: `Xác nhận tiếp nhận và trình duyệt bộ ${check.counted.length} chỉ tiêu (tổng trọng số ${check.total}%). Sau khi trình, kế hoạch bị khóa cho tới khi được phê duyệt hoặc trả lại.`, confirmText: 'Xác nhận & trình duyệt', details: check.warnings.length ? html`<div class="alert warning"><ul>${check.warnings.map((w) => html`<li>${w}</li>`)}</ul></div>` : '' });
      if (!r) return;
      await submitPlan({ periodId, userId, plan });
      toast('Đã trình duyệt bộ KPI.');
    },
    'approve-manager': async () => {
      const check = validatePlan(plan, policies());
      if (check.errors.length) { blockedApproval(check); return; }
      const r = await confirmDialog({ title: 'Phê duyệt kế hoạch KPI', message: `Phê duyệt bộ KPI của ${nameOf(userId)} (tổng trọng số ${check.total}%).`, confirmText: 'Phê duyệt', details: check.warnings.length ? html`<div class="alert warning"><ul>${check.warnings.map((w) => html`<li>${w}</li>`)}</ul></div>` : '' });
      if (!r) return;
      await approvePlan({ periodId, userId, plan, stage: 'manager' });
      toast('Đã phê duyệt kế hoạch.');
    },
    'approve-skip': async () => {
      const check = validatePlan(plan, policies());
      if (check.errors.length) { blockedApproval(check); return; }
      const r = await confirmDialog({ title: 'Phê duyệt chính thức kế hoạch KPI', message: `Phê duyệt chính thức bộ KPI của ${nameOf(userId)}. Kế hoạch sẽ được khóa theo trạng thái "Đã giao".`, confirmText: 'Phê duyệt chính thức' });
      if (!r) return;
      await approvePlan({ periodId, userId, plan, stage: 'skip' });
      toast('Đã phê duyệt chính thức.');
    },
    return: async () => {
      const r = await confirmDialog({ title: 'Trả lại kế hoạch', message: `Trả lại bộ KPI cho ${nameOf(userId)} để bổ sung.`, requireReason: true, reasonLabel: 'Lý do trả lại', danger: true, confirmText: 'Trả lại' });
      if (!r) return;
      await returnPlan({ periodId, userId, plan, reason: r.reason, target: 'employee' });
      toast('Đã trả lại kế hoạch.');
    },
    'return-manager': async () => {
      const r = await confirmDialog({ title: 'Trả lại quản lý trực tiếp', message: 'Kế hoạch quay về bước quản lý trực tiếp xem xét.', requireReason: true, reasonLabel: 'Lý do', danger: true, confirmText: 'Trả lại' });
      if (!r) return;
      await returnPlan({ periodId, userId, plan, reason: r.reason, target: 'manager' });
      toast('Đã trả lại quản lý trực tiếp.');
    },
    reopen: async () => {
      const r = await confirmDialog({ title: 'Mở sửa đổi kế hoạch đã duyệt', message: 'Kế hoạch sẽ chuyển về trạng thái "Cần bổ sung" để điều chỉnh và phải được trình duyệt lại. Thao tác được ghi kiểm toán.', requireReason: true, confirmText: 'Mở sửa đổi' });
      if (!r) return;
      await reopenPlan({ periodId, userId, plan, reason: r.reason });
      toast('Đã mở sửa đổi kế hoạch.');
    },
  };
  const run = async (fn, btn) => { try { await busy(btn, fn); } catch (e) { toast(mapError(e), 'error'); } };
  on(page, 'click', '[data-act]', (e, el) => run(act[el.dataset.act], el));
  on(page, 'click', '[data-detail]', (e, el) => { e.preventDefault(); itemDetail(plan, el.dataset.detail, userId); });
  on(page, 'click', '[data-edit]', (e, el) => {
    const it = plan.items[el.dataset.edit];
    const caps = planCaps(plan, userId);
    const lockAssigned = it.spec.source === 'assigned' && !caps.canAssign;
    const hasChildren = itemList(plan).some((c) => c.spec.parentItemId === el.dataset.edit);
    itemEditor({
      title: 'Sửa chỉ tiêu', spec: it.spec, weight: it.weight, hasChildren, parentChoices: subParents().filter((o) => o.value !== el.dataset.edit),
      lockedFields: lockAssigned ? ['title', 'groupId', 'policyId', 'targets', 'levels', 'description', 'measurement', 'unit', 'direction', 'weight', 'aggregation'] : [],
      onSave: (f, w) => updateItemSpec({ periodId, userId, itemId: el.dataset.edit, item: it, spec: normalizeSpec(f, it.spec), weight: w }).then(() => toast('Đã cập nhật chỉ tiêu.')),
    });
  });
  on(page, 'click', '[data-sub]', (e, el) => {
    const parent = plan.items[el.dataset.sub];
    const base = { ...parent.spec, title: '', parentItemId: el.dataset.sub, source: 'sub', catalogRef: parent.spec.catalogRef || null };
    delete base.assignmentId; delete base.assignedBy; delete base.assignedByName; delete base.weightMode; delete base.minWeight; delete base.maxWeight; delete base.originalWeight; delete base.parentRef; delete base.aggregation; delete base.countInTotal;
    const used = itemList(plan, { includeRevoked: false }).filter((c) => c.spec.parentItemId === el.dataset.sub).reduce((s, c) => s + (Number(c.weight) || 0), 0);
    const remain = Math.max(0, Math.round((100 - used) * 1000) / 1000);
    itemEditor({
      title: `Tạo sub-KPI cho “${parent.spec.title}”${used ? ` (đã phân bổ ${used}%, còn ${remain}%)` : ''}`, spec: base, weight: remain || '', mode: 'sub', parentChoices: subParents(),
      onSave: async (f, w) => {
        const spec = normalizeSpec(f, base);
        spec.parentItemId = f.parentItemId || el.dataset.sub;
        await addOwnItem({ periodId, userId, plan, spec, weight: w, source: 'sub' });
        const total = used + (Number(w) || 0);
        toast(Math.abs(total - 100) > 0.01 ? `Đã tạo sub-KPI. Tổng tỷ lệ các sub-KPI hiện là ${Math.round(total * 1000) / 1000}% – cần bằng 100% trước khi trình duyệt.` : 'Đã tạo sub-KPI. Thiết lập cách tổng hợp tại KPI cha (Sửa → Phương pháp tổng hợp).', Math.abs(total - 100) > 0.01 ? 'warning' : 'success');
      },
    });
  });
  on(page, 'click', '[data-down]', (e, el) => { location.hash = `#/kpi/assign?source=${el.dataset.down}`; });
  on(page, 'click', '[data-del]', (e, el) => run(async () => {
    const it = plan.items[el.dataset.del];
    const r = await confirmDialog({ title: 'Xóa chỉ tiêu', message: `Xóa “${it.spec.title}” khỏi kế hoạch?`, danger: true, confirmText: 'Xóa' });
    if (!r) return;
    await deleteOwnItem({ periodId, userId, itemId: el.dataset.del, item: it, plan });
    toast('Đã xóa chỉ tiêu.');
  }, el));
  on(page, 'change', '[data-weight]', (e, el) => run(async () => {
    const it = plan.items[el.dataset.weight];
    const w = Number(el.value);
    // Một lần thay đổi chỉ mở một hộp thoại (tránh trùng sự kiện change khi mất focus).
    if (el.dataset.busy || w === Number(it.weight)) return;
    el.dataset.busy = '1';
    try {
      let reason = '';
      if (it.spec.source === 'assigned') {
        const r = await confirmDialog({ title: 'Điều chỉnh trọng số KPI được giao', message: `Đổi trọng số “${it.spec.title}” từ ${it.weight}% thành ${w}%${it.spec.weightMode === 'flex' ? ` (tối thiểu ${it.spec.minWeight}%)` : ''}.`, requireReason: true, reasonLabel: 'Lý do điều chỉnh' });
        if (!r) { el.value = it.weight; return; }
        reason = r.reason;
      }
      await setWeight({ periodId, userId, itemId: el.dataset.weight, item: it, weight: w, reason });
      toast('Đã cập nhật trọng số.');
    } catch (err) {
      el.value = it.weight;
      throw err;
    } finally {
      delete el.dataset.busy;
    }
  }, null));
  on(page, 'click', '[data-ack]', (e, el) => run(async () => {
    const it = plan.items[el.dataset.ack];
    const r = await confirmDialog({ title: 'Tiếp nhận KPI được giao', message: `Tiếp nhận “${it.spec.title}” – trọng số ${it.weight}% (${it.spec.weightMode === 'flex' ? `cho phép điều chỉnh, tối thiểu ${it.spec.minWeight}%` : 'cố định'}).`, confirmText: 'Tiếp nhận' });
    if (!r) return;
    await acknowledge({ periodId, userId, itemId: el.dataset.ack, item: it, status: 'accepted' });
    toast('Đã tiếp nhận KPI.');
  }, el));
  on(page, 'click', '[data-change]', (e, el) => changeRequestDialog(periodId, userId, plan, el.dataset.change));

  listen(planPath(periodId, userId), (v) => { plan = v; loaded = true; draw(); }, {
    key: `plan-view-${periodId}-${userId}`,
    onError: (err) => { loaded = true; render(page, err.permissionDenied ? ui.denied() : ui.error(err)); },
  });
  draw();
  return { get plan() { return plan; } };
}

export function changeRequestDialog(periodId, userId, plan, itemId) {
  const it = plan.items[itemId];
  return openModal({
    title: 'Đề nghị điều chỉnh KPI được giao',
    body: html`<form class="stack" id="cr-form">
      <div>Chỉ tiêu: <b>${it.spec.title}</b> – trọng số hiện tại <b>${it.weight}%</b> (${it.spec.weightMode === 'flex' ? `chế độ B, tối thiểu ${it.spec.minWeight}%` : 'chế độ A – cố định'}).</div>
      <div class="field"><label>Trọng số đề xuất (%)</label><input type="number" name="requestedWeight" min="0" max="100" step="any"></div>
      <div class="field"><label class="req">Nội dung đề nghị</label><textarea name="note" placeholder="Lý do, đề xuất điều chỉnh mục tiêu/trọng số…"></textarea></div>
      <div id="cr-err"></div></form>`,
    actions: [{ label: 'Hủy', value: null }, {
      label: 'Gửi đề nghị', kind: 'primary', onClick: async ({ el, close }) => {
        const f = formValues(el.querySelector('#cr-form'));
        if (!f.note.trim()) { render(el.querySelector('#cr-err'), html`<div class="alert danger"><div>Vui lòng nhập nội dung đề nghị.</div></div>`); return false; }
        try {
          await acknowledge({ periodId, userId, itemId, item: it, status: 'change_requested', note: f.note.trim(), requestedWeight: f.requestedWeight === '' ? null : Number(f.requestedWeight) });
          toast('Đã gửi đề nghị điều chỉnh tới người giao.');
          close(true);
        } catch (e) { render(el.querySelector('#cr-err'), html`<div class="alert danger"><div>${mapError(e)}</div></div>`); }
        return true;
      },
    }],
  }).result;
}

