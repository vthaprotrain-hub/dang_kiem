/**
 * KBI: danh mục giá trị cốt lõi & khung hành vi 1–5 (HR cấu hình), theo dõi KBI cá nhân/đơn vị theo quyền.
 */
import { mapError, listen } from '../services/database.service.js';
import { ctx, kbiValuesFor, unitName } from '../state.js';
import { can } from '../permissions.js';
import { html, render, ui, fmt, toast, busy, confirmDialog, openModal, mountPage, on, formValues, multiline, groupBy } from '../utils.js';
import { pageHead, options, userCell } from '../components.js';
import { badge, sortedDict, demoBadge } from '../labels.js';
import { icon } from '../icons.js';
import { saveKbiValue, setKbiStatus, kbiHistory, emptyValue, LEVELS } from '../services/kbi.service.js';
import { watchScope, buildRows } from '../services/report.service.js';
import { checkList, wireCheckLists } from './catalog.js';
import { unitOptions } from '../services/organization.service.js';

function valueForm(v) {
  const a = v.appliesTo || { scope: 'company' };
  return html`<form id="kbi-form" class="stack" novalidate>
    <div class="form-grid cols-4">
      <div class="field"><label class="req">Mã</label><input name="code" value="${v.code || ''}"></div>
      <div class="field" style="grid-column:span 2"><label class="req">Tên giá trị cốt lõi</label><input name="name" value="${v.name || ''}"></div>
      <div class="field"><label>Thứ tự</label><input type="number" name="order" value="${v.order ?? ''}"></div>
      <div class="field"><label>Trọng số trong KBI</label><input type="number" step="any" name="weight" value="${v.weight ?? 1}"><span class="help">Dùng khi chính sách KBI chọn "trung bình có trọng số".</span></div>
      <div class="field"><label>Ngày hiệu lực</label><input type="date" name="effectiveFrom" value="${v.effectiveFrom || ''}"></div>
      <div class="field"><label>Trạng thái</label><select name="status">${options([{ value: 'active', label: 'Đang sử dụng' }, { value: 'inactive', label: 'Ngừng sử dụng' }, { value: 'archived', label: 'Lưu trữ' }], v.status || 'active')}</select></div>
      <div class="field"><label class="check"><input type="checkbox" name="bumpVersion"> Tăng phiên bản (v${v.version || 1} → v${(v.version || 1) + 1})</label></div>
    </div>
    <div class="form-grid">
      <div class="field span-2"><label class="req">Định nghĩa</label><textarea name="definition">${v.definition || ''}</textarea></div>
      <div class="field"><label>Các biểu hiện hành vi</label><textarea name="behaviors">${v.behaviors || ''}</textarea></div>
      <div class="field"><label>Hướng dẫn chấm điểm</label><textarea name="scoringGuide">${v.scoringGuide || ''}</textarea></div>
      <div class="field"><label>Biểu hiện đạt kỳ vọng</label><textarea name="meetsExpectation">${v.meetsExpectation || ''}</textarea></div>
      <div class="field"><label>Biểu hiện cần cải thiện</label><textarea name="needsImprovement">${v.needsImprovement || ''}</textarea></div>
      <div class="field span-2"><label>Ví dụ minh chứng</label><textarea name="evidenceExamples" rows="2">${v.evidenceExamples || ''}</textarea></div>
    </div>
    <fieldset><legend>Mô tả hành vi theo mức 1 – 5</legend><div class="form-grid">
      ${LEVELS.map((l) => html`<div class="field ${l === 5 ? 'span-2' : ''}"><label>Mức ${l} – tiêu đề</label><input name="t${l}" value="${v.levels?.[l]?.title || `Mức ${l}`}"><textarea name="d${l}" rows="3" placeholder="Mô tả hành vi mức ${l}">${v.levels?.[l]?.description || ''}</textarea></div>`)}
    </div></fieldset>
    <div class="form-grid">
      <div class="field"><label>Phạm vi áp dụng</label><select name="scope">${options([{ value: 'company', label: 'Toàn công ty' }, { value: 'titleGroups', label: 'Nhóm chức danh' }, { value: 'units', label: 'Đơn vị' }], a.scope)}</select></div>
      <div class="field" data-scope-part="titleGroups"><label>Nhóm chức danh</label>${checkList('titleGroups', sortedDict(ctx.config.appSettings?.titleGroups || {}).map(([id, g]) => ({ value: id, label: g.label })), a.titleGroups, { search: false })}</div>
      <div class="field" data-scope-part="units"><label>Đơn vị</label>${checkList('unitIds', unitOptions().map((u) => ({ value: u.id, label: u.label })), a.unitIds)}</div>
    </div>
    <div class="field"><label>Lý do thay đổi</label><input name="reason"></div>
    <div id="kbi-err"></div>
  </form>`;
}

