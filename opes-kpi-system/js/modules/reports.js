/**
 * Báo cáo & xuất dữ liệu theo phạm vi quyền: KPI theo đơn vị, KBI theo giá trị cốt lõi, tình trạng giao KPI,
 * trọng số & phân bổ, hoàn thành đánh giá, xếp loại, theo nhân sự, so sánh giữa các kỳ. Xuất CSV/XLSX, in.
 */
import { ctx, unitName, kbiValuesFor } from '../state.js';
import { can, seesAll } from '../permissions.js';
import { html, render, ui, fmt, toast, busy, mountPage, on, groupBy, matches } from '../utils.js';
import { pageHead, tabs, options } from '../components.js';
import { statusLabel, groupName, demoBadge } from '../labels.js';
import { icon } from '../icons.js';
import { watchScope, buildRows, exportCSV, exportXLSX, scopeLabel, loadPeriodScope, pctCell } from '../services/report.service.js';
import { setQuery } from '../router.js';

const TABS = [
  { id: 'kpi_unit', label: 'KPI theo đơn vị' }, { id: 'kbi_value', label: 'KBI theo giá trị cốt lõi' }, { id: 'assign', label: 'Tình trạng giao KPI' },
  { id: 'weights', label: 'Trọng số & phân bổ' }, { id: 'completion', label: 'Hoàn thành đánh giá' }, { id: 'grades', label: 'Kết quả xếp loại' },
  { id: 'person', label: 'Theo nhân sự' }, { id: 'compare', label: 'So sánh giữa các kỳ' },
];
const avg = (xs) => { const v = xs.filter((x) => x !== null && x !== undefined); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
const pct = (v) => (v === null || v === undefined ? '' : `${fmt.number(Math.round(v * 10000) / 100, 2)}%`);
const num2 = (v) => (v === null || v === undefined ? '' : fmt.number(v, 2));

function tableFor(tab, rows, extra) {
  const DONE = ['approved', 'locked'];
  switch (tab) {
    case 'kpi_unit': {
      const g = groupBy(rows, (r) => r.centerId);
      return {
        headers: ['Đơn vị', 'Số nhân sự', 'Kế hoạch đã giao', 'Hồ sơ đủ dữ liệu KPI', 'KPI bình quân (%)', 'KPI thấp nhất (%)', 'KPI cao nhất (%)'],
        rows: [...g.entries()].map(([u, rs]) => { const k = rs.map((r) => r.kpi).filter((x) => x !== null); return [unitName(u), rs.length, rs.filter((r) => r.planStatus === 'approved').length, k.length, pct(avg(k)), k.length ? pct(Math.min(...k)) : '', k.length ? pct(Math.max(...k)) : '']; }),
      };
    }
    case 'kbi_value': {
      const vals = kbiValuesFor();
      const g = groupBy(rows.filter((r) => r.computed), (r) => r.centerId);
      return {
        headers: ['Đơn vị', 'Số hồ sơ', ...vals.map((v) => `${v.name} (TB chính thức)`), ...vals.map((v) => `${v.name} (TB tự đánh giá)`), 'KBI bình quân'],
        rows: [...g.entries()].map(([u, rs]) => [unitName(u), rs.length,
          ...vals.map((v) => num2(avg(rs.map((r) => r.computed.kbi.rows.find((x) => x.id === v.id)?.official)))),
          ...vals.map((v) => num2(avg(rs.map((r) => r.computed.kbi.rows.find((x) => x.id === v.id)?.self)))),
          num2(avg(rs.map((r) => r.kbi)))]),
      };
    }
    case 'assign':
      return {
        headers: ['Mã NV', 'Họ tên', 'Đơn vị', 'Quản lý trực tiếp', 'Trạng thái kế hoạch', 'Số chỉ tiêu', 'Được giao', 'Sub-KPI', 'Chờ tiếp nhận', 'Đề nghị điều chỉnh'],
        rows: rows.map((r) => [r.pu.employeeCode || '', r.name, r.unitName, r.pu.managerName || '', statusLabel('plan', r.planStatus), r.itemsCount, r.assignedCount, r.subCount, r.pendingAck, r.changeRequests]),
      };
    case 'weights': {
      const groups = [...new Set(rows.flatMap((r) => Object.keys(r.check?.groups || {})))];
      return {
        headers: ['Họ tên', 'Đơn vị', 'Tổng trọng số (%)', 'Hợp lệ', 'Chỉ tiêu chế độ B (điều chỉnh)', ...groups.map((g) => `${groupName(g)} (%)`), 'Lỗi/Cảnh báo'],
        rows: rows.filter((r) => r.itemsCount).map((r) => [r.name, r.unitName, r.weightTotal, r.weightValid ? 'Có' : 'Không', r.flexCount, ...groups.map((g) => r.check?.groups?.[g] ?? ''), [...(r.check?.errors || []), ...(r.check?.warnings || [])].join(' | ')]),
      };
    }
    case 'completion': {
      const st = ['not_started', 'draft', 'returned', 'submitted', 'manager_reviewed', 'approved', 'locked'];
      const g = groupBy(rows, (r) => r.centerId);
      return {
        headers: ['Đơn vị', 'Số nhân sự', ...st.map((s) => statusLabel('evaluation', s)), 'Tỷ lệ hoàn thành'],
        rows: [...g.entries()].map(([u, rs]) => [unitName(u), rs.length, ...st.map((s) => rs.filter((r) => r.evalStatus === s).length), rs.length ? `${fmt.number(Math.round((rs.filter((r) => DONE.includes(r.evalStatus)).length / rs.length) * 1000) / 10, 1)}%` : '']),
      };
    }
    case 'grades': {
      const gr = ctx.period?.policies?.grading?.grades || {};
      const codes = Object.entries(gr).sort((a, b) => (b[1].order || 0) - (a[1].order || 0)).map(([c]) => c);
      const g = groupBy(rows, (r) => r.centerId);
      const codeOf = (r) => (DONE.includes(r.evalStatus) ? r.final?.gradeCode || (r.grade?.status === 'official' ? r.grade.code : null) : null);
      return {
        headers: ['Đơn vị', 'Số hồ sơ hoàn tất', ...codes.map((c) => gr[c].label), 'Chưa có xếp loại chính thức'],
        rows: [...g.entries()].map(([u, rs]) => [unitName(u), rs.filter((r) => DONE.includes(r.evalStatus)).length, ...codes.map((c) => rs.filter((r) => codeOf(r) === c).length), rs.filter((r) => !codeOf(r)).length]),
      };
    }
    case 'person':
      return {
        headers: ['Mã NV', 'Họ tên', 'Chức danh', 'Đơn vị', 'Quản lý trực tiếp', 'Kế hoạch', 'Đánh giá', 'Tổng trọng số', 'Điểm KPI (%)', 'KPI tạm tính (%)', 'Điểm KBI', 'Xếp loại', 'Trạng thái xếp loại'],
        rows: rows.map((r) => [r.pu.employeeCode || '', r.name, r.title, r.unitName, r.pu.managerName || '', statusLabel('plan', r.planStatus), statusLabel('evaluation', r.evalStatus), r.weightTotal ?? '', pctCell(r.kpi), pctCell(r.kpiProvisional), r.kbi ?? '', r.final?.gradeLabel || (r.grade?.status === 'official' ? r.grade.label : ''), r.final ? 'Đã lưu khi phê duyệt' : r.grade?.status === 'official' ? 'Chính thức (chưa phê duyệt)' : 'Chưa đủ dữ liệu']),
      };
    case 'compare': {
      if (!extra?.other) return { headers: ['Chọn kỳ so sánh'], rows: [] };
      const otherRows = buildRows(extra.other, extra.otherPeriod);
      const byId = Object.fromEntries(otherRows.map((r) => [r.userId, r]));
      const cur = (r) => r.final?.kpiScore ?? r.kpi;
      return {
        headers: ['Họ tên', 'Đơn vị', `KPI ${extra.otherPeriod.name}`, `KPI ${ctx.period.name}`, 'Chênh lệch KPI (điểm %)', `KBI ${extra.otherPeriod.name}`, `KBI ${ctx.period.name}`, `Xếp loại ${extra.otherPeriod.name}`, `Xếp loại ${ctx.period.name}`],
        rows: rows.map((r) => { const o = byId[r.userId]; const a = o ? (o.final?.kpiScore ?? o.kpi) : null; const b = cur(r); return [r.name, r.unitName, pct(a), pct(b), a !== null && b !== null && a !== undefined && b !== undefined ? fmt.number(Math.round((b - a) * 10000) / 100, 2) : '', o ? num2(o.final?.kbiScore ?? o.kbi) : '', num2(r.final?.kbiScore ?? r.kbi), o?.final?.gradeLabel || '', r.final?.gradeLabel || '']; }),
      };
    }
    default: return { headers: [], rows: [] };
  }
}

async function reportsPage(container, params, query) {
  const page = mountPage(container);
  if (!ctx.periodId) { render(page, ui.empty('Chưa chọn kỳ đánh giá.')); return; }
  let tab = query.tab || 'kpi_unit';
  const f = { center: query.center || '', q: query.q || '', status: query.status || '', manager: query.manager || '' };
  let data = null, other = null, otherPeriodId = query.compare || Object.keys(ctx.periods).find((p) => p !== ctx.periodId) || '';
  const loadOther = async () => {
    if (!otherPeriodId || !ctx.periods[otherPeriodId]) { other = null; return; }
    other = await loadPeriodScope(otherPeriodId);
  };
  const filtered = () => buildRows(data).filter((r) => (!f.center || r.centerId === f.center) && (!f.status || r.evalStatus === f.status || r.planStatus === f.status)
    && (!f.manager || r.managerId === f.manager) && matches(f.q, r.name, r.title, r.unitName));
  const filterDesc = () => ({ 'Đơn vị': f.center ? unitName(f.center) : '', 'Trạng thái': f.status, 'Quản lý': f.manager ? ctx.profiles[f.manager]?.name : '', 'Từ khóa': f.q, ...(tab === 'compare' ? { 'So sánh với kỳ': ctx.periods[otherPeriodId]?.name } : {}) });
  const draw = () => {
    if (!data) { render(page, ui.loading()); return; }
    const all = buildRows(data);
    const rows = filtered();
    const t = tableFor(tab, rows, { other, otherPeriod: ctx.periods[otherPeriodId] });
    const centers = [...new Set(all.map((r) => r.centerId))];
    const managers = [...new Set(all.map((r) => r.managerId).filter(Boolean))];
    render(page, html`${pageHead({ title: 'Báo cáo & xuất dữ liệu', sub: html`${ctx.period.name} · Phạm vi: ${scopeLabel()} ${demoBadge(ctx.period?.policies?.grading?.isDemo, 'Xếp loại theo cấu hình demo')}`, crumbs: [['Báo cáo']],
      actions: can('exportData') ? html`<button class="btn" data-exp="csv">${icon('download', 16)} Xuất CSV</button><button class="btn" data-exp="xlsx">${icon('download', 16)} Xuất XLSX</button><button class="btn" data-exp="print">${icon('printer', 16)} In</button>` : html`<button class="btn" data-exp="print">${icon('printer', 16)} In</button>` })}
      ${tabs(TABS, tab)}
      <div class="toolbar no-print">
        <div class="field"><label>Đơn vị</label><select data-f="center">${options(centers.map((c) => ({ value: c, label: unitName(c) })), f.center, { placeholder: 'Tất cả' })}</select></div>
        <div class="field"><label>Người phụ trách (QL trực tiếp)</label><select data-f="manager">${options(managers.map((m) => ({ value: m, label: ctx.profiles[m]?.name || m })), f.manager, { placeholder: 'Tất cả' })}</select></div>
        <div class="field"><label>Trạng thái</label><select data-f="status">${options([...['none', 'draft', 'submitted', 'approved', 'returned'].map((s) => ({ value: s, label: `KH: ${statusLabel('plan', s)}` })), ...['not_started', 'submitted', 'manager_reviewed', 'locked'].map((s) => ({ value: s, label: `ĐG: ${statusLabel('evaluation', s)}` }))], f.status, { placeholder: 'Tất cả' })}</select></div>
        <div class="field search"><label>Từ khóa (tên, chức danh)</label><input type="search" data-f="q" value="${f.q}"></div>
        ${tab === 'compare' ? html`<div class="field"><label>So sánh với kỳ</label><select data-compare>${options(Object.entries(ctx.periods).filter(([id]) => id !== ctx.periodId).map(([id, p]) => ({ value: id, label: p.name })), otherPeriodId, { placeholder: '— Chọn —' })}</select></div>` : ''}
      </div>
      <div class="card"><div class="card-header"><div class="small muted">Thời điểm trích xuất: ${fmt.datetime(Date.now())} · ${rows.length} nhân sự sau lọc · ${seesAll() ? 'Toàn bộ dữ liệu kỳ' : 'Chỉ nhân sự thuộc phạm vi quản lý của bạn'}</div></div>
        <div class="table-wrap tall" style="border:0;border-radius:0"><table class="data"><thead><tr>${t.headers.map((h) => html`<th>${h}</th>`)}</tr></thead><tbody>
          ${t.rows.length ? t.rows.map((r) => html`<tr>${r.map((c) => html`<td class="${typeof c === 'number' ? 'num' : ''}">${c}</td>`)}</tr>`) : html`<tr><td colspan="${t.headers.length || 1}">${ui.empty(tab === 'compare' && !other ? 'Chọn kỳ để so sánh.' : 'Không có dữ liệu.')}</td></tr>`}
        </tbody></table></div></div>`);
  };
  const syncQuery = () => setQuery({ tab, ...f, compare: tab === 'compare' ? otherPeriodId : '' });
  on(page, 'click', '[data-tab]', async (e, el) => { tab = el.dataset.tab; syncQuery(); if (tab === 'compare' && !other) { render(page, ui.loading()); await loadOther(); } draw(); });
  on(page, 'change', 'select[data-f]', (e, el) => { f[el.dataset.f] = el.value; syncQuery(); draw(); });
  on(page, 'change', 'input[data-f]', (e, el) => { f[el.dataset.f] = el.value; syncQuery(); draw(); });
  on(page, 'change', '[data-compare]', async (e, el) => { otherPeriodId = el.value; syncQuery(); await loadOther(); draw(); });
  on(page, 'click', '[data-exp]', (e, el) => busy(el, async () => {
    const t = tableFor(tab, filtered(), { other, otherPeriod: ctx.periods[otherPeriodId] });
    const title = `Báo cáo ${TABS.find((x) => x.id === tab).label}`;
    try {
      if (el.dataset.exp === 'csv') exportCSV(title, t.headers, t.rows, filterDesc());
      else if (el.dataset.exp === 'xlsx') await exportXLSX(title, t.headers, t.rows, filterDesc());
      else window.print();
    } catch (err) { toast(`${err.message}. Hãy dùng Xuất CSV.`, 'error'); }
  }));
  if (tab === 'compare') await loadOther();
  watchScope(ctx.periodId, (d) => { data = d; draw(); });
  draw();
}

export const routes = [{ path: '/reports', title: 'Báo cáo', allow: () => can('viewReportsTeam') || can('viewReportsAll'), render: reportsPage }];
