/**
 * Cấu hình chính sách: công thức tính điểm KPI (kèm thử nghiệm), quy tắc tổng hợp KPI, chính sách KBI,
 * bảng xếp loại & tỷ trọng KPI/KBI (kèm thử nghiệm), trọng số & ngưỡng X%, quy trình phê duyệt, mẫu đánh giá, nhãn trạng thái.
 * Mọi tham số lưu trong config/* (không hard-code). Kỳ đang mở dùng bản chụp riêng – chỉ đổi khi HR cập nhật có lý do.
 */
import { write, NOW, newKey, auditUpdate, mapError, listen } from '../services/database.service.js';
import { ctx, nameOf } from '../state.js';
import { can } from '../permissions.js';
import { html, render, ui, fmt, toast, busy, confirmDialog, openModal, mountPage, on, formValues, raw, clone, numOrNull } from '../utils.js';
import { pageHead, tabs, options, kv } from '../components.js';
import { demoBadge, sortedDict, FALLBACK_STATUS } from '../labels.js';
import { METHODS, scoreValue, computeGrade, bandLabel, STATUS_LABEL } from '../core/scoring.js';
import { validateExpression } from '../core/expression.js';
import { setQuery } from '../router.js';

const COLORS = ['gray', 'blue', 'amber', 'green', 'red', 'purple', 'teal', 'slate'];

async function savePolicy(path, value, previous, reason, type) {
  const hid = newKey('config/policyHistory');
  await write({
    [path]: { ...value, version: (previous?.version || 0) + 1, updatedAt: NOW(), updatedBy: ctx.userId },
    ...(previous ? { [`config/policyHistory/${path.replaceAll('/', '_')}/${hid}`]: { at: NOW(), by: ctx.userId, reason: reason || null, previous } } : {}),
    ...auditUpdate({ type: type || 'policy_change', entity: 'config', entityId: path, before: previous ? { version: previous.version } : null, after: { version: (previous?.version || 0) + 1 }, reason }),
  });
}

function demoBar(p, path) {
  return html`<div class="row between mb-2"><div class="row">${demoBadge(p?.isDemo)}${p?.version ? html`<span class="badge c-gray">Phiên bản ${p.version}</span>` : ''}${p?.updatedAt ? html`<span class="small muted">Cập nhật ${fmt.datetime(p.updatedAt)} bởi ${nameOf(p.updatedBy)}</span>` : ''}${p?.confirmedAt ? html`<span class="small muted">HR xác nhận ${fmt.datetime(p.confirmedAt)} – ${nameOf(p.confirmedBy)}</span>` : ''}</div>
    ${p?.isDemo ? html`<button class="btn sm" data-confirm-policy="${path}">Xác nhận là chính sách chính thức</button>` : ''}</div>`;
}

// ---------------------------------------------------------------------------
// Công thức tính điểm KPI
// ---------------------------------------------------------------------------
function paramsForm(method, p = {}) {
  const pr = p.params || {};
  const common = html`<div class="field"><label>Tỷ lệ tối thiểu (0 = 0%)</label><input type="number" step="any" name="minRatio" value="${pr.minRatio ?? ''}"></div>
    <div class="field"><label>Tỷ lệ tối đa (1,2 = 120%)</label><input type="number" step="any" name="maxRatio" value="${pr.maxRatio ?? ''}"></div>
    <div class="field"><label>Khi thiếu dữ liệu</label><select name="missing">${options([{ value: 'pending', label: 'Chưa có dữ liệu – không tính (khuyến nghị)' }, { value: 'zero', label: 'Tính 0%' }], pr.missing || 'pending')}</select></div>
    <div class="field"><label>Làm tròn tỷ lệ (chữ số)</label><input type="number" name="ratioDecimals" value="${pr.ratioDecimals ?? 6}"></div>`;
  switch (method) {
    case 'tiered': return html`<div class="form-grid cols-4">
      <div class="field"><label>Tỷ lệ tại Ngưỡng</label><input type="number" step="any" name="a_threshold" value="${pr.anchors?.threshold ?? ''}"></div>
      <div class="field"><label>Tỷ lệ tại Cơ bản</label><input type="number" step="any" name="a_base" value="${pr.anchors?.base ?? ''}"></div>
      <div class="field"><label>Tỷ lệ tại Đẩy mạnh</label><input type="number" step="any" name="a_stretch" value="${pr.anchors?.stretch ?? ''}"></div>
      <div class="field"><label>Tỷ lệ khi dưới Ngưỡng</label><input type="number" step="any" name="belowThreshold" value="${pr.belowThreshold ?? ''}"></div>
      <div class="field"><label>Cách nội suy</label><select name="interpolation">${options([{ value: 'excel_ratio', label: 'Chia tỷ lệ theo mẫu Excel 2025' }, { value: 'linear', label: 'Tuyến tính giữa các mốc' }, { value: 'step', label: 'Theo bậc (không nội suy)' }], pr.interpolation)}</select></div>
      <div class="field"><label>Vượt Đẩy mạnh</label><select name="aboveStretch">${options([{ value: 'cap', label: 'Giữ tỷ lệ Đẩy mạnh' }, { value: 'extrapolate', label: 'Ngoại suy (tuyến tính)' }], pr.aboveStretch || 'cap')}</select></div>
      <div class="field"><label>Ghi đè chiều đánh giá</label><select name="direction">${options([{ value: 'higher', label: 'Càng cao càng tốt' }, { value: 'lower', label: 'Càng thấp càng tốt' }], pr.direction, { placeholder: 'Theo chỉ tiêu' })}</select></div>
      ${common}</div>`;
    case 'scale_levels': {
      const lv = pr.levels || { 1: 0, 2: 0, 3: 0.8, 4: 1, 5: 1.2 };
      return html`<div class="form-grid cols-4">${[1, 2, 3, 4, 5].map((l) => html`<div class="field"><label>Mức ${l} → tỷ lệ</label><input type="number" step="any" name="lv${l}" value="${lv[l] ?? ''}"></div>`)}
        <div class="field"><label class="check"><input type="checkbox" name="allowDecimal" ${pr.allowDecimal ? raw('checked') : ''}> Cho phép mức lẻ (nội suy)</label></div>${common}</div>`;
    }
    case 'ratio': return html`<div class="form-grid cols-4">${common}</div>`;
    case 'pass_fail': return html`<div class="form-grid cols-4"><div class="field"><label>Đạt → tỷ lệ</label><input type="number" step="any" name="passRatio" value="${pr.passRatio ?? ''}"></div><div class="field"><label>Không đạt → tỷ lệ</label><input type="number" step="any" name="failRatio" value="${pr.failRatio ?? ''}"></div>${common}</div>`;
    case 'step_table': {
      const steps = Array.isArray(pr.steps) ? pr.steps : Object.values(pr.steps || {});
      const rows = [...steps, {}, {}];
      return html`<table class="data"><thead><tr><th>Mốc (≥ với càng cao càng tốt)</th><th>Tỷ lệ</th><th>Nhãn</th></tr></thead><tbody>${rows.map((s, i) => html`<tr><td><input type="number" step="any" name="sb${i}" value="${s.bound ?? ''}"></td><td><input type="number" step="any" name="sr${i}" value="${s.ratio ?? ''}"></td><td><input name="sl${i}" value="${s.label || ''}"></td></tr>`)}</tbody></table>
        <input type="hidden" name="stepCount" value="${rows.length}"><div class="form-grid cols-4 mt-1"><div class="field"><label>Không đạt bậc nào → tỷ lệ</label><input type="number" step="any" name="below" value="${pr.below ?? ''}"></div>${common}</div>`;
    }
    case 'formula': return html`<div class="form-grid"><div class="field span-2"><label class="req">Biểu thức</label><input name="expression" class="mono" value="${pr.expression || ''}"><span class="help">Biến: A (kết quả), T/B/S (Ngưỡng/Cơ bản/Đẩy mạnh), W (trọng số). Hàm: min, max, abs, round(x,d), floor, ceil, clamp(x,lo,hi), if(c,a,b), coalesce. Không dùng eval – công thức được phân tích an toàn.</span><span id="expr-check" class="help"></span></div></div><div class="form-grid cols-4">${common}</div>`;
    default: return '';
  }
}

