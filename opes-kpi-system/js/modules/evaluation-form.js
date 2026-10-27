/**
 * Biểu mẫu đánh giá cá nhân theo bố cục mẫu Excel "BM KPI2025":
 *   I. Thông tin chung · I. Chỉ số KPI · III. Chỉ số KBI · IV. Tổng hợp thông tin · V. Tổng hợp đánh giá · VI. Trình ký
 * Dữ liệu được lưu theo từng trường (không ghi đè hồ sơ), đồng bộ thời gian thực; điểm tính bằng bộ máy chung.
 */
import { listen, mapError } from '../services/database.service.js';
import { ctx, nameOf, fillYear, kbiValuesFor, unitName } from '../state.js';
import { evalCaps, can } from '../permissions.js';
import { html, render, ui, fmt, toast, busy, confirmDialog, openModal, on, raw, multiline, debounce, numOrNull } from '../utils.js';
import { historyTimeline, sortedHistory } from '../components.js';
import { badge, gradeBadge, groupName, demoBadge, sortedDict } from '../labels.js';
import { icon } from '../icons.js';
import { itemList, planPath } from '../services/kpi.service.js';
import { evalPath, saveFields, computeFor, checkReady, contentHash, finalMismatch } from '../services/evaluation.service.js';
import { submitEvaluation, managerConfirm, skipApprove, returnEvaluation, lockEvaluations, unlockEvaluation, refreshFinal } from '../services/workflow.service.js';
import { unitLevel } from '../services/organization.service.js';
import { STATUS } from '../core/scoring.js';

const LEVELS = [1, 2, 3, 4, 5];