function openValueForm(id) {
  const prev = id ? ctx.kbiCatalog[id] : null;
  const v = prev || emptyValue();
  openModal({
    title: id ? `Sửa giá trị cốt lõi – ${v.name}` : 'Thêm giá trị cốt lõi', size: 'xl', body: valueForm(v),
    actions: [{ label: 'Hủy', value: null }, {
      label: 'Lưu', kind: 'primary', onClick: async ({ el, close }) => {
        const f = formValues(el.querySelector('#kbi-form'));
        if (!f.code.trim() || !f.name.trim() || !f.definition.trim()) { render(el.querySelector('#kbi-err'), html`<div class="alert danger"><div>Nhập mã, tên và định nghĩa.</div></div>`); return false; }
        const levels = Object.fromEntries(LEVELS.map((l) => [l, { title: f[`t${l}`] || `Mức ${l}`, description: f[`d${l}`] || '' }]));
        const appliesTo = { scope: f.scope, ...(f.scope === 'titleGroups' ? { titleGroups: f.titleGroups || {} } : {}), ...(f.scope === 'units' ? { unitIds: f.unitIds || {} } : {}) };
        const data = {
          code: f.code.trim(), name: f.name.trim(), order: Number(f.order) || 99, weight: Number(f.weight) || 1, effectiveFrom: f.effectiveFrom || null, status: f.status,
          definition: f.definition, behaviors: f.behaviors, scoringGuide: f.scoringGuide, meetsExpectation: f.meetsExpectation, needsImprovement: f.needsImprovement,
          evidenceExamples: f.evidenceExamples, levels, appliesTo, bumpVersion: !!f.bumpVersion,
        };
        try { await saveKbiValue(id, data, prev, f.reason); toast('Đã lưu giá trị cốt lõi.'); close(true); } catch (e) { render(el.querySelector('#kbi-err'), html`<div class="alert danger"><div>${mapError(e)}</div></div>`); }
        return true;
      },
    }],
    onMount: (b) => {
      wireCheckLists(b);
      const sync = () => { const sc = b.querySelector('[name=scope]').value; b.querySelectorAll('[data-scope-part]').forEach((x) => { x.style.display = x.dataset.scopePart === sc ? '' : 'none'; }); };
      b.querySelector('[name=scope]').addEventListener('change', sync);
      sync();
    },
  });
}