function readParams(method, f) {
  const n = numOrNull;
  const common = { minRatio: n(f.minRatio), maxRatio: n(f.maxRatio), missing: f.missing || 'pending', ratioDecimals: n(f.ratioDecimals) ?? 6 };
  if (method === 'tiered') return { ...common, anchors: { threshold: n(f.a_threshold), base: n(f.a_base), stretch: n(f.a_stretch) }, belowThreshold: n(f.belowThreshold), interpolation: f.interpolation, aboveStretch: f.aboveStretch, direction: f.direction || null };
  if (method === 'scale_levels') return { ...common, levels: Object.fromEntries([1, 2, 3, 4, 5].map((l) => [l, n(f[`lv${l}`])]).filter(([, v]) => v !== null)), allowDecimal: !!f.allowDecimal };
  if (method === 'pass_fail') return { ...common, passRatio: n(f.passRatio), failRatio: n(f.failRatio) };
  if (method === 'step_table') {
    const steps = [];
    for (let i = 0; i < Number(f.stepCount || 0); i++) if (n(f[`sb${i}`]) !== null && n(f[`sr${i}`]) !== null) steps.push({ bound: n(f[`sb${i}`]), ratio: n(f[`sr${i}`]), label: f[`sl${i}`] || '' });
    return { ...common, steps, below: n(f.below) };
  }
  if (method === 'formula') return { ...common, expression: f.expression };
  return common;
}

function sandbox(policy) {
  return html`<fieldset class="mt-2"><legend>Thử nghiệm công thức với dữ liệu mẫu</legend>
    <div class="form-grid cols-4">
      <div class="field"><label>Chiều</label><select data-sb="direction">${options([{ value: 'higher', label: 'Càng cao càng tốt' }, { value: 'lower', label: 'Càng thấp càng tốt' }], 'higher')}</select></div>
      <div class="field"><label>Ngưỡng (T)</label><input type="number" step="any" data-sb="t" value="${policy.method === 'scale_levels' ? 3 : 80}"></div>
      <div class="field"><label>Cơ bản (B)</label><input type="number" step="any" data-sb="b" value="${policy.method === 'scale_levels' ? 4 : 100}"></div>
      <div class="field"><label>Đẩy mạnh (S)</label><input type="number" step="any" data-sb="s" value="${policy.method === 'scale_levels' ? 5 : 120}"></div>
      <div class="field"><label>Trọng số W (%)</label><input type="number" step="any" data-sb="w" value="10"></div>
      <div class="field"><label>Kết quả A</label><input data-sb="a" value="${policy.method === 'pass_fail' ? 'pass' : policy.method === 'scale_levels' ? 4 : 95}"></div>
    </div><div id="sb-out" class="mt-1"></div><div id="sb-table" class="mt-1"></div></fieldset>`;
}

function runSandbox(root, policyFromForm) {
  const g = (k) => root.querySelector(`[data-sb=${k}]`)?.value;
  const policy = policyFromForm();
  const spec = { direction: g('direction'), targets: { threshold: numOrNull(g('t')), base: numOrNull(g('b')), stretch: numOrNull(g('s')) } };
  const w = numOrNull(g('w')) ?? 0;
  const r = scoreValue(policy, spec, g('a'), w);
  render(root.querySelector('#sb-out'), html`<div class="alert ${r.status === 'scored' ? 'success' : r.status === 'missing' ? 'warning' : 'danger'}"><div><b>${STATUS_LABEL[r.status]}</b>${r.status === 'scored' ? html` – Tỷ lệ quy đổi <b>${fmt.percent(r.ratio)}</b>, đóng góp vào KPI <b>${fmt.percent((w / 100) * r.ratio)}</b>` : ''}<div class="small">${r.explanation}</div></div></div>`);
  const t = spec.targets;
  if (['tiered', 'ratio', 'step_table', 'formula'].includes(policy.method) && t.base !== null) {
    const lo = Math.min(t.threshold ?? t.base, t.stretch ?? t.base) * 0.8, hi = Math.max(t.threshold ?? t.base, t.stretch ?? t.base) * 1.2;
    const pts = Array.from({ length: 11 }, (_, i) => Math.round((lo + ((hi - lo) * i) / 10) * 100) / 100);
    render(root.querySelector('#sb-table'), html`<table class="data"><thead><tr><th>A</th>${pts.map((p) => html`<th class="num">${fmt.number(p, 2)}</th>`)}</tr></thead><tbody><tr><td>Tỷ lệ</td>${pts.map((p) => { const x = scoreValue(policy, spec, p, w); return html`<td class="num">${x.status === 'scored' ? fmt.percent(x.ratio, 1) : '—'}</td>`; })}</tr></tbody></table>`);
  } else render(root.querySelector('#sb-table'), '');
}

function openScoringEditor(id) {
  const prev = id ? ctx.config.scoringPolicies?.[id] : null;
  let method = prev?.method || 'tiered';
  const build = (el) => {
    const f = formValues(el.querySelector('#sp-form'));
    return { name: f.name, method, status: f.status, note: f.note, isDemo: prev?.isDemo ?? true, params: readParams(method, f) };
  };
  const m = openModal({
    title: id ? `Công thức – ${prev.name}` : 'Thêm công thức tính điểm', size: 'xl', body: '',
    actions: [{ label: 'Hủy', value: null }, { label: 'Lưu công thức', kind: 'primary', onClick: async ({ el, close }) => {
      const v = build(el);
      if (!v.name?.trim()) { toast('Nhập tên công thức.', 'error'); return false; }
      if (method === 'formula') { const c = validateExpression(v.params.expression); if (!c.ok) { toast(`Biểu thức lỗi: ${c.error}`, 'error'); return false; } }
      const reason = el.querySelector('[name=reason]').value;
      try { await savePolicy(`config/scoringPolicies/${id || newKey('config/scoringPolicies')}`, v, prev, reason, 'scoring_policy_change'); toast('Đã lưu. Kỳ đang mở chỉ áp dụng khi HR cập nhật chính sách cho kỳ.'); close(true); } catch (e) { toast(mapError(e), 'error'); }
      return true;
    } }],
  });
  const draw = () => {
    const p = { ...(prev || {}), method, params: prev?.method === method ? prev.params : {} };
    render(m.body, html`<form id="sp-form" class="stack" novalidate>
      <div class="form-grid cols-3"><div class="field"><label class="req">Tên công thức</label><input name="name" value="${prev?.name || ''}"></div>
        <div class="field"><label>Phương pháp</label><select name="method" id="sp-method">${options(Object.entries(METHODS).map(([k, x]) => ({ value: k, label: x.label })), method)}</select></div>
        <div class="field"><label>Trạng thái</label><select name="status">${options([{ value: 'active', label: 'Đang dùng' }, { value: 'inactive', label: 'Ngừng dùng' }], prev?.status || 'active')}</select></div>
        <div class="field span-2" style="grid-column:1/-1"><label>Diễn giải / ghi chú</label><textarea name="note" rows="2">${prev?.note || ''}</textarea></div></div>
      ${paramsForm(method, p)}
      <div class="field"><label>Lý do thay đổi</label><input name="reason"></div>
    </form>${sandbox(p)}`);
    m.body.querySelector('#sp-method').addEventListener('change', (e) => { method = e.target.value; draw(); });
    const rerun = () => runSandbox(m.body, () => build(m.body));
    m.body.addEventListener('input', rerun);
    m.body.addEventListener('change', rerun);
    const ex = m.body.querySelector('[name=expression]');
    if (ex) { const chk = () => { const c = validateExpression(ex.value); m.body.querySelector('#expr-check').textContent = c.ok ? '✓ Cú pháp hợp lệ' : `✗ ${c.error}`; }; ex.addEventListener('input', chk); chk(); }
    rerun();
  };
  draw();
}

