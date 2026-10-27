#!/usr/bin/env node
/**
 * Sinh bộ dữ liệu vận hành js/seed/opes-kpi-data.json (cấu trúc Firebase Realtime Database):
 *   • Cấu hình đầy đủ để chạy thật (vai trò, quyền, công thức, trọng số, xếp loại, quy trình, biểu mẫu, kho KPI/KBI, cơ cấu tổ chức).
 *   • 25 hồ sơ nhân sự + 1 tài khoản quản trị hệ thống (không tham gia đánh giá).
 *   • Kỳ 2025 đã chốt & khóa đầy đủ cho 20 nhân sự (kế hoạch, giao KPI TOP-DOWN, sub-KPI, tự đánh giá, QL đánh giá, phê duyệt, xác nhận điện tử).
 *   • Kỳ 2026 để trống – HR tự tạo kỳ và khởi tạo danh sách 25 nhân sự trên ứng dụng.
 *
 *   BOOTSTRAP_ADMIN_EMAIL=quantri@congty.vn node tools/generate-opes-data.mjs
 *
 * Toàn bộ tên người là tên giả lập. Các chỉ tiêu, ngưỡng, tỷ trọng và bảng xếp loại là
 * "Cấu hình demo – cần HR xác nhận" (isDemo: true) – không phải quy định chính thức của OPES.
 * Kết quả cuối kỳ của các hồ sơ đã duyệt được tính bằng chính js/core/scoring.js để nhất quán.
 */
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { computeEvaluation, canonicalJSON } from '../js/core/scoring.js';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '..', 'js', 'seed', 'opes-kpi-data.json');
const DOMAIN = 'opes-kpi.demo';
/** Email tài khoản System Admin (trùng email bootstrap trong database.rules.json). */
const ADMIN_EMAIL = (process.env.BOOTSTRAP_ADMIN_EMAIL || `admin@${DOMAIN}`).toLowerCase();
const T = (y, m, d, h = 9, mi = 0) => Date.UTC(y, m - 1, d, h - 7, mi); // giờ Việt Nam
const clone = (x) => JSON.parse(JSON.stringify(x));
const emailKey = (e) => e.toLowerCase().replaceAll('.', ',');
const DEMO_NOTE = 'Cấu hình demo – cần HR xác nhận';

// ---------------------------------------------------------------------------
// 1. Danh mục cấu hình chung
// ---------------------------------------------------------------------------
const statusLabels = {
  plan: {
    none: { label: 'Chưa có kế hoạch', color: 'gray' },
    draft: { label: 'Nháp', color: 'gray' },
    submitted: { label: 'Chờ phê duyệt', color: 'amber' },
    manager_approved: { label: 'Chờ QL trên 1 cấp duyệt', color: 'amber' },
    approved: { label: 'Đã giao', color: 'teal' },
    returned: { label: 'Cần bổ sung', color: 'red' },
  },
  evaluation: {
    not_started: { label: 'Chưa bắt đầu', color: 'gray' },
    draft: { label: 'Đang đánh giá', color: 'blue' },
    submitted: { label: 'Chờ quản lý đánh giá', color: 'amber' },
    manager_reviewed: { label: 'Chờ phê duyệt', color: 'amber' },
    returned: { label: 'Cần bổ sung', color: 'red' },
    approved: { label: 'Đã phê duyệt', color: 'green' },
    locked: { label: 'Đã khóa', color: 'slate' },
  },
  assignment: {
    draft: { label: 'Chờ giao', color: 'purple' },
    assigned: { label: 'Đã giao – chờ tiếp nhận', color: 'teal' },
    accepted: { label: 'Đã tiếp nhận', color: 'green' },
    change_requested: { label: 'Yêu cầu điều chỉnh', color: 'red' },
    revoked: { label: 'Đã thu hồi', color: 'slate' },
  },
  ack: {
    pending: { label: 'Chờ tiếp nhận', color: 'purple' },
    accepted: { label: 'Đã tiếp nhận', color: 'green' },
    change_requested: { label: 'Yêu cầu điều chỉnh', color: 'red' },
  },
  period: {
    draft: { label: 'Nháp', color: 'gray' },
    configured: { label: 'Đã cấu hình', color: 'purple' },
    open: { label: 'Đang mở', color: 'green' },
    paused: { label: 'Tạm dừng', color: 'amber' },
    consolidating: { label: 'Đang tổng hợp', color: 'blue' },
    locked: { label: 'Đã khóa', color: 'slate' },
    archived: { label: 'Đã lưu trữ', color: 'gray' },
  },
  catalog: {
    active: { label: 'Đang sử dụng', color: 'green' },
    inactive: { label: 'Ngừng sử dụng', color: 'amber' },
    archived: { label: 'Lưu trữ', color: 'slate' },
  },
  unit: {
    active: { label: 'Đang hoạt động', color: 'green' },
    inactive: { label: 'Ngừng hoạt động', color: 'amber' },
    archived: { label: 'Lưu trữ', color: 'slate' },
  },
};

const roles = {
  sysAdmin: { label: 'Quản trị hệ thống', order: 1, description: 'Quản trị hệ thống, người dùng, vai trò, cấu hình và bảo trì dữ liệu.' },
  hrAdmin: { label: 'HR / KPI Admin', order: 2, description: 'Quản lý danh mục, kỳ đánh giá, mẫu biểu, công thức, quy trình và báo cáo toàn công ty.' },
  ptgd: { label: 'Phó Tổng Giám đốc thường trực', order: 3, description: 'Xây dựng kế hoạch cấp mình và giao KPI xuống các đơn vị trực thuộc.' },
  director: { label: 'Giám đốc Trung tâm', order: 4, description: 'Nhận KPI cấp trên, lập KPI đơn vị và giao xuống cấp dưới.' },
  head: { label: 'Trưởng Ban / Trưởng phòng', order: 5, description: 'Quản lý KPI và đánh giá nhóm thuộc phạm vi quản lý.' },
  lineManager: { label: 'Quản lý trực tiếp', order: 6, description: 'Giao/nhận KPI theo quyền và đánh giá nhân viên trực tiếp.' },
  employee: { label: 'Nhân viên', order: 7, description: 'Xem kế hoạch, tiếp nhận KPI, tự đánh giá KPI và KBI.' },
  approver: { label: 'Quản lý trên một cấp', order: 8, description: 'Xem và phê duyệt các hồ sơ thuộc luồng được giao.' },
  auditor: { label: 'Auditor / Viewer', order: 9, description: 'Xem báo cáo, dữ liệu và lịch sử được cấp quyền; không sửa dữ liệu nghiệp vụ.' },
};

const actions = {
  viewCatalog: { label: 'Xem danh mục KPI/KBI', group: 'Danh mục', order: 1 },
  manageCatalog: { label: 'Quản lý danh mục KPI Public & nhóm KPI', group: 'Danh mục', order: 2 },
  createPrivateKpi: { label: 'Tạo/sửa KPI Private do mình sở hữu', group: 'Danh mục', order: 3 },
  manageKbi: { label: 'Quản lý danh mục KBI', group: 'Danh mục', order: 4 },
  editOwnPlan: { label: 'Xây dựng KPI cá nhân, nhận KPI', group: 'KPI', order: 10 },
  assignKpi: { label: 'Giao KPI, sửa trọng số cho cấp dưới', group: 'KPI', order: 11 },
  createSubKpi: { label: 'Tạo sub-KPI', group: 'KPI', order: 12 },
  enterResults: { label: 'Nhập kết quả thực hiện', group: 'Đánh giá', order: 20 },
  selfAssessKbi: { label: 'Tự đánh giá KBI', group: 'Đánh giá', order: 21 },
  evaluateStaff: { label: 'Đánh giá nhân viên (QL trực tiếp)', group: 'Đánh giá', order: 22 },
  approve: { label: 'Phê duyệt (QL trên một cấp)', group: 'Phê duyệt', order: 30 },
  approveTopLevel: { label: 'Duyệt hồ sơ cấp cao nhất (không có QL trong phạm vi)', group: 'Phê duyệt', order: 31 },
  returnRecord: { label: 'Trả lại hồ sơ', group: 'Phê duyệt', order: 32 },
  lockRecords: { label: 'Khóa hồ sơ', group: 'Phê duyệt', order: 33 },
  unlockRecords: { label: 'Mở khóa ngoại lệ', group: 'Phê duyệt', order: 34 },
  viewReportsTeam: { label: 'Xem báo cáo phạm vi quản lý', group: 'Báo cáo', order: 40 },
  viewReportsAll: { label: 'Xem báo cáo toàn công ty', group: 'Báo cáo', order: 41 },
  exportData: { label: 'Xuất dữ liệu', group: 'Báo cáo', order: 42 },
  viewAllPlans: { label: 'Xem toàn bộ kế hoạch KPI', group: 'Báo cáo', order: 43 },
  viewAllEvaluations: { label: 'Xem toàn bộ hồ sơ đánh giá', group: 'Báo cáo', order: 44 },
  manageUsers: { label: 'Quản lý người dùng (hồ sơ, liên kết tài khoản)', group: 'Quản trị', order: 50 },
  manageOrg: { label: 'Quản lý cơ cấu tổ chức', group: 'Quản trị', order: 51 },
  managePeriods: { label: 'Cấu hình kỳ đánh giá', group: 'Quản trị', order: 52 },
  manageConfig: { label: 'Cấu hình công thức, trọng số, xếp loại, quy trình, mẫu biểu', group: 'Quản trị', order: 53 },
  viewAudit: { label: 'Xem lịch sử kiểm toán', group: 'Quản trị', order: 54 },
  seedData: { label: 'Khởi tạo / bảo trì dữ liệu demo', group: 'Quản trị', order: 55 },
};

const grant = (...keys) => Object.fromEntries(keys.map((k) => [k, true]));
const MANAGER_PERMS = ['viewCatalog', 'createPrivateKpi', 'editOwnPlan', 'assignKpi', 'createSubKpi', 'enterResults', 'selfAssessKbi',
  'evaluateStaff', 'approve', 'returnRecord', 'viewReportsTeam', 'exportData'];
const permissionPolicies = {
  roles: {
    sysAdmin: grant('viewCatalog', 'manageCatalog', 'manageKbi', 'manageUsers', 'manageOrg', 'managePeriods', 'manageConfig', 'viewAudit',
      'seedData', 'viewReportsAll', 'exportData', 'viewAllPlans', 'viewAllEvaluations'),
    hrAdmin: grant('viewCatalog', 'manageCatalog', 'createPrivateKpi', 'manageKbi', 'managePeriods', 'manageConfig', 'manageOrg', 'manageUsers',
      'viewReportsAll', 'exportData', 'viewAllPlans', 'viewAllEvaluations', 'lockRecords', 'unlockRecords', 'approveTopLevel', 'evaluateStaff',
      'approve', 'returnRecord', 'viewAudit', 'editOwnPlan', 'enterResults', 'selfAssessKbi'),
    ptgd: grant(...MANAGER_PERMS),
    director: grant(...MANAGER_PERMS),
    head: grant(...MANAGER_PERMS),
    lineManager: grant(...MANAGER_PERMS.filter((k) => k !== 'createPrivateKpi')),
    employee: grant('viewCatalog', 'editOwnPlan', 'createSubKpi', 'enterResults', 'selfAssessKbi'),
    approver: grant('viewCatalog', 'approve', 'returnRecord', 'viewReportsTeam'),
    auditor: grant('viewCatalog', 'viewReportsAll', 'viewAllPlans', 'viewAllEvaluations', 'viewAudit', 'exportData'),
  },
  updatedAt: T(2024, 12, 20),
  updatedBy: 'u_admin',
  note: 'Ma trận quyền mặc định. Quyền thao tác theo quan hệ (quản lý trực tiếp, chuỗi quản lý) được Database Rules kiểm tra thêm.',
};

const computePerms = (roleMap) => {
  const perms = {};
  Object.keys(roleMap || {}).forEach((r) => Object.entries(permissionPolicies.roles[r] || {}).forEach(([k, v]) => { if (v) perms[k] = true; }));
  return perms;
};

const appSettings = {
  appName: 'Hệ thống Quản lý KPI & KBI',
  companyName: 'Công ty Cổ phần Bảo hiểm OPES',
  companyAddress: 'Tầng 6, Tòa nhà số 5 Điện Biên Phủ, Quận Ba Đình, Hà Nội',
  theme: { primary: '#0b6b5d' },
  statusLabels,
  roles,
  actions,
  unitTypes: {
    executive: { label: 'Ban điều hành', order: 1 },
    center: { label: 'Trung tâm', order: 2 },
    function: { label: 'Đơn vị chức năng', order: 3 },
    office: { label: 'Văn phòng', order: 4 },
    department: { label: 'Ban / Phòng', order: 5 },
    team: { label: 'Nhóm / Bộ phận', order: 6 },
  },
  titleGroups: {
    staff: { label: 'Nhân viên & Chuyên viên', order: 1 },
    senior: { label: 'Chuyên viên chính / cao cấp', order: 2 },
    lead: { label: 'Trưởng nhóm / Quản lý trực tiếp', order: 3 },
    head: { label: 'Trưởng Ban / Trưởng phòng', order: 4 },
    director: { label: 'Giám đốc Trung tâm', order: 5 },
    executive: { label: 'Ban điều hành', order: 6 },
  },
  kpiDirections: {
    higher: { label: 'Càng cao càng tốt', order: 1 },
    lower: { label: 'Càng thấp càng tốt', order: 2 },
    scale: { label: 'Theo thang điểm', order: 3 },
    pass_fail: { label: 'Đạt / Không đạt', order: 4 },
  },
  frequencies: {
    month: { label: 'Tháng', order: 1 }, quarter: { label: 'Quý', order: 2 }, half: { label: 'Nửa năm', order: 3 }, year: { label: 'Năm', order: 4 },
  },
  periodTypes: {
    year: { label: 'Năm', order: 1 }, half: { label: 'Nửa năm', order: 2 }, quarter: { label: 'Quý', order: 3 }, other: { label: 'Khác', order: 4 },
  },
  sourceLabels: {
    assigned: { label: 'Cấp trên giao', color: 'teal' },
    catalog: { label: 'Tự chọn từ kho', color: 'blue' },
    custom: { label: 'Tự tạo mới', color: 'purple' },
    sub: { label: 'Sub-KPI', color: 'amber' },
  },
  configWarningsVisibleToAdmins: true,
};

const kpiGroups = Object.fromEntries([
  ['grp_tc', 'Tài chính'], ['grp_da', 'Dự án'], ['grp_vh', 'Hoạt động vận hành'], ['grp_ns', 'Nhân sự'], ['grp_kd', 'Kinh doanh'],
  ['grp_kh', 'Khách hàng'], ['grp_cntt', 'Công nghệ thông tin'], ['grp_cl', 'Chất lượng dịch vụ'], ['grp_tt', 'Tuân thủ và quản trị rủi ro'],
  ['grp_khac', 'Khác'],
].map(([id, name], i) => [id, { name, order: i + 1, status: 'active', description: '', updatedAt: T(2024, 12, 20) }]));

