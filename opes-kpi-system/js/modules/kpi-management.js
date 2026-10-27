/**
 * Phân hệ Quản lý KPI: KPI của tôi, xem kế hoạch nhân sự, KPI đội nhóm, KPI theo đơn vị,
 * nhận KPI được giao, lịch sử giao & điều chỉnh.
 */
import { listen, mapError } from '../services/database.service.js';
import { ctx, nameOf, unitName } from '../state.js';
import { can, myTeam, relationTo, seesAll } from '../permissions.js';
import { html, render, ui, fmt, toast, busy, confirmDialog, mountPage, on, matches, raw } from '../utils.js';
import { pageHead, userCell, options, progress, historyTimeline, actionLabel, tabs } from '../components.js';
import { badge, sourceBadge } from '../labels.js';
import { renderPlanView, changeRequestDialog } from './kpi-plan.js';
import { itemList, acknowledge, planPath } from '../services/kpi.service.js';
import { watchScope, buildRows } from '../services/report.service.js';
import { buildUnitTree, unitDescendants } from '../services/organization.service.js';

const needPeriod = (page) => {
  if (ctx.periodId) return false;
  render(page, ui.empty('Chưa có kỳ đánh giá đang chọn.'));
  return true;
};

async function myKpi(container) {
  const page = mountPage(container);
  if (needPeriod(page)) return;
  render(page, html`${pageHead({ title: 'KPI của tôi', sub: `${ctx.period.name} – xây dựng, tiếp nhận và trình duyệt bộ chỉ tiêu cá nhân`, crumbs: [['Quản lý KPI'], ['KPI của tôi']] })}<div id="plan-area"></div>`);
  if (!ctx.periodUser) { render(page.querySelector('#plan-area'), ui.empty('Bạn không thuộc danh sách nhân sự được đánh giá trong kỳ này.')); return; }
  renderPlanView(page.querySelector('#plan-area'), ctx.periodId, ctx.userId);
}

async function planOf(container, params) {
  const page = mountPage(container);
  const { periodId, userId } = params;
  if (periodId !== ctx.periodId) {
    render(page, html`<div class="alert info"><div>Kế hoạch thuộc kỳ <b>${ctx.periods[periodId]?.name || periodId}</b>. Vui lòng chọn kỳ này ở thanh tiêu đề để xem.</div></div>`);
    return;
  }
  const pu = ctx.periodUsers[userId];
  render(page, html`${pageHead({ title: `Kế hoạch KPI – ${pu?.name || nameOf(userId)}`, sub: ctx.period.name, crumbs: [['Quản lý KPI'], ['KPI đội nhóm', '#/kpi/team'], [pu?.name || userId]] })}<div id="plan-area"></div>`);
  renderPlanView(page.querySelector('#plan-area'), periodId, userId);
}

