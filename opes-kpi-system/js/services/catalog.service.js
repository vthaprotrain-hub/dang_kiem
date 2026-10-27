/**
 * Kho danh mục KPI (Public/Private), nhóm KPI, lịch sử & phiên bản danh mục.
 * Quyền xem KPI Private được giới hạn bởi Rules qua chỉ mục kpiCatalogAccessIndex/{userId}/{kpiId}.
 */
import { listen, read, write, NOW, newKey, auditUpdate, DENIED } from './database.service.js';
import { ctx } from '../state.js';
import { can } from '../permissions.js';
import { cleanUndefined, clone } from '../utils.js';

/**
 * Theo dõi kho KPI mà người dùng được phép thấy. cb({public, private}) – realtime.
 * - KPI Public: đọc toàn bộ.
 * - KPI Private: HR (manageCatalog) đọc toàn bộ; người khác đọc từng KPI theo chỉ mục quyền.
 */
export function watchCatalog(cb, scope = 'route') {
  const state = { public: {}, private: {}, loaded: { public: false, private: false } };
  const emitNow = () => cb({ public: state.public, private: state.private, loaded: state.loaded.public && state.loaded.private });
  listen('kpiCatalogPublic', (v) => { state.public = v || {}; state.loaded.public = true; emitNow(); }, { scope, key: 'catalog-public' });
  if (can('manageCatalog')) {
    listen('kpiCatalogPrivate', (v) => { state.private = v || {}; state.loaded.private = true; emitNow(); }, { scope, key: 'catalog-private' });
  } else {
    const subs = new Map();
    listen(`kpiCatalogAccessIndex/${ctx.userId}`, (idx) => {
      const ids = new Set(Object.keys(idx || {}));
      for (const [id, off] of subs) if (!ids.has(id)) { off(); subs.delete(id); delete state.private[id]; }
      if (!ids.size) { state.loaded.private = true; emitNow(); }
      let pending = [...ids].filter((id) => !subs.has(id)).length;
      if (!pending) { state.loaded.private = true; emitNow(); }
      for (const id of ids) {
        if (subs.has(id)) continue;
        subs.set(id, listen(`kpiCatalogPrivate/${id}`, (rec) => {
          if (rec) state.private[id] = rec; else delete state.private[id];
          if (pending > 0) pending--;
          if (pending <= 0) state.loaded.private = true;
          emitNow();
        }, { scope, key: `catalog-private-${id}`, onError: () => { delete state.private[id]; if (pending > 0) pending--; if (pending <= 0) state.loaded.private = true; emitNow(); } }));
      }
    }, { scope, key: 'catalog-index', onError: () => { state.loaded.private = true; emitNow(); } });
  }
}

export function catalogList(cat) {
  return [
    ...Object.entries(cat.public || {}).map(([id, k]) => ({ id, ...k, visibility: 'public' })),
    ...Object.entries(cat.private || {}).map(([id, k]) => ({ id, ...k, visibility: 'private' })),
  ];
}

/** KPI có áp dụng cho nhân sự (theo phạm vi cấu hình) hay không. */
export function appliesTo(kpi, pu) {
  const a = kpi.appliesTo || { scope: 'company' };
  if (!pu) return true;
  switch (a.scope) {
    case 'company': return true;
    case 'units': {
      if (!a.unitIds) return true;
      let cur = pu.unitId;
      const seen = new Set();
      while (cur && !seen.has(cur)) { if (a.unitIds[cur]) return true; seen.add(cur); cur = ctx.units[cur]?.parentId; }
      return false;
    }
    case 'titleGroups': return !!a.titleGroups?.[pu.titleGroup];
    case 'managers': return ['lead', 'head', 'director', 'executive'].includes(pu.titleGroup);
    case 'users': return !!a.userIds?.[ctx.userId];
    default: return true;
  }
}

export const scopeLabel = (a) => {
  if (!a || a.scope === 'company') return 'Toàn công ty';
  if (a.scope === 'units') return `Đơn vị: ${Object.keys(a.unitIds || {}).map((u) => ctx.units[u]?.name || u).join(', ') || '—'}`;
  if (a.scope === 'titleGroups') return `Nhóm chức danh: ${Object.keys(a.titleGroups || {}).map((g) => ctx.config.appSettings?.titleGroups?.[g]?.label || g).join(', ')}`;
  if (a.scope === 'managers') return 'Cấp quản lý';
  if (a.scope === 'users') return `Cá nhân: ${Object.keys(a.userIds || {}).map((u) => ctx.profiles[u]?.name || u).join(', ')}`;
  return a.scope;
};