function scoringTab() {
  const list = Object.entries(ctx.config.scoringPolicies || {});
  return html`<div class="row between mb-2"><div class="muted">Mỗi chỉ tiêu tham chiếu một công thức. Kỳ đang mở dùng bản chụp công thức tại thời điểm mở kỳ.</div><button class="btn primary" data-act="new-scoring">Thêm công thức</button></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Mã</th><th>Tên</th><th>Phương pháp</th><th>Tham số chính</th><th>Trạng thái</th><th>Phiên bản</th><th></th></tr></thead><tbody>
    ${list.map(([id, p]) => html`<tr><td class="mono">${id}</td><td><b>${p.name}</b> ${demoBadge(p.isDemo, 'demo')}<div class="small muted">${p.note || ''}</div></td><td>${METHODS[p.method]?.label || p.method}</td>
      <td class="small mono">${p.method === 'tiered' ? `N ${p.params?.anchors?.threshold} · CB ${p.params?.anchors?.base} · ĐM ${p.params?.anchors?.stretch} · ${p.params?.interpolation}` : p.method === 'scale_levels' ? JSON.stringify(p.params?.levels) : p.method === 'formula' ? p.params?.expression : p.method === 'step_table' ? `${(Array.isArray(p.params?.steps) ? p.params.steps : Object.values(p.params?.steps || {})).length} bậc` : ''}</td>
      <td>${p.status === 'inactive' ? html`<span class="badge c-amber">Ngừng</span>` : html`<span class="badge c-green">Đang dùng</span>`}</td><td>${p.version || 1}</td>
      <td class="actions"><button class="btn xs" data-scoring="${id}">Sửa / thử nghiệm</button>${p.isDemo ? html` <button class="btn xs" data-confirm-policy="config/scoringPolicies/${id}">Xác nhận</button>` : ''}</td></tr>`)}
    </tbody></table></div>`;
}

// ---------------------------------------------------------------------------
// Tổng hợp KPI, KBI, trọng số
// ---------------------------------------------------------------------------
function aggregationTab() {
  const a = ctx.config.kpiAggregation?.default || {};
  return html`${demoBar(a, 'config/kpiAggregation/default')}<form id="agg-form" class="card"><div class="card-body form-grid cols-3">
    <div class="field"><label>Kết quả chính thức của chỉ tiêu</label><select name="resultSource">${options([{ value: 'manager_if_present', label: 'Số quản lý xác nhận, nếu chưa có lấy số nhân viên' }, { value: 'manager', label: 'Chỉ số quản lý xác nhận' }, { value: 'self', label: 'Số nhân viên tự nhập' }], a.resultSource)}</select></div>
    <div class="field"><label>Chỉ tiêu thiếu dữ liệu</label><select name="missingPolicy">${options([{ value: 'incomplete', label: 'Chưa hoàn thành – điểm KPI tạm tính (khuyến nghị)' }, { value: 'zero', label: 'Tính 0%' }, { value: 'exclude_renormalize', label: 'Bỏ qua và chuẩn hóa lại trọng số' }], a.missingPolicy)}</select></div>
    <div class="field"><label>Làm tròn điểm KPI tổng (chữ số % )</label><input type="number" name="decimals" value="${a.decimals ?? 2}"></div>
    <div class="field"><label>Cách làm tròn</label><select name="roundingMode">${options([{ value: 'round', label: 'Làm tròn' }, { value: 'floor', label: 'Làm tròn xuống' }, { value: 'ceil', label: 'Làm tròn lên' }], a.roundingMode || 'round')}</select></div>
    <div class="field span-2" style="grid-column:span 2"><label>Ghi chú</label><input name="note" value="${a.note || ''}"></div>
    <div class="field" style="grid-column:1/-1"><label>Lý do thay đổi</label><input name="reason"></div>
  </div><div class="card-footer row end"><button class="btn primary" type="button" data-save="agg">Lưu</button></div></form>
  <div class="alert info mt-2"><div>Công thức tổng: <b>KPI = Σ (Trọng số% / 100 × Tỷ lệ quy đổi)</b> trên các chỉ tiêu cấp cao nhất được tính điểm. Sub-KPI chỉ đóng góp qua KPI cha theo phương pháp tổng hợp của KPI cha – không cộng trùng.</div></div>`;
}

function kbiTab() {
  const k = ctx.config.kbiPolicies?.default || {};
  return html`${demoBar(k, 'config/kbiPolicies/default')}<form id="kbi-pol-form" class="card"><div class="card-body form-grid cols-3">
    <div class="field"><label>Kết quả KBI chính thức</label><select name="officialSource">${options([{ value: 'manager', label: 'Điểm quản lý trực tiếp' }, { value: 'manager_else_self', label: 'Điểm quản lý, nếu chưa có lấy tự đánh giá' }, { value: 'self', label: 'Điểm tự đánh giá' }, { value: 'average', label: 'Trung bình có trọng số hai điểm' }], k.officialSource)}</select></div>
    <div class="field"><label>Trọng số tự đánh giá</label><input type="number" step="any" name="selfWeight" value="${k.selfWeight ?? 0}"></div>
    <div class="field"><label>Trọng số quản lý</label><input type="number" step="any" name="managerWeight" value="${k.managerWeight ?? 1}"></div>
    <div class="field"><label>Tổng hợp các giá trị</label><select name="aggregate">${options([{ value: 'mean', label: 'Trung bình cộng' }, { value: 'weighted', label: 'Trung bình có trọng số (theo trọng số từng giá trị)' }], k.aggregate || 'mean')}</select></div>
    <div class="field"><label>Số chữ số thập phân</label><input type="number" name="decimals" value="${k.decimals ?? 2}"></div>
    <div class="field"><label>Giá trị chưa đánh giá</label><select name="missingPolicy">${options([{ value: 'incomplete', label: 'KBI chưa hoàn thành (khuyến nghị)' }, { value: 'exclude', label: 'Bỏ qua giá trị chưa chấm' }], k.missingPolicy || 'incomplete')}</select></div>
    <div class="field"><label>Mức tối thiểu</label><input type="number" name="minLevel" value="${k.minLevel ?? 1}"></div>
    <div class="field"><label>Mức tối đa</label><input type="number" name="maxLevel" value="${k.maxLevel ?? 5}"></div>
    <div class="field"><label class="check"><input type="checkbox" name="capEnabled" ${k.capRules?.negativeBehavior?.enabled ? raw('checked') : ''}> Giới hạn khi có hành vi mức 1–2</label><input type="number" name="capMax" value="${k.capRules?.negativeBehavior?.maxLevel ?? 3}" title="Mức tối đa"></div>
    <div class="field" style="grid-column:1/-1"><label>Diễn giải quy tắc giới hạn</label><input name="capLabel" value="${k.capRules?.negativeBehavior?.label || ''}"></div>
    <div class="field" style="grid-column:1/-1"><label>Ghi chú</label><input name="note" value="${k.note || ''}"></div>
    <div class="field" style="grid-column:1/-1"><label>Lý do thay đổi</label><input name="reason"></div>
  </div><div class="card-footer row end"><button class="btn primary" type="button" data-save="kbi">Lưu</button></div></form>`;
}

