/**
 * Kịch bản kiểm thử Database Rules (dữ liệu nền: js/seed/demo-data.json, mọi người dùng demo đã liên kết
 * tài khoản: authUid = "auth_" + userId). Mỗi kịch bản chạy trên bản sao dữ liệu mới; các bước trong
 * một kịch bản chạy tuần tự (bước sau thấy kết quả bước trước).
 *
 * Chạy với Firebase Emulator:  npm run test:rules   (xem tests/rules/run-emulator.mjs)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const demo = JSON.parse(readFileSync(join(root, 'js/seed/demo-data.json'), 'utf8'));
export const NOW = { '.sv': 'timestamp' };
export const authUid = (userId) => `auth_${userId}`;
export const emailOf = (userId) => demo.userProfiles[userId].email;
export const BOOTSTRAP_EMAIL = demo.userProfiles.u_admin.email;

/** Dữ liệu nền: demo + liên kết tài khoản cho tất cả người dùng. */
export function baseData({ linked = true } = {}) {
  const d = structuredClone(demo);
  if (linked) {
    d.authLinks = {};
    for (const [id, p] of Object.entries(d.userProfiles)) {
      d.authLinks[authUid(id)] = { userId: id, email: p.email, linkedAt: 1 };
      p.authUid = authUid(id);
    }
  }
  return d;
}

const sig = (userId, version) => ({ userId, name: demo.userProfiles[userId].name, title: demo.userProfiles[userId].title, at: NOW, version });
const stamp = (by, extra = {}) => ({ by, at: NOW, ...extra });
const P = 'P2026';
const plan = (u) => `kpiPlans/${P}/${u}`;
const ev = (u) => `evaluations/${P}/${u}`;
const newAssignedItem = (u, itemId, by, extra = {}) => ({
  [`${plan(u)}/items/${itemId}/spec`]: { title: 'KPI giao thử', groupId: 'grp_vh', source: 'assigned', state: 'active', assignedBy: by, assignmentId: 'as_test', weightMode: 'fixed', scoring: { policyId: 'sp_scale_1_5' }, ...extra },
  [`${plan(u)}/items/${itemId}/weight`]: 30,
  [`${plan(u)}/items/${itemId}/ack`]: { status: 'pending', by, at: NOW },
});

