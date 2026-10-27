/**
 * Phân hệ Đánh giá: đánh giá của tôi, biểu mẫu đánh giá, bản in, đánh giá nhân viên, hồ sơ cần bổ sung,
 * hồ sơ đã hoàn tất, lịch sử đánh giá qua các kỳ.
 */
import { read, DENIED } from '../services/database.service.js';
import { ctx, nameOf, kbiValuesFor } from '../state.js';
import { relationTo, seesAll, myTeam } from '../permissions.js';
import { html, render, ui, fmt, mountPage, on, matches } from '../utils.js';
import { pageHead, userCell, options } from '../components.js';
import { badge, gradeBadge, statusInfo } from '../labels.js';
import { icon } from '../icons.js';
import { renderEvaluationForm } from './evaluation-form.js';
import { watchScope, buildRows } from '../services/report.service.js';
import { computeEvaluation } from '../core/scoring.js';

function periodGuard(page, periodId) {
  if (periodId === ctx.periodId) return false;
  render(page, html`<div class="alert info"><div>Hồ sơ thuộc kỳ <b>${ctx.periods[periodId]?.name || periodId}</b>. Vui lòng chọn kỳ này ở thanh tiêu đề để mở hồ sơ.</div></div>`);
  return true;
}

async function myEval(container) {
  const page = mountPage(container);
  if (!ctx.periodId) { render(page, ui.empty('Chưa chọn kỳ đánh giá.')); return; }
  render(page, html`${pageHead({ title: 'Đánh giá của tôi', sub: `${ctx.period.name} – tự đánh giá KPI, KBI và theo dõi phê duyệt`, crumbs: [['Đánh giá'], ['Đánh giá của tôi']] })}<div id="form-area"></div>`);
  if (!ctx.periodUser) { render(page.querySelector('#form-area'), ui.empty('Bạn không thuộc danh sách nhân sự được đánh giá trong kỳ này.')); return; }
  renderEvaluationForm(page.querySelector('#form-area'), ctx.periodId, ctx.userId);
}

async function evalForm(container, { periodId, userId }) {
  const page = mountPage(container);
  if (periodGuard(page, periodId)) return;
  const name = ctx.periodUsers[userId]?.name || nameOf(userId);
  render(page, html`${pageHead({ title: `Hồ sơ đánh giá – ${name}`, sub: ctx.period.name, crumbs: [['Đánh giá'], ['Đánh giá nhân viên', '#/eval/team'], [name]] })}<div id="form-area"></div>`);
  renderEvaluationForm(page.querySelector('#form-area'), periodId, userId);
}

async function printView(container, { periodId, userId }) {
  const page = mountPage(container);
  if (periodGuard(page, periodId)) return;
  render(page, html`<div class="row between no-print mb-2"><a class="btn" href="#/eval/form/${periodId}/${userId}">← Quay lại hồ sơ</a><div class="row"><span class="muted small">Bản xem trước theo bố cục mẫu BM KPI (khổ A4 ngang)</span><button class="btn primary" id="do-print">${icon('printer', 16)} In / Lưu PDF</button></div></div><div id="form-area"></div>`);
  page.querySelector('#do-print').addEventListener('click', () => window.print());
  renderEvaluationForm(page.querySelector('#form-area'), periodId, userId, { printMode: true });
}