async function teamKpi(container) {
  const page = mountPage(container);
  if (needPeriod(page)) return;
  const f = { q: '', scope: seesAll() ? 'all' : 'chain', status: '' };
  let data = null;
  const draw = () => {
    if (!data) { render(page, ui.loading()); return; }
    let rows = buildRows(data).filter((r) => r.userId !== ctx.userId || f.scope === 'all');
    if (f.scope === 'direct') rows = rows.filter((r) => relationTo(r.userId).directManager);
    if (f.status) rows = rows.filter((r) => r.planStatus === f.status);
    rows = rows.filter((r) => matches(f.q, r.name, r.unitName, r.title));
    render(page, html`${pageHead({ title: 'KPI đội nhóm', sub: 'Theo dõi kế hoạch KPI, phạm vi giao và trọng số của nhân sự thuộc phạm vi quản lý', crumbs: [['Quản lý KPI'], ['KPI đội nhóm']], actions: can('assignKpi') && myTeam().length ? html`<a class="btn primary" href="#/kpi/assign">Giao KPI TOP-DOWN</a>` : '' })}
      <div class="toolbar">
        <div class="field search"><label>Tìm kiếm</label><input type="search" data-f="q" value="${f.q}" placeholder="Tên, đơn vị, chức danh"></div>
        <div class="field"><label>Phạm vi</label><select data-f="scope">${options([...(seesAll() ? [{ value: 'all', label: 'Toàn bộ nhân sự trong kỳ' }] : []), { value: 'chain', label: 'Mọi cấp dưới' }, { value: 'direct', label: 'Cấp dưới trực tiếp' }], f.scope)}</select></div>
        <div class="field"><label>Trạng thái kế hoạch</label><select data-f="status">${options(['none', 'draft', 'submitted', 'manager_approved', 'approved', 'returned'].map((s) => ({ value: s, label: badgeText(s) })), f.status, { placeholder: 'Tất cả' })}</select></div>
      </div>
      <div class="table-wrap tall"><table class="data"><thead><tr><th>Nhân sự</th><th>Đơn vị</th><th>Quan hệ</th><th>Kế hoạch</th><th class="num">Chỉ tiêu</th><th class="num">Được giao</th><th class="num">Sub-KPI</th><th class="num">Chờ tiếp nhận</th><th class="num">Đề nghị điều chỉnh</th><th class="num">Tổng trọng số</th><th></th></tr></thead><tbody>
        ${rows.length ? rows.map((r) => {
          const rel = relationTo(r.userId);
          return html`<tr><td>${userCell(r.userId)}</td><td>${r.unitName}</td><td class="small">${rel.self ? 'Bản thân' : rel.directManager ? 'Trực tiếp' : rel.depth ? `Cấp dưới ${rel.depth} cấp` : '—'}</td>
          <td>${badge('plan', r.planStatus)}</td><td class="num">${r.itemsCount}</td><td class="num">${r.assignedCount}</td><td class="num">${r.subCount}</td>
          <td class="num">${r.pendingAck ? html`<span class="badge c-purple">${r.pendingAck}</span>` : 0}</td><td class="num">${r.changeRequests ? html`<span class="badge c-red">${r.changeRequests}</span>` : 0}</td>
          <td class="num">${r.itemsCount ? html`<span class="${r.weightValid ? '' : 'state-invalid'}">${fmt.weight(r.weightTotal)}</span>` : '—'}</td>
          <td class="actions"><a class="btn sm" href="#/kpi/plan/${ctx.periodId}/${r.userId}">Xem kế hoạch</a>${can('assignKpi') && rel.inChain ? html` <a class="btn sm" href="#/kpi/assign?to=${r.userId}">Giao KPI</a>` : ''}</td></tr>`;
        }) : html`<tr><td colspan="11">${ui.empty('Không có nhân sự phù hợp.')}</td></tr>`}
      </tbody></table></div>`);
  };
  on(page, 'input', '[data-f=q]', (e, el) => { f.q = el.value; const pos = el.selectionStart; draw(); const n = page.querySelector('[data-f=q]'); n.focus(); n.setSelectionRange(pos, pos); });
  on(page, 'change', 'select[data-f]', (e, el) => { f[el.dataset.f] = el.value; draw(); });
  watchScope(ctx.periodId, (d) => { data = d; draw(); });
  draw();
}
const badgeText = (s) => ({ none: 'Chưa có kế hoạch', draft: 'Nháp', submitted: 'Chờ phê duyệt', manager_approved: 'Chờ QL trên 1 cấp', approved: 'Đã giao', returned: 'Cần bổ sung' }[s] || s);

