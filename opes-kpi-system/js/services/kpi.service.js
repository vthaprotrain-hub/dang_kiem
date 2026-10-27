/**
 * Kế hoạch KPI cá nhân, giao KPI TOP-DOWN, sub-KPI, trọng số, tiếp nhận/điều chỉnh, cây KPI.
 *
 * Lưu ý cấu trúc ghi: Rules cấp quyền ở mức từng phần của chỉ tiêu (spec / weight / ack / meta),
 * vì vậy mọi thao tác ghi đều tách thành các đường dẫn con và gửi trong MỘT lệnh update nguyên tử.
 */
import { write, NOW, newKey, auditUpdate, historyUpdate, notifyUpdate, read, DENIED } from './database.service.js';
import { ctx, nameOf } from '../state.js';
import { cleanUndefined, clone, numOrNull } from '../utils.js';
import { toNumber } from '../core/scoring.js';

export const planPath = (p, u) => `kpiPlans/${p}/${u}`;
export const assignmentPath = (p, from, aid) => `kpiAssignments/${p}/${from}/${aid}`;

export function itemList(plan, { includeRevoked = true } = {}) {
  return Object.entries(plan?.items || {})
    .map(([id, it]) => ({ id, ...it }))
    .filter((it) => it.spec && (includeRevoked || it.spec.state !== 'revoked'))
    .sort((a, b) => (a.spec.order ?? 999) - (b.spec.order ?? 999));
}

function planInit(p, u, plan) {
  if (plan?.status) return {};
  return {
    [`${planPath(p, u)}/status`]: 'draft',
    [`${planPath(p, u)}/meta`]: { createdAt: NOW(), createdBy: ctx.userId, unitId: ctx.periodUsers[u]?.unitId || null },
  };
}

function itemParts(p, u, itemId, parts) {
  const out = {};
  for (const [k, v] of Object.entries(parts)) out[`${planPath(p, u)}/items/${itemId}/${k}`] = v === undefined ? null : (v && typeof v === 'object' ? cleanUndefined(v) : v);
  return out;
}

const maxOrder = (plan) => Math.max(0, ...itemList(plan).map((i) => i.spec.order || 0));

/** Chuẩn hóa nội dung chỉ tiêu từ biểu mẫu. */
export function normalizeSpec(f, base = {}) {
  const targets = {
    threshold: numOrNull(f.threshold ?? f.targets?.threshold),
    base: numOrNull(f.base ?? f.targets?.base),
    stretch: numOrNull(f.stretch ?? f.targets?.stretch),
  };
  Object.keys(targets).forEach((k) => targets[k] === null && delete targets[k]);
  const levels = {};
  for (const l of [1, 2, 3, 4, 5]) {
    const v = f[`level${l}`] ?? f.levelDescriptions?.[l];
    if (v && String(v).trim()) levels[l] = String(v).trim();
  }
  const spec = {
    ...base,
    title: String(f.title ?? base.title ?? '').trim(),
    groupId: f.groupId ?? base.groupId,
    description: f.description ?? base.description ?? '',
    measurement: f.measurement ?? base.measurement ?? '',
    unit: f.unit ?? base.unit ?? '',
    direction: f.direction ?? base.direction ?? 'higher',
    scoring: { policyId: f.policyId ?? base.scoring?.policyId ?? null },
    targets,
    levelDescriptions: Object.keys(levels).length ? levels : null,
    evidenceRequired: f.evidenceRequired ?? base.evidenceRequired ?? false,
    evidenceNote: f.evidenceNote ?? base.evidenceNote ?? '',
    frequency: f.frequency ?? base.frequency ?? 'year',
    dataSource: f.dataSource ?? base.dataSource ?? '',
    deadline: f.deadline ?? base.deadline ?? null,
    evaluatorNote: f.evaluatorNote ?? base.evaluatorNote ?? '',
    state: base.state || 'active',
  };
  if (f.aggregationMethod !== undefined) {
    spec.aggregation = f.aggregationMethod === 'direct' && !base.aggregation
      ? null
      : { method: f.aggregationMethod, missingChild: f.missingChild || 'exclude', ...(f.aggregationMethod === 'children_weighted' ? { parentShare: toNumber(f.parentShare) ?? 0.5 } : {}) };
  }
  if (f.countInTotal !== undefined) spec.countInTotal = f.countInTotal !== false && f.countInTotal !== 'false';
  return cleanUndefined(spec);
}

