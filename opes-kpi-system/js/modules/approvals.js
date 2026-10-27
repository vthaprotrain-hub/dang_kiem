/**
 * Trình ký & phê duyệt: danh sách việc cần xử lý của người đăng nhập (tính trực tiếp từ trạng thái hồ sơ –
 * nguồn dữ liệu duy nhất), khóa hàng loạt cho HR.
 */
import { listen, clearScope, mapError } from '../services/database.service.js';
import { ctx, nameOf } from '../state.js';
import { can, relationTo } from '../permissions.js';
import { html, render, ui, fmt, toast, busy, confirmDialog, $, on, mountPage } from '../utils.js';
import { pageHead, userCell, tabs } from '../components.js';
import { badge } from '../labels.js';
import { lockEvaluations } from '../services/workflow.service.js';
import { computeFor } from '../services/evaluation.service.js';

function relevantUsers() {
  return Object.keys(ctx.periodUsers || {}).filter((id) => {
    if (id === ctx.userId) return false;
    const r = relationTo(id);
    return r.directManager || r.skipManager;
  });
}

export function computeTasks(plans, evals, hrEvals = null) {
  const tasks = [];
  for (const [uid, plan] of Object.entries(plans)) {
    const r = relationTo(uid);
    if (plan?.status === 'submitted' && r.directManager) tasks.push({ kind: 'plan', stage: 'manager', userId: uid, record: plan, at: plan.statusMeta?.at, label: 'Phê duyệt kế hoạch KPI (QL trực tiếp)', href: `#/kpi/plan/${ctx.periodId}/${uid}` });
    if (plan?.status === 'manager_approved' && r.skipManager) tasks.push({ kind: 'plan', stage: 'skip', userId: uid, record: plan, at: plan.statusMeta?.at, label: 'Phê duyệt kế hoạch KPI (QL trên 1 cấp)', href: `#/kpi/plan/${ctx.periodId}/${uid}` });
  }
  for (const [uid, ev] of Object.entries(evals)) {
    const r = relationTo(uid);
    if (ev?.status === 'submitted' && r.directManager) tasks.push({ kind: 'eval', stage: 'manager', userId: uid, record: ev, at: ev.statusMeta?.at, label: 'Đánh giá nhân viên (QL trực tiếp)', href: `#/eval/form/${ctx.periodId}/${uid}` });
    if (ev?.status === 'manager_reviewed' && r.skipManager) tasks.push({ kind: 'eval', stage: 'skip', userId: uid, record: ev, at: ev.statusMeta?.at, label: 'Phê duyệt kết quả đánh giá (QL trên 1 cấp)', href: `#/eval/form/${ctx.periodId}/${uid}` });
  }
  if (hrEvals) for (const [uid, ev] of Object.entries(hrEvals)) if (ev?.status === 'approved') tasks.push({ kind: 'lock', stage: 'hr', userId: uid, record: ev, at: ev.statusMeta?.at, label: 'Khóa kết quả đã phê duyệt', href: `#/eval/form/${ctx.periodId}/${uid}` });
  return tasks.sort((a, b) => (a.at || 0) - (b.at || 0));
}

/** Theo dõi realtime danh sách việc cần duyệt. */
export function watchTasks(periodId, cb, scopeName = 'route') {
  if (scopeName !== 'route') clearScope(scopeName);
  const plans = {}, evals = {};
  let hrEvals = null;
  const fire = () => cb(computeTasks(plans, evals, hrEvals));
  const ids = relevantUsers();
  for (const uid of ids) {
    listen(`kpiPlans/${periodId}/${uid}`, (v) => { plans[uid] = v; fire(); }, { scope: scopeName, key: `task-plan-${uid}` });
    listen(`evaluations/${periodId}/${uid}`, (v) => { evals[uid] = v; fire(); }, { scope: scopeName, key: `task-eval-${uid}` });
  }
  if (can('lockRecords') && can('viewAllEvaluations')) {
    listen(`evaluations/${periodId}`, (v) => { hrEvals = v || {}; fire(); }, { scope: scopeName, key: 'task-hr-evals' });
  }
  if (!ids.length && !(can('lockRecords') && can('viewAllEvaluations'))) fire();
}

async function renderApprovals(container) {
  const view = mountPage(container);
  if (!ctx.periodId) { render(view, ui.empty('Chưa chọn kỳ đánh giá.')); return; }
  let tab = 'pending';
  let tasks = [];
  const draw = () => {
    const pending = tasks.filter((t) => t.kind !== 'lock');
    const lock = tasks.filter((t) => t.kind === 'lock');
    const list = tab === 'pending' ? pending : lock;
    render(view, html`${pageHead({ title: 'Trình ký & phê duyệt', sub: 'Các hồ sơ đang chờ bạn xử lý theo quy trình đã cấu hình', crumbs: [['Đánh giá'], ['Trình ký & phê duyệt']] })}
      ${tabs([{ id: 'pending', label: 'Chờ tôi duyệt', count: pending.length }, ...(can('lockRecords') ? [{ id: 'lock', label: 'Đã duyệt – chờ khóa', count: lock.length }] : [])], tab)}
      <div class="card"><div class="card-body">
        ${tab === 'lock' && lock.length ? html`<div class="row between mb-2"><span class="muted">Khóa kết quả sau khi đã được phê duyệt cuối. Kết quả đã khóa chỉ mở lại bằng thao tác mở khóa ngoại lệ (có lý do).</span><button class="btn primary" id="lock-all">Khóa ${lock.length} hồ sơ</button></div>` : ''}
        <div class="table-wrap medium"><table class="data"><thead><tr><th>Nhân sự</th><th>Đơn vị</th><th>Loại việc</th><th>Trạng thái</th><th>Gửi lúc</th><th></th></tr></thead><tbody>
          ${list.length ? list.map((t) => html`<tr>
            <td>${userCell(t.userId)}</td><td>${ctx.periodUsers[t.userId]?.unitName || ''}</td><td>${t.label}</td>
            <td>${badge(t.kind === 'plan' ? 'plan' : 'evaluation', t.record?.status)}</td><td class="nowrap">${fmt.datetime(t.at)}</td>
            <td class="actions"><a class="btn sm primary" href="${t.href}">Mở hồ sơ</a></td></tr>`) : html`<tr><td colspan="6">${ui.empty(tab === 'pending' ? 'Không có hồ sơ nào chờ bạn xử lý.' : 'Không có hồ sơ chờ khóa.', '✓')}</td></tr>`}
        </tbody></table></div>
      </div></div>`);
    $('#lock-all', view)?.addEventListener('click', (e) => busy(e.currentTarget, async () => {
      const r = await confirmDialog({ title: 'Khóa kết quả đánh giá', message: `Khóa ${lock.length} hồ sơ đã phê duyệt? Sau khi khóa, chỉ có thể mở bằng thao tác mở khóa ngoại lệ.`, confirmText: 'Khóa hồ sơ' });
      if (!r) return;
      try { await lockEvaluations(ctx.periodId, lock.map((t) => ({ userId: t.userId, evaluation: t.record }))); toast(`Đã khóa ${lock.length} hồ sơ.`); } catch (err) { toast(mapError(err), 'error'); }
    }));
  };
  on(view, 'click', '[data-tab]', (e, el) => { tab = el.dataset.tab; draw(); });
  watchTasks(ctx.periodId, (t) => { tasks = t; draw(); }, 'route');
  draw();
}

export const routes = [
  { path: '/approvals', title: 'Trình ký & phê duyệt', render: renderApprovals },
];