function weightsTab() {
  const w = ctx.config.weightPolicies?.default || {};
  const groups = sortedDict(ctx.config.kpiGroups);
  return html`${demoBar(w, 'config/weightPolicies/default')}<form id="w-form" class="card"><div class="card-body stack">
    <div class="form-grid cols-4">
      <div class="field"><label>Tổng trọng số bắt buộc (%)</label><input type="number" step="any" name="totalRequired" value="${w.totalRequired ?? ''}"></div>
      <div class="field"><label>Dung sai (%)</label><input type="number" step="any" name="tolerance" value="${w.tolerance ?? 0.01}"></div>
      <div class="field"><label>Trọng số tối thiểu / chỉ tiêu (%)</label><input type="number" step="any" name="minItemWeight" value="${w.minItemWeight ?? ''}"></div>
      <div class="field"><label>Trọng số tối đa / chỉ tiêu (%)</label><input type="number" step="any" name="maxItemWeight" value="${w.maxItemWeight ?? ''}"></div>
      <div class="field"><label>Chế độ giao mặc định</label><select name="defaultMode">${options([{ value: 'fixed', label: 'A – Cố định' }, { value: 'flex', label: 'B – Cho điều chỉnh' }], w.defaultMode || 'fixed')}</select></div>
      <div class="field"><label><b>X%</b> – tối thiểu khi cho điều chỉnh</label><input type="number" step="any" name="flexMinWeight" value="${w.flexMinWeight ?? ''}"></div>
      <div class="field"><label>Tối đa khi cho điều chỉnh (%)</label><input type="number" step="any" name="flexMaxWeight" value="${w.flexMaxWeight ?? ''}"></div>
      <div class="field"><label class="check"><input type="checkbox" name="requireReapprovalOnFlexChange" ${w.requireReapprovalOnFlexChange !== false ? raw('checked') : ''}> Điều chỉnh trọng số cần phê duyệt lại kế hoạch</label></div>
    </div>
    <h4>Tỷ trọng theo nhóm chỉ tiêu (cảnh báo khi vượt khoảng)</h4>
    <table class="data"><thead><tr><th>Nhóm</th><th>Tối thiểu (%)</th><th>Tối đa (%)</th><th>Ghi chú</th></tr></thead><tbody>
      ${groups.map(([gid, g]) => html`<tr><td>${g.name}</td><td><input type="number" step="any" name="gmin_${gid}" value="${w.groupConstraints?.[gid]?.min ?? ''}"></td><td><input type="number" step="any" name="gmax_${gid}" value="${w.groupConstraints?.[gid]?.max ?? ''}"></td><td><input name="gnote_${gid}" value="${w.groupConstraints?.[gid]?.note || ''}"></td></tr>`)}
    </tbody></table>
    <div class="field"><label>Lý do thay đổi</label><input name="reason"></div>
  </div><div class="card-footer row end"><button class="btn primary" type="button" data-save="weights">Lưu</button></div></form>`;
}

