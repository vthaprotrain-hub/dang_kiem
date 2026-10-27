/**
 * Giao KPI TOP-DOWN: chọn nguồn (KPI của tôi → sub-KPI, kho KPI, tạo mới), chọn người nhận trong phạm vi
 * quản lý, chọn chế độ trọng số A (cố định) / B (cho điều chỉnh, tối thiểu X%), lưu nháp hoặc giao chính thức.
 */
import { listen, mapError, read, DENIED } from '../services/database.service.js';
import { ctx, nameOf } from '../state.js';
import { can, myTeam } from '../permissions.js';
import { html, render, ui, fmt, toast, busy, confirmDialog, openModal, mountPage, on, formValues, raw } from '../utils.js';
import { pageHead, options, userCell } from '../components.js';
import { badge, sortedDict, policyName, demoBadge } from '../labels.js';
import { icon } from '../icons.js';
import { itemList, assignKpi, sendDraftAssignment, deleteDraftAssignment, revokeAssignment, adjustAssignment, normalizeSpec, specFromCatalog, planPath, planEditableStatus } from '../services/kpi.service.js';
import { catalogPicker } from './kpi-plan.js';
import { parseQuery } from '../router.js';

async function assignPage(container, params, query) {
  const page = mountPage(container);
  if (!ctx.periodId) { render(page, ui.empty('Chưa chọn kỳ đánh giá.')); return; }
  if (!can('assignKpi')) { render(page, ui.denied('Bạn không có quyền giao KPI.')); return; }
  const team = myTeam().sort((a, b) => (a.chain?.[ctx.userId] || 9) - (b.chain?.[ctx.userId] || 9) || a.name.localeCompare(b.name, 'vi'));
  const wp = ctx.period?.policies?.weight || {};
  const state = {
    source: query.source ? 'mine' : 'new', sourceItemId: query.source || '', catalogKpi: null,
    spec: { direction: 'higher' }, recipients: query.to ? { [query.to]: true } : {}, weights: {}, defaultWeight: '',
    mode: wp.defaultMode === 'flex' ? 'flex' : 'fixed', minWeight: wp.flexMinWeight ?? '', maxWeight: wp.flexMaxWeight ?? '', note: '',
  };
  let myPlan = null, assignments = {}, teamPlans = {};
  const open = ctx.period.status === 'open';

  const applySource = () => {
    if (state.source === 'mine' && myPlan?.items?.[state.sourceItemId]) {
      const s = myPlan.items[state.sourceItemId].spec;
      state.spec = { ...s, title: s.title, parentItemId: undefined };
      ['source', 'assignmentId', 'assignedBy', 'assignedByName', 'assignedAt', 'weightMode', 'minWeight', 'maxWeight', 'originalWeight', 'parentRef', 'aggregation', 'order', 'createdAt', 'createdBy', 'countInTotal', 'parentItemId', 'state', 'revokedAt', 'revokeReason'].forEach((k) => delete state.spec[k]);
    }
  };

  const draw = (opts = {}) => {
    // giữ lại giá trị người dùng đang nhập trước khi vẽ lại (trừ khi trạng thái vừa được đặt lại có chủ đích)
    if (opts.collect !== false && page.querySelector('#assign-form')) collect();
    const mine = itemList(myPlan, { includeRevoked: false });
    const s = state.spec;
    const t = s.targets || {};
    const scoring = ctx.period.policies?.scoring || {};
    const list = Object.entries(assignments).map(([id, a]) => ({ id, ...a })).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    render(page, html`${pageHead({ title: 'Giao KPI TOP-DOWN', sub: 'Phân bổ KPI/sub-KPI cho nhân sự thuộc phạm vi quản lý – có kiểm tra bởi Database Rules', crumbs: [['Quản lý KPI'], ['Giao KPI']] })}
      ${!open ? html`<div class="alert warning mb-2"><div>Kỳ đánh giá không ở trạng thái "Đang mở" – không thể giao KPI.</div></div>` : ''}
      ${!team.length ? html`<div class="alert info mb-2"><div>Bạn chưa có nhân sự cấp dưới trong kỳ này.</div></div>` : ''}
      <form class="card" id="assign-form" novalidate>
        <div class="card-header"><h3>1. Nguồn chỉ tiêu</h3></div>
        <div class="card-body stack">
          <div class="row">
            <label class="check"><input type="radio" name="source" value="mine" ${state.source === 'mine' ? raw('checked') : ''}> Phân rã từ KPI trong kế hoạch của tôi (sub-KPI)</label>
            <label class="check"><input type="radio" name="source" value="catalog" ${state.source === 'catalog' ? raw('checked') : ''}> Chọn từ kho KPI</label>
            <label class="check"><input type="radio" name="source" value="new" ${state.source === 'new' ? raw('checked') : ''}> Tạo chỉ tiêu mới</label>
          </div>
          ${state.source === 'mine' ? html`<div class="field"><label class="req">KPI nguồn (KPI cha)</label><select name="sourceItemId">${options(mine.map((i) => ({ value: i.id, label: `${i.spec.title} (${i.weight}%)` })), state.sourceItemId, { placeholder: mine.length ? '— Chọn KPI của tôi —' : 'Kế hoạch của bạn chưa có chỉ tiêu' })}</select><span class="help">Chỉ tiêu giao xuống sẽ liên kết với KPI cha để truy vết trên cây KPI.</span></div>` : ''}
          ${state.source === 'catalog' ? html`<div class="row"><button type="button" class="btn" data-act="pick">${icon('book', 16)} Chọn KPI từ kho</button>${state.catalogKpi ? html`<span>Đã chọn: <b>${state.catalogKpi.code}</b> – ${state.catalogKpi.name}</span>` : html`<span class="muted">Chưa chọn</span>`}</div>` : ''}
        </div>
        <div class="card-header"><h3>2. Nội dung chỉ tiêu giao</h3></div>
        <div class="card-body form-grid">
          <div class="field span-2"><label class="req">Tên chỉ tiêu</label><input name="title" value="${s.title || ''}"></div>
          <div class="field"><label class="req">Nhóm</label><select name="groupId">${options(sortedDict(ctx.config.kpiGroups).map(([id, g]) => ({ value: id, label: g.name })), s.groupId, { placeholder: '— Chọn —' })}</select></div>
          <div class="field"><label class="req">Phương pháp tính điểm</label><select name="policyId">${options(Object.entries(scoring).map(([id, p]) => ({ value: id, label: `${p.name}${p.isDemo ? ' (demo)' : ''}` })), s.scoring?.policyId, { placeholder: '— Chọn —' })}</select></div>
          <div class="field span-2"><label>Mô tả / định hướng</label><textarea name="description">${s.description || ''}</textarea></div>
          <div class="field span-2"><label>Đo lường</label><textarea name="measurement" rows="4">${s.measurement || ''}</textarea></div>
          <div class="field"><label>Đơn vị đo</label><input name="unit" value="${s.unit || ''}"></div>
          <div class="field"><label>Chiều đánh giá</label><select name="direction">${options(sortedDict(ctx.config.appSettings?.kpiDirections || {}).map(([id, d]) => ({ value: id, label: d.label })), s.direction || 'higher')}</select></div>
          <div class="field"><label>Ngưỡng</label><input name="threshold" type="number" step="any" value="${t.threshold ?? ''}"></div>
          <div class="field"><label>Cơ bản</label><input name="base" type="number" step="any" value="${t.base ?? ''}"></div>
          <div class="field"><label>Đẩy mạnh</label><input name="stretch" type="number" step="any" value="${t.stretch ?? ''}"></div>
          <div class="field"><label>Thời hạn</label><input name="deadline" type="date" value="${s.deadline || ''}"></div>
          <details class="span-2" ${s.levelDescriptions ? raw('open') : ''}><summary>Mô tả các mức (định tính)</summary><div class="form-grid mt-1">${[3, 4, 5].map((l) => html`<div class="field"><label>Mức ${l}</label><textarea name="level${l}" rows="2">${s.levelDescriptions?.[l] || ''}</textarea></div>`)}</div></details>
          <div class="field span-2"><label class="check"><input type="checkbox" name="evidenceRequired" ${s.evidenceRequired ? raw('checked') : ''}> Bắt buộc minh chứng</label></div>
        </div>
        <div class="card-header"><h3>3. Chế độ phân bổ trọng số</h3>${demoBadge(wp.isDemo)}</div>
        <div class="card-body stack">
          <label class="check"><input type="radio" name="mode" value="fixed" ${state.mode === 'fixed' ? raw('checked') : ''}> <b>Chế độ A</b> – Trọng số do cấp trên giao, người nhận không được tự điều chỉnh (gửi yêu cầu điều chỉnh nếu cần)</label>
          <label class="check"><input type="radio" name="mode" value="flex" ${state.mode === 'flex' ? raw('checked') : ''}> <b>Chế độ B</b> – Cho phép người nhận điều chỉnh trong giới hạn</label>
          ${state.mode === 'flex' ? html`<div class="form-grid cols-3"><div class="field"><label class="req">Trọng số tối thiểu X (%)</label><input type="number" name="minWeight" min="0" max="100" step="any" value="${state.minWeight}"><span class="help">Mặc định theo chính sách kỳ: ${wp.flexMinWeight ?? '—'}%</span></div><div class="field"><label>Trọng số tối đa (%)</label><input type="number" name="maxWeight" min="0" max="100" step="any" value="${state.maxWeight ?? ''}"></div></div>` : ''}
        </div>
        <div class="card-header"><h3>4. Người nhận</h3><div class="row"><label class="small">Trọng số mặc định (%)</label><input type="number" name="defaultWeight" min="0" max="100" step="any" style="width:90px" value="${state.defaultWeight}"><button type="button" class="btn sm" data-act="apply-weight">Áp dụng cho người được chọn</button></div></div>
        <div class="card-body">
          <div class="table-wrap medium"><table class="data"><thead><tr><th></th><th>Nhân sự</th><th>Quan hệ</th><th>Kế hoạch hiện tại</th><th class="num">Trọng số giao (%)</th></tr></thead><tbody>
          ${team.length ? team.map((u) => {
            const pl = teamPlans[u.id];
            const ok = planEditableStatus(pl);
            const depth = u.chain?.[ctx.userId];
            return html`<tr><td><input type="checkbox" data-rec="${u.id}" ${state.recipients[u.id] ? raw('checked') : ''} ${u.chain?.[ctx.userId] ? '' : raw('disabled title="Ủy quyền – không giao được"')}></td>
              <td>${userCell(u.id)}</td><td class="small">${depth === 1 ? 'Trực tiếp' : depth ? `Cấp dưới ${depth} cấp` : 'Được ủy quyền'}</td>
              <td>${badge('plan', pl?.status || 'none')}${!ok ? html`<div class="small state-missing">Cần trả lại/mở sửa đổi để giao chính thức</div>` : ''}</td>
              <td class="num"><input type="number" data-w="${u.id}" min="0" max="100" step="any" style="width:90px" value="${state.weights[u.id] ?? ''}"></td></tr>`;
          }) : html`<tr><td colspan="5">${ui.empty('Không có cấp dưới.')}</td></tr>`}
          </tbody></table></div>
          <div class="field mt-2"><label>Lời nhắn tới người nhận</label><textarea name="note" rows="2">${state.note}</textarea></div>
        </div>
        <div class="card-footer row end">
          <button type="button" class="btn" data-act="draft" ${open ? '' : raw('disabled')}>Lưu nháp (Chờ giao)</button>
          <button type="button" class="btn primary" data-act="assign" ${open ? '' : raw('disabled')}>${icon('send', 16)} Giao chính thức</button>
        </div>
      </form>
      <div class="card mt-3"><div class="card-header"><h3>KPI tôi đã giao trong kỳ</h3><span class="badge c-gray">${list.length}</span></div>
        <div class="table-wrap tall" style="border:0;border-radius:0"><table class="data"><thead><tr><th>Người nhận</th><th>Chỉ tiêu</th><th class="num">Trọng số</th><th>Chế độ</th><th>Trạng thái</th><th>Phản hồi</th><th>Ngày giao</th><th></th></tr></thead><tbody>
        ${list.length ? list.map((a) => html`<tr><td>${userCell(a.toId)}</td><td class="wrap-wide"><b>${a.spec?.title}</b>${a.sourceItemRef ? html`<div class="small muted">Phân rã từ: ${a.sourceItemRef.title}</div>` : ''}</td>
          <td class="num">${fmt.weight(a.weight)}</td><td>${a.weightMode === 'flex' ? `B · ≥${a.minWeight}%` : 'A · cố định'}</td><td>${badge('assignment', a.status)}</td>
          <td class="small">${a.response?.note || ''}${a.response?.requestedWeight ? html`<div><b>Đề xuất ${a.response.requestedWeight}%</b></div>` : ''}${a.revokeReason ? html`<div>Thu hồi: ${a.revokeReason}</div>` : ''}</td>
          <td class="nowrap">${fmt.datetime(a.assignedAt || a.createdAt)}</td>
          <td class="actions">${a.status === 'draft' ? html`<button class="btn xs primary" data-send="${a.id}">Giao</button> <button class="btn xs" data-deldraft="${a.id}">Xóa nháp</button>` : ''}
            ${a.status !== 'revoked' && a.status !== 'draft' ? html`<button class="btn xs" data-adjust="${a.id}">Điều chỉnh</button> <button class="btn xs outline-danger" data-revoke="${a.id}">Thu hồi</button>` : ''}
            <a class="btn xs" href="#/kpi/plan/${ctx.periodId}/${a.toId}">Kế hoạch</a></td></tr>`) : html`<tr><td colspan="8">${ui.empty('Chưa giao KPI nào.')}</td></tr>`}
        </tbody></table></div></div>`);
  };

  const collect = () => {
    const f = formValues(page.querySelector('#assign-form'));
    state.note = f.note || '';
    state.defaultWeight = f.defaultWeight || '';
    if (f.minWeight !== undefined) state.minWeight = f.minWeight;
    if (f.maxWeight !== undefined) state.maxWeight = f.maxWeight;
    state.spec = normalizeSpec({ ...f, levelDescriptions: undefined }, state.spec);
    page.querySelectorAll('[data-w]').forEach((i) => { state.weights[i.dataset.w] = i.value; });
    page.querySelectorAll('[data-rec]').forEach((i) => { state.recipients[i.dataset.rec] = i.checked; });
    return f;
  };
  const submit = async (draft) => {
    collect();
    const errs = [];
    const s = state.spec;
    if (!s.title) errs.push('Nhập tên chỉ tiêu.');
    if (!s.groupId) errs.push('Chọn nhóm chỉ tiêu.');
    if (!s.scoring?.policyId) errs.push('Chọn phương pháp tính điểm.');
    if (state.source === 'mine' && !state.sourceItemId) errs.push('Chọn KPI nguồn trong kế hoạch của bạn.');
    const rec = Object.entries(state.recipients).filter(([, v]) => v).map(([userId]) => ({ userId, weight: state.weights[userId] || state.defaultWeight }));
    if (!rec.length) errs.push('Chọn ít nhất một người nhận.');
    const minW = state.mode === 'flex' ? Number(state.minWeight) : null;
    if (state.mode === 'flex' && (!Number.isFinite(minW) || minW < 0)) errs.push('Nhập trọng số tối thiểu X%.');
    if (errs.length) { toast(errs.join(' '), 'error'); return; }
    const sourceItemRef = state.source === 'mine' ? { userId: ctx.userId, itemId: state.sourceItemId, title: myPlan.items[state.sourceItemId].spec.title } : null;
    const spec = { ...s };
    if (state.source === 'catalog' && state.catalogKpi) Object.assign(spec, { catalogRef: specFromCatalog(state.catalogKpi, state.catalogKpi.id).catalogRef });
    const r = await confirmDialog({
      title: draft ? 'Lưu nháp giao KPI' : 'Giao KPI chính thức',
      message: `${draft ? 'Lưu ở trạng thái "Chờ giao"' : 'Giao'} chỉ tiêu “${s.title}” cho ${rec.length} người (${state.mode === 'fixed' ? 'chế độ A – cố định' : `chế độ B – tối thiểu ${minW}%`}).`,
      details: html`<ul>${rec.map((x) => html`<li>${nameOf(x.userId)}: ${x.weight}%</li>`)}</ul>`,
      confirmText: draft ? 'Lưu nháp' : 'Giao KPI',
    });
    if (!r) return;
    await assignKpi({ periodId: ctx.periodId, recipients: rec, spec, weightMode: state.mode, minWeight: minW, maxWeight: state.mode === 'flex' && state.maxWeight !== '' ? Number(state.maxWeight) : null, sourceItemRef, draft, recipientPlans: teamPlans, note: state.note });
    toast(draft ? 'Đã lưu nháp (Chờ giao).' : `Đã giao KPI cho ${rec.length} người.`);
    state.recipients = {}; state.weights = {};
    draw({ collect: false });
  };
  const recipientPlan = async (toId) => {
    const v = await read(planPath(ctx.periodId, toId), { allowDenied: true });
    return v === DENIED ? null : v;
  };
  const guard = (fn) => async (e, el) => { try { await busy(el, () => fn(el)); } catch (err) { toast(mapError(err), 'error'); } };

  on(page, 'change', '[name=source]', (e, el) => { collect(); state.source = el.value; if (el.value === 'new') state.spec = { direction: 'higher' }; draw({ collect: false }); });
  on(page, 'change', '[name=sourceItemId]', (e, el) => { collect(); state.sourceItemId = el.value; applySource(); draw({ collect: false }); });
  on(page, 'change', '[name=mode]', (e, el) => { collect(); state.mode = el.value; draw({ collect: false }); });
  on(page, 'click', '[data-act=pick]', () => { collect(); catalogPicker({ title: 'Chọn KPI từ kho để giao', onPick: (k) => { state.catalogKpi = k; state.spec = specFromCatalog(k, k.id); draw({ collect: false }); } }); });
  on(page, 'click', '[data-act=apply-weight]', () => { collect(); Object.entries(state.recipients).filter(([, v]) => v).forEach(([u]) => { state.weights[u] = state.defaultWeight; }); draw({ collect: false }); });
  on(page, 'click', '[data-act=draft]', guard(() => submit(true)));
  on(page, 'click', '[data-act=assign]', guard(() => submit(false)));
  on(page, 'click', '[data-send]', guard(async (el) => {
    const a = assignments[el.dataset.send];
    const pl = await recipientPlan(a.toId);
    await sendDraftAssignment({ periodId: ctx.periodId, aid: el.dataset.send, assignment: a, recipientPlan: pl });
    toast('Đã giao chính thức.');
  }));
  on(page, 'click', '[data-deldraft]', guard(async (el) => {
    const r = await confirmDialog({ title: 'Xóa bản nháp', message: 'Xóa bản ghi giao KPI đang ở trạng thái "Chờ giao"?', danger: true, confirmText: 'Xóa' });
    if (r) await deleteDraftAssignment({ periodId: ctx.periodId, aid: el.dataset.deldraft });
  }));
  on(page, 'click', '[data-revoke]', guard(async (el) => {
    const a = assignments[el.dataset.revoke];
    const r = await confirmDialog({ title: 'Thu hồi KPI đã giao', message: `Thu hồi “${a.spec?.title}” của ${a.toName}? Chỉ tiêu được giữ lại với trạng thái "Đã thu hồi" (không tính điểm).`, requireReason: true, danger: true, confirmText: 'Thu hồi' });
    if (!r) return;
    await revokeAssignment({ periodId: ctx.periodId, aid: el.dataset.revoke, assignment: a, recipientPlan: await recipientPlan(a.toId), reason: r.reason });
    toast('Đã thu hồi KPI.');
  }));
  on(page, 'click', '[data-adjust]', guard(async (el) => {
    const aid = el.dataset.adjust;
    const a = assignments[aid];
    const pl = await recipientPlan(a.toId);
    const cur = pl?.items?.[a.itemId];
    openModal({
      title: `Điều chỉnh KPI giao cho ${a.toName}`,
      body: html`<form class="stack" id="adj-form">
        <div><b>${a.spec?.title}</b>${a.response?.requestedWeight ? html`<div class="alert info mt-1"><div>Người nhận đề xuất: <b>${a.response.requestedWeight}%</b> – ${a.response.note || ''}</div></div>` : ''}</div>
        <div class="form-grid"><div class="field"><label class="req">Trọng số mới (%)</label><input type="number" name="weight" min="0" max="100" step="any" value="${a.response?.requestedWeight ?? cur?.weight ?? a.weight}"></div>
          <div class="field"><label>Chế độ</label><select name="mode">${options([{ value: 'fixed', label: 'A – Cố định' }, { value: 'flex', label: 'B – Cho điều chỉnh' }], a.weightMode)}</select></div>
          <div class="field"><label>Tối thiểu X (%) – chế độ B</label><input type="number" name="minWeight" value="${a.minWeight ?? wp.flexMinWeight ?? ''}"></div>
          <div class="field"><label>Tối đa (%) – chế độ B</label><input type="number" name="maxWeight" value="${a.maxWeight ?? ''}"></div></div>
        <div class="field"><label class="req">Lý do điều chỉnh</label><textarea name="reason"></textarea></div><div id="adj-err"></div></form>`,
      actions: [{ label: 'Hủy', value: null }, {
        label: 'Lưu điều chỉnh', kind: 'primary', onClick: async ({ el: m, close }) => {
          const f = formValues(m.querySelector('#adj-form'));
          if (!f.reason.trim()) { render(m.querySelector('#adj-err'), html`<div class="alert danger"><div>Nhập lý do điều chỉnh.</div></div>`); return false; }
          try {
            await adjustAssignment({ periodId: ctx.periodId, aid, assignment: a, recipientPlan: pl, weight: Number(f.weight), weightMode: f.mode, minWeight: f.mode === 'flex' ? Number(f.minWeight) : null, maxWeight: f.mode === 'flex' && f.maxWeight !== '' ? Number(f.maxWeight) : null, reason: f.reason.trim() });
            toast('Đã điều chỉnh – người nhận cần tiếp nhận lại.');
            close(true);
          } catch (err) { render(m.querySelector('#adj-err'), html`<div class="alert danger"><div>${mapError(err)}</div></div>`); }
          return true;
        },
      }],
    });
  }));

  listen(planPath(ctx.periodId, ctx.userId), (v) => {
    const first = myPlan === null;
    myPlan = v || {};
    if (first && state.source === 'mine') { applySource(); draw({ collect: false }); } else draw();
  }, { key: 'assign-myplan' });
  listen(`kpiAssignments/${ctx.periodId}/${ctx.userId}`, (v) => { assignments = v || {}; draw(); }, { key: 'assign-list' });
  team.forEach((u) => listen(planPath(ctx.periodId, u.id), (v) => { teamPlans[u.id] = v; draw(); }, { key: `assign-team-${u.id}`, onError: () => {} }));
  draw({ collect: false });
}

export const routes = [{ path: '/kpi/assign', title: 'Giao KPI TOP-DOWN', render: assignPage }];