export const scenarios = [
  // ---------------- Kịch bản 1: đăng nhập, liên kết tài khoản, phân quyền đọc
  {
    name: 'Chưa đăng nhập chỉ đọc được danh sách đăng nhập demo',
    steps: [
      { as: null, op: 'read', path: 'public/demoLoginOptions', expect: 'allow' },
      { as: null, op: 'read', path: 'userProfiles', expect: 'deny' },
      { as: null, op: 'read', path: 'config', expect: 'deny' },
    ],
  },
  {
    name: 'Liên kết tài khoản theo email đã xác thực',
    data: { linked: false },
    steps: [
      { as: { uid: 'fresh1', email: emailOf('u_nv_qlda1') }, op: 'read', path: `emailIndex/${emailOf('u_nv_qlda1').replaceAll('.', ',')}`, expect: 'allow' },
      { as: { uid: 'fresh1', email: emailOf('u_nv_qlda1') }, op: 'read', path: `emailIndex/${emailOf('u_nv_qlda2').replaceAll('.', ',')}`, expect: 'deny' },
      { as: { uid: 'fresh1', email: emailOf('u_nv_qlda1') }, op: 'read', path: 'userProfiles', expect: 'deny', note: 'chưa liên kết' },
      { as: { uid: 'fresh1', email: emailOf('u_nv_qlda1') }, op: 'update', expect: 'deny', note: 'không thể nhận hồ sơ người khác',
        updates: { 'authLinks/fresh1': { userId: 'u_nv_qlda2', email: emailOf('u_nv_qlda1'), linkedAt: NOW } } },
      { as: { uid: 'fresh1', email: emailOf('u_nv_qlda1') }, op: 'update', expect: 'allow',
        updates: { 'authLinks/fresh1': { userId: 'u_nv_qlda1', email: emailOf('u_nv_qlda1'), linkedAt: NOW }, 'userProfiles/u_nv_qlda1/authUid': 'fresh1', 'public/demoLoginOptions/u_nv_qlda1/authUid': 'fresh1' } },
      { as: { uid: 'fresh1', email: emailOf('u_nv_qlda1') }, op: 'read', path: 'userProfiles', expect: 'allow' },
      { as: { uid: 'fresh2', email: emailOf('u_nv_qlda1') }, op: 'update', expect: 'deny', note: 'hồ sơ đã liên kết với UID khác',
        updates: { 'authLinks/fresh2': { userId: 'u_nv_qlda1', email: emailOf('u_nv_qlda1'), linkedAt: NOW } } },
    ],
  },
  {
    name: 'Không đọc được hồ sơ của người khác bằng cách đổi đường dẫn',
    steps: [
      { as: 'u_nv_qlda1', op: 'read', path: plan('u_nv_qlda1'), expect: 'allow' },
      { as: 'u_nv_qlda1', op: 'read', path: plan('u_nv_qlda2'), expect: 'deny' },
      { as: 'u_nv_qlda1', op: 'read', path: ev('u_nv_ptht'), expect: 'deny' },
      { as: 'u_nv_qlda1', op: 'read', path: `kpiPlans/${P}`, expect: 'deny' },
      { as: 'u_tn_qlda', op: 'read', path: ev('u_nv_qlda1'), expect: 'allow', note: 'quản lý trực tiếp' },
      { as: 'u_ptgd', op: 'read', path: ev('u_nv_qlda1'), expect: 'allow', note: 'thuộc chuỗi quản lý' },
      { as: 'u_gd_tc', op: 'read', path: ev('u_nv_qlda1'), expect: 'deny', note: 'khác trung tâm' },
      { as: 'u_auditor', op: 'read', path: `evaluations/${P}`, expect: 'allow' },
      { as: 'u_hr', op: 'read', path: `kpiPlans/${P}`, expect: 'allow' },
      { as: 'u_nv_qlda1', op: 'read', path: 'userAccess/u_nv_qlda1', expect: 'allow' },
      { as: 'u_nv_qlda1', op: 'read', path: 'userAccess/u_hr', expect: 'deny' },
      { as: 'u_nv_qlda1', op: 'read', path: 'auditLogs', expect: 'deny' },
      { as: 'u_auditor', op: 'read', path: 'auditLogs', expect: 'allow' },
    ],
  },
  // ---------------- Kịch bản 2: cấu hình hệ thống
  {
    name: 'Chỉ người có quyền mới sửa cấu hình, danh mục, ma trận quyền',
    steps: [
      { as: 'u_nv_qlda1', op: 'update', expect: 'deny', updates: { 'config/scoringPolicies/sp_x': { name: 'x', method: 'ratio' } } },
      { as: 'u_hr', op: 'update', expect: 'allow', updates: { 'config/scoringPolicies/sp_x': { name: 'x', method: 'ratio' } } },
      { as: 'u_hr', op: 'update', expect: 'deny', updates: { 'config/permissionPolicies/roles/employee/manageConfig': true } },
      { as: 'u_admin', op: 'update', expect: 'allow', updates: { 'config/permissionPolicies/roles/employee/viewCatalog': true } },
      { as: 'u_nv_qlda1', op: 'update', expect: 'deny', updates: { 'userAccess/u_nv_qlda1/perms/manageConfig': true } },
      { as: 'u_hr', op: 'update', expect: 'deny', updates: { 'userAccess/u_hr/roles/sysAdmin': true } },
      { as: 'u_admin', op: 'update', expect: 'allow', updates: { 'userAccess/u_nv_qlda1/roles/auditor': true } },
      { as: 'u_nv_qlda1', op: 'update', expect: 'deny', updates: { 'config/kpiGroups/grp_new': { name: 'Mới', order: 99, status: 'active' } } },
      { as: 'u_hr', op: 'update', expect: 'allow', updates: { 'config/kpiGroups/grp_new': { name: 'Mới', order: 99, status: 'active' } } },
      { as: 'u_hr', op: 'update', expect: 'allow', updates: { 'kpiCatalogPublic/kpi_new': { code: 'X-1', name: 'KPI mới', groupId: 'grp_new', status: 'active', visibility: 'public' } } },
      { as: 'u_tb_qlda', op: 'update', expect: 'deny', updates: { 'kpiCatalogPublic/kpi_new2': { code: 'X-2', name: 'KPI', groupId: 'grp_tc', status: 'active', visibility: 'public' } } },
      { as: 'u_nv_qlda1', op: 'update', expect: 'deny', updates: { 'organizationUnits/unit_x': { code: 'X', name: 'X', type: 'team', status: 'active', parentId: 'unit_cntt' } } },
      { as: 'u_hr', op: 'update', expect: 'allow', updates: { 'organizationUnits/unit_x': { code: 'X', name: 'X', type: 'team', status: 'active', parentId: 'unit_cntt' } } },
      { as: 'u_hr', op: 'update', expect: 'deny', note: 'đơn vị cha không tồn tại', updates: { 'organizationUnits/unit_y': { code: 'Y', name: 'Y', type: 'team', status: 'active', parentId: 'unit_none' } } },
      { as: 'u_nv_qlda1', op: 'update', expect: 'deny', updates: { 'kbiCatalog/kbi_hieuqua/definition': 'sửa trái phép' } },
      { as: 'u_hr', op: 'update', expect: 'allow', updates: { 'kbiCatalog/kbi_hieuqua/definition': 'Định nghĩa mới' } },
    ],
  },
  {
    name: 'KPI Private: chỉ chủ sở hữu, người được cấp quyền và HR thấy',
    steps: [
      { as: 'u_tb_qlda', op: 'read', path: 'kpiCatalogPrivate/kpi_pv_cntt_core', expect: 'allow' },
      { as: 'u_gd_cntt', op: 'read', path: 'kpiCatalogPrivate/kpi_pv_cntt_core', expect: 'allow' },
      { as: 'u_nv_qlda1', op: 'read', path: 'kpiCatalogPrivate/kpi_pv_cntt_core', expect: 'deny' },
      { as: 'u_nv_qlda1', op: 'read', path: 'kpiCatalogPrivate', expect: 'deny' },
      { as: 'u_hr', op: 'read', path: 'kpiCatalogPrivate', expect: 'allow' },
      { as: 'u_tb_qlda', op: 'update', expect: 'deny', note: 'không phải chủ sở hữu', updates: { 'kpiCatalogAccessIndex/u_nv_qlda1/kpi_pv_cntt_core': true } },
      { as: 'u_gd_cntt', op: 'update', expect: 'allow', updates: { 'kpiCatalogAccessIndex/u_nv_qlda1/kpi_pv_cntt_core': true, 'kpiCatalogPrivate/kpi_pv_cntt_core/allowedUsers/u_nv_qlda1': true } },
      { as: 'u_nv_qlda1', op: 'read', path: 'kpiCatalogPrivate/kpi_pv_cntt_core', expect: 'allow' },
      { as: 'u_gd_cntt', op: 'update', expect: 'allow', note: 'giám đốc tạo KPI Private của mình',
        updates: { 'kpiCatalogPrivate/kpi_pv_new': { code: 'P-9', name: 'KPI riêng', groupId: 'grp_cntt', status: 'active', visibility: 'private', ownerId: 'u_gd_cntt' } } },
      { as: 'u_gd_cntt', op: 'update', expect: 'deny', note: 'không tạo KPI Private đứng tên người khác',
        updates: { 'kpiCatalogPrivate/kpi_pv_new2': { code: 'P-10', name: 'KPI', groupId: 'grp_cntt', status: 'active', visibility: 'private', ownerId: 'u_gd_tc' } } },
      { as: 'u_gd_cntt', op: 'update', expect: 'deny', note: 'không sửa KPI Private của người khác', updates: { 'kpiCatalogPrivate/kpi_pv_tc_audit/name': 'x' } },
    ],
  },
  // ---------------- Kịch bản 3: giao KPI TOP-DOWN
  {
    name: 'Giao KPI cho cấp dưới hợp lệ; người ngoài phạm vi bị chặn',
    steps: [
      { as: 'u_gd_cntt', op: 'update', expect: 'allow', note: 'GĐ giao cho Trưởng ban Hạ tầng (chưa có kế hoạch)',
        updates: {
          [`${plan('u_tb_hatang')}/status`]: 'draft',
          [`${plan('u_tb_hatang')}/meta`]: { createdAt: NOW, createdBy: 'u_gd_cntt' },
          ...newAssignedItem('u_tb_hatang', 'it_new', 'u_gd_cntt'),
          [`kpiAssignments/${P}/u_gd_cntt/as_test`]: { fromId: 'u_gd_cntt', toId: 'u_tb_hatang', status: 'assigned', itemId: 'it_new', spec: { title: 'KPI giao thử' }, weight: 30 },
          [`notifications/u_tb_hatang/n_test`]: { type: 'kpi_assigned', title: 'KPI mới', fromId: 'u_gd_cntt', at: NOW, read: false },
        } },
      { as: 'u_gd_tc', op: 'update', expect: 'deny', note: 'GĐ Tài chính không quản lý Trưởng ban Hạ tầng', updates: newAssignedItem('u_tb_hatang', 'it_x', 'u_gd_tc') },
      { as: 'u_gd_tc', op: 'update', expect: 'deny', updates: { [`kpiAssignments/${P}/u_gd_tc/as_x`]: { fromId: 'u_gd_tc', toId: 'u_tb_hatang', status: 'assigned', spec: { title: 'x' } } } },
      { as: 'u_gd_cntt', op: 'update', expect: 'deny', note: 'không giả danh người giao', updates: newAssignedItem('u_tb_hatang', 'it_y', 'u_ptgd') },
      { as: 'u_nv_qlda1', op: 'update', expect: 'deny', note: 'nhân viên không giao KPI cho đồng nghiệp', updates: newAssignedItem('u_nv_qlda2', 'it_z', 'u_nv_qlda1') },
      { as: 'u_ptgd', op: 'update', expect: 'deny', note: 'kế hoạch GĐ đã duyệt – phải mở sửa đổi trước', updates: newAssignedItem('u_gd_cntt', 'it_late', 'u_ptgd') },
      { as: 'u_tb_hatang', op: 'update', expect: 'allow', note: 'người nhận tiếp nhận', updates: { [`${plan('u_tb_hatang')}/items/it_new/ack`]: { status: 'accepted', by: 'u_tb_hatang', at: NOW }, [`kpiAssignments/${P}/u_gd_cntt/as_test/status`]: 'accepted' } },
    ],
  },
  {
    name: 'Chế độ A (cố định) chặn sửa trọng số; chế độ B cho sửa nhưng không thấp hơn X%',
    steps: [
      { as: 'u_tn_qlda', op: 'update', expect: 'deny', updates: { [`${plan('u_tn_qlda')}/items/it_tn_1/weight`]: 30 } },
      { as: 'u_tn_qlda', op: 'update', expect: 'allow', updates: { [`${plan('u_tn_qlda')}/items/it_tn_2/weight`]: 20 } },
      { as: 'u_tn_qlda', op: 'update', expect: 'deny', note: 'thấp hơn tối thiểu 10%', updates: { [`${plan('u_tn_qlda')}/items/it_tn_2/weight`]: 5 } },
      { as: 'u_tn_qlda', op: 'update', expect: 'deny', note: 'không sửa nội dung KPI được giao', updates: { [`${plan('u_tn_qlda')}/items/it_tn_2/spec/title`]: 'Đổi tên' } },
      { as: 'u_tn_qlda', op: 'update', expect: 'deny', note: 'không tự đổi chế độ trọng số', updates: { [`${plan('u_tn_qlda')}/items/it_tn_1/spec/weightMode`]: 'flex' } },
      { as: 'u_tn_qlda', op: 'update', expect: 'deny', note: 'không xóa KPI được giao', updates: { [`${plan('u_tn_qlda')}/items/it_tn_1/spec`]: null, [`${plan('u_tn_qlda')}/items/it_tn_1/weight`]: null } },
      { as: 'u_tn_qlda', op: 'update', expect: 'deny', note: 'không xóa trọng số KPI được giao', updates: { [`${plan('u_tn_qlda')}/items/it_tn_1/weight`]: null } },
      { as: 'u_tn_qlda', op: 'update', expect: 'allow', note: 'sửa KPI tự chọn', updates: { [`${plan('u_tn_qlda')}/items/it_tn_3/weight`]: 40, [`${plan('u_tn_qlda')}/items/it_tn_3/spec/title`]: 'Đào tạo (đã chỉnh)' } },
      { as: 'u_tn_qlda', op: 'update', expect: 'deny', note: 'không ghi danh nghĩa người khác', updates: { [`${plan('u_tn_qlda')}/items/it_tn_2/ack`]: { status: 'accepted', by: 'u_tb_qlda', at: NOW } } },
      { as: 'u_tn_qlda', op: 'update', expect: 'allow', updates: { [`${plan('u_tn_qlda')}/items/it_tn_2/ack`]: { status: 'accepted', by: 'u_tn_qlda', at: NOW } } },
      { as: 'u_tb_qlda', op: 'update', expect: 'deny', note: 'quản lý không thể tiếp nhận thay', updates: { [`${plan('u_tn_qlda')}/items/it_tn_1/ack`]: { status: 'accepted', by: 'u_tb_qlda', at: NOW } } },
      { as: 'u_tb_qlda', op: 'update', expect: 'allow', note: 'quản lý điều chỉnh theo yêu cầu và đặt lại chờ tiếp nhận',
        updates: { [`${plan('u_tn_qlda')}/items/it_tn_1/weight`]: 30, [`${plan('u_tn_qlda')}/items/it_tn_1/ack`]: { status: 'pending', by: 'u_tb_qlda', at: NOW },
          [`${plan('u_tn_qlda')}/history/h_t1`]: { action: 'weight_change', itemId: 'it_tn_1', before: { weight: 40 }, after: { weight: 30 }, by: 'u_tb_qlda', at: NOW, reason: 'Theo đề nghị' } } },
      { as: 'u_tn_qlda', op: 'update', expect: 'deny', note: 'lịch sử chỉ được ghi thêm', updates: { [`${plan('u_tn_qlda')}/history/h_t1`]: null } },
    ],
  },
  {
    name: 'Trình và phê duyệt kế hoạch KPI theo đúng các bước',
    steps: [
      { as: 'u_tn_qlda', op: 'update', expect: 'deny', note: 'thiếu xác nhận của nhân sự', updates: { [`${plan('u_tn_qlda')}/status`]: 'submitted', [`${plan('u_tn_qlda')}/version`]: 1 } },
      { as: 'u_tn_qlda', op: 'update', expect: 'allow', updates: { [`${plan('u_tn_qlda')}/status`]: 'submitted', [`${plan('u_tn_qlda')}/version`]: 1, [`${plan('u_tn_qlda')}/signatures/employee`]: sig('u_tn_qlda', 1), [`${plan('u_tn_qlda')}/statusMeta`]: stamp('u_tn_qlda') } },
      { as: 'u_tn_qlda', op: 'update', expect: 'deny', note: 'đã trình – không sửa được', updates: { [`${plan('u_tn_qlda')}/items/it_tn_3/weight`]: 35 } },
      { as: 'u_tn_qlda', op: 'update', expect: 'deny', note: 'tự phê duyệt', updates: { [`${plan('u_tn_qlda')}/status`]: 'approved' } },
      { as: 'u_tb_qlda', op: 'update', expect: 'deny', note: 'bỏ qua bước QL trên 1 cấp', updates: { [`${plan('u_tn_qlda')}/status`]: 'approved', [`${plan('u_tn_qlda')}/signatures/manager`]: sig('u_tb_qlda', 1) } },
      { as: 'u_tb_qlda', op: 'update', expect: 'deny', note: 'trả lại phải có lý do', updates: { [`${plan('u_tn_qlda')}/status`]: 'returned' } },
      { as: 'u_tb_qlda', op: 'update', expect: 'allow', updates: { [`${plan('u_tn_qlda')}/status`]: 'manager_approved', [`${plan('u_tn_qlda')}/signatures/manager`]: sig('u_tb_qlda', 1), [`${plan('u_tn_qlda')}/statusMeta`]: stamp('u_tb_qlda') } },
      { as: 'u_tb_qlda', op: 'update', expect: 'deny', note: 'QL trực tiếp không duyệt thay bước cuối', updates: { [`${plan('u_tn_qlda')}/status`]: 'approved', [`${plan('u_tn_qlda')}/signatures/skip`]: sig('u_tb_qlda', 1) } },
      { as: 'u_gd_cntt', op: 'update', expect: 'allow', updates: { [`${plan('u_tn_qlda')}/status`]: 'approved', [`${plan('u_tn_qlda')}/signatures/skip`]: sig('u_gd_cntt', 1), [`${plan('u_tn_qlda')}/statusMeta`]: stamp('u_gd_cntt') } },
      { as: 'u_tn_qlda', op: 'update', expect: 'deny', note: 'kế hoạch đã khóa theo trạng thái', updates: { [`${plan('u_tn_qlda')}/items/it_tn_3/weight`]: 35 } },
    ],
  },
  {
    name: 'Trả lại kế hoạch kèm lý do; mở sửa đổi kế hoạch đã duyệt',
    steps: [
      { as: 'u_gd_cntt', op: 'update', expect: 'allow', updates: { [`${plan('u_tb_qlda')}/status`]: 'returned', [`${plan('u_tb_qlda')}/lastReturn`]: { by: 'u_gd_cntt', at: NOW, reason: 'Bổ sung mục tiêu sub-KPI' }, [`${plan('u_tb_qlda')}/returns/r1`]: { by: 'u_gd_cntt', at: NOW, reason: 'Bổ sung mục tiêu sub-KPI' } } },
      { as: 'u_tb_qlda', op: 'update', expect: 'allow', note: 'được sửa lại sau khi bị trả', updates: { [`${plan('u_tb_qlda')}/items/it_tb_5/weight`]: 20 } },
      { as: 'u_ptgd', op: 'update', expect: 'deny', note: 'mở sửa đổi phải có lý do', updates: { [`${plan('u_gd_cntt')}/status`]: 'returned' } },
      { as: 'u_ptgd', op: 'update', expect: 'allow', updates: { [`${plan('u_gd_cntt')}/status`]: 'returned', [`${plan('u_gd_cntt')}/lastUnlock`]: { by: 'u_ptgd', at: NOW, reason: 'Điều chỉnh kế hoạch kinh doanh' } } },
      { as: 'u_ptgd', op: 'update', expect: 'allow', note: 'giờ có thể giao thêm', updates: newAssignedItem('u_gd_cntt', 'it_late', 'u_ptgd') },
    ],
  },
  // ---------------- Kịch bản 5–7: đánh giá và phê duyệt
  {
    name: 'Tự đánh giá: chỉ khi kế hoạch đã duyệt và hồ sơ ở trạng thái cho phép',
    steps: [
      { as: 'u_nv_qlda2', op: 'update', expect: 'allow', updates: { [`${ev('u_nv_qlda2')}/self/kpi/it_mai_2/actual`]: 2, [`${ev('u_nv_qlda2')}/self/kbi/kbi_sangtao/level`]: 4 } },
      { as: 'u_nv_qlda1', op: 'update', expect: 'deny', note: 'không sửa hồ sơ người khác', updates: { [`${ev('u_nv_qlda2')}/self/kpi/it_mai_2/actual`]: 9 } },
      { as: 'u_hr', op: 'update', expect: 'deny', note: 'kế hoạch của HR chưa duyệt', updates: { [`${ev('u_hr')}/status`]: 'draft', [`${ev('u_hr')}/self/kpi/it_hr_1/actual`]: 90 } },
      { as: 'u_nv_qlda2', op: 'update', expect: 'deny', note: 'tự ghi điểm quản lý', updates: { [`${ev('u_nv_qlda2')}/manager/kbi/kbi_sangtao/level`]: 5 } },
      { as: 'u_nv_qlda2', op: 'update', expect: 'allow', updates: { [`${ev('u_nv_qlda2')}/status`]: 'submitted', [`${ev('u_nv_qlda2')}/version`]: 1, [`${ev('u_nv_qlda2')}/signatures/employee`]: sig('u_nv_qlda2', 1), [`${ev('u_nv_qlda2')}/statusMeta`]: stamp('u_nv_qlda2') } },
      { as: 'u_nv_qlda2', op: 'update', expect: 'deny', note: 'đã gửi – không sửa tùy ý', updates: { [`${ev('u_nv_qlda2')}/self/kpi/it_mai_2/actual`]: 1 } },
      { as: 'u_nv_qlda1', op: 'update', expect: 'deny', note: 'đã gửi – không sửa', updates: { [`${ev('u_nv_qlda1')}/self/summary/strengths`]: 'x' } },
    ],
  },
  {
    name: 'Quản lý đánh giá → QL trên 1 cấp phê duyệt → HR khóa / mở khóa',
    steps: [
      { as: 'u_nv_qlda2', op: 'update', expect: 'deny', updates: { [`${ev('u_nv_qlda1')}/manager/kbi/kbi_hieuqua/level`]: 5 } },
      { as: 'u_tn_qlda', op: 'update', expect: 'allow', updates: { [`${ev('u_nv_qlda1')}/manager/kbi/kbi_hieuqua/level`]: 4, [`${ev('u_nv_qlda1')}/manager/kpi/it_nam_2/actual`]: 95 } },
      { as: 'u_tn_qlda', op: 'update', expect: 'deny', note: 'không ghi đè tự đánh giá', updates: { [`${ev('u_nv_qlda1')}/self/kbi/kbi_hieuqua/level`]: 2 } },
      { as: 'u_tn_qlda', op: 'update', expect: 'deny', note: 'bỏ qua bước phê duyệt', updates: { [`${ev('u_nv_qlda1')}/status`]: 'approved', [`${ev('u_nv_qlda1')}/signatures/manager`]: sig('u_tn_qlda', 1), [`${ev('u_nv_qlda1')}/final`]: { computedAt: NOW, computedBy: 'u_tn_qlda', version: 1 } } },
      { as: 'u_tn_qlda', op: 'update', expect: 'allow', updates: { [`${ev('u_nv_qlda1')}/status`]: 'manager_reviewed', [`${ev('u_nv_qlda1')}/signatures/manager`]: sig('u_tn_qlda', 1), [`${ev('u_nv_qlda1')}/statusMeta`]: stamp('u_tn_qlda') } },
      { as: 'u_tn_qlda', op: 'update', expect: 'deny', note: 'đã chuyển bước – QL trực tiếp không sửa nữa', updates: { [`${ev('u_nv_qlda1')}/manager/kbi/kbi_hieuqua/level`]: 5 } },
      { as: 'u_tb_qlda', op: 'update', expect: 'deny', note: 'phê duyệt phải kèm kết quả cuối', updates: { [`${ev('u_nv_qlda1')}/status`]: 'approved', [`${ev('u_nv_qlda1')}/signatures/skip`]: sig('u_tb_qlda', 1) } },
      { as: 'u_tb_qlda', op: 'update', expect: 'allow', updates: { [`${ev('u_nv_qlda1')}/status`]: 'approved', [`${ev('u_nv_qlda1')}/signatures/skip`]: sig('u_tb_qlda', 1), [`${ev('u_nv_qlda1')}/final`]: { kpiScore: 1, kbiScore: 4, gradeCode: 'HT', computedAt: NOW, computedBy: 'u_tb_qlda', version: 1 }, [`${ev('u_nv_qlda1')}/statusMeta`]: stamp('u_tb_qlda') } },
      { as: 'u_tn_qlda', op: 'update', expect: 'deny', note: 'chỉ HR khóa', updates: { [`${ev('u_nv_qlda1')}/status`]: 'locked' } },
      { as: 'u_hr', op: 'update', expect: 'allow', updates: { [`${ev('u_nv_qlda1')}/status`]: 'locked', [`${ev('u_nv_qlda1')}/statusMeta`]: stamp('u_hr') } },
      { as: 'u_hr', op: 'update', expect: 'deny', note: 'mở khóa phải có lý do', updates: { [`${ev('u_nv_qlda1')}/status`]: 'returned' } },
      { as: 'u_hr', op: 'update', expect: 'allow', updates: { [`${ev('u_nv_qlda1')}/status`]: 'returned', [`${ev('u_nv_qlda1')}/lastUnlock`]: { by: 'u_hr', at: NOW, reason: 'Điều chỉnh số liệu doanh thu sau kiểm toán' } } },
    ],
  },
  {
    name: 'QL trên 1 cấp trả lại cho QL trực tiếp; ủy quyền phê duyệt',
    steps: [
      { as: 'u_tb_qlda', op: 'update', expect: 'deny', note: 'không phải QL trên 1 cấp của kỹ sư PTHT', updates: { [`${ev('u_nv_ptht')}/status`]: 'submitted', [`${ev('u_nv_ptht')}/lastReturn`]: { by: 'u_tb_qlda', at: NOW, reason: 'x' } } },
      { as: 'u_gd_cntt', op: 'update', expect: 'allow', note: 'ủy quyền cho Trưởng ban QLDA', updates: { [`delegations/${P}/u_gd_cntt/u_tb_qlda`]: { active: true, createdAt: NOW, reason: 'Nghỉ phép' } } },
      { as: 'u_tb_qlda', op: 'update', expect: 'allow', updates: { [`${ev('u_nv_ptht')}/status`]: 'submitted', [`${ev('u_nv_ptht')}/lastReturn`]: { by: 'u_tb_qlda', at: NOW, reason: 'Đề nghị rà soát lại điểm KBI Sáng tạo' } } },
      { as: 'u_tb_ptht', op: 'update', expect: 'allow', note: 'QL trực tiếp đánh giá lại', updates: { [`${ev('u_nv_ptht')}/manager/kbi/kbi_sangtao/level`]: 5 } },
    ],
  },
  {
    name: 'Kỳ đã khóa không cho sửa; mở lại kỳ phải có lý do',
    steps: [
      { as: 'u_hr', op: 'update', expect: 'deny', updates: { 'evaluations/P2025/u_nv_kt/status': 'returned', 'evaluations/P2025/u_nv_kt/lastUnlock': { by: 'u_hr', at: NOW, reason: 'x' } } },
      { as: 'u_hr', op: 'update', expect: 'deny', updates: { 'evaluationPeriods/P2025/status': 'open' } },
      { as: 'u_hr', op: 'update', expect: 'allow', updates: { 'evaluationPeriods/P2025/status': 'consolidating', 'evaluationPeriods/P2025/lastUnlock': { by: 'u_hr', at: NOW, reason: 'Điều chỉnh ngoại lệ theo quyết định HĐQT' } } },
      { as: 'u_nv_qlda1', op: 'update', expect: 'deny', updates: { 'evaluationPeriods/P2026/status': 'locked' } },
      { as: 'u_nv_qlda1', op: 'update', expect: 'deny', updates: { [`evaluationPeriodUsers/${P}/u_nv_qlda1/managerId`]: 'u_nv_qlda2' } },
    ],
  },
  // ---------------- Kiểm toán, thông báo
  {
    name: 'Nhật ký kiểm toán chỉ ghi thêm, đúng người và thời điểm',
    steps: [
      { as: 'u_nv_qlda1', op: 'update', expect: 'allow', updates: { 'auditLogs/l_t1': { type: 'x', actorId: 'u_nv_qlda1', at: NOW } } },
      { as: 'u_nv_qlda1', op: 'update', expect: 'deny', note: 'giả danh', updates: { 'auditLogs/l_t2': { type: 'x', actorId: 'u_hr', at: NOW } } },
      { as: 'u_nv_qlda1', op: 'update', expect: 'deny', note: 'lùi thời gian', updates: { 'auditLogs/l_t3': { type: 'x', actorId: 'u_nv_qlda1', at: 1 } } },
      { as: 'u_nv_qlda1', op: 'update', expect: 'deny', note: 'sửa/xóa', updates: { 'auditLogs/l_t1': null } },
    ],
  },
  {
    name: 'Thông báo trong ứng dụng',
    steps: [
      { as: 'u_tb_qlda', op: 'update', expect: 'allow', updates: { 'notifications/u_tn_qlda/n_t1': { type: 'x', title: 'Xin chào', fromId: 'u_tb_qlda', at: NOW, read: false } } },
      { as: 'u_tb_qlda', op: 'read', path: 'notifications/u_tn_qlda', expect: 'deny' },
      { as: 'u_tn_qlda', op: 'read', path: 'notifications/u_tn_qlda', expect: 'allow' },
      { as: 'u_tn_qlda', op: 'update', expect: 'allow', updates: { 'notifications/u_tn_qlda/n_t1/read': true } },
      { as: 'u_tb_qlda', op: 'update', expect: 'deny', note: 'không sửa thông báo đã gửi', updates: { 'notifications/u_tn_qlda/n_t1/title': 'Sửa' } },
    ],
  },
  // ---------------- Khởi tạo / bảo trì dữ liệu
  {
    name: 'Khởi tạo dữ liệu lần đầu chỉ với email bootstrap',
    data: 'empty',
    steps: [
      { as: { uid: 'x1', email: 'someone@opes-kpi.demo' }, op: 'update', expect: 'deny', updates: { config: { appSettings: { appName: 'x' } } } },
      { as: { uid: 'boot', email: BOOTSTRAP_EMAIL }, op: 'update', expect: 'allow', updates: { config: { appSettings: { appName: 'x' } }, 'system/initializedAt': NOW } },
      { as: { uid: 'boot', email: BOOTSTRAP_EMAIL }, op: 'update', expect: 'deny', note: 'sau khi khởi tạo không còn quyền đặc biệt', updates: { 'config/appSettings/appName': 'y' } },
    ],
  },
  {
    name: 'Cửa sổ bảo trì do System Admin mở',
    steps: [
      { as: 'u_hr', op: 'update', expect: 'deny', updates: { 'system/maintenance': { until: Date.now() + 600000, by: 'u_hr', at: NOW, reason: 'x' } } },
      { as: 'u_admin', op: 'update', expect: 'deny', note: 'chưa mở bảo trì', updates: { 'kpiPlans/P2026/u_ptgd/status': 'draft' } },
      { as: 'u_admin', op: 'update', expect: 'allow', updates: { 'system/maintenance': { until: Date.now() + 600000, by: 'u_admin', at: NOW, reason: 'Khởi tạo lại dữ liệu demo' } } },
      { as: 'u_admin', op: 'read', path: '', expect: 'allow' },
      { as: 'u_admin', op: 'update', expect: 'allow', updates: { 'kpiPlans/P2026/u_ptgd/status': 'draft' } },
    ],
  },
];