export function specFromCatalog(kpi, kpiId) {
  return cleanUndefined({
    title: kpi.name, groupId: kpi.groupId, description: kpi.description || '', measurement: kpi.measurement || '', unit: kpi.unit || '', direction: kpi.direction || 'higher',
    scoring: { policyId: kpi.scoringPolicyId || null }, targets: clone(kpi.targets || {}), levelDescriptions: kpi.levelDescriptions ? clone(kpi.levelDescriptions) : null,
    evidenceRequired: !!kpi.evidenceRequired, evidenceNote: kpi.evidenceNote || '', frequency: kpi.frequency || 'year', dataSource: kpi.dataSource || '',
    catalogRef: { id: kpiId, code: kpi.code, version: kpi.version || 1, visibility: kpi.visibility || 'public' },
    catalogSnapshot: { name: kpi.name, code: kpi.code, version: kpi.version || 1, measurement: kpi.measurement || '', targets: clone(kpi.targets || {}), scoringPolicyId: kpi.scoringPolicyId || null, snapshotAt: Date.now() },
    state: 'active', countInTotal: true,
  });
}

// ---------------------------------------------------------------------------
// Chỉ tiêu do chính người dùng xây dựng (từ kho, tự tạo, sub-KPI)
// ---------------------------------------------------------------------------
export async function addOwnItem({ periodId, userId, plan, spec, weight, source }) {
  const itemId = newKey(`${planPath(periodId, userId)}/items`);
  const full = cleanUndefined({ ...spec, source, state: 'active', order: maxOrder(plan) + 1, createdBy: ctx.userId, createdAt: NOW(), countInTotal: spec.parentItemId ? undefined : spec.countInTotal ?? true });
  if (source !== 'catalog') delete full.catalogSnapshot;
  await write({
    ...planInit(periodId, userId, plan),
    ...itemParts(periodId, userId, itemId, { spec: full, weight: Number(weight) || 0, meta: { updatedAt: NOW(), updatedBy: ctx.userId } }),
    ...historyUpdate(planPath(periodId, userId), { action: source === 'sub' ? 'sub_create' : 'item_add', itemId, after: { title: full.title, weight: Number(weight) || 0, parentItemId: full.parentItemId || null } }),
    ...(source === 'sub' ? auditUpdate({ type: 'sub_kpi_create', entity: 'kpiItem', entityId: `${periodId}/${userId}/${itemId}`, periodId, after: { title: full.title, parentItemId: full.parentItemId } }) : {}),
  });
  return itemId;
}

/**
 * "Thêm KPI từ năm trước": ghi nhiều chỉ tiêu trong một giao dịch (ánh xạ lại quan hệ KPI cha – sub-KPI).
 * items: [{ fromId, parentFromId, source, spec, weight }] – kết quả của buildCarryItems (js/core/carryover.js).
 */
export async function carryOverItems({ periodId, userId, plan, sourcePeriodId, sourcePeriodName = '', items }) {
  if (!items.length) throw new Error('Chưa chọn KPI nào.');
  for (const it of items) {
    if (!Number.isFinite(it.weight) || it.weight < 0 || it.weight > 100) throw new Error(`Trọng số của "${it.spec.title}" phải từ 0 đến 100.`);
    if (!String(it.spec.title || '').trim()) throw new Error('Có KPI chưa có tên.');
  }
  const base = planPath(periodId, userId);
  const ids = Object.fromEntries(items.map((it) => [it.fromId, newKey(`${base}/items`)]));
  let order = maxOrder(plan);
  const updates = { ...planInit(periodId, userId, plan) };
  const note = `Sao chép từ ${sourcePeriodName || sourcePeriodId}`;
  for (const it of items) {
    const itemId = ids[it.fromId];
    const parentItemId = it.parentFromId ? ids[it.parentFromId] : undefined;
    const full = cleanUndefined({
      ...it.spec, source: it.source, state: 'active', order: ++order, createdBy: ctx.userId, createdAt: NOW(),
      parentItemId, countInTotal: parentItemId ? undefined : true,
    });
    if (it.source !== 'catalog') delete full.catalogSnapshot;
    if (it.source === 'custom') delete full.catalogRef;
    Object.assign(updates, itemParts(periodId, userId, itemId, { spec: full, weight: Number(it.weight) || 0, meta: { updatedAt: NOW(), updatedBy: ctx.userId } }));
    Object.assign(updates, historyUpdate(base, { action: it.source === 'sub' ? 'sub_create' : 'item_add', itemId, after: { title: full.title, weight: Number(it.weight) || 0, parentItemId: parentItemId || null, source: it.source }, note }));
  }
  Object.assign(updates, auditUpdate({
    type: 'kpi_carry_over', entity: 'kpiPlan', entityId: `${periodId}/${userId}`, periodId,
    after: { sourcePeriodId, count: items.length, catalog: items.filter((i) => i.spec.copiedFrom?.status === 'catalog').length, created: items.filter((i) => i.spec.copiedFrom?.status === 'new').length },
  }));
  await write(updates);
  return ids;
}

