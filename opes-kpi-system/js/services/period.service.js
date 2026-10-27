/**
 * Kỳ đánh giá: cấu hình, chuyển trạng thái, khởi tạo danh sách nhân sự (kèm chuỗi quản lý),
 * chụp phiên bản cơ cấu tổ chức và "đóng băng" chính sách áp dụng cho kỳ.
 */
import { write, NOW, newKey, auditUpdate } from './database.service.js';
import { ctx } from '../state.js';
import { cleanUndefined, clone } from '../utils.js';
import { unitDescendants, currentReporting } from './organization.service.js';

export const PERIOD_FLOW = {
  draft: ['configured'],
  configured: ['open', 'draft'],
  open: ['paused', 'consolidating'],
  paused: ['open', 'consolidating'],
  consolidating: ['open', 'locked'],
  locked: ['consolidating', 'archived'],
  archived: [],
};

/** Bản chụp chính sách hiện hành để áp dụng cho kỳ (công thức của kỳ không đổi theo cấu hình sau này). */
export function snapshotPolicies(refs = {}) {
  const c = ctx.config || {};
  const r = { kbi: 'default', grading: 'default', weight: 'default', workflow: 'default', form: 'default', kpiAggregation: 'default', ...refs };
  const missing = [];
  const pick = (obj, key, label) => { const v = obj?.[key]; if (!v) missing.push(label); return v ? clone(v) : null; };
  const snap = {
    scoring: clone(c.scoringPolicies || {}),
    kpiAggregation: pick(c.kpiAggregation, r.kpiAggregation, 'Quy tắc tổng hợp KPI'),
    kbi: pick(c.kbiPolicies, r.kbi, 'Chính sách KBI'),
    grading: pick(c.gradingBands, r.grading, 'Bảng xếp loại'),
    weight: pick(c.weightPolicies, r.weight, 'Chính sách trọng số'),
    workflow: pick(c.workflowTemplates, r.workflow, 'Quy trình phê duyệt'),
    form: pick(c.formTemplates, r.form, 'Mẫu đánh giá'),
    meta: { frozenAt: NOW(), frozenBy: ctx.userId, source: 'config', refs: r },
  };
  if (!Object.keys(snap.scoring).length) missing.push('Chính sách tính điểm KPI');
  return { snap: cleanUndefined(snap), missing };
}

/**
 * Tính danh sách người tham gia kỳ: nhân sự đang hoạt động thuộc phạm vi đơn vị, trừ danh sách loại trừ.
 * Chuỗi quản lý (chain) được lấy theo quan hệ quản lý trực tiếp hiện hành (không giới hạn số cấp).
 */
export function computeParticipants(period, profiles = ctx.profiles, units = ctx.units) {
  const scope = period.scope || {};
  const unitSet = scope.rootUnitId ? unitDescendants(scope.rootUnitId, units) : null;
  const exclude = scope.excludeUserIds || {};
  const titleGroups = scope.titleGroups && Object.keys(scope.titleGroups).length ? scope.titleGroups : null;
  const out = {};
  const warnings = [];
  for (const [id, p] of Object.entries(profiles || {})) {
    if (p.status !== 'active' || p.evaluationExempt || exclude[id]) continue;
    if (unitSet && !unitSet.has(p.unitId)) continue;
    if (titleGroups && !titleGroups[p.titleGroup]) continue;
    const chain = {};
    let cur = p.managerId, depth = 1;
    const seen = new Set([id]);
    while (cur) {
      if (seen.has(cur)) { warnings.push(`Phát hiện vòng lặp quan hệ quản lý tại ${p.name}.`); break; }
      seen.add(cur);
      if (!profiles[cur]) { warnings.push(`Quản lý của ${p.name} (${cur}) không tồn tại.`); break; }
      chain[cur] = depth++;
      cur = profiles[cur].managerId;
    }
    const skip = p.skipManagerId || (p.managerId ? profiles[p.managerId]?.managerId : null) || null;
    if (p.managerId && profiles[p.managerId]?.status !== 'active') warnings.push(`Quản lý trực tiếp của ${p.name} đang ngừng hoạt động.`);
    out[id] = cleanUndefined({
      name: p.name, employeeCode: p.employeeCode, title: p.title, titleGroup: p.titleGroup, unitId: p.unitId, unitName: units[p.unitId]?.name || '',
      managerId: p.managerId || undefined, managerName: p.managerId ? profiles[p.managerId]?.name : undefined, managerTitle: p.managerId ? profiles[p.managerId]?.title : undefined,
      skipManagerId: skip || undefined, skipManagerName: skip ? profiles[skip]?.name : undefined, skipManagerTitle: skip ? profiles[skip]?.title : undefined,
      chain: Object.keys(chain).length ? chain : undefined, included: true,
    });
  }
  return { users: out, warnings };
}

export function emptyPeriod() {
  const y = new Date().getFullYear();
  return {
    code: `KY-${y}`, name: `Kỳ đánh giá năm ${y}`, year: y, type: 'year', startDate: `${y}-01-01`, endDate: `${y}-12-31`, status: 'draft',
    scope: { rootUnitId: Object.entries(ctx.units).find(([, u]) => !u.parentId)?.[0] || null, includeAllActive: true, excludeUserIds: {} },
    kbiValueIds: Object.fromEntries(Object.keys(ctx.kbiCatalog).filter((k) => ctx.kbiCatalog[k].status === 'active').map((k) => [k, true])),
    milestones: { assignDeadline: '', selfAssessDeadline: '', managerAssessDeadline: '', approvalDeadline: '' },
    rules: { allowReturn: true, allowEditAfterSubmit: false, enforceDeadlines: false },
    policyRefs: { kbi: 'default', grading: 'default', weight: 'default', workflow: 'default', form: 'default', kpiAggregation: 'default' },
  };
}

