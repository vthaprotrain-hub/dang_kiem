/**
 * Tổng hợp dữ liệu theo phạm vi quyền (toàn công ty hoặc chuỗi quản lý) cho dashboard/báo cáo,
 * tính điểm bằng bộ máy chung và xuất CSV/XLSX kèm thông tin trích xuất.
 */
import { listen, read, DENIED } from './database.service.js';
import { ctx, kbiValuesFor, nameOf, unitName } from '../state.js';
import { can, scopeUserIds } from '../permissions.js';
import { computeFor, finalMismatch } from './evaluation.service.js';
import { validatePlan, itemList } from './kpi.service.js';
import { toCSV, download, loadXLSX, fmt, safeFileName, debounce } from '../utils.js';
import { statusLabel } from '../labels.js';
import { topUnitOf } from './organization.service.js';

/**
 * Theo dõi realtime dữ liệu kế hoạch + đánh giá trong phạm vi. cb({users, plans, evaluations, loaded}).
 * Người xem toàn bộ: 2 listener trên cả nút kỳ; người quản lý: listener theo từng nhân sự trong phạm vi.
 */
export function watchScope(periodId, cb, { scope = 'route' } = {}) {
  const ids = scopeUserIds();
  const users = Object.fromEntries(ids.map((id) => [id, ctx.periodUsers[id]]).filter(([, v]) => v));
  const state = { users, plans: {}, evaluations: {}, pending: 0 };
  const fire = debounce(() => cb({ ...state, loaded: state.pending <= 0 }), 60);
  const track = (path, assign, key) => {
    state.pending++;
    let first = true;
    listen(path, (v) => { assign(v); if (first) { first = false; state.pending--; } fire(); }, {
      scope, key, onError: () => { if (first) { first = false; state.pending--; } fire(); },
    });
  };
  if (can('viewAllPlans')) track(`kpiPlans/${periodId}`, (v) => { state.plans = v || {}; }, `scope-plans-${periodId}`);
  else ids.forEach((u) => track(`kpiPlans/${periodId}/${u}`, (v) => { if (v) state.plans[u] = v; else delete state.plans[u]; }, `scope-plan-${periodId}-${u}`));
  if (can('viewAllEvaluations')) track(`evaluations/${periodId}`, (v) => { state.evaluations = v || {}; }, `scope-evals-${periodId}`);
  else ids.forEach((u) => track(`evaluations/${periodId}/${u}`, (v) => { if (v) state.evaluations[u] = v; else delete state.evaluations[u]; }, `scope-eval-${periodId}-${u}`));
  if (!state.pending) fire();
}

/** Đọc một lần dữ liệu của một kỳ (dùng cho so sánh giữa các kỳ). */
export async function loadPeriodScope(periodId) {
  const period = ctx.periods[periodId];
  const pus = periodId === ctx.periodId ? ctx.periodUsers : (await read(`evaluationPeriodUsers/${periodId}`)) || {};
  const me = ctx.userId;
  const ids = can('viewAllEvaluations') ? Object.keys(pus) : Object.keys(pus).filter((id) => id === me || pus[id]?.chain?.[me]);
  let plans = {}, evaluations = {};
  if (can('viewAllPlans')) { const v = await read(`kpiPlans/${periodId}`, { allowDenied: true }); plans = v === DENIED ? {} : v || {}; }
  else await Promise.all(ids.map(async (u) => { const v = await read(`kpiPlans/${periodId}/${u}`, { allowDenied: true }); if (v && v !== DENIED) plans[u] = v; }));
  if (can('viewAllEvaluations')) { const v = await read(`evaluations/${periodId}`, { allowDenied: true }); evaluations = v === DENIED ? {} : v || {}; }
  else await Promise.all(ids.map(async (u) => { const v = await read(`evaluations/${periodId}/${u}`, { allowDenied: true }); if (v && v !== DENIED) evaluations[u] = v; }));
  return { period, users: Object.fromEntries(ids.map((id) => [id, pus[id]])), plans, evaluations };
}