async function unitKpi(container) {
  const page = mountPage(container);
  if (needPeriod(page)) return;
  let data = null;
  let selected = null;
  const draw = () => {
    if (!data) { render(page, ui.loading()); return; }
    const rows = buildRows(data);
    const unitsInScope = new Set(rows.map((r) => r.unitId));
    const tree = buildUnitTree(ctx.units, { includeArchived: false });
    const countIn = (id) => { const d = unitDescendants(id); return rows.filter((r) => d.has(r.unitId)); };
    if (!selected) selected = tree[0]?.id || null;
    const subRows = selected ? countIn(selected) : rows;
    const node = (n) => {
      const c = countIn(n.id);
      if (!c.length && !unitsInScope.has(n.id)) return '';
      const approved = c.filter((r) => r.planStatus === 'approved').length;
      return html`<li><div class="node ${n.id === selected ? 'selected' : ''}" data-unit="${n.id}" style="cursor:pointer"><span>${n.name}</span><span class="meta">${approved}/${c.length} KH đã giao</span></div>${n.children.length ? html`<ul>${n.children.map(node)}</ul>` : ''}</li>`;
    };
    const avg = (arr) => (arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : null);
    const kpis = subRows.map((r) => r.kpi).filter((x) => x !== null);
    render(page, html`${pageHead({ title: 'KPI theo đơn vị', sub: 'Mức độ bao phủ kế hoạch, trọng số và kết quả theo cây tổ chức', crumbs: [['Quản lý KPI'], ['KPI theo đơn vị']] })}
      <div class="grid" style="grid-template-columns:minmax(240px,340px) minmax(0,1fr)">
        <div class="card"><div class="card-header"><h3>Cây đơn vị</h3></div><div class="card-body"><ul class="tree">${tree.map(node)}</ul></div></div>
        <div class="stack">
          <div class="grid cols-4">
            <div class="stat"><span class="label">Nhân sự</span><span class="value">${subRows.length}</span><span class="hint">${unitName(selected)}</span></div>
            <div class="stat"><span class="label">Kế hoạch đã giao</span><span class="value">${subRows.filter((r) => r.planStatus === 'approved').length}</span></div>
            <div class="stat ${subRows.some((r) => r.itemsCount && !r.weightValid) ? 'warn' : ''}"><span class="label">Trọng số chưa hợp lệ</span><span class="value">${subRows.filter((r) => r.itemsCount && !r.weightValid).length}</span></div>
            <div class="stat"><span class="label">KPI bình quân (đã đủ dữ liệu)</span><span class="value">${kpis.length ? fmt.percent(avg(kpis)) : '—'}</span><span class="hint">${kpis.length} hồ sơ</span></div>
          </div>
          <div class="table-wrap tall"><table class="data"><thead><tr><th>Nhân sự</th><th>Đơn vị</th><th>Kế hoạch</th><th class="num">Chỉ tiêu</th><th class="num">TS</th><th>Đánh giá</th><th class="num">KPI</th><th></th></tr></thead><tbody>
            ${subRows.length ? subRows.map((r) => html`<tr><td>${userCell(r.userId)}</td><td>${r.unitName}</td><td>${badge('plan', r.planStatus)}</td><td class="num">${r.itemsCount}</td>
              <td class="num ${r.itemsCount && !r.weightValid ? 'state-invalid' : ''}">${r.itemsCount ? fmt.weight(r.weightTotal) : '—'}</td><td>${badge('evaluation', r.evalStatus)}</td>
              <td class="num">${r.kpi !== null ? fmt.percent(r.kpi) : '—'}</td><td class="actions"><a class="btn sm" href="#/kpi/plan/${ctx.periodId}/${r.userId}">Kế hoạch</a></td></tr>`) : html`<tr><td colspan="8">${ui.empty('Đơn vị không có nhân sự trong phạm vi của bạn.')}</td></tr>`}
          </tbody></table></div>
        </div>
      </div>`);
  };
  on(page, 'click', '[data-unit]', (e, el) => { selected = el.dataset.unit; draw(); });
  watchScope(ctx.periodId, (d) => { data = d; draw(); });
  draw();
}

