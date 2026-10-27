// Kiểm thử "Thêm KPI từ năm trước" (js/core/carryover.js) trên dữ liệu thật của kỳ 2025.
//   node --test tests/carryover.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { classifyCarryOver, buildCarryItems, effectiveSelection, CARRY } from '../js/core/carryover.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const D = JSON.parse(readFileSync(join(root, 'js/seed/opes-kpi-data.json'), 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));
const plan = (u) => clone(D.kpiPlans.P2025[u]);
const catalog = () => ({ public: clone(D.kpiCatalogPublic), private: clone(D.kpiCatalogPrivate) });
const base = (u, extra = {}) => ({ prevPlan: plan(u), catalog: catalog(), currentPlan: null, scoringPolicies: D.config.scoringPolicies, kpiGroups: D.config.kpiGroups, ...extra });
const byId = (rows) => Object.fromEntries(rows.map((r) => [r.id, r]));
const catalogSpec = (k, id) => ({ title: k.name, groupId: k.groupId, scoring: { policyId: k.scoringPolicyId }, targets: clone(k.targets || {}), catalogRef: { id, code: k.code, version: k.version, visibility: k.visibility }, catalogSnapshot: { code: k.code } });

test('KPI danh mục hợp lệ → "Từ danh mục"; KPI tự tạo/được giao ngoài danh mục → "Tạo mới"', () => {
  const r = byId(classifyCarryOver(base('u_nv_qlda2')));
  assert.equal(r.mai1.status, CARRY.CATALOG); // XCG – được giao nhưng thuộc danh mục
  assert.equal(r.mai2.status, CARRY.NEW); // tự tạo
  assert.equal(r.mai3.status, CARRY.CATALOG);
  assert.equal(r.mai4.status, CARRY.CATALOG);
  assert.equal(r.mai1.defaultSelected, false, 'KPI do cấp trên giao năm trước không được chọn sẵn');
  assert.equal(r.mai2.defaultSelected, true);
  const r2 = byId(classifyCarryOver(base('u_nv_qlda1')));
  assert.equal(r2.nam1.status, CARRY.NEW, 'KPI được giao ngoài danh mục → tạo mới');
  assert.match(r2.nam1.reason, /cấp trên giao/);
});

test('Đối chiếu danh mục: ngừng sử dụng / không áp dụng / Private hết quyền → không được phép; đã xóa khỏi danh mục → tạo mới', () => {
  const c = catalog();
  c.public.kpi_ns_daotao.status = 'inactive';
  delete c.public.kpi_ns_vhdn;
  const r = byId(classifyCarryOver(base('u_nv_qlda2', { catalog: c })));
  assert.equal(r.mai3.status, CARRY.BLOCKED);
  assert.match(r.mai3.reason, /ngừng sử dụng/);
  assert.equal(r.mai4.status, CARRY.NEW);
  assert.match(r.mai4.reason, /không còn trong danh mục/);
  const r2 = byId(classifyCarryOver(base('u_nv_qlda2', { isApplicable: (k) => k.code !== 'DA-04' })));
  assert.equal(r2.mai1.status, CARRY.BLOCKED);
  assert.match(r2.mai1.reason, /không áp dụng/);
  const c3 = catalog(); c3.private = {}; // người dùng không còn quyền đọc KPI Private
  const r3 = byId(classifyCarryOver(base('u_tb_qlda', { catalog: c3 })));
  assert.equal(r3.qd2.status, CARRY.BLOCKED);
  assert.match(r3.qd2.reason, /Private/);
});

