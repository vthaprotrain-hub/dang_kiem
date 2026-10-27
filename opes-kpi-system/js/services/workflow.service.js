/**
 * Quy trình trình ký – phê duyệt cho kế hoạch KPI và hồ sơ đánh giá.
 * Mỗi bước ghi trạng thái + xác nhận điện tử + lịch sử + thông báo + kiểm toán trong MỘT lệnh ghi.
 * Database Rules kiểm tra lại: đúng người, đúng trạng thái trước đó, đủ chữ ký/lý do (không bỏ qua bước).
 */
import { write, NOW, newKey, auditUpdate, historyUpdate, notifyUpdate, signature } from './database.service.js';
import { ctx, nameOf } from '../state.js';
import { planPath } from './kpi.service.js';
import { evalPath, contentHash, planHash, finalSnapshot } from './evaluation.service.js';

const stamp = (note = '') => ({ by: ctx.userId, at: NOW(), note: note || null });
const pu = (u) => ctx.periodUsers[u] || {};
const reqSkip = (flow, userId, period = ctx.period) => period?.policies?.workflow?.[flow]?.requireSkipApproval !== false && !!pu(userId).skipManagerId;

// ---------------------------------------------------------------------------
// Kế hoạch KPI
// ---------------------------------------------------------------------------
export async function submitPlan({ periodId, userId, plan, note = '' }) {
  const base = planPath(periodId, userId);
  const version = (Number(plan.version) || 0) + 1;
  const hash = await planHash(plan);
  const managerId = pu(userId).managerId;
  await write({
    [`${base}/status`]: 'submitted',
    [`${base}/version`]: version,
    [`${base}/signatures/employee`]: signature({ version, note, contentHash: hash, role: 'employee' }),
    [`${base}/statusMeta`]: stamp(note || 'Trình duyệt bộ KPI'),
    ...historyUpdate(base, { action: 'plan_submit', after: { status: 'submitted', version }, note }),
    ...(managerId ? notifyUpdate(managerId, { type: 'plan_submitted', title: 'Kế hoạch KPI chờ phê duyệt', message: `${ctx.profile?.name} đã trình bộ KPI (phiên bản ${version}).`, link: `#/kpi/plan/${periodId}/${userId}` }) : {}),
    ...auditUpdate({ type: 'plan_submit', entity: 'kpiPlan', entityId: `${periodId}/${userId}`, periodId, before: { status: plan.status || 'draft' }, after: { status: 'submitted', version } }),
  });
}

export async function approvePlan({ periodId, userId, plan, stage, note = '' }) {
  const base = planPath(periodId, userId);
  const version = Number(plan.version) || 1;
  const hash = await planHash(plan);
  const needSkip = stage === 'manager' && reqSkip('kpiPlan', userId);
  const next = needSkip ? 'manager_approved' : 'approved';
  const u = pu(userId);
  const updates = {
    [`${base}/status`]: next,
    [`${base}/signatures/${stage === 'manager' ? 'manager' : 'skip'}`]: signature({ version, note, contentHash: hash, role: stage }),
    [`${base}/statusMeta`]: stamp(note || (next === 'approved' ? 'Phê duyệt kế hoạch' : 'Quản lý trực tiếp đã duyệt')),
    ...historyUpdate(base, { action: `plan_approve_${stage}`, before: { status: plan.status }, after: { status: next }, note }),
    ...auditUpdate({ type: 'plan_approve', entity: 'kpiPlan', entityId: `${periodId}/${userId}`, periodId, before: { status: plan.status }, after: { status: next, stage }, reason: note }),
    ...notifyUpdate(userId, { type: 'plan_approved', title: next === 'approved' ? 'Kế hoạch KPI đã được phê duyệt' : 'Kế hoạch KPI đã qua bước quản lý trực tiếp', message: `${ctx.profile?.name} đã ${next === 'approved' ? 'phê duyệt chính thức' : 'phê duyệt'} bộ KPI của bạn.`, link: '#/kpi/my' }),
  };
  if (needSkip) Object.assign(updates, notifyUpdate(u.skipManagerId, { type: 'plan_waiting_skip', title: 'Kế hoạch KPI chờ bạn phê duyệt', message: `Bộ KPI của ${nameOf(userId)} đã được quản lý trực tiếp duyệt, chờ quản lý trên một cấp.`, link: `#/kpi/plan/${periodId}/${userId}` }));
  if (stage === 'skip' && u.managerId) Object.assign(updates, notifyUpdate(u.managerId, { type: 'plan_approved', title: 'Kế hoạch KPI đã phê duyệt', message: `Bộ KPI của ${nameOf(userId)} đã được phê duyệt chính thức.`, link: `#/kpi/plan/${periodId}/${userId}` }));
  await write(updates);
}