const scoringPolicies = {
  sp_tiered_excel: {
    name: 'Ba mốc – theo mẫu Excel 2025 (chia tỷ lệ)', method: 'tiered', version: 1, status: 'active', isDemo: true,
    params: { anchors: { threshold: 0.8, base: 1, stretch: 1.2 }, belowThreshold: 0, interpolation: 'excel_ratio', minRatio: 0, maxRatio: 1.2, missing: 'pending', ratioDecimals: 6 },
    note: 'Tái hiện cột "Kết quả quy đổi" của mẫu BM KPI2025: < Ngưỡng → 0%; = Ngưỡng → 80%; giữa Ngưỡng–Cơ bản = KQ/Ngưỡng × 80%; = Cơ bản → 100%; giữa Cơ bản–Đẩy mạnh = KQ/Cơ bản × 100%; ≥ Đẩy mạnh → 120%. Khác Excel: ô trống là "Chưa có dữ liệu", không tính 0. Lưu ý: chỉ liên tục khi Ngưỡng = 80% Cơ bản.',
  },
  sp_tiered_linear: {
    name: 'Ba mốc – nội suy tuyến tính (càng cao càng tốt)', method: 'tiered', version: 1, status: 'active', isDemo: true,
    params: { anchors: { threshold: 0.8, base: 1, stretch: 1.2 }, belowThreshold: 0, interpolation: 'linear', minRatio: 0, maxRatio: 1.2, missing: 'pending' },
    note: 'Nội suy tuyến tính giữa các điểm (Ngưỡng, 80%) – (Cơ bản, 100%) – (Đẩy mạnh, 120%). Dưới Ngưỡng → 0%.',
  },
  sp_tiered_lower: {
    name: 'Ba mốc – càng thấp càng tốt (tuyến tính)', method: 'tiered', version: 1, status: 'active', isDemo: true,
    params: { direction: 'lower', anchors: { threshold: 0.8, base: 1, stretch: 1.2 }, belowThreshold: 0, interpolation: 'linear', minRatio: 0, maxRatio: 1.2, missing: 'pending' },
    note: 'Dùng cho chỉ tiêu như số sự cố, thời gian xử lý: Ngưỡng ≥ Cơ bản ≥ Đẩy mạnh. Kết quả > Ngưỡng → 0%.',
  },
  sp_scale_1_5: {
    name: 'Thang điểm 1–5 (Mức 3/4/5 = 80/100/120%)', method: 'scale_levels', version: 1, status: 'active', isDemo: true,
    params: { levels: { 1: 0, 2: 0, 3: 0.8, 4: 1, 5: 1.2 }, allowDecimal: false, missing: 'pending' },
    note: 'Cho chỉ tiêu định tính chấm theo mô tả Mức 3/4/5. Với mức nguyên, kết quả trùng công thức Excel 2025 (Ngưỡng 3, Cơ bản 4, Đẩy mạnh 5).',
  },
  sp_ratio: {
    name: 'Tỷ lệ KQ/Cơ bản (tối đa 120%)', method: 'ratio', version: 1, status: 'active', isDemo: true,
    params: { minRatio: 0, maxRatio: 1.2, missing: 'pending' }, note: 'Tỷ lệ hoàn thành đơn giản, giới hạn 0–120%.',
  },
  sp_pass_fail: {
    name: 'Đạt / Không đạt (100% / 0%)', method: 'pass_fail', version: 1, status: 'active', isDemo: true,
    params: { passRatio: 1, failRatio: 0, missing: 'pending' }, note: 'Chỉ tiêu dạng có/không.',
  },
  sp_milestone: {
    name: 'Mốc tiến độ theo % hoàn thành', method: 'step_table', version: 1, status: 'active', isDemo: true,
    params: { steps: [{ bound: 110, ratio: 1.2, label: 'Vượt phạm vi/tiến độ' }, { bound: 100, ratio: 1, label: 'Hoàn thành 100%' }, { bound: 90, ratio: 0.8, label: 'Hoàn thành ≥ 90%' }, { bound: 80, ratio: 0.5, label: 'Hoàn thành ≥ 80%' }], below: 0, missing: 'pending' },
    note: 'Nhập % hoàn thành hạng mục theo kế hoạch đã phê duyệt.',
  },
  sp_formula_demo: {
    name: 'Công thức tùy biến (ví dụ clamp(A/B, 0, 1.2))', method: 'formula', version: 1, status: 'active', isDemo: true,
    params: { expression: 'clamp(A / B, 0, 1.2)', missing: 'pending' }, note: 'Biến: A = kết quả, T/B/S = Ngưỡng/Cơ bản/Đẩy mạnh, W = trọng số.',
  },
};

const kpiAggregation = {
  resultSource: 'manager_if_present', missingPolicy: 'incomplete', decimals: 2, roundingMode: 'round', isDemo: true, version: 1,
  note: 'Điểm KPI = Σ (Trọng số% × Tỷ lệ quy đổi). Kết quả chính thức của chỉ tiêu: lấy số quản lý xác nhận, nếu chưa có thì lấy số nhân viên tự nhập. Thiếu dữ liệu => chưa hoàn thành.',
};

const kbiPolicies = {
  default: {
    name: 'Chính sách KBI chuẩn', officialSource: 'manager', selfWeight: 0, managerWeight: 1, aggregate: 'mean', decimals: 2, roundingMode: 'round',
    minLevel: 1, maxLevel: 5, missingPolicy: 'incomplete', isDemo: true, version: 1,
    capRules: { negativeBehavior: { enabled: true, maxLevel: 3, label: 'Kết quả đạt 4 nhưng thể hiện một trong số hành vi mức 1 và mức 2: kết quả xếp tối đa mức 3' } },
    note: 'Điểm KBI chính thức = điểm quản lý trực tiếp; điểm tự đánh giá dùng để đối chiếu. KBI = trung bình cộng các giá trị cốt lõi áp dụng. (Mẫu Excel 2025 đang tham chiếu sai ô O38 – xem README.)',
  },
};

const band = (id, label, min, minInclusive, max, maxInclusive, order) => ({ id, label, min, minInclusive, max, maxInclusive, order });
const gradingBands = {
  default: {
    name: 'Ma trận xếp loại KPI × KBI theo mẫu Excel 2025', method: 'matrix', isDemo: true, version: 1, label: DEMO_NOTE,
    note: 'Tái hiện công thức ô "Điểm xếp loại" mẫu BM KPI2025. Hàng KPI < 70% không có trong mẫu Excel (Excel trả "Chưa có kết quả"); demo tạm gán "Không hoàn thành" – cần HR xác nhận.',
    grades: {
      KHT: { label: 'Không hoàn thành', order: 1, color: 'red' },
      CCG: { label: 'Cần cố gắng', order: 2, color: 'amber' },
      HT: { label: 'Hoàn thành', order: 3, color: 'blue' },
      HTT: { label: 'Hoàn thành tốt', order: 4, color: 'teal' },
      XS: { label: 'Xuất sắc', order: 5, color: 'green' },
    },
    kpiBands: {
      k0: band('k0', 'KPI < 70% (giả định demo)', null, true, 70, false, 0),
      k1: band('k1', '70% ≤ KPI < 80%', 70, true, 80, false, 1),
      k2: band('k2', '80% ≤ KPI < 95%', 80, true, 95, false, 2),
      k3: band('k3', '95% ≤ KPI < 110%', 95, true, 110, false, 3),
      k4: band('k4', '110% ≤ KPI < 120%', 110, true, 120, false, 4),
      k5: band('k5', 'KPI ≥ 120%', 120, true, null, false, 5),
    },
    kbiBands: {
      b1: band('b1', '0 < KBI ≤ 2', 0, false, 2, true, 1),
      b2: band('b2', '2 < KBI < 3', 2, false, 3, false, 2),
      b3: band('b3', '3 ≤ KBI < 4', 3, true, 4, false, 3),
      b4: band('b4', '4 ≤ KBI < 4,5', 4, true, 4.5, false, 4),
      b5: band('b5', '4,5 ≤ KBI ≤ 5', 4.5, true, 5, true, 5),
    },
    matrix: {
      k0: { b1: 'KHT', b2: 'KHT', b3: 'KHT', b4: 'KHT', b5: 'KHT' },
      k1: { b1: 'KHT', b2: 'KHT', b3: 'CCG', b4: 'HT', b5: 'HT' },
      k2: { b1: 'KHT', b2: 'CCG', b3: 'HT', b4: 'HT', b5: 'HT' },
      k3: { b1: 'CCG', b2: 'CCG', b3: 'HT', b4: 'HT', b5: 'HTT' },
      k4: { b1: 'CCG', b2: 'HT', b3: 'HT', b4: 'HTT', b5: 'XS' },
      k5: { b1: 'CCG', b2: 'HT', b3: 'HTT', b4: 'XS', b5: 'XS' },
    },
    weighted: {
      kpiWeight: 70, kbiWeight: 30, kbiMax: 5,
      bands: {
        w1: { min: 110, minInclusive: true, max: null, grade: 'XS', order: 1 },
        w2: { min: 100, minInclusive: true, max: 110, maxInclusive: false, grade: 'HTT', order: 2 },
        w3: { min: 85, minInclusive: true, max: 100, maxInclusive: false, grade: 'HT', order: 3 },
        w4: { min: 70, minInclusive: true, max: 85, maxInclusive: false, grade: 'CCG', order: 4 },
        w5: { min: null, max: 70, maxInclusive: false, grade: 'KHT', order: 5 },
      },
      note: 'Phương án thay thế (không dùng mặc định): điểm chung = 70% KPI + 30% KBI quy đổi (KBI/5×100).',
    },
    rounding: { kpiDecimals: 2, kbiDecimals: 2 },
    specialRules: {
      r1: { type: 'cap_if_kbi_value_le', level: 1, grade: 'CCG', enabled: false, order: 1, label: 'Ví dụ (đang tắt): có giá trị cốt lõi ở mức 1 → tối đa "Cần cố gắng"' },
    },
  },
};

const weightPolicies = {
  default: {
    name: 'Chính sách trọng số chuẩn', totalRequired: 100, tolerance: 0.01, minItemWeight: 5, maxItemWeight: 50,
    defaultMode: 'fixed', allowFlex: true, flexMinWeight: 5, flexMaxWeight: null, requireReapprovalOnFlexChange: true,
    groupConstraints: {},
    isDemo: true, version: 1,
    note: 'X% (trọng số tối thiểu khi cho phép cấp dưới điều chỉnh) mặc định 5% – người giao có thể đặt cao hơn cho từng lần giao.',
  },
};

const workflowTemplates = {
  default: {
    name: 'Quy trình chuẩn', isDemo: true, version: 1,
    kpiPlan: {
      requireSkipApproval: true, requireAckAll: true, allowRevisionAfterApproval: true,
      steps: { s1: { order: 1, actor: 'employee', label: 'Nhân sự tiếp nhận & trình bộ KPI' }, s2: { order: 2, actor: 'manager', label: 'Quản lý trực tiếp phê duyệt' }, s3: { order: 3, actor: 'skip', label: 'Quản lý trên 1 cấp phê duyệt (nếu có)' } },
    },
    evaluation: {
      requireSkipApproval: true, allowSkipReturnToManager: true, autoLockOnApproval: false, allowEmployeeSummary: true, enforceDeadlines: false,
      steps: {
        s1: { order: 1, actor: 'employee', label: 'Nhân viên tự đánh giá & gửi' },
        s2: { order: 2, actor: 'manager', label: 'Quản lý trực tiếp đánh giá' },
        s3: { order: 3, actor: 'skip', label: 'Quản lý trên 1 cấp phê duyệt' },
        s4: { order: 4, actor: 'hr', label: 'HR khóa kết quả' },
      },
    },
  },
};

const formTemplates = {
  default: {
    name: 'Mẫu BM KPI theo Excel 2025', version: 1,
    title: 'BẢN ĐÁNH GIÁ HIỆU QUẢ CÔNG VIỆC NĂM {year}',
    planTitle: 'BỘ CHỈ TIÊU ĐO LƯỜNG HIỆU QUẢ CÔNG VIỆC KPI NĂM {year}',
    sections: {
      general: { number: 'I', title: 'THÔNG TIN CHUNG', order: 1 },
      kpi: { number: 'I', title: 'CHỈ SỐ KPI (KEY PERFORMANCE INDICATOR)', order: 2 },
      kbi: { number: 'III', title: 'CHỈ SỐ KBI (KEY BEHAVIOR INDICATOR)', order: 3 },
      summary: { number: 'IV', title: 'TỔNG HỢP THÔNG TIN', order: 4 },
      review: { number: 'V', title: 'TỔNG HỢP ĐÁNH GIÁ', order: 5 },
      sign: { number: 'VI', title: 'TRÌNH KÝ, PHÊ DUYỆT VÀ LƯU TRỮ', order: 6 },
    },
    kpiColumns: {
      group: { label: 'Nhóm chỉ tiêu', visible: true, order: 1 },
      stt: { label: 'STT', visible: true, order: 2 },
      title: { label: 'Chỉ tiêu', visible: true, order: 3 },
      measurement: { label: 'Đo lường', visible: true, order: 4 },
      unit: { label: 'Đơn vị đo', visible: true, order: 5 },
      weight: { label: 'Trọng số', visible: true, order: 6 },
      threshold: { label: 'Ngưỡng', visible: true, order: 7 },
      base: { label: 'Cơ bản', visible: true, order: 8 },
      stretch: { label: 'Đẩy mạnh', visible: true, order: 9 },
      actual: { label: 'Kết quả', visible: true, order: 10 },
      explanation: { label: 'Diễn giải', visible: true, order: 11 },
      converted: { label: 'Kết quả quy đổi', visible: true, order: 12 },
      note: { label: 'Ghi chú', visible: true, order: 13 },
    },
    targetGroupLabel: 'Mục tiêu cả năm {year}',
    resultGroupLabel: 'Kết quả KPIs năm {year}',
    kbiIntro: 'Dựa trên các tiêu chuẩn hành vi được ban hành theo GTCL OPES. Anh/Chị đánh giá biểu hiện hành vi tương ứng với từng giá trị cốt lõi (mức 1–5).',
    summaryRows: { kpi: 'Điểm KPI', kbi: 'Điểm KBI', grade: 'Điểm xếp loại' },
    reviewRows: { strengths: 'Điểm mạnh & tiếp tục phát huy', improvements: 'Điểm cần cải thiện', proposals: 'Đề xuất (kế hoạch phát triển, đào tạo, công việc, chế độ...)' },
    signatureLabels: { employee: 'NHÂN SỰ ĐÁNH GIÁ', manager: 'QUẢN LÝ TRỰC TIẾP', skip: 'QUẢN LÝ TRÊN 1 CẤP' },
    planSignatureLabels: { employee: 'NHÂN SỰ TIẾP NHẬN BỘ KPI', manager: 'CẤP QUẢN LÝ', skip: 'QUẢN LÝ TRÊN 1 CẤP' },
    legalNote: 'Xác nhận điện tử trong hệ thống POC (lưu người thao tác, thời điểm, phiên bản nội dung) – không phải chữ ký số hoặc chữ ký điện tử có giá trị pháp lý.',
  },
};