export async function updateItemSpec({ periodId, userId, itemId, item, spec, weight, reason = '' }) {
  const updates = {};
  const before = { title: item.spec.title, weight: item.weight, targets: item.spec.targets || null, policyId: item.spec.scoring?.policyId || null };
  const after = { title: spec.title, weight: weight ?? item.weight, targets: spec.targets || null, policyId: spec.scoring?.policyId || null };
  Object.assign(updates, itemParts(periodId, userId, itemId, { spec: { ...item.spec, ...spec, updatedAt: NOW(), updatedBy: ctx.userId }, meta: { updatedAt: NOW(), updatedBy: ctx.userId } }));
  if (weight !== undefined && Number(weight) !== Number(item.weight)) updates[`${planPath(periodId, userId)}/items/${itemId}/weight`] = Number(weight);
  Object.assign(updates, historyUpdate(planPath(periodId, userId), { action: 'item_update', itemId, before, after, reason }));
  if (JSON.stringify(before.targets) !== JSON.stringify(after.targets)) {
    Object.assign(updates, auditUpdate({ type: 'target_change', entity: 'kpiItem', entityId: `${periodId}/${userId}/${itemId}`, periodId, before: before.targets, after: after.targets, reason }));
  }
  await write(updates);
}

export async function deleteOwnItem({ periodId, userId, itemId, item, plan }) {
  const children = itemList(plan).filter((c) => c.spec.parentItemId === itemId);
  if (children.length) throw new Error('Chỉ tiêu đang có sub-KPI – cần xóa hoặc chuyển các sub-KPI trước.');
  await write({
    ...itemParts(periodId, userId, itemId, { spec: null, weight: null, ack: null, meta: null }),
    ...historyUpdate(planPath(periodId, userId), { action: 'item_delete', itemId, before: { title: item.spec.title, weight: item.weight } }),
  });
}

export async function setWeight({ periodId, userId, itemId, item, weight, reason = '' }) {
  const w = Number(weight);
  if (!Number.isFinite(w) || w < 0 || w > 100) throw new Error('Trọng số phải từ 0 đến 100%.');
  const s = item.spec;
  const self = userId === ctx.userId;
  if (self && s.source === 'assigned') {
    if (s.weightMode !== 'flex') throw new Error('Trọng số do cấp trên giao cố định (chế độ A). Hãy gửi yêu cầu điều chỉnh.');
    if (toNumber(s.minWeight) !== null && w < s.minWeight) throw new Error(`Trọng số không được thấp hơn ${s.minWeight}% theo quy định giao.`);
    if (toNumber(s.maxWeight) !== null && w > s.maxWeight) throw new Error(`Trọng số không được vượt ${s.maxWeight}%.`);
  }
  await write({
    [`${planPath(periodId, userId)}/items/${itemId}/weight`]: w,
    [`${planPath(periodId, userId)}/items/${itemId}/meta`]: { updatedAt: NOW(), updatedBy: ctx.userId },
    ...historyUpdate(planPath(periodId, userId), { action: 'weight_change', itemId, before: { weight: item.weight }, after: { weight: w }, reason }),
    ...auditUpdate({ type: 'weight_change', entity: 'kpiItem', entityId: `${periodId}/${userId}/${itemId}`, periodId, before: { weight: item.weight }, after: { weight: w }, reason }),
  });
}