/** Trả lại kế hoạch. target = 'employee' (Cần bổ sung) hoặc 'manager' (QL trên 1 cấp trả về QL trực tiếp). */
export async function returnPlan({ periodId, userId, plan, reason, target = 'employee' }) {
  const base = planPath(periodId, userId);
  const next = target === 'manager' ? 'submitted' : 'returned';
  const rid = newKey(`${base}/returns`);
  const u = pu(userId);
  await write({
    [`${base}/status`]: next,
    [`${base}/lastReturn`]: { by: ctx.userId, at: NOW(), reason, from: plan.status, to: next },
    [`${base}/returns/${rid}`]: { by: ctx.userId, byName: ctx.profile?.name || '', at: NOW(), reason, from: plan.status, to: next },
    [`${base}/statusMeta`]: stamp(`Trả lại: ${reason}`),
    ...historyUpdate(base, { action: 'plan_return', before: { status: plan.status }, after: { status: next }, reason }),
    ...auditUpdate({ type: 'plan_return', entity: 'kpiPlan', entityId: `${periodId}/${userId}`, periodId, before: { status: plan.status }, after: { status: next }, reason }),
    ...(target === 'manager'
      ? notifyUpdate(u.managerId, { type: 'plan_returned', title: 'Kế hoạch KPI bị trả lại', message: `Bộ KPI của ${nameOf(userId)} được trả lại để bạn xem xét. Lý do: ${reason}`, link: `#/kpi/plan/${periodId}/${userId}` })
      : notifyUpdate(userId, { type: 'plan_returned', title: 'Kế hoạch KPI cần bổ sung', message: `${ctx.profile?.name} đã trả lại bộ KPI. Lý do: ${reason}`, link: '#/kpi/my' })),
  });
}

/** Mở sửa đổi kế hoạch đã duyệt (theo cấu hình kỳ) – bắt buộc lý do, ghi kiểm toán. */
export async function reopenPlan({ periodId, userId, plan, reason }) {
  const base = planPath(periodId, userId);
  await write({
    [`${base}/status`]: 'returned',
    [`${base}/lastUnlock`]: { by: ctx.userId, at: NOW(), reason },
    [`${base}/statusMeta`]: stamp(`Mở sửa đổi: ${reason}`),
    ...historyUpdate(base, { action: 'plan_reopen', before: { status: plan.status }, after: { status: 'returned' }, reason }),
    ...auditUpdate({ type: 'plan_reopen', entity: 'kpiPlan', entityId: `${periodId}/${userId}`, periodId, before: { status: plan.status }, after: { status: 'returned' }, reason }),
    ...notifyUpdate(userId, { type: 'plan_reopened', title: 'Kế hoạch KPI được mở sửa đổi', message: `${ctx.profile?.name} đã mở sửa đổi bộ KPI. Lý do: ${reason}`, link: '#/kpi/my' }),
  });
}

// ---------------------------------------------------------------------------
// Hồ sơ đánh giá
// ---------------------------------------------------------------------------
export async function submitEvaluation({ periodId, userId, plan, evaluation, note = '' }) {
  const base = evalPath(periodId, userId);
  const version = (Number(evaluation?.version) || 0) + 1;
  const hash = await contentHash(plan, evaluation);
  const managerId = pu(userId).managerId;
  if (!evaluation?.status) {
    // Rules yêu cầu hồ sơ phải được tạo ở trạng thái Nháp trước khi gửi
    await write({ [`${base}/status`]: 'draft', [`${base}/meta`]: { createdAt: NOW(), createdBy: ctx.userId } });
  }
  await write({
    [`${base}/status`]: 'submitted',
    [`${base}/version`]: version,
    [`${base}/signatures/employee`]: signature({ version, note, contentHash: hash, role: 'employee' }),
    [`${base}/statusMeta`]: stamp(note || 'Gửi tự đánh giá'),
    ...historyUpdate(base, { action: 'eval_submit', before: { status: evaluation?.status || null }, after: { status: 'submitted', version }, note }),
    ...(managerId ? notifyUpdate(managerId, { type: 'evaluation_submitted', title: 'Hồ sơ chờ bạn đánh giá', message: `${ctx.profile?.name} đã gửi tự đánh giá (phiên bản ${version}).`, link: `#/eval/form/${periodId}/${userId}` }) : {}),
    ...auditUpdate({ type: 'eval_submit', entity: 'evaluation', entityId: `${periodId}/${userId}`, periodId, before: { status: evaluation?.status || null }, after: { status: 'submitted', version } }),
  });
}