function listPage({ title, sub, crumb, filter, includeSelf = false, emptyMsg }) {
  return async (container) => {
    const page = mountPage(container);
    if (!ctx.periodId) { render(page, ui.empty('Chưa chọn kỳ đánh giá.')); return; }
    let data = null;
    const f = { q: '', status: '' };
    const draw = () => {
      if (!data) { render(page, ui.loading()); return; }
      const rows = buildRows(data).filter((r) => (includeSelf || r.userId !== ctx.userId || seesAll()) && filter(r))
        .filter((r) => (!f.status || r.evalStatus === f.status) && matches(f.q, r.name, r.unitName));
      render(page, html`${pageHead({ title, sub, crumbs: [['Đánh giá'], [crumb]] })}
        <div class="toolbar"><div class="field search"><label>Tìm kiếm</label><input type="search" data-f="q" value="${f.q}"></div>
          <div class="field"><label>Trạng thái đánh giá</label><select data-f="status">${options(['not_started', 'draft', 'submitted', 'manager_reviewed', 'returned', 'approved', 'locked'].map((s) => ({ value: s, label: statusInfo('evaluation', s).label })), f.status, { placeholder: 'Tất cả' })}</select></div></div>
        <div class="table-wrap tall"><table class="data"><thead><tr><th>Nhân sự</th><th>Đơn vị</th><th>Vai trò của tôi</th><th>Kế hoạch</th><th>Đánh giá</th><th class="num">Điểm KPI</th><th class="num">Điểm KBI</th><th>Xếp loại</th><th>Cập nhật</th><th></th></tr></thead><tbody>
        ${rows.length ? rows.map((r) => {
          const rel = relationTo(r.userId);
          return html`<tr><td>${userCell(r.userId)}</td><td>${r.unitName}</td><td class="small">${rel.self ? 'Bản thân' : rel.directManager ? 'QL trực tiếp' : rel.skipManager ? 'QL trên 1 cấp' : rel.inChain ? 'Cấp trên' : 'Xem'}</td>
            <td>${badge('plan', r.planStatus)}</td><td>${badge('evaluation', r.evalStatus)}${r.evaluation?.lastReturn && r.evalStatus === 'returned' ? html`<div class="small muted" title="${r.evaluation.lastReturn.reason}">Lý do: ${String(r.evaluation.lastReturn.reason).slice(0, 60)}</div>` : ''}</td>
            <td class="num">${r.kpi !== null ? fmt.percent(r.kpi) : r.kpiProvisional ? html`<span class="muted">${fmt.percent(r.kpiProvisional)}*</span>` : '—'}</td>
            <td class="num">${r.kbi !== null ? fmt.number(r.kbi, 2) : '—'}</td><td>${r.final?.gradeLabel ? html`<span class="badge c-green">${r.final.gradeLabel}</span>` : gradeBadge(r.grade)}</td>
            <td class="small nowrap">${fmt.datetime(r.evaluation?.statusMeta?.at)}</td>
            <td class="actions"><a class="btn sm primary" href="#/eval/form/${ctx.periodId}/${r.userId}">Mở hồ sơ</a></td></tr>`;
        }) : html`<tr><td colspan="10">${ui.empty(emptyMsg)}</td></tr>`}
        </tbody></table></div><div class="small muted mt-1">* Tạm tính khi chưa đủ dữ liệu.</div>`);
    };
    on(page, 'input', '[data-f=q]', (e, el) => { f.q = el.value; const pos = el.selectionStart; draw(); const n = page.querySelector('[data-f=q]'); n.focus(); n.setSelectionRange(pos, pos); });
    on(page, 'change', 'select[data-f]', (e, el) => { f[el.dataset.f] = el.value; draw(); });
    watchScope(ctx.periodId, (d) => { data = d; draw(); });
    draw();
  };
}