test('Trùng với kế hoạch hiện tại → không chọn được; phương pháp tính điểm không còn → không được phép', () => {
  const current = { items: { x: { spec: { title: 'Khác', catalogRef: { id: 'kpi_ns_daotao' }, state: 'active' }, weight: 10 }, y: { spec: { title: 'số lỗi đặc tả yêu cầu bị trả lại   trong năm', state: 'active' }, weight: 10 } } };
  const r = byId(classifyCarryOver(base('u_nv_qlda2', { currentPlan: current })));
  assert.equal(r.mai3.status, CARRY.DUPLICATE);
  assert.equal(r.mai2.status, CARRY.DUPLICATE, 'so khớp tên không phân biệt hoa thường/khoảng trắng');
  const sp = clone(D.config.scoringPolicies); delete sp.sp_tiered_lower;
  const r2 = byId(classifyCarryOver(base('u_nv_qlda2', { scoringPolicies: sp })));
  assert.equal(r2.mai2.status, CARRY.BLOCKED);
  const g = clone(D.config.kpiGroups); delete g.grp_cl;
  const r3 = byId(classifyCarryOver(base('u_nv_qlda2', { kpiGroups: g })));
  assert.equal(r3.mai2.status, CARRY.NEW);
  assert.equal(r3.mai2.groupOverride, 'grp_khac');
});

test('Sub-KPI đi kèm KPI cha, giữ cách tổng hợp; bỏ KPI cha thì bỏ sub-KPI', () => {
  const rows = classifyCarryOver(base('u_tb_qlda'));
  const r = byId(rows);
  assert.equal(r.qd1a.parentId, 'qd1');
  assert.equal(r.qd1a.depth, 1);
  const items = buildCarryItems(rows, new Set(['qd1', 'qd1a', 'qd1b', 'qd3']), { catalogSpec, sourcePeriodId: 'P2025' });
  const parent = items.find((i) => i.fromId === 'qd1');
  assert.equal(parent.source, 'catalog');
  assert.equal(parent.spec.aggregation.method, 'children_replace');
  assert.equal(parent.spec.title, 'Triển khai các dự án trọng điểm của TT CNTT năm 2025 (cấu phần công nghệ)', 'giữ tên đã điều chỉnh');
  const kid = items.find((i) => i.fromId === 'qd1a');
  assert.equal(kid.source, 'sub');
  assert.equal(kid.parentFromId, 'qd1');
  assert.equal(kid.weight, 60);
  for (const it of items) for (const k of ['assignmentId', 'assignedBy', 'weightMode', 'minWeight', 'parentRef']) assert.equal(it.spec[k], undefined, `không mang ${k} của kỳ cũ`);
  const noParent = effectiveSelection(rows, new Set(['qd1a', 'qd3']));
  assert.deepEqual(noParent.map((x) => x.id), ['qd3']);
  const onlyParent = buildCarryItems(rows, new Set(['qd1']), { catalogSpec, sourcePeriodId: 'P2025' });
  assert.equal(onlyParent[0].spec.aggregation, undefined, 'không có sub-KPI → chấm trực tiếp');
});

test('Mục tiêu: giữ của năm trước hoặc dùng danh mục hiện hành; trọng số có thể sửa', () => {
  const rows = classifyCarryOver(base('u_tp_banca'));
  const keep = buildCarryItems(rows, new Set(['tb1']), { catalogSpec, sourcePeriodId: 'P2025', weights: { tb1: 50 } });
  assert.deepEqual(keep[0].spec.targets, { threshold: 720, base: 900, stretch: 1080 });
  assert.equal(keep[0].weight, 50);
  const fresh = buildCarryItems(rows, new Set(['tb1']), { catalogSpec, sourcePeriodId: 'P2025', keepTargets: false });
  assert.deepEqual(fresh[0].spec.targets, D.kpiCatalogPublic.kpi_kd_banca.targets);
  assert.equal(fresh[0].spec.copiedFrom.periodId, 'P2025');
});

test('Toàn bộ 20 kế hoạch 2025 đều phân loại được, không có KPI hợp lệ bị chặn nhầm', () => {
  for (const u of Object.keys(D.kpiPlans.P2025)) {
    const rows = classifyCarryOver(base(u));
    assert.ok(rows.length > 0, u);
    for (const r of rows) assert.ok([CARRY.CATALOG, CARRY.NEW].includes(r.status), `${u}/${r.id}: ${r.status} – ${r.reason}`);
    const all = buildCarryItems(rows, new Set(rows.map((r) => r.id)), { catalogSpec, sourcePeriodId: 'P2025' });
    const total = all.filter((i) => !i.parentFromId).reduce((s, i) => s + i.weight, 0);
    assert.equal(total, 100, `${u}: chọn tất cả → tổng trọng số 100%`);
  }
});