// ---------------------------------------------------------------------------
// 2. Cơ cấu tổ chức (theo sơ đồ mẫu – có thể chỉnh sửa trong ứng dụng)
// ---------------------------------------------------------------------------
const units = {};
let unitOrder = 0;
const addUnit = (id, code, name, type, parentId, headId = null, note = '') => {
  units[id] = { code, name, type, parentId: parentId || null, headId, status: 'active', effectiveFrom: '2025-01-01', effectiveTo: null, order: ++unitOrder, note, updatedAt: T(2024, 12, 20), updatedBy: 'u_admin' };
  if (!parentId) delete units[id].parentId;
  if (!headId) delete units[id].headId;
  if (!note) delete units[id].note;
  delete units[id].effectiveTo;
};
addUnit('unit_ptgd', 'PTGDTT', 'Phó Tổng Giám đốc thường trực', 'executive', null, 'u_ptgd', 'Đơn vị gốc của chuỗi giao KPI TOP-DOWN (POC).');
const CENTERS = [
  ['unit_banca', 'TT-DTCL', 'Trung tâm Đối tác chiến lược và Bancassurance', 'center', 'u_gd_banca', [
    ['unit_banca_kd', 'DTCL-BANCA', 'Kinh doanh Bancassurance', 'u_tp_banca'], ['unit_banca_dt', 'DTCL-DT', 'Đối tác chiến lược'], ['unit_banca_dl', 'DTCL-DL', 'Quản lý phát triển đại lý và hỗ trợ kinh doanh']]],
  ['unit_bhdn', 'TT-BHDN', 'Trung tâm Bảo hiểm doanh nghiệp và trực tuyến', 'center', null, [
    ['unit_bhdn_d2c', 'BHDN-D2C', 'Bảo hiểm trực tuyến (D2C)'], ['unit_bhdn_dn', 'BHDN-DN', 'Bảo hiểm doanh nghiệp']]],
  ['unit_ptsp', 'TT-PTSP', 'Trung tâm Phát triển sản phẩm và Tái bảo hiểm', 'center', null, [
    ['unit_ptsp_sp', 'PTSP-SP', 'Phát triển sản phẩm và quản lý nghiệp vụ'], ['unit_ptsp_tbh', 'PTSP-TBH', 'Tái bảo hiểm']]],
  ['unit_dinhphi', 'DPBH', 'Định phí bảo hiểm', 'function', null, []],
  ['unit_dvkh', 'TT-DVKH', 'Trung tâm Dịch vụ khách hàng', 'center', null, [
    ['unit_dvkh_hd', 'DVKH-HD', 'Quản lý hợp đồng'], ['unit_dvkh_kh', 'DVKH-KH', 'Dịch vụ khách hàng']]],
  ['unit_gqql', 'TT-GQQL', 'Trung tâm Giải quyết quyền lợi bảo hiểm', 'center', null, [
    ['unit_gqql_sk', 'GQQL-SK', 'GQQLBH sức khỏe'], ['unit_gqql_pnt', 'GQQL-PNT', 'GQQLBH phi nhân thọ']]],
  ['unit_cntt', 'TT-CNTT', 'Trung tâm Công nghệ thông tin', 'center', 'u_gd_cntt', [
    ['unit_cntt_ht', 'CNTT-HT', 'Hạ tầng và an toàn thông tin', 'u_tb_hatang'], ['unit_cntt_ptht', 'CNTT-PTHT', 'Phát triển hệ thống', 'u_tb_ptht'],
    ['unit_cntt_vh', 'CNTT-VH', 'Vận hành và quản trị dữ liệu', 'u_tb_vh'], ['unit_cntt_qlda', 'CNTT-QLDA', 'Quản lý dự án', 'u_tb_qlda']]],
  ['unit_hr', 'TT-QTNNL', 'Trung tâm Quản trị nguồn nhân lực', 'center', 'u_gd_hr', [
    ['unit_hr_vh', 'QTNNL-VH', 'Vận hành nhân sự'], ['unit_hr_dt', 'QTNNL-DT', 'Đối tác nhân sự', 'u_tp_hrbp']]],
  ['unit_tc', 'TT-TC', 'Trung tâm Tài chính', 'center', 'u_gd_tc', [
    ['unit_tc_kh', 'TC-KH', 'Tài chính kế hoạch'], ['unit_tc_kt', 'TC-KT', 'Kế toán', 'u_tp_kt'], ['unit_tc_dt', 'TC-DT', 'Đầu tư']]],
  ['unit_ttt', 'TT-TTTT', 'Trung tâm Tiếp thị truyền thông', 'center', null, [
    ['unit_ttt_th', 'TTTT-TH', 'Phát triển thương hiệu và tiếp thị sản phẩm'], ['unit_ttt_tk', 'TTTT-TK', 'Thiết kế sáng tạo']]],
  ['unit_pc', 'TT-PCTT', 'Trung tâm Pháp chế Tuân thủ & QTRR', 'center', null, [
    ['unit_pc_pl', 'PCTT-PL', 'Pháp lý'], ['unit_pc_ks', 'PCTT-KS', 'Kiểm soát tuân thủ'], ['unit_pc_rr', 'PCTT-RR', 'Quản trị rủi ro']]],
  ['unit_vp', 'VP', 'Văn phòng', 'office', null, [
    ['unit_vp_hdqt', 'VP-HDQT', 'Văn phòng HĐQT'], ['unit_vp_opes', 'VP-OPES', 'Văn phòng OPES']]],
];
for (const [id, code, name, type, head, subs] of CENTERS) {
  addUnit(id, code, name, type, 'unit_ptgd', head,
    id === 'unit_dinhphi' ? 'Khởi tạo theo sơ đồ mẫu dưới dạng đơn vị chức năng riêng – cần xác nhận lại cấp tổ chức thực tế.' : '');
  for (const [sid, scode, sname, shead] of subs) addUnit(sid, scode, sname, 'department', id, shead || null);
}

// ---------------------------------------------------------------------------
// 3. Nhân sự (tên giả lập) – 25 người tham gia đánh giá + 1 tài khoản quản trị hệ thống
//    joined: năm bắt đầu tham gia đánh giá (2026 = nhân sự mới, không có dữ liệu 2025)
// ---------------------------------------------------------------------------
const USERS = [
  // id, mã NV, họ tên, email (phần trước @), chức danh, nhóm chức danh, đơn vị, quản lý trực tiếp, vai trò, joined
  ['u_admin', 'OP0001', 'Cao Văn Long', 'admin', 'Chuyên viên Quản trị hệ thống', 'staff', 'unit_cntt_vh', null, ['sysAdmin'], null],
  ['u_ptgd', 'OP0003', 'Hoàng Đức Thịnh', 'ptgd', 'Phó Tổng Giám đốc thường trực', 'executive', 'unit_ptgd', null, ['ptgd'], 2025],
  ['u_gd_cntt', 'OP0010', 'Trần Minh Đức', 'gd.cntt', 'Giám đốc Trung tâm Công nghệ thông tin', 'director', 'unit_cntt', 'u_ptgd', ['director', 'approver'], 2025],
  ['u_tb_qlda', 'OP0011', 'Lê Thu Hà', 'tb.qlda', 'Trưởng ban Quản lý dự án CNTT', 'head', 'unit_cntt_qlda', 'u_gd_cntt', ['head', 'approver'], 2025],
  ['u_tn_qlda', 'OP0012', 'Phạm Quốc Bảo', 'tn.qlda', 'Trưởng nhóm Dự án số', 'lead', 'unit_cntt_qlda', 'u_tb_qlda', ['lineManager'], 2025],
  ['u_nv_qlda1', 'OP0013', 'Nguyễn Hoàng Nam', 'nv.nam', 'Chuyên viên Quản lý dự án', 'staff', 'unit_cntt_qlda', 'u_tn_qlda', ['employee'], 2025],
  ['u_nv_qlda2', 'OP0014', 'Đỗ Mai Anh', 'nv.maianh', 'Chuyên viên Phân tích nghiệp vụ', 'staff', 'unit_cntt_qlda', 'u_tn_qlda', ['employee'], 2025],
  ['u_tb_ptht', 'OP0015', 'Võ Thanh Tùng', 'tb.ptht', 'Trưởng ban Phát triển hệ thống', 'head', 'unit_cntt_ptht', 'u_gd_cntt', ['head'], 2025],
  ['u_nv_ptht', 'OP0016', 'Hoàng Gia Huy', 'nv.huy', 'Kỹ sư phát triển phần mềm', 'staff', 'unit_cntt_ptht', 'u_tb_ptht', ['employee'], 2025],
  ['u_nv_ptht2', 'OP0018', 'Phùng Thị Ngọc', 'nv.ngoc', 'Kỹ sư kiểm thử phần mềm', 'staff', 'unit_cntt_ptht', 'u_tb_ptht', ['employee'], 2026],
  ['u_tb_hatang', 'OP0017', 'Bùi Văn Khánh', 'tb.hatang', 'Trưởng ban Hạ tầng và An toàn thông tin', 'head', 'unit_cntt_ht', 'u_gd_cntt', ['head'], 2025],
  ['u_nv_ht', 'OP0019', 'Trương Minh Quân', 'nv.quan', 'Kỹ sư hạ tầng và an toàn thông tin', 'staff', 'unit_cntt_ht', 'u_tb_hatang', ['employee'], 2025],
  ['u_tb_vh', 'OP0023', 'Nghiêm Văn Sơn', 'tb.vanhanh', 'Trưởng ban Vận hành và quản trị dữ liệu', 'head', 'unit_cntt_vh', 'u_gd_cntt', ['head'], 2025],
  ['u_nv_vh', 'OP0024', 'Hà Thị Phương', 'nv.phuong', 'Chuyên viên Quản trị dữ liệu', 'staff', 'unit_cntt_vh', 'u_tb_vh', ['employee'], 2026],
  ['u_gd_tc', 'OP0020', 'Ngô Thị Lan', 'gd.taichinh', 'Giám đốc Trung tâm Tài chính', 'director', 'unit_tc', 'u_ptgd', ['director', 'approver'], 2025],
  ['u_tp_kt', 'OP0021', 'Đặng Hữu Phúc', 'tp.ketoan', 'Trưởng phòng Kế toán', 'head', 'unit_tc_kt', 'u_gd_tc', ['head'], 2025],
  ['u_nv_kt', 'OP0022', 'Lý Thị Hồng', 'nv.hong', 'Chuyên viên Kế toán tổng hợp', 'staff', 'unit_tc_kt', 'u_tp_kt', ['employee'], 2025],
  ['u_nv_kt2', 'OP0025', 'Đinh Thu Trang', 'nv.trang', 'Chuyên viên Kế toán thanh toán', 'staff', 'unit_tc_kt', 'u_tp_kt', ['employee'], 2026],
  ['u_gd_banca', 'OP0030', 'Trịnh Quang Vinh', 'gd.banca', 'Giám đốc Trung tâm Đối tác chiến lược và Bancassurance', 'director', 'unit_banca', 'u_ptgd', ['director', 'approver'], 2025],
  ['u_tp_banca', 'OP0031', 'Lương Văn Hải', 'tp.banca', 'Trưởng ban Kinh doanh Bancassurance', 'head', 'unit_banca_kd', 'u_gd_banca', ['head'], 2025],
  ['u_nv_banca', 'OP0032', 'Tạ Thị Yến', 'nv.yen', 'Chuyên viên Phát triển kênh Bancassurance', 'staff', 'unit_banca_kd', 'u_tp_banca', ['employee'], 2025],
  ['u_nv_banca2', 'OP0033', 'Kim Đức Mạnh', 'nv.manh', 'Chuyên viên Hỗ trợ kinh doanh', 'staff', 'unit_banca_kd', 'u_tp_banca', ['employee'], 2026],
  ['u_gd_hr', 'OP0040', 'Mai Thị Thu', 'gd.nhansu', 'Giám đốc Trung tâm Quản trị nguồn nhân lực', 'director', 'unit_hr', 'u_ptgd', ['director', 'approver'], 2025],
  ['u_hr', 'OP0002', 'Phan Ngọc Linh', 'hr.admin', 'Chuyên viên C&B – Quản trị KPI', 'senior', 'unit_hr_vh', 'u_gd_hr', ['hrAdmin', 'employee'], 2025],
  ['u_tp_hrbp', 'OP0041', 'Vương Thị Hạnh', 'tp.hrbp', 'Trưởng ban Đối tác nhân sự', 'head', 'unit_hr_dt', 'u_gd_hr', ['head'], 2025],
  ['u_nv_td', 'OP0042', 'Lâm Quốc Toàn', 'nv.toan', 'Chuyên viên Tuyển dụng', 'staff', 'unit_hr_dt', 'u_tp_hrbp', ['employee'], 2026],
];
const userProfiles = {}, userAccess = {}, emailIndex = {}, demoLoginOptions = {};
const JOINED = {};
USERS.forEach(([id, code, name, local, title, titleGroup, unitId, managerId, roleList, joined], i) => {
  if (!units[unitId]) throw new Error(`Đơn vị không tồn tại: ${unitId}`);
  const email = id === 'u_admin' ? ADMIN_EMAIL : `${local}@${DOMAIN}`;
  const created = joined === 2026 ? T(2026, 3, 2 + i) : T(2024, 12, 20);
  userProfiles[id] = {
    employeeCode: code, name, email, title, titleGroup, unitId, status: 'active', createdAt: created, updatedAt: created, updatedBy: 'u_admin',
    ...(managerId ? { managerId } : {}), ...(id === 'u_admin' ? { evaluationExempt: true } : {}),
  };
  const roleMap = Object.fromEntries(roleList.map((r) => [r, true]));
  userAccess[id] = { roles: roleMap, perms: computePerms(roleMap), updatedAt: created, updatedBy: 'u_admin' };
  emailIndex[emailKey(email)] = id;
  demoLoginOptions[id] = { name, title, unitName: units[unitId].name, roleLabel: roleList.map((r) => roles[r].label).join(', '), email, order: i + 1 };
  JOINED[id] = joined;
});
const nameOf = (id) => userProfiles[id]?.name || '';

// ---------------------------------------------------------------------------
// 4. Kho KPI & KBI
// ---------------------------------------------------------------------------
const L = (m3, m4, m5) => ({ 3: m3, 4: m4, 5: m5 });
const kpiCatalogPublic = {};
const kpiCatalogPrivate = {};
const kpiCatalogAccessIndex = {};
const catalogMeta = { status: 'active', version: 1, effectiveFrom: '2025-01-01', createdBy: 'u_hr', createdAt: T(2024, 12, 23), updatedBy: 'u_hr', updatedAt: T(2024, 12, 23) };
const idOf = new Map();
const addKpi = (id, k, visibility = 'public', extra = {}) => {
  const rec = {
    code: k.code, name: k.name, groupId: k.groupId, description: k.description || '', definition: k.definition || '', measurement: k.measurement || '',
    unit: k.unit, dataSource: k.dataSource || '', frequency: k.frequency || 'year', direction: k.direction, scoringPolicyId: k.policy,
    targets: k.targets || {}, conversionNote: k.conversionNote || '', defaultWeight: k.defaultWeight ?? null, minWeight: k.minWeight ?? null,
    appliesTo: k.appliesTo || { scope: 'company' }, visibility, evidenceRequired: k.evidenceRequired ?? false, evidenceNote: k.evidenceNote || '',
    ...(k.levels ? { levelDescriptions: k.levels } : {}), ownerId: k.ownerId || 'u_hr', ...catalogMeta, ...extra,
  };
  if (rec.defaultWeight === null) delete rec.defaultWeight;
  if (rec.minWeight === null) delete rec.minWeight;
  (visibility === 'public' ? kpiCatalogPublic : kpiCatalogPrivate)[id] = rec;
  idOf.set(rec, id);
  return rec;
};