/** Quản lý trực tiếp xác nhận đánh giá: chuyển QL trên 1 cấp (hoặc duyệt luôn nếu không có/không yêu cầu). */
export async function managerConfirm({ periodId, userId, plan, evaluation, computed, note = '', period = ctx.period }) {
  const base = evalPath(periodId, userId);
  const version = Number(evaluation.version) || 1;
  const hash = await contentHash(plan, evaluation);
  const needSkip = reqSkip('evaluation', userId, period);
  const autoLock = period?.policies?.workflow?.evaluation?.autoLockOnApproval === true;
  const next = needSkip ? 'manager_reviewed' : autoLock ? 'locked' : 'approved';
  const u = pu(userId);
  const updates = {
    [`${base}/status`]: next,
    [`${base}/signatures/manager`]: signature({ version, note, contentHash: hash, role: 'manager' }),
    [`${base}/statusMeta`]: stamp(note || (needSkip ? 'Quản lý trực tiếp đã đánh giá' : 'Phê duyệt kết quả')),
    ...historyUpdate(base, { action: 'eval_manager_confirm', before: { status: evaluation.status }, after: { status: next }, note }),
    ...auditUpdate({ type: 'eval_manager_confirm', entity: 'evaluation', entityId: `${periodId}/${userId}`, periodId, before: { status: evaluation.status }, after: { status: next, kpi: computed.kpi.total, kbi: computed.kbi.average, grade: computed.grade.code } }),
    ...notifyUpdate(userId, { type: 'evaluation_reviewed', title: needSkip ? 'Quản lý đã đánh giá hồ sơ của bạn' : 'Hồ sơ đánh giá đã được phê duyệt', message: `${ctx.profile?.name} đã ${needSkip ? 'hoàn thành đánh giá và trình phê duyệt' : 'phê duyệt'} hồ sơ của bạn.`, link: `#/eval/form/${periodId}/${userId}` }),
  };
  if (!needSkip) updates[`${base}/final`] = finalSnapshot(computed, version, period);
  if (needSkip) Object.assign(updates, notifyUpdate(u.skipManagerId, { type: 'evaluation_waiting_skip', title: 'Hồ sơ chờ phê duyệt', message: `Hồ sơ đánh giá của ${nameOf(userId)} chờ bạn phê duyệt.`, link: `#/eval/form/${periodId}/${userId}` }));
  await write(updates);
  return next;
}

export async function skipApprove({ periodId, userId, plan, evaluation, computed, note = '', period = ctx.period }) {
  const base = evalPath(periodId, userId);
  const version = Number(evaluation.version) || 1;
  const hash = await contentHash(plan, evaluation);
  const autoLock = period?.policies?.workflow?.evaluation?.autoLockOnApproval === true;
  const next = autoLock ? 'locked' : 'approved';
  const u = pu(userId);
  await write({
    [`${base}/status`]: next,
    [`${base}/signatures/skip`]: signature({ version, note, contentHash: hash, role: 'skip' }),
    [`${base}/final`]: finalSnapshot(computed, version, period),
    [`${base}/statusMeta`]: stamp(note || 'Phê duyệt kết quả'),
    ...historyUpdate(base, { action: 'eval_approve', before: { status: evaluation.status }, after: { status: next }, note }),
    ...auditUpdate({ type: 'eval_approve', entity: 'evaluation', entityId: `${periodId}/${userId}`, periodId, before: { status: evaluation.status }, after: { status: next, kpi: computed.kpi.total, kbi: computed.kbi.average, grade: computed.grade.code } }),
    ...notifyUpdate(userId, { type: 'evaluation_approved', title: 'Hồ sơ đánh giá đã được phê duyệt', message: `Kết quả: ${computed.grade.label || '—'}.`, link: `#/eval/form/${periodId}/${userId}` }),
    ...(u.managerId ? notifyUpdate(u.managerId, { type: 'evaluation_approved', title: 'Hồ sơ đã được phê duyệt', message: `Hồ sơ của ${nameOf(userId)} đã được phê duyệt.`, link: `#/eval/form/${periodId}/${userId}` }) : {}),
  });
}