// ---------------------------------------------------------------------------
// Bảng xếp loại
// ---------------------------------------------------------------------------
let gradingDraft = null;
function gradingTab() {
  const g = gradingDraft || (gradingDraft = clone(ctx.config.gradingBands?.default || { method: 'matrix', grades: {}, kpiBands: {}, kbiBands: {}, matrix: {}, weighted: { bands: {} }, rounding: {}, specialRules: {} }));
  const kpiB = Object.entries(g.kpiBands || {}).sort((a, b) => (a[1].order ?? 0) - (b[1].order ?? 0));
  const kbiB = Object.entries(g.kbiBands || {}).sort((a, b) => (a[1].order ?? 0) - (b[1].order ?? 0));
  const grades = Object.entries(g.grades || {}).sort((a, b) => (a[1].order ?? 0) - (b[1].order ?? 0));
  const bandRow = (kind, id, b) => html`<tr><td class="mono">${id}</td><td><input data-band="${kind}|${id}|label" value="${b.label || ''}"></td>
    <td><input type="number" step="any" data-band="${kind}|${id}|min" value="${b.min ?? ''}" style="width:90px"></td><td><select data-band="${kind}|${id}|minInclusive">${options([{ value: 'true', label: '≥' }, { value: 'false', label: '>' }], String(b.minInclusive !== false))}</select></td>
    <td><input type="number" step="any" data-band="${kind}|${id}|max" value="${b.max ?? ''}" style="width:90px"></td><td><select data-band="${kind}|${id}|maxInclusive">${options([{ value: 'false', label: '<' }, { value: 'true', label: '≤' }], String(b.maxInclusive === true))}</select></td>
    <td><input type="number" data-band="${kind}|${id}|order" value="${b.order ?? 0}" style="width:60px"></td><td><button type="button" class="btn xs outline-danger" data-delband="${kind}|${id}">Xóa</button></td></tr>`;
  const wb = Object.entries(g.weighted?.bands || {}).sort((a, b) => (a[1].order ?? 0) - (b[1].order ?? 0));
  return html`${demoBar(ctx.config.gradingBands?.default, 'config/gradingBands/default')}
    <div class="alert warning mb-2"><div>Chưa có quy định chính thức về tỷ trọng chung và bảng xếp loại cuối kỳ: cấu hình hiện tại tái hiện công thức mẫu Excel 2025 và được gắn nhãn <b>Cấu hình demo – cần HR xác nhận</b>.</div></div>
    <div class="card"><div class="card-body form-grid cols-4">
      <div class="field"><label>Phương pháp xếp loại</label><select data-g="method">${options([{ value: 'matrix', label: 'Ma trận KPI × KBI' }, { value: 'weighted', label: 'Tỷ trọng KPI/KBI → điểm chung' }], g.method)}</select></div>
      <div class="field"><label>Làm tròn KPI (chữ số %)</label><input type="number" data-g="rounding.kpiDecimals" value="${g.rounding?.kpiDecimals ?? 2}"></div>
      <div class="field"><label>Làm tròn KBI</label><input type="number" data-g="rounding.kbiDecimals" value="${g.rounding?.kbiDecimals ?? 2}"></div>
      <div class="field"><label>Nhãn</label><input data-g="label" value="${g.label || ''}"></div>
      <div class="field" style="grid-column:1/-1"><label>Ghi chú</label><input data-g="note" value="${g.note || ''}"></div>
    </div></div>
    <h3 class="section-title mt-3">Các mức xếp loại</h3>
    <div class="table-wrap"><table class="data"><thead><tr><th>Mã</th><th>Tên</th><th>Thứ tự (1 = thấp nhất)</th><th>Màu</th><th></th></tr></thead><tbody>
      ${grades.map(([c, x]) => html`<tr><td class="mono">${c}</td><td><input data-grade="${c}|label" value="${x.label}"></td><td><input type="number" data-grade="${c}|order" value="${x.order}" style="width:80px"></td><td><select data-grade="${c}|color">${options(COLORS, x.color)}</select></td><td><button type="button" class="btn xs outline-danger" data-delgrade="${c}">Xóa</button></td></tr>`)}
      <tr><td><input id="new-grade-code" placeholder="Mã mới"></td><td colspan="4"><button type="button" class="btn xs" data-addgrade>Thêm mức</button></td></tr>
    </tbody></table></div>
    ${g.method === 'matrix' ? html`
      <div class="grid cols-2 mt-3">
        <div><h3 class="section-title">Khoảng điểm KPI (%)</h3><div class="table-wrap"><table class="data"><thead><tr><th>Mã</th><th>Nhãn</th><th>Từ</th><th></th><th>Đến</th><th></th><th>TT</th><th></th></tr></thead><tbody>${kpiB.map(([id, b]) => bandRow('kpiBands', id, b))}</tbody></table></div><button type="button" class="btn xs mt-1" data-addband="kpiBands">+ Khoảng KPI</button></div>
        <div><h3 class="section-title">Khoảng điểm KBI</h3><div class="table-wrap"><table class="data"><thead><tr><th>Mã</th><th>Nhãn</th><th>Từ</th><th></th><th>Đến</th><th></th><th>TT</th><th></th></tr></thead><tbody>${kbiB.map(([id, b]) => bandRow('kbiBands', id, b))}</tbody></table></div><button type="button" class="btn xs mt-1" data-addband="kbiBands">+ Khoảng KBI</button></div>
      </div>
      <h3 class="section-title mt-3">Ma trận xếp loại</h3>
      <div class="table-wrap"><table class="matrix"><thead><tr><th class="rowhead">KPI \\ KBI</th>${kbiB.map(([, b]) => html`<th>${b.label || bandLabel(b)}</th>`)}</tr></thead><tbody>
        ${kpiB.map(([kid, kb]) => html`<tr><td class="rowhead">${kb.label || bandLabel(kb, '%')}</td>${kbiB.map(([bid]) => html`<td><select data-cell="${kid}|${bid}">${options(grades.map(([c, x]) => ({ value: c, label: x.label })), g.matrix?.[kid]?.[bid], { placeholder: '—' })}</select></td>`)}</tr>`)}
      </tbody></table></div>` : html`
      <h3 class="section-title mt-3">Tỷ trọng KPI/KBI</h3>
      <div class="form-grid cols-4"><div class="field"><label>Tỷ trọng KPI</label><input type="number" step="any" data-g="weighted.kpiWeight" value="${g.weighted?.kpiWeight ?? ''}"></div><div class="field"><label>Tỷ trọng KBI</label><input type="number" step="any" data-g="weighted.kbiWeight" value="${g.weighted?.kbiWeight ?? ''}"></div><div class="field"><label>Thang KBI tối đa (quy đổi KBI/max×100)</label><input type="number" step="any" data-g="weighted.kbiMax" value="${g.weighted?.kbiMax ?? 5}"></div></div>
      <div class="table-wrap mt-1"><table class="data"><thead><tr><th>Mã</th><th>Từ</th><th>Đến (&lt;)</th><th>Xếp loại</th><th>TT</th></tr></thead><tbody>${wb.map(([id, b]) => html`<tr><td class="mono">${id}</td><td><input type="number" step="any" data-wband="${id}|min" value="${b.min ?? ''}"></td><td><input type="number" step="any" data-wband="${id}|max" value="${b.max ?? ''}"></td><td><select data-wband="${id}|grade">${options(grades.map(([c, x]) => ({ value: c, label: x.label })), b.grade)}</select></td><td><input type="number" data-wband="${id}|order" value="${b.order ?? 0}"></td></tr>`)}</tbody></table></div>`}
    <h3 class="section-title mt-3">Điều kiện đặc biệt</h3>
    <div class="table-wrap"><table class="data"><thead><tr><th>Bật</th><th>Loại</th><th>Ngưỡng</th><th>Xếp loại tối đa</th><th>Diễn giải</th></tr></thead><tbody>
      ${Object.entries(g.specialRules || {}).map(([id, r]) => html`<tr><td><input type="checkbox" data-rule="${id}|enabled" ${r.enabled !== false ? raw('checked') : ''}></td><td><select data-rule="${id}|type">${options([{ value: 'cap_if_kbi_value_le', label: 'Có giá trị cốt lõi ≤ mức' }, { value: 'cap_if_kpi_lt', label: 'KPI < %' }], r.type)}</select></td>
        <td><input type="number" step="any" data-rule="${id}|${r.type === 'cap_if_kpi_lt' ? 'percent' : 'level'}" value="${r.type === 'cap_if_kpi_lt' ? r.percent ?? '' : r.level ?? ''}"></td><td><select data-rule="${id}|grade">${options(grades.map(([c, x]) => ({ value: c, label: x.label })), r.grade)}</select></td><td><input data-rule="${id}|label" value="${r.label || ''}"></td></tr>`)}
    </tbody></table></div><button type="button" class="btn xs mt-1" data-addrule>+ Điều kiện</button>
    <fieldset class="mt-3"><legend>Thử nghiệm xếp loại</legend><div class="row"><div class="field"><label>Điểm KPI (%)</label><input type="number" step="any" id="gt-kpi" value="100"></div><div class="field"><label>Điểm KBI</label><input type="number" step="any" id="gt-kbi" value="4"></div><div id="gt-out" class="grow"></div></div></fieldset>
    <div class="row end mt-2"><input name="greason" id="g-reason" placeholder="Lý do thay đổi" style="max-width:360px"><button type="button" class="btn" data-reset-grading>Hủy thay đổi</button><button type="button" class="btn primary" data-save="grading">Lưu bảng xếp loại</button></div>`;
}

function gradingTest(page) {
  const out = page.querySelector('#gt-out');
  if (!out) return;
  const k = numOrNull(page.querySelector('#gt-kpi').value), b = numOrNull(page.querySelector('#gt-kbi').value);
  const r = computeGrade({ kpi: { complete: true, total: k === null ? null : k / 100 }, kbi: { complete: true, average: b, rows: [] }, policy: gradingDraft });
  render(out, html`<div class="alert ${r.status === 'official' ? 'success' : 'warning'}"><div>${r.status === 'official' ? html`Xếp loại: <b>${r.label}</b> (${r.code})${r.score !== undefined ? ` – điểm chung ${r.score}` : ''}` : html`<b>Không xác định:</b> ${r.reasons.join('; ')}`}</div></div>`);
}