export function renderEvaluationForm(page, periodId, userId, { printMode = false } = {}) {
  let plan = null, evaluation = null, loadedPlan = false, loadedEval = false;
  let pendingRender = false;
  let saveState = { text: 'Đã đồng bộ', cls: '' };
  let currentHash = null;
  const pu = () => ctx.periodUsers[userId] || {};
  const pol = () => ctx.period?.policies || {};
  const form = () => pol().form || ctx.config.formTemplates?.default || {};

  const setSave = (text, cls = '') => { saveState = { text, cls }; const el = page.querySelector('#save-state'); if (el) { el.textContent = text; el.className = `save-state ${cls}`; } };

  const compute = () => computeFor({ plan, evaluation, periodUser: pu(), allowProvisionalGrade: true });

  const inputFor = ({ bind, stage, value, editable, kind = 'number', choices = null, rows = 2, placeholder = '' }) => {
    if (!editable || printMode) {
      if (choices) { const c = choices.find((o) => String(o.value) === String(value)); return c ? html`<span>${c.label}</span>` : html`<span class="muted">${value ?? ''}</span>`; }
      return value === null || value === undefined || value === '' ? html`<span class="muted">—</span>` : kind === 'text' ? multiline(value) : html`<span>${kind === 'number' ? fmt.number(value) : value}</span>`;
    }
    if (choices) return html`<select data-bind="${bind}" data-stage="${stage}" data-kind="${kind}"><option value="">—</option>${choices.map((o) => html`<option value="${o.value}" ${String(o.value) === String(value ?? '') ? raw('selected') : ''}>${o.label}</option>`)}</select>`;
    if (kind === 'text') return html`<textarea data-bind="${bind}" data-stage="${stage}" data-kind="text" rows="${rows}" placeholder="${placeholder}">${value ?? ''}</textarea>`;
    return html`<input type="number" step="any" data-bind="${bind}" data-stage="${stage}" data-kind="number" value="${value ?? ''}" placeholder="${placeholder}">`;
  };

  const actualChoices = (spec) => {
    const p = pol().scoring?.[spec.scoring?.policyId];
    if (p?.method === 'scale_levels') return Object.keys(p.params?.levels || {}).sort((a, b) => Number(a) - Number(b)).map((l) => ({ value: l, label: `Mức ${l}${spec.levelDescriptions?.[l] ? ` – ${String(spec.levelDescriptions[l]).slice(0, 60)}${String(spec.levelDescriptions[l]).length > 60 ? '…' : ''}` : ''}` }));
    if (p?.method === 'pass_fail' || spec.direction === 'pass_fail') return [{ value: 'pass', label: 'Đạt' }, { value: 'fail', label: 'Không đạt' }];
    return null;
  };

  const convertedCell = (row) => {
    if (!row) return html`<span class="muted">—</span>`;
    if (row.status === STATUS.EXCLUDED) return html`<span class="muted">Không tính</span>`;
    if (row.status === STATUS.MISSING) return html`<span class="state-missing" title="${row.explanation}">Chưa có dữ liệu</span>`;
    if (row.status === STATUS.INVALID) return html`<span class="state-invalid" title="${row.explanation}">Cấu hình chưa hợp lệ</span><span class="cell-sub">${row.explanation}</span>`;
    if (!row.counted) return html`<span title="${row.explanation}">${fmt.percent(row.ratio)}</span><span class="cell-sub">${row.depth ? 'tính vào KPI cha' : 'chỉ theo dõi'}</span>`;
    return html`<b>${fmt.percent(row.contribution)}</b><span class="cell-sub" title="${row.explanation}">Tỷ lệ ${fmt.percent(row.ratio)}${row.actualSource === 'manager' ? ' · theo QL' : row.actualSource === 'children' ? ' · từ sub-KPI' : ''}</span>`;
  };

  function draw() {
    if (!loadedPlan || !loadedEval) { render(page, ui.loading()); return; }
    pendingRender = false;
    const caps = evalCaps(evaluation, plan, userId);
    if (!caps.canView) { render(page, ui.denied()); return; }
    if (!plan) { render(page, html`<div class="card"><div class="card-body">${ui.empty('Nhân sự chưa có kế hoạch KPI trong kỳ này.')}</div></div>`); return; }
    const c = compute();
    const f = form();
    const sec = f.sections || {};
    const cols = f.kpiColumns || {};
    const show = (k) => cols[k]?.visible !== false;
    const lbl = (k, d) => cols[k]?.label || d;
    const p = pu();
    const items = itemList(plan);
    const rowsById = Object.fromEntries(c.kpi.rows.map((r) => [r.id, r]));
    const self = evaluation?.self || {}, mgr = evaluation?.manager || {};
    const selfEdit = caps.canSelfEdit && can('enterResults');
    const mgrEdit = caps.canManagerEdit;
    const groupsOrder = sortedDict(ctx.config.kpiGroups).map(([id]) => id);
    const tops = items.filter((i) => !i.spec.parentItemId || !plan.items[i.spec.parentItemId]);
    const grouped = new Map();
    tops.forEach((i) => { const g = i.spec.groupId || '_'; if (!grouped.has(g)) grouped.set(g, []); grouped.get(g).push(i); });
    const groupKeys = [...grouped.keys()].sort((a, b) => (groupsOrder.indexOf(a) + 1 || 99) - (groupsOrder.indexOf(b) + 1 || 99));
    const withChildren = (i, depth = 0) => [{ i, depth }, ...items.filter((x) => x.spec.parentItemId === i.id).flatMap((x) => withChildren(x, depth + 1))];
    let stt = 0;
    const visibleCols = ['stt', 'title', 'measurement', 'unit', 'weight', 'threshold', 'base', 'stretch', 'actual', 'explanation', 'converted', 'note'].filter(show);
    const colCount = visibleCols.length + (show('group') ? 1 : 0);

    const kpiRow = ({ i, depth }, groupCell) => {
      const s = i.spec;
      const r = rowsById[i.id];
      const aggregated = r?.actualSource === 'children' || (s.aggregation?.method === 'children_replace' && items.some((x) => x.spec.parentItemId === i.id));
      const choices = actualChoices(s);
      const kind = choices ? 'choice' : 'number';
      const sv = self.kpi?.[i.id] || {}, mv = mgr.kpi?.[i.id] || {};
      const revoked = s.state === 'revoked';
      const cells = {
        stt: html`<td class="center">${depth === 0 ? ++stt : ''}</td>`,
        title: html`<td class="title-cell">${depth ? raw('&nbsp;'.repeat(depth * 3) + '↳ ') : ''}<b>${s.title}</b>${s.source === 'assigned' ? html`<span class="cell-sub">Giao bởi ${s.assignedByName || nameOf(s.assignedBy)}</span>` : ''}${revoked ? html`<span class="badge c-slate">Đã thu hồi</span>` : ''}</td>`,
        measurement: html`<td class="measure"><div class="clamp" data-clamp>${s.measurement || s.description || ''}</div>${(s.measurement || '').length > 160 ? html`<button type="button" class="btn ghost xs no-print" data-more>Xem thêm</button>` : ''}${s.levelDescriptions ? html`<details class="no-print"><summary class="small">Mô tả mức</summary>${Object.entries(s.levelDescriptions).map(([l, d]) => html`<div class="small"><b>Mức ${l}:</b> ${d}</div>`)}</details>` : ''}</td>`,
        unit: html`<td>${s.unit}</td>`,
        weight: html`<td class="num">${fmt.weight(i.weight)}${depth ? html`<span class="cell-sub">trong KPI cha</span>` : ''}</td>`,
        threshold: html`<td class="num">${s.targets?.threshold ?? ''}</td>`,
        base: html`<td class="num">${s.targets?.base ?? ''}</td>`,
        stretch: html`<td class="num">${s.targets?.stretch ?? ''}</td>`,
        actual: html`<td style="min-width:130px">${aggregated ? html`<span class="muted">Tổng hợp từ sub-KPI</span>` : revoked ? '' : html`
          <div>${inputFor({ bind: `self/kpi/${i.id}/actual`, stage: 'self', value: sv.actual, editable: selfEdit, kind, choices })}</div>
          ${mgrEdit || mv.actual !== undefined ? html`<div class="mt-1"><span class="cell-sub">QL xác nhận:</span>${inputFor({ bind: `manager/kpi/${i.id}/actual`, stage: 'manager', value: mv.actual, editable: mgrEdit, kind, choices, placeholder: 'Giữ số NV' })}</div>` : ''}`}</td>`,
        explanation: html`<td style="min-width:180px">${revoked ? '' : html`${inputFor({ bind: `self/kpi/${i.id}/explanation`, stage: 'self', value: sv.explanation, editable: selfEdit, kind: 'text' })}
          ${mgrEdit || mv.comment ? html`<div class="mt-1"><span class="cell-sub">Nhận xét QL:</span>${inputFor({ bind: `manager/kpi/${i.id}/comment`, stage: 'manager', value: mv.comment, editable: mgrEdit, kind: 'text' })}</div>` : ''}`}</td>`,
        converted: html`<td class="num" data-calc="kpi:${i.id}">${convertedCell(r)}</td>`,
        note: html`<td style="min-width:170px">${revoked ? html`<span class="small">${s.revokeReason || ''}</span>` : html`${s.evidenceRequired ? html`<span class="cell-sub ${sv.evidence ? '' : 'state-missing'}">Minh chứng bắt buộc${s.evidenceNote ? `: ${s.evidenceNote}` : ''}</span>` : ''}
          ${inputFor({ bind: `self/kpi/${i.id}/evidence`, stage: 'self', value: sv.evidence, editable: selfEdit, kind: 'text', rows: 2, placeholder: 'Minh chứng / đường dẫn tài liệu' })}`}</td>`,
      };
      return html`<tr class="${depth ? 'child' : ''} ${revoked ? 'revoked' : ''}">${groupCell}${visibleCols.map((k) => cells[k])}</tr>`;
    };

    const kpiBody = groupKeys.map((g) => {
      const list = grouped.get(g).flatMap((i) => withChildren(i));
      const gw = grouped.get(g).filter((i) => i.spec.state !== 'revoked' && i.spec.countInTotal !== false).reduce((s, i) => s + (Number(i.weight) || 0), 0);
      const gc = c.kpi.groups[g];
      return html`${list.map((x, idx) => kpiRow(x, show('group') && idx === 0 ? html`<td class="group-cell" rowspan="${list.length + 1}">${groupName(g)}<div class="small">${fmt.weight(Math.round(gw * 1000) / 1000)}</div></td>` : ''))}
        <tr class="subtotal">${visibleCols.map((k) => (k === 'unit' ? html`<td class="right">Trọng số</td>` : k === 'weight' ? html`<td class="num">${fmt.weight(Math.round(gw * 1000) / 1000)}</td>` : k === 'converted' ? html`<td class="num" data-calc="group:${g}">${gc ? fmt.percent(gc.contribution) : ''}</td>` : html`<td></td>`))}</tr>`;
    });

    const kbiVals = kbiValuesFor(ctx.period, p);
    const kbiPol = pol().kbi || {};
    const capOn = kbiPol.capRules?.negativeBehavior?.enabled;
    const kbiRow = (v, idx) => {
      const k = c.kbi.rows.find((x) => x.id === v.id) || {};
      const sv = self.kbi?.[v.id] || {}, mv = mgr.kbi?.[v.id] || {};
      const pick = selfEdit ? 'self' : mgrEdit ? 'mgr' : '';
      return html`<tr>
        <td class="group-cell">${v.name}</td><td class="center">${idx + 1}</td>
        <td style="min-width:200px">${multiline(v.definition)}</td>
        ${LEVELS.map((l) => html`<td class="kbi-level ${k.self === l ? 'self' : ''} ${k.manager === l ? 'mgr' : ''} ${pick && !printMode ? 'pickable' : ''}" ${pick && !printMode ? raw(`data-pick="${pick}" data-value-id="${v.id}" data-level="${l}" title="Chọn mức ${l}"`) : ''}>
          <span class="lvl-no">${l}</span><span class="marks">${k.self === l ? html`<span class="mark self">NV</span>` : ''}${k.manager === l ? html`<span class="mark mgr">QL</span>` : ''}</span>${v.levels?.[l]?.description || ''}</td>`)}
        <td class="center"><b>${k.self ?? '—'}</b></td>
        <td class="center"><b>${k.manager ?? '—'}</b>${capOn && (mgrEdit || mv.negativeBehavior) ? html`<div class="small">${mgrEdit && !printMode ? html`<label class="check" title="${kbiPol.capRules.negativeBehavior.label}"><input type="checkbox" data-bind="manager/kbi/${v.id}/negativeBehavior" data-stage="manager" data-kind="bool" ${mv.negativeBehavior ? raw('checked') : ''}> Có hành vi mức 1–2</label>` : mv.negativeBehavior ? html`<span class="badge c-amber">Có hành vi mức 1–2</span>` : ''}</div>` : ''}</td>
        <td class="center" data-calc="kbi:${v.id}"><b>${k.official ?? '—'}</b>${k.capped ? html`<span class="cell-sub">giới hạn ≤ ${kbiPol.capRules.negativeBehavior.maxLevel}</span>` : ''}</td>
        <td style="min-width:220px">${inputFor({ bind: `self/kbi/${v.id}/examples`, stage: 'self', value: sv.examples, editable: selfEdit, kind: 'text', placeholder: 'Ví dụ hành vi thực tế, minh chứng' })}
          ${mgrEdit || mv.comment ? html`<div class="mt-1"><span class="cell-sub">Nhận xét QL:</span>${inputFor({ bind: `manager/kbi/${v.id}/comment`, stage: 'manager', value: mv.comment, editable: mgrEdit, kind: 'text' })}</div>` : ''}</td>
      </tr>`;
    };

    const sigLabels = f.signatureLabels || { employee: 'NHÂN SỰ ĐÁNH GIÁ', manager: 'QUẢN LÝ TRỰC TIẾP', skip: 'QUẢN LÝ TRÊN 1 CẤP' };
    const sig = (who) => {
      const sg = evaluation?.signatures?.[who];
      const valid = sg && evaluation.version && sg.version === evaluation.version;
      const person = who === 'employee' ? userId : who === 'manager' ? p.managerId : p.skipManagerId;
      const changed = valid && currentHash && sg.contentHash && sg.contentHash !== currentHash && !['approved', 'locked'].includes(evaluation.status);
      return html`<div class="sign-box ${valid ? 'signed' : sg ? 'stale' : ''}"><div class="sign-role">${sigLabels[who]}</div>
        <div><b>${sg ? sg.name : person ? nameOf(person) : who === 'manager' ? 'Người phê duyệt cấp cao nhất (HR)' : '—'}</b></div><div class="small muted">${sg?.title || (person ? ctx.profiles[person]?.title || '' : '')}</div>
        <div class="sign-mark">${valid ? html`✔ Đã xác nhận điện tử<br><span class="small">${fmt.datetime(sg.at)} · phiên bản ${sg.version}</span>` : sg ? html`<span class="state-missing">Xác nhận phiên bản cũ (v${sg.version})</span>` : html`<span class="muted">Chưa xác nhận</span>`}</div>
        ${changed ? html`<div class="small state-missing">Nội dung đã thay đổi sau khi xác nhận</div>` : ''}
        ${sg?.note ? html`<div class="small">Ý kiến: “${sg.note}”</div>` : ''}
        ${sg?.contentHash ? html`<div class="small muted mono" title="Mã băm nội dung đã xác nhận">#${String(sg.contentHash).slice(0, 12)}</div>` : ''}</div>`;
    };
    const mismatch = finalMismatch(evaluation, c);
    const level = p.unitId ? unitLevel(p.unitId) : '';
    const returnInfo = evaluation?.lastReturn && ['returned', 'submitted'].includes(evaluation.status) ? evaluation.lastReturn : null;

    render(page, html`
      ${evaluation?.status === 'returned' && returnInfo ? html`<div class="alert warning mb-2"><div><b>Hồ sơ cần bổ sung:</b> ${returnInfo.reason} <span class="small muted">(${nameOf(returnInfo.by)}, ${fmt.datetime(returnInfo.at)})</span></div></div>` : ''}
      ${evaluation?.status === 'submitted' && returnInfo && returnInfo.from === 'manager_reviewed' ? html`<div class="alert warning mb-2"><div><b>QL trên 1 cấp đã trả lại để đánh giá lại:</b> ${returnInfo.reason}</div></div>` : ''}
      ${!caps.planApproved ? html`<div class="alert info mb-2"><div>Kế hoạch KPI chưa được phê duyệt chính thức (${badge('plan', plan.status || 'draft')}) – chưa thể tự đánh giá.</div></div>` : ''}
      ${mismatch ? html`<div class="alert warning mb-2"><div><b>Kết quả đã lưu khác kết quả tính lại theo chính sách kỳ:</b><ul>${mismatch.map((m) => html`<li>${m}</li>`)}</ul></div></div>` : ''}
      <div class="eval-sheet">
        <div class="sheet-head"><div><div class="company">${ctx.config.appSettings?.companyName || 'Công ty Cổ phần Bảo hiểm OPES'}</div><div class="small muted">${ctx.config.appSettings?.companyAddress || ''}</div></div>
          <div class="row">${badge('evaluation', evaluation?.status || 'not_started')}${evaluation?.version ? html`<span class="badge c-gray">Phiên bản ${evaluation.version}</span>` : ''}${pol().meta?.frozenAt ? html`<span class="small muted">Chính sách kỳ chụp lúc ${fmt.datetime(pol().meta.frozenAt)}</span>` : ''}</div></div>
        <div class="sheet-title">${fillYear(f.title || 'BẢN ĐÁNH GIÁ HIỆU QUẢ CÔNG VIỆC NĂM {year}')}</div>

        <div class="part-title">${sec.general?.number || 'I'}. ${sec.general?.title || 'THÔNG TIN CHUNG'}</div>
        <div class="info-grid">
          <div><div class="info-title">Thông tin nhân viên</div><table><tbody>
            <tr><td>Họ và tên</td><td><b>${p.name || nameOf(userId)}</b></td></tr><tr><td>Mã nhân viên</td><td>${p.employeeCode || ''}</td></tr>
            <tr><td>Chức danh</td><td>${p.title || ''}</td></tr><tr><td>Đơn vị</td><td>${p.unitName || unitName(p.unitId)}</td></tr>
            <tr><td>Cấp tổ chức</td><td>Cấp ${level}</td></tr><tr><td>Kỳ đánh giá</td><td>${ctx.period?.name} (${fmt.date(ctx.period?.startDate)} – ${fmt.date(ctx.period?.endDate)})</td></tr>
          </tbody></table></div>
          <div><div class="info-title">Thông tin cấp quản lý</div><table><tbody>
            <tr><td>Quản lý trực tiếp</td><td><b>${p.managerName || (p.managerId ? nameOf(p.managerId) : 'Cấp cao nhất trong phạm vi – HR phê duyệt')}</b></td></tr>
            <tr><td>Chức danh</td><td>${p.managerTitle || ''}</td></tr>
            <tr><td>Quản lý trên một cấp</td><td><b>${p.skipManagerName || (p.skipManagerId ? nameOf(p.skipManagerId) : '—')}</b></td></tr>
            <tr><td>Chức danh</td><td>${p.skipManagerTitle || ''}</td></tr>
          </tbody></table></div>
        </div>

        <div class="part-title">${sec.kpi?.number || 'I'}. ${sec.kpi?.title || 'CHỈ SỐ KPI (KEY PERFORMANCE INDICATOR)'} ${demoBadge(Object.values(pol().scoring || {}).some((x) => x.isDemo), 'Công thức demo – cần HR xác nhận')}</div>
        <div class="table-wrap tall"><table class="sheet">
          <thead><tr>${show('group') ? html`<th rowspan="2">${lbl('group', 'Nhóm chỉ tiêu')}</th>` : ''}${['stt', 'title', 'measurement', 'unit', 'weight'].filter(show).map((k) => html`<th rowspan="2">${lbl(k, k)}</th>`)}
            ${['threshold', 'base', 'stretch'].some(show) ? html`<th colspan="${['threshold', 'base', 'stretch'].filter(show).length}">${fillYear(f.targetGroupLabel || 'Mục tiêu cả năm {year}')}</th>` : ''}
            ${['actual', 'explanation', 'converted', 'note'].some(show) ? html`<th colspan="${['actual', 'explanation', 'converted', 'note'].filter(show).length}">${fillYear(f.resultGroupLabel || 'Kết quả KPIs năm {year}')}</th>` : ''}</tr>
            <tr>${['threshold', 'base', 'stretch', 'actual', 'explanation', 'converted', 'note'].filter(show).map((k) => html`<th>${lbl(k, k)}</th>`)}</tr></thead>
          <tbody>${kpiBody}
            <tr class="total"><td colspan="${colCount}" style="padding:0"></td></tr>
            <tr class="total">${show('group') ? html`<td></td>` : ''}${visibleCols.map((k) => (k === 'title' ? html`<td class="right">TỔNG TRỌNG SỐ</td>` : k === 'weight' ? html`<td class="num ${c.kpi.weightValid === false ? 'state-invalid' : ''}">${fmt.weight(c.kpi.totalWeight)}</td>` : html`<td></td>`))}</tr>
            <tr class="total">${show('group') ? html`<td></td>` : ''}${visibleCols.map((k) => (k === 'title' ? html`<td class="right">Mức độ hoàn thành KPI</td>` : k === 'converted' ? html`<td class="num" data-calc="kpi-total">${c.kpi.total !== null ? html`<b>${fmt.percent(c.kpi.total)}</b>` : html`<span class="state-missing">Tạm tính ${fmt.percent(c.kpi.provisionalTotal)}</span>`}</td>` : html`<td></td>`))}</tr>
          </tbody></table></div>
        ${c.kpi.notes.length ? html`<div class="small muted mt-1" data-calc="kpi-notes">${c.kpi.notes.join(' · ')}</div>` : html`<div data-calc="kpi-notes"></div>`}

        <div class="part-title">${sec.kbi?.number || 'III'}. ${sec.kbi?.title || 'CHỈ SỐ KBI (KEY BEHAVIOR INDICATOR)'} ${demoBadge(kbiPol.isDemo)}</div>
        <div class="small muted mb-1">${f.kbiIntro || ''} ${selfEdit ? 'Bấm vào ô mô tả hành vi để chọn mức tự đánh giá.' : mgrEdit ? 'Bấm vào ô mô tả hành vi để chọn mức quản lý đánh giá.' : ''}</div>
        <div class="table-wrap tall"><table class="sheet">
          <thead><tr><th>Giá trị cốt lõi</th><th>STT</th><th>Định nghĩa</th>${LEVELS.map((l) => html`<th>${l}</th>`)}<th>Cá nhân tự đánh giá</th><th>Quản lý đánh giá</th><th>Kết quả</th><th>Minh chứng và nhận xét</th></tr></thead>
          <tbody>${kbiVals.length ? kbiVals.map(kbiRow) : html`<tr><td colspan="12">${ui.empty('Kỳ chưa có giá trị cốt lõi áp dụng.')}</td></tr>`}
            <tr class="total"><td colspan="8" class="right">Điểm KBI (${kbiPol.aggregate === 'weighted' ? 'trung bình có trọng số' : 'trung bình'} – kết quả chính thức theo ${({ manager: 'điểm quản lý', self: 'điểm tự đánh giá', manager_else_self: 'điểm QL, nếu không có lấy tự đánh giá', average: 'trung bình hai điểm' })[kbiPol.officialSource] || 'cấu hình'})</td>
              <td class="center">${c.kbi.rows.length ? fmt.number(avgOf(c.kbi.rows.map((r) => r.self)), 2) : '—'}</td><td class="center">${c.kbi.rows.length ? fmt.number(avgOf(c.kbi.rows.map((r) => r.manager)), 2) : '—'}</td>
              <td class="center" data-calc="kbi-avg">${c.kbi.average !== null ? html`<b>${fmt.number(c.kbi.average, 2)}</b>` : html`<span class="state-missing">${c.kbi.provisionalAverage !== null ? `Tạm tính ${fmt.number(c.kbi.provisionalAverage, 2)}` : 'Chưa đủ'}</span>`}</td><td></td></tr>
          </tbody></table></div>

        <div class="part-title">${sec.summary?.number || 'IV'}. ${sec.summary?.title || 'TỔNG HỢP THÔNG TIN'} ${demoBadge(pol().grading?.isDemo)}</div>
        <div data-calc="summary">${summaryBlock(c, f)}</div>

        <div class="part-title">${sec.review?.number || 'V'}. ${sec.review?.title || 'TỔNG HỢP ĐÁNH GIÁ'}</div>
        <table class="sheet"><thead><tr><th style="width:24%">Nội dung</th><th>Nhân sự tự nhận xét</th><th>Quản lý nhận xét</th></tr></thead><tbody>
          ${Object.entries(f.reviewRows || { strengths: 'Điểm mạnh & tiếp tục phát huy', improvements: 'Điểm cần cải thiện', proposals: 'Đề xuất (kế hoạch phát triển, chế độ..)' }).map(([k, label], idx) => html`<tr><td><b>${idx + 1}. ${label}</b></td>
            <td>${inputFor({ bind: `self/summary/${k}`, stage: 'self', value: self.summary?.[k], editable: selfEdit && pol().workflow?.evaluation?.allowEmployeeSummary !== false, kind: 'text', rows: 3 })}</td>
            <td>${inputFor({ bind: `manager/summary/${k}`, stage: 'manager', value: mgr.summary?.[k], editable: mgrEdit, kind: 'text', rows: 3 })}</td></tr>`)}
        </tbody></table>
        ${caps.canSkipAct || evaluation?.skip?.comment ? html`<div class="field mt-2"><label>Ý kiến của quản lý trên một cấp</label>${inputFor({ bind: 'skip/comment', stage: 'skip', value: evaluation?.skip?.comment, editable: caps.canSkipAct, kind: 'text', rows: 2 })}</div>` : ''}

        <div class="part-title">${sec.sign?.number || 'VI'}. ${sec.sign?.title || 'TRÌNH KÝ, PHÊ DUYỆT VÀ LƯU TRỮ'}</div>
        <div class="sign-grid">${sig('employee')}${sig('manager')}${p.skipManagerId || evaluation?.signatures?.skip ? sig('skip') : html`<div class="sign-box"><div class="sign-role">${sigLabels.skip}</div><div class="muted small">Không áp dụng (không có quản lý trên một cấp trong phạm vi)</div></div>`}</div>
        <div class="small muted mt-1">${f.legalNote || ''}</div>
      </div>
      ${!printMode ? html`
      <details class="card mt-3 no-print"><summary class="card-header" style="cursor:pointer"><h3>Lịch sử hồ sơ & các lần trả lại</h3></summary><div class="card-body">
        ${historyTimeline(sortedHistory(evaluation?.history))}
      </div></details>
      <div class="action-bar no-print">
        <div class="row"><span class="save-state ${saveState.cls}" id="save-state">${saveState.text}</span></div>
        <div class="btn-group">
          <a class="btn" href="#/eval/print/${periodId}/${userId}">${icon('printer', 16)} Xem trước bản in</a>
          ${selfEdit ? html`<button class="btn primary" data-act="submit">Hoàn tất & gửi quản lý</button>` : ''}
          ${mgrEdit ? html`<button class="btn outline-danger" data-act="return-employee">Trả lại nhân viên</button><button class="btn primary" data-act="manager-confirm">${caps.reqSkip ? 'Xác nhận đánh giá & trình duyệt' : 'Xác nhận & phê duyệt'}</button>` : ''}
          ${caps.canSkipAct ? html`${caps.allowSkipReturnToManager ? html`<button class="btn outline-danger" data-act="return-manager">Trả lại QL trực tiếp</button>` : ''}<button class="btn outline-danger" data-act="return-employee">Trả lại nhân viên</button><button class="btn primary" data-act="skip-approve">Phê duyệt kết quả</button>` : ''}
          ${caps.canLock ? html`<button class="btn" data-act="lock">${icon('lock', 16)} Khóa hồ sơ</button>` : ''}
          ${caps.canUnlock ? html`<button class="btn outline-danger" data-act="unlock">${icon('unlock', 16)} Mở khóa ngoại lệ</button>` : ''}
        </div>
      </div>` : ''}`);
    contentHash(plan, evaluation).then((h) => {
      if (h !== currentHash) { currentHash = h; if (evaluation?.signatures && !editing() && page.isConnected) draw(); }
    });
  }

  const avgOf = (xs) => { const v = xs.filter((x) => x !== null && x !== undefined); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };

  function summaryBlock(c, f) {
    const rowsL = f.summaryRows || { kpi: 'Điểm KPI', kbi: 'Điểm KBI', grade: 'Điểm xếp loại' };
    const g = c.grade;
    const final = evaluation?.final;
    return html`<table class="summary-table"><thead><tr><th>STT</th><th>Nội dung</th><th>Kết quả</th></tr></thead><tbody>
      <tr><td class="center">1.</td><td>${rowsL.kpi}</td><td class="num">${c.kpi.total !== null ? html`<b>${fmt.percent(c.kpi.total)}</b>` : html`<span class="state-missing">Chưa đủ dữ liệu (tạm tính ${fmt.percent(c.kpi.provisionalTotal)})</span>`}</td></tr>
      <tr><td class="center">2.</td><td>${rowsL.kbi}</td><td class="num">${c.kbi.average !== null ? html`<b>${fmt.number(c.kbi.average, 2)}</b>` : html`<span class="state-missing">Chưa đủ dữ liệu</span>`}</td></tr>
      <tr><td class="center">3.</td><td>${rowsL.grade}</td><td>${g.status === 'official' ? html`${gradeBadge(g)}${g.score !== undefined ? html` <span class="small">(${g.score})</span>` : ''}` : html`<span class="badge c-gray">Chưa có xếp loại chính thức</span>${g.status === 'provisional' ? html` <span class="small muted">Tạm tính: ${g.label}</span>` : ''}`}</td></tr>
    </tbody></table>
    ${g.status !== 'official' && g.reasons?.length ? html`<div class="alert info mt-1"><div><b>Các phần còn thiếu:</b><ul>${g.reasons.map((r) => html`<li>${r}</li>`)}</ul></div></div>` : ''}
    ${final ? html`<div class="small muted mt-1">Kết quả đã lưu khi phê duyệt: KPI ${final.kpiPercent ?? '—'}% · KBI ${final.kbiScore ?? '—'} · ${final.gradeLabel || '—'} (${nameOf(final.computedBy)}, ${fmt.datetime(final.computedAt)})</div>` : ''}`;
  }

  /** Cập nhật các ô tính toán khi chưa thể vẽ lại toàn bộ (người dùng đang nhập). */
  function patchComputed() {
    if (!plan) return;
    const c = compute();
    const byId = Object.fromEntries(c.kpi.rows.map((r) => [r.id, r]));
    page.querySelectorAll('[data-calc]').forEach((el) => {
      const [k, id] = el.dataset.calc.split(':');
      if (k === 'kpi' && id) render(el, convertedCell(byId[id]));
      else if (k === 'group') render(el, c.kpi.groups[id] ? fmt.percent(c.kpi.groups[id].contribution) : '');
      else if (k === 'kpi-total') render(el, c.kpi.total !== null ? html`<b>${fmt.percent(c.kpi.total)}</b>` : html`<span class="state-missing">Tạm tính ${fmt.percent(c.kpi.provisionalTotal)}</span>`);
      else if (k === 'kpi-notes') render(el, c.kpi.notes.join(' · '));
      else if (k === 'kbi' && id) { const r = c.kbi.rows.find((x) => x.id === id); render(el, html`<b>${r?.official ?? '—'}</b>`); }
      else if (k === 'kbi-avg') render(el, c.kbi.average !== null ? html`<b>${fmt.number(c.kbi.average, 2)}</b>` : html`<span class="state-missing">Chưa đủ</span>`);
      else if (k === 'summary') render(el, summaryBlock(c, form()));
    });
  }

  const editing = () => { const a = document.activeElement; return a && page.contains(a) && ['INPUT', 'TEXTAREA', 'SELECT'].includes(a.tagName) && a.dataset.bind; };
  const schedule = () => { if (editing()) { pendingRender = true; patchComputed(); } else draw(); };
  page.addEventListener('focusout', () => setTimeout(() => { if (pendingRender && !editing()) draw(); }, 50));

  // ---- Lưu trường
  const localSet = (bind, value) => {
    evaluation = evaluation || {};
    const parts = bind.split('/');
    let o = evaluation;
    for (let i = 0; i < parts.length - 1; i++) { o[parts[i]] = o[parts[i]] && typeof o[parts[i]] === 'object' ? { ...o[parts[i]] } : {}; o = o[parts[i]]; }
    if (value === null) delete o[parts[parts.length - 1]]; else o[parts[parts.length - 1]] = value;
  };
  const save = async (el) => {
    const bind = el.dataset.bind;
    const kind = el.dataset.kind;
    let value;
    if (kind === 'bool') value = el.checked;
    else if (kind === 'number') { value = numOrNull(el.value); if (el.value.trim() !== '' && value === null) { el.classList.add('invalid'); setSave('Giá trị không phải số', 'error'); return; } }
    else if (kind === 'choice') value = el.value === '' ? null : (/^\d+(\.\d+)?$/.test(el.value) ? Number(el.value) : el.value);
    else value = el.value.trim() === '' ? null : el.value;
    el.classList.remove('invalid');
    const before = JSON.stringify(evaluation);
    localSet(bind, value);
    if (el.dataset.stage === 'self' && !evaluation.status) evaluation.status = 'draft'; // lần ghi đầu sẽ tạo hồ sơ Nháp
    patchComputed();
    setSave('Đang lưu…', 'saving');
    try {
      await saveFields(periodId, userId, JSON.parse(before), { [bind]: value }, { stage: el.dataset.stage });
      setSave(`Đã lưu lúc ${new Date().toLocaleTimeString('vi-VN')}`);
    } catch (e) {
      setSave('Lưu thất bại', 'error');
      toast(mapError(e), 'error');
    }
  };
  const saveDebounced = new Map();
  on(page, 'change', '[data-bind]', (e, el) => { saveDebounced.get(el)?.flush?.(); save(el); });
  on(page, 'input', 'textarea[data-bind]', (e, el) => {
    if (!saveDebounced.has(el)) saveDebounced.set(el, debounce(() => save(el), 1200));
    setSave('Chưa lưu…', 'saving');
    saveDebounced.get(el)();
  });
  on(page, 'click', '[data-pick]', (e, el) => {
    const stage = el.dataset.pick === 'self' ? 'self' : 'manager';
    const bind = `${stage}/kbi/${el.dataset.valueId}/level`;
    const fake = { dataset: { bind, kind: 'choice', stage }, value: el.dataset.level, classList: { add() {}, remove() {} } };
    save(fake).then(() => { if (!editing()) draw(); });
  });
  on(page, 'click', '[data-more]', (e, el) => { const c = el.previousElementSibling; c.classList.toggle('open'); el.textContent = c.classList.contains('open') ? 'Thu gọn' : 'Xem thêm'; });

  // ---- Chuyển bước quy trình
  const readyDialog = async (stage, title, message, confirmText) => {
    const c = compute();
    const { errors, warnings } = checkReady(stage, { plan, evaluation, computed: c });
    if (errors.length) {
      await confirmDialog({ title: 'Chưa đủ điều kiện', message: 'Vui lòng hoàn thiện các nội dung sau:', details: html`<div class="alert danger"><ul>${errors.map((x) => html`<li>${x}</li>`)}</ul></div>`, confirmText: 'Đã hiểu', cancelText: 'Đóng' });
      return null;
    }
    const r = await confirmDialog({ title, message, confirmText, details: html`${warnings.length ? html`<div class="alert warning"><ul>${warnings.map((x) => html`<li>${x}</li>`)}</ul></div>` : ''}<div class="small muted">Điểm KPI: ${c.kpi.total !== null ? fmt.percent(c.kpi.total) : `tạm tính ${fmt.percent(c.kpi.provisionalTotal)}`} · KBI: ${c.kbi.average ?? c.kbi.provisionalAverage ?? '—'} · Xếp loại: ${c.grade.label || '—'}</div><div class="small muted">Đây là xác nhận điện tử trong hệ thống POC (lưu người thao tác, thời điểm, phiên bản nội dung) – không phải chữ ký số.</div>` });
    return r ? { computed: compute() } : null;
  };
  const actions = {
    submit: async () => {
      const ok = await readyDialog('employee', 'Gửi tự đánh giá', 'Sau khi gửi, bạn không thể sửa trừ khi quản lý trả lại hồ sơ.', 'Xác nhận & gửi');
      if (!ok) return;
      await submitEvaluation({ periodId, userId, plan, evaluation });
      toast('Đã gửi hồ sơ cho quản lý trực tiếp.');
    },
    'manager-confirm': async () => {
      const caps = evalCaps(evaluation, plan, userId);
      const ok = await readyDialog('manager', caps.reqSkip ? 'Xác nhận đánh giá & trình duyệt' : 'Xác nhận & phê duyệt', caps.reqSkip ? `Hồ sơ sẽ chuyển tới ${pu().skipManagerName || 'quản lý trên một cấp'} phê duyệt.` : 'Không có quản lý trên một cấp – kết quả sẽ được phê duyệt.', 'Xác nhận');
      if (!ok) return;
      await managerConfirm({ periodId, userId, plan, evaluation, computed: ok.computed });
      toast('Đã xác nhận đánh giá.');
    },
    'skip-approve': async () => {
      const ok = await readyDialog('skip', 'Phê duyệt kết quả đánh giá', 'Kết quả cuối kỳ (KPI, KBI, xếp loại) sẽ được lưu theo chính sách của kỳ.', 'Phê duyệt');
      if (!ok) return;
      await skipApprove({ periodId, userId, plan, evaluation, computed: ok.computed });
      toast('Đã phê duyệt kết quả.');
    },
    'return-employee': async () => {
      const r = await confirmDialog({ title: 'Trả lại nhân viên bổ sung', message: `Hồ sơ của ${nameOf(userId)} chuyển sang trạng thái "Cần bổ sung".`, requireReason: true, reasonLabel: 'Lý do trả lại', danger: true, confirmText: 'Trả lại' });
      if (!r) return;
      await returnEvaluation({ periodId, userId, evaluation, reason: r.reason, target: 'employee' });
      toast('Đã trả lại hồ sơ.');
    },
    'return-manager': async () => {
      const r = await confirmDialog({ title: 'Trả lại quản lý trực tiếp', message: 'Hồ sơ quay về bước quản lý trực tiếp đánh giá lại.', requireReason: true, danger: true, confirmText: 'Trả lại' });
      if (!r) return;
      await returnEvaluation({ periodId, userId, evaluation, reason: r.reason, target: 'manager' });
      toast('Đã trả lại quản lý trực tiếp.');
    },
    lock: async () => {
      const r = await confirmDialog({ title: 'Khóa hồ sơ', message: 'Sau khi khóa, kết quả chỉ được mở lại bằng thao tác mở khóa ngoại lệ có lý do.', confirmText: 'Khóa' });
      if (!r) return;
      const c = compute();
      if (finalMismatch(evaluation, c)) await refreshFinal({ periodId, userId, evaluation, computed: c });
      await lockEvaluations(periodId, [{ userId, evaluation }]);
      toast('Đã khóa hồ sơ.');
    },
    unlock: () => new Promise((resolve) => {
      openModal({
        title: 'Mở khóa ngoại lệ',
        body: html`<div class="stack"><div>Hồ sơ sẽ được trả về để điều chỉnh. Thao tác được ghi lịch sử kiểm toán (người thực hiện, thời điểm, lý do).</div>
          <div class="field"><label>Trả về bước</label><select id="unlock-target"><option value="employee">Nhân viên bổ sung</option><option value="manager">Quản lý trực tiếp đánh giá lại</option></select></div>
          <div class="field"><label class="req">Lý do mở khóa</label><textarea id="unlock-reason"></textarea></div><div id="unlock-err"></div></div>`,
        actions: [{ label: 'Hủy', value: null }, { label: 'Mở khóa', kind: 'danger', onClick: async ({ el, close }) => {
          const reason = el.querySelector('#unlock-reason').value.trim();
          if (!reason) { render(el.querySelector('#unlock-err'), html`<div class="alert danger"><div>Nhập lý do.</div></div>`); return false; }
          try {
            await unlockEvaluation({ periodId, userId, evaluation, reason, target: el.querySelector('#unlock-target').value });
            toast('Đã mở khóa hồ sơ.');
            close(true);
          } catch (err) { render(el.querySelector('#unlock-err'), html`<div class="alert danger"><div>${mapError(err)}</div></div>`); }
          return true;
        } }],
        onClose: resolve,
      });
    }),
  };
  on(page, 'click', '[data-act]', (e, el) => busy(el, async () => { try { await actions[el.dataset.act](); } catch (err) { toast(mapError(err), 'error'); } }));

  listen(planPath(periodId, userId), (v) => { plan = v; loadedPlan = true; schedule(); }, { key: `ef-plan-${periodId}-${userId}`, onError: (e) => { loadedPlan = true; render(page, e.permissionDenied ? ui.denied() : ui.error(e)); } });
  listen(evalPath(periodId, userId), (v) => { evaluation = v; loadedEval = true; schedule(); }, { key: `ef-eval-${periodId}-${userId}`, onError: (e) => { loadedEval = true; render(page, e.permissionDenied ? ui.denied() : ui.error(e)); } });
  draw();
}
