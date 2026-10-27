/**
 * Cây KPI: truy vết KPI từ cấp trên xuống cấp dưới (KPI cha → sub-KPI trong kế hoạch → KPI giao xuống
 * kế hoạch cấp dưới), kèm mức độ bao phủ, tiến độ trạng thái và kết quả tạm tính ở từng cấp.
 */
import { ctx, nameOf } from '../state.js';
import { can, seesAll } from '../permissions.js';
import { html, render, ui, fmt, mountPage, on } from '../utils.js';
import { pageHead, options } from '../components.js';
import { badge, sourceBadge } from '../labels.js';
import { buildKpiTree } from '../services/kpi.service.js';
import { watchScope } from '../services/report.service.js';
import { computeFor } from '../services/evaluation.service.js';

async function treePage(container, params, query) {
  const page = mountPage(container);
  if (!ctx.periodId) { render(page, ui.empty('Chưa chọn kỳ đánh giá.')); return; }
  let data = null;
  const collapsed = new Set();
  const top = Object.entries(ctx.periodUsers).find(([, u]) => !u.managerId)?.[0];
  let rootId = query.root || (seesAll() && top ? top : ctx.userId);
  const draw = () => {
    if (!data) { render(page, ui.loading()); return; }
    const plans = data.plans || {};
    const results = {};
    const resultOf = (uid) => {
      if (!(uid in results)) results[uid] = plans[uid] ? computeFor({ plan: plans[uid], evaluation: data.evaluations?.[uid], periodUser: ctx.periodUsers[uid] }) : null;
      return results[uid];
    };
    const { roots, direct } = buildKpiTree(rootId, plans);
    const owners = Object.keys(plans).filter((u) => Object.keys(plans[u].items || {}).length).map((u) => ({ value: u, label: `${nameOf(u)} – ${ctx.periodUsers[u]?.title || ''}` }));
    const node = (n) => {
      const s = n.item.spec;
      const res = resultOf(n.userId)?.kpi.rows.find((r) => r.id === n.itemId);
      const downKids = n.children.filter((c) => c.userId !== n.userId);
      const coverage = downKids.length ? downKids.length : 0;
      const plan = plans[n.userId];
      const isCollapsed = collapsed.has(n.key);
      return html`<li class="${isCollapsed ? 'collapsed' : ''}"><div class="node ${s.state === 'revoked' ? 'inactive' : ''}">
          <button class="toggle ${n.children.length ? '' : 'leaf'}" data-toggle="${n.key}" aria-label="Mở/đóng">${isCollapsed ? '▶' : '▼'}</button>
          <span class="avatar sm" title="${nameOf(n.userId)}">${(nameOf(n.userId) || '?').split(' ').slice(-1)[0][0]}</span>
          <span><b>${s.title}</b> <span class="meta">· ${nameOf(n.userId)} · ${s.parentItemId ? `tỷ lệ ${fmt.weight(n.item.weight)} trong KPI cha` : `trọng số ${fmt.weight(n.item.weight)}`}</span></span>
          ${sourceBadge(s.source)}${s.weightMode === 'flex' ? html`<span class="badge c-blue">B ≥${s.minWeight}%</span>` : s.source === 'assigned' ? html`<span class="badge c-slate">A</span>` : ''}
          ${s.source === 'assigned' ? badge('ack', n.item.ack?.status || 'pending') : ''}
          ${badge('plan', plan?.status || 'none')}
          ${coverage ? html`<span class="badge c-teal" title="Số kế hoạch cấp dưới nhận phân rã">Giao xuống: ${coverage}</span>` : ''}
          <span class="meta">${res ? (res.status === 'scored' ? `Tỷ lệ hoàn thành: ${fmt.percent(res.ratio)}` : res.status === 'missing' ? 'Chưa có kết quả' : res.status === 'excluded' ? 'Không tính' : 'Cấu hình chưa hợp lệ') : ''}</span>
          <a class="btn xs" href="#/kpi/plan/${ctx.periodId}/${n.userId}">Kế hoạch</a>
        </div>${n.children.length ? html`<ul>${n.children.map(node)}</ul>` : ''}</li>`;
    };
    render(page, html`${pageHead({ title: 'Cây KPI', sub: 'Truy vết KPI TOP-DOWN và phân rã sub-KPI theo quan hệ cha – con', crumbs: [['Quản lý KPI'], ['Cây KPI']] })}
      <div class="toolbar"><div class="field" style="min-width:320px"><label>KPI gốc của</label><select id="tree-root">${options(owners.length ? owners : [{ value: ctx.userId, label: nameOf(ctx.userId) }], rootId)}</select></div>
        <button class="btn" data-expand="all">Mở tất cả</button><button class="btn" data-expand="none">Thu gọn</button></div>
      <div class="card"><div class="card-body">
        ${roots.length ? html`<ul class="tree">${roots.map(node)}</ul>` : ui.empty(plans[rootId] ? 'Kế hoạch chưa có chỉ tiêu.' : 'Không có kế hoạch KPI của nhân sự này trong phạm vi bạn được xem.')}
        ${direct.length ? html`<h4 class="mt-3">KPI giao trực tiếp (không gắn KPI cha)</h4><ul class="tree">${direct.map(node)}</ul>` : ''}
      </div><div class="card-footer small muted">Tỷ lệ hoàn thành là kết quả tạm tính theo dữ liệu hiện có và chính sách của kỳ. ${!can('viewAllPlans') ? 'Bạn chỉ thấy các nhánh thuộc phạm vi quản lý của mình.' : ''}</div></div>`);
  };
  on(page, 'change', '#tree-root', (e, el) => { rootId = el.value; draw(); });
  on(page, 'click', '[data-toggle]', (e, el) => { const k = el.dataset.toggle; if (collapsed.has(k)) collapsed.delete(k); else collapsed.add(k); draw(); });
  on(page, 'click', '[data-expand]', (e, el) => {
    collapsed.clear();
    if (el.dataset.expand === 'none' && data) {
      const { roots } = buildKpiTree(rootId, data.plans || {});
      const walk = (n) => { if (n.children.length) collapsed.add(n.key); n.children.forEach(walk); };
      roots.forEach(walk);
    }
    draw();
  });
  watchScope(ctx.periodId, (d) => { data = d; draw(); });
  draw();
}

export const routes = [{ path: '/kpi/tree', title: 'Cây KPI', render: treePage }];