const K = {
  lntt: addKpi('kpi_tc_lntt', {
    code: 'TC-01', name: 'Lợi nhuận trước thuế', groupId: 'grp_tc', unit: 'Tỷ đồng', direction: 'higher', policy: 'sp_tiered_excel',
    description: 'Đo lường hiệu quả kinh doanh chung của Công ty; áp dụng cho cán bộ quản lý theo phân bổ.',
    measurement: 'Lợi nhuận trước thuế theo báo cáo tài chính năm.\nSau khi đã loại trừ các khoản chi thực tế sau thuế TNDN do không được tính vào chi phí hợp lý, hợp lệ để tính thuế (nếu có).',
    dataSource: 'Báo cáo tài chính do Trung tâm Tài chính cung cấp', targets: { threshold: 96, base: 120, stretch: 144 }, evidenceRequired: true,
    evidenceNote: 'Báo cáo tài chính/ số liệu Trung tâm Tài chính xác nhận', defaultWeight: 10,
    conversionNote: 'Mục tiêu minh họa – Trung tâm Tài chính cập nhật theo kế hoạch kinh doanh được phê duyệt từng năm.',
  }),
  dt: addKpi('kpi_tc_dt', {
    code: 'TC-02', name: 'Doanh thu khai thác phí bảo hiểm gốc', groupId: 'grp_tc', unit: 'Tỷ đồng', direction: 'higher', policy: 'sp_tiered_excel',
    measurement: 'Tổng doanh thu phí bảo hiểm cấp đơn (trừ hoàn, giảm phí) trong năm.', dataSource: 'Hệ thống Core/ báo cáo Tài chính',
    targets: { threshold: 1600, base: 2000, stretch: 2400 }, defaultWeight: 10, evidenceRequired: true,
  }),
  tuhoa: addKpi('kpi_da_tuhoa', {
    code: 'DA-01', name: 'Tối ưu hóa vận hành (dự án tự động hóa)', groupId: 'grp_da', unit: 'Điểm (1-5)', direction: 'scale', policy: 'sp_scale_1_5',
    measurement: 'Đánh giá theo mô tả Mức 3/4/5 dựa trên bảng trọng số riêng của từng đầu việc trong dự án.', targets: { threshold: 3, base: 4, stretch: 5 },
    levels: L('Dự án được cấp có thẩm quyền phê duyệt (Điều lệ dự án, phạm vi chính); hoàn thành 100% phạm vi đúng tiến độ đã phê duyệt (kể cả điều chỉnh), trong đó 90% phạm vi đúng tiến độ gốc; được đánh giá đạt yêu cầu.',
      'Như Mức 3 và hoàn thành 100% phạm vi đúng tiến độ gốc, được đánh giá có chất lượng tốt.',
      'Như Mức 4 và vượt tiến độ gốc, có sáng kiến/cải tiến hoặc triển khai thêm phạm vi phát sinh được ghi nhận.'),
    evidenceRequired: true, evidenceNote: 'Biên bản nghiệm thu, báo cáo tiến độ dự án',
  }),
  caupcn: addKpi('kpi_da_caupcn', {
    code: 'DA-02', name: 'Đảm bảo các cấu phần công nghệ của các dự án kinh doanh, vận hành được hoàn thành đúng thời gian và chất lượng cam kết', groupId: 'grp_da',
    unit: 'Điểm (1-5)', direction: 'scale', policy: 'sp_scale_1_5', targets: { threshold: 3, base: 4, stretch: 5 },
    measurement: 'Tỷ lệ dự án có cấu phần công nghệ đúng tiến độ và đầy đủ phạm vi yêu cầu được cấp có thẩm quyền phê duyệt.',
    levels: L('Đảm bảo 90% dự án tham gia triển khai đúng tiến độ và đầy đủ phạm vi yêu cầu.', 'Đảm bảo 95% dự án đúng tiến độ và đầy đủ phạm vi yêu cầu.', 'Đảm bảo 100% dự án đúng tiến độ và đầy đủ phạm vi yêu cầu.'),
  }),
  d2c: addKpi('kpi_da_d2c', {
    code: 'DA-03', name: 'Triển khai dự án D2C', groupId: 'grp_da', unit: 'Điểm (1-5)', direction: 'scale', policy: 'sp_scale_1_5', targets: { threshold: 3, base: 4, stretch: 5 },
    measurement: 'Đảm bảo các công việc được giao thực hiện theo đúng kế hoạch và chất lượng, theo đánh giá của dự án.',
    levels: L('Hoàn thành 100% phạm vi theo kế hoạch dự án và golive chính thức đúng mốc cam kết.', 'Như Mức 3 và golive sớm hơn mốc cam kết 10 ngày.', 'Như Mức 3 và golive sớm hơn mốc cam kết từ 20 ngày.'),
  }),
  xcg: addKpi('kpi_da_xcg', {
    code: 'DA-04', name: 'Triển khai nền tảng phân tích tổn thất xe cơ giới dựa trên hình ảnh', groupId: 'grp_da', unit: 'Điểm (1-5)', direction: 'scale', policy: 'sp_scale_1_5',
    targets: { threshold: 3, base: 4, stretch: 5 },
    levels: L('Hoàn thành 100% phạm vi đúng tiến độ đã phê duyệt (kể cả điều chỉnh).', 'Hoàn thành 100% phạm vi đúng tiến độ gốc, chất lượng tốt.', 'Vượt tiến độ gốc và có cải tiến được ghi nhận.'),
  }),
  attt: addKpi('kpi_vh_attt', {
    code: 'VH-01', name: 'Hệ thống CNTT hoạt động an toàn, ổn định', groupId: 'grp_vh', unit: 'Điểm (1-5)', direction: 'scale', policy: 'sp_scale_1_5',
    targets: { threshold: 3, base: 4, stretch: 5 },
    measurement: '50% cho "Tính sẵn sàng của hệ thống" theo cam kết SLA:\n o Tỷ lệ sẵn sàng = trung bình cộng tỷ lệ sẵn sàng của các hệ thống trọng yếu (đã đăng ký với QTRR)\n o Tỷ lệ sẵn sàng = (tổng thời gian kỳ đo – thời gian gián đoạn)/tổng thời gian kỳ đo\n50% cho "Đảm bảo an toàn hệ thống CNTT".',
    levels: L('Không để xảy ra sự cố mất ATTT; khắc phục ≥ 80% vấn đề ATTT theo kế hoạch; sẵn sàng hệ thống trọng yếu ≥ 95%.',
      'Không để xảy ra sự cố mất ATTT; khắc phục 100% vấn đề theo kế hoạch; sẵn sàng ≥ 98%.', 'Không để xảy ra sự cố mất ATTT; sẵn sàng ≥ 99%.'),
    evidenceRequired: true, evidenceNote: 'Báo cáo SLA, báo cáo ATTT',
  }),
  sla: addKpi('kpi_vh_sla', {
    code: 'VH-02', name: 'Tỷ lệ sẵn sàng của hệ thống trọng yếu', groupId: 'grp_vh', unit: '%', direction: 'higher', policy: 'sp_tiered_linear',
    measurement: '(Tổng thời gian kỳ đo – thời gian gián đoạn)/tổng thời gian kỳ đo, bình quân các hệ thống trọng yếu.', targets: { threshold: 95, base: 98, stretch: 99 }, frequency: 'month',
  }),
  incident: addKpi('kpi_vh_incident', {
    code: 'VH-03', name: 'Số sự cố nghiêm trọng (P1) trong năm', groupId: 'grp_cntt', unit: 'Sự cố', direction: 'lower', policy: 'sp_tiered_lower',
    measurement: 'Số sự cố mức P1 được ghi nhận trên hệ thống quản lý sự cố.', targets: { threshold: 4, base: 2, stretch: 0 },
  }),
  daotao: addKpi('kpi_ns_daotao', {
    code: 'NS-01', name: 'Tham gia các chuyên đề đào tạo và hoạt động/sự kiện VHDN chung (theo chương trình bắt buộc của Công ty)', groupId: 'grp_ns',
    unit: 'Điểm (1-5)', direction: 'scale', policy: 'sp_scale_1_5', targets: { threshold: 3, base: 4, stretch: 5 },
    measurement: 'Điều kiện cần: tỷ lệ tham gia các chuyên đề đào tạo bắt buộc trên 80% (tham gia đủ từ 80% thời lượng và đạt yêu cầu bài test nếu có).',
    levels: L('Hoàn thành 80% số lượng chuyên đề/hoạt động/sự kiện bắt buộc.', 'Hoàn thành 100% số lượng chuyên đề/hoạt động/sự kiện bắt buộc.', 'Như Mức 4 và có sáng kiến ứng dụng kiến thức vào cải tiến công việc, được ghi nhận hiệu quả.'),
    defaultWeight: 5,
  }),
  vhdn: addKpi('kpi_ns_vhdn', {
    code: 'NS-02', name: 'Đồng kiến tạo văn hóa doanh nghiệp OPES', groupId: 'grp_ns', unit: 'Điểm (1-5)', direction: 'scale', policy: 'sp_scale_1_5',
    targets: { threshold: 3, base: 4, stretch: 5 },
    levels: L('Có 03 dấu xác nhận hoàn thành tham gia từ team Đại sứ văn hóa.', 'Có 05 dấu xác nhận tương ứng 05 giá trị cốt lõi.', 'Như Mức 4 và có từ 03 lần đạt top 3 trong các hoạt động/sự kiện.'),
  }),
  sangkien: addKpi('kpi_khac_sangkien', {
    code: 'KH-01', name: 'Sáng kiến/giải pháp được cấp thẩm quyền đánh giá mang lại hiệu quả trong mảng nghiệp vụ phụ trách', groupId: 'grp_khac',
    unit: 'Điểm (1-5)', direction: 'scale', policy: 'sp_scale_1_5', targets: { threshold: 3, base: 4, stretch: 5 },
    levels: L('Sáng kiến/giải pháp được áp dụng vào thực tế vận hành.', 'Được áp dụng và mang lại hiệu quả cụ thể về năng suất hoặc doanh thu/chi phí (có minh chứng).',
      'Mang lại hiệu quả nổi trội (năng suất tăng ≥ 20% hoặc cắt giảm chi phí ≥ 15% so với ngân sách), có xác nhận của đơn vị liên quan.'),
    evidenceRequired: true,
  }),
  csat: addKpi('kpi_kh_csat', {
    code: 'KHG-01', name: 'Mức độ hài lòng của khách hàng (CSAT)', groupId: 'grp_kh', unit: '%', direction: 'higher', policy: 'sp_tiered_linear',
    targets: { threshold: 80, base: 85, stretch: 90 }, measurement: 'Tỷ lệ khách hàng đánh giá hài lòng/rất hài lòng qua khảo sát sau dịch vụ.',
  }),
  tat: addKpi('kpi_cl_tat', {
    code: 'CL-01', name: 'Thời gian giải quyết quyền lợi bảo hiểm bình quân', groupId: 'grp_cl', unit: 'Ngày', direction: 'lower', policy: 'sp_tiered_lower',
    targets: { threshold: 10, base: 7, stretch: 5 }, measurement: 'Bình quân số ngày từ khi nhận đủ hồ sơ đến khi ra thông báo bồi thường.',
    appliesTo: { scope: 'units', unitIds: { unit_gqql: true, unit_dvkh: true } },
  }),
  vipham: addKpi('kpi_tt_vipham', {
    code: 'TT-01', name: 'Không để xảy ra vi phạm tuân thủ nghiêm trọng', groupId: 'grp_tt', unit: 'Đạt/Không đạt', direction: 'pass_fail', policy: 'sp_pass_fail',
    measurement: 'Không có kết luận vi phạm tuân thủ nghiêm trọng của cơ quan quản lý/ kiểm toán nội bộ trong kỳ.',
  }),
  banca: addKpi('kpi_kd_banca', {
    code: 'KD-01', name: 'Doanh thu phí kênh Bancassurance', groupId: 'grp_kd', unit: 'Tỷ đồng', direction: 'higher', policy: 'sp_tiered_excel',
    targets: { threshold: 960, base: 1200, stretch: 1440 }, appliesTo: { scope: 'units', unitIds: { unit_banca: true } },
  }),
  milestone: addKpi('kpi_cn_milestone', {
    code: 'CN-01', name: 'Tiến độ triển khai hạng mục công nghệ theo kế hoạch', groupId: 'grp_cntt', unit: '% hoàn thành', direction: 'higher', policy: 'sp_milestone',
    targets: { base: 100 }, measurement: '% khối lượng hạng mục hoàn thành đúng mốc trên kế hoạch được phê duyệt.', appliesTo: { scope: 'units', unitIds: { unit_cntt: true } },
  }),
  chiphi: addKpi('kpi_tc_chiphi', {
    code: 'TC-03', name: 'Tỷ lệ thực hiện ngân sách chi phí của đơn vị', groupId: 'grp_tc', unit: '%', direction: 'lower', policy: 'sp_tiered_lower',
    targets: { threshold: 105, base: 100, stretch: 95 }, measurement: 'Chi phí thực hiện / ngân sách được duyệt.',
  }),
  tuyendung: addKpi('kpi_ns_tuyendung', {
    code: 'NS-03', name: 'Tỷ lệ hoàn thành kế hoạch tuyển dụng', groupId: 'grp_ns', unit: '%', direction: 'higher', policy: 'sp_tiered_linear',
    targets: { threshold: 80, base: 100, stretch: 110 }, appliesTo: { scope: 'units', unitIds: { unit_hr: true } },
  }),
  daily: addKpi('kpi_kd_daily', {
    code: 'KD-02', name: 'Số điểm bán Bancassurance mới được kích hoạt', groupId: 'grp_kd', unit: 'Điểm bán', direction: 'higher', policy: 'sp_tiered_excel',
    targets: { threshold: 80, base: 100, stretch: 120 }, measurement: 'Điểm bán/chi nhánh ngân hàng đối tác phát sinh hợp đồng đầu tiên trong năm.', appliesTo: { scope: 'units', unitIds: { unit_banca: true } },
  }),
  duytri: addKpi('kpi_kd_duytri', {
    code: 'KD-03', name: 'Tỷ lệ duy trì hợp đồng năm thứ hai (kênh Bancassurance)', groupId: 'grp_kd', unit: '%', direction: 'higher', policy: 'sp_tiered_linear',
    targets: { threshold: 80, base: 85, stretch: 90 }, measurement: 'Số hợp đồng còn hiệu lực sau 13 tháng / số hợp đồng phát hành cùng kỳ.', appliesTo: { scope: 'units', unitIds: { unit_banca: true } },
  }),
  nghiviec: addKpi('kpi_ns_nghiviec', {
    code: 'NS-04', name: 'Tỷ lệ nghỉ việc tự nguyện', groupId: 'grp_ns', unit: '%', direction: 'lower', policy: 'sp_tiered_lower',
    targets: { threshold: 12, base: 10, stretch: 8 }, measurement: 'Số nhân sự nghỉ việc tự nguyện / số nhân sự bình quân trong năm.', appliesTo: { scope: 'units', unitIds: { unit_hr: true } },
  }),
  tgtd: addKpi('kpi_ns_tgtd', {
    code: 'NS-05', name: 'Thời gian tuyển dụng bình quân', groupId: 'grp_ns', unit: 'Ngày', direction: 'lower', policy: 'sp_tiered_lower',
    targets: { threshold: 45, base: 35, stretch: 30 }, measurement: 'Bình quân số ngày từ khi yêu cầu tuyển dụng được duyệt đến khi ứng viên nhận việc.', appliesTo: { scope: 'units', unitIds: { unit_hr: true } },
  }),
  dulieu: addKpi('kpi_vh_dulieu', {
    code: 'VH-04', name: 'Tỷ lệ dữ liệu nghiệp vụ đạt chuẩn chất lượng', groupId: 'grp_vh', unit: '%', direction: 'higher', policy: 'sp_tiered_linear',
    targets: { threshold: 95, base: 98, stretch: 99.5 }, measurement: 'Số bản ghi đạt bộ quy tắc chất lượng dữ liệu / tổng số bản ghi được kiểm tra.', appliesTo: { scope: 'units', unitIds: { unit_cntt: true } },
  }),
  baocao: addKpi('kpi_vh_baocao', {
    code: 'VH-05', name: 'Tỷ lệ báo cáo quản trị cung cấp đúng hạn', groupId: 'grp_vh', unit: '%', direction: 'higher', policy: 'sp_tiered_linear',
    targets: { threshold: 90, base: 95, stretch: 100 }, measurement: 'Số báo cáo cung cấp đúng hạn / tổng số báo cáo theo lịch.',
  }),
  thue: addKpi('kpi_tc_thue', {
    code: 'TC-04', name: 'Báo cáo tài chính, hồ sơ thuế nộp đúng hạn và không bị phạt', groupId: 'grp_tc', unit: 'Đạt/Không đạt', direction: 'pass_fail', policy: 'sp_pass_fail',
    measurement: 'Toàn bộ báo cáo/ hồ sơ nộp cơ quan quản lý đúng hạn, không phát sinh quyết định xử phạt.', appliesTo: { scope: 'units', unitIds: { unit_tc: true } },
  }),
};
const KP = {
  core: addKpi('kpi_pv_cntt_core', {
    code: 'CN-P01', name: 'Chuyển đổi lõi hệ thống nghiệp vụ (Core) – giai đoạn 1', groupId: 'grp_cntt', unit: 'Điểm (1-5)', direction: 'scale', policy: 'sp_scale_1_5',
    targets: { threshold: 3, base: 4, stretch: 5 }, ownerId: 'u_gd_cntt', measurement: 'Đánh giá theo mốc của Ban chỉ đạo dự án Core.',
    levels: L('Hoàn thành các mốc giai đoạn 1 đúng tiến độ điều chỉnh.', 'Hoàn thành đúng tiến độ gốc.', 'Vượt tiến độ gốc, chuyển đổi dữ liệu không lỗi nghiêm trọng.'),
  }, 'private', { allowedUsers: { u_tb_qlda: true, u_tb_ptht: true, u_tb_vh: true } }),
  audit: addKpi('kpi_pv_tc_audit', {
    code: 'TC-P01', name: 'Hoàn thành kiểm toán báo cáo tài chính đúng hạn', groupId: 'grp_tc', unit: 'Đạt/Không đạt', direction: 'pass_fail', policy: 'sp_pass_fail', ownerId: 'u_gd_tc',
  }, 'private', { allowedUsers: { u_tp_kt: true } }),
};
kpiCatalogPrivate.kpi_pv_cntt_core.createdBy = 'u_gd_cntt';
kpiCatalogPrivate.kpi_pv_cntt_core.updatedBy = 'u_gd_cntt';
kpiCatalogPrivate.kpi_pv_tc_audit.createdBy = 'u_gd_tc';
kpiCatalogPrivate.kpi_pv_tc_audit.updatedBy = 'u_gd_tc';
for (const [kid, rec] of Object.entries(kpiCatalogPrivate)) {
  for (const uid of [rec.ownerId, ...Object.keys(rec.allowedUsers || {})]) (kpiCatalogAccessIndex[uid] ||= {})[kid] = true;
}