/** Người nhận phản hồi KPI được giao: tiếp nhận hoặc yêu cầu điều chỉnh. */
export async function acknowledge({ periodId, userId, itemId, item, status, note = '', requestedWeight = null }) {
  const s = item.spec;
  const ack = cleanUndefined({ status, note: note || null, requestedWeight: requestedWeight === null || requestedWeight === '' ? null : Number(requestedWeight), by: ctx.userId, at: NOW() });
  const updates = {
    [`${planPath(periodId, userId)}/items/${itemId}/ack`]: ack,
    ...historyUpdate(planPath(periodId, userId), { action: status === 'accepted' ? 'ack_accept' : 'ack_change_request', itemId, after: { status, requestedWeight: ack.requestedWeight ?? null }, note }),
  };
  if (s.assignmentId && s.assignedBy) {
    const a = assignmentPath(periodId, s.assignedBy, s.assignmentId);
    updates[`${a}/status`] = status;
    updates[`${a}/response`] = cleanUndefined({ status, note: note || null, requestedWeight: ack.requestedWeight ?? null, by: ctx.userId, at: NOW() });
    Object.assign(updates, notifyUpdate(s.assignedBy, {
      type: status === 'accepted' ? 'kpi_accepted' : 'kpi_change_requested',
      title: status === 'accepted' ? 'KPI đã được tiếp nhận' : 'Yêu cầu điều chỉnh KPI',
      message: `${ctx.profile?.name} ${status === 'accepted' ? 'đã tiếp nhận' : 'đề nghị điều chỉnh'} chỉ tiêu "${s.title}"${ack.requestedWeight != null ? ` (đề xuất trọng số ${ack.requestedWeight}%)` : ''}.`,
      link: '#/kpi/assign',
    }));
  }
  await write(updates);
}

// ---------------------------------------------------------------------------
// Giao KPI TOP-DOWN
// ---------------------------------------------------------------------------
export function planEditableStatus(plan) {
  return !plan?.status || plan.status === 'draft' || plan.status === 'returned';
}

/**
 * Giao một chỉ tiêu (KPI/sub-KPI) cho nhiều người nhận.
 * @param {object} o
 * @param {string} o.periodId
 * @param {Array<{userId, weight}>} o.recipients
 * @param {object} o.spec              nội dung chỉ tiêu (đã chuẩn hóa)
 * @param {'fixed'|'flex'} o.weightMode chế độ A (cố định) / B (cho điều chỉnh có điều kiện)
 * @param {number} o.minWeight         X% khi chế độ B
 * @param {number|null} o.maxWeight
 * @param {{userId,itemId,title}|null} o.sourceItemRef  KPI cha trong kế hoạch người giao (nếu là sub-KPI)
 * @param {boolean} o.draft            lưu ở trạng thái "Chờ giao"
 * @param {object} o.recipientPlans    {userId: plan} hiện tại của người nhận
 */
