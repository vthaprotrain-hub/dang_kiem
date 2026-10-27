/**
 * Cơ cấu tổ chức: cây đơn vị (không giới hạn số cấp), kiểm tra mã/chu trình, phiên bản cơ cấu.
 */
import { write, NOW, newKey, auditUpdate } from './database.service.js';
import { ctx } from '../state.js';
import { cleanUndefined, sortBy } from '../utils.js';

export function buildUnitTree(units = ctx.units, { includeArchived = true } = {}) {
  const nodes = {};
  for (const [id, u] of Object.entries(units || {})) {
    if (!includeArchived && u.status === 'archived') continue;
    nodes[id] = { id, ...u, children: [] };
  }
  const roots = [];
  for (const n of Object.values(nodes)) {
    if (n.parentId && nodes[n.parentId]) nodes[n.parentId].children.push(n);
    else roots.push(n);
  }
  const sortRec = (arr) => { arr.sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || a.name.localeCompare(b.name, 'vi')); arr.forEach((c) => sortRec(c.children)); return arr; };
  return sortRec(roots);
}

export function unitAncestors(id, units = ctx.units) {
  const out = [];
  const seen = new Set();
  let cur = units[id]?.parentId;
  while (cur && units[cur] && !seen.has(cur)) { out.push(cur); seen.add(cur); cur = units[cur].parentId; }
  return out;
}
export function unitDescendants(id, units = ctx.units) {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [uid, u] of Object.entries(units)) if (u.parentId && out.has(u.parentId) && !out.has(uid)) { out.add(uid); grew = true; }
  }
  return out;
}
export const unitLevel = (id, units = ctx.units) => unitAncestors(id, units).length + 1;
export const unitPath = (id, units = ctx.units) => [...unitAncestors(id, units).reverse(), id].map((x) => units[x]?.name || x).join(' › ');
/** Trung tâm/đơn vị cấp 2 (ngay dưới đơn vị gốc) chứa đơn vị id. */
export function topUnitOf(id, units = ctx.units) {
  const chain = [id, ...unitAncestors(id, units)];
  return chain.length >= 2 ? chain[chain.length - 2] : chain[0];
}
export function flatUnits(units = ctx.units) {
  const out = [];
  const walk = (arr, depth) => arr.forEach((n) => { out.push({ ...n, depth }); walk(n.children, depth + 1); });
  walk(buildUnitTree(units), 0);
  return out;
}

export function validateUnit(id, data, units = ctx.units) {
  const errors = [];
  if (!data.code?.trim()) errors.push('Mã đơn vị là bắt buộc.');
  if (!data.name?.trim()) errors.push('Tên đơn vị là bắt buộc.');
  const dup = Object.entries(units).find(([uid, u]) => uid !== id && String(u.code).trim().toLowerCase() === String(data.code || '').trim().toLowerCase());
  if (dup) errors.push(`Mã đơn vị "${data.code}" đã được dùng cho "${dup[1].name}".`);
  if (data.parentId) {
    if (!units[data.parentId]) errors.push('Đơn vị cha không tồn tại.');
    if (id && unitDescendants(id, units).has(data.parentId)) errors.push('Không thể chuyển đơn vị vào chính nó hoặc đơn vị con của nó.');
  }
  if (data.effectiveFrom && data.effectiveTo && data.effectiveTo < data.effectiveFrom) errors.push('Ngày hết hiệu lực phải sau ngày hiệu lực.');
  return errors;
}

export async function saveUnit(id, data, previous = null, reason = '') {
  const unitId = id || newKey('organizationUnits');
  const rec = cleanUndefined({
    code: data.code.trim(), name: data.name.trim(), type: data.type || 'department', parentId: data.parentId || null, headId: data.headId || null,
    status: data.status || 'active', effectiveFrom: data.effectiveFrom || null, effectiveTo: data.effectiveTo || null,
    order: Number.isFinite(Number(data.order)) && data.order !== '' ? Number(data.order) : previous?.order ?? 999, note: data.note || null,
    updatedAt: NOW(), updatedBy: ctx.userId,
  });
  Object.keys(rec).forEach((k) => rec[k] === null && delete rec[k]);
  const moved = previous && previous.parentId !== rec.parentId;
  await write({
    [`organizationUnits/${unitId}`]: rec,
    ...auditUpdate({
      type: previous ? (moved ? 'org_move' : 'org_update') : 'org_create', entity: 'organizationUnit', entityId: unitId,
      before: previous ? { code: previous.code, name: previous.name, parentId: previous.parentId || null, status: previous.status, headId: previous.headId || null } : null,
      after: { code: rec.code, name: rec.name, parentId: rec.parentId || null, status: rec.status, headId: rec.headId || null }, reason,
    }),
  });
  return unitId;
}

export async function setUnitStatus(id, unit, status, reason) {
  await write({
    [`organizationUnits/${id}/status`]: status,
    [`organizationUnits/${id}/updatedAt`]: NOW(),
    [`organizationUnits/${id}/updatedBy`]: ctx.userId,
    ...(status !== 'active' ? { [`organizationUnits/${id}/effectiveTo`]: new Date().toISOString().slice(0, 10) } : {}),
    ...auditUpdate({ type: 'org_status', entity: 'organizationUnit', entityId: id, before: { status: unit.status }, after: { status }, reason }),
  });
}

/** Báo cáo quan hệ quản lý hiện hành (để chụp phiên bản cơ cấu). */
export function currentReporting(profiles = ctx.profiles) {
  const out = {};
  for (const [id, p] of Object.entries(profiles || {})) {
    if (p.status !== 'active') continue;
    out[id] = cleanUndefined({ unitId: p.unitId, title: p.title, managerId: p.managerId || undefined, skipManagerId: p.skipManagerId || undefined });
  }
  return out;
}

export async function snapshotOrgVersion(name, periodId = null) {
  const id = newKey('organizationVersions');
  await write({
    [`organizationVersions/${id}`]: { name, periodId, createdAt: NOW(), createdBy: ctx.userId, units: ctx.units, reporting: currentReporting() },
    ...auditUpdate({ type: 'org_snapshot', entity: 'organizationVersion', entityId: id, periodId, after: { name, units: Object.keys(ctx.units).length } }),
  });
  return id;
}

export function headName(unit) {
  return unit?.headId ? ctx.profiles[unit.headId]?.name || unit.headId : '';
}
export const unitOptions = (units = ctx.units, { activeOnly = false } = {}) =>
  flatUnits(units).filter((u) => !activeOnly || u.status === 'active').map((u) => ({ id: u.id, label: `${'— '.repeat(u.depth)}${u.name}`, depth: u.depth, status: u.status }));
export const profilesSorted = () => sortBy(Object.entries(ctx.profiles || {}).map(([id, p]) => ({ id, ...p })), 'name');
