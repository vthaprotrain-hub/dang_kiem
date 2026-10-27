/**
 * Kiểm thử bộ máy tính điểm:  node --test tests/
 * Dùng chính cấu hình demo trong js/seed/demo-data.json và đối chiếu với công thức Excel mẫu BM KPI2025.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { scoreValue, computeKpi, computeKbi, computeGrade, computeEvaluation, STATUS, toNumber, roundTo } from '../js/core/scoring.js';
import { evaluateExpression, validateExpression } from '../js/core/expression.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const demo = JSON.parse(readFileSync(join(root, 'js/seed/demo-data.json'), 'utf8'));
const SP = demo.config.scoringPolicies;
const GRADING = demo.config.gradingBands.default;
const KBI_POLICY = demo.config.kbiPolicies.default;
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

// ---- Công thức Excel mẫu (ô O15): trả về đóng góp đã nhân trọng số F (dạng thập phân)
function excelKpiCell(M, J, K, L, F) {
  if (M === '') return 0;
  if (M < J) return 0;
  if (M === J) return 0.8 * F;
  if (M < K) return (M / J) * 0.8 * F;
  if (M === K) return F;
  if (M < L) return (M / K) * 1 * F;
  return 1.2 * F;
}

// ---- Công thức Excel mẫu (ô D45): xếp loại theo KPI (D43, dạng thập phân) và KBI (D44)
function excelGrade(D43, D44) {
  const A = (a, b) => a && b;
  if (A(A(D43 < 0.8, D43 >= 0.7), A(D44 > 2, D44 < 3)) || A(A(D43 >= 0.7, D43 < 0.8), A(D44 > 0, D44 <= 2)) || A(A(D43 >= 0.8, D43 < 0.95), A(D44 > 0, D44 <= 2))) return 'Không hoàn thành';
  if (A(A(D43 < 0.8, D43 >= 0.7), A(D44 >= 3, D44 < 4)) || A(A(D43 >= 0.8, D43 < 0.95), A(D44 > 2, D44 < 3)) || A(A(D43 >= 0.95, D43 < 1.1), A(D44 > 2, D44 < 3))
    || A(A(D43 >= 0.95, D43 < 1.1), A(D44 > 0, D44 <= 2)) || A(A(D43 >= 1.1, D43 < 1.2), A(D44 > 0, D44 <= 2)) || A(D43 >= 1.2, D44 <= 2)) return 'Cần cố gắng';
  if (A(A(D43 >= 0.7, D43 < 0.8), A(D44 >= 4.5, D44 <= 5)) || A(A(D43 >= 0.7, D43 < 0.8), A(D44 >= 4, D44 < 4.5)) || A(A(D43 >= 0.8, D43 < 0.95), A(D44 >= 4.5, D44 <= 5))
    || A(A(D43 >= 0.8, D43 < 0.95), A(D44 >= 4, D44 < 4.5)) || A(A(D43 >= 0.8, D43 < 0.95), A(D44 >= 3, D44 < 4)) || A(A(D43 >= 0.95, D43 < 1.1), A(D44 >= 4, D44 < 4.5))
    || A(A(D43 >= 0.95, D43 < 1.1), A(D44 >= 3, D44 < 4)) || A(A(D43 >= 1.1, D43 < 1.2), A(D44 >= 3, D44 < 4)) || A(A(D43 >= 1.1, D43 < 1.2), A(D44 > 2, D44 < 3))
    || A(A(D43 >= 1.2, D43 < 2), A(D44 > 2, D44 < 3))) return 'Hoàn thành';
  if (A(A(D43 >= 0.95, D43 < 1.1), A(D44 >= 4.5, D44 <= 5)) || A(A(D43 >= 1.1, D43 < 1.2), A(D44 >= 4, D44 < 4.5)) || A(A(D43 >= 1.2, D43 < 2), A(D44 >= 3, D44 < 4))) return 'Hoàn thành tốt';
  if (A(A(D43 >= 1.1, D43 < 1.2), A(D44 >= 4.5, D44 <= 5)) || A(A(D43 >= 1.2, D43 < 2), A(D44 >= 4.5, D44 <= 5)) || A(A(D43 >= 1.2, D43 < 2), A(D44 >= 4, D44 < 4.5))) return 'Xuất sắc';
  return 'Chưa có kết quả';
}

const numericSpec = (t, b, s, extra = {}) => ({ targets: { threshold: t, base: b, stretch: s }, direction: 'higher', ...extra });

test('Ba mốc (Excel 2025): khớp công thức cột "Kết quả quy đổi" với chỉ tiêu số học', () => {
  const K = 4879, J = K * 0.8, L = K * 1.2, F = 0.1;
  for (const M of [0, 1000, 3903.19, J, 4000, 4500, K, 5000, 5854.79, L, 7000]) {
    const r = scoreValue(SP.sp_tiered_excel, numericSpec(J, K, L), M, 10);
    assert.equal(r.status, STATUS.SCORED, `M=${M}`);
    close((10 / 100) * r.ratio, excelKpiCell(M, J, K, L, F), 1e-6); // tỷ lệ được làm tròn 6 chữ số theo chính sách
  }
});

test('Ô kết quả trống KHÔNG bị tính là 0 (khác Excel), còn 0 thực tế vẫn được tính', () => {
  const spec = numericSpec(800, 1000, 1200);
  const blank = scoreValue(SP.sp_tiered_excel, spec, '');
  assert.equal(blank.status, STATUS.MISSING);
  assert.equal(blank.ratio, null);
  const zero = scoreValue(SP.sp_tiered_excel, spec, 0);
  assert.equal(zero.status, STATUS.SCORED);
  assert.equal(zero.ratio, 0);
  // Chỉ tiêu càng thấp càng tốt: 0 sự cố là kết quả tốt nhất
  const lower = scoreValue(SP.sp_tiered_lower, { targets: { threshold: 4, base: 2, stretch: 0 }, direction: 'lower' }, 0);
  assert.equal(lower.ratio, 1.2);
});

test('Thang 1–5: trùng công thức Excel với mức nguyên (Ngưỡng 3, Cơ bản 4, Đẩy mạnh 5)', () => {
  for (const M of [1, 2, 3, 4, 5]) {
    const r = scoreValue(SP.sp_scale_1_5, numericSpec(3, 4, 5, { direction: 'scale' }), M, 15);
    close(0.15 * r.ratio, excelKpiCell(M, 3, 4, 5, 0.15));
  }
  assert.equal(scoreValue(SP.sp_scale_1_5, numericSpec(3, 4, 5), 3.5).status, STATUS.INVALID, 'mức lẻ không được phép theo cấu hình');
});

test('Lưu ý mẫu Excel: nội suy KQ/Ngưỡng×80% không đơn điệu với thang 1–5 (3,9 > 4)', () => {
  const at39 = scoreValue(SP.sp_tiered_excel, numericSpec(3, 4, 5), 3.9).ratio;
  const at4 = scoreValue(SP.sp_tiered_excel, numericSpec(3, 4, 5), 4).ratio;
  assert.ok(at39 > at4, 'đúng như công thức Excel gốc – lý do demo dùng thang mức cho chỉ tiêu định tính');
  const lin39 = scoreValue(SP.sp_tiered_linear, numericSpec(3, 4, 5), 3.9).ratio;
  assert.ok(lin39 < 1, 'phương pháp tuyến tính đơn điệu');
});

test('Càng thấp càng tốt (tuyến tính) và kiểm tra thứ tự mục tiêu', () => {
  const spec = { targets: { threshold: 4, base: 2, stretch: 0 }, direction: 'lower' };
  const exp = { 5: 0, 4: 0.8, 3: 0.9, 2: 1, 1: 1.1, 0: 1.2 };
  for (const [a, r] of Object.entries(exp)) close(scoreValue(SP.sp_tiered_lower, spec, Number(a)).ratio, r);
  assert.equal(scoreValue(SP.sp_tiered_lower, { targets: { threshold: 1, base: 2, stretch: 3 }, direction: 'lower' }, 1).status, STATUS.INVALID);
});

test('Không chia cho 0; công thức tùy biến an toàn', () => {
  assert.equal(scoreValue(SP.sp_ratio, { targets: { base: 0 } }, 5).status, STATUS.INVALID);
  assert.equal(scoreValue(SP.sp_formula_demo, { targets: { base: 0 } }, 5).status, STATUS.INVALID);
  close(scoreValue(SP.sp_formula_demo, { targets: { base: 200 } }, 150).ratio, 0.75);
  close(scoreValue(SP.sp_formula_demo, { targets: { base: 100 } }, 500).ratio, 1.2);
  assert.equal(evaluateExpression('if(A >= B, 1, A / B)', { A: 2, B: 4 }), 0.5);
  assert.equal(evaluateExpression('A + 1', { A: null }), null);
  assert.equal(validateExpression('A / B + X').ok, false);
  assert.equal(validateExpression('max(A, ').ok, false);
  assert.equal(validateExpression('round(A / B * 100, 2)').ok, true);
});

test('Đạt/Không đạt và bảng bậc mốc tiến độ', () => {
  assert.equal(scoreValue(SP.sp_pass_fail, {}, 'pass').ratio, 1);
  assert.equal(scoreValue(SP.sp_pass_fail, {}, 'fail').ratio, 0);
  assert.equal(scoreValue(SP.sp_pass_fail, {}, 'maybe').status, STATUS.INVALID);
  assert.equal(scoreValue(SP.sp_milestone, {}, 100).ratio, 1);
  assert.equal(scoreValue(SP.sp_milestone, {}, 95).ratio, 0.8);
  assert.equal(scoreValue(SP.sp_milestone, {}, 50).ratio, 0);
});

test('Chính sách thiếu tham số => invalid_config (không dùng giá trị ngầm định)', () => {
  const broken = { method: 'tiered', params: { anchors: { threshold: 0.8, base: 1 } } };
  assert.equal(scoreValue(broken, numericSpec(1, 2, 3), 2).status, STATUS.INVALID);
  assert.equal(scoreValue(null, numericSpec(1, 2, 3), 2).status, STATUS.INVALID);
});

const policies = demo.evaluationPeriods.P2026.policies;
const tierItem = (w, t, b, s, extra = {}) => ({ spec: { title: 'x', groupId: 'g', state: 'active', scoring: { policyId: 'sp_tiered_excel' }, targets: { threshold: t, base: b, stretch: s }, direction: 'higher', ...extra }, weight: w });

test('Tổng điểm KPI = Σ W×S; thiếu dữ liệu => tạm tính, chưa hoàn thành', () => {
  const items = { a: tierItem(60, 80, 100, 120), b: tierItem(40, 80, 100, 120) };
  const full = computeKpi({ items, getActual: (id) => ({ value: { a: 100, b: 110 }[id] }), scoringPolicies: policies.scoring, weightPolicy: policies.weight, aggregationPolicy: policies.kpiAggregation });
  close(full.total, 0.6 * 1 + 0.4 * 1.1);
  assert.equal(full.complete, true);
  const partial = computeKpi({ items, getActual: (id) => ({ value: { a: 100 }[id] }), scoringPolicies: policies.scoring, weightPolicy: policies.weight, aggregationPolicy: policies.kpiAggregation });
  assert.equal(partial.total, null);
  close(partial.provisionalTotal, 0.6);
  assert.deepEqual(partial.missing, ['b']);
  const badWeight = computeKpi({ items: { a: tierItem(60, 80, 100, 120) }, getActual: () => ({ value: 100 }), scoringPolicies: policies.scoring, weightPolicy: policies.weight, aggregationPolicy: policies.kpiAggregation });
  assert.equal(badWeight.weightValid, false);
  assert.equal(badWeight.complete, false);
});

test('Sub-KPI: không tính trùng; các phương pháp tổng hợp và xử lý con thiếu/thu hồi', () => {
  const base = (method, missingChild = 'exclude', extra = {}) => ({
    p: tierItem(50, 80, 100, 120, { aggregation: { method, missingChild, ...extra } }),
    c1: tierItem(60, 80, 100, 120, { parentItemId: 'p' }),
    c2: tierItem(40, 80, 100, 120, { parentItemId: 'p' }),
    q: tierItem(50, 80, 100, 120),
  });
  const run = (items, actual) => computeKpi({ items, getActual: (id) => ({ value: actual[id] }), scoringPolicies: policies.scoring, weightPolicy: policies.weight, aggregationPolicy: policies.kpiAggregation });
  // children_replace: cha = 60%×100% + 40%×80% = 92%
  let r = run(base('children_replace'), { c1: 100, c2: 80, q: 100 });
  close(r.rows.find((x) => x.id === 'p').ratio, 0.92);
  assert.equal(r.totalWeight, 100, 'trọng số chỉ tính KPI cấp cao nhất');
  close(r.total, 0.5 * 0.92 + 0.5 * 1);
  assert.equal(r.rows.find((x) => x.id === 'c1').counted, false);
  // direct: con chỉ theo dõi
  r = run(base('direct'), { p: 110, c1: 50, c2: 50, q: 100 });
  close(r.total, 0.5 * 1.1 + 0.5);
  // con thiếu dữ liệu: exclude => chuẩn hóa lại; block => cha thiếu dữ liệu; zero => tính 0
  close(run(base('children_replace', 'exclude'), { c1: 100, q: 100 }).rows.find((x) => x.id === 'p').ratio, 1);
  assert.equal(run(base('children_replace', 'block'), { c1: 100, q: 100 }).rows.find((x) => x.id === 'p').status, STATUS.MISSING);
  close(run(base('children_replace', 'zero'), { c1: 100, q: 100 }).rows.find((x) => x.id === 'p').ratio, 0.6);
  // children_weighted 50/50
  close(run(base('children_weighted', 'exclude', { parentShare: 0.5 }), { p: 120, c1: 100, c2: 100, q: 100 }).rows.find((x) => x.id === 'p').ratio, 1.1);
  // con bị thu hồi không tính
  const items = base('children_replace');
  items.c2.spec.state = 'revoked';
  r = run(items, { c1: 90, c2: 0, q: 100 });
  close(r.rows.find((x) => x.id === 'p').ratio, scoreValue(policies.scoring.sp_tiered_excel, items.c1.spec, 90).ratio);
  assert.equal(r.rows.find((x) => x.id === 'c2').status, STATUS.EXCLUDED);
});

test('KBI: điểm quản lý là chính thức, lưu riêng điểm tự đánh giá, quy tắc giới hạn mức 3', () => {
  const values = ['v1', 'v2', 'v3', 'v4', 'v5'].map((id) => ({ id, name: id, weight: 1 }));
  const self = Object.fromEntries(values.map((v) => [v.id, { level: 5 }]));
  const mgr = { v1: { level: 4 }, v2: { level: 4, negativeBehavior: true }, v3: { level: 3 }, v4: { level: 5 }, v5: { level: 4 } };
  const r = computeKbi({ values, self, manager: mgr, policy: KBI_POLICY });
  assert.equal(r.rows[0].self, 5);
  assert.equal(r.rows[1].official, 3, 'mức 4 có hành vi mức 1–2 → tối đa 3');
  assert.equal(r.rows[1].capped, true);
  close(r.average, (4 + 3 + 3 + 5 + 4) / 5);
  const inc = computeKbi({ values, self, manager: { v1: { level: 4 } }, policy: KBI_POLICY });
  assert.equal(inc.complete, false);
  assert.equal(inc.average, null, 'chưa chấm không được coi là 0');
});

test('Ma trận xếp loại khớp công thức Excel 2025 trên toàn lưới KPI × KBI', () => {
  const mapCode = (c) => GRADING.grades[c].label;
  let compared = 0, differ = 0;
  for (let k2 = 120; k2 <= 280; k2++) {
    const kpiPct = k2 / 2; // 60% → 140% bước 0,5
    for (let b = 20; b <= 100; b++) {
      const kbi = b / 20; // 1 → 5 bước 0,05
      const ours = computeGrade({ kpi: { complete: true, total: kpiPct / 100 }, kbi: { complete: true, average: kbi, rows: [] }, policy: GRADING });
      const xl = excelGrade(kpiPct / 100, kbi);
      compared++;
      if (kpiPct < 70) {
        assert.equal(xl, 'Chưa có kết quả');
        assert.equal(ours.code, 'KHT', 'giả định demo cho vùng Excel chưa định nghĩa');
        differ++;
        continue;
      }
      assert.equal(ours.status, 'official');
      assert.equal(mapCode(ours.code), xl, `KPI ${kpiPct}% KBI ${kbi}`);
    }
  }
  assert.ok(compared > 10000 && differ > 0);
});

test('Không xếp loại chính thức khi thiếu dữ liệu bắt buộc', () => {
  const g = computeGrade({ kpi: { complete: false, total: null, provisionalTotal: 0.9, missing: ['a'] }, kbi: { complete: true, average: 4 }, policy: GRADING });
  assert.equal(g.status, 'incomplete');
  assert.equal(g.code, null);
  assert.ok(g.reasons.some((x) => x.includes('chưa có kết quả')));
  const prov = computeGrade({ kpi: { complete: false, total: null, provisionalTotal: 0.9, missing: ['a'] }, kbi: { complete: true, average: 4 }, policy: GRADING, allowProvisional: true });
  assert.equal(prov.status, 'provisional');
});

test('Phương án xếp loại theo tỷ trọng KPI/KBI (cấu hình thay thế)', () => {
  const policy = { ...GRADING, method: 'weighted' };
  const g = computeGrade({ kpi: { complete: true, total: 1.0 }, kbi: { complete: true, average: 4 }, policy });
  close(g.score, 0.7 * 100 + 0.3 * 80);
  assert.equal(g.code, 'HT');
});

test('Kết quả cuối kỳ trong dữ liệu demo khớp với bộ máy tính điểm', () => {
  const kbiValues = Object.entries(demo.kbiCatalog).map(([id, v]) => ({ id, name: v.name, weight: v.weight }));
  for (const [p, evs] of Object.entries(demo.evaluations)) {
    for (const [u, ev] of Object.entries(evs)) {
      if (!ev.final) continue;
      const r = computeEvaluation({ plan: demo.kpiPlans[p][u], evaluation: ev, policies: demo.evaluationPeriods[p].policies, kbiValues });
      assert.equal(r.kpi.total, ev.final.kpiScore, `${p}/${u}`);
      assert.equal(r.kbi.average, ev.final.kbiScore);
      assert.equal(r.grade.code, ev.final.gradeCode);
    }
  }
});

test('Tiện ích số học', () => {
  assert.equal(toNumber('1.234,5'), 1234.5);
  assert.equal(toNumber('12,5'), 12.5);
  assert.equal(toNumber(''), null);
  assert.ok(Number.isNaN(toNumber('abc')));
  assert.equal(roundTo(1.005, 2), 1.01);
});
