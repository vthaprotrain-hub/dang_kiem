/**
 * Dashboard: số liệu tổng quan theo phạm vi quyền, cập nhật thời gian thực từ Firebase.
 */
import { ctx, nameOf, unitName } from '../state.js';
import { can, seesAll } from '../permissions.js';
import { html, render, ui, fmt, mountPage, on, groupBy } from '../utils.js';
import { pageHead, stat, progress, options, userCell } from '../components.js';
import { badge, gradeBadge, statusInfo } from '../labels.js';
import { watchScope, buildRows, scopeLabel } from '../services/report.service.js';
import { deadlineInfo } from '../services/period.service.js';
import { watchTasks } from './approvals.js';

const DONE = ['approved', 'locked'];

async function renderDashboard(container) {
  const page = mountPage(container);
  if (!ctx.periodId) { render(page, html`${pageHead({ title: 'Dashboard' })}${ui.empty('Chưa có kỳ đánh giá. Quản trị viên cần tạo kỳ trong mục Quản trị → Kỳ đánh giá.')}`); return; }
  const filters = { center: '', status: '', level: '' };
  let data = null;
  let tasks = [];

  const draw = () => {
    if (!data) { render(page, html`${pageHead({ title: 'Dashboard' })}${ui.loading()}`); return; }
    const all = buildRows(data);
    const centers = [...new Set(all.map((r) => r.centerId))].filter(Boolean);
    const rows = all.filter((r) => (!filters.center || r.centerId === filters.center)
      && (!filters.status || r.evalStatus === filters.status || r.planStatus === filters.status)
      && (!filters.level || String(levelOf(r)) === filters.level));
    const p = ctx.period;
    const n = (f) => rows.filter(f).length;
    const assignDl = deadlineInfo(p, 'assignDeadline');
    const selfDl = deadlineInfo(p, 'selfAssessDeadline');
    const mgrDl = deadlineInfo(p, 'managerAssessDeadline');
    const notAssigned = n((r) => r.planStatus === 'none' || r.itemsCount === 0);
    const pendingAck = rows.reduce((s, r) => s + r.pendingAck, 0);
    const inProgress = n((r) => r.planStatus === 'approved');
    const plansWaiting = n((r) => ['submitted', 'manager_approved'].includes(r.planStatus));
    const waitingSelf = n((r) => r.planStatus === 'approved' && ['not_started', 'draft', 'returned'].includes(r.evalStatus));
    const waitingMgr = n((r) => r.evalStatus === 'submitted');
    const waitingApprove = n((r) => r.evalStatus === 'manager_reviewed');
    const done = n((r) => DONE.includes(r.evalStatus));
    const warnings = [];
    rows.filter((r) => r.itemsCount && r.weightValid === false).forEach((r) => warnings.push({ r, kind: 'Trọng số chưa hợp lệ', detail: `Tổng ${r.weightTotal}%`, href: `#/kpi/plan/${ctx.periodId}/${r.userId}` }));
    rows.filter((r) => r.evidenceMissing && ['submitted', 'manager_reviewed'].includes(r.evalStatus)).forEach((r) => warnings.push({ r, kind: 'Thiếu minh chứng', detail: `${r.evidenceMissing} chỉ tiêu bắt buộc minh chứng`, href: `#/eval/form/${ctx.periodId}/${r.userId}` }));
    rows.filter((r) => ['submitted', 'manager_reviewed'].includes(r.evalStatus) && r.computed && !r.computed.kpi.complete).forEach((r) => warnings.push({ r, kind: 'Thiếu dữ liệu', detail: r.computed.kpi.notes.join('; '), href: `#/eval/form/${ctx.periodId}/${r.userId}` }));
    rows.filter((r) => r.changeRequests).forEach((r) => warnings.push({ r, kind: 'Yêu cầu điều chỉnh KPI', detail: `${r.changeRequests} chỉ tiêu`, href: `#/kpi/plan/${ctx.periodId}/${r.userId}` }));
    if (assignDl?.overdue) rows.filter((r) => r.planStatus !== 'approved').forEach((r) => warnings.push({ r, kind: 'Quá hạn giao KPI', detail: `Hạn ${fmt.date(assignDl.date)} – ${statusInfo('plan', r.planStatus).label}`, href: `#/kpi/plan/${ctx.periodId}/${r.userId}` }));
    if (selfDl?.overdue) rows.filter((r) => ['not_started', 'draft', 'returned'].includes(r.evalStatus)).forEach((r) => warnings.push({ r, kind: 'Quá hạn tự đánh giá', detail: `Hạn ${fmt.date(selfDl.date)}`, href: `#/eval/form/${ctx.periodId}/${r.userId}` }));
    if (mgrDl?.overdue) rows.filter((r) => r.evalStatus === 'submitted').forEach((r) => warnings.push({ r, kind: 'Quá hạn quản lý đánh giá', detail: `Hạn ${fmt.date(mgrDl.date)}`, href: `#/eval/form/${ctx.periodId}/${r.userId}` }));
    rows.filter((r) => r.mismatch).forEach((r) => warnings.push({ r, kind: 'Kết quả đã lưu lệch tính toán', detail: r.mismatch.join('; '), href: `#/eval/form/${ctx.periodId}/${r.userId}` }));

    const byCenter = groupBy(rows, (r) => r.centerId);
    const grades = groupBy(rows.filter((r) => DONE.includes(r.evalStatus) && (r.final?.gradeLabel || r.grade?.label)), (r) => r.final?.gradeLabel || r.grade?.label);
    const me = all.find((r) => r.userId === ctx.userId);
    const levels = [...new Set(all.map(levelOf))].sort((a, b) => a - b);

    render(page, html`
      ${pageHead({ title: 'Dashboard', sub: html`${p.name} · ${badge('period', p.status)} · Phạm vi: ${scopeLabel()}`, crumbs: [['Dashboard']] })}
      <div class="toolbar no-print">
        <div class="field"><label>Đơn vị (cấp trung tâm)</label><select data-filter="center">${options(centers.map((c) => ({ value: c, label: unitName(c) })), filters.center, { placeholder: 'Tất cả đơn vị' })}</select></div>
        <div class="field"><label>Cấp tổ chức</label><select data-filter="level">${options(levels.map((l) => ({ value: l, label: `Cấp ${l}` })), filters.level, { placeholder: 'Tất cả cấp' })}</select></div>
        <div class="field"><label>Trạng thái</label><select data-filter="status">${options([
          ...['none', 'draft', 'submitted', 'manager_approved', 'approved', 'returned'].map((s) => ({ value: s, label: `KH: ${statusInfo('plan', s).label}` })),
          ...['not_started', 'draft', 'submitted', 'manager_reviewed', 'approved', 'locked', 'returned'].map((s) => ({ value: s, label: `ĐG: ${statusInfo('evaluation', s).label}` })),
        ].filter((o, i, a) => a.findIndex((x) => x.value === o.value) === i), filters.status, { placeholder: 'Tất cả trạng thái' })}</select></div>
      </div>
      ${me ? html`<div class="card mb-2"><div class="card-body row between">
        <div class="row">${userCell(ctx.userId)}<span>Kế hoạch: ${badge('plan', me.planStatus)}</span><span>Đánh giá: ${badge('evaluation', me.evalStatus)}</span>${me.pendingAck ? html`<a class="badge c-purple" href="#/kpi/inbox">${me.pendingAck} KPI chờ tiếp nhận</a>` : ''}</div>
        <div class="row"><a class="btn" href="#/kpi/my">KPI của tôi</a><a class="btn primary" href="#/eval/my">Đánh giá của tôi</a>${tasks.length ? html`<a class="btn" href="#/approvals">${tasks.length} việc cần duyệt</a>` : ''}</div>
      </div></div>` : ''}
      <div class="grid cols-4">
        ${stat({ label: 'Nhân sự thuộc phạm vi', value: rows.length, hint: seesAll() ? 'Toàn bộ người tham gia kỳ' : 'Bao gồm bạn và cấp dưới', href: can('viewAllPlans') || rows.length > 1 ? '#/kpi/team' : '' })}
        ${stat({ label: 'Kế hoạch KPI chưa giao', value: notAssigned, hint: assignDl ? `Hạn giao: ${fmt.date(assignDl.date)}` : 'Chưa có chỉ tiêu nào', tone: notAssigned ? 'warn' : '', href: '#/kpi/team' })}
        ${stat({ label: 'KPI chờ tiếp nhận', value: pendingAck, hint: 'Chỉ tiêu được giao chưa xác nhận', tone: pendingAck ? 'warn' : '', href: '#/kpi/team' })}
        ${stat({ label: 'Kế hoạch đang thực hiện', value: inProgress, hint: `${plansWaiting} kế hoạch chờ phê duyệt`, href: '#/kpi/team' })}
        ${stat({ label: 'Hồ sơ chờ tự đánh giá', value: waitingSelf, hint: selfDl ? `Hạn: ${fmt.date(selfDl.date)}` : '', href: '#/eval/team' })}
        ${stat({ label: 'Chờ quản lý đánh giá', value: waitingMgr, href: '#/eval/team' })}
        ${stat({ label: 'Chờ phê duyệt', value: waitingApprove, href: '#/approvals' })}
        ${stat({ label: 'Đã hoàn thành', value: done, hint: rows.length ? `${fmt.percent(done / rows.length, 0)} nhân sự` : '', href: '#/eval/done' })}
      </div>
      <div class="grid cols-2 mt-3">
        <div class="card"><div class="card-header"><h3>Tỷ lệ hoàn thành theo đơn vị</h3><span class="small muted">Hoàn thành đánh giá / Kế hoạch đã giao</span></div><div class="card-body">
          ${byCenter.size ? html`<div class="bar-list">${[...byCenter.entries()].sort((a, b) => unitName(a[0]).localeCompare(unitName(b[0]), 'vi')).map(([cid, rs]) => {
            const d = rs.filter((r) => DONE.includes(r.evalStatus)).length;
            const pa = rs.filter((r) => r.planStatus === 'approved').length;
            return html`<div class="bar-item"><div><div class="strong">${unitName(cid)}</div><div class="small muted">${rs.length} nhân sự · ${pa} KH đã giao</div></div>${progress(rs.length ? d / rs.length : 0)}<div class="num">${d}/${rs.length}</div></div>`;
          })}</div>` : ui.empty('Chưa có dữ liệu')}
        </div></div>
        <div class="card"><div class="card-header"><h3>Phân bố xếp loại (hồ sơ đã duyệt)</h3></div><div class="card-body">
          ${grades.size ? html`<div class="bar-list">${[...grades.entries()].map(([g, rs]) => html`<div class="bar-item"><div class="strong">${g}</div>${progress(rs.length / Math.max(1, done))}<div class="num">${rs.length}</div></div>`)}</div>` : ui.empty('Chưa có hồ sơ được phê duyệt.')}
          <div class="small muted mt-2">Xếp loại theo bảng cấu hình của kỳ. ${ctx.period?.policies?.grading?.isDemo ? 'Đang dùng cấu hình demo – cần HR xác nhận.' : ''}</div>
        </div></div>
      </div>
      <div class="card mt-3"><div class="card-header"><h3>Cảnh báo</h3><span class="badge ${warnings.length ? 'c-amber' : 'c-green'}">${warnings.length}</span></div>
        <div class="table-wrap medium" style="border:0;border-radius:0"><table class="data"><thead><tr><th>Loại cảnh báo</th><th>Nhân sự</th><th>Đơn vị</th><th>Chi tiết</th><th></th></tr></thead><tbody>
          ${warnings.length ? warnings.slice(0, 200).map((w) => html`<tr><td><span class="badge c-amber">${w.kind}</span></td><td>${w.r.name}</td><td>${w.r.unitName}</td><td>${w.detail}</td><td class="actions"><a class="btn sm" href="${w.href}">Xem</a></td></tr>`) : html`<tr><td colspan="5">${ui.empty('Không có cảnh báo.', '✓')}</td></tr>`}
        </tbody></table></div>
      </div>
      <div class="card mt-3"><div class="card-header"><h3>Tình trạng nhân sự</h3><a class="btn sm" href="#/reports">Báo cáo chi tiết</a></div>
        <div class="table-wrap medium" style="border:0;border-radius:0"><table class="data"><thead><tr><th>Nhân sự</th><th>Đơn vị</th><th>Kế hoạch</th><th class="num">Tổng TS</th><th>Đánh giá</th><th class="num">KPI</th><th class="num">KBI</th><th>Xếp loại</th></tr></thead><tbody>
          ${rows.map((r) => html`<tr><td>${userCell(r.userId)}</td><td>${r.unitName}</td><td>${badge('plan', r.planStatus)}</td><td class="num">${r.itemsCount ? fmt.weight(r.weightTotal) : '—'}</td><td>${badge('evaluation', r.evalStatus)}</td>
            <td class="num">${r.kpi !== null ? fmt.percent(r.kpi) : r.kpiProvisional ? html`<span class="muted" title="Tạm tính">${fmt.percent(r.kpiProvisional)}*</span>` : '—'}</td>
            <td class="num">${r.kbi !== null ? fmt.number(r.kbi, 2) : '—'}</td><td>${r.final?.gradeLabel ? html`<span class="badge c-green">${r.final.gradeLabel}</span>` : gradeBadge(r.grade)}</td></tr>`)}
        </tbody></table></div>
        <div class="card-footer small muted">* Tạm tính khi chưa đủ dữ liệu – không phải kết quả chính thức. Dữ liệu cập nhật thời gian thực.</div>
      </div>`);
  };
  const levelOf = (r) => { let d = 1, cur = ctx.units[r.unitId]?.parentId; const seen = new Set(); while (cur && !seen.has(cur)) { seen.add(cur); d++; cur = ctx.units[cur]?.parentId; } return d; };

  on(page, 'change', '[data-filter]', (e, el) => { filters[el.dataset.filter] = el.value; draw(); });
  on(page, 'click', '[data-href]', (e, el) => { location.hash = el.dataset.href; });
  watchScope(ctx.periodId, (d) => { data = d; draw(); });
  watchTasks(ctx.periodId, (t) => { tasks = t; if (data) draw(); }, 'route');
  draw();
}

export const routes = [{ path: '/dashboard', title: 'Dashboard', render: renderDashboard }];