async function inbox(container) {
  const page = mountPage(container);
  if (needPeriod(page)) return;
  let plan = null, tab = 'pending';
  const draw = () => {
    const items = itemList(plan).filter((i) => i.spec.source === 'assigned');
    const groups = {
      pending: items.filter((i) => i.spec.state !== 'revoked' && (!i.ack || i.ack.status === 'pending')),
      change_requested: items.filter((i) => i.spec.state !== 'revoked' && i.ack?.status === 'change_requested'),
      accepted: items.filter((i) => i.spec.state !== 'revoked' && i.ack?.status === 'accepted'),
      revoked: items.filter((i) => i.spec.state === 'revoked'),
    };
    const list = groups[tab];
    const editable = ctx.period?.status === 'open' && (!plan?.status || ['draft', 'returned'].includes(plan.status));
    render(page, html`${pageHead({ title: 'Nhận KPI được giao', sub: 'Xem nguồn giao, trọng số và tiếp nhận hoặc đề nghị điều chỉnh chỉ tiêu từ cấp trên', crumbs: [['Quản lý KPI'], ['Nhận KPI được giao']], actions: html`<a class="btn" href="#/kpi/my">Mở kế hoạch của tôi</a>` })}
      ${!editable && plan?.status ? html`<div class="alert info mb-2"><div>Kế hoạch của bạn đang ở trạng thái ${badge('plan', plan.status)} – không thể thay đổi tiếp nhận lúc này.</div></div>` : ''}
      ${tabs([{ id: 'pending', label: 'Chờ tiếp nhận', count: groups.pending.length }, { id: 'change_requested', label: 'Đã đề nghị điều chỉnh', count: groups.change_requested.length }, { id: 'accepted', label: 'Đã tiếp nhận', count: groups.accepted.length }, { id: 'revoked', label: 'Đã thu hồi', count: groups.revoked.length }], tab)}
      <div class="table-wrap tall"><table class="data"><thead><tr><th>Chỉ tiêu</th><th>Người giao</th><th>Phân rã từ</th><th class="num">Trọng số</th><th>Chế độ trọng số</th><th>Mục tiêu (N/CB/ĐM)</th><th>Phản hồi</th><th></th></tr></thead><tbody>
        ${list.length ? list.map((i) => html`<tr><td class="wrap-wide"><b>${i.spec.title}</b><div class="small muted clamp">${i.spec.measurement || ''}</div></td>
          <td>${userCell(i.spec.assignedBy)}<div class="small muted">${fmt.datetime(i.spec.assignedAt)}</div></td><td class="small">${i.spec.parentRef ? `${i.spec.parentRef.title} (${nameOf(i.spec.parentRef.userId)})` : '—'}</td>
          <td class="num">${fmt.weight(i.weight)}${i.spec.originalWeight !== undefined && i.spec.originalWeight !== i.weight ? html`<div class="small muted">gốc ${i.spec.originalWeight}%</div>` : ''}</td>
          <td>${i.spec.weightMode === 'flex' ? html`<span class="badge c-blue">B – Được điều chỉnh</span><div class="small muted">Tối thiểu ${i.spec.minWeight}%${i.spec.maxWeight ? `, tối đa ${i.spec.maxWeight}%` : ''}</div>` : html`<span class="badge c-slate">A – Cố định</span>`}</td>
          <td class="nowrap">${i.spec.targets?.threshold ?? '—'} / ${i.spec.targets?.base ?? '—'} / ${i.spec.targets?.stretch ?? '—'} ${i.spec.unit || ''}</td>
          <td class="small">${i.ack?.note || ''}${i.ack?.requestedWeight ? html`<div>Đề xuất: ${i.ack.requestedWeight}%</div>` : ''}${i.spec.state === 'revoked' ? html`<div>Thu hồi: ${i.spec.revokeReason || ''}</div>` : ''}</td>
          <td class="actions">${editable && i.spec.state !== 'revoked' && i.ack?.status !== 'accepted' ? html`<button class="btn sm primary" data-ack="${i.id}">Tiếp nhận</button> <button class="btn sm" data-change="${i.id}">Đề nghị điều chỉnh</button>` : ''}</td></tr>`) : html`<tr><td colspan="8">${ui.empty('Không có chỉ tiêu trong mục này.')}</td></tr>`}
      </tbody></table></div>`);
  };
  on(page, 'click', '[data-tab]', (e, el) => { tab = el.dataset.tab; draw(); });
  on(page, 'click', '[data-ack]', (e, el) => busy(el, async () => {
    const it = plan.items[el.dataset.ack];
    const r = await confirmDialog({ title: 'Tiếp nhận KPI', message: `Tiếp nhận “${it.spec.title}” với trọng số ${it.weight}%?`, confirmText: 'Tiếp nhận' });
    if (!r) return;
    try { await acknowledge({ periodId: ctx.periodId, userId: ctx.userId, itemId: el.dataset.ack, item: it, status: 'accepted' }); toast('Đã tiếp nhận KPI.'); } catch (err) { toast(mapError(err), 'error'); }
  }));
  on(page, 'click', '[data-change]', (e, el) => changeRequestDialog(ctx.periodId, ctx.userId, plan, el.dataset.change));
  listen(planPath(ctx.periodId, ctx.userId), (v) => { plan = v; draw(); }, { key: 'inbox-plan' });
  draw();
}