const lv = (a, b, c, d, e) => ({ 1: { title: 'Mức 1', description: a }, 2: { title: 'Mức 2', description: b }, 3: { title: 'Mức 3', description: c }, 4: { title: 'Mức 4', description: d }, 5: { title: 'Mức 5', description: e } });
const KBI_GUIDE = 'Chọn mức mô tả đúng nhất hành vi thể hiện thường xuyên trong kỳ, có ví dụ/minh chứng. Trường hợp đạt mức 4 nhưng thể hiện một trong các hành vi mức 1 hoặc 2 thì kết quả tối đa mức 3.';
const kbiMeta = { status: 'active', version: 1, effectiveFrom: '2025-01-01', weight: 1, appliesTo: { scope: 'company' }, scoringGuide: KBI_GUIDE, updatedAt: T(2024, 12, 23), updatedBy: 'u_hr' };
const kbiCatalog = {
  kbi_khatvong: {
    code: 'GTCL-01', name: 'Khát Vọng', order: 1, definition: 'Thể hiện tinh thần cầu tiến. Luôn nỗ lực/dấn thân để mang lại giá trị vượt trội.',
    behaviors: 'Cầu thị, chủ động phát triển bản thân; theo đuổi kết quả vượt kỳ vọng cho khách hàng/đối tác/đồng nghiệp.',
    levels: lv('Thụ động, phân tâm, thờ ơ với kế hoạch/mục tiêu chung; hoặc phát ngôn gây ảnh hưởng tiêu cực đến môi trường làm việc/hình ảnh của OPES.',
      'Tự mãn, xem nhẹ các phản hồi, thiếu nghiêm túc/quyết liệt trong việc hoàn thiện/nâng cao chất lượng dịch vụ.',
      'Có tính cầu thị, trau dồi phát triển bản thân/cải tiến công việc.',
      'Dịch vụ/kết quả công việc mang lại sự hài lòng tới khách hàng/đối tác/đồng nghiệp bởi tính hiệu quả, tiện ích, trải nghiệm vượt trội.',
      'Đáp ứng đầy đủ các hành vi chuẩn mực và có kết quả công việc giúp xác lập được năng lực vượt trội/tên tuổi OPES với khách hàng/đối tác.'),
    evidenceExamples: 'Phản hồi khách hàng/đối tác, chứng chỉ đào tạo, sáng kiến cải tiến đã áp dụng.',
    meetsExpectation: 'Từ mức 3: chủ động học hỏi và cải tiến công việc.', needsImprovement: 'Mức 1–2: thụ động, tự mãn, xem nhẹ phản hồi.',
  },
  kbi_kycuong: {
    code: 'GTCL-02', name: 'Kỷ cương', order: 2,
    definition: 'Giữ ý thức tự giác và trách nhiệm trong tuân thủ và thực thi để cung cấp sản phẩm, dịch vụ chất lượng và trải nghiệm tốt nhất tới khách hàng, đối tác.',
    behaviors: 'Tự giác chấp hành quy định; kỷ luật về thời hạn; giải quyết gốc rễ vấn đề.',
    levels: lv('Trì hoãn hoặc triển khai thiếu nhất quán, không tuân thủ/làm trái các quy định, chủ trương/quyết sách của tổ chức/cấp thẩm quyền.',
      'Hời hợt, đùn đẩy trách nhiệm cho người khác khi có vấn đề xảy ra; hoặc bỏ lửng công việc, không tìm hiểu giải quyết gốc rễ vấn đề phát sinh.',
      'Tự giác chấp hành quy định/chủ trương/quyết sách của Tổ chức; kỷ luật trong việc hoàn thành thời hạn công việc theo tiến độ được giao.',
      'Tinh thần trách nhiệm và kỷ cương trong thực thi mang lại kết quả cụ thể bằng việc đưa ra giải pháp cốt lõi/giải quyết căn bản vấn đề vướng mắc.',
      'Đáp ứng đầy đủ các hành vi chuẩn mực và có kết quả công việc giúp xác lập được uy tín/giữ đúng cam kết với khách hàng/đối tác.'),
    evidenceExamples: 'Tỷ lệ hoàn thành đúng hạn, biên bản xử lý sự việc, ghi nhận tuân thủ.',
    meetsExpectation: 'Từ mức 3: tuân thủ và đúng hạn.', needsImprovement: 'Mức 1–2: trì hoãn, đùn đẩy, không tuân thủ.',
  },
  kbi_sangtao: {
    code: 'GTCL-03', name: 'Sáng tạo', order: 3,
    definition: 'Tinh thần không ngừng học hỏi, chủ động thích ứng với xu thế và tìm giải pháp hướng tới gia tăng giá trị cụ thể và bền vững.',
    behaviors: 'Cởi mở với khác biệt; dành nguồn lực học hỏi; đề xuất cải tiến được áp dụng.',
    levels: lv('Thường phán xét/từ chối sự khác biệt về quan điểm/góc nhìn/cách làm.',
      'Từ chối dành thời gian/nguồn lực cho các hoạt động học hỏi, nghiên cứu, đổi mới.',
      'Có tinh thần học hỏi, cầu thị và chủ động thích ứng với những yêu cầu thay đổi.',
      'Có nghiên cứu/đề xuất cụ thể để cải tiến/đổi mới trong công việc, được áp dụng thực tế hoặc đã được phê duyệt áp dụng.',
      'Đáp ứng đầy đủ các hành vi chuẩn mực và đề xuất ý tưởng cải tiến/đổi mới mang lại hiệu quả khác biệt cho OPES.'),
    evidenceExamples: 'Đề xuất cải tiến, tài liệu nghiên cứu, kết quả áp dụng.',
    meetsExpectation: 'Từ mức 3: học hỏi và thích ứng.', needsImprovement: 'Mức 1–2: bảo thủ, từ chối đổi mới.',
  },
  kbi_chinhtruc: {
    code: 'GTCL-04', name: 'Chính trực', order: 4,
    definition: 'Có sự nhất quán trong lời nói và hành động, giữ chuẩn mực đạo đức và bản lĩnh coi trọng cái đúng hơn ai đúng.',
    behaviors: 'Trung thực; nhận lỗi; bảo vệ lẽ phải và giữ hòa khí.',
    levels: lv('Nói sai sự thật; hoặc vi phạm chuẩn mực đạo đức/quy định pháp luật/Công ty.',
      'Khi sai, từ chối nhận lỗi và thoái thác trách nhiệm; hoặc hành xử, phát ngôn gây chia rẽ, hiểu nhầm.',
      'Hành động nhất quán với lời nói và tuân thủ đúng quy định/chủ trương/quyết sách của Công ty.',
      'Có bảo vệ lẽ phải và những ai lên tiếng cho lẽ phải.',
      'Đáp ứng đầy đủ các hành vi chuẩn mực và có lên tiếng/bảo vệ cho lẽ phải, khéo léo trong việc giữ hòa khí, tinh thần đoàn kết nội bộ.'),
    evidenceExamples: 'Ghi nhận từ đồng nghiệp/quản lý, tình huống cụ thể.',
    meetsExpectation: 'Từ mức 3: nhất quán, tuân thủ.', needsImprovement: 'Mức 1–2: thiếu trung thực, thoái thác.',
  },
  kbi_hieuqua: {
    code: 'GTCL-05', name: 'Hiệu quả', order: 5, definition: 'Đạt các mục tiêu công việc theo kế hoạch theo cách tối ưu các nguồn lực.',
    behaviors: 'Làm việc hướng đích; phối hợp chủ động; tối ưu nguồn lực.',
    levels: lv('Làm việc thiếu/không rõ mục tiêu; kế hoạch triển khai/cách thức đo lường không rõ ràng, gây lãng phí nguồn lực.',
      'Ngại rủi ro hoặc triển khai liều lĩnh/bất chấp.',
      'Thực hiện công việc có tính hướng đích và bám sát mục tiêu Công ty.',
      'Chủ động phối hợp công việc, suy xét và tìm giải pháp tối ưu cho vướng mắc phát sinh; kết quả công việc đạt mục tiêu đề ra.',
      'Đáp ứng đầy đủ các hành vi chuẩn mực và công việc phụ trách hoàn thành vượt tiến độ/vượt kỳ vọng về mục tiêu với nguồn lực tối ưu.'),
    evidenceExamples: 'Kết quả KPI, báo cáo nguồn lực/chi phí, phản hồi phối hợp.',
    meetsExpectation: 'Từ mức 3: hướng đích, bám mục tiêu.', needsImprovement: 'Mức 1–2: thiếu mục tiêu, lãng phí nguồn lực.',
  },
};
Object.values(kbiCatalog).forEach((v) => Object.assign(v, kbiMeta, { weight: 1 }));
// ---------------------------------------------------------------------------
// 5. Kỳ đánh giá 2025 (đã chốt & khóa), người tham gia, bản chụp tổ chức & chính sách
// ---------------------------------------------------------------------------
const config = {
  appSettings, kpiGroups, scoringPolicies, kpiAggregation: { default: kpiAggregation }, kbiPolicies, gradingBands, weightPolicies, workflowTemplates, formTemplates, permissionPolicies,
};
const P = 'P2025';
const policies = {
  scoring: clone(scoringPolicies), kpiAggregation: clone(kpiAggregation), kbi: clone(kbiPolicies.default), grading: clone(gradingBands.default),
  weight: clone(weightPolicies.default), workflow: clone(workflowTemplates.default), form: clone(formTemplates.default),
  meta: { frozenAt: T(2025, 1, 8), frozenBy: 'u_hr', source: 'config', refs: { kbi: 'default', grading: 'default', weight: 'default', workflow: 'default', form: 'default', kpiAggregation: 'default' } },
};
const EXCLUDED = { u_admin: true };
function buildPeriodUsers(filter) {
  const out = {};
  for (const [id, p] of Object.entries(userProfiles)) {
    if (EXCLUDED[id] || p.evaluationExempt || p.status !== 'active' || !filter(id)) continue;
    const chain = {};
    let cur = p.managerId, depth = 1;
    while (cur && !chain[cur] && depth < 20) { chain[cur] = depth++; cur = userProfiles[cur]?.managerId; }
    const skip = p.managerId ? userProfiles[p.managerId]?.managerId || null : null;
    out[id] = {
      name: p.name, employeeCode: p.employeeCode, title: p.title, titleGroup: p.titleGroup, unitId: p.unitId, unitName: units[p.unitId].name,
      ...(p.managerId ? { managerId: p.managerId, managerName: nameOf(p.managerId), managerTitle: userProfiles[p.managerId].title } : {}),
      ...(skip ? { skipManagerId: skip, skipManagerName: nameOf(skip), skipManagerTitle: userProfiles[skip].title } : {}),
      ...(Object.keys(chain).length ? { chain } : {}), included: true,
    };
  }
  return out;
}
const periodUsers = buildPeriodUsers((id) => JOINED[id] === 2025);
const KBI_IDS = Object.fromEntries(Object.keys(kbiCatalog).map((k) => [k, true]));
const kbiValues = Object.entries(kbiCatalog).map(([id, v]) => ({ id, name: v.name, weight: v.weight })).sort((a, b) => kbiCatalog[a.id].order - kbiCatalog[b.id].order);
const KBI_KEYS = kbiValues.map((v) => v.id);

const evaluationPeriods = {
  [P]: {
    code: 'KY-2025', name: 'Kỳ đánh giá năm 2025', year: 2025, type: 'year', startDate: '2025-01-01', endDate: '2025-12-31', status: 'locked',
    scope: { rootUnitId: 'unit_ptgd', includeAllActive: true, excludeUserIds: clone(EXCLUDED) },
    kbiValueIds: clone(KBI_IDS), kpiSetNote: 'Bộ KPI năm 2025 theo kho KPI Công ty và KPI giao TOP-DOWN từ Phó Tổng Giám đốc thường trực.',
    milestones: { assignDeadline: '2025-02-28', selfAssessDeadline: '2025-12-26', managerAssessDeadline: '2026-01-09', approvalDeadline: '2026-01-16' },
    rules: { allowReturn: true, allowEditAfterSubmit: false, enforceDeadlines: false },
    policyRefs: { kbi: 'default', grading: 'default', weight: 'default', workflow: 'default', form: 'default', kpiAggregation: 'default' },
    orgVersionId: 'ov_P2025', createdBy: 'u_hr', createdAt: T(2025, 1, 6), approvedBy: 'u_ptgd', updatedAt: T(2026, 1, 23, 16), updatedBy: 'u_hr', initializedAt: T(2025, 1, 8),
    participantCount: Object.keys(periodUsers).length, policies,
    statusLog: {
      l1: { from: 'draft', to: 'configured', by: 'u_hr', at: T(2025, 1, 7), reason: 'Hoàn tất cấu hình kỳ' },
      l2: { from: 'configured', to: 'open', by: 'u_hr', at: T(2025, 1, 8), reason: 'Mở kỳ đánh giá năm 2025 theo kế hoạch' },
      l3: { from: 'open', to: 'consolidating', by: 'u_hr', at: T(2026, 1, 12), reason: 'Kết thúc thời hạn đánh giá – tổng hợp kết quả' },
      l4: { from: 'consolidating', to: 'locked', by: 'u_hr', at: T(2026, 1, 23, 16), reason: 'Chốt và khóa kết quả đánh giá năm 2025' },
    },
  },
};
const orgVersion = {
  name: 'Cơ cấu áp dụng kỳ năm 2025', periodId: P, createdAt: T(2025, 1, 8), createdBy: 'u_hr', units: clone(units),
  reporting: Object.fromEntries(Object.entries(periodUsers).map(([uid, u]) => [uid, { unitId: u.unitId, title: u.title, ...(u.managerId ? { managerId: u.managerId } : {}), ...(u.skipManagerId ? { skipManagerId: u.skipManagerId } : {}) }])),
};

// ---------------------------------------------------------------------------
// 6. Bộ KPI 2025: giao TOP-DOWN, sub-KPI, kết quả & đánh giá
// ---------------------------------------------------------------------------
const sha = (x) => createHash('sha256').update(canonicalJSON(x)).digest('hex');
const planHash = (plan) => sha(Object.fromEntries(Object.entries(plan.items).map(([id, it]) => [id, { title: it.spec?.title, weight: it.weight, targets: it.spec?.targets || null, state: it.spec?.state, policy: it.spec?.scoring?.policyId || null }])));
const stripTs = (x) => { if (!x) return null; const c = clone(x); delete c.updatedAt; return c; };
const evalHash = (plan, ev) => sha({ items: Object.fromEntries(Object.entries(plan.items).map(([id, it]) => [id, { title: it.spec?.title, weight: it.weight, targets: it.spec?.targets || null, state: it.spec?.state }])), self: stripTs(ev.self), manager: stripTs(ev.manager), skip: stripTs(ev.skip) });
const sig = (userId, at, version, role, hash, note = '') => ({ userId, name: nameOf(userId), title: userProfiles[userId].title, at, version, role, contentHash: hash, ...(note ? { note } : {}) });

let seq = 0;
const key = (p) => `${p}${String(++seq).padStart(4, '0')}`;
const notifications = {};
const auditLogs = {};
const audit = (e) => { auditLogs[key('a25_')] = { source: 'seed', ...e }; };
const notify = (uid, n) => { (notifications[uid] ||= {})[key('n25_')] = { read: true, ...n }; };
const hist = (plan, e) => { plan.history[key('h')] = { byName: nameOf(e.by), ...e }; };

function catSpec(rec, extra = {}) {
  const id = idOf.get(rec);
  return {
    title: rec.name, groupId: rec.groupId, description: rec.description || '', measurement: rec.measurement || '', unit: rec.unit, direction: rec.direction,
    scoring: { policyId: rec.scoringPolicyId }, targets: clone(rec.targets || {}), ...(rec.levelDescriptions ? { levelDescriptions: clone(rec.levelDescriptions) } : {}),
    evidenceRequired: !!rec.evidenceRequired, evidenceNote: rec.evidenceNote || '', frequency: rec.frequency || 'year', dataSource: rec.dataSource || '',
    catalogRef: { id, code: rec.code, version: rec.version, visibility: rec.visibility },
    catalogSnapshot: { name: rec.name, code: rec.code, version: rec.version, measurement: rec.measurement || '', targets: clone(rec.targets || {}), scoringPolicyId: rec.scoringPolicyId },
    state: 'active', countInTotal: true, ...extra,
  };
}
const custom = (s) => ({ description: '', measurement: '', evidenceRequired: false, frequency: 'year', state: 'active', countInTotal: true, ...s, scoring: { policyId: s.policy }, policy: undefined });
const scale = (title, groupId, levels, extra = {}) => custom({ title, groupId, unit: 'Điểm (1-5)', direction: 'scale', policy: 'sp_scale_1_5', targets: { threshold: 3, base: 4, stretch: 5 }, levelDescriptions: levels, ...extra });
const clean = (o) => JSON.parse(JSON.stringify(o));

/**
 * Định nghĩa chỉ tiêu: [itemId, nguồn, trọng số, kết quả]
 *   nguồn = { cat: K.x, extra } | { asg: [fromUserId, fromItemId], spec, mode, min, orig } | { custom: spec } | { sub: parentItemId, spec }
 *   kết quả = { a: tự đánh giá, m?: quản lý điều chỉnh, ex?: diễn giải, ev?: minh chứng, mc?: nhận xét QL }
 */