const KPI_FIELDS = ['code', 'name', 'groupId', 'description', 'definition', 'measurement', 'unit', 'dataSource', 'frequency', 'direction', 'scoringPolicyId',
  'targets', 'conversionNote', 'defaultWeight', 'minWeight', 'appliesTo', 'evidenceRequired', 'evidenceNote', 'levelDescriptions', 'status', 'version', 'effectiveFrom', 'ownerId', 'previousVersionId'];

/**
 * Tạo/sửa KPI trong kho. Xử lý chuyển Public ↔ Private, chỉ mục quyền và lịch sử.
 * @returns id
 */
export async function saveKpi({ id, data, previous, reason = '', action }) {
  const kpiId = id || newKey('kpiCatalogPublic');
  const visibility = data.visibility === 'private' ? 'private' : 'public';
  const rec = { visibility };
  for (const f of KPI_FIELDS) if (data[f] !== undefined) rec[f] = data[f];
  rec.ownerId = rec.ownerId || previous?.ownerId || ctx.userId;
  rec.version = rec.version || previous?.version || 1;
  rec.status = rec.status || 'active';
  rec.createdBy = previous?.createdBy || ctx.userId;
  rec.createdAt = previous?.createdAt || NOW();
  rec.updatedBy = ctx.userId;
  rec.updatedAt = NOW();
  if (visibility === 'private') rec.allowedUsers = data.allowedUsers || {};
  const updates = {};
  const target = visibility === 'public' ? 'kpiCatalogPublic' : 'kpiCatalogPrivate';
  updates[`${target}/${kpiId}`] = cleanUndefined(rec);
  if (previous && previous.visibility && previous.visibility !== visibility) {
    updates[`${previous.visibility === 'public' ? 'kpiCatalogPublic' : 'kpiCatalogPrivate'}/${kpiId}`] = null;
  }
  // chỉ mục quyền KPI Private (chủ sở hữu + người được cấp quyền)
  const before = new Set(previous?.visibility === 'private' ? [previous.ownerId, ...Object.keys(previous.allowedUsers || {})].filter(Boolean) : []);
  const after = new Set(visibility === 'private' ? [rec.ownerId, ...Object.keys(rec.allowedUsers || {})] : []);
  for (const u of after) if (!before.has(u)) updates[`kpiCatalogAccessIndex/${u}/${kpiId}`] = true;
  for (const u of before) if (!after.has(u)) updates[`kpiCatalogAccessIndex/${u}/${kpiId}`] = null;
  const hid = newKey(`catalogHistory/${kpiId}`);
  updates[`catalogHistory/${kpiId}/${hid}`] = cleanUndefined({
    action: action || (previous ? 'update' : 'create'), by: ctx.userId, byName: ctx.profile?.name || '', at: NOW(), reason: reason || null,
    before: previous ? stripMeta(previous) : null, after: stripMeta(rec),
  });
  Object.assign(updates, auditUpdate({ type: previous ? 'catalog_update' : 'catalog_create', entity: 'kpiCatalog', entityId: kpiId, before: previous ? { name: previous.name, status: previous.status, visibility: previous.visibility } : null, after: { name: rec.name, status: rec.status, visibility }, reason }));
  await write(updates);
  return kpiId;
}

function stripMeta(r) {
  const c = clone(r) || {};
  delete c.createdAt; delete c.updatedAt;
  return c;
}

/** Sao chép KPI thành phiên bản mới (giữ nguyên bản cũ cho lịch sử đánh giá). */
export async function newVersion(id, rec, { deactivateOld = true, reason = '' } = {}) {
  const data = { ...clone(rec), version: (rec.version || 1) + 1, previousVersionId: id, status: 'active', effectiveFrom: new Date().toISOString().slice(0, 10) };
  delete data.createdAt; delete data.createdBy;
  const newId = await saveKpi({ data, reason: reason || `Phiên bản mới của ${rec.code}`, action: 'new_version' });
  if (deactivateOld) await setKpiStatus(id, rec, 'inactive', `Thay thế bởi phiên bản ${data.version}`);
  return newId;
}