async function catalogPage(container) {
  const page = mountPage(container);
  const draw = () => {
    const vals = Object.entries(ctx.kbiCatalog).map(([id, v]) => ({ id, ...v })).sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
    const pol = ctx.period?.policies?.kbi || ctx.config.kbiPolicies?.default;
    const editable = can('manageKbi');
    render(page, html`${pageHead({ title: 'KBI – Giá trị cốt lõi & khung hành vi', sub: 'Danh mục giá trị cốt lõi hiện hành của OPES và mô tả hành vi theo các mức 1–5 (nội dung lưu trong dữ liệu, chỉnh sửa được)', crumbs: [['Danh mục'], ['KBI']],
      actions: editable ? html`<button class="btn primary" data-act="new">${icon('plus', 16)} Thêm giá trị cốt lõi</button>` : '' })}
      <div class="card mb-2"><div class="card-body row between">
        <div><b>Chính sách KBI áp dụng cho kỳ ${ctx.period?.name || ''}:</b> Kết quả chính thức = ${({ manager: 'điểm quản lý trực tiếp', self: 'điểm tự đánh giá', manager_else_self: 'điểm quản lý (nếu có), nếu không lấy tự đánh giá', average: `trung bình có trọng số (tự đánh giá ${pol?.selfWeight}, quản lý ${pol?.managerWeight})` })[pol?.officialSource] || 'chưa cấu hình'};
          tổng hợp ${pol?.aggregate === 'weighted' ? 'trung bình có trọng số' : 'trung bình cộng'}; ${pol?.decimals ?? 2} chữ số thập phân.
          ${pol?.capRules?.negativeBehavior?.enabled ? html`<br><span class="small">Quy tắc: ${pol.capRules.negativeBehavior.label}</span>` : ''}</div>
        <div class="row">${demoBadge(pol?.isDemo)}${can('manageConfig') ? html`<a class="btn sm" href="#/admin/policies?tab=kbi">Cấu hình chính sách</a>` : ''}</div>
      </div></div>
      <div class="table-wrap tall"><table class="sheet"><thead><tr><th>Giá trị cốt lõi</th><th>Định nghĩa</th>${LEVELS.map((l) => html`<th>Mức ${l}</th>`)}<th>Áp dụng</th><th></th></tr></thead><tbody>
      ${vals.length ? vals.map((v) => html`<tr class="${v.status !== 'active' ? 'revoked' : ''}">
        <td class="group-cell">${v.name}<div class="small muted">${v.code} · v${v.version || 1}</div>${badge('catalog', v.status)}</td>
        <td style="min-width:220px">${multiline(v.definition)}${v.scoringGuide ? html`<div class="small muted mt-1">${v.scoringGuide}</div>` : ''}</td>
        ${LEVELS.map((l) => html`<td class="kbi-level" style="min-width:150px"><span class="lvl-no">${l}</span>${v.levels?.[l]?.description || ''}</td>`)}
        <td class="small">${v.appliesTo?.scope === 'company' || !v.appliesTo ? 'Toàn công ty' : v.appliesTo.scope === 'units' ? Object.keys(v.appliesTo.unitIds || {}).map(unitName).join(', ') : Object.keys(v.appliesTo.titleGroups || {}).join(', ')}</td>
        <td class="actions">${editable ? html`<button class="btn xs" data-edit="${v.id}">Sửa</button> <button class="btn xs" data-status="${v.id}">${v.status === 'active' ? 'Ngừng' : 'Kích hoạt'}</button>` : ''} <button class="btn xs" data-hist="${v.id}">Lịch sử</button></td></tr>`) : html`<tr><td colspan="9">${ui.empty('Chưa có giá trị cốt lõi.')}</td></tr>`}
      </tbody></table></div>`);
  };
  on(page, 'click', '[data-act=new]', () => openValueForm(null));
  on(page, 'click', '[data-edit]', (e, el) => openValueForm(el.dataset.edit));
  on(page, 'click', '[data-status]', (e, el) => busy(el, async () => {
    const v = ctx.kbiCatalog[el.dataset.status];
    const to = v.status === 'active' ? 'inactive' : 'active';
    const r = await confirmDialog({ title: to === 'inactive' ? 'Ngừng sử dụng giá trị cốt lõi' : 'Kích hoạt lại', message: v.name, requireReason: to === 'inactive' });
    if (!r) return;
    try { await setKbiStatus(el.dataset.status, v, to, r.reason); draw(); } catch (err) { toast(mapError(err), 'error'); }
  }));
  on(page, 'click', '[data-hist]', async (e, el) => {
    const h = await kbiHistory(el.dataset.hist);
    openModal({ title: `Lịch sử – ${ctx.kbiCatalog[el.dataset.hist]?.name}`, drawer: true, body: h ? (h.length ? html`<ul class="timeline">${h.map((x) => html`<li><b>${x.action}</b> · ${x.byName} · ${fmt.datetime(x.at)}${x.reason ? html`<div class="small">Lý do: ${x.reason}</div>` : ''}</li>`)}</ul>` : ui.empty('Chưa có lịch sử.')) : ui.denied('Bạn không có quyền xem lịch sử danh mục.') });
  });
  // đồng bộ realtime khi danh mục thay đổi
  listen('kbiCatalog', (v) => { ctx.kbiCatalog = v || {}; draw(); }, { key: 'kbi-catalog-page' });
  draw();
}