export async function assignKpi({ periodId, recipients, spec, weightMode = 'fixed', minWeight = null, maxWeight = null, sourceItemRef = null, draft = false, recipientPlans = {}, note = '' }) {
  if (!recipients.length) throw new Error('Chưa chọn người nhận.');
  const me = ctx.userId;
  const updates = {};
  const created = [];
  for (const r of recipients) {
    const pu = ctx.periodUsers[r.userId];
    if (!pu?.chain?.[me]) throw new Error(`${nameOf(r.userId)} không thuộc phạm vi quản lý của bạn trong kỳ này.`);
    const w = Number(r.weight);
    if (!Number.isFinite(w) || w <= 0 || w > 100) throw new Error(`Trọng số giao cho ${nameOf(r.userId)} không hợp lệ.`);
    if (weightMode === 'flex' && minWeight !== null && w < minWeight) throw new Error(`Trọng số giao (${w}%) thấp hơn mức tối thiểu X = ${minWeight}%.`);
    const plan = recipientPlans[r.userId];
    if (!draft && !planEditableStatus(plan)) throw new Error(`Kế hoạch của ${nameOf(r.userId)} đang ở trạng thái "${plan.status}" – cần trả lại/mở sửa đổi trước khi giao thêm.`);
    const aid = newKey(`kpiAssignments/${periodId}/${me}`);
    const itemId = draft ? null : newKey(`${planPath(periodId, r.userId)}/items`);
    const fullSpec = cleanUndefined({
      ...spec, source: 'assigned', assignmentId: aid, assignedBy: me, assignedByName: ctx.profile?.name || '', assignedAt: NOW(),
      weightMode, minWeight: weightMode === 'flex' ? minWeight : null, maxWeight: weightMode === 'flex' ? maxWeight : null, originalWeight: w,
      parentRef: sourceItemRef || null, state: 'active', countInTotal: true, createdBy: me, createdAt: NOW(), order: maxOrder(plan) + 1,
      assignNote: note || null,
    });
    delete fullSpec.parentItemId;
    updates[assignmentPath(periodId, me, aid)] = cleanUndefined({
      fromId: me, fromName: ctx.profile?.name || '', toId: r.userId, toName: nameOf(r.userId), status: draft ? 'draft' : 'assigned', itemId,
      spec: fullSpec, weight: w, weightMode, minWeight: weightMode === 'flex' ? minWeight : null, maxWeight: weightMode === 'flex' ? maxWeight : null,
      sourceItemRef: sourceItemRef || null, createdAt: NOW(), assignedAt: draft ? null : NOW(), note: note || null,
    });
    if (!draft) {
      Object.assign(updates, planInit(periodId, r.userId, plan));
      Object.assign(updates, itemParts(periodId, r.userId, itemId, { spec: fullSpec, weight: w, ack: { status: 'pending', by: me, at: NOW() }, meta: { updatedAt: NOW(), updatedBy: me } }));
      Object.assign(updates, historyUpdate(planPath(periodId, r.userId), { action: 'assign', itemId, after: { title: fullSpec.title, weight: w, weightMode, minWeight: fullSpec.minWeight ?? null }, note }));
      Object.assign(updates, notifyUpdate(r.userId, { type: 'kpi_assigned', title: 'Bạn được giao KPI mới', message: `${ctx.profile?.name} đã giao chỉ tiêu "${fullSpec.title}" (trọng số ${w}%, ${weightMode === 'fixed' ? 'cố định' : `được điều chỉnh, tối thiểu ${minWeight}%`}).`, link: '#/kpi/inbox' }));
    }
    created.push({ aid, itemId, userId: r.userId });
  }
  Object.assign(updates, auditUpdate({ type: draft ? 'kpi_assign_draft' : 'kpi_assign', entity: 'kpiAssignment', entityId: created.map((c) => c.aid).join(','), periodId, after: { title: spec.title, recipients: recipients.map((r) => ({ userId: r.userId, weight: Number(r.weight) })), weightMode, minWeight } }));
  await write(updates);
  return created;
}

/** Giao chính thức một bản ghi đang "Chờ giao". */
export async function sendDraftAssignment({ periodId, aid, assignment, recipientPlan }) {
  if (!planEditableStatus(recipientPlan)) throw new Error(`Kế hoạch của ${assignment.toName} không ở trạng thái cho phép giao thêm.`);
  const me = ctx.userId;
  const itemId = newKey(`${planPath(periodId, assignment.toId)}/items`);
  const spec = cleanUndefined({ ...assignment.spec, assignedAt: NOW(), order: maxOrder(recipientPlan) + 1 });
  await write({
    [`${assignmentPath(periodId, me, aid)}/status`]: 'assigned',
    [`${assignmentPath(periodId, me, aid)}/itemId`]: itemId,
    [`${assignmentPath(periodId, me, aid)}/assignedAt`]: NOW(),
    ...planInit(periodId, assignment.toId, recipientPlan),
    ...itemParts(periodId, assignment.toId, itemId, { spec, weight: assignment.weight, ack: { status: 'pending', by: me, at: NOW() }, meta: { updatedAt: NOW(), updatedBy: me } }),
    ...historyUpdate(planPath(periodId, assignment.toId), { action: 'assign', itemId, after: { title: spec.title, weight: assignment.weight, weightMode: spec.weightMode } }),
    ...notifyUpdate(assignment.toId, { type: 'kpi_assigned', title: 'Bạn được giao KPI mới', message: `${ctx.profile?.name} đã giao chỉ tiêu "${spec.title}" (trọng số ${assignment.weight}%).`, link: '#/kpi/inbox' }),
    ...auditUpdate({ type: 'kpi_assign', entity: 'kpiAssignment', entityId: aid, periodId, after: { toId: assignment.toId, title: spec.title, weight: assignment.weight } }),
  });
}

export async function deleteDraftAssignment({ periodId, aid }) {
  await write({ [assignmentPath(periodId, ctx.userId, aid)]: null });
}