/** Một dòng tổng hợp cho mỗi nhân sự. */
export function buildRows({ users, plans, evaluations }, period = ctx.period) {
  const rows = [];
  for (const [userId, pu] of Object.entries(users || {})) {
    if (!pu) continue;
    const plan = plans[userId] || null;
    const ev = evaluations[userId] || null;
    const computed = plan ? computeFor({ plan, evaluation: ev, period, periodUser: pu }) : null;
    const check = plan ? validatePlan(plan, period?.policies || {}) : null;
    const items = plan ? itemList(plan, { includeRevoked: false }) : [];
    const planStatus = plan?.status || 'none';
    const evalStatus = ev?.status || 'not_started';
    const evidenceMissing = items.filter((i) => i.spec.evidenceRequired && !ev?.self?.kpi?.[i.id]?.evidence).length;
    rows.push({
      userId, pu, name: pu.name, title: pu.title, unitId: pu.unitId, unitName: pu.unitName || unitName(pu.unitId), centerId: topUnitOf(pu.unitId), managerId: pu.managerId || null,
      plan, evaluation: ev, computed, check, planStatus, evalStatus,
      itemsCount: items.length, assignedCount: items.filter((i) => i.spec.source === 'assigned').length, subCount: items.filter((i) => i.spec.parentItemId).length,
      flexCount: items.filter((i) => i.spec.weightMode === 'flex').length,
      pendingAck: items.filter((i) => i.spec.source === 'assigned' && i.ack?.status === 'pending').length,
      changeRequests: items.filter((i) => i.spec.source === 'assigned' && i.ack?.status === 'change_requested').length,
      weightTotal: check?.total ?? null, weightValid: check ? !check.errors.some((e) => e.startsWith('Tổng trọng số')) : null,
      kpi: computed?.kpi.complete ? computed.kpi.total : null, kpiProvisional: computed?.kpi.provisionalTotal ?? null,
      kbi: computed?.kbi.complete ? computed.kbi.average : null, kbiProvisional: computed?.kbi.provisionalAverage ?? null,
      grade: computed?.grade || null, final: ev?.final || null, mismatch: ev?.final && computed ? finalMismatch(ev, computed) : null,
      evidenceMissing,
    });
  }
  return rows.sort((a, b) => String(a.unitName).localeCompare(String(b.unitName), 'vi') || String(a.name).localeCompare(String(b.name), 'vi'));
}

export function scopeLabel() {
  if (can('viewAllPlans') && can('viewAllEvaluations')) return 'Toàn bộ nhân sự trong kỳ';
  return `Phạm vi quản lý của ${ctx.profile?.name || ''}`;
}

export function metaRows(title, filters = {}) {
  const f = Object.entries(filters).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}: ${v}`).join('; ') || 'Không';
  return [
    ['Báo cáo', title],
    ['Đơn vị', ctx.config.appSettings?.companyName || ''],
    ['Kỳ đánh giá', `${ctx.period?.name || ''} (${ctx.period?.code || ''})`],
    ['Phạm vi dữ liệu', scopeLabel()],
    ['Bộ lọc', f],
    ['Người trích xuất', `${ctx.profile?.name || ''} (${ctx.profile?.email || ''})`],
    ['Thời điểm trích xuất', fmt.datetime(Date.now())],
    [],
  ];
}

export function exportCSV(title, header, rows, filters) {
  const data = [...metaRows(title, filters), header, ...rows];
  download(`${safeFileName(title)}-${ctx.period?.code || ''}.csv`, toCSV(data), 'text/csv;charset=utf-8');
}

export async function exportXLSX(title, header, rows, filters) {
  const XLSX = await loadXLSX();
  const ws = XLSX.utils.aoa_to_sheet([...metaRows(title, filters), header, ...rows]);
  ws['!cols'] = header.map((h) => ({ wch: Math.min(48, Math.max(10, String(h).length + 4)) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Bao cao');
  XLSX.writeFile(wb, `${safeFileName(title)}-${ctx.period?.code || ''}.xlsx`);
}

export const pctCell = (v) => (v === null || v === undefined ? '' : Math.round(v * 10000) / 100);
export const statusText = (type, code) => statusLabel(type, code);