/** Trả lại hồ sơ đánh giá: target 'employee' → Cần bổ sung; 'manager' → về bước QL trực tiếp. */
export async function returnEvaluation({ periodId, userId, evaluation, reason, target = 'employee' }) {
  const base = evalPath(periodId, userId);
  const next = target === 'manager' ? 'submitted' : 'returned';
  const rid = newKey(`${base}/returns`);
  const u = pu(userId);
  await write({
    [`${base}/status`]: next,
    [`${base}/lastReturn`]: { by: ctx.userId, at: NOW(), reason, from: evaluation.status, to: next },
    [`${base}/returns/${rid}`]: { by: ctx.userId, byName: ctx.profile?.name || '', at: NOW(), reason, from: evaluation.status, to: next },
    [`${base}/statusMeta`]: stamp(`Trả lại: ${reason}`),
    ...historyUpdate(base, { action: 'eval_return', before: { status: evaluation.status }, after: { status: next }, reason }),
    ...auditUpdate({ type: 'eval_return', entity: 'evaluation', entityId: `${periodId}/${userId}`, periodId, before: { status: evaluation.status }, after: { status: next }, reason }),
    ...(target === 'manager'
      ? notifyUpdate(u.managerId, { type: 'evaluation_returned', title: 'Hồ sơ bị trả lại để đánh giá lại', message: `Hồ sơ của ${nameOf(userId)} được trả lại. Lý do: ${reason}`, link: `#/eval/form/${periodId}/${userId}` })
      : notifyUpdate(userId, { type: 'evaluation_returned', title: 'Hồ sơ đánh giá cần bổ sung', message: `${ctx.profile?.name} đã trả lại hồ sơ. Lý do: ${reason}`, link: `#/eval/form/${periodId}/${userId}` })),
  });
}

export async function lockEvaluations(periodId, list, period = ctx.period) {
  const updates = {};
  for (const { userId, evaluation } of list) {
    const base = evalPath(periodId, userId);
    updates[`${base}/status`] = 'locked';
    updates[`${base}/statusMeta`] = stamp('Khóa kết quả');
    Object.assign(updates, historyUpdate(base, { action: 'eval_lock', before: { status: evaluation.status }, after: { status: 'locked' } }));
  }
  Object.assign(updates, auditUpdate({ type: 'eval_lock', entity: 'evaluation', entityId: list.map((x) => x.userId).join(','), periodId, after: { count: list.length } }));
  await write(updates);
}

export async function unlockEvaluation({ periodId, userId, evaluation, reason, target = 'employee' }) {
  const base = evalPath(periodId, userId);
  const next = target === 'manager' ? 'submitted' : 'returned';
  await write({
    [`${base}/status`]: next,
    [`${base}/lastUnlock`]: { by: ctx.userId, at: NOW(), reason, from: evaluation.status, to: next },
    [`${base}/statusMeta`]: stamp(`Mở khóa ngoại lệ: ${reason}`),
    ...historyUpdate(base, { action: 'eval_unlock', before: { status: evaluation.status }, after: { status: next }, reason }),
    ...auditUpdate({ type: 'eval_unlock', entity: 'evaluation', entityId: `${periodId}/${userId}`, periodId, before: { status: evaluation.status }, after: { status: next }, reason }),
    ...notifyUpdate(userId, { type: 'evaluation_unlocked', title: 'Hồ sơ được mở khóa ngoại lệ', message: `Lý do: ${reason}`, link: `#/eval/form/${periodId}/${userId}` }),
    ...(target === 'manager' ? notifyUpdate(pu(userId).managerId, { type: 'evaluation_unlocked', title: 'Hồ sơ được mở khóa – cần đánh giá lại', message: `Hồ sơ của ${nameOf(userId)}. Lý do: ${reason}`, link: `#/eval/form/${periodId}/${userId}` }) : {}),
  });
}

/** Đặt lại kết quả cuối khi HR khóa (tính lại theo chính sách kỳ). */
export async function refreshFinal({ periodId, userId, evaluation, computed, period = ctx.period }) {
  await write({ [`${evalPath(periodId, userId)}/final`]: finalSnapshot(computed, Number(evaluation.version) || 1, period) });
}
