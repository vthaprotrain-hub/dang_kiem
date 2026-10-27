#!/usr/bin/env node
/**
 * Sinh bộ dữ liệu POC js/seed/demo-data.json (cấu trúc Firebase Realtime Database).
 *
 *   node tools/generate-demo-data.mjs
 *
 * Toàn bộ tên người là tên giả lập. Các chỉ tiêu, ngưỡng, tỷ trọng và bảng xếp loại là
 * "Cấu hình demo – cần HR xác nhận" (isDemo: true) – không phải quy định chính thức của OPES.
 * Kết quả cuối kỳ của các hồ sơ đã duyệt được tính bằng chính js/core/scoring.js để nhất quán.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { computeEvaluation } from '../js/core/scoring.js';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '..', 'js', 'seed', 'demo-data.json');
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
  updatedAt: T(2026, 1, 5),
  updatedBy: 'u_admin',
  note: 'Ma trận quyền demo. Quyền thao tác theo quan hệ (quản lý trực tiếp, chuỗi quản lý) được Database Rules kiểm tra thêm.',
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
  defaultPeriodId: 'P2026',
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
].map(([id, name], i) => [id, { name, order: i + 1, status: 'active', description: '', updatedAt: T(2026, 1, 5) }]));

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
    name: 'Chính sách KBI demo', officialSource: 'manager', selfWeight: 0, managerWeight: 1, aggregate: 'mean', decimals: 2, roundingMode: 'round',
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
    name: 'Chính sách trọng số demo', totalRequired: 100, tolerance: 0.01, minItemWeight: 5, maxItemWeight: 50,
    defaultMode: 'fixed', allowFlex: true, flexMinWeight: 5, flexMaxWeight: null, requireReapprovalOnFlexChange: true,
    groupConstraints: { grp_tc: { min: 10, max: 30, note: 'Nhóm Tài chính chiếm 10–30% (demo)' } },
    isDemo: true, version: 1,
    note: 'X% (trọng số tối thiểu khi cho phép cấp dưới điều chỉnh) mặc định 5% – người giao có thể đặt cao hơn cho từng lần giao.',
  },
};

const workflowTemplates = {
  default: {
    name: 'Quy trình chuẩn demo', isDemo: true, version: 1,
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
  units[id] = { code, name, type, parentId: parentId || null, headId, status: 'active', effectiveFrom: '2026-01-01', effectiveTo: null, order: ++unitOrder, note, updatedAt: T(2026, 1, 5), updatedBy: 'u_admin' };
  if (!parentId) delete units[id].parentId;
  if (!headId) delete units[id].headId;
  if (!note) delete units[id].note;
  delete units[id].effectiveTo;
};
addUnit('unit_ptgd', 'PTGDTT', 'Phó Tổng Giám đốc thường trực', 'executive', null, 'u_ptgd', 'Đơn vị gốc của chuỗi giao KPI TOP-DOWN (POC).');
const CENTERS = [
  ['unit_banca', 'TT-DTCL', 'Trung tâm Đối tác chiến lược và Bancassurance', 'center', 'u_gd_banca', [
    ['unit_banca_kd', 'DTCL-BANCA', 'Kinh doanh Bancassurance'], ['unit_banca_dt', 'DTCL-DT', 'Đối tác chiến lược'], ['unit_banca_dl', 'DTCL-DL', 'Quản lý phát triển đại lý và hỗ trợ kinh doanh']]],
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
    ['unit_cntt_vh', 'CNTT-VH', 'Vận hành và quản trị dữ liệu'], ['unit_cntt_qlda', 'CNTT-QLDA', 'Quản lý dự án', 'u_tb_qlda']]],
  ['unit_hr', 'TT-QTNNL', 'Trung tâm Quản trị nguồn nhân lực', 'center', 'u_gd_hr', [
    ['unit_hr_vh', 'QTNNL-VH', 'Vận hành nhân sự'], ['unit_hr_dt', 'QTNNL-DT', 'Đối tác nhân sự']]],
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
// 3. Người dùng demo (tên giả lập)
// ---------------------------------------------------------------------------
const USERS = [
  // id, code, name, emailLocal, title, titleGroup, unitId, managerId, skipManagerId, roles, demoOrder
  ['u_admin', 'OP0001', 'Cao Văn Long', 'admin', 'Chuyên viên Quản trị hệ thống', 'staff', 'unit_cntt_vh', null, null, ['sysAdmin'], 1],
  ['u_hr', 'OP0002', 'Phan Ngọc Linh', 'hr.admin', 'Chuyên viên C&B – Quản trị KPI', 'senior', 'unit_hr_vh', 'u_gd_hr', 'u_ptgd', ['hrAdmin', 'employee'], 2],
  ['u_ptgd', 'OP0003', 'Hoàng Đức Thịnh', 'ptgd', 'Phó Tổng Giám đốc thường trực', 'executive', 'unit_ptgd', null, null, ['ptgd'], 3],
  ['u_gd_cntt', 'OP0010', 'Trần Minh Đức', 'gd.cntt', 'Giám đốc Trung tâm Công nghệ thông tin', 'director', 'unit_cntt', 'u_ptgd', null, ['director', 'approver'], 4],
  ['u_tb_qlda', 'OP0011', 'Lê Thu Hà', 'tb.qlda', 'Trưởng ban Quản lý dự án CNTT', 'head', 'unit_cntt_qlda', 'u_gd_cntt', 'u_ptgd', ['head', 'approver'], 5],
  ['u_tn_qlda', 'OP0012', 'Phạm Quốc Bảo', 'tn.qlda', 'Trưởng nhóm Dự án số', 'lead', 'unit_cntt_qlda', 'u_tb_qlda', 'u_gd_cntt', ['lineManager'], 6],
  ['u_nv_qlda1', 'OP0013', 'Nguyễn Hoàng Nam', 'nv.nam', 'Chuyên viên Quản lý dự án', 'staff', 'unit_cntt_qlda', 'u_tn_qlda', 'u_tb_qlda', ['employee'], 7],
  ['u_nv_qlda2', 'OP0014', 'Đỗ Mai Anh', 'nv.maianh', 'Chuyên viên Phân tích nghiệp vụ', 'staff', 'unit_cntt_qlda', 'u_tn_qlda', 'u_tb_qlda', ['employee'], 8],
  ['u_tb_ptht', 'OP0015', 'Võ Thanh Tùng', 'tb.ptht', 'Trưởng ban Phát triển hệ thống', 'head', 'unit_cntt_ptht', 'u_gd_cntt', 'u_ptgd', ['head'], 9],
  ['u_nv_ptht', 'OP0016', 'Hoàng Gia Huy', 'nv.huy', 'Kỹ sư phát triển phần mềm', 'staff', 'unit_cntt_ptht', 'u_tb_ptht', 'u_gd_cntt', ['employee'], 10],
  ['u_tb_hatang', 'OP0017', 'Bùi Văn Khánh', 'tb.hatang', 'Trưởng ban Hạ tầng và An toàn thông tin', 'head', 'unit_cntt_ht', 'u_gd_cntt', 'u_ptgd', ['head'], 11],
  ['u_gd_tc', 'OP0020', 'Ngô Thị Lan', 'gd.taichinh', 'Giám đốc Trung tâm Tài chính', 'director', 'unit_tc', 'u_ptgd', null, ['director', 'approver'], 12],
  ['u_tp_kt', 'OP0021', 'Đặng Hữu Phúc', 'tp.ketoan', 'Trưởng phòng Kế toán', 'head', 'unit_tc_kt', 'u_gd_tc', 'u_ptgd', ['head'], 13],
  ['u_nv_kt', 'OP0022', 'Lý Thị Hồng', 'nv.hong', 'Chuyên viên Kế toán tổng hợp', 'staff', 'unit_tc_kt', 'u_tp_kt', 'u_gd_tc', ['employee'], 14],
  ['u_gd_banca', 'OP0030', 'Trịnh Quang Vinh', 'gd.banca', 'Giám đốc Trung tâm Đối tác chiến lược và Bancassurance', 'director', 'unit_banca', 'u_ptgd', null, ['director'], 15],
  ['u_gd_hr', 'OP0040', 'Mai Thị Thu', 'gd.nhansu', 'Giám đốc Trung tâm Quản trị nguồn nhân lực', 'director', 'unit_hr', 'u_ptgd', null, ['director', 'approver'], 16],
  ['u_auditor', 'OP0050', 'Kiều Minh Châu', 'auditor', 'Chuyên viên Kiểm soát tuân thủ (Auditor)', 'staff', 'unit_pc_ks', null, null, ['auditor'], 17],
];
const userProfiles = {}, userAccess = {}, emailIndex = {}, demoLoginOptions = {};
for (const [id, code, name, local, title, titleGroup, unitId, managerId, skipManagerId, roleList, order] of USERS) {
  const email = id === 'u_admin' ? ADMIN_EMAIL : `${local}@${DOMAIN}`;
  userProfiles[id] = {
    employeeCode: code, name, email, title, titleGroup, unitId, status: 'active', createdAt: T(2026, 1, 5), updatedAt: T(2026, 1, 5), updatedBy: 'u_admin',
    ...(managerId ? { managerId } : {}), ...(skipManagerId ? { skipManagerId } : {}),
  };
  const roleMap = Object.fromEntries(roleList.map((r) => [r, true]));
  userAccess[id] = { roles: roleMap, perms: computePerms(roleMap), updatedAt: T(2026, 1, 5), updatedBy: 'u_admin' };
  emailIndex[emailKey(email)] = id;
  demoLoginOptions[id] = {
    name, title, unitName: units[unitId].name, roleLabel: roleList.map((r) => roles[r].label).join(', '), email, order,
  };
}
const nameOf = (id) => userProfiles[id]?.name || '';

// ---------------------------------------------------------------------------
// 4. Kho KPI & KBI
// ---------------------------------------------------------------------------
const L = (m3, m4, m5) => ({ 3: m3, 4: m4, 5: m5 });
const kpiCatalogPublic = {};
const kpiCatalogPrivate = {};
const kpiCatalogAccessIndex = {};
const catalogMeta = { status: 'active', version: 1, effectiveFrom: '2026-01-01', createdBy: 'u_hr', createdAt: T(2026, 1, 6), updatedBy: 'u_hr', updatedAt: T(2026, 1, 6) };
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
  return rec;
};

const K = {
  lntt: addKpi('kpi_tc_lntt', {
    code: 'TC-01', name: 'Lợi nhuận trước thuế', groupId: 'grp_tc', unit: 'Tỷ đồng', direction: 'higher', policy: 'sp_tiered_excel',
    description: 'Đo lường hiệu quả kinh doanh chung của Công ty; áp dụng cho cán bộ quản lý theo phân bổ.',
    measurement: 'Lợi nhuận trước thuế theo báo cáo tài chính năm.\nSau khi đã loại trừ các khoản chi thực tế sau thuế TNDN do không được tính vào chi phí hợp lý, hợp lệ để tính thuế (nếu có).',
    dataSource: 'Báo cáo tài chính do Trung tâm Tài chính cung cấp', targets: { threshold: 800, base: 1000, stretch: 1200 }, evidenceRequired: true,
    evidenceNote: 'Báo cáo tài chính/ số liệu Trung tâm Tài chính xác nhận', defaultWeight: 10,
    conversionNote: 'Số liệu mục tiêu là ví dụ minh họa (demo).',
  }),
  dt: addKpi('kpi_tc_dt', {
    code: 'TC-02', name: 'Doanh thu khai thác phí bảo hiểm gốc', groupId: 'grp_tc', unit: 'Tỷ đồng', direction: 'higher', policy: 'sp_tiered_excel',
    measurement: 'Tổng doanh thu phí bảo hiểm cấp đơn (trừ hoàn, giảm phí) trong năm.', dataSource: 'Hệ thống Core/ báo cáo Tài chính',
    targets: { threshold: 6400, base: 8000, stretch: 9600 }, defaultWeight: 10, evidenceRequired: true,
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
    targets: { threshold: 1600, base: 2000, stretch: 2400 }, appliesTo: { scope: 'units', unitIds: { unit_banca: true } },
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
};
const KP = {
  core: addKpi('kpi_pv_cntt_core', {
    code: 'CN-P01', name: 'Chuyển đổi lõi hệ thống nghiệp vụ (Core) – giai đoạn 1', groupId: 'grp_cntt', unit: 'Điểm (1-5)', direction: 'scale', policy: 'sp_scale_1_5',
    targets: { threshold: 3, base: 4, stretch: 5 }, ownerId: 'u_gd_cntt', measurement: 'Đánh giá theo mốc của Ban chỉ đạo dự án Core.',
    levels: L('Hoàn thành các mốc giai đoạn 1 đúng tiến độ điều chỉnh.', 'Hoàn thành đúng tiến độ gốc.', 'Vượt tiến độ gốc, chuyển đổi dữ liệu không lỗi nghiêm trọng.'),
  }, 'private', { allowedUsers: { u_tb_qlda: true, u_tb_ptht: true } }),
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
const kbiMeta = { status: 'active', version: 1, effectiveFrom: '2026-01-01', weight: 1, appliesTo: { scope: 'company' }, scoringGuide: KBI_GUIDE, updatedAt: T(2026, 1, 6), updatedBy: 'u_hr' };
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
// 5. Kỳ đánh giá, người tham gia, bản chụp tổ chức & chính sách
// ---------------------------------------------------------------------------
const config = {
  appSettings, kpiGroups, scoringPolicies, kpiAggregation: { default: kpiAggregation }, kbiPolicies, gradingBands, weightPolicies, workflowTemplates, formTemplates, permissionPolicies,
};
const policySnapshot = (frozenAt) => ({
  scoring: clone(scoringPolicies), kpiAggregation: clone(kpiAggregation), kbi: clone(kbiPolicies.default), grading: clone(gradingBands.default),
  weight: clone(weightPolicies.default), workflow: clone(workflowTemplates.default), form: clone(formTemplates.default),
  meta: { frozenAt, frozenBy: 'u_hr', source: 'config', refs: { kbi: 'default', grading: 'default', weight: 'default', workflow: 'default', form: 'default', kpiAggregation: 'default' } },
});

const EXCLUDED = { u_admin: true, u_auditor: true };
function buildPeriodUsers() {
  const out = {};
  for (const [id, p] of Object.entries(userProfiles)) {
    if (EXCLUDED[id] || p.status !== 'active') continue;
    const chain = {};
    let cur = p.managerId, depth = 1;
    while (cur && !chain[cur] && depth < 20) { chain[cur] = depth++; cur = userProfiles[cur]?.managerId; }
    const skip = p.skipManagerId || (p.managerId ? userProfiles[p.managerId]?.managerId : null) || null;
    out[id] = {
      name: p.name, employeeCode: p.employeeCode, title: p.title, titleGroup: p.titleGroup, unitId: p.unitId, unitName: units[p.unitId].name,
      ...(p.managerId ? { managerId: p.managerId, managerName: nameOf(p.managerId), managerTitle: userProfiles[p.managerId].title } : {}),
      ...(skip ? { skipManagerId: skip, skipManagerName: nameOf(skip), skipManagerTitle: userProfiles[skip].title } : {}),
      ...(Object.keys(chain).length ? { chain } : {}), included: true,
    };
  }
  return out;
}
const periodUsers2026 = buildPeriodUsers();
const periodUsers2025 = Object.fromEntries(Object.entries(buildPeriodUsers()).filter(([id]) => ['u_ptgd', 'u_gd_cntt', 'u_tb_qlda', 'u_tn_qlda', 'u_nv_qlda1', 'u_tb_ptht', 'u_nv_ptht', 'u_gd_tc', 'u_tp_kt', 'u_nv_kt'].includes(id)));
const orgVersion = (id, periodId, at, pu) => ({
  name: `Cơ cấu áp dụng kỳ ${periodId}`, periodId, createdAt: at, createdBy: 'u_hr', units: clone(units),
  reporting: Object.fromEntries(Object.entries(pu).map(([uid, u]) => [uid, { unitId: u.unitId, title: u.title, ...(u.managerId ? { managerId: u.managerId } : {}), ...(u.skipManagerId ? { skipManagerId: u.skipManagerId } : {}) }])),
});
const KBI_IDS = Object.fromEntries(Object.keys(kbiCatalog).map((k) => [k, true]));
const evaluationPeriods = {
  P2026: {
    code: 'KY-2026', name: 'Kỳ đánh giá năm 2026', year: 2026, type: 'year', startDate: '2026-01-01', endDate: '2026-12-31', status: 'open',
    scope: { rootUnitId: 'unit_ptgd', includeAllActive: true, excludeUserIds: clone(EXCLUDED), titleGroups: null },
    kbiValueIds: clone(KBI_IDS), kpiSetNote: 'Bộ KPI theo kho KPI Công ty 2026 và KPI giao TOP-DOWN từ PTGĐ thường trực.',
    milestones: { assignDeadline: '2026-02-28', selfAssessDeadline: '2026-12-20', managerAssessDeadline: '2027-01-10', approvalDeadline: '2027-01-20' },
    rules: { allowReturn: true, allowEditAfterSubmit: false, enforceDeadlines: false },
    orgVersionId: 'ov_P2026', createdBy: 'u_hr', createdAt: T(2026, 1, 8), approvedBy: 'u_ptgd', updatedAt: T(2026, 1, 10), initializedAt: T(2026, 1, 10),
    participantCount: Object.keys(periodUsers2026).length, policies: policySnapshot(T(2026, 1, 10)),
    statusLog: { l1: { from: 'draft', to: 'configured', by: 'u_hr', at: T(2026, 1, 9) }, l2: { from: 'configured', to: 'open', by: 'u_hr', at: T(2026, 1, 10), reason: 'Mở kỳ theo kế hoạch' } },
  },
  P2025: {
    code: 'KY-2025', name: 'Kỳ đánh giá năm 2025', year: 2025, type: 'year', startDate: '2025-01-01', endDate: '2025-12-31', status: 'locked',
    scope: { rootUnitId: 'unit_ptgd', includeAllActive: false, excludeUserIds: clone(EXCLUDED), titleGroups: null },
    kbiValueIds: clone(KBI_IDS), kpiSetNote: 'Kỳ đã khóa – dùng để so sánh giữa các kỳ (dữ liệu minh họa).',
    milestones: { assignDeadline: '2025-02-28', selfAssessDeadline: '2025-12-20', managerAssessDeadline: '2026-01-10', approvalDeadline: '2026-01-20' },
    rules: { allowReturn: true, allowEditAfterSubmit: false, enforceDeadlines: false },
    orgVersionId: 'ov_P2025', createdBy: 'u_hr', createdAt: T(2025, 1, 6), approvedBy: 'u_ptgd', updatedAt: T(2026, 1, 25), initializedAt: T(2025, 1, 8),
    participantCount: Object.keys(periodUsers2025).length, policies: policySnapshot(T(2025, 1, 8)),
    statusLog: { l1: { from: 'consolidating', to: 'locked', by: 'u_hr', at: T(2026, 1, 25), reason: 'Khóa kết quả năm 2025' } },
  },
};

// ---------------------------------------------------------------------------
// 6. Kế hoạch KPI, giao KPI TOP-DOWN, sub-KPI
// ---------------------------------------------------------------------------
const plans = { P2026: {}, P2025: {} };
const assignments = { P2026: {} };
const notifications = {};
const auditLogs = {};
let seq = 0;
const nid = (p) => `${p}_${String(++seq).padStart(4, '0')}`;
const notify = (uid, n) => { (notifications[uid] ||= {})[nid('n')] = { read: false, ...n }; };
const audit = (e) => { auditLogs[nid('a')] = { source: 'seed', ...e }; };

function specFromCatalog(cat, catId, extra = {}) {
  return {
    title: cat.name, groupId: cat.groupId, description: cat.description || '', measurement: cat.measurement || '', unit: cat.unit, direction: cat.direction,
    scoring: { policyId: cat.scoringPolicyId }, targets: clone(cat.targets || {}), ...(cat.levelDescriptions ? { levelDescriptions: clone(cat.levelDescriptions) } : {}),
    evidenceRequired: !!cat.evidenceRequired, evidenceNote: cat.evidenceNote || '', frequency: cat.frequency || 'year', dataSource: cat.dataSource || '',
    catalogRef: { id: catId, code: cat.code, version: cat.version, visibility: cat.visibility }, catalogSnapshot: { name: cat.name, code: cat.code, version: cat.version, measurement: cat.measurement || '', targets: clone(cat.targets || {}), scoringPolicyId: cat.scoringPolicyId },
    state: 'active', countInTotal: true, ...extra,
  };
}

function plan(periodId, uid, status, items, extra = {}) {
  const p = {
    status, version: status === 'draft' ? 0 : 1, meta: { createdAt: T(periodId === 'P2025' ? 2025 : 2026, 1, 15), createdBy: uid, unitId: userProfiles[uid].unitId },
    items: {}, history: {}, ...extra,
  };
  if (!p.version) delete p.version;
  let order = 0;
  for (const [itemId, it] of Object.entries(items)) {
    const ackStatus = it.ack || (it.spec.source === 'assigned' ? 'accepted' : null);
    p.items[itemId] = {
      spec: { order: ++order, createdAt: T(2026, 1, 20), createdBy: it.spec.assignedBy || uid, ...it.spec },
      weight: it.weight,
      ...(ackStatus ? { ack: { status: ackStatus, by: ackStatus === 'pending' ? it.spec.assignedBy : uid, at: T(2026, 2, 3), ...(it.ackExtra || {}) } } : {}),
      meta: { updatedAt: T(2026, 2, 1), updatedBy: uid },
    };
  }
  plans[periodId][uid] = p;
  return p;
}

const sig = (userId, at, version = 1, note = '') => ({ userId, name: nameOf(userId), title: userProfiles[userId].title, at, version, ...(note ? { note } : {}) });

let asSeq = 0;
function assign(periodId, fromId, toId, itemId, spec, weight, opts = {}) {
  const aid = `as_${String(++asSeq).padStart(3, '0')}`;
  const status = opts.status || 'accepted';
  const fullSpec = {
    ...spec, source: 'assigned', assignmentId: aid, assignedBy: fromId, assignedByName: nameOf(fromId), assignedAt: T(2026, 1, 25),
    weightMode: opts.mode || 'fixed', originalWeight: opts.originalWeight ?? weight,
    ...(opts.mode === 'flex' ? { minWeight: opts.minWeight, ...(opts.maxWeight ? { maxWeight: opts.maxWeight } : {}) } : {}),
    ...(opts.parentRef ? { parentRef: opts.parentRef } : {}),
  };
  (assignments[periodId][fromId] ||= {})[aid] = {
    fromId, fromName: nameOf(fromId), toId, toName: nameOf(toId), status, itemId, spec: fullSpec, weight: opts.originalWeight ?? weight,
    weightMode: fullSpec.weightMode, ...(opts.mode === 'flex' ? { minWeight: opts.minWeight } : {}), createdAt: T(2026, 1, 24), ...(status !== 'draft' ? { assignedAt: T(2026, 1, 25) } : {}),
    ...(opts.parentRef ? { sourceItemRef: opts.parentRef } : {}),
    ...(opts.response ? { response: opts.response } : {}),
  };
  return { spec: fullSpec, weight, ack: opts.ack || (status === 'assigned' ? 'pending' : status === 'change_requested' ? 'change_requested' : 'accepted'), ackExtra: opts.ackExtra };
}
const ref = (userId, itemId, title) => ({ userId, itemId, title });

// --- PTGĐ thường trực (cấp cao nhất – HR duyệt thay quản lý vì TGĐ ngoài phạm vi POC)
const ptgdItems = {
  it_ptgd_1: { spec: specFromCatalog(K.lntt, 'kpi_tc_lntt', { source: 'catalog' }), weight: 15 },
  it_ptgd_2: { spec: specFromCatalog(K.dt, 'kpi_tc_dt', { source: 'catalog' }), weight: 15 },
  it_ptgd_3: { spec: specFromCatalog(K.tuhoa, 'kpi_da_tuhoa', { source: 'catalog' }), weight: 20 },
  it_ptgd_4: { spec: specFromCatalog(K.caupcn, 'kpi_da_caupcn', { source: 'catalog' }), weight: 20 },
  it_ptgd_5: { spec: specFromCatalog(K.attt, 'kpi_vh_attt', { source: 'catalog' }), weight: 10 },
  it_ptgd_6: { spec: specFromCatalog(K.csat, 'kpi_kh_csat', { source: 'catalog' }), weight: 10 },
  it_ptgd_7: { spec: specFromCatalog(K.daotao, 'kpi_ns_daotao', { source: 'catalog' }), weight: 10 },
};
plan('P2026', 'u_ptgd', 'approved', ptgdItems, {
  signatures: { employee: sig('u_ptgd', T(2026, 1, 18)), manager: sig('u_hr', T(2026, 1, 19), 1, 'Duyệt thay cấp TGĐ (ngoài phạm vi POC)') },
  statusMeta: { by: 'u_hr', at: T(2026, 1, 19), note: 'Phê duyệt kế hoạch' },
});

// --- GĐ TT CNTT: nhận 4 KPI từ PTGĐ (2 cố định – chế độ A, 2 linh hoạt – chế độ B, X = 10%)
const gdItems = {
  it_gd_1: assign('P2026', 'u_ptgd', 'u_gd_cntt', 'it_gd_1', specFromCatalog(K.lntt, 'kpi_tc_lntt'), 10, { parentRef: ref('u_ptgd', 'it_ptgd_1', K.lntt.name) }),
  it_gd_2: assign('P2026', 'u_ptgd', 'u_gd_cntt', 'it_gd_2', specFromCatalog(K.dt, 'kpi_tc_dt'), 10, { parentRef: ref('u_ptgd', 'it_ptgd_2', K.dt.name) }),
  it_gd_3: assign('P2026', 'u_ptgd', 'u_gd_cntt', 'it_gd_3', specFromCatalog(K.caupcn, 'kpi_da_caupcn'), 25,
    { mode: 'flex', minWeight: 10, originalWeight: 20, parentRef: ref('u_ptgd', 'it_ptgd_4', K.caupcn.name) }),
  it_gd_4: assign('P2026', 'u_ptgd', 'u_gd_cntt', 'it_gd_4', specFromCatalog(K.attt, 'kpi_vh_attt'), 20,
    { mode: 'flex', minWeight: 10, originalWeight: 20, parentRef: ref('u_ptgd', 'it_ptgd_5', K.attt.name) }),
  it_gd_5: { spec: specFromCatalog(KP.core, 'kpi_pv_cntt_core', { source: 'catalog' }), weight: 20 },
  it_gd_6: { spec: specFromCatalog(K.daotao, 'kpi_ns_daotao', { source: 'catalog' }), weight: 15 },
};
const gdPlan = plan('P2026', 'u_gd_cntt', 'approved', gdItems, {
  signatures: { employee: sig('u_gd_cntt', T(2026, 2, 5)), manager: sig('u_ptgd', T(2026, 2, 6)) },
  statusMeta: { by: 'u_ptgd', at: T(2026, 2, 6), note: 'Phê duyệt kế hoạch' },
});
gdPlan.history.h1 = { at: T(2026, 2, 4), by: 'u_gd_cntt', byName: nameOf('u_gd_cntt'), action: 'weight_change', itemId: 'it_gd_3', before: { weight: 20 }, after: { weight: 25 }, reason: 'Tăng trọng số cấu phần công nghệ do số dự án kinh doanh năm 2026 tăng (chế độ B, tối thiểu 10%).' };

// --- Trưởng ban QLDA: KPI cha nhận từ GĐ, tự phân rã 2 sub-KPI (lấy kết quả con thay cha) – kế hoạch chờ GĐ duyệt
const tbItems = {
  it_tb_1: assign('P2026', 'u_gd_cntt', 'u_tb_qlda', 'it_tb_1', {
    title: 'Triển khai các dự án trọng điểm của TT CNTT năm 2026 (cấu phần công nghệ)', groupId: 'grp_da', unit: 'Điểm (1-5)', direction: 'scale',
    description: 'Sub-KPI phân rã từ KPI "Đảm bảo các cấu phần công nghệ..." của Giám đốc TT CNTT.', measurement: 'Tổng hợp từ các sub-KPI dự án theo tỷ lệ cấu hình.',
    scoring: { policyId: 'sp_scale_1_5' }, targets: { threshold: 3, base: 4, stretch: 5 }, levelDescriptions: clone(K.caupcn.levelDescriptions),
    aggregation: { method: 'children_replace', missingChild: 'exclude' }, state: 'active', countInTotal: true, evidenceRequired: true,
  }, 40, { mode: 'flex', minWeight: 15, originalWeight: 40, parentRef: ref('u_gd_cntt', 'it_gd_3', K.caupcn.name) }),
  it_tb_1a: { spec: specFromCatalog(K.d2c, 'kpi_da_d2c', { source: 'sub', parentItemId: 'it_tb_1', title: 'Dự án D2C – golive đúng mốc cam kết' }), weight: 60 },
  it_tb_1b: { spec: specFromCatalog(K.xcg, 'kpi_da_xcg', { source: 'sub', parentItemId: 'it_tb_1' }), weight: 40 },
  it_tb_2: assign('P2026', 'u_gd_cntt', 'u_tb_qlda', 'it_tb_2', specFromCatalog(K.lntt, 'kpi_tc_lntt'), 10, { parentRef: ref('u_gd_cntt', 'it_gd_1', K.lntt.name) }),
  it_tb_3: assign('P2026', 'u_gd_cntt', 'u_tb_qlda', 'it_tb_3', specFromCatalog(K.dt, 'kpi_tc_dt'), 10, { parentRef: ref('u_gd_cntt', 'it_gd_2', K.dt.name) }),
  it_tb_4: { spec: specFromCatalog(KP.core, 'kpi_pv_cntt_core', { source: 'catalog' }), weight: 20 },
  it_tb_5: { spec: specFromCatalog(K.daotao, 'kpi_ns_daotao', { source: 'catalog' }), weight: 20 },
};
plan('P2026', 'u_tb_qlda', 'submitted', tbItems, {
  signatures: { employee: sig('u_tb_qlda', T(2026, 2, 12)) }, statusMeta: { by: 'u_tb_qlda', at: T(2026, 2, 12), note: 'Trình duyệt bộ KPI' },
});
notify('u_gd_cntt', { type: 'plan_submitted', title: 'Kế hoạch KPI chờ phê duyệt', message: `${nameOf('u_tb_qlda')} đã trình bộ KPI năm 2026.`, link: '#/kpi/plan/P2026/u_tb_qlda', fromId: 'u_tb_qlda', at: T(2026, 2, 12) });

// --- Trưởng nhóm DA số: nhận 2 KPI (1 yêu cầu điều chỉnh trọng số, 1 chờ tiếp nhận) – kế hoạch nháp
const tnItems = {
  it_tn_1: assign('P2026', 'u_tb_qlda', 'u_tn_qlda', 'it_tn_1', specFromCatalog(K.d2c, 'kpi_da_d2c', { title: 'Dự án D2C – hoàn thành hạng mục công nghệ do nhóm phụ trách' }), 40,
    { status: 'change_requested', parentRef: ref('u_tb_qlda', 'it_tb_1a', 'Dự án D2C – golive đúng mốc cam kết'),
      ackExtra: { note: 'Đề nghị giảm còn 30% vì nhóm đồng thời hỗ trợ dự án XCG.', requestedWeight: 30 },
      response: { status: 'change_requested', note: 'Đề nghị giảm còn 30% vì nhóm đồng thời hỗ trợ dự án XCG.', requestedWeight: 30, by: 'u_tn_qlda', at: T(2026, 2, 20) } }),
  it_tn_2: assign('P2026', 'u_tb_qlda', 'u_tn_qlda', 'it_tn_2', specFromCatalog(K.xcg, 'kpi_da_xcg', { title: 'Dự án XCG – phân tích yêu cầu và kiểm thử nghiệp vụ' }), 30,
    { status: 'assigned', mode: 'flex', minWeight: 10, parentRef: ref('u_tb_qlda', 'it_tb_1b', K.xcg.name) }),
  it_tn_3: { spec: specFromCatalog(K.daotao, 'kpi_ns_daotao', { source: 'catalog' }), weight: 30 },
};
tnItems.it_tn_1.ackExtra = { note: 'Đề nghị giảm còn 30% vì nhóm đồng thời hỗ trợ dự án XCG.', requestedWeight: 30 };
plan('P2026', 'u_tn_qlda', 'draft', tnItems);
notify('u_tn_qlda', { type: 'kpi_assigned', title: 'Bạn được giao KPI mới', message: `${nameOf('u_tb_qlda')} đã giao 2 chỉ tiêu cho bạn.`, link: '#/kpi/inbox', fromId: 'u_tb_qlda', at: T(2026, 2, 18) });
notify('u_tb_qlda', { type: 'kpi_change_requested', title: 'Yêu cầu điều chỉnh trọng số', message: `${nameOf('u_tn_qlda')} đề nghị điều chỉnh trọng số KPI "Dự án D2C".`, link: '#/kpi/assign', fromId: 'u_tn_qlda', at: T(2026, 2, 20) });

// --- Nhân viên QLDA 1: kế hoạch đã duyệt, hồ sơ đánh giá đã gửi (chờ quản lý đánh giá)
const namItems = {
  it_nam_1: assign('P2026', 'u_tn_qlda', 'u_nv_qlda1', 'it_nam_1', {
    title: 'Quản lý tiến độ các hạng mục công nghệ dự án D2C', groupId: 'grp_da', unit: 'Điểm (1-5)', direction: 'scale', scoring: { policyId: 'sp_scale_1_5' },
    targets: { threshold: 3, base: 4, stretch: 5 }, levelDescriptions: clone(K.d2c.levelDescriptions), measurement: 'Theo kế hoạch dự án D2C đã phê duyệt.', state: 'active', evidenceRequired: true,
  }, 40, { parentRef: ref('u_tn_qlda', 'it_tn_1', 'Dự án D2C – hoàn thành hạng mục công nghệ do nhóm phụ trách') }),
  it_nam_2: assign('P2026', 'u_tn_qlda', 'u_nv_qlda1', 'it_nam_2', {
    title: 'Tỷ lệ yêu cầu thay đổi (CR) được xử lý đúng SLA', groupId: 'grp_vh', unit: '%', direction: 'higher', scoring: { policyId: 'sp_tiered_linear' },
    targets: { threshold: 85, base: 95, stretch: 100 }, measurement: 'Số CR xử lý đúng SLA / tổng số CR tiếp nhận.', state: 'active',
  }, 30, { mode: 'flex', minWeight: 10 }),
  it_nam_3: { spec: specFromCatalog(K.daotao, 'kpi_ns_daotao', { source: 'catalog' }), weight: 15 },
  it_nam_4: { spec: specFromCatalog(K.sangkien, 'kpi_khac_sangkien', { source: 'catalog' }), weight: 15 },
};
plan('P2026', 'u_nv_qlda1', 'approved', namItems, {
  signatures: { employee: sig('u_nv_qlda1', T(2026, 2, 22)), manager: sig('u_tn_qlda', T(2026, 2, 23)), skip: sig('u_tb_qlda', T(2026, 2, 24)) },
  statusMeta: { by: 'u_tb_qlda', at: T(2026, 2, 24), note: 'Phê duyệt kế hoạch' },
});

// --- Nhân viên QLDA 2: kế hoạch đã duyệt, đang tự đánh giá
const maiItems = {
  it_mai_1: assign('P2026', 'u_tn_qlda', 'u_nv_qlda2', 'it_mai_1', specFromCatalog(K.xcg, 'kpi_da_xcg', { title: 'Phân tích nghiệp vụ dự án phân tích tổn thất XCG' }), 40,
    { parentRef: ref('u_tn_qlda', 'it_tn_2', 'Dự án XCG – phân tích yêu cầu và kiểm thử nghiệp vụ') }),
  it_mai_2: { spec: { title: 'Số lỗi đặc tả yêu cầu bị trả lại trong năm', groupId: 'grp_cl', unit: 'Lỗi', direction: 'lower', scoring: { policyId: 'sp_tiered_lower' }, targets: { threshold: 6, base: 3, stretch: 1 }, measurement: 'Số tài liệu đặc tả bị đơn vị phát triển trả lại do thiếu/sai yêu cầu.', source: 'custom', state: 'active', countInTotal: true }, weight: 30 },
  it_mai_3: { spec: specFromCatalog(K.daotao, 'kpi_ns_daotao', { source: 'catalog' }), weight: 15 },
  it_mai_4: { spec: specFromCatalog(K.vhdn, 'kpi_ns_vhdn', { source: 'catalog' }), weight: 15 },
};
plan('P2026', 'u_nv_qlda2', 'approved', maiItems, {
  signatures: { employee: sig('u_nv_qlda2', T(2026, 2, 22)), manager: sig('u_tn_qlda', T(2026, 2, 23)), skip: sig('u_tb_qlda', T(2026, 2, 24)) },
});

// --- Trưởng ban PTHT & kỹ sư: kế hoạch đã duyệt; hồ sơ kỹ sư chờ GĐ (QL trên 1 cấp) phê duyệt
plan('P2026', 'u_tb_ptht', 'approved', {
  it_pt_1: assign('P2026', 'u_gd_cntt', 'u_tb_ptht', 'it_pt_1', specFromCatalog(K.caupcn, 'kpi_da_caupcn', { title: 'Hoàn thành cấu phần phát triển của các dự án kinh doanh' }), 40,
    { mode: 'flex', minWeight: 15, parentRef: ref('u_gd_cntt', 'it_gd_3', K.caupcn.name) }),
  it_pt_2: { spec: specFromCatalog(K.incident, 'kpi_vh_incident', { source: 'catalog' }), weight: 20 },
  it_pt_3: { spec: specFromCatalog(KP.core, 'kpi_pv_cntt_core', { source: 'catalog' }), weight: 25 },
  it_pt_4: { spec: specFromCatalog(K.daotao, 'kpi_ns_daotao', { source: 'catalog' }), weight: 15 },
}, { signatures: { employee: sig('u_tb_ptht', T(2026, 2, 10)), manager: sig('u_gd_cntt', T(2026, 2, 11)), skip: sig('u_ptgd', T(2026, 2, 12)) } });
const huyItems = {
  it_huy_1: assign('P2026', 'u_tb_ptht', 'u_nv_ptht', 'it_huy_1', {
    title: 'Tỷ lệ hoàn thành user story theo sprint', groupId: 'grp_cntt', unit: '%', direction: 'higher', scoring: { policyId: 'sp_tiered_linear' },
    targets: { threshold: 80, base: 90, stretch: 100 }, measurement: 'Story points hoàn thành / cam kết, bình quân các sprint trong năm.', state: 'active',
  }, 35, { parentRef: ref('u_tb_ptht', 'it_pt_1', 'Hoàn thành cấu phần phát triển của các dự án kinh doanh') }),
  it_huy_2: assign('P2026', 'u_tb_ptht', 'u_nv_ptht', 'it_huy_2', {
    title: 'Số lỗi nghiêm trọng phát sinh sau golive', groupId: 'grp_cl', unit: 'Lỗi', direction: 'lower', scoring: { policyId: 'sp_tiered_lower' },
    targets: { threshold: 5, base: 2, stretch: 0 }, measurement: 'Lỗi mức Critical/High trên production thuộc phần việc phụ trách.', state: 'active',
  }, 25, { mode: 'flex', minWeight: 10, parentRef: ref('u_tb_ptht', 'it_pt_2', K.incident.name) }),
  it_huy_3: { spec: specFromCatalog(K.milestone, 'kpi_cn_milestone', { source: 'catalog' }), weight: 25 },
  it_huy_4: { spec: specFromCatalog(K.daotao, 'kpi_ns_daotao', { source: 'catalog' }), weight: 15 },
};
plan('P2026', 'u_nv_ptht', 'approved', huyItems, {
  signatures: { employee: sig('u_nv_ptht', T(2026, 2, 15)), manager: sig('u_tb_ptht', T(2026, 2, 16)), skip: sig('u_gd_cntt', T(2026, 2, 17)) },
});

// --- TT Tài chính
plan('P2026', 'u_gd_tc', 'approved', {
  it_tc_1: assign('P2026', 'u_ptgd', 'u_gd_tc', 'it_tc_1', specFromCatalog(K.lntt, 'kpi_tc_lntt'), 30, { parentRef: ref('u_ptgd', 'it_ptgd_1', K.lntt.name) }),
  it_tc_2: assign('P2026', 'u_ptgd', 'u_gd_tc', 'it_tc_2', specFromCatalog(K.dt, 'kpi_tc_dt'), 20, { parentRef: ref('u_ptgd', 'it_ptgd_2', K.dt.name) }),
  it_tc_3: { spec: specFromCatalog(K.chiphi, 'kpi_tc_chiphi', { source: 'catalog' }), weight: 20 },
  it_tc_4: { spec: specFromCatalog(KP.audit, 'kpi_pv_tc_audit', { source: 'catalog' }), weight: 20 },
  it_tc_5: { spec: specFromCatalog(K.daotao, 'kpi_ns_daotao', { source: 'catalog' }), weight: 10 },
}, { signatures: { employee: sig('u_gd_tc', T(2026, 2, 3)), manager: sig('u_ptgd', T(2026, 2, 4)) } });
plan('P2026', 'u_tp_kt', 'approved', {
  it_kt_1: { spec: specFromCatalog(KP.audit, 'kpi_pv_tc_audit', { source: 'catalog' }), weight: 30 },
  it_kt_2: assign('P2026', 'u_gd_tc', 'u_tp_kt', 'it_kt_2', specFromCatalog(K.chiphi, 'kpi_tc_chiphi'), 30, { mode: 'flex', minWeight: 10, parentRef: ref('u_gd_tc', 'it_tc_3', K.chiphi.name) }),
  it_kt_3: { spec: specFromCatalog(K.vipham, 'kpi_tt_vipham', { source: 'catalog' }), weight: 25 },
  it_kt_4: { spec: specFromCatalog(K.daotao, 'kpi_ns_daotao', { source: 'catalog' }), weight: 15 },
}, { signatures: { employee: sig('u_tp_kt', T(2026, 2, 8)), manager: sig('u_gd_tc', T(2026, 2, 9)), skip: sig('u_ptgd', T(2026, 2, 10)) } });
const hongItems = {
  it_hong_1: assign('P2026', 'u_tp_kt', 'u_nv_kt', 'it_hong_1', {
    title: 'Khóa sổ kế toán tháng đúng hạn (số kỳ trễ hạn)', groupId: 'grp_vh', unit: 'Kỳ trễ', direction: 'lower', scoring: { policyId: 'sp_tiered_lower' },
    targets: { threshold: 3, base: 1, stretch: 0 }, measurement: 'Số tháng khóa sổ sau ngày làm việc thứ 5 của tháng kế tiếp.', state: 'active',
  }, 40, { parentRef: ref('u_tp_kt', 'it_kt_1', KP.audit.name) }),
  it_hong_2: { spec: specFromCatalog(K.vipham, 'kpi_tt_vipham', { source: 'catalog' }), weight: 30 },
  it_hong_3: { spec: specFromCatalog(K.daotao, 'kpi_ns_daotao', { source: 'catalog' }), weight: 15 },
  it_hong_4: { spec: specFromCatalog(K.sangkien, 'kpi_khac_sangkien', { source: 'catalog' }), weight: 15 },
};
plan('P2026', 'u_nv_kt', 'approved', hongItems, {
  signatures: { employee: sig('u_nv_kt', T(2026, 2, 12)), manager: sig('u_tp_kt', T(2026, 2, 13)), skip: sig('u_gd_tc', T(2026, 2, 14)) },
});

// --- HR admin (kế hoạch nháp) và một lần giao "Chờ giao" (nháp) cho Trưởng ban Hạ tầng
plan('P2026', 'u_hr', 'draft', {
  it_hr_1: { spec: specFromCatalog(K.tuyendung, 'kpi_ns_tuyendung', { source: 'catalog' }), weight: 50 },
  it_hr_2: { spec: specFromCatalog(K.daotao, 'kpi_ns_daotao', { source: 'catalog' }), weight: 20 },
});
assign('P2026', 'u_gd_cntt', 'u_tb_hatang', null, specFromCatalog(K.attt, 'kpi_vh_attt', { title: 'Hệ thống CNTT hoạt động an toàn, ổn định (hạ tầng & ATTT)' }), 40,
  { status: 'draft', mode: 'flex', minWeight: 20, parentRef: ref('u_gd_cntt', 'it_gd_4', K.attt.name) });

// ---------------------------------------------------------------------------
// 7. Hồ sơ đánh giá
// ---------------------------------------------------------------------------
const evaluations = { P2026: {}, P2025: {} };
const kbiValues = Object.entries(kbiCatalog).map(([id, v]) => ({ id, name: v.name, weight: v.weight })).sort((a, b) => kbiCatalog[a.id].order - kbiCatalog[b.id].order);
const KBI_KEYS = kbiValues.map((v) => v.id);
const kbiLevels = (levels, extra = () => ({})) => Object.fromEntries(KBI_KEYS.map((k, i) => [k, { level: levels[i], ...extra(k, i) }]).filter(([, v]) => v.level !== null));
const kpiResults = (map) => Object.fromEntries(Object.entries(map).map(([id, v]) => [id, typeof v === 'object' ? v : { actual: v }]));

function finalize(periodId, uid, ev, by, at) {
  const r = computeEvaluation({ plan: plans[periodId][uid], evaluation: ev, policies: evaluationPeriods[periodId].policies, kbiValues });
  ev.final = {
    kpiScore: r.kpi.total, kpiPercent: r.kpi.total === null ? null : Math.round(r.kpi.total * 10000) / 100, kbiScore: r.kbi.average, gradeCode: r.grade.code, gradeLabel: r.grade.label,
    gradeStatus: r.grade.status, weightTotal: r.kpi.totalWeight, computedAt: at, computedBy: by, version: ev.version, policyVersion: { grading: 1, kbi: 1, kpiAggregation: 1 },
  };
  return r;
}

evaluations.P2026.u_nv_qlda1 = {
  status: 'submitted', version: 1, meta: { createdAt: T(2026, 10, 1), createdBy: 'u_nv_qlda1' },
  self: {
    kpi: kpiResults({
      it_nam_1: { actual: 4, explanation: 'Các hạng mục công nghệ D2C hoàn thành đúng tiến độ gốc, golive 21/09.', evidence: 'Biên bản golive D2C ngày 21/09/2026' },
      it_nam_2: { actual: 96, explanation: '144/150 CR xử lý đúng SLA.', evidence: 'Báo cáo Jira Service Desk' },
      it_nam_3: { actual: 4, explanation: 'Hoàn thành 100% chuyên đề bắt buộc.' },
      it_nam_4: { actual: 3, explanation: 'Sáng kiến tự động hóa báo cáo tiến độ được áp dụng tại ban.' },
    }),
    kbi: kbiLevels([4, 4, 3, 5, 4], (k) => ({ examples: k === 'kbi_chinhtruc' ? 'Chủ động báo cáo rủi ro trễ hạn của nhà thầu dù ảnh hưởng tới đánh giá của nhóm.' : 'Thể hiện qua công việc dự án D2C.' })),
    summary: { strengths: 'Bám sát tiến độ, chủ động phối hợp với các bên.', improvements: 'Cần nâng cao kỹ năng quản trị rủi ro nhà thầu.', proposals: 'Tham gia khóa PMP nâng cao năm 2027.' },
    updatedAt: T(2026, 10, 5),
  },
  signatures: { employee: sig('u_nv_qlda1', T(2026, 10, 5)) },
  statusMeta: { by: 'u_nv_qlda1', at: T(2026, 10, 5), note: 'Gửi tự đánh giá' },
};
notify('u_tn_qlda', { type: 'evaluation_submitted', title: 'Hồ sơ chờ bạn đánh giá', message: `${nameOf('u_nv_qlda1')} đã gửi tự đánh giá.`, link: '#/eval/form/P2026/u_nv_qlda1', fromId: 'u_nv_qlda1', at: T(2026, 10, 5) });

evaluations.P2026.u_nv_qlda2 = {
  status: 'draft', meta: { createdAt: T(2026, 10, 3), createdBy: 'u_nv_qlda2' },
  self: { kpi: kpiResults({ it_mai_1: { actual: 4, explanation: 'Hoàn thành đặc tả các module giám định ảnh.' } }), kbi: kbiLevels([4, 3, null, null, null]), updatedAt: T(2026, 10, 3) },
};

const huyEval = {
  status: 'manager_reviewed', version: 1, meta: { createdAt: T(2026, 9, 25), createdBy: 'u_nv_ptht' },
  self: {
    kpi: kpiResults({ it_huy_1: { actual: 94, explanation: 'Bình quân 94% story points trong 22 sprint.' }, it_huy_2: { actual: 1, explanation: '1 lỗi High tháng 6, đã khắc phục trong 4 giờ.' }, it_huy_3: { actual: 100, explanation: 'Hoàn thành 100% hạng mục.' }, it_huy_4: { actual: 4 } }),
    kbi: kbiLevels([4, 4, 5, 4, 4]),
    summary: { strengths: 'Chất lượng code tốt, hỗ trợ đồng nghiệp.', improvements: 'Viết tài liệu kỹ thuật đầy đủ hơn.', proposals: 'Đào tạo kiến trúc microservices.' }, updatedAt: T(2026, 10, 1),
  },
  manager: {
    kpi: kpiResults({ it_huy_1: { actual: 92, comment: 'Điều chỉnh theo số liệu chốt của PMO.' }, it_huy_3: { actual: 95, comment: '1 hạng mục chuyển sang tháng 1/2027.' } }),
    kbi: kbiLevels([4, 4, 4, 4, 4], (k) => ({ comment: k === 'kbi_sangtao' ? 'Có đề xuất cải tiến nhưng chưa được phê duyệt áp dụng → mức 4.' : '' })),
    summary: { strengths: 'Hoàn thành tốt nhiệm vụ, tinh thần hợp tác cao.', improvements: 'Chủ động hơn trong ước lượng công việc.', proposals: 'Đề xuất tham gia nhóm kiến trúc hệ thống 2027.' }, updatedAt: T(2026, 10, 8),
  },
  signatures: { employee: sig('u_nv_ptht', T(2026, 10, 1)), manager: sig('u_tb_ptht', T(2026, 10, 8)) },
  statusMeta: { by: 'u_tb_ptht', at: T(2026, 10, 8), note: 'Đã đánh giá, trình QL trên 1 cấp' },
};
evaluations.P2026.u_nv_ptht = huyEval;
notify('u_gd_cntt', { type: 'evaluation_reviewed', title: 'Hồ sơ chờ phê duyệt', message: `Hồ sơ đánh giá của ${nameOf('u_nv_ptht')} chờ bạn phê duyệt.`, link: '#/eval/form/P2026/u_nv_ptht', fromId: 'u_tb_ptht', at: T(2026, 10, 8) });

const hongEval = {
  status: 'approved', version: 1, meta: { createdAt: T(2026, 9, 20), createdBy: 'u_nv_kt' },
  self: {
    kpi: kpiResults({ it_hong_1: { actual: 0, explanation: 'Không có kỳ khóa sổ trễ hạn (kết quả 0 thực tế).' }, it_hong_2: { actual: 'pass' }, it_hong_3: { actual: 5, explanation: 'Hoàn thành 100% và áp dụng kiến thức IFRS17 vào cải tiến.' }, it_hong_4: { actual: 4 } }),
    kbi: kbiLevels([4, 5, 4, 4, 5]), summary: { strengths: 'Cẩn thận, đúng hạn.', improvements: 'Mở rộng hiểu biết nghiệp vụ bảo hiểm.', proposals: 'Đào tạo IFRS 17 chuyên sâu.' }, updatedAt: T(2026, 9, 28),
  },
  manager: { kpi: {}, kbi: kbiLevels([4, 5, 4, 4, 4]), summary: { strengths: 'Chuyên môn vững, kỷ luật cao.', improvements: 'Chủ động đề xuất cải tiến quy trình.', proposals: 'Xem xét quy hoạch kế toán trưởng bộ phận.' }, updatedAt: T(2026, 10, 2) },
  skip: { comment: 'Đồng ý với đánh giá của quản lý trực tiếp.', updatedAt: T(2026, 10, 6) },
  signatures: { employee: sig('u_nv_kt', T(2026, 9, 28)), manager: sig('u_tp_kt', T(2026, 10, 2)), skip: sig('u_gd_tc', T(2026, 10, 6)) },
  statusMeta: { by: 'u_gd_tc', at: T(2026, 10, 6), note: 'Phê duyệt kết quả' },
};
evaluations.P2026.u_nv_kt = hongEval;
finalize('P2026', 'u_nv_kt', hongEval, 'u_gd_tc', T(2026, 10, 6));

// --- Kỳ 2025 (đã khóa) – dữ liệu so sánh
const p25 = (uid, items, self, mgr) => {
  plan('P2025', uid, 'approved', items, { signatures: { employee: sig(uid, T(2025, 2, 10)) } });
  const ev = { status: 'locked', version: 1, self: { kpi: kpiResults(self), kbi: kbiLevels(mgr) }, manager: { kpi: {}, kbi: kbiLevels(mgr) }, signatures: { employee: sig(uid, T(2025, 12, 20)) }, statusMeta: { by: 'u_hr', at: T(2026, 1, 22), note: 'Khóa kết quả' } };
  evaluations.P2025[uid] = ev;
  finalize('P2025', uid, ev, 'u_hr', T(2026, 1, 22));
};
const simple25 = (prefix, a, b, c) => ({
  [`${prefix}_1`]: { spec: specFromCatalog(K.lntt, 'kpi_tc_lntt', { source: 'catalog' }), weight: 15 },
  [`${prefix}_2`]: { spec: specFromCatalog(K.tuhoa, 'kpi_da_tuhoa', { source: 'catalog' }), weight: 35 },
  [`${prefix}_3`]: { spec: specFromCatalog(K.caupcn, 'kpi_da_caupcn', { source: 'catalog' }), weight: 30 },
  [`${prefix}_4`]: { spec: specFromCatalog(K.daotao, 'kpi_ns_daotao', { source: 'catalog' }), weight: 20 },
  _r: [a, b, c],
});
for (const [uid, prefix, lnt, l2, l3, l4, kbi] of [
  ['u_nv_qlda1', 'y25nam', 950, 4, 4, 4, [4, 4, 3, 4, 4]],
  ['u_nv_ptht', 'y25huy', 1010, 4, 5, 4, [4, 4, 4, 4, 5]],
  ['u_nv_kt', 'y25hong', 1010, 3, 4, 5, [4, 5, 4, 4, 4]],
  ['u_tb_qlda', 'y25ha', 1010, 5, 4, 4, [5, 4, 4, 5, 4]],
  ['u_tn_qlda', 'y25bao', 890, 3, 3, 4, [3, 4, 3, 4, 3]],
]) {
  const items = simple25(prefix); delete items._r;
  p25(uid, items, { [`${prefix}_1`]: lnt, [`${prefix}_2`]: l2, [`${prefix}_3`]: l3, [`${prefix}_4`]: l4 }, kbi);
}

// ---------------------------------------------------------------------------
// 8. Nhật ký, thông báo, hệ thống
// ---------------------------------------------------------------------------
audit({ type: 'seed', entity: 'system', entityId: 'demo', actorId: 'u_admin', actorName: nameOf('u_admin'), at: T(2026, 1, 5), reason: 'Khởi tạo dữ liệu demo POC' });
audit({ type: 'period_status', entity: 'period', entityId: 'P2026', periodId: 'P2026', actorId: 'u_hr', actorName: nameOf('u_hr'), at: T(2026, 1, 10), before: { status: 'configured' }, after: { status: 'open' }, reason: 'Mở kỳ theo kế hoạch' });
audit({ type: 'kpi_assign', entity: 'kpiPlan', entityId: 'P2026/u_gd_cntt', periodId: 'P2026', actorId: 'u_ptgd', actorName: nameOf('u_ptgd'), at: T(2026, 1, 25), after: { items: 4 }, reason: 'Giao KPI TOP-DOWN cho GĐ TT CNTT' });
audit({ type: 'weight_change', entity: 'kpiItem', entityId: 'P2026/u_gd_cntt/it_gd_3', periodId: 'P2026', actorId: 'u_gd_cntt', actorName: nameOf('u_gd_cntt'), at: T(2026, 2, 4), before: { weight: 20 }, after: { weight: 25 }, reason: 'Điều chỉnh trọng số trong phạm vi cho phép (chế độ B)' });

const data = {
  system: { initializedAt: T(2026, 1, 5), schemaVersion: 1, seedInfo: { version: 'demo-2026.1', generatedAt: Date.UTC(2026, 9, 22), note: 'Dữ liệu POC – tên người là giả lập' } },
  public: { demoEnabled: true, branding: { appName: appSettings.appName, companyName: appSettings.companyName }, demoLoginOptions },
  emailIndex,
  userProfiles,
  userAccess,
  config,
  organizationUnits: units,
  organizationVersions: { ov_P2026: orgVersion('ov_P2026', 'P2026', T(2026, 1, 10), periodUsers2026), ov_P2025: orgVersion('ov_P2025', 'P2025', T(2025, 1, 8), periodUsers2025) },
  kpiCatalogPublic,
  kpiCatalogPrivate,
  kpiCatalogAccessIndex,
  kbiCatalog,
  evaluationPeriods,
  evaluationPeriodUsers: { P2026: periodUsers2026, P2025: periodUsers2025 },
  kpiPlans: plans,
  kpiAssignments: assignments,
  evaluations,
  notifications,
  auditLogs,
};

writeFileSync(OUT, JSON.stringify(data, null, 2) + '\n');
const count = (o) => Object.keys(o || {}).length;
console.log(`Đã ghi ${OUT}`);
console.log(`  users=${count(userProfiles)} units=${count(units)} kpiPublic=${count(kpiCatalogPublic)} kpiPrivate=${count(kpiCatalogPrivate)} kbi=${count(kbiCatalog)}`);
console.log(`  plans2026=${count(plans.P2026)} evals2026=${count(evaluations.P2026)} assignments=${Object.values(assignments.P2026).reduce((s, x) => s + count(x), 0)}`);
console.log(`  final P2026/u_nv_kt:`, evaluations.P2026.u_nv_kt.final);