const Y = {
  u_ptgd: {
    items: [
      ['ptgd1', { cat: K.lntt }, 15, { a: 126.5, ex: 'Lợi nhuận trước thuế năm 2025 đạt 126,5 tỷ đồng (105,4% kế hoạch).', ev: 'BCTC năm 2025 (bản trước kiểm toán) – TT Tài chính' }],
      ['ptgd2', { cat: K.dt }, 15, { a: 2085, ex: 'Doanh thu phí gốc 2.085 tỷ đồng, tăng 14% so với 2024.', ev: 'Báo cáo doanh thu tháng 12/2025' }],
      ['ptgd3', { cat: K.tuhoa }, 20, { a: 4, ex: '06/06 dự án tự động hóa vận hành nghiệm thu đúng tiến độ gốc.', ev: 'Biên bản nghiệm thu dự án RPA giai đoạn 2' }],
      ['ptgd4', { cat: K.caupcn }, 15, { a: 4, ex: '95% dự án có cấu phần công nghệ đúng tiến độ và phạm vi.' }],
      ['ptgd5', { cat: K.attt }, 10, { a: 4, ex: 'Không có sự cố mất ATTT; sẵn sàng hệ thống trọng yếu 99,1%.', ev: 'Báo cáo SLA & ATTT năm 2025' }],
      ['ptgd6', { cat: K.csat }, 10, { a: 86.2, ex: 'CSAT bình quân 4 quý: 86,2%.', ev: 'Báo cáo khảo sát khách hàng – TT DVKH' }],
      ['ptgd7', { cat: K.vipham }, 10, { a: 'pass', ex: 'Không có kết luận vi phạm tuân thủ nghiêm trọng.' }],
      ['ptgd8', { cat: K.daotao }, 5, { a: 4, ex: 'Hoàn thành 100% chuyên đề đào tạo bắt buộc dành cho lãnh đạo.' }],
    ],
    kbi: { self: [5, 4, 4, 5, 4], mgr: [5, 4, 4, 5, 4] },
    summary: ['Định hướng chiến lược rõ ràng, thúc đẩy tăng trưởng doanh thu và chuyển đổi số.', 'Tăng cường phân quyền cho các Giám đốc Trung tâm.', 'Tham gia chương trình lãnh đạo cấp cao 2026.'],
    mgrSummary: ['Hoàn thành vượt kế hoạch lợi nhuận, dẫn dắt tốt chương trình tự động hóa.', 'Cần đẩy nhanh hơn tiến độ dự án Core.', 'Ghi nhận khen thưởng hoàn thành tốt nhiệm vụ năm 2025.'],
  },
  u_gd_cntt: {
    items: [
      ['gc1', { asg: ['u_ptgd', 'ptgd1'], spec: catSpec(K.lntt) }, 10, { a: 126.5, ex: 'Theo kết quả chung toàn Công ty.' }],
      ['gc2', { asg: ['u_ptgd', 'ptgd4'], spec: catSpec(K.caupcn), mode: 'flex', min: 10, orig: 25 }, 30, { a: 4, ex: '19/20 dự án đúng tiến độ và đủ phạm vi (95%).', ev: 'Báo cáo PMO quý IV/2025' }],
      ['gc3', { asg: ['u_ptgd', 'ptgd5'], spec: catSpec(K.attt) }, 20, { a: 4, ex: 'Không có sự cố mất ATTT; sẵn sàng 99,1%; khắc phục 100% vấn đề theo kế hoạch.', ev: 'Báo cáo SLA & ATTT năm 2025' }],
      ['gc4', { cat: KP.core }, 20, { a: 4, m: 3, ex: 'Hoàn thành các mốc giai đoạn 1 đúng tiến độ gốc.', mc: 'Mốc chuyển đổi dữ liệu lùi 3 tuần so với tiến độ gốc → mức 3.' }],
      ['gc5', { cat: K.sangkien }, 10, { a: 4, ex: 'Sáng kiến chatbot hỗ trợ nội bộ giảm 30% yêu cầu helpdesk.', ev: 'Quyết định công nhận sáng kiến số 12/2025' }],
      ['gc6', { cat: K.daotao }, 10, { a: 4 }],
    ],
    kbi: { self: [4, 4, 5, 4, 4], mgr: [4, 4, 5, 4, 4] },
    summary: ['Tổ chức tốt danh mục dự án công nghệ, bảo đảm vận hành ổn định.', 'Quản trị rủi ro tiến độ của nhà thầu.', 'Bổ sung nhân sự kiến trúc dữ liệu năm 2026.'],
    mgrSummary: ['Dẫn dắt Trung tâm hoàn thành tốt các mục tiêu công nghệ.', 'Cần kiểm soát chặt tiến độ dự án Core.', 'Tiếp tục giao phụ trách chương trình chuyển đổi số 2026.'],
  },
  u_gd_tc: {
    items: [
      ['tc1', { asg: ['u_ptgd', 'ptgd1'], spec: catSpec(K.lntt) }, 20, { a: 126.5 }],
      ['tc2', { asg: ['u_ptgd', 'ptgd2'], spec: catSpec(K.dt) }, 10, { a: 2085 }],
      ['tc3', { cat: K.chiphi }, 20, { a: 98.2, ex: 'Chi phí quản lý thực hiện 98,2% ngân sách được duyệt.', ev: 'Báo cáo quản trị chi phí 2025' }],
      ['tc4', { cat: KP.audit }, 20, { a: 'pass', ex: 'Phát hành BCTC kiểm toán đúng hạn 25/03/2025.' }],
      ['tc5', { cat: K.thue }, 15, { a: 'pass', ex: 'Không phát sinh quyết định xử phạt thuế.' }],
      ['tc6', { cat: K.daotao }, 15, { a: 4 }],
    ],
    kbi: { self: [4, 5, 5, 5, 4], mgr: [4, 5, 5, 5, 4] },
    summary: ['Kiểm soát ngân sách chặt chẽ, báo cáo đúng hạn.', 'Ứng dụng phân tích dữ liệu trong dự báo dòng tiền.', 'Triển khai hệ thống quản trị ngân sách tập trung.'],
    mgrSummary: ['Hoàn thành tốt các mục tiêu tài chính.', 'Chủ động hơn trong tư vấn chiến lược tài chính.', 'Đề xuất nâng cấp hệ thống ERP 2026.'],
  },
  u_gd_banca: {
    items: [
      ['bc1', { asg: ['u_ptgd', 'ptgd2'], spec: catSpec(K.dt) }, 15, { a: 2085 }],
      ['bc2', { cat: K.banca }, 35, { a: 1236, ex: 'Doanh thu phí kênh Bancassurance 1.236 tỷ đồng (103% kế hoạch).', ev: 'Báo cáo doanh thu kênh tháng 12/2025' }],
      ['bc3', { cat: K.daily }, 20, { a: 112, ex: 'Kích hoạt 112 điểm bán mới tại 3 ngân hàng đối tác.' }],
      ['bc4', { cat: K.duytri }, 15, { a: 84.1, ex: 'Tỷ lệ duy trì năm thứ 2 đạt 84,1%.' }],
      ['bc5', { asg: ['u_ptgd', 'ptgd6'], spec: catSpec(K.csat), mode: 'flex', min: 5, orig: 10 }, 10, { a: 87 }],
      ['bc6', { cat: K.daotao }, 5, { a: 4 }],
    ],
    kbi: { self: [5, 4, 5, 4, 5], mgr: [5, 4, 5, 4, 5] },
    summary: ['Mở rộng mạng lưới đối tác, doanh thu vượt kế hoạch.', 'Nâng tỷ lệ duy trì hợp đồng.', 'Chương trình đào tạo chuyên sâu cho cán bộ ngân hàng đối tác.'],
    mgrSummary: ['Tăng trưởng kênh tốt, quan hệ đối tác bền vững.', 'Chất lượng hợp đồng (tỷ lệ duy trì) chưa đạt.', 'Xây dựng kế hoạch cải thiện tỷ lệ duy trì 2026.'],
  },
  u_gd_hr: {
    items: [
      ['hr1', { asg: ['u_ptgd', 'ptgd1'], spec: catSpec(K.lntt) }, 10, { a: 126.5 }],
      ['hr2', { cat: K.tuyendung }, 25, { a: 96, ex: 'Tuyển mới 48/50 vị trí theo kế hoạch.', ev: 'Báo cáo tuyển dụng năm 2025' }],
      ['hr3', { cat: K.nghiviec }, 20, { a: 9.4, ex: 'Tỷ lệ nghỉ việc tự nguyện 9,4%.' }],
      ['hr4', { cat: K.vhdn }, 15, { a: 4 }],
      ['hr5', { asg: ['u_ptgd', 'ptgd8'], spec: catSpec(K.daotao, { title: 'Tổ chức các chuyên đề đào tạo bắt buộc và hoạt động VHDN toàn Công ty' }), mode: 'flex', min: 10, orig: 15 }, 20, { a: 5, ex: 'Tổ chức 100% chuyên đề; 3 sáng kiến đào tạo trực tuyến được áp dụng.' }],
      ['hr6', { cat: K.sangkien }, 10, { a: 4 }],
    ],
    kbi: { self: [5, 4, 4, 5, 4], mgr: [5, 4, 5, 5, 4] },
    summary: ['Ổn định đội ngũ, triển khai khung năng lực mới.', 'Rút ngắn thời gian tuyển dụng vị trí chuyên môn cao.', 'Triển khai hệ thống HRIS mới.'],
    mgrSummary: ['Hoàn thành tốt mục tiêu nhân sự, văn hóa doanh nghiệp lan tỏa.', 'Đẩy nhanh tuyển dụng nhân sự công nghệ.', 'Tiếp tục chương trình phát triển lãnh đạo kế cận.'],
  },
  u_tb_qlda: {
    items: [
      ['qd1', { asg: ['u_gd_cntt', 'gc2'], spec: { ...catSpec(K.caupcn, { title: 'Triển khai các dự án trọng điểm của TT CNTT năm 2025 (cấu phần công nghệ)', description: 'Phân rã thành sub-KPI theo từng dự án; kết quả KPI cha lấy từ sub-KPI.' }), aggregation: { method: 'children_replace', missingChild: 'exclude' } }, mode: 'flex', min: 15, orig: 40 }, 40, {}],
      ['qd1a', { sub: 'qd1', spec: catSpec(K.d2c, { title: 'Dự án D2C – golive đúng mốc cam kết' }) }, 60, { a: 4, ex: 'Golive D2C ngày 15/09/2025, sớm 12 ngày so với cam kết.', ev: 'Biên bản golive D2C' }],
      ['qd1b', { sub: 'qd1', spec: catSpec(K.xcg) }, 40, { a: 5, ex: 'Nền tảng XCG vượt tiến độ gốc 1 tháng, mở rộng thêm giám định từ xa.', ev: 'Biên bản nghiệm thu XCG' }],
      ['qd2', { asg: ['u_gd_cntt', 'gc4'], spec: catSpec(KP.core) }, 25, { a: 4, m: 3, mc: 'Theo kết quả chung dự án Core (lùi mốc chuyển đổi dữ liệu).' }],
      ['qd3', { cat: K.sangkien }, 15, { a: 3 }],
      ['qd4', { cat: K.daotao }, 10, { a: 4 }],
      ['qd5', { cat: K.vhdn }, 10, { a: 4 }],
    ],
    kbi: { self: [5, 4, 4, 5, 4], mgr: [5, 4, 4, 5, 5] },
    summary: ['Điều phối tốt nhiều dự án song song.', 'Chuẩn hóa quy trình quản lý thay đổi.', 'Đào tạo PMP cho trưởng nhóm.'],
    mgrSummary: ['Hai dự án trọng điểm D2C và XCG đạt kết quả nổi bật.', 'Tăng cường kiểm soát chất lượng tài liệu dự án.', 'Đề xuất khen thưởng tập thể Ban QLDA.'],
  },
  u_tn_qlda: {
    items: [
      ['tn1', { asg: ['u_tb_qlda', 'qd1a'], spec: catSpec(K.d2c, { title: 'Dự án D2C – hoàn thành hạng mục công nghệ do nhóm phụ trách' }) }, 40, { a: 4, ex: 'Hoàn thành 100% hạng mục, golive đúng mốc.' }],
      ['tn2', { asg: ['u_tb_qlda', 'qd1b'], spec: catSpec(K.xcg, { title: 'Dự án XCG – phân tích yêu cầu và kiểm thử nghiệp vụ' }), mode: 'flex', min: 10, orig: 30 }, 30, { a: 4, m: 3, mc: 'Giai đoạn UAT kéo dài 2 tuần do thiếu kịch bản kiểm thử.' }],
      ['tn3', { custom: custom({ title: 'Tỷ lệ yêu cầu thay đổi (CR) được xử lý đúng SLA', groupId: 'grp_vh', unit: '%', direction: 'higher', policy: 'sp_tiered_linear', targets: { threshold: 85, base: 95, stretch: 100 }, measurement: 'Số CR xử lý đúng SLA / tổng số CR tiếp nhận.' }) }, 15, { a: 93, ex: '279/300 CR đúng SLA.' }],
      ['tn4', { cat: K.daotao }, 15, { a: 4 }],
    ],
    kbi: { self: [4, 4, 4, 4, 4], mgr: [3, 3, 3, 3, 2], neg: ['kbi_kycuong'] },
    summary: ['Hỗ trợ tốt thành viên nhóm.', 'Lập kế hoạch kiểm thử sớm hơn.', 'Khóa học quản lý chất lượng phần mềm.'],
    mgrSummary: ['Hoàn thành hạng mục dự án D2C.', 'Kỷ luật tiến độ, chuẩn bị UAT và hiệu quả phối hợp nhóm cần cải thiện rõ rệt.', 'Lập kế hoạch cải thiện hiệu suất cá nhân quý I/2026, kèm cặp bởi Trưởng ban.'],
  },
  u_nv_qlda1: {
    items: [
      ['nam1', { asg: ['u_tn_qlda', 'tn1'], spec: scale('Quản lý tiến độ các hạng mục công nghệ dự án D2C', 'grp_da', clone(K.d2c.levelDescriptions), { measurement: 'Theo kế hoạch dự án D2C đã phê duyệt.', evidenceRequired: true }) }, 40, { a: 4, ex: 'Các hạng mục đúng tiến độ gốc.', ev: 'Báo cáo tiến độ tuần dự án D2C' }],
      ['nam2', { asg: ['u_tn_qlda', 'tn3'], spec: custom({ title: 'Tỷ lệ CR được xử lý đúng SLA (phần việc phụ trách)', groupId: 'grp_vh', unit: '%', direction: 'higher', policy: 'sp_tiered_linear', targets: { threshold: 85, base: 95, stretch: 100 } }), mode: 'flex', min: 10, orig: 30 }, 30, { a: 95.5, ex: '128/134 CR đúng SLA.' }],
      ['nam3', { cat: K.daotao }, 15, { a: 4 }],
      ['nam4', { cat: K.sangkien }, 15, { a: 3, ex: 'Sáng kiến tự động hóa báo cáo tiến độ được áp dụng tại Ban.' }],
    ],
    kbi: { self: [4, 4, 3, 4, 4], mgr: [4, 4, 3, 4, 4] },
    summary: ['Bám sát tiến độ, phối hợp tốt.', 'Kỹ năng quản trị rủi ro nhà thầu.', 'Tham gia khóa PMP.'],
    mgrSummary: ['Hoàn thành tốt nhiệm vụ được giao.', 'Chủ động đề xuất cải tiến hơn.', 'Giao phụ trách thêm dự án nhỏ năm 2026.'],
  },
  u_nv_qlda2: {
    items: [
      ['mai1', { asg: ['u_tn_qlda', 'tn2'], spec: catSpec(K.xcg, { title: 'Phân tích nghiệp vụ dự án phân tích tổn thất XCG' }) }, 40, { a: 5, ex: 'Hoàn thành đặc tả trước hạn, đề xuất bổ sung giám định từ xa được phê duyệt.', ev: 'Tài liệu BRD XCG v2.0' }],
      ['mai2', { custom: custom({ title: 'Số lỗi đặc tả yêu cầu bị trả lại trong năm', groupId: 'grp_cl', unit: 'Lỗi', direction: 'lower', policy: 'sp_tiered_lower', targets: { threshold: 6, base: 3, stretch: 1 }, measurement: 'Số tài liệu đặc tả bị đơn vị phát triển trả lại do thiếu/sai yêu cầu.' }) }, 30, { a: 1, ex: 'Chỉ 1 tài liệu bị trả lại trong năm.' }],
      ['mai3', { cat: K.daotao }, 15, { a: 4 }],
      ['mai4', { cat: K.vhdn }, 15, { a: 5, ex: 'Đủ 5 dấu xác nhận và 3 lần đạt top 3 hoạt động VHDN.' }],
    ],
    kbi: { self: [5, 4, 5, 4, 5], mgr: [5, 4, 5, 5, 5] },
    summary: ['Chất lượng tài liệu phân tích cao, chủ động đề xuất.', 'Mở rộng hiểu biết kỹ thuật.', 'Đào tạo phân tích dữ liệu.'],
    mgrSummary: ['Kết quả nổi bật, đóng góp lớn cho dự án XCG.', 'Chia sẻ kinh nghiệm cho đồng nghiệp.', 'Đề xuất khen thưởng cá nhân xuất sắc 2025.'],
  },
  u_tb_ptht: {
    items: [
      ['pt1', { asg: ['u_gd_cntt', 'gc2'], spec: catSpec(K.caupcn, { title: 'Hoàn thành cấu phần phát triển của các dự án kinh doanh' }), mode: 'flex', min: 15, orig: 40 }, 40, { a: 4 }],
      ['pt2', { cat: K.incident }, 20, { a: 1, ex: '1 sự cố P1 (tháng 7), khắc phục trong 2 giờ.' }],
      ['pt3', { asg: ['u_gd_cntt', 'gc4'], spec: catSpec(KP.core) }, 25, { a: 4, m: 3, mc: 'Theo kết quả chung dự án Core.' }],
      ['pt4', { cat: K.daotao }, 15, { a: 4 }],
    ],
    kbi: { self: [4, 4, 4, 4, 4], mgr: [4, 4, 4, 4, 4] },
    summary: ['Đội ngũ phát triển ổn định, chất lượng tốt.', 'Tự động hóa kiểm thử.', 'Tuyển thêm kỹ sư kiểm thử.'],
    mgrSummary: ['Hoàn thành nhiệm vụ.', 'Nâng cao tỷ lệ kiểm thử tự động.', 'Bổ sung 01 kỹ sư kiểm thử năm 2026.'],
  },
  u_nv_ptht: {
    items: [
      ['huy1', { asg: ['u_tb_ptht', 'pt1'], spec: custom({ title: 'Tỷ lệ hoàn thành user story theo sprint', groupId: 'grp_cntt', unit: '%', direction: 'higher', policy: 'sp_tiered_linear', targets: { threshold: 80, base: 90, stretch: 100 }, measurement: 'Story points hoàn thành / cam kết, bình quân các sprint.' }) }, 35, { a: 94, m: 92, ex: 'Bình quân 94% trong 24 sprint.', mc: 'Điều chỉnh theo số liệu chốt của PMO.' }],
      ['huy2', { asg: ['u_tb_ptht', 'pt2'], spec: custom({ title: 'Số lỗi nghiêm trọng phát sinh sau golive', groupId: 'grp_cl', unit: 'Lỗi', direction: 'lower', policy: 'sp_tiered_lower', targets: { threshold: 5, base: 2, stretch: 0 } }), mode: 'flex', min: 10, orig: 25 }, 25, { a: 1 }],
      ['huy3', { cat: K.milestone }, 25, { a: 100, m: 95, mc: '01 hạng mục chuyển sang tháng 1/2026.' }],
      ['huy4', { cat: K.daotao }, 15, { a: 4 }],
    ],
    kbi: { self: [4, 4, 5, 4, 4], mgr: [4, 4, 4, 4, 4] },
    summary: ['Chất lượng code tốt, hỗ trợ đồng nghiệp.', 'Tài liệu kỹ thuật đầy đủ hơn.', 'Đào tạo kiến trúc microservices.'],
    mgrSummary: ['Hoàn thành tốt nhiệm vụ.', 'Chủ động hơn trong ước lượng công việc.', 'Tham gia nhóm kiến trúc hệ thống 2026.'],
  },
  u_tb_hatang: {
    items: [
      ['ht1', { asg: ['u_gd_cntt', 'gc3'], spec: catSpec(K.attt, { title: 'Hệ thống CNTT hoạt động an toàn, ổn định (hạ tầng & ATTT)' }) }, 40, { a: 4, ev: 'Báo cáo SLA & ATTT năm 2025' }],
      ['ht2', { cat: K.sla }, 30, { a: 99.2, ex: 'Sẵn sàng bình quân 99,2%.' }],
      ['ht3', { cat: K.incident }, 15, { a: 2 }],
      ['ht4', { cat: K.daotao }, 15, { a: 4 }],
    ],
    kbi: { self: [4, 5, 5, 4, 5], mgr: [4, 5, 5, 4, 5] },
    summary: ['Hạ tầng ổn định, không sự cố ATTT.', 'Tối ưu chi phí hạ tầng đám mây.', 'Chứng chỉ ISO 27001 cho hệ thống lõi.'],
    mgrSummary: ['Bảo đảm an toàn, ổn định hệ thống.', 'Chủ động hơn trong cảnh báo sớm.', 'Triển khai SOC 24/7 năm 2026.'],
  },
  u_nv_ht: {
    items: [
      ['qn1', { asg: ['u_tb_hatang', 'ht2'], spec: catSpec(K.sla, { title: 'Tỷ lệ sẵn sàng các hệ thống hạ tầng phụ trách' }) }, 40, { a: 99.4 }],
      ['qn2', { custom: custom({ title: 'Tỷ lệ lỗ hổng bảo mật mức cao được khắc phục đúng hạn', groupId: 'grp_cntt', unit: '%', direction: 'higher', policy: 'sp_tiered_linear', targets: { threshold: 80, base: 95, stretch: 100 }, measurement: 'Số lỗ hổng High/Critical khắc phục đúng hạn / tổng số phát hiện.' }) }, 30, { a: 96 }],
      ['qn3', { cat: K.daotao }, 15, { a: 3, ex: 'Hoàn thành 85% chuyên đề do trực sự cố.' }],
      ['qn4', { cat: K.sangkien }, 15, { a: 4, ex: 'Script tự động kiểm tra cấu hình tường lửa.' }],
    ],
    kbi: { self: [4, 4, 4, 4, 4], mgr: [4, 4, 3, 4, 4] },
    summary: ['Phản ứng sự cố nhanh.', 'Cân đối thời gian đào tạo.', 'Chứng chỉ CCNP Security.'],
    mgrSummary: ['Hoàn thành tốt công việc vận hành.', 'Tham gia đầy đủ các chuyên đề đào tạo.', 'Hỗ trợ chi phí thi chứng chỉ 2026.'],
  },
  u_tb_vh: {
    items: [
      ['vh1', { cat: K.dulieu }, 35, { a: 98.6, ex: 'Tỷ lệ dữ liệu đạt chuẩn 98,6% (kiểm tra hàng tháng).' }],
      ['vh2', { cat: K.baocao }, 30, { a: 97 }],
      ['vh3', { asg: ['u_gd_cntt', 'gc4'], spec: catSpec(KP.core, { title: 'Chuyển đổi dữ liệu dự án Core – giai đoạn 1' }) }, 20, { a: 3, ex: 'Mốc chuyển đổi dữ liệu lùi 3 tuần.' }],
      ['vh4', { cat: K.daotao }, 15, { a: 4 }],
    ],
    kbi: { self: [4, 4, 4, 4, 4], mgr: [4, 4, 4, 4, 3] },
    summary: ['Chuẩn hóa từ điển dữ liệu.', 'Tiến độ chuyển đổi dữ liệu.', 'Bổ sung 01 chuyên viên quản trị dữ liệu.'],
    mgrSummary: ['Chất lượng dữ liệu tốt.', 'Rủi ro tiến độ chuyển đổi dữ liệu cần cảnh báo sớm hơn.', 'Tuyển bổ sung nhân sự năm 2026.'],
  },
  u_tp_kt: {
    items: [
      ['kt1', { asg: ['u_gd_tc', 'tc4'], spec: catSpec(KP.audit) }, 30, { a: 'pass' }],
      ['kt2', { asg: ['u_gd_tc', 'tc3'], spec: catSpec(K.chiphi), mode: 'flex', min: 10, orig: 25 }, 25, { a: 97.5 }],
      ['kt3', { asg: ['u_gd_tc', 'tc5'], spec: catSpec(K.thue) }, 20, { a: 'pass' }],
      ['kt4', { cat: K.vipham }, 15, { a: 'pass' }],
      ['kt5', { cat: K.daotao }, 10, { a: 4 }],
    ],
    kbi: { self: [4, 5, 4, 5, 4], mgr: [4, 5, 4, 5, 4] },
    summary: ['Báo cáo đúng hạn, chính xác.', 'Ứng dụng tự động hóa đối chiếu.', 'Đào tạo IFRS 17.'],
    mgrSummary: ['Hoàn thành tốt nhiệm vụ kế toán.', 'Chủ động chuẩn bị chuyển đổi IFRS 17.', 'Giao chủ trì dự án IFRS 17 năm 2026.'],
  },
  u_nv_kt: {
    items: [
      ['hg1', { asg: ['u_tp_kt', 'kt1'], spec: custom({ title: 'Khóa sổ kế toán tháng đúng hạn (số kỳ trễ hạn)', groupId: 'grp_vh', unit: 'Kỳ trễ', direction: 'lower', policy: 'sp_tiered_lower', targets: { threshold: 3, base: 1, stretch: 0 }, measurement: 'Số tháng khóa sổ sau ngày làm việc thứ 5 của tháng kế tiếp.' }) }, 40, { a: 0, ex: 'Không có kỳ trễ hạn.' }],
      ['hg2', { asg: ['u_tp_kt', 'kt3'], spec: catSpec(K.thue, { title: 'Hồ sơ kê khai thuế nộp đúng hạn' }) }, 25, { a: 'pass' }],
      ['hg3', { cat: K.daotao }, 15, { a: 5, ex: 'Áp dụng kiến thức IFRS 17 vào cải tiến mẫu báo cáo.' }],
      ['hg4', { cat: K.sangkien }, 20, { a: 4 }],
    ],
    kbi: { self: [5, 5, 4, 5, 5], mgr: [5, 5, 4, 5, 4] },
    summary: ['Cẩn thận, đúng hạn.', 'Hiểu biết nghiệp vụ bảo hiểm.', 'Đào tạo IFRS 17 chuyên sâu.'],
    mgrSummary: ['Chuyên môn vững, kỷ luật cao.', 'Chủ động đề xuất cải tiến quy trình.', 'Xem xét quy hoạch kế toán tổng hợp chính.'],
  },
  u_tp_banca: {
    items: [
      ['tb1', { asg: ['u_gd_banca', 'bc2'], spec: catSpec(K.banca, { title: 'Doanh thu phí Bancassurance các đối tác do Ban phụ trách', targets: { threshold: 720, base: 900, stretch: 1080 } }) }, 45, { a: 940, ex: 'Doanh thu 940 tỷ đồng (104% kế hoạch Ban).' }],
      ['tb2', { asg: ['u_gd_banca', 'bc3'], spec: catSpec(K.daily, { targets: { threshold: 60, base: 75, stretch: 90 } }), mode: 'flex', min: 15, orig: 25 }, 25, { a: 82 }],
      ['tb3', { asg: ['u_gd_banca', 'bc4'], spec: catSpec(K.duytri) }, 15, { a: 84.1 }],
      ['tb4', { cat: K.daotao }, 15, { a: 4 }],
    ],
    kbi: { self: [5, 4, 4, 4, 5], mgr: [5, 4, 4, 4, 4] },
    summary: ['Vượt kế hoạch doanh thu.', 'Chất lượng hợp đồng.', 'Thêm 02 chuyên viên hỗ trợ kinh doanh.'],
    mgrSummary: ['Hoàn thành tốt chỉ tiêu kinh doanh.', 'Cải thiện tỷ lệ duy trì.', 'Bổ sung nhân sự hỗ trợ kinh doanh 2026.'],
  },
  u_nv_banca: {
    items: [
      ['yn1', { asg: ['u_tp_banca', 'tb2'], spec: catSpec(K.daily, { title: 'Số điểm bán mới được kích hoạt (địa bàn phụ trách)', targets: { threshold: 24, base: 30, stretch: 36 } }) }, 40, { a: 31 }],
      ['yn2', { custom: custom({ title: 'Số buổi đào tạo sản phẩm cho đối tác ngân hàng', groupId: 'grp_kd', unit: 'Buổi', direction: 'higher', policy: 'sp_tiered_linear', targets: { threshold: 16, base: 20, stretch: 24 } }) }, 25, { a: 22 }],
      ['yn3', { cat: K.csat }, 20, { a: 82, ex: 'CSAT đối tác 82%.' }],
      ['yn4', { cat: K.daotao }, 15, { a: 4 }],
    ],
    kbi: { self: [4, 4, 4, 4, 4], mgr: [3, 2, 3, 3, 3] },
    summary: ['Quan hệ tốt với đối tác.', 'Chăm sóc sau bán hàng.', 'Khóa kỹ năng đàm phán.'],
    mgrSummary: ['Hoàn thành chỉ tiêu số lượng điểm bán.', 'Nhiều lần chậm báo cáo, chưa tuân thủ quy trình chăm sóc đối tác; cần cải thiện tác phong kỷ cương.', 'Kế hoạch cải thiện hiệu suất 6 tháng đầu năm 2026.'],
  },
  u_hr: {
    items: [
      ['lh1', { custom: custom({ title: 'Hoàn thành chu kỳ đánh giá KPI/KBI năm theo kế hoạch', groupId: 'grp_ns', unit: '% hoàn thành', direction: 'higher', policy: 'sp_milestone', targets: { base: 100 }, measurement: '% mốc chu kỳ đánh giá hoàn thành đúng hạn.' }) }, 40, { a: 100 }],
      ['lh2', { asg: ['u_gd_hr', 'hr3'], spec: custom({ title: 'Tỷ lệ chi trả lương, thưởng chính xác và đúng hạn', groupId: 'grp_ns', unit: '%', direction: 'higher', policy: 'sp_tiered_linear', targets: { threshold: 98, base: 99.5, stretch: 100 } }) }, 30, { a: 99.8 }],
      ['lh3', { cat: K.vhdn }, 15, { a: 4 }],
      ['lh4', { cat: K.daotao }, 15, { a: 4 }],
    ],
    kbi: { self: [4, 5, 4, 5, 4], mgr: [4, 5, 4, 5, 4] },
    summary: ['Vận hành C&B chính xác, đúng hạn.', 'Phân tích dữ liệu nhân sự.', 'Chứng chỉ C&B chuyên sâu.'],
    mgrSummary: ['Hoàn thành tốt chu kỳ đánh giá và chi trả.', 'Chủ động phân tích, đề xuất chính sách.', 'Giao phụ trách hệ thống KPI trực tuyến 2026.'],
  },
  u_tp_hrbp: {
    items: [
      ['hb1', { asg: ['u_gd_hr', 'hr2'], spec: catSpec(K.tuyendung) }, 40, { a: 96 }],
      ['hb2', { asg: ['u_gd_hr', 'hr3'], spec: catSpec(K.nghiviec), mode: 'flex', min: 10, orig: 25 }, 25, { a: 9.4 }],
      ['hb3', { cat: K.tgtd }, 20, { a: 33, ex: 'Thời gian tuyển dụng bình quân 33 ngày.' }],
      ['hb4', { cat: K.daotao }, 15, { a: 4 }],
    ],
    kbi: { self: [4, 4, 4, 4, 5], mgr: [4, 4, 4, 4, 4] },
    summary: ['Đáp ứng nhu cầu tuyển dụng.', 'Thương hiệu tuyển dụng.', 'Bổ sung 01 chuyên viên tuyển dụng.'],
    mgrSummary: ['Hoàn thành tốt nhiệm vụ.', 'Xây dựng nguồn ứng viên công nghệ.', 'Tuyển 01 chuyên viên tuyển dụng năm 2026.'],
  },
};