/** Thu hồi KPI đã giao (giữ lịch sử, chỉ tiêu chuyển trạng thái "Đã thu hồi" – không tính điểm). */
export async function revokeAssignment({ periodId, aid, assignment, recipientPlan, reason }) {
  const me = ctx.userId;
  const updates = {
    [`${assignmentPath(periodId, me, aid)}/status`]: 'revoked',
    [`${assignmentPath(periodId, me, aid)}/revokedAt`]: NOW(),
    [`${assignmentPath(periodId, me, aid)}/revokeReason`]: reason,
  };
  if (assignment.itemId && recipientPlan?.items?.[assignment.itemId]) {
    if (!planEditableStatus(recipientPlan)) throw new Error('Kế hoạch của người nhận đã trình/duyệt – cần trả lại hoặc mở sửa đổi trước khi thu hồi.');
    const base = `${planPath(periodId, assignment.toId)}/items/${assignment.itemId}`;
    updates[`${base}/spec/state`] = 'revoked';
    updates[`${base}/spec/revokedAt`] = NOW();
    updates[`${base}/spec/revokeReason`] = reason;
    Object.assign(updates, historyUpdate(planPath(periodId, assignment.toId), { action: 'revoke', itemId: assignment.itemId, before: { state: 'active' }, after: { state: 'revoked' }, reason }));
    Object.assign(updates, notifyUpdate(assignment.toId, { type: 'kpi_revoked', title: 'KPI đã bị thu hồi', message: `${ctx.profile?.name} đã thu hồi chỉ tiêu "${assignment.spec?.title}". Lý do: ${reason}`, link: '#/kpi/my' }));
  }
  Object.assign(updates, auditUpdate({ type: 'kpi_revoke', entity: 'kpiAssignment', entityId: aid, periodId, before: { status: assignment.status }, after: { status: 'revoked' }, reason }));
  await write(updates);
}

/** Người giao điều chỉnh trọng số (ví dụ theo yêu cầu của người nhận) – người nhận cần tiếp nhận lại. */
export async function adjustAssignment({ periodId, aid, assignment, recipientPlan, weight, weightMode, minWeight, maxWeight, reason }) {
  const me = ctx.userId;
  const w = Number(weight);
  if (!Number.isFinite(w) || w <= 0 || w > 100) throw new Error('Trọng số không hợp lệ.');
  if (weightMode === 'flex' && minWeight !== null && w < minWeight) throw new Error(`Trọng số thấp hơn mức tối thiểu ${minWeight}%.`);
  const updates = {
    [`${assignmentPath(periodId, me, aid)}/weight`]: w,
    [`${assignmentPath(periodId, me, aid)}/weightMode`]: weightMode,
    [`${assignmentPath(periodId, me, aid)}/minWeight`]: weightMode === 'flex' ? minWeight : null,
    [`${assignmentPath(periodId, me, aid)}/maxWeight`]: weightMode === 'flex' ? maxWeight : null,
    [`${assignmentPath(periodId, me, aid)}/status`]: assignment.status === 'draft' ? 'draft' : 'assigned',
    [`${assignmentPath(periodId, me, aid)}/spec/weightMode`]: weightMode,
    [`${assignmentPath(periodId, me, aid)}/spec/minWeight`]: weightMode === 'flex' ? minWeight : null,
    [`${assignmentPath(periodId, me, aid)}/spec/maxWeight`]: weightMode === 'flex' ? maxWeight : null,
  };
  const item = assignment.itemId ? recipientPlan?.items?.[assignment.itemId] : null;
  if (item) {
    if (!planEditableStatus(recipientPlan)) throw new Error('Kế hoạch của người nhận đã trình/duyệt – cần trả lại hoặc mở sửa đổi trước.');
    const base = `${planPath(periodId, assignment.toId)}/items/${assignment.itemId}`;
    updates[`${base}/weight`] = w;
    updates[`${base}/spec/weightMode`] = weightMode;
    updates[`${base}/spec/minWeight`] = weightMode === 'flex' ? minWeight : null;
    updates[`${base}/spec/maxWeight`] = weightMode === 'flex' ? maxWeight : null;
    updates[`${base}/ack`] = { status: 'pending', by: me, at: NOW(), note: `Người giao đã điều chỉnh: ${reason}` };
    Object.assign(updates, historyUpdate(planPath(periodId, assignment.toId), { action: 'weight_change', itemId: assignment.itemId, before: { weight: item.weight, weightMode: item.spec.weightMode }, after: { weight: w, weightMode }, reason }));
    Object.assign(updates, notifyUpdate(assignment.toId, { type: 'kpi_adjusted', title: 'KPI được điều chỉnh', message: `${ctx.profile?.name} đã điều chỉnh trọng số "${assignment.spec?.title}" thành ${w}%. Vui lòng tiếp nhận lại.`, link: '#/kpi/inbox' }));
  }
  Object.assign(updates, auditUpdate({ type: 'weight_change', entity: 'kpiAssignment', entityId: aid, periodId, before: { weight: assignment.weight, weightMode: assignment.weightMode }, after: { weight: w, weightMode }, reason }));
  await write(updates);
}

