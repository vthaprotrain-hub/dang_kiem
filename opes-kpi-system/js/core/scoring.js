/**
 * Bộ máy tính điểm KPI / KBI / xếp loại – thuần JavaScript, không phụ thuộc DOM hay Firebase,
 * để có thể kiểm thử độc lập (xem tests/scoring.test.mjs).
 *
 * Nguyên tắc:
 *  - Không có công thức "ngầm định": mọi tham số (mốc quy đổi, cách nội suy, xử lý thiếu dữ liệu,
 *    ngưỡng xếp loại...) đều đến từ chính sách cấu hình. Thiếu tham số => trạng thái invalid_config.
 *  - Dữ liệu trống KHÔNG phải 0: trạng thái "missing" được tách riêng với kết quả 0 thực tế.
 *  - Trọng số (W) biểu diễn theo % (tổng 100); điểm quy đổi (S) là tỷ lệ hoàn thành (1 = 100%).
 *    Đóng góp của một chỉ tiêu = W/100 × S; điểm KPI tổng = Σ đóng góp (1 = 100%).
 */
import { evaluateExpression } from './expression.js';

export const STATUS = Object.freeze({
  SCORED: 'scored',
  MISSING: 'missing',
  INVALID: 'invalid_config',
  EXCLUDED: 'excluded',
});

export const STATUS_LABEL = Object.freeze({
  scored: 'Đã tính',
  missing: 'Chưa có dữ liệu',
  invalid_config: 'Cấu hình chưa hợp lệ',
  excluded: 'Không tính điểm',
});

const EPS = 1e-9;