const plans = { [P]: {} };
const assignments = { [P]: {} };
const evaluations = { [P]: {} };
const ORDER = Object.keys(Y);
const missingP = Object.keys(periodUsers).filter((u) => !Y[u]);
const extraP = ORDER.filter((u) => !periodUsers[u]);
if (missingP.length || extraP.length) throw new Error(`Danh sách 2025 lệch: thiếu ${missingP} / thừa ${extraP}`);

// Mốc thời gian theo cấp (giao TOP-DOWN từ trên xuống)
const LEVEL = (uid) => Object.keys(periodUsers[uid].chain || {}).length; // 0 = PTGĐ
const dPlan = (uid) => 12 + LEVEL(uid) * 6; // ngày tháng 1–2/2025

let asSeq = 0;
for (const uid of [...ORDER].sort((a, b) => LEVEL(a) - LEVEL(b))) {
  const def = Y[uid];
  const pu = periodUsers[uid];
  const lv = LEVEL(uid);
  const d0 = dPlan(uid);
  const at = (dd, h = 9) => T(2025, 1 + Math.floor((d0 + dd - 1) / 31), ((d0 + dd - 1) % 31) + 1, h);
  const plan = { status: 'approved', version: 1, meta: { createdAt: at(0), createdBy: uid, unitId: userProfiles[uid].unitId }, items: {}, history: {} };
  let order = 0;
  for (const [itemId, src, weight] of def.items) {
    let spec;
    if (src.cat) spec = catSpec(src.cat, { source: 'catalog', ...(src.extra || {}) });
    else if (src.custom) spec = { ...src.custom, source: 'custom' };
    else if (src.sub) spec = { ...src.spec, source: 'sub', parentItemId: src.sub };
    else if (src.asg) {
      const [fromId, fromItem] = src.asg;
      if (!plans[P][fromId]?.items[fromItem]) throw new Error(`KPI nguồn không tồn tại: ${fromId}/${fromItem}`);
      if (pu.chain?.[fromId] === undefined) throw new Error(`${fromId} không phải cấp trên của ${uid}`);
      const aid = `as25_${String(++asSeq).padStart(3, '0')}`;
      const orig = src.orig ?? weight;
      const parentRef = { userId: fromId, itemId: fromItem, title: plans[P][fromId].items[fromItem].spec.title };
      spec = {
        ...clone(src.spec), source: 'assigned', assignmentId: aid, assignedBy: fromId, assignedByName: nameOf(fromId), assignedAt: at(-2),
        weightMode: src.mode || 'fixed', originalWeight: orig, ...(src.mode === 'flex' ? { minWeight: src.min } : {}), parentRef,
      };
      delete spec.parentItemId;
      assignments[P][fromId] ||= {};
      assignments[P][fromId][aid] = clean({
        fromId, fromName: nameOf(fromId), toId: uid, toName: nameOf(uid), status: 'accepted', itemId, spec, weight: orig, weightMode: spec.weightMode,
        ...(src.mode === 'flex' ? { minWeight: src.min } : {}), sourceItemRef: parentRef, createdAt: at(-3), assignedAt: at(-2),
        response: { status: 'accepted', by: uid, at: at(-1) },
      });
      hist(plan, { action: 'assign', itemId, after: { title: spec.title, weight: orig, weightMode: spec.weightMode, minWeight: src.mode === 'flex' ? src.min : null }, by: fromId, at: at(-2) });
      hist(plan, { action: 'ack_accept', itemId, after: { status: 'accepted' }, by: uid, at: at(-1) });
      if (orig !== weight) hist(plan, { action: 'weight_change', itemId, before: { weight: orig }, after: { weight }, reason: 'Điều chỉnh trọng số trong phạm vi cho phép (chế độ B) theo trọng tâm công việc năm 2025.', by: uid, at: at(0, 14) });
    }
    plan.items[itemId] = clean({
      spec: { order: ++order, createdAt: at(src.asg ? -2 : 0), createdBy: src.asg ? src.asg[0] : uid, ...spec },
      weight,
      ...(src.asg ? { ack: { status: 'accepted', by: uid, at: at(-1) } } : {}),
      meta: { updatedAt: at(0, 14), updatedBy: uid },
    });
  }
  // Kiểm tra bộ KPI theo chính sách trọng số
  const top = Object.values(plan.items).filter((i) => !i.spec.parentItemId);
  const total = top.reduce((s, i) => s + i.weight, 0);
  if (Math.abs(total - 100) > 0.001) throw new Error(`${uid}: tổng trọng số ${total}%`);
  for (const i of top) if (i.weight < weightPolicies.default.minItemWeight || i.weight > weightPolicies.default.maxItemWeight) throw new Error(`${uid}: trọng số ngoài giới hạn ${i.spec.title}`);
  for (const parent of top.filter((p) => p.spec.aggregation)) {
    const kids = Object.values(plan.items).filter((c) => c.spec.parentItemId && plan.items[c.spec.parentItemId] === parent);
    if (Math.abs(kids.reduce((s, k) => s + k.weight, 0) - 100) > 0.001) throw new Error(`${uid}: tỷ lệ sub-KPI ≠ 100%`);
  }
  // Trình & phê duyệt kế hoạch
  const ph = planHash(plan);
  const approver = pu.managerId || 'u_hr';
  plan.signatures = {
    employee: sig(uid, at(1), 1, 'employee', ph),
    manager: sig(approver, at(2), 1, 'manager', ph, pu.managerId ? '' : 'Phê duyệt cấp cao nhất trong phạm vi hệ thống'),
    ...(pu.skipManagerId ? { skip: sig(pu.skipManagerId, at(3), 1, 'skip', ph) } : {}),
  };
  hist(plan, { action: 'plan_submit', after: { status: 'submitted', version: 1 }, by: uid, at: at(1) });
  hist(plan, { action: 'plan_approve_manager', before: { status: 'submitted' }, after: { status: pu.skipManagerId ? 'manager_approved' : 'approved' }, by: approver, at: at(2) });
  if (pu.skipManagerId) hist(plan, { action: 'plan_approve_skip', before: { status: 'manager_approved' }, after: { status: 'approved' }, by: pu.skipManagerId, at: at(3) });
  plan.statusMeta = { by: pu.skipManagerId || approver, at: at(pu.skipManagerId ? 3 : 2), note: 'Phê duyệt kế hoạch' };
  plans[P][uid] = plan;
}