// ---------------------------------------------------------------------------
// Kiểm tra kế hoạch
// ---------------------------------------------------------------------------
export function validatePlan(plan, policies = ctx.period?.policies || {}) {
  const errors = [], warnings = [];
  const wp = policies.weight || {};
  const items = itemList(plan, { includeRevoked: false });
  const top = items.filter((i) => !i.spec.parentItemId || !plan.items[i.spec.parentItemId] || plan.items[i.spec.parentItemId].spec?.state === 'revoked');
  const counted = top.filter((i) => i.spec.countInTotal !== false);
  const total = Math.round(counted.reduce((s, i) => s + (Number(i.weight) || 0), 0) * 1e6) / 1e6;
  const groups = {};
  counted.forEach((i) => { groups[i.spec.groupId] = (groups[i.spec.groupId] || 0) + (Number(i.weight) || 0); });
  if (!items.length) errors.push('Kế hoạch chưa có chỉ tiêu nào.');
  if (toNumber(wp.totalRequired) === null) warnings.push('Chưa cấu hình tổng trọng số bắt buộc cho kỳ.');
  else if (Math.abs(total - wp.totalRequired) > (wp.tolerance ?? 0.01)) errors.push(`Tổng trọng số hiện là ${total}% – yêu cầu ${wp.totalRequired}%.`);
  for (const i of counted) {
    const w = Number(i.weight) || 0;
    if (toNumber(wp.minItemWeight) !== null && w < wp.minItemWeight) warnings.push(`"${i.spec.title}" có trọng số ${w}% thấp hơn mức tối thiểu khuyến nghị ${wp.minItemWeight}%.`);
    if (toNumber(wp.maxItemWeight) !== null && w > wp.maxItemWeight) warnings.push(`"${i.spec.title}" có trọng số ${w}% vượt mức tối đa khuyến nghị ${wp.maxItemWeight}%.`);
    if (i.spec.source === 'assigned' && i.spec.weightMode === 'flex' && toNumber(i.spec.minWeight) !== null && w < i.spec.minWeight) errors.push(`"${i.spec.title}" thấp hơn trọng số tối thiểu ${i.spec.minWeight}% do cấp trên quy định.`);
    if (!i.spec.scoring?.policyId || !policies.scoring?.[i.spec.scoring.policyId]) errors.push(`"${i.spec.title}" chưa có phương pháp tính điểm hợp lệ.`);
    const t = i.spec.targets || {};
    const method = policies.scoring?.[i.spec.scoring?.policyId]?.method;
    if (method === 'tiered' && [t.threshold, t.base, t.stretch].some((x) => x === undefined || x === null)) errors.push(`"${i.spec.title}" cần đủ mục tiêu Ngưỡng/Cơ bản/Đẩy mạnh.`);
    if (['ratio', 'formula'].includes(method) && (t.base === undefined || t.base === null)) errors.push(`"${i.spec.title}" cần mục tiêu Cơ bản.`);
  }
  for (const [gid, c] of Object.entries(wp.groupConstraints || {})) {
    const g = groups[gid] || 0;
    if (g === 0) continue;
    if (toNumber(c.min) !== null && g < c.min) warnings.push(`Nhóm "${ctx.config.kpiGroups?.[gid]?.name || gid}" chiếm ${g}% – dưới mức ${c.min}%.`);
    if (toNumber(c.max) !== null && g > c.max) warnings.push(`Nhóm "${ctx.config.kpiGroups?.[gid]?.name || gid}" chiếm ${g}% – vượt mức ${c.max}%.`);
  }
  // sub-KPI: tổng tỷ lệ các sub-KPI trong cùng KPI cha bắt buộc = 100% (áp dụng mọi cấp sub-KPI)
  const subShares = {};
  for (const parent of items.filter((p) => items.some((c) => c.spec.parentItemId === p.id))) {
    const kids = items.filter((c) => c.spec.parentItemId === parent.id);
    const share = Math.round(kids.reduce((s, k) => s + (Number(k.weight) || 0), 0) * 1e6) / 1e6;
    const valid = Math.abs(share - 100) <= (wp.tolerance ?? 0.01);
    subShares[parent.id] = { share, valid, count: kids.length };
    if (!valid) errors.push(`Tổng tỷ lệ các sub-KPI của "${parent.spec.title}" là ${share}% – phải bằng 100%.`);
    for (const k of kids) if (!(Number(k.weight) > 0)) errors.push(`Sub-KPI "${k.spec.title}" (thuộc "${parent.spec.title}") chưa có tỷ lệ trong KPI cha.`);
    const seen = new Set();
    for (const k of kids) {
      const t = String(k.spec.title || '').trim().toLowerCase();
      if (seen.has(t)) warnings.push(`KPI "${parent.spec.title}" có các sub-KPI trùng tên "${k.spec.title}" – nên đặt tên phân biệt.`);
      seen.add(t);
    }
  }
  const pendingAck = items.filter((i) => i.spec.source === 'assigned' && i.ack?.status !== 'accepted');
  const wf = policies.workflow?.kpiPlan || {};
  if (pendingAck.length && wf.requireAckAll !== false) errors.push(`Còn ${pendingAck.length} KPI được giao chưa tiếp nhận.`);
  return { errors, warnings, total, groups, pendingAck, counted, items, subShares };
}

