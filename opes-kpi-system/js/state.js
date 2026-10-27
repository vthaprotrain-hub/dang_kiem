/**
 * Ngữ cảnh phiên làm việc (người dùng, quyền, cấu hình, kỳ đánh giá đang chọn...).
 * Dữ liệu ở đây được nạp từ Firebase và đồng bộ thời gian thực bởi app.js.
 */
export const ctx = {
  authUser: null,
  userId: null,
  profile: null,
  access: { roles: {}, perms: {} },
  config: {},
  periods: {},
  periodId: null,
  period: null,
  periodUsers: {},
  periodUser: null,
  delegations: {},
  units: {},
  profiles: {},
  kbiCatalog: {},
  notifications: {},
  myPlan: null,
  ready: false,
};

const bus = new EventTarget();
export function onCtx(name, fn) {
  const h = (e) => fn(e.detail);
  bus.addEventListener(name, h);
  return () => bus.removeEventListener(name, h);
}
export const emit = (name, detail) => bus.dispatchEvent(new CustomEvent(name, { detail }));

export function resetCtx() {
  Object.assign(ctx, {
    authUser: null, userId: null, profile: null, access: { roles: {}, perms: {} }, config: {}, periods: {}, periodId: null, period: null,
    periodUsers: {}, periodUser: null, delegations: {}, units: {}, profiles: {}, kbiCatalog: {}, notifications: {}, myPlan: null, ready: false,
  });
}

export const me = () => ctx.userId;
export const nameOf = (id) => (id ? ctx.profiles[id]?.name || ctx.periodUsers[id]?.name || id : '—');
export const titleOf = (id) => ctx.profiles[id]?.title || ctx.periodUsers[id]?.title || '';
export const unitName = (id) => ctx.units[id]?.name || (id ? id : '—');
export const appSettings = () => ctx.config.appSettings || {};
export const periodPolicies = (period = ctx.period) => period?.policies || {};
export const periodYear = (period = ctx.period) => period?.year || new Date().getFullYear();
export const fillYear = (s, period = ctx.period) => String(s || '').replaceAll('{year}', periodYear(period));

/** Các giá trị cốt lõi KBI áp dụng cho kỳ (theo danh sách kỳ, trạng thái và phạm vi áp dụng). */
export function kbiValuesFor(period = ctx.period, periodUser = null) {
  const ids = period?.kbiValueIds ? Object.keys(period.kbiValueIds) : Object.keys(ctx.kbiCatalog);
  return ids
    .map((id) => ({ id, ...(ctx.kbiCatalog[id] || {}) }))
    .filter((v) => v.name && v.status !== 'archived')
    .filter((v) => {
      const a = v.appliesTo;
      if (!a || a.scope === 'company' || !periodUser) return true;
      if (a.scope === 'titleGroups') return !!a.titleGroups?.[periodUser.titleGroup];
      if (a.scope === 'units') return !!a.unitIds?.[periodUser.unitId];
      return true;
    })
    .sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
    .map((v) => ({ ...v, weight: v.weight ?? 1 }));
}

/** Danh sách cảnh báo cấu hình thiếu – chỉ hiển thị cho quản trị viên. */
export function configWarnings() {
  const c = ctx.config || {};
  const w = [];
  if (!c.appSettings) w.push('Thiếu config/appSettings – đang dùng nhãn mặc định của hệ thống.');
  if (!c.appSettings?.statusLabels) w.push('Chưa cấu hình nhãn trạng thái (appSettings.statusLabels) – đang dùng nhãn mặc định.');
  if (!c.kpiGroups || !Object.keys(c.kpiGroups).length) w.push('Chưa có nhóm KPI (config/kpiGroups).');
  if (!c.scoringPolicies || !Object.keys(c.scoringPolicies).length) w.push('Chưa có chính sách tính điểm KPI (config/scoringPolicies) – chỉ tiêu sẽ ở trạng thái "Cấu hình chưa hợp lệ".');
  if (!c.gradingBands?.default) w.push('Chưa cấu hình bảng xếp loại (config/gradingBands/default) – không thể xếp loại.');
  if (!c.kbiPolicies?.default) w.push('Chưa cấu hình chính sách KBI (config/kbiPolicies/default).');
  if (!c.weightPolicies?.default) w.push('Chưa cấu hình chính sách trọng số (config/weightPolicies/default).');
  if (!c.workflowTemplates?.default) w.push('Chưa cấu hình quy trình phê duyệt (config/workflowTemplates/default).');
  if (!c.permissionPolicies?.roles) w.push('Chưa cấu hình ma trận phân quyền (config/permissionPolicies).');
  if (ctx.period && !ctx.period.policies) w.push(`Kỳ "${ctx.period.name}" chưa chụp chính sách áp dụng (policies) – điểm số không thể tính.`);
  return w;
}