export async function copyKpi(rec) {
  const data = { ...clone(rec), code: `${rec.code}-COPY`, name: `${rec.name} (bản sao)`, version: 1, status: 'active', ownerId: ctx.userId };
  delete data.createdAt; delete data.createdBy; delete data.previousVersionId;
  if (data.visibility === 'public' && !can('manageCatalog')) data.visibility = 'private';
  return saveKpi({ data, reason: `Sao chép từ ${rec.code}`, action: 'copy' });
}

export async function setKpiStatus(id, rec, status, reason) {
  const path = `${rec.visibility === 'private' ? 'kpiCatalogPrivate' : 'kpiCatalogPublic'}/${id}`;
  const hid = newKey(`catalogHistory/${id}`);
  await write({
    [`${path}/status`]: status,
    [`${path}/updatedAt`]: NOW(),
    [`${path}/updatedBy`]: ctx.userId,
    [`catalogHistory/${id}/${hid}`]: { action: `status_${status}`, by: ctx.userId, byName: ctx.profile?.name || '', at: NOW(), reason: reason || null, before: { status: rec.status }, after: { status } },
    ...auditUpdate({ type: 'catalog_status', entity: 'kpiCatalog', entityId: id, before: { status: rec.status }, after: { status }, reason }),
  });
}

/** Xóa vĩnh viễn – chỉ khi KPI chưa từng được dùng trong kế hoạch (đã kiểm tra trước). */
export async function deleteKpi(id, rec, usage) {
  if (usage?.length) throw new Error('KPI đã được dùng trong kế hoạch/đánh giá – chỉ có thể ngừng sử dụng hoặc lưu trữ.');
  const updates = { [`${rec.visibility === 'private' ? 'kpiCatalogPrivate' : 'kpiCatalogPublic'}/${id}`]: null };
  if (rec.visibility === 'private') for (const u of [rec.ownerId, ...Object.keys(rec.allowedUsers || {})]) if (u) updates[`kpiCatalogAccessIndex/${u}/${id}`] = null;
  Object.assign(updates, auditUpdate({ type: 'catalog_delete', entity: 'kpiCatalog', entityId: id, before: { code: rec.code, name: rec.name } }));
  await write(updates);
}

/** Tìm các kế hoạch đang dùng KPI (chỉ người được xem toàn bộ kế hoạch mới có kết quả đầy đủ). */
export async function findUsage(kpiId) {
  const out = [];
  let partial = false;
  for (const [pid, period] of Object.entries(ctx.periods || {})) {
    const plans = await read(`kpiPlans/${pid}`, { allowDenied: true });
    if (plans === DENIED) { partial = true; continue; }
    for (const [uid, plan] of Object.entries(plans || {})) {
      for (const [itemId, it] of Object.entries(plan.items || {})) {
        if (it.spec?.catalogRef?.id === kpiId) out.push({ periodId: pid, periodName: period.name, userId: uid, itemId, title: it.spec.title, weight: it.weight, planStatus: plan.status, state: it.spec.state });
      }
    }
  }
  return { usage: out, partial };
}

export async function readHistory(kpiId) {
  const h = await read(`catalogHistory/${kpiId}`, { allowDenied: true });
  if (h === DENIED) return null;
  return Object.entries(h || {}).map(([id, x]) => ({ id, ...x })).sort((a, b) => (b.at || 0) - (a.at || 0));
}

export async function saveGroup(id, data, previous = null) {
  const gid = id || newKey('config/kpiGroups');
  await write({
    [`config/kpiGroups/${gid}`]: cleanUndefined({ name: data.name.trim(), description: data.description || '', order: Number(data.order) || 99, status: data.status || 'active', color: data.color || null, updatedAt: NOW(), updatedBy: ctx.userId }),
    ...auditUpdate({ type: previous ? 'kpi_group_update' : 'kpi_group_create', entity: 'kpiGroup', entityId: gid, before: previous ? { name: previous.name, status: previous.status, order: previous.order } : null, after: { name: data.name, status: data.status, order: data.order } }),
  });
  return gid;
}