// ---------------------------------------------------------------------------
// Đọc kế hoạch / phân công
// ---------------------------------------------------------------------------
export async function readPlans(periodId, userIds) {
  const out = {};
  await Promise.all(userIds.map(async (u) => {
    const v = await read(planPath(periodId, u), { allowDenied: true });
    if (v && v !== DENIED) out[u] = v;
  }));
  return out;
}

/**
 * Xây cây KPI: KPI trong kế hoạch người gốc → sub-KPI cùng kế hoạch → KPI được giao xuống (parentRef) ở kế hoạch cấp dưới.
 * @returns {Array<node>} node = {key, userId, itemId, item, children, level}
 */
export function buildKpiTree(rootUserId, plans) {
  const childrenByRef = new Map(); // `${userId}/${itemId}` -> [{userId, itemId}]
  const unlinkedByAssigner = new Map();
  for (const [uid, plan] of Object.entries(plans)) {
    for (const [iid, it] of Object.entries(plan.items || {})) {
      const s = it.spec || {};
      if (s.parentRef?.userId && s.parentRef?.itemId) {
        const k = `${s.parentRef.userId}/${s.parentRef.itemId}`;
        if (!childrenByRef.has(k)) childrenByRef.set(k, []);
        childrenByRef.get(k).push({ userId: uid, itemId: iid });
      } else if (s.source === 'assigned' && s.assignedBy) {
        if (!unlinkedByAssigner.has(s.assignedBy)) unlinkedByAssigner.set(s.assignedBy, []);
        unlinkedByAssigner.get(s.assignedBy).push({ userId: uid, itemId: iid });
      }
    }
  }
  const seen = new Set();
  const make = (userId, itemId, level) => {
    const key = `${userId}/${itemId}`;
    if (seen.has(key)) return null;
    seen.add(key);
    const item = plans[userId]?.items?.[itemId];
    if (!item) return null;
    const inPlanKids = Object.entries(plans[userId].items || {}).filter(([, c]) => c.spec?.parentItemId === itemId).map(([cid]) => make(userId, cid, level + 1)).filter(Boolean);
    const downKids = (childrenByRef.get(key) || []).map((c) => make(c.userId, c.itemId, level + 1)).filter(Boolean);
    return { key, userId, itemId, item, level, children: [...inPlanKids, ...downKids] };
  };
  const rootPlan = plans[rootUserId];
  const roots = [];
  if (rootPlan) {
    for (const it of itemList(rootPlan)) {
      if (it.spec.parentItemId && rootPlan.items[it.spec.parentItemId]) continue;
      const n = make(rootUserId, it.id, 0);
      if (n) roots.push(n);
    }
  }
  const direct = (unlinkedByAssigner.get(rootUserId) || []).map((c) => make(c.userId, c.itemId, 1)).filter(Boolean);
  return { roots, direct };
}
