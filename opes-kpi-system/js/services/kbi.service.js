/**
 * Danh mục KBI (giá trị cốt lõi & khung hành vi 1–5). Nội dung định nghĩa nằm trong dữ liệu,
 * không đóng cứng trong mã nguồn.
 */
import { write, NOW, newKey, auditUpdate, read, DENIED } from './database.service.js';
import { ctx } from '../state.js';
import { cleanUndefined, clone } from '../utils.js';

export const LEVELS = [1, 2, 3, 4, 5];

export function emptyValue() {
  return {
    code: '', name: '', order: Object.keys(ctx.kbiCatalog).length + 1, definition: '', behaviors: '', scoringGuide: '', evidenceExamples: '',
    meetsExpectation: '', needsImprovement: '', weight: 1, appliesTo: { scope: 'company' }, status: 'active', version: 1,
    effectiveFrom: new Date().toISOString().slice(0, 10), levels: Object.fromEntries(LEVELS.map((l) => [l, { title: `Mức ${l}`, description: '' }])),
  };
}

export async function saveKbiValue(id, data, previous = null, reason = '') {
  const vid = id || newKey('kbiCatalog');
  const rec = cleanUndefined({
    ...data,
    version: previous ? (data.bumpVersion ? (previous.version || 1) + 1 : previous.version || 1) : 1,
    updatedAt: NOW(), updatedBy: ctx.userId,
    createdAt: previous?.createdAt || NOW(), createdBy: previous?.createdBy || ctx.userId,
  });
  delete rec.bumpVersion;
  const hid = newKey(`catalogHistory/${vid}`);
  const strip = (x) => { const c = clone(x) || {}; delete c.updatedAt; delete c.createdAt; return c; };
  await write({
    [`kbiCatalog/${vid}`]: rec,
    [`catalogHistory/${vid}/${hid}`]: cleanUndefined({ action: previous ? 'update' : 'create', by: ctx.userId, byName: ctx.profile?.name || '', at: NOW(), reason: reason || null, before: previous ? strip(previous) : null, after: strip(rec) }),
    ...auditUpdate({ type: previous ? 'kbi_update' : 'kbi_create', entity: 'kbiCatalog', entityId: vid, before: previous ? { name: previous.name, version: previous.version, status: previous.status } : null, after: { name: rec.name, version: rec.version, status: rec.status }, reason }),
  });
  return vid;
}

export async function setKbiStatus(id, rec, status, reason) {
  const hid = newKey(`catalogHistory/${id}`);
  await write({
    [`kbiCatalog/${id}/status`]: status,
    [`kbiCatalog/${id}/updatedAt`]: NOW(),
    [`kbiCatalog/${id}/updatedBy`]: ctx.userId,
    [`catalogHistory/${id}/${hid}`]: { action: `status_${status}`, by: ctx.userId, byName: ctx.profile?.name || '', at: NOW(), reason: reason || null, before: { status: rec.status }, after: { status } },
    ...auditUpdate({ type: 'kbi_status', entity: 'kbiCatalog', entityId: id, before: { status: rec.status }, after: { status }, reason }),
  });
}

export async function kbiHistory(id) {
  const h = await read(`catalogHistory/${id}`, { allowDenied: true });
  if (h === DENIED) return null;
  return Object.entries(h || {}).map(([hid, x]) => ({ id: hid, ...x })).sort((a, b) => (b.at || 0) - (a.at || 0));
}

export function levelText(value, level) {
  const l = value?.levels?.[level];
  return l?.description || '';
}