// ---------------------------------------------------------------------------
async function policiesPage(container, params, query) {
  const page = mountPage(container);
  let tab = query.tab || 'scoring';
  gradingDraft = null;
  const T = [{ id: 'scoring', label: 'Công thức tính điểm KPI' }, { id: 'aggregation', label: 'Tổng hợp KPI' }, { id: 'kbi', label: 'Chính sách KBI' }, { id: 'grading', label: 'Xếp loại & tỷ trọng KPI/KBI' }, { id: 'weights', label: 'Trọng số & X%' }];
  const draw = () => {
    render(page, html`${pageHead({ title: 'Công thức, trọng số & xếp loại', sub: 'Thay đổi cấu hình không tự động ảnh hưởng kỳ đang mở – HR dùng "Cập nhật chính sách áp dụng" tại Kỳ đánh giá', crumbs: [['Quản trị'], ['Chính sách']] })}
      ${tabs(T, tab)}
      ${tab === 'scoring' ? scoringTab() : tab === 'aggregation' ? aggregationTab() : tab === 'kbi' ? kbiTab() : tab === 'grading' ? gradingTab() : weightsTab()}`);
    if (tab === 'grading') gradingTest(page);
  };
  const guard = (fn) => (e, el) => busy(el, async () => { try { await fn(el); } catch (err) { toast(mapError(err), 'error'); } });
  on(page, 'click', '[data-tab]', (e, el) => { tab = el.dataset.tab; setQuery({ tab }); draw(); });
  on(page, 'click', '[data-act=new-scoring]', () => openScoringEditor(null));
  on(page, 'click', '[data-scoring]', (e, el) => openScoringEditor(el.dataset.scoring));
  on(page, 'click', '[data-confirm-policy]', guard(async (el) => {
    const r = await confirmDialog({ title: 'Xác nhận chính sách chính thức', message: 'Bỏ nhãn "demo": xác nhận tham số đã được HR/cấp có thẩm quyền phê duyệt sử dụng chính thức.', requireReason: true, reasonLabel: 'Căn cứ (quyết định/văn bản)' });
    if (!r) return;
    const path = el.dataset.confirmPolicy;
    await write({ [`${path}/isDemo`]: false, [`${path}/confirmedAt`]: NOW(), [`${path}/confirmedBy`]: ctx.userId, [`${path}/confirmationNote`]: r.reason, ...auditUpdate({ type: 'policy_confirm', entity: 'config', entityId: path, reason: r.reason }) });
    toast('Đã xác nhận chính sách.');
  }));
  on(page, 'click', '[data-save]', guard(async (el) => {
    const kind = el.dataset.save;
    if (kind === 'agg') {
      const f = formValues(page.querySelector('#agg-form'));
      const prev = ctx.config.kpiAggregation?.default;
      await savePolicy('config/kpiAggregation/default', { ...(prev || {}), resultSource: f.resultSource, missingPolicy: f.missingPolicy, decimals: Number(f.decimals) || 0, roundingMode: f.roundingMode, note: f.note }, prev, f.reason, 'aggregation_policy_change');
    } else if (kind === 'kbi') {
      const f = formValues(page.querySelector('#kbi-pol-form'));
      const prev = ctx.config.kbiPolicies?.default;
      await savePolicy('config/kbiPolicies/default', { ...(prev || {}), officialSource: f.officialSource, selfWeight: numOrNull(f.selfWeight) ?? 0, managerWeight: numOrNull(f.managerWeight) ?? 1, aggregate: f.aggregate, decimals: Number(f.decimals) || 0, missingPolicy: f.missingPolicy, minLevel: Number(f.minLevel) || 1, maxLevel: Number(f.maxLevel) || 5, note: f.note,
        capRules: { negativeBehavior: { enabled: !!f.capEnabled, maxLevel: Number(f.capMax) || 3, label: f.capLabel } } }, prev, f.reason, 'kbi_policy_change');
    } else if (kind === 'weights') {
      const f = formValues(page.querySelector('#w-form'));
      const prev = ctx.config.weightPolicies?.default;
      const gc = {};
      for (const [gid] of sortedDict(ctx.config.kpiGroups)) {
        const mn = numOrNull(f[`gmin_${gid}`]), mx = numOrNull(f[`gmax_${gid}`]);
        if (mn !== null || mx !== null) gc[gid] = { min: mn, max: mx, note: f[`gnote_${gid}`] || '' };
      }
      await savePolicy('config/weightPolicies/default', { ...(prev || {}), totalRequired: numOrNull(f.totalRequired), tolerance: numOrNull(f.tolerance) ?? 0.01, minItemWeight: numOrNull(f.minItemWeight), maxItemWeight: numOrNull(f.maxItemWeight), defaultMode: f.defaultMode, flexMinWeight: numOrNull(f.flexMinWeight), flexMaxWeight: numOrNull(f.flexMaxWeight), requireReapprovalOnFlexChange: !!f.requireReapprovalOnFlexChange, groupConstraints: gc }, prev, f.reason, 'weight_policy_change');
    } else if (kind === 'grading') {
      const prev = ctx.config.gradingBands?.default;
      await savePolicy('config/gradingBands/default', gradingDraft, prev, page.querySelector('#g-reason')?.value, 'grading_policy_change');
      gradingDraft = null;
    }
    toast('Đã lưu cấu hình. Kỳ đang mở chỉ áp dụng khi cập nhật chính sách cho kỳ.');
    draw();
  }));
  // ---- chỉnh bảng xếp loại (bản nháp trong bộ nhớ)
  const setPath = (obj, path, v) => { const ks = path.split('.'); let o = obj; ks.slice(0, -1).forEach((k) => { o[k] ||= {}; o = o[k]; }); o[ks.at(-1)] = v; };
  on(page, 'change', '[data-g]', (e, el) => { const v = ['method', 'label', 'note'].includes(el.dataset.g) ? el.value : numOrNull(el.value); setPath(gradingDraft, el.dataset.g, v); if (el.dataset.g === 'method') draw(); else gradingTest(page); });
  on(page, 'change', '[data-grade]', (e, el) => { const [c, k] = el.dataset.grade.split('|'); gradingDraft.grades[c][k] = k === 'order' ? Number(el.value) : el.value; gradingTest(page); });
  on(page, 'change', '[data-band]', (e, el) => { const [kind, id, k] = el.dataset.band.split('|'); const v = ['min', 'max', 'order'].includes(k) ? numOrNull(el.value) : ['minInclusive', 'maxInclusive'].includes(k) ? el.value === 'true' : el.value; gradingDraft[kind][id][k] = v; gradingTest(page); });
  on(page, 'change', '[data-cell]', (e, el) => { const [k, b] = el.dataset.cell.split('|'); gradingDraft.matrix ||= {}; gradingDraft.matrix[k] ||= {}; gradingDraft.matrix[k][b] = el.value || null; gradingTest(page); });
  on(page, 'change', '[data-wband]', (e, el) => { const [id, k] = el.dataset.wband.split('|'); gradingDraft.weighted.bands[id][k] = k === 'grade' ? el.value : numOrNull(el.value); gradingTest(page); });
  on(page, 'change', '[data-rule]', (e, el) => { const [id, k] = el.dataset.rule.split('|'); gradingDraft.specialRules[id][k] = k === 'enabled' ? el.checked : ['level', 'percent'].includes(k) ? numOrNull(el.value) : el.value; if (k === 'type') draw(); });
  on(page, 'input', '#gt-kpi, #gt-kbi', () => gradingTest(page));
  on(page, 'click', '[data-addband]', (e, el) => { const kind = el.dataset.addband; const id = `${kind === 'kpiBands' ? 'k' : 'b'}${Date.now().toString(36)}`; gradingDraft[kind] ||= {}; gradingDraft[kind][id] = { id, label: '', min: null, max: null, minInclusive: true, maxInclusive: false, order: Object.keys(gradingDraft[kind]).length + 1 }; draw(); });
  on(page, 'click', '[data-delband]', (e, el) => { const [kind, id] = el.dataset.delband.split('|'); delete gradingDraft[kind][id]; Object.values(gradingDraft.matrix || {}).forEach((row) => delete row[id]); if (kind === 'kpiBands') delete gradingDraft.matrix?.[id]; draw(); });
  on(page, 'click', '[data-addgrade]', () => { const c = page.querySelector('#new-grade-code').value.trim().toUpperCase(); if (!c || !/^[A-Z0-9_]+$/.test(c)) { toast('Mã xếp loại chỉ gồm chữ/số.', 'error'); return; } gradingDraft.grades[c] = { label: c, order: Object.keys(gradingDraft.grades).length + 1, color: 'gray' }; draw(); });
  on(page, 'click', '[data-delgrade]', (e, el) => { delete gradingDraft.grades[el.dataset.delgrade]; draw(); });
  on(page, 'click', '[data-addrule]', () => { const id = `r${Date.now().toString(36)}`; gradingDraft.specialRules ||= {}; gradingDraft.specialRules[id] = { type: 'cap_if_kbi_value_le', level: 1, grade: Object.keys(gradingDraft.grades)[0], enabled: false, label: '' }; draw(); });
  on(page, 'click', '[data-reset-grading]', () => { gradingDraft = null; draw(); });
  listen('config', (v) => { ctx.config = v || {}; if (tab !== 'grading') draw(); }, { key: 'policies-config' });
  draw();
}