async function historyPage(container, params, query) {
  const page = mountPage(container);
  const candidates = [{ value: ctx.userId, label: `${ctx.profile?.name} (tôi)` }, ...myTeam().map((u) => ({ value: u.id, label: u.name }))];
  if (seesAll()) Object.entries(ctx.profiles).forEach(([id, p]) => { if (!candidates.some((c) => c.value === id)) candidates.push({ value: id, label: p.name }); });
  let who = query.user || ctx.userId;
  const load = async () => {
    render(page, html`${pageHead({ title: 'Lịch sử đánh giá', sub: 'Kết quả qua các kỳ đánh giá (dữ liệu đã lưu theo từng kỳ)', crumbs: [['Đánh giá'], ['Lịch sử']] })}
      <div class="toolbar"><div class="field" style="min-width:280px"><label>Nhân sự</label><select id="hist-user">${options(candidates, who)}</select></div></div><div id="hist-body">${ui.loading()}</div>`);
    page.querySelector('#hist-user').addEventListener('change', (e) => { who = e.target.value; load(); });
    const periods = Object.entries(ctx.periods).sort((a, b) => (b[1].year || 0) - (a[1].year || 0));
    const rows = await Promise.all(periods.map(async ([pid, per]) => {
      const [plan, ev, pu] = await Promise.all([read(`kpiPlans/${pid}/${who}`, { allowDenied: true }), read(`evaluations/${pid}/${who}`, { allowDenied: true }), read(`evaluationPeriodUsers/${pid}/${who}`, { allowDenied: true })]);
      if (plan === DENIED || ev === DENIED) return { pid, per, denied: true };
      const computed = plan ? computeEvaluation({ plan, evaluation: ev, policies: per.policies || {}, kbiValues: kbiValuesFor(per, pu) }) : null;
      return { pid, per, plan, ev, pu, computed };
    }));
    render(page.querySelector('#hist-body'), html`<div class="table-wrap"><table class="data"><thead><tr><th>Kỳ đánh giá</th><th>Trạng thái kỳ</th><th>Đơn vị / chức danh (theo kỳ)</th><th>Kế hoạch</th><th>Đánh giá</th><th class="num">Điểm KPI</th><th class="num">Điểm KBI</th><th>Xếp loại</th><th></th></tr></thead><tbody>
      ${rows.map((r) => r.denied ? html`<tr><td>${r.per.name}</td><td colspan="8" class="muted">Không có quyền xem</td></tr>` : html`<tr><td><b>${r.per.name}</b></td><td>${badge('period', r.per.status)}</td><td class="small">${r.pu ? `${r.pu.unitName} · ${r.pu.title}` : html`<span class="muted">Không tham gia</span>`}</td>
        <td>${badge('plan', r.plan?.status || 'none')}</td><td>${badge('evaluation', r.ev?.status || 'not_started')}</td>
        <td class="num">${r.ev?.final?.kpiPercent !== undefined ? `${fmt.number(r.ev.final.kpiPercent, 2)}%` : r.computed?.kpi.total !== null && r.computed ? fmt.percent(r.computed.kpi.total) : '—'}</td>
        <td class="num">${r.ev?.final?.kbiScore ?? (r.computed?.kbi.average !== null && r.computed ? fmt.number(r.computed.kbi.average, 2) : '—')}</td>
        <td>${r.ev?.final?.gradeLabel ? html`<span class="badge c-green">${r.ev.final.gradeLabel}</span>` : r.computed ? gradeBadge(r.computed.grade) : '—'}</td>
        <td class="actions">${r.plan && r.pid === ctx.periodId ? html`<a class="btn sm" href="#/eval/form/${r.pid}/${who}">Mở</a>` : ''}</td></tr>`)}
    </tbody></table></div><div class="small muted mt-1">Để mở hồ sơ của kỳ khác, chọn kỳ tương ứng ở thanh tiêu đề.</div>`);
  };
  await load();
}

export const routes = [
  { path: '/eval/my', title: 'Đánh giá của tôi', render: myEval },
  { path: '/eval/form/:periodId/:userId', title: 'Hồ sơ đánh giá', render: evalForm },
  { path: '/eval/print/:periodId/:userId', title: 'Bản in đánh giá', render: printView },
  { path: '/eval/team', title: 'Đánh giá nhân viên', render: listPage({ title: 'Đánh giá nhân viên', sub: 'Hồ sơ đánh giá của nhân sự thuộc phạm vi quản lý', crumb: 'Đánh giá nhân viên', filter: () => true, emptyMsg: 'Không có hồ sơ trong phạm vi.' }) },
  { path: '/eval/returned', title: 'Hồ sơ cần bổ sung', render: listPage({ title: 'Hồ sơ cần bổ sung', sub: 'Hồ sơ đánh giá hoặc kế hoạch KPI bị trả lại', crumb: 'Cần bổ sung', includeSelf: true, filter: (r) => r.evalStatus === 'returned' || r.planStatus === 'returned', emptyMsg: 'Không có hồ sơ cần bổ sung.' }) },
  { path: '/eval/done', title: 'Hồ sơ đã hoàn tất', render: listPage({ title: 'Hồ sơ đã hoàn tất', sub: 'Hồ sơ đã được phê duyệt hoặc đã khóa', crumb: 'Đã hoàn tất', includeSelf: true, filter: (r) => ['approved', 'locked'].includes(r.evalStatus), emptyMsg: 'Chưa có hồ sơ hoàn tất.' }) },
  { path: '/eval/history', title: 'Lịch sử đánh giá', render: historyPage },
];