// --- Hồ sơ đánh giá (tự đánh giá → QL trực tiếp → QL trên 1 cấp → HR khóa)
const KBI_EX = {
  kbi_khatvong: 'Chủ động nhận thêm mục tiêu thách thức trong năm.', kbi_kycuong: 'Hoàn thành công việc đúng thời hạn, tuân thủ quy trình.',
  kbi_sangtao: 'Đề xuất cải tiến trong phạm vi công việc.', kbi_chinhtruc: 'Báo cáo trung thực, minh bạch về tiến độ và rủi ro.', kbi_hieuqua: 'Tối ưu nguồn lực để đạt mục tiêu.',
};
const grades = {};
let evIndex = 0;
for (const uid of ORDER) {
  const def = Y[uid];
  const pu = periodUsers[uid];
  const plan = plans[P][uid];
  const base = 8 + (evIndex++ % 10); // 8–17/12/2025
  const dt = (d, h = 10) => (d <= 31 ? T(2025, 12, d, h) : T(2026, 1, d - 31, h));
  const selfKpi = {}, mgrKpi = {};
  for (const [itemId, , , r] of def.items) {
    if (r.a === undefined) continue;
    selfKpi[itemId] = clean({ actual: r.a, explanation: r.ex || 'Theo số liệu tổng hợp cuối năm 2025.', evidence: r.ev || (plan.items[itemId].spec.evidenceRequired ? 'Báo cáo tổng hợp năm 2025 đính kèm hồ sơ' : undefined) });
    if (r.m !== undefined) mgrKpi[itemId] = clean({ actual: r.m, comment: r.mc || 'Điều chỉnh theo số liệu đối chiếu.' });
  }
  const neg = new Set(def.kbi.neg || []);
  const ev = {
    status: 'locked', version: 1, meta: { createdAt: dt(base - 6), createdBy: uid },
    self: {
      kpi: selfKpi,
      kbi: Object.fromEntries(KBI_KEYS.map((k, i) => [k, { level: def.kbi.self[i], examples: KBI_EX[k] }])),
      summary: { strengths: def.summary[0], improvements: def.summary[1], proposals: def.summary[2] },
      updatedAt: dt(base),
    },
    manager: {
      kpi: mgrKpi,
      kbi: Object.fromEntries(KBI_KEYS.map((k, i) => [k, clean({
        level: neg.has(k) ? 4 : def.kbi.mgr[i],
        ...(neg.has(k) ? { negativeBehavior: true, comment: 'Đạt mức 4 nhưng có biểu hiện hành vi mức 2 (trễ hạn UAT) → tối đa mức 3.' } : def.kbi.mgr[i] !== def.kbi.self[i] ? { comment: def.kbi.mgr[i] > def.kbi.self[i] ? 'Ghi nhận đóng góp vượt mức tự đánh giá.' : 'Chưa có minh chứng đủ cho mức tự đánh giá.' } : {}),
      })])),
      summary: { strengths: def.mgrSummary[0], improvements: def.mgrSummary[1], proposals: def.mgrSummary[2] },
      updatedAt: dt(base + 10),
    },
    ...(pu.skipManagerId ? { skip: { comment: 'Đồng ý với kết quả đánh giá của quản lý trực tiếp.', updatedAt: dt(base + 16) } } : {}),
    history: {},
  };
  if (neg.size) for (const k of neg) ev.manager.kbi[k].level = 4; // mức chọn 4, quy tắc giới hạn đưa về 3
  const h = evalHash(plan, ev);
  const approver = pu.managerId || 'u_hr';
  ev.signatures = {
    employee: sig(uid, dt(base), 1, 'employee', h),
    manager: sig(approver, dt(base + 10), 1, 'manager', h, pu.managerId ? '' : 'Phê duyệt cấp cao nhất trong phạm vi hệ thống'),
    ...(pu.skipManagerId ? { skip: sig(pu.skipManagerId, dt(base + 16), 1, 'skip', h) } : {}),
  };
  const hh = (e) => { ev.history[key('h')] = { byName: nameOf(e.by), ...e }; };
  hh({ action: 'eval_submit', before: { status: 'draft' }, after: { status: 'submitted', version: 1 }, by: uid, at: dt(base) });
  hh({ action: 'eval_manager_confirm', before: { status: 'submitted' }, after: { status: pu.skipManagerId ? 'manager_reviewed' : 'approved' }, by: approver, at: dt(base + 10) });
  if (pu.skipManagerId) hh({ action: 'eval_approve', before: { status: 'manager_reviewed' }, after: { status: 'approved' }, by: pu.skipManagerId, at: dt(base + 16) });
  const lockAt = T(2026, 1, 22, 15);
  hh({ action: 'eval_lock', before: { status: 'approved' }, after: { status: 'locked' }, by: 'u_hr', at: lockAt });
  ev.statusMeta = { by: 'u_hr', at: lockAt, note: 'Khóa kết quả' };
  const r = computeEvaluation({ plan, evaluation: ev, policies, kbiValues });
  if (r.grade.status !== 'official' || !r.kpi.complete || !r.kbi.complete) throw new Error(`${uid}: chưa đủ điều kiện xếp loại chính thức – ${JSON.stringify(r.grade)}`);
  ev.final = {
    kpiScore: r.kpi.total, kpiPercent: Math.round(r.kpi.total * 10000) / 100, kbiScore: r.kbi.average, gradeCode: r.grade.code, gradeLabel: r.grade.label,
    gradeStatus: r.grade.status, weightTotal: r.kpi.totalWeight, computedAt: dt(base + (pu.skipManagerId ? 16 : 10)), computedBy: pu.skipManagerId || approver, version: 1,
    policyVersion: { grading: policies.grading.version, kbi: policies.kbi.version, kpiAggregation: policies.kpiAggregation.version },
  };
  evaluations[P][uid] = ev;
  grades[uid] = `${ev.final.kpiPercent}% | KBI ${ev.final.kbiScore} | ${ev.final.gradeLabel}`;
  notify(uid, { type: 'evaluation_locked', title: 'Kết quả đánh giá năm 2025 đã được khóa', message: `Kết quả chính thức: ${ev.final.gradeLabel} (KPI ${ev.final.kpiPercent}%, KBI ${ev.final.kbiScore}).`, link: `#/eval/form/${P}/${uid}`, fromId: 'u_hr', fromName: nameOf('u_hr'), at: lockAt });
}

// ---------------------------------------------------------------------------
// 7. Nhật ký kiểm toán & hệ thống
// ---------------------------------------------------------------------------
const actor = (id) => ({ actorId: id, actorName: nameOf(id) });
audit({ type: 'seed', entity: 'system', entityId: 'opes-kpi-data', ...actor('u_admin'), at: T(2024, 12, 20), reason: 'Khởi tạo cấu hình hệ thống KPI & KBI' });
audit({ type: 'period_create', entity: 'period', entityId: P, periodId: P, ...actor('u_hr'), at: T(2025, 1, 6), after: { name: 'Kỳ đánh giá năm 2025', status: 'draft' } });
audit({ type: 'period_init_participants', entity: 'period', entityId: P, periodId: P, ...actor('u_hr'), at: T(2025, 1, 8), after: { count: Object.keys(periodUsers).length } });
audit({ type: 'period_status', entity: 'period', entityId: P, periodId: P, ...actor('u_hr'), at: T(2025, 1, 8), before: { status: 'configured' }, after: { status: 'open' }, reason: 'Mở kỳ đánh giá năm 2025 theo kế hoạch' });
for (const [fromId, list] of Object.entries(assignments[P])) {
  const a = Object.values(list);
  audit({ type: 'kpi_assign', entity: 'kpiAssignment', entityId: Object.keys(list).join(','), periodId: P, ...actor(fromId), at: a[0].assignedAt, after: { recipients: [...new Set(a.map((x) => x.toId))].length, items: a.length } });
}
audit({ type: 'period_status', entity: 'period', entityId: P, periodId: P, ...actor('u_hr'), at: T(2026, 1, 12), before: { status: 'open' }, after: { status: 'consolidating' }, reason: 'Kết thúc thời hạn đánh giá – tổng hợp kết quả' });
audit({ type: 'eval_lock', entity: 'evaluation', entityId: ORDER.join(','), periodId: P, ...actor('u_hr'), at: T(2026, 1, 22, 15), after: { count: ORDER.length } });
audit({ type: 'period_status', entity: 'period', entityId: P, periodId: P, ...actor('u_hr'), at: T(2026, 1, 23, 16), before: { status: 'consolidating' }, after: { status: 'locked' }, reason: 'Chốt và khóa kết quả đánh giá năm 2025' });

const data = {
  system: { initializedAt: T(2024, 12, 20), schemaVersion: 1, seedInfo: { version: 'opes-2025.1', generatedAt: Date.UTC(2026, 9, 22), note: 'Cấu hình vận hành + dữ liệu kỳ 2025 đã khóa (tên nhân sự giả lập). Kỳ 2026 chưa tạo.' } },
  public: { demoEnabled: true, branding: { appName: appSettings.appName, companyName: appSettings.companyName }, demoLoginOptions },
  emailIndex, userProfiles, userAccess, config,
  organizationUnits: units,
  organizationVersions: { ov_P2025: orgVersion },
  kpiCatalogPublic, kpiCatalogPrivate, kpiCatalogAccessIndex, kbiCatalog,
  evaluationPeriods,
  evaluationPeriodUsers: { [P]: periodUsers },
  kpiPlans: plans, kpiAssignments: assignments, evaluations,
  notifications, auditLogs,
};

writeFileSync(OUT, JSON.stringify(data, null, 2) + '\n');
const count = (o) => Object.keys(o || {}).length;
console.log(`Đã ghi ${OUT}`);
console.log(`  hồ sơ nhân sự=${count(userProfiles)} (tham gia đánh giá=${Object.values(userProfiles).filter((p) => !p.evaluationExempt).length}) đơn vị=${count(units)} KPI public=${count(kpiCatalogPublic)} private=${count(kpiCatalogPrivate)} KBI=${count(kbiCatalog)}`);
console.log(`  kỳ 2025: người tham gia=${count(periodUsers)} kế hoạch=${count(plans[P])} hồ sơ=${count(evaluations[P])} lần giao KPI=${Object.values(assignments[P]).reduce((s, x) => s + count(x), 0)}`);
const dist = {};
Object.values(evaluations[P]).forEach((e) => { dist[e.final.gradeLabel] = (dist[e.final.gradeLabel] || 0) + 1; });
console.log('  phân bố xếp loại:', dist);
for (const [u, g] of Object.entries(grades)) console.log(`   ${u.padEnd(12)} ${g}`);