async function trackingPage(container) {
  const page = mountPage(container);
  if (!ctx.periodId) { render(page, ui.empty('Chưa chọn kỳ đánh giá.')); return; }
  let data = null;
  let view = 'person';
  const draw = () => {
    if (!data) { render(page, ui.loading()); return; }
    const values = kbiValuesFor();
    const rows = buildRows(data).filter((r) => r.evaluation);
    const byUnit = groupBy(rows, (r) => r.centerId);
    const avg = (arr) => (arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : null);
    render(page, html`${pageHead({ title: 'Theo dõi KBI', sub: 'Điểm tự đánh giá, điểm quản lý và kết quả chính thức theo từng giá trị cốt lõi', crumbs: [['Danh mục'], ['Theo dõi KBI']] })}
      <div class="toolbar"><div class="field"><label>Hiển thị theo</label><select id="kbi-view">${options([{ value: 'person', label: 'Cá nhân' }, { value: 'unit', label: 'Đơn vị' }], view)}</select></div></div>
      ${view === 'person' ? html`<div class="table-wrap tall"><table class="data"><thead><tr><th>Nhân sự</th><th>Đánh giá</th>${values.map((v) => html`<th class="center">${v.name}<div class="small muted">TĐG / QL / KQ</div></th>`)}<th class="num">KBI</th></tr></thead><tbody>
        ${rows.length ? rows.map((r) => html`<tr><td>${userCell(r.userId)}</td><td>${badge('evaluation', r.evalStatus)}</td>
          ${values.map((v) => { const k = r.computed?.kbi.rows.find((x) => x.id === v.id); return html`<td class="center nowrap">${k?.self ?? '—'} / ${k?.manager ?? '—'} / <b>${k?.official ?? '—'}</b>${k?.capped ? html` <span class="badge c-amber" title="Giới hạn tối đa do hành vi mức 1–2">≤3</span>` : ''}</td>`; })}
          <td class="num"><b>${r.kbi !== null ? fmt.number(r.kbi, 2) : r.kbiProvisional !== null ? html`<span class="muted">${fmt.number(r.kbiProvisional, 2)}*</span>` : '—'}</b></td></tr>`) : html`<tr><td colspan="${values.length + 3}">${ui.empty('Chưa có hồ sơ đánh giá trong phạm vi.')}</td></tr>`}
      </tbody></table></div>` : html`<div class="table-wrap"><table class="data"><thead><tr><th>Đơn vị</th><th class="num">Số hồ sơ</th>${values.map((v) => html`<th class="num">${v.name}</th>`)}<th class="num">KBI bình quân</th></tr></thead><tbody>
        ${[...byUnit.entries()].map(([u, rs]) => html`<tr><td>${unitName(u)}</td><td class="num">${rs.length}</td>${values.map((v) => { const xs = rs.map((r) => r.computed?.kbi.rows.find((x) => x.id === v.id)?.official).filter((x) => x !== null && x !== undefined); return html`<td class="num">${xs.length ? fmt.number(avg(xs), 2) : '—'}</td>`; })}
          <td class="num"><b>${(() => { const xs = rs.map((r) => r.kbi).filter((x) => x !== null); return xs.length ? fmt.number(avg(xs), 2) : '—'; })()}</b></td></tr>`)}
      </tbody></table></div>`}
      <div class="small muted mt-1">* Tạm tính khi chưa đủ điểm chính thức. Chưa chấm không được tính là 0.</div>`);
  };
  on(page, 'change', '#kbi-view', (e, el) => { view = el.value; draw(); });
  watchScope(ctx.periodId, (d) => { data = d; draw(); });
  draw();
}

export const routes = [
  { path: '/kbi/catalog', title: 'KBI – Giá trị cốt lõi', render: catalogPage },
  { path: '/kbi/tracking', title: 'Theo dõi KBI', render: trackingPage },
];