// ---------------------------------------------------------------------------
// Quy trình, mẫu đánh giá, nhãn trạng thái
// ---------------------------------------------------------------------------
async function workflowPage(container, params, query) {
  const page = mountPage(container);
  let tab = query.tab || 'workflow';
  const draw = () => {
    const wf = ctx.config.workflowTemplates?.default || {};
    const fm = ctx.config.formTemplates?.default || {};
    const st = ctx.config.appSettings?.statusLabels || {};
    render(page, html`${pageHead({ title: 'Quy trình phê duyệt & mẫu đánh giá', sub: 'Cấu hình bước phê duyệt, quy tắc trả lại/khóa, tiêu đề & số thứ tự các phần, cột biểu mẫu và nhãn trạng thái', crumbs: [['Quản trị'], ['Quy trình & mẫu']] })}
      ${tabs([{ id: 'workflow', label: 'Quy trình phê duyệt' }, { id: 'form', label: 'Mẫu đánh giá' }, { id: 'status', label: 'Nhãn trạng thái' }], tab)}
      ${tab === 'workflow' ? html`${demoBar(wf, 'config/workflowTemplates/default')}<form id="wf-form" class="grid cols-2">
        <div class="card"><div class="card-header"><h3>Kế hoạch KPI</h3></div><div class="card-body stack">
          <label class="check"><input type="checkbox" name="p_skip" ${wf.kpiPlan?.requireSkipApproval !== false ? raw('checked') : ''}> Yêu cầu quản lý trên một cấp phê duyệt (khi có)</label>
          <label class="check"><input type="checkbox" name="p_ack" ${wf.kpiPlan?.requireAckAll !== false ? raw('checked') : ''}> Bắt buộc tiếp nhận toàn bộ KPI được giao trước khi trình</label>
          <label class="check"><input type="checkbox" name="p_rev" ${wf.kpiPlan?.allowRevisionAfterApproval ? raw('checked') : ''}> Cho phép mở sửa đổi kế hoạch đã duyệt (có lý do)</label>
          <ol>${Object.values(wf.kpiPlan?.steps || {}).sort((a, b) => a.order - b.order).map((s) => html`<li>${s.label}</li>`)}</ol></div></div>
        <div class="card"><div class="card-header"><h3>Đánh giá cuối kỳ</h3></div><div class="card-body stack">
          <label class="check"><input type="checkbox" name="e_skip" ${wf.evaluation?.requireSkipApproval !== false ? raw('checked') : ''}> Yêu cầu quản lý trên một cấp phê duyệt (khi có)</label>
          <label class="check"><input type="checkbox" name="e_ret" ${wf.evaluation?.allowSkipReturnToManager !== false ? raw('checked') : ''}> QL trên một cấp được trả về QL trực tiếp</label>
          <label class="check"><input type="checkbox" name="e_lock" ${wf.evaluation?.autoLockOnApproval ? raw('checked') : ''}> Tự động khóa khi được phê duyệt cuối</label>
          <label class="check"><input type="checkbox" name="e_sum" ${wf.evaluation?.allowEmployeeSummary !== false ? raw('checked') : ''}> Nhân viên được tự nhận xét phần V</label>
          <ol>${Object.values(wf.evaluation?.steps || {}).sort((a, b) => a.order - b.order).map((s) => html`<li>${s.label}</li>`)}</ol></div></div>
        <div class="card" style="grid-column:1/-1"><div class="card-body row between"><div class="small muted">Người thực hiện từng bước được xác định theo quan hệ quản lý của kỳ; người thay thế được cấu hình bằng ủy quyền (bên dưới). Database Rules đọc cấu hình từ bản chụp của kỳ.</div><div class="row"><input name="reason" placeholder="Lý do thay đổi"><button type="button" class="btn primary" data-save-wf>Lưu quy trình</button></div></div></div>
      </form>${delegationBlock()}` : ''}
      ${tab === 'form' ? html`<form id="form-form" class="stack">
        <div class="card"><div class="card-body form-grid">
          <div class="field"><label>Tiêu đề bản đánh giá ({year} = năm kỳ)</label><input name="title" value="${fm.title || ''}"></div>
          <div class="field"><label>Tiêu đề bộ chỉ tiêu</label><input name="planTitle" value="${fm.planTitle || ''}"></div>
          <div class="field"><label>Nhóm cột mục tiêu</label><input name="targetGroupLabel" value="${fm.targetGroupLabel || ''}"></div>
          <div class="field"><label>Nhóm cột kết quả</label><input name="resultGroupLabel" value="${fm.resultGroupLabel || ''}"></div>
          <div class="field span-2"><label>Hướng dẫn phần KBI</label><textarea name="kbiIntro" rows="2">${fm.kbiIntro || ''}</textarea></div>
          <div class="field span-2"><label>Ghi chú pháp lý về xác nhận điện tử</label><textarea name="legalNote" rows="2">${fm.legalNote || ''}</textarea></div>
        </div></div>
        <div class="grid cols-2">
          <div class="card"><div class="card-header"><h3>Các phần của biểu mẫu</h3></div><div class="card-body"><table class="data"><thead><tr><th>Phần</th><th>Số thứ tự</th><th>Tiêu đề</th></tr></thead><tbody>
            ${Object.entries(fm.sections || {}).sort((a, b) => a[1].order - b[1].order).map(([k, s]) => html`<tr><td class="mono">${k}</td><td><input name="sec_num_${k}" value="${s.number}" style="width:70px"></td><td><input name="sec_title_${k}" value="${s.title}"></td></tr>`)}</tbody></table></div></div>
          <div class="card"><div class="card-header"><h3>Cột bảng KPI</h3></div><div class="card-body"><table class="data"><thead><tr><th>Cột</th><th>Hiển thị</th><th>Nhãn</th></tr></thead><tbody>
            ${Object.entries(fm.kpiColumns || {}).sort((a, b) => a[1].order - b[1].order).map(([k, col]) => html`<tr><td class="mono">${k}</td><td><input type="checkbox" name="col_vis_${k}" ${col.visible !== false ? raw('checked') : ''}></td><td><input name="col_label_${k}" value="${col.label}"></td></tr>`)}</tbody></table></div></div>
        </div>
        <div class="card"><div class="card-header"><h3>Nhãn ký xác nhận & tổng hợp</h3></div><div class="card-body form-grid cols-3">
          ${['employee', 'manager', 'skip'].map((k) => html`<div class="field"><label>Ký đánh giá – ${k}</label><input name="sig_${k}" value="${fm.signatureLabels?.[k] || ''}"></div>`)}
          ${['employee', 'manager', 'skip'].map((k) => html`<div class="field"><label>Ký bộ KPI – ${k}</label><input name="psig_${k}" value="${fm.planSignatureLabels?.[k] || ''}"></div>`)}
          ${Object.entries(fm.reviewRows || {}).map(([k, v]) => html`<div class="field"><label>Phần V – ${k}</label><input name="rev_${k}" value="${v}"></div>`)}
        </div></div>
        <div class="row end"><input name="reason" placeholder="Lý do thay đổi" style="max-width:360px"><button type="button" class="btn primary" data-save-form>Lưu mẫu đánh giá</button></div>
      </form>` : ''}
      ${tab === 'status' ? html`<form id="st-form" class="stack">${Object.entries(FALLBACK_STATUS).map(([type, codes]) => html`<div class="card"><div class="card-header"><h3>${type}</h3></div><div class="card-body"><table class="data"><thead><tr><th>Mã</th><th>Nhãn</th><th>Màu</th></tr></thead><tbody>
          ${Object.keys({ ...codes, ...(st[type] || {}) }).map((code) => html`<tr><td class="mono">${code}</td><td><input name="st_${type}_${code}_label" value="${st[type]?.[code]?.label || codes[code]?.[0] || code}"></td><td><select name="st_${type}_${code}_color">${options(COLORS, st[type]?.[code]?.color || codes[code]?.[1] || 'gray')}</select></td></tr>`)}</tbody></table></div></div>`)}
        <div class="row end"><button type="button" class="btn primary" data-save-status>Lưu nhãn trạng thái</button></div></form>` : ''}`);
  };
  const delegationBlock = () => {
    const d = ctx.delegations || {};
    const mine = Object.entries(d[ctx.userId] || {});
    const all = can('managePeriods') ? Object.entries(d).flatMap(([from, tos]) => Object.entries(tos).map(([to, x]) => ({ from, to, ...x }))) : mine.map(([to, x]) => ({ from: ctx.userId, to, ...x }));
    return html`<div class="card mt-3"><div class="card-header"><h3>Ủy quyền phê duyệt (kỳ ${ctx.period?.name || ''})</h3><button class="btn sm" type="button" data-add-deleg>Thêm ủy quyền</button></div><div class="card-body">
      <div class="table-wrap"><table class="data"><thead><tr><th>Người ủy quyền</th><th>Người được ủy quyền</th><th>Hiệu lực</th><th>Lý do</th><th></th></tr></thead><tbody>
      ${all.length ? all.map((x) => html`<tr><td>${nameOf(x.from)}</td><td>${nameOf(x.to)}</td><td>${x.active ? html`<span class="badge c-green">Đang hiệu lực</span>` : html`<span class="badge c-gray">Đã tắt</span>`}</td><td>${x.reason || ''}</td><td class="actions">${x.active ? html`<button class="btn xs" type="button" data-off-deleg="${x.from}|${x.to}">Tắt</button>` : ''}</td></tr>`) : html`<tr><td colspan="5" class="muted">Chưa có ủy quyền.</td></tr>`}
      </tbody></table></div><div class="small muted mt-1">Người được ủy quyền thực hiện thay bước của quản lý trực tiếp/quản lý trên một cấp; Rules kiểm tra ủy quyền đang hiệu lực.</div></div></div>`;
  };
  const guard = (fn) => (e, el) => busy(el, async () => { try { await fn(el); toast('Đã lưu.'); } catch (err) { toast(mapError(err), 'error'); } });
  on(page, 'click', '[data-tab]', (e, el) => { tab = el.dataset.tab; setQuery({ tab }); draw(); });
  on(page, 'click', '[data-save-wf]', guard(async () => {
    const f = formValues(page.querySelector('#wf-form'));
    const prev = ctx.config.workflowTemplates?.default || {};
    await savePolicy('config/workflowTemplates/default', { ...prev, kpiPlan: { ...(prev.kpiPlan || {}), requireSkipApproval: !!f.p_skip, requireAckAll: !!f.p_ack, allowRevisionAfterApproval: !!f.p_rev }, evaluation: { ...(prev.evaluation || {}), requireSkipApproval: !!f.e_skip, allowSkipReturnToManager: !!f.e_ret, autoLockOnApproval: !!f.e_lock, allowEmployeeSummary: !!f.e_sum } }, prev, f.reason, 'workflow_change');
  }));
  on(page, 'click', '[data-save-form]', guard(async () => {
    const f = formValues(page.querySelector('#form-form'));
    const prev = ctx.config.formTemplates?.default || {};
    const next = clone(prev);
    ['title', 'planTitle', 'targetGroupLabel', 'resultGroupLabel', 'kbiIntro', 'legalNote'].forEach((k) => { next[k] = f[k]; });
    Object.keys(next.sections || {}).forEach((k) => { next.sections[k].number = f[`sec_num_${k}`]; next.sections[k].title = f[`sec_title_${k}`]; });
    Object.keys(next.kpiColumns || {}).forEach((k) => { next.kpiColumns[k].visible = !!f[`col_vis_${k}`]; next.kpiColumns[k].label = f[`col_label_${k}`]; });
    ['employee', 'manager', 'skip'].forEach((k) => { next.signatureLabels ||= {}; next.signatureLabels[k] = f[`sig_${k}`]; next.planSignatureLabels ||= {}; next.planSignatureLabels[k] = f[`psig_${k}`]; });
    Object.keys(next.reviewRows || {}).forEach((k) => { next.reviewRows[k] = f[`rev_${k}`]; });
    await savePolicy('config/formTemplates/default', next, prev, f.reason, 'form_template_change');
  }));
  on(page, 'click', '[data-save-status]', guard(async () => {
    const f = formValues(page.querySelector('#st-form'));
    const st = clone(ctx.config.appSettings?.statusLabels || {});
    for (const [k, v] of Object.entries(f)) {
      const m = k.match(/^st_(\w+?)_(\w+)_(label|color)$/);
      if (!m) continue;
      const [, type, code, prop] = m;
      st[type] ||= {}; st[type][code] ||= {}; st[type][code][prop] = v;
    }
    await write({ 'config/appSettings/statusLabels': st, ...auditUpdate({ type: 'status_labels_change', entity: 'config', entityId: 'appSettings/statusLabels' }) });
  }));
  on(page, 'click', '[data-add-deleg]', () => {
    if (!ctx.periodId) return;
    openModal({ title: 'Thêm ủy quyền phê duyệt', body: html`<form id="dg-form" class="stack">
      ${can('managePeriods') ? html`<div class="field"><label>Người ủy quyền</label><select name="from">${options(Object.entries(ctx.profiles).map(([id, p]) => ({ value: id, label: p.name })), ctx.userId)}</select></div>` : html`<input type="hidden" name="from" value="${ctx.userId}">`}
      <div class="field"><label class="req">Người được ủy quyền</label><select name="to">${options(Object.entries(ctx.profiles).filter(([id]) => id !== ctx.userId).map(([id, p]) => ({ value: id, label: `${p.name} – ${p.title || ''}` })), '', { placeholder: '— Chọn —' })}</select></div>
      <div class="field"><label>Lý do</label><input name="reason"></div></form>`,
      actions: [{ label: 'Hủy', value: null }, { label: 'Lưu', kind: 'primary', onClick: async ({ el, close }) => {
        const f = formValues(el.querySelector('#dg-form'));
        if (!f.to || f.to === f.from) { toast('Chọn người được ủy quyền hợp lệ.', 'error'); return false; }
        try { await write({ [`delegations/${ctx.periodId}/${f.from}/${f.to}`]: { active: true, createdAt: NOW(), createdBy: ctx.userId, reason: f.reason || null }, ...auditUpdate({ type: 'delegation_add', entity: 'delegation', entityId: `${f.from}>${f.to}`, periodId: ctx.periodId, reason: f.reason }) }); toast('Đã thêm ủy quyền.'); close(true); draw(); } catch (e) { toast(mapError(e), 'error'); }
        return true;
      } }] });
  });
  on(page, 'click', '[data-off-deleg]', guard(async (el) => {
    const [from, to] = el.dataset.offDeleg.split('|');
    await write({ [`delegations/${ctx.periodId}/${from}/${to}/active`]: false, ...auditUpdate({ type: 'delegation_off', entity: 'delegation', entityId: `${from}>${to}`, periodId: ctx.periodId }) });
  }));
  listen('config', (v) => { ctx.config = v || {}; draw(); }, { key: 'wf-config' });
  if (ctx.periodId) listen(`delegations/${ctx.periodId}`, (v) => { ctx.delegations = v || {}; draw(); }, { key: 'wf-deleg' });
  draw();
}

export const routes = [
  { path: '/admin/policies', title: 'Chính sách', allow: () => can('manageConfig'), render: policiesPage },
  { path: '/admin/workflow', title: 'Quy trình & mẫu', allow: () => can('manageConfig'), render: workflowPage },
];
