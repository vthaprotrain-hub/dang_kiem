/**
 * Phân quyền phía giao diện – PHẢN CHIẾU logic của database.rules.json để ẩn/vô hiệu nút.
 * Đây KHÔNG phải lớp bảo mật: mọi thao tác vẫn được Database Rules kiểm tra lại trên máy chủ.
 */
import { ctx } from './state.js';

export const can = (action) => ctx.access?.perms?.[action] === true;
export const hasRole = (role) => ctx.access?.roles?.[role] === true;
export const isSysAdmin = () => hasRole('sysAdmin');
export const anyCan = (...actions) => actions.some(can);

export function delegatedFrom(managerId) {
  if (!managerId) return false;
  return ctx.delegations?.[managerId]?.[ctx.userId]?.active === true;
}

/** Quan hệ của người đang đăng nhập với một nhân sự trong kỳ đang chọn. */
export function relationTo(userId, periodUsers = ctx.periodUsers) {
  const pu = periodUsers?.[userId];
  const me = ctx.userId;
  const directManager = pu ? (pu.managerId ? pu.managerId === me || delegatedFrom(pu.managerId) : can('approveTopLevel')) : false;
  const skipManager = pu?.skipManagerId ? pu.skipManagerId === me || delegatedFrom(pu.skipManagerId) : false;
  return {
    pu,
    self: userId === me,
    directManager,
    skipManager,
    inChain: !!pu?.chain?.[me],
    depth: pu?.chain?.[me] || null,
    delegated: !!pu && (delegatedFrom(pu.managerId) || delegatedFrom(pu.skipManagerId)),
  };
}

/** Nhân sự thuộc phạm vi quản lý (mọi cấp) của người đăng nhập trong kỳ. */
export function myTeam({ directOnly = false, includeDelegated = true } = {}) {
  const me = ctx.userId;
  return Object.entries(ctx.periodUsers || {})
    .filter(([id, pu]) => {
      if (id === me) return false;
      if (directOnly) return pu.managerId === me || (includeDelegated && delegatedFrom(pu.managerId));
      return !!pu.chain?.[me] || (includeDelegated && (delegatedFrom(pu.managerId) || delegatedFrom(pu.skipManagerId)));
    })
    .map(([id, pu]) => ({ id, ...pu }));
}
export const hasTeam = () => myTeam().length > 0;
export const canAssignTo = (userId) => can('assignKpi') && !!ctx.periodUsers?.[userId]?.chain?.[ctx.userId];

/** Danh sách userId người đăng nhập được xem trong báo cáo/dashboard. */
export function scopeUserIds({ plans = true, evaluations = true } = {}) {
  const all = (!plans || can('viewAllPlans')) && (!evaluations || can('viewAllEvaluations'));
  if (all) return Object.keys(ctx.periodUsers || {});
  const ids = new Set(myTeam().map((u) => u.id));
  if (ctx.periodUsers?.[ctx.userId]) ids.add(ctx.userId);
  return [...ids];
}
export const seesAll = () => can('viewAllPlans') && can('viewAllEvaluations');

const EDITABLE_PLAN = (s) => !s || s === 'draft' || s === 'returned';

/** Khả năng thao tác trên kế hoạch KPI (mirror Rules). */
export function planCaps(plan, userId, period = ctx.period) {
  const rel = relationTo(userId);
  const status = plan?.status || null;
  const open = period?.status === 'open';
  const editable = open && EDITABLE_PLAN(status) && !!rel.pu;
  const wf = period?.policies?.workflow?.kpiPlan || {};
  const reqSkip = wf.requireSkipApproval !== false && !!rel.pu?.skipManagerId;
  return {
    rel, status, open, editable, reqSkip,
    canView: rel.self || rel.inChain || rel.directManager || rel.skipManager || can('viewAllPlans'),
    canEditOwn: editable && rel.self && can('editOwnPlan'),
    canAssign: editable && rel.inChain && can('assignKpi'),
    canAck: editable && rel.self,
    canSubmit: open && rel.self && EDITABLE_PLAN(status),
    canManagerAct: open && rel.directManager && status === 'submitted',
    canSkipAct: open && rel.skipManager && status === 'manager_approved',
    canReopen: open && status === 'approved' && (rel.directManager || can('unlockRecords')) && wf.allowRevisionAfterApproval === true,
  };
}

const EDITABLE_EVAL = (s) => !s || s === 'draft' || s === 'returned';

/** Khả năng thao tác trên hồ sơ đánh giá (mirror Rules). */
export function evalCaps(evaluation, plan, userId, period = ctx.period) {
  const rel = relationTo(userId);
  const status = evaluation?.status || null;
  const pstat = period?.status;
  const open = pstat === 'open';
  const evalOpen = pstat === 'open' || pstat === 'consolidating';
  const planApproved = plan?.status === 'approved';
  const wf = period?.policies?.workflow?.evaluation || {};
  const reqSkip = wf.requireSkipApproval !== false && !!rel.pu?.skipManagerId;
  return {
    rel, status, open, evalOpen, planApproved, reqSkip, autoLock: wf.autoLockOnApproval === true,
    canView: rel.self || rel.inChain || rel.directManager || rel.skipManager || can('viewAllEvaluations'),
    canSelfEdit: open && planApproved && rel.self && EDITABLE_EVAL(status) && !!rel.pu,
    canManagerEdit: evalOpen && rel.directManager && can('evaluateStaff') && status === 'submitted',
    canSkipAct: evalOpen && rel.skipManager && can('approve') && status === 'manager_reviewed',
    canLock: evalOpen && can('lockRecords') && status === 'approved',
    canUnlock: evalOpen && can('unlockRecords') && (status === 'locked' || status === 'approved'),
    allowSkipReturnToManager: wf.allowSkipReturnToManager !== false,
  };
}