export async function savePeriod(id, data, previous = null) {
  const pid = id || newKey('evaluationPeriods');
  const base = previous ? clone(previous) : {};
  const rec = cleanUndefined({ ...base, ...data, status: previous?.status || data.status || 'draft', updatedAt: NOW(), updatedBy: ctx.userId, createdAt: previous?.createdAt || NOW(), createdBy: previous?.createdBy || ctx.userId });
  await write({
    [`evaluationPeriods/${pid}`]: rec,
    ...auditUpdate({ type: previous ? 'period_update' : 'period_create', entity: 'period', entityId: pid, periodId: pid, before: previous ? { name: previous.name, status: previous.status } : null, after: { name: rec.name, status: rec.status } }),
  });
  return pid;
}

/** Sao chép cấu hình kỳ trước (không sao chép kết quả đánh giá). */
export function copyConfig(fromPeriod) {
  const c = clone(fromPeriod);
  for (const k of ['status', 'policies', 'policyHistory', 'statusLog', 'initializedAt', 'participantCount', 'orgVersionId', 'approvedBy', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'lastUnlock']) delete c[k];
  c.year = (Number(fromPeriod.year) || new Date().getFullYear()) + 1;
  c.code = `KY-${c.year}`;
  c.name = `Kỳ đánh giá năm ${c.year}`;
  c.startDate = `${c.year}-01-01`;
  c.endDate = `${c.year}-12-31`;
  c.status = 'draft';
  c.copiedFrom = fromPeriod.code || null;
  for (const k of Object.keys(c.milestones || {})) c.milestones[k] = '';
  return c;
}

export async function changeStatus(periodId, period, to, reason = '') {
  const from = period.status;
  if (!PERIOD_FLOW[from]?.includes(to)) throw new Error(`Không thể chuyển kỳ từ "${from}" sang "${to}".`);
  const updates = { [`evaluationPeriods/${periodId}/status`]: to, [`evaluationPeriods/${periodId}/updatedAt`]: NOW(), [`evaluationPeriods/${periodId}/updatedBy`]: ctx.userId };
  if (to === 'open' && !period.policies) {
    const { snap, missing } = snapshotPolicies(period.policyRefs);
    if (missing.length) throw new Error(`Không thể mở kỳ: thiếu cấu hình ${missing.join(', ')}.`);
    updates[`evaluationPeriods/${periodId}/policies`] = snap;
  }
  if (to === 'open' && !period.initializedAt) throw new Error('Cần khởi tạo danh sách nhân sự tham gia kỳ trước khi mở kỳ.');
  if (from === 'locked') updates[`evaluationPeriods/${periodId}/lastUnlock`] = { by: ctx.userId, at: NOW(), reason };
  const lid = newKey(`evaluationPeriods/${periodId}/statusLog`);
  updates[`evaluationPeriods/${periodId}/statusLog/${lid}`] = { from, to, by: ctx.userId, at: NOW(), reason: reason || null };
  Object.assign(updates, auditUpdate({ type: from === 'locked' ? 'period_unlock' : 'period_status', entity: 'period', entityId: periodId, periodId, before: { status: from }, after: { status: to }, reason }));
  await write(updates);
}

/** Khởi tạo/cập nhật danh sách nhân sự của kỳ + chụp phiên bản cơ cấu áp dụng cho kỳ. */
export async function initializeParticipants(periodId, period, users) {
  const ovId = newKey('organizationVersions');
  await write({
    [`evaluationPeriodUsers/${periodId}`]: users,
    [`organizationVersions/${ovId}`]: { name: `Cơ cấu áp dụng kỳ ${period.code || periodId}`, periodId, createdAt: NOW(), createdBy: ctx.userId, units: ctx.units, reporting: currentReporting() },
    [`evaluationPeriods/${periodId}/orgVersionId`]: ovId,
    [`evaluationPeriods/${periodId}/participantCount`]: Object.keys(users).length,
    [`evaluationPeriods/${periodId}/initializedAt`]: NOW(),
    [`evaluationPeriods/${periodId}/updatedAt`]: NOW(),
    [`evaluationPeriods/${periodId}/updatedBy`]: ctx.userId,
    ...auditUpdate({ type: 'period_participants', entity: 'period', entityId: periodId, periodId, before: { count: period.participantCount || 0 }, after: { count: Object.keys(users).length, orgVersionId: ovId } }),
  });
}

/** Cập nhật chính sách áp dụng cho kỳ (có lưu bản cũ + lý do). */
export async function refreezePolicies(periodId, period, reason) {
  const { snap, missing } = snapshotPolicies(period.policyRefs);
  if (missing.length) throw new Error(`Thiếu cấu hình: ${missing.join(', ')}.`);
  const hid = newKey(`evaluationPeriods/${periodId}/policyHistory`);
  await write({
    [`evaluationPeriods/${periodId}/policies`]: snap,
    ...(period.policies ? { [`evaluationPeriods/${periodId}/policyHistory/${hid}`]: { replacedAt: NOW(), replacedBy: ctx.userId, reason, previous: period.policies } } : {}),
    ...auditUpdate({ type: 'period_policies', entity: 'period', entityId: periodId, periodId, reason, after: { frozen: true } }),
  });
}

export function deadlineInfo(period, key) {
  const d = period?.milestones?.[key];
  if (!d) return null;
  const end = new Date(`${d}T23:59:59`);
  return { date: d, overdue: Date.now() > end.getTime(), daysLeft: Math.ceil((end.getTime() - Date.now()) / 86400000) };
}