export function isBlank(v) {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

/** Chuyển về số. Trả về null nếu trống, NaN nếu không phải số. Chấp nhận "1,5" và "1.234,5". */
export function toNumber(v) {
  if (isBlank(v)) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  if (typeof v === 'boolean') return v ? 1 : 0;
  let s = String(v).trim().replace(/\s/g, '');
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

export function roundTo(x, decimals = 2, mode = 'round') {
  if (x === null || x === undefined || !Number.isFinite(x)) return x;
  const f = 10 ** decimals;
  const y = x * f;
  if (mode === 'floor') return Math.floor(y + EPS) / f;
  if (mode === 'ceil') return Math.ceil(y - EPS) / f;
  return Math.round(y + Math.sign(y) * EPS) / f;
}

const pct = (r, d = 2) => (r === null || r === undefined ? '—' : `${roundTo(r * 100, d)}%`);
const nfmt = (n) => (n === null || n === undefined ? '—' : String(roundTo(n, 4)));

function result(status, ratio, explanation, extra = {}) {
  return { status, ratio: status === STATUS.SCORED ? ratio : null, explanation, ...extra };
}
const invalid = (msg) => result(STATUS.INVALID, null, msg);
const missing = (msg = 'Chưa có kết quả thực hiện') => result(STATUS.MISSING, null, msg);

// ---------------------------------------------------------------------------
// Các phương pháp quy đổi kết quả của 1 chỉ tiêu -> tỷ lệ hoàn thành
// ---------------------------------------------------------------------------

function readTargets(spec) {
  const t = toNumber(spec?.targets?.threshold);
  const b = toNumber(spec?.targets?.base);
  const s = toNumber(spec?.targets?.stretch);
  return { t, b, s };
}

function directionOf(policy, spec) {
  const d = policy?.params?.direction || spec?.direction || 'higher';
  return d === 'lower' ? 'lower' : 'higher';
}

/** Phương pháp 3 mốc Ngưỡng – Cơ bản – Đẩy mạnh. */
function scoreTiered(policy, spec, A) {
  const p = policy.params || {};
  const an = p.anchors || {};
  const at = toNumber(an.threshold), ab = toNumber(an.base), as = toNumber(an.stretch);
  if ([at, ab, as].some((x) => x === null || Number.isNaN(x))) {
    return invalid('Chính sách chưa cấu hình tỷ lệ quy đổi cho các mốc Ngưỡng/Cơ bản/Đẩy mạnh');
  }
  const below = toNumber(p.belowThreshold);
  if (below === null || Number.isNaN(below)) return invalid('Chính sách chưa cấu hình điểm khi dưới Ngưỡng');
  const mode = p.interpolation;
  if (!['excel_ratio', 'linear', 'step'].includes(mode)) return invalid('Chính sách chưa cấu hình cách nội suy');
  const { t, b, s } = readTargets(spec);
  if ([t, b, s].some((x) => x === null || Number.isNaN(x))) return invalid('Cần nhập đủ mục tiêu Ngưỡng, Cơ bản và Đẩy mạnh');
  const dir = directionOf(policy, spec);

  if (dir === 'higher') {
    if (!(t <= b && b <= s)) return invalid('Mục tiêu (càng cao càng tốt) phải thỏa Ngưỡng ≤ Cơ bản ≤ Đẩy mạnh');
    if (A < t) return result(STATUS.SCORED, below, `KQ ${nfmt(A)} < Ngưỡng ${nfmt(t)} → ${pct(below)}`);
    if (mode === 'step') {
      const r = A >= s ? as : A >= b ? ab : at;
      return result(STATUS.SCORED, r, `Quy đổi theo bậc → ${pct(r)}`);
    }
    if (mode === 'excel_ratio') {
      if (A === t) return result(STATUS.SCORED, at, `KQ = Ngưỡng → ${pct(at)}`);
      if (A < b) {
        if (t <= 0) return invalid('Ngưỡng phải > 0 để chia tỷ lệ');
        const r = (A / t) * at;
        return result(STATUS.SCORED, r, `KQ/Ngưỡng × ${pct(at)} = ${pct(r)}`);
      }
      if (A === b) return result(STATUS.SCORED, ab, `KQ = Cơ bản → ${pct(ab)}`);
      if (A < s) {
        if (b <= 0) return invalid('Cơ bản phải > 0 để chia tỷ lệ');
        const r = (A / b) * ab;
        return result(STATUS.SCORED, r, `KQ/Cơ bản × ${pct(ab)} = ${pct(r)}`);
      }
      return result(STATUS.SCORED, as, `KQ ≥ Đẩy mạnh → ${pct(as)}`);
    }
    // linear
    if (A < b) {
      const r = b === t ? ab : at + ((A - t) / (b - t)) * (ab - at);
      return result(STATUS.SCORED, r, `Nội suy tuyến tính Ngưỡng→Cơ bản = ${pct(r)}`);
    }
    if (A < s) {
      const r = s === b ? as : ab + ((A - b) / (s - b)) * (as - ab);
      return result(STATUS.SCORED, r, `Nội suy tuyến tính Cơ bản→Đẩy mạnh = ${pct(r)}`);
    }
    if (p.aboveStretch === 'extrapolate' && s > b) {
      const r = as + ((A - s) / (s - b)) * (as - ab);
      return result(STATUS.SCORED, r, `Ngoại suy vượt Đẩy mạnh = ${pct(r)}`);
    }
    return result(STATUS.SCORED, as, `KQ ≥ Đẩy mạnh → ${pct(as)}`);
  }

  // Càng thấp càng tốt: Ngưỡng ≥ Cơ bản ≥ Đẩy mạnh
  if (!(t >= b && b >= s)) return invalid('Mục tiêu (càng thấp càng tốt) phải thỏa Ngưỡng ≥ Cơ bản ≥ Đẩy mạnh');
  if (A > t) return result(STATUS.SCORED, below, `KQ ${nfmt(A)} > Ngưỡng ${nfmt(t)} → ${pct(below)}`);
  if (mode === 'step') {
    const r = A <= s ? as : A <= b ? ab : at;
    return result(STATUS.SCORED, r, `Quy đổi theo bậc → ${pct(r)}`);
  }
  if (mode === 'excel_ratio') {
    if (A === t) return result(STATUS.SCORED, at, `KQ = Ngưỡng → ${pct(at)}`);
    if (A > b) {
      if (A <= 0) return invalid('Không thể chia tỷ lệ với kết quả ≤ 0');
      const r = (t / A) * at;
      return result(STATUS.SCORED, r, `Ngưỡng/KQ × ${pct(at)} = ${pct(r)}`);
    }
    if (A === b) return result(STATUS.SCORED, ab, `KQ = Cơ bản → ${pct(ab)}`);
    if (A > s) {
      if (A <= 0) return invalid('Không thể chia tỷ lệ với kết quả ≤ 0');
      const r = (b / A) * ab;
      return result(STATUS.SCORED, r, `Cơ bản/KQ × ${pct(ab)} = ${pct(r)}`);
    }
    return result(STATUS.SCORED, as, `KQ ≤ Đẩy mạnh → ${pct(as)}`);
  }
  if (A > b) {
    const r = t === b ? ab : at + ((t - A) / (t - b)) * (ab - at);
    return result(STATUS.SCORED, r, `Nội suy tuyến tính Ngưỡng→Cơ bản = ${pct(r)}`);
  }
  if (A > s) {
    const r = b === s ? as : ab + ((b - A) / (b - s)) * (as - ab);
    return result(STATUS.SCORED, r, `Nội suy tuyến tính Cơ bản→Đẩy mạnh = ${pct(r)}`);
  }
  return result(STATUS.SCORED, as, `KQ ≤ Đẩy mạnh → ${pct(as)}`);
}

/** Thang mức (định tính 1–5): ánh xạ mức -> tỷ lệ theo bảng cấu hình. */
function scoreScale(policy, spec, A) {
  const p = policy.params || {};
  const levels = p.levels;
  if (!levels || typeof levels !== 'object' || !Object.keys(levels).length) return invalid('Chính sách chưa cấu hình bảng quy đổi mức');
  const key = String(A);
  if (Object.prototype.hasOwnProperty.call(levels, key)) {
    const r = toNumber(levels[key]);
    if (r === null || Number.isNaN(r)) return invalid(`Mức ${key} chưa có tỷ lệ quy đổi`);
    return result(STATUS.SCORED, r, `Mức ${key} → ${pct(r)}`);
  }
  if (p.allowDecimal) {
    const lo = Math.floor(A), hi = Math.ceil(A);
    const rlo = toNumber(levels[String(lo)]), rhi = toNumber(levels[String(hi)]);
    if (rlo !== null && rhi !== null && !Number.isNaN(rlo) && !Number.isNaN(rhi)) {
      const r = rlo + (A - lo) * (rhi - rlo);
      return result(STATUS.SCORED, r, `Mức ${A} (nội suy) → ${pct(r)}`);
    }
  }
  return invalid(`Mức ${A} không thuộc thang quy đổi (${Object.keys(levels).join(', ')})`);
}

/** Tỷ lệ đơn giản: KQ/Cơ bản (càng cao càng tốt) hoặc Cơ bản/KQ (càng thấp càng tốt). */
function scoreRatio(policy, spec, A) {
  const { b } = readTargets(spec);
  if (b === null || Number.isNaN(b)) return invalid('Cần nhập mục tiêu Cơ bản');
  const dir = directionOf(policy, spec);
  if (dir === 'higher') {
    if (b <= 0) return invalid('Mục tiêu Cơ bản phải > 0 để chia tỷ lệ');
    const r = A / b;
    return result(STATUS.SCORED, r, `KQ/Cơ bản = ${pct(r)}`);
  }
  if (A <= 0) {
    const cap = toNumber(policy.params?.maxRatio);
    if (cap === null || Number.isNaN(cap)) return invalid('KQ = 0 với chỉ tiêu càng thấp càng tốt cần cấu hình tỷ lệ tối đa');
    return result(STATUS.SCORED, cap, `KQ ≤ 0 → tỷ lệ tối đa ${pct(cap)}`);
  }
  const r = b / A;
  return result(STATUS.SCORED, r, `Cơ bản/KQ = ${pct(r)}`);
}

const PASS_VALUES = ['pass', 'dat', 'đạt', 'yes', 'true', '1'];
const FAIL_VALUES = ['fail', 'khong_dat', 'không đạt', 'no', 'false', '0'];

function scorePassFail(policy, spec, raw) {
  const p = policy.params || {};
  const pr = toNumber(p.passRatio), fr = toNumber(p.failRatio);
  if (pr === null || fr === null || Number.isNaN(pr) || Number.isNaN(fr)) return invalid('Chính sách chưa cấu hình tỷ lệ Đạt/Không đạt');
  const v = String(raw).trim().toLowerCase();
  if (PASS_VALUES.includes(v)) return result(STATUS.SCORED, pr, `Đạt → ${pct(pr)}`);
  if (FAIL_VALUES.includes(v)) return result(STATUS.SCORED, fr, `Không đạt → ${pct(fr)}`);
  return invalid('Kết quả phải là Đạt hoặc Không đạt');
}

/** Bảng bậc: ví dụ % hoàn thành mốc tiến độ ≥ 100 → 100%, ≥ 90 → 80%... */
function scoreStepTable(policy, spec, A) {
  const p = policy.params || {};
  const steps = Array.isArray(p.steps) ? p.steps : Object.values(p.steps || {});
  if (!steps.length) return invalid('Chính sách chưa cấu hình bảng bậc');
  const below = toNumber(p.below);
  if (below === null || Number.isNaN(below)) return invalid('Chính sách chưa cấu hình tỷ lệ khi không đạt bậc nào');
  const dir = directionOf(policy, spec);
  const sorted = steps
    .map((s) => ({ bound: toNumber(s.bound), ratio: toNumber(s.ratio), label: s.label || '' }))
    .filter((s) => s.bound !== null && !Number.isNaN(s.bound) && s.ratio !== null && !Number.isNaN(s.ratio))
    .sort((x, y) => (dir === 'higher' ? y.bound - x.bound : x.bound - y.bound));
  for (const s of sorted) {
    if ((dir === 'higher' && A >= s.bound - EPS) || (dir === 'lower' && A <= s.bound + EPS)) {
      return result(STATUS.SCORED, s.ratio, `KQ ${nfmt(A)} ${dir === 'higher' ? '≥' : '≤'} ${nfmt(s.bound)} → ${pct(s.ratio)}`);
    }
  }
  return result(STATUS.SCORED, below, `Không đạt bậc nào → ${pct(below)}`);
}

function scoreFormula(policy, spec, A, weight) {
  const expr = policy.params?.expression;
  if (!expr) return invalid('Chính sách chưa có biểu thức công thức');
  const { t, b, s } = readTargets(spec);
  const vars = { A, T: Number.isNaN(t) ? null : t, B: Number.isNaN(b) ? null : b, S: Number.isNaN(s) ? null : s, W: weight ?? null };
  try {
    const r = evaluateExpression(expr, vars);
    if (r === null) return invalid('Công thức cần thêm dữ liệu mục tiêu (T/B/S)');
    return result(STATUS.SCORED, r, `Công thức ${expr} = ${pct(r)}`);
  } catch (e) {
    return invalid(`Lỗi công thức: ${e.message}`);
  }
}

export const METHODS = Object.freeze({
  tiered: { label: 'Ba mốc Ngưỡng – Cơ bản – Đẩy mạnh', fn: scoreTiered, numeric: true },
  scale_levels: { label: 'Thang mức định tính (1–5)', fn: scoreScale, numeric: true },
  ratio: { label: 'Tỷ lệ so với mục tiêu Cơ bản', fn: scoreRatio, numeric: true },
  pass_fail: { label: 'Đạt / Không đạt', fn: scorePassFail, numeric: false },
  step_table: { label: 'Bảng bậc (mốc tiến độ, % hoàn thành)', fn: scoreStepTable, numeric: true },
  formula: { label: 'Công thức tùy biến', fn: scoreFormula, numeric: true },
});

/**
 * Quy đổi kết quả thực hiện của 1 chỉ tiêu.
 * @returns {{status, ratio, explanation, actual}}
 */
export function scoreValue(policy, spec, actualRaw, weight = null) {
  if (!policy || !policy.method) return invalid('Chỉ tiêu chưa được gán phương pháp tính điểm hợp lệ');
  const method = METHODS[policy.method];
  if (!method) return invalid(`Phương pháp tính "${policy.method}" chưa được hỗ trợ`);
  const p = policy.params || {};
  if (isBlank(actualRaw)) {
    if (p.missing === 'zero') return result(STATUS.SCORED, 0, 'Thiếu dữ liệu – tính 0% theo cấu hình chính sách', { actual: null, assumedZero: true });
    return { ...missing(), actual: null };
  }
  let A = actualRaw;
  if (method.numeric) {
    A = toNumber(actualRaw);
    if (Number.isNaN(A)) return { ...invalid('Kết quả thực hiện không phải là số'), actual: actualRaw };
  }
  let r = method.fn(policy, spec, A, weight);
  if (r.status === STATUS.SCORED) {
    let ratio = r.ratio;
    const minR = toNumber(p.minRatio), maxR = toNumber(p.maxRatio);
    let note = '';
    if (minR !== null && !Number.isNaN(minR) && ratio < minR) { ratio = minR; note = ` (giới hạn dưới ${pct(minR)})`; }
    if (maxR !== null && !Number.isNaN(maxR) && ratio > maxR) { ratio = maxR; note = ` (giới hạn trên ${pct(maxR)})`; }
    const dec = Number.isInteger(p.ratioDecimals) ? p.ratioDecimals : 6;
    ratio = roundTo(ratio, dec, p.roundingMode || 'round');
    r = { ...r, ratio, explanation: r.explanation + note };
  }
  return { ...r, actual: A };
}

// ---------------------------------------------------------------------------
// Tổng hợp KPI của một kế hoạch
// ---------------------------------------------------------------------------

function toItemList(items) {
  if (!items) return [];
  if (Array.isArray(items)) return items.filter(Boolean);
  return Object.entries(items).map(([id, it]) => ({ id, ...it }));
}

export const AGGREGATION_LABEL = Object.freeze({
  direct: 'Chấm trực tiếp trên KPI cha (KPI con chỉ theo dõi)',
  children_replace: 'Lấy kết quả KPI con thay cho KPI cha',
  children_weighted: 'Kết hợp: một phần KPI cha + một phần KPI con',
});

/**
 * @param {object} args
 * @param {object|array} args.items          items của kế hoạch {id: {spec, weight}}
 * @param {(id)=>{value, source}} args.getActual  lấy kết quả chính thức của chỉ tiêu
 * @param {object} args.scoringPolicies      {policyId: policy}
 * @param {object} args.weightPolicy         {totalRequired, tolerance}
 * @param {object} args.aggregationPolicy    {missingPolicy, decimals, roundingMode}
 */
export function computeKpi({ items, getActual = () => ({ value: null }), scoringPolicies = {}, weightPolicy = {}, aggregationPolicy = {} }) {
  const list = toItemList(items).filter((it) => it.spec);
  const byId = Object.fromEntries(list.map((it) => [it.id, it]));
  const isActive = (it) => it.spec.state !== 'revoked';
  const notes = [];

  // xác định cây cha – con trong kế hoạch (bỏ qua chỉ tiêu bị thu hồi và con của chúng)
  const activeIds = new Set();
  const visit = (it, seen = new Set()) => {
    if (!isActive(it)) return false;
    const pid = it.spec.parentItemId;
    if (!pid) return true;
    if (seen.has(it.id)) return false;
    seen.add(it.id);
    const parent = byId[pid];
    if (!parent) return true; // cha không còn trong kế hoạch => coi như cấp cao nhất
    return visit(parent, seen);
  };
  list.forEach((it) => { if (visit(it)) activeIds.add(it.id); });
  const children = {};
  list.forEach((it) => {
    if (!activeIds.has(it.id)) return;
    const pid = it.spec.parentItemId;
    if (pid && byId[pid] && activeIds.has(pid)) (children[pid] ||= []).push(it);
  });
  const order = (a, b) => (a.spec.order ?? 999) - (b.spec.order ?? 999) || String(a.id).localeCompare(String(b.id));
  Object.values(children).forEach((arr) => arr.sort(order));

  const rows = [];

  function scoreOwn(it) {
    const policy = scoringPolicies[it.spec.scoring?.policyId];
    const merged = policy ? { ...policy, params: { ...(policy.params || {}), ...(it.spec.scoring?.params || {}) } } : null;
    const actual = getActual(it.id) || {};
    const r = scoreValue(merged, it.spec, actual.value, it.weight);
    return { ...r, actualSource: actual.source || null };
  }

  function combineChildren(parent, childResults) {
    const policy = parent.spec.aggregation?.missingChild || 'exclude';
    let sumShare = 0, sumScore = 0, used = 0, missingCount = 0, invalidCount = 0;
    const allShares = childResults.reduce((s, c) => s + (toNumber(c.item.weight) || 0), 0);
    for (const c of childResults) {
      const share = allShares > 0 ? toNumber(c.item.weight) || 0 : 1;
      if (c.res.status === STATUS.SCORED) { sumShare += share; sumScore += share * c.res.ratio; used++; }
      else if (c.res.status === STATUS.INVALID) invalidCount++;
      else {
        missingCount++;
        if (policy === 'zero') { sumShare += share; used++; }
      }
    }
    if (invalidCount && policy === 'block') return invalid('Có KPI con chưa cấu hình hợp lệ');
    if (missingCount && policy === 'block') return missing(`Còn ${missingCount} KPI con chưa có kết quả`);
    if (!used || sumShare <= 0) return missing('Chưa có KPI con nào có kết quả');
    const ratio = sumScore / sumShare;
    let expl = `Tổng hợp ${used}/${childResults.length} KPI con theo tỷ lệ = ${pct(ratio)}`;
    if (missingCount && policy === 'exclude') expl += ` (bỏ qua ${missingCount} KPI con thiếu dữ liệu, chuẩn hóa lại tỷ lệ)`;
    if (missingCount && policy === 'zero') expl += ` (${missingCount} KPI con thiếu dữ liệu tính 0%)`;
    if (invalidCount) expl += ` (bỏ qua ${invalidCount} KPI con cấu hình lỗi)`;
    return result(STATUS.SCORED, ratio, expl);
  }

  function scoreNode(it, depth) {
    const kids = children[it.id] || [];
    const method = it.spec.aggregation?.method || 'direct';
    const rowIndex = rows.length;
    rows.push(null); // giữ chỗ để con hiển thị sau cha
    let res;
    const childResults = kids.map((k) => ({ item: k, res: scoreNode(k, depth + 1) }));
    if (!kids.length || method === 'direct') {
      res = scoreOwn(it);
    } else if (method === 'children_replace') {
      res = { ...combineChildren(it, childResults), actualSource: 'children' };
    } else if (method === 'children_weighted') {
      const alpha = toNumber(it.spec.aggregation?.parentShare);
      if (alpha === null || Number.isNaN(alpha) || alpha < 0 || alpha > 1) {
        res = invalid('Chưa cấu hình tỷ lệ phần KPI cha (0–1)');
      } else {
        const own = scoreOwn(it);
        const comb = combineChildren(it, childResults);
        if (own.status === STATUS.SCORED && comb.status === STATUS.SCORED) {
          const ratio = alpha * own.ratio + (1 - alpha) * comb.ratio;
          res = result(STATUS.SCORED, ratio, `${pct(alpha, 0)} KPI cha (${pct(own.ratio)}) + ${pct(1 - alpha, 0)} KPI con (${pct(comb.ratio)}) = ${pct(ratio)}`, { actual: own.actual, actualSource: own.actualSource });
        } else if (own.status === STATUS.INVALID || comb.status === STATUS.INVALID) {
          res = invalid(own.status === STATUS.INVALID ? own.explanation : comb.explanation);
        } else {
          res = { ...missing('Cần đủ kết quả KPI cha và KPI con'), actual: own.actual, actualSource: own.actualSource };
        }
      }
    } else {
      res = invalid(`Phương pháp tổng hợp "${method}" chưa được hỗ trợ`);
    }
    rows[rowIndex] = { id: it.id, item: it, depth, parentId: depth ? it.spec.parentItemId : null, ...res, counted: false, contribution: null };
    return res;
  }

  const top = list.filter((it) => activeIds.has(it.id) && !(it.spec.parentItemId && byId[it.spec.parentItemId] && activeIds.has(it.spec.parentItemId)));
  top.sort((a, b) => (a.spec.groupOrder ?? 999) - (b.spec.groupOrder ?? 999) || order(a, b));
  for (const it of top) scoreNode(it, 0);
  // chỉ tiêu bị thu hồi: hiển thị nhưng không tính
  list.filter((it) => !activeIds.has(it.id)).forEach((it) => {
    rows.push({ id: it.id, item: it, depth: it.spec.parentItemId ? 1 : 0, parentId: it.spec.parentItemId || null, ...result(STATUS.EXCLUDED, null, it.spec.state === 'revoked' ? 'Đã thu hồi – không tính điểm' : 'KPI cha đã thu hồi'), counted: false, contribution: null });
  });

  // tính đóng góp và tổng
  const required = toNumber(weightPolicy.totalRequired);
  const tolerance = toNumber(weightPolicy.tolerance) ?? 0.01;
  const missingPolicy = aggregationPolicy.missingPolicy || 'incomplete';
  let totalWeight = 0, contribution = 0, scoredWeight = 0;
  const missingIds = [], invalidIds = [];
  const groups = {};
  for (const row of rows) {
    if (row.depth !== 0 || row.status === STATUS.EXCLUDED) continue;
    if (row.item.spec.countInTotal === false) { row.explanation = `${row.explanation} · Chỉ theo dõi, không cộng điểm`; continue; }
    const w = toNumber(row.item.weight) || 0;
    row.counted = true;
    totalWeight += w;
    const g = (groups[row.item.spec.groupId || '_'] ||= { weight: 0, contribution: 0, count: 0, scoredWeight: 0 });
    g.weight += w; g.count++;
    if (row.status === STATUS.SCORED) {
      row.contribution = (w / 100) * row.ratio;
      contribution += row.contribution;
      scoredWeight += w;
      g.contribution += row.contribution; g.scoredWeight += w;
    } else if (row.status === STATUS.MISSING) {
      missingIds.push(row.id);
      if (missingPolicy === 'zero') { row.contribution = 0; scoredWeight += w; g.scoredWeight += w; }
    } else if (row.status === STATUS.INVALID) invalidIds.push(row.id);
  }
  totalWeight = roundTo(totalWeight, 6);
  const weightValid = required !== null && !Number.isNaN(required) ? Math.abs(totalWeight - required) <= tolerance + EPS : null;
  if (weightValid === null) notes.push('Chưa cấu hình tổng trọng số bắt buộc – không kiểm tra được trọng số');
  else if (!weightValid) notes.push(`Tổng trọng số ${roundTo(totalWeight, 2)}% khác ${required}% theo quy định`);

  const decimals = Number.isInteger(aggregationPolicy.decimals) ? aggregationPolicy.decimals : 2;
  const rMode = aggregationPolicy.roundingMode || 'round';
  const finish = (x) => (x === null ? null : Number((roundTo(x * 100, decimals, rMode) / 100).toFixed(decimals + 2)));

  let total = null;
  const provisional = finish(contribution);
  if (invalidIds.length) {
    notes.push(`${invalidIds.length} chỉ tiêu có cấu hình tính điểm chưa hợp lệ`);
  } else if (missingIds.length && missingPolicy === 'incomplete') {
    notes.push(`${missingIds.length} chỉ tiêu chưa có kết quả – điểm KPI chỉ là tạm tính`);
  } else if (missingPolicy === 'exclude_renormalize' && missingIds.length) {
    total = scoredWeight > 0 ? finish((contribution / scoredWeight) * (required || 100)) : null;
    notes.push(`Bỏ qua ${missingIds.length} chỉ tiêu thiếu dữ liệu và chuẩn hóa lại trọng số (theo cấu hình)`);
  } else {
    total = provisional;
    if (missingIds.length && missingPolicy === 'zero') notes.push(`${missingIds.length} chỉ tiêu thiếu dữ liệu được tính 0% theo cấu hình`);
  }
  const complete = total !== null && weightValid === true && !invalidIds.length;
  return {
    rows,
    groups,
    totalWeight,
    weightRequired: required,
    weightValid,
    total,
    provisionalTotal: provisional,
    complete,
    missing: missingIds,
    invalid: invalidIds,
    notes,
  };
}

// ---------------------------------------------------------------------------
// KBI
// ---------------------------------------------------------------------------

/**
 * @param {object} args
 * @param {Array<{id,name,weight}>} args.values     giá trị cốt lõi áp dụng
 * @param {object} args.self      {valueId: {level}}
 * @param {object} args.manager   {valueId: {level, negativeBehavior}}
 * @param {object} args.policy    chính sách KBI
 */
export function computeKbi({ values = [], self = {}, manager = {}, policy }) {
  if (!policy || !policy.officialSource) {
    return { rows: [], average: null, provisionalAverage: null, complete: false, missing: [], notes: ['Chưa cấu hình chính sách KBI'], invalid: true };
  }
  const minL = toNumber(policy.minLevel) ?? 1, maxL = toNumber(policy.maxLevel) ?? 5;
  const lvl = (v) => {
    const n = toNumber(v);
    if (n === null || Number.isNaN(n) || n < minL || n > maxL) return null;
    return n;
  };
  const cap = policy.capRules?.negativeBehavior;
  const rows = [];
  const missingIds = [];
  const notes = [];
  for (const v of values) {
    const s = lvl(self?.[v.id]?.level);
    const m = lvl(manager?.[v.id]?.level);
    let official = null;
    switch (policy.officialSource) {
      case 'manager': official = m; break;
      case 'self': official = s; break;
      case 'manager_else_self': official = m ?? s; break;
      case 'average': {
        const ws = toNumber(policy.selfWeight), wm = toNumber(policy.managerWeight);
        if (s !== null && m !== null && ws !== null && wm !== null && ws + wm > 0) official = (s * ws + m * wm) / (ws + wm);
        break;
      }
      default: official = null;
    }
    let capped = false;
    if (official !== null && cap?.enabled && manager?.[v.id]?.negativeBehavior === true) {
      const maxCap = toNumber(cap.maxLevel);
      if (maxCap !== null && official > maxCap) { official = maxCap; capped = true; }
    }
    if (official === null) missingIds.push(v.id);
    rows.push({ id: v.id, name: v.name, weight: toNumber(v.weight) ?? 1, self: s, manager: m, official, capped });
  }
  const decimals = Number.isInteger(policy.decimals) ? policy.decimals : 2;
  const scored = rows.filter((r) => r.official !== null);
  const avg = (arr) => {
    if (!arr.length) return null;
    if (policy.aggregate === 'weighted') {
      const sw = arr.reduce((s, r) => s + r.weight, 0);
      return sw > 0 ? arr.reduce((s, r) => s + r.weight * r.official, 0) / sw : null;
    }
    return arr.reduce((s, r) => s + r.official, 0) / arr.length;
  };
  const provisional = scored.length ? roundTo(avg(scored), decimals, policy.roundingMode || 'round') : null;
  let average = null;
  if (!values.length) notes.push('Kỳ đánh giá chưa có giá trị cốt lõi áp dụng');
  else if (missingIds.length && policy.missingPolicy !== 'exclude') notes.push(`${missingIds.length} giá trị cốt lõi chưa có điểm chính thức`);
  else average = provisional;
  if (missingIds.length && policy.missingPolicy === 'exclude' && scored.length) notes.push(`Bỏ qua ${missingIds.length} giá trị chưa có điểm (theo cấu hình)`);
  if (rows.some((r) => r.capped)) notes.push(`Áp dụng quy tắc giới hạn tối đa mức ${cap.maxLevel} khi có biểu hiện hành vi mức 1–2`);
  return { rows, average, provisionalAverage: provisional, complete: average !== null, missing: missingIds, notes };
}

// ---------------------------------------------------------------------------
// Xếp loại
// ---------------------------------------------------------------------------

export function inBand(value, band) {
  if (value === null || value === undefined) return false;
  const min = toNumber(band.min), max = toNumber(band.max);
  if (min !== null && !Number.isNaN(min)) {
    if (band.minInclusive === false ? !(value > min + EPS) : !(value >= min - EPS)) return false;
  }
  if (max !== null && !Number.isNaN(max)) {
    if (band.maxInclusive === true ? !(value <= max + EPS) : !(value < max - EPS)) return false;
  }
  return true;
}

export function bandLabel(band, unit = '') {
  const min = toNumber(band.min), max = toNumber(band.max);
  const lo = min === null ? '' : `${band.minInclusive === false ? '>' : '≥'} ${min}${unit}`;
  const hi = max === null ? '' : `${band.maxInclusive === true ? '≤' : '<'} ${max}${unit}`;
  return [lo, hi].filter(Boolean).join(' và ') || 'Mọi giá trị';
}

const asList = (x) => (Array.isArray(x) ? x : Object.values(x || {})).filter(Boolean).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

/**
 * @param {object} args
 * @param {object} args.kpi    kết quả computeKpi
 * @param {object} args.kbi    kết quả computeKbi
 * @param {object} args.policy chính sách xếp loại (method: 'matrix' | 'weighted')
 */
export function computeGrade({ kpi, kbi, policy, allowProvisional = false }) {
  const out = { status: 'incomplete', code: null, label: null, color: null, reasons: [], kpiPercent: null, kbiScore: null };
  if (!policy || !policy.method) {
    out.status = 'invalid_config';
    out.reasons.push('Chưa cấu hình bảng xếp loại');
    return out;
  }
  const kpiVal = kpi?.complete ? kpi.total : allowProvisional ? kpi?.provisionalTotal ?? null : null;
  const kbiVal = kbi?.complete ? kbi.average : allowProvisional ? kbi?.provisionalAverage ?? null : null;
  if (!kpi?.complete) {
    if (kpi?.weightValid === false) out.reasons.push('Tổng trọng số KPI chưa hợp lệ');
    if (kpi?.missing?.length) out.reasons.push(`Còn ${kpi.missing.length} chỉ tiêu KPI chưa có kết quả`);
    if (kpi?.invalid?.length) out.reasons.push(`${kpi.invalid.length} chỉ tiêu KPI cấu hình tính điểm chưa hợp lệ`);
    if (!kpi) out.reasons.push('Chưa có dữ liệu KPI');
  }
  if (!kbi?.complete) {
    if (kbi?.missing?.length) out.reasons.push(`Còn ${kbi.missing.length} giá trị cốt lõi KBI chưa có điểm chính thức`);
    else out.reasons.push('Chưa có điểm KBI chính thức');
  }
  const grades = policy.grades || {};
  const decK = Number.isInteger(policy.rounding?.kpiDecimals) ? policy.rounding.kpiDecimals : 2;
  const decB = Number.isInteger(policy.rounding?.kbiDecimals) ? policy.rounding.kbiDecimals : 2;
  out.kpiPercent = kpiVal === null || kpiVal === undefined ? null : roundTo(kpiVal * 100, decK);
  out.kbiScore = kbiVal === null || kbiVal === undefined ? null : roundTo(kbiVal, decB);
  const officialReady = kpi?.complete && kbi?.complete;
  if (!officialReady && !allowProvisional) return out;
  if (out.kpiPercent === null || out.kbiScore === null) return out;

  let code = null;
  if (policy.method === 'matrix') {
    const kb = asList(policy.kpiBands).find((b) => inBand(out.kpiPercent, b));
    const bb = asList(policy.kbiBands).find((b) => inBand(out.kbiScore, b));
    out.kpiBand = kb?.id || null;
    out.kbiBand = bb?.id || null;
    if (!kb || !bb) {
      out.status = 'undefined';
      out.reasons.push(`Kết quả (KPI ${out.kpiPercent}%, KBI ${out.kbiScore}) nằm ngoài các khoảng đã cấu hình`);
      return out;
    }
    code = policy.matrix?.[kb.id]?.[bb.id] || null;
    if (!code) {
      out.status = 'undefined';
      out.reasons.push(`Ô ma trận [${kb.label || kb.id} × ${bb.label || bb.id}] chưa được gán xếp loại`);
      return out;
    }
  } else if (policy.method === 'weighted') {
    const w = policy.weighted || {};
    const wk = toNumber(w.kpiWeight), wb = toNumber(w.kbiWeight), maxKbi = toNumber(w.kbiMax);
    if ([wk, wb, maxKbi].some((x) => x === null || Number.isNaN(x)) || wk + wb <= 0 || maxKbi <= 0) {
      out.status = 'invalid_config';
      out.reasons.push('Chưa cấu hình đủ tỷ trọng KPI/KBI và thang KBI');
      return out;
    }
    const kbiPercent = (out.kbiScore / maxKbi) * 100;
    const score = roundTo((out.kpiPercent * wk + kbiPercent * wb) / (wk + wb), decK);
    out.score = score;
    const band = asList(w.bands).find((b) => inBand(score, b));
    if (!band) {
      out.status = 'undefined';
      out.reasons.push(`Điểm tổng hợp ${score} nằm ngoài các khoảng xếp loại`);
      return out;
    }
    code = band.grade;
  } else {
    out.status = 'invalid_config';
    out.reasons.push(`Phương pháp xếp loại "${policy.method}" chưa được hỗ trợ`);
    return out;
  }

  // Điều kiện đặc biệt
  const order = (c) => toNumber(grades[c]?.order) ?? 0;
  for (const rule of asList(policy.specialRules)) {
    if (rule.enabled === false) continue;
    if (rule.type === 'cap_if_kbi_value_le') {
      const lv = toNumber(rule.level);
      const hit = (kbi?.rows || []).some((r) => r.official !== null && r.official <= lv);
      if (hit && grades[rule.grade] && order(code) > order(rule.grade)) {
        code = rule.grade;
        out.reasons.push(rule.label || `Có giá trị cốt lõi ≤ ${lv} → xếp loại tối đa ${grades[rule.grade].label}`);
      }
    } else if (rule.type === 'cap_if_kpi_lt') {
      const lim = toNumber(rule.percent);
      if (out.kpiPercent < lim && grades[rule.grade] && order(code) > order(rule.grade)) {
        code = rule.grade;
        out.reasons.push(rule.label || `KPI < ${lim}% → xếp loại tối đa ${grades[rule.grade].label}`);
      }
    }
  }
  const g = grades[code];
  if (!g) {
    out.status = 'invalid_config';
    out.reasons.push(`Mã xếp loại "${code}" chưa được định nghĩa`);
    return out;
  }
  out.code = code;
  out.label = g.label;
  out.color = g.color || null;
  out.status = officialReady ? 'official' : 'provisional';
  return out;
}

// ---------------------------------------------------------------------------
// Tổng hợp một hồ sơ đánh giá đầy đủ
// ---------------------------------------------------------------------------

/** Lấy kết quả chính thức của chỉ tiêu theo cấu hình nguồn kết quả. */
export function makeActualGetter(evaluation, resultSource = 'manager_if_present') {
  const selfK = evaluation?.self?.kpi || {};
  const mgrK = evaluation?.manager?.kpi || {};
  return (id) => {
    const s = selfK[id]?.actual, m = mgrK[id]?.actual;
    if (resultSource === 'self') return { value: isBlank(s) ? null : s, source: isBlank(s) ? null : 'self' };
    if (resultSource === 'manager') return { value: isBlank(m) ? null : m, source: isBlank(m) ? null : 'manager' };
    if (!isBlank(m)) return { value: m, source: 'manager' };
    if (!isBlank(s)) return { value: s, source: 'self' };
    return { value: null, source: null };
  };
}

/**
 * @param {object} args
 * @param {object} args.plan         /kpiPlans/{p}/{u}
 * @param {object} args.evaluation   /evaluations/{p}/{u}
 * @param {object} args.policies     evaluationPeriods/{p}/policies (bản chụp chính sách của kỳ)
 * @param {Array}  args.kbiValues    giá trị cốt lõi áp dụng
 */
export function computeEvaluation({ plan, evaluation, policies = {}, kbiValues = [], allowProvisionalGrade = false }) {
  const agg = policies.kpiAggregation || {};
  const kpi = computeKpi({
    items: plan?.items || {},
    getActual: makeActualGetter(evaluation, agg.resultSource || 'manager_if_present'),
    scoringPolicies: policies.scoring || {},
    weightPolicy: policies.weight || {},
    aggregationPolicy: agg,
  });
  const kbi = computeKbi({ values: kbiValues, self: evaluation?.self?.kbi || {}, manager: evaluation?.manager?.kbi || {}, policy: policies.kbi });
  const grade = computeGrade({ kpi, kbi, policy: policies.grading, allowProvisional: allowProvisionalGrade });
  return { kpi, kbi, grade };
}

/** Chuỗi JSON ổn định (sắp xếp khóa) – dùng để băm nội dung đã xác nhận. */
export function canonicalJSON(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`;
  return `{${Object.keys(value).sort().filter((k) => value[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonicalJSON(value[k])}`).join(',')}}`;
}
