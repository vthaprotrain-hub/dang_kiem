/**
 * Hồ sơ đánh giá cá nhân: lưu từng trường (không ghi đè toàn bộ hồ sơ), tính điểm theo chính sách
 * của kỳ, kiểm tra điều kiện gửi/duyệt và băm nội dung đã xác nhận.
 */
import { write, NOW } from './database.service.js';
import { ctx, kbiValuesFor } from '../state.js';
import { computeEvaluation, canonicalJSON, isBlank, STATUS } from '../core/scoring.js';
import { sha256, cleanUndefined } from '../utils.js';
import { itemList } from './kpi.service.js';

export const evalPath = (p, u) => `evaluations/${p}/${u}`;

/** Ghi một hoặc nhiều trường của hồ sơ. relUpdates: { 'self/kpi/it1/actual': 5, ... } */
export async function saveFields(periodId, userId, evaluation, relUpdates, { stage = 'self' } = {}) {
  const base = evalPath(periodId, userId);
  const updates = {};
  if (stage === 'self' && !evaluation?.status) {
    updates[`${base}/status`] = 'draft';
    updates[`${base}/meta`] = { createdAt: NOW(), createdBy: ctx.userId };
  }
  for (const [rel, v] of Object.entries(relUpdates)) updates[`${base}/${rel}`] = v === '' ? null : v;
  const part = stage === 'self' ? 'self' : stage === 'manager' ? 'manager' : 'skip';
  updates[`${base}/${part}/updatedAt`] = NOW();
  await write(cleanUndefined(updates));
}

export function computeFor({ plan, evaluation, period = ctx.period, periodUser = null, allowProvisionalGrade = false }) {
  return computeEvaluation({ plan, evaluation, policies: period?.policies || {}, kbiValues: kbiValuesFor(period, periodUser), allowProvisionalGrade });
}

/** Điều kiện để chuyển bước. Trả về {errors, warnings}. */
export function checkReady(stage, { plan, evaluation, computed, period = ctx.period }) {
  const errors = [], warnings = [];
  const items = itemList(plan, { includeRevoked: false });
  const self = evaluation?.self || {};
  const mgr = evaluation?.manager || {};
  const kbiVals = kbiValuesFor(period);
  if (plan?.status !== 'approved') errors.push('Kế hoạch KPI chưa được phê duyệt chính thức.');
  if (stage === 'employee') {
    const rows = computed.kpi.rows.filter((r) => r.status !== STATUS.EXCLUDED);
    for (const it of items) {
      const row = rows.find((r) => r.id === it.id);
      const isAggParent = row && row.actualSource === 'children';
      if (isAggParent) continue;
      // KPI cấp cao nhất bắt buộc có kết quả; sub-KPI thiếu kết quả chỉ cảnh báo (xử lý theo quy tắc tổng hợp của KPI cha)
      if (isBlank(self.kpi?.[it.id]?.actual)) (it.spec.parentItemId ? warnings : errors).push(`Chưa nhập kết quả: "${it.spec.title}".`);
      if (it.spec.evidenceRequired && isBlank(self.kpi?.[it.id]?.evidence)) warnings.push(`Thiếu minh chứng cho "${it.spec.title}" (bắt buộc theo chỉ tiêu).`);
    }
    for (const v of kbiVals) if (isBlank(self.kbi?.[v.id]?.level)) errors.push(`Chưa tự đánh giá KBI "${v.name}".`);
    if (computed.kpi.weightValid === false) errors.push(`Tổng trọng số KPI (${computed.kpi.totalWeight}%) không hợp lệ.`);
  }
  if (stage === 'manager') {
    const src = period?.policies?.kbi?.officialSource;
    if (src === 'manager' || src === 'average') for (const v of kbiVals) if (isBlank(mgr.kbi?.[v.id]?.level)) errors.push(`Chưa chấm KBI "${v.name}".`);
    if (!computed.kpi.complete) errors.push(...(computed.kpi.notes.length ? computed.kpi.notes : ['Điểm KPI chưa đủ dữ liệu.']));
    if (!computed.kbi.complete) errors.push('Điểm KBI chưa đủ dữ liệu chính thức.');
    if (computed.grade.status !== 'official') warnings.push(`Xếp loại: ${(computed.grade.reasons || []).join('; ') || computed.grade.status}`);
  }
  if (stage === 'skip') {
    if (computed.grade.status !== 'official') errors.push(`Chưa thể xếp loại chính thức: ${(computed.grade.reasons || []).join('; ')}`);
  }
  return { errors, warnings };
}

/** Bản tóm tắt kết quả cuối kỳ lưu kèm khi phê duyệt (để báo cáo & đối chiếu). */
export function finalSnapshot(computed, version, period = ctx.period) {
  const p = period?.policies || {};
  return cleanUndefined({
    kpiScore: computed.kpi.total, kpiPercent: computed.kpi.total === null ? null : Math.round(computed.kpi.total * 10000) / 100,
    kbiScore: computed.kbi.average, gradeCode: computed.grade.code, gradeLabel: computed.grade.label, gradeStatus: computed.grade.status,
    weightTotal: computed.kpi.totalWeight, computedAt: NOW(), computedBy: ctx.userId, version,
    policyVersion: { grading: p.grading?.version ?? null, kbi: p.kbi?.version ?? null, kpiAggregation: p.kpiAggregation?.version ?? null },
  });
}

export async function contentHash(plan, evaluation) {
  const items = Object.fromEntries(Object.entries(plan?.items || {}).map(([id, it]) => [id, { title: it.spec?.title, weight: it.weight, targets: it.spec?.targets || null, state: it.spec?.state }]));
  return sha256(canonicalJSON({ items, self: stripTs(evaluation?.self), manager: stripTs(evaluation?.manager), skip: stripTs(evaluation?.skip) }));
}
export async function planHash(plan) {
  const items = Object.fromEntries(Object.entries(plan?.items || {}).map(([id, it]) => [id, { title: it.spec?.title, weight: it.weight, targets: it.spec?.targets || null, state: it.spec?.state, policy: it.spec?.scoring?.policyId || null }]));
  return sha256(canonicalJSON(items));
}
function stripTs(x) {
  if (!x) return null;
  const c = JSON.parse(JSON.stringify(x));
  delete c.updatedAt;
  return c;
}

/** So sánh kết quả cuối đã lưu với tính toán lại (phát hiện sai lệch do sửa đổi/chính sách). */
export function finalMismatch(evaluation, computed) {
  const f = evaluation?.final;
  if (!f) return null;
  const diffs = [];
  if (f.kpiScore !== undefined && computed.kpi.total !== null && Math.abs((f.kpiScore ?? 0) - computed.kpi.total) > 1e-6) diffs.push(`Điểm KPI đã lưu ${f.kpiPercent}% ≠ tính lại ${Math.round(computed.kpi.total * 10000) / 100}%`);
  if (f.kbiScore !== undefined && computed.kbi.average !== null && Math.abs((f.kbiScore ?? 0) - computed.kbi.average) > 1e-6) diffs.push(`Điểm KBI đã lưu ${f.kbiScore} ≠ tính lại ${computed.kbi.average}`);
  if (f.gradeCode && computed.grade.code && f.gradeCode !== computed.grade.code) diffs.push(`Xếp loại đã lưu ${f.gradeLabel} ≠ tính lại ${computed.grade.label}`);
  return diffs.length ? diffs : null;
}