async function history(container) {
  const page = mountPage(container);
  if (needPeriod(page)) return;
  let data = null;
  const f = { q: '', action: '' };
  const draw = () => {
    if (!data) { render(page, ui.loading()); return; }
    const all = [];
    for (const [uid, plan] of Object.entries(data.plans || {})) {
      for (const [hid, h] of Object.entries(plan.history || {})) all.push({ id: hid, ...h, ownerId: uid, itemTitle: plan.items?.[h.itemId]?.spec?.title || '' });
    }
    const actions = [...new Set(all.map((h) => h.action))];
    const list = all.filter((h) => (!f.action || h.action === f.action) && matches(f.q, nameOf(h.ownerId), h.byName, h.itemTitle, h.reason)).sort((a, b) => (b.at || 0) - (a.at || 0));
    render(page, html`${pageHead({ title: 'Lịch sử giao & điều chỉnh', sub: 'Toàn bộ thao tác giao, tiếp nhận, điều chỉnh trọng số, sub-KPI và phê duyệt kế hoạch trong phạm vi của bạn', crumbs: [['Quản lý KPI'], ['Lịch sử']] })}
      <div class="toolbar"><div class="field search"><label>Tìm kiếm</label><input type="search" data-f="q" value="${f.q}"></div>
        <div class="field"><label>Loại thao tác</label><select data-f="action">${options(actions.map((a) => ({ value: a, label: actionLabel(a) })), f.action, { placeholder: 'Tất cả' })}</select></div></div>
      <div class="table-wrap tall"><table class="data"><thead><tr><th>Thời điểm</th><th>Thao tác</th><th>Kế hoạch của</th><th>Chỉ tiêu</th><th>Người thực hiện</th><th>Trước → Sau</th><th>Lý do / ghi chú</th></tr></thead><tbody>
        ${list.length ? list.slice(0, 500).map((h) => html`<tr><td class="nowrap">${fmt.datetime(h.at)}</td><td>${actionLabel(h.action)}</td><td>${nameOf(h.ownerId)}</td><td class="wrap-wide">${h.itemTitle}</td><td>${h.byName || nameOf(h.by)}</td>
          <td class="small mono">${h.before ? JSON.stringify(h.before) : ''}${h.before && h.after ? ' → ' : ''}${h.after ? JSON.stringify(h.after) : ''}</td><td class="small">${h.reason || h.note || ''}</td></tr>`) : html`<tr><td colspan="7">${ui.empty('Chưa có lịch sử.')}</td></tr>`}
      </tbody></table></div>`);
  };
  on(page, 'change', '[data-f]', (e, el) => { f[el.dataset.f] = el.value; draw(); });
  watchScope(ctx.periodId, (d) => { data = d; draw(); });
  draw();
}

export const routes = [
  { path: '/kpi/my', title: 'KPI của tôi', render: myKpi },
  { path: '/kpi/plan/:periodId/:userId', title: 'Kế hoạch KPI', render: planOf },
  { path: '/kpi/team', title: 'KPI đội nhóm', render: teamKpi },
  { path: '/kpi/units', title: 'KPI theo đơn vị', render: unitKpi },
  { path: '/kpi/inbox', title: 'Nhận KPI được giao', render: inbox },
  { path: '/kpi/history', title: 'Lịch sử giao & điều chỉnh', render: history },
];
