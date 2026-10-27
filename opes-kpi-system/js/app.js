/**
 * Điểm khởi động ứng dụng: xác thực → liên kết hồ sơ → nạp ngữ cảnh (realtime) → khung giao diện → định tuyến.
 */
import { auth, isConfigured, usingEmulators } from './services/firebase.js';
import { onAuthStateChanged } from './services/sdk.js';
import { listen, listenFirst, clearAll, write, mapError } from './services/database.service.js';
import { ensureLinked } from './services/user.service.js';
import { ctx, resetCtx, emit, configWarnings, nameOf } from './state.js';
import { can, hasTeam, isSysAdmin, anyCan } from './permissions.js';
import { html, render, $, initials, fmt, on, toast, raw } from './utils.js';
import { icon } from './icons.js';
import { renderLogin, logout } from './auth.js';
import * as router from './router.js';
import { badge } from './labels.js';
import { watchTasks } from './modules/approvals.js';
import { bootstrapSeedView } from './seed/seed.js';

import { routes as dashboardRoutes } from './modules/dashboard.js';
import { routes as kpiRoutes } from './modules/kpi-management.js';
import { routes as assignRoutes } from './modules/kpi-assign.js';
import { routes as treeRoutes } from './modules/kpi-tree.js';
import { routes as catalogRoutes } from './modules/catalog.js';
import { routes as kbiRoutes } from './modules/kbi-management.js';
import { routes as evalRoutes } from './modules/evaluations.js';
import { routes as approvalRoutes } from './modules/approvals.js';
import { routes as reportRoutes } from './modules/reports.js';
import { routes as orgRoutes } from './modules/organization.js';
import { routes as adminRoutes } from './modules/admin.js';
import { routes as periodRoutes } from './modules/admin-periods.js';
import { routes as policyRoutes } from './modules/admin-policies.js';
import { routes as systemRoutes } from './modules/admin-system.js';

router.addRoutes([
  ...dashboardRoutes, ...kpiRoutes, ...assignRoutes, ...treeRoutes, ...catalogRoutes, ...kbiRoutes, ...evalRoutes, ...approvalRoutes,
  ...reportRoutes, ...orgRoutes, ...adminRoutes, ...periodRoutes, ...policyRoutes, ...systemRoutes,
]);

const root = document.getElementById('app');
const counts = { inbox: 0, approvals: 0, notifications: 0 };
let periodListenersFor = null;

// ---------------------------------------------------------------------------
// Menu động theo quyền
// ---------------------------------------------------------------------------
function menu() {
  const team = hasTeam();
  return [
    { group: 'Tổng quan' },
    { href: '#/dashboard', label: 'Dashboard', icon: 'dashboard', match: '/dashboard' },
    { group: 'Quản lý KPI' },
    { href: '#/kpi/my', label: 'KPI của tôi', icon: 'target', match: '/kpi/my' },
    { href: '#/kpi/inbox', label: 'Nhận KPI được giao', icon: 'inbox', match: '/kpi/inbox', count: 'inbox' },
    can('assignKpi') && team && { href: '#/kpi/assign', label: 'Giao KPI TOP-DOWN', icon: 'send', match: '/kpi/assign' },
    (team || can('viewAllPlans')) && { href: '#/kpi/team', label: 'KPI đội nhóm', icon: 'users', match: '/kpi/team' },
    { href: '#/kpi/tree', label: 'Cây KPI', icon: 'tree', match: '/kpi/tree' },
    (team || can('viewAllPlans')) && { href: '#/kpi/units', label: 'KPI theo đơn vị', icon: 'building', match: '/kpi/units' },
    { href: '#/kpi/history', label: 'Lịch sử giao & điều chỉnh', icon: 'clock', match: '/kpi/history' },
    { group: 'Danh mục' },
    can('viewCatalog') && { href: '#/catalog/kpi', label: 'Kho KPI', icon: 'book', match: '/catalog' },
    { href: '#/kbi/catalog', label: 'KBI – Giá trị cốt lõi', icon: 'heart', match: '/kbi/catalog' },
    (team || can('viewAllEvaluations')) && { href: '#/kbi/tracking', label: 'Theo dõi KBI', icon: 'chart', match: '/kbi/tracking' },
    { group: 'Đánh giá' },
    { href: '#/eval/my', label: 'Đánh giá của tôi', icon: 'clipboard', match: '/eval/my' },
    (team || can('viewAllEvaluations')) && { href: '#/eval/team', label: 'Đánh giá nhân viên', icon: 'users', match: '/eval/team' },
    { href: '#/eval/returned', label: 'Hồ sơ cần bổ sung', icon: 'alert', match: '/eval/returned' },
    { href: '#/approvals', label: 'Trình ký & phê duyệt', icon: 'check', match: '/approvals', count: 'approvals' },
    { href: '#/eval/done', label: 'Hồ sơ đã hoàn tất', icon: 'lock', match: '/eval/done' },
    { href: '#/eval/history', label: 'Lịch sử đánh giá', icon: 'clock', match: '/eval/history' },
    { group: 'Báo cáo' },
    anyCan('viewReportsTeam', 'viewReportsAll') && { href: '#/reports', label: 'Báo cáo & xuất dữ liệu', icon: 'chart', match: '/reports' },
    { group: 'Quản trị hệ thống' },
    anyCan('manageUsers') && { href: '#/admin/users', label: 'Người dùng', icon: 'user', match: '/admin/users' },
    (isSysAdmin() || can('manageUsers')) && { href: '#/admin/roles', label: 'Vai trò & phân quyền', icon: 'shield', match: '/admin/roles' },
    { href: '#/admin/org', label: 'Cơ cấu tổ chức', icon: 'building', match: '/admin/org' },
    can('managePeriods') && { href: '#/admin/periods', label: 'Kỳ đánh giá', icon: 'calendar', match: '/admin/periods' },
    can('manageConfig') && { href: '#/admin/policies', label: 'Công thức, trọng số & xếp loại', icon: 'sliders', match: '/admin/policies' },
    can('manageConfig') && { href: '#/admin/workflow', label: 'Quy trình & mẫu đánh giá', icon: 'flow', match: '/admin/workflow' },
    can('viewAudit') && { href: '#/admin/audit', label: 'Lịch sử thao tác', icon: 'list', match: '/admin/audit' },
    (isSysAdmin() || can('manageConfig') || can('seedData')) && { href: '#/admin/system', label: 'Cấu hình & dữ liệu', icon: 'database', match: '/admin/system' },
  ].filter(Boolean).filter((m, i, arr) => !(m.group && (!arr[i + 1] || arr[i + 1].group)));
}

function renderNav() {
  const nav = $('#nav');
  if (!nav) return;
  const path = router.currentPath();
  render(nav, menu().map((m) => m.group
    ? html`<div class="nav-group">${m.group}</div>`
    : html`<a href="${m.href}" class="${path.startsWith(m.match) ? 'active' : ''}">${icon(m.icon)}<span>${m.label}</span>${m.count && counts[m.count] ? html`<span class="count">${counts[m.count]}</span>` : ''}</a>`));
}

function renderHeader() {
  const p = ctx.profile || {};
  const periods = Object.entries(ctx.periods || {}).sort((a, b) => (b[1].year || 0) - (a[1].year || 0) || String(b[1].startDate).localeCompare(String(a[1].startDate)));
  render($('#header-period'), html`${periods.length ? periods.map(([id, per]) => html`<option value="${id}" ${id === ctx.periodId ? raw('selected') : ''}>${per.name}</option>`) : html`<option value="">Chưa có kỳ đánh giá</option>`}`);
  render($('#header-period-status'), ctx.period ? badge('period', ctx.period.status) : '');
  render($('#header-user'), html`<span class="avatar">${initials(p.name)}</span><span class="who"><b>${p.name || ''}</b><span>${p.title || ''}</span></span>`);
  const bell = $('#bell-count');
  if (bell) { bell.textContent = counts.notifications || ''; bell.classList.toggle('hidden', !counts.notifications); }
}

function renderBanners() {
  const box = $('#banners');
  if (!box) return;
  const items = [];
  if (usingEmulators) items.push(html`<div class="alert info"><div>Đang chạy với <b>Firebase Local Emulator</b>.</div></div>`);
  if ((can('manageConfig') || isSysAdmin()) && ctx.config.appSettings?.configWarningsVisibleToAdmins !== false) {
    const w = configWarnings();
    if (w.length) items.push(html`<div class="alert warning"><div><b>Cảnh báo cấu hình (chỉ quản trị viên thấy):</b><ul>${w.map((x) => html`<li>${x}</li>`)}</ul></div></div>`);
  }
  if (!ctx.periodUser && ctx.period && !can('viewAllPlans')) items.push(html`<div class="alert info"><div>Bạn không thuộc danh sách nhân sự được đánh giá của kỳ <b>${ctx.period.name}</b>.</div></div>`);
  render(box, items);
}

function applyTheme() {
  const c = ctx.config.appSettings?.theme?.primary;
  if (c && /^#[0-9a-f]{6}$/i.test(c)) document.documentElement.style.setProperty('--primary', c);
}

function renderShell() {
  const appName = ctx.config.appSettings?.appName || 'Hệ thống Quản lý KPI & KBI';
  render(root, html`<div class="shell" id="shell">
    <aside class="sidebar" aria-label="Menu chính">
      <div class="brand"><span class="brand-mark"><img src="assets/icons/logo.svg" alt="" width="28" height="28"></span><div><div class="brand-name">OPES KPI &amp; KBI</div><div class="brand-sub">Performance Management</div></div></div>
      <nav class="nav" id="nav"></nav>
    </aside>
    <div class="nav-scrim" id="nav-scrim"></div>
    <div class="main">
      <header class="header">
        <button class="btn ghost icon menu-btn" id="menu-btn" aria-label="Mở menu">${icon('menu')}</button>
        <div class="app-title">${appName}</div>
        <select class="period-select" id="header-period" aria-label="Kỳ đánh giá"></select>
        <span id="header-period-status"></span>
        <span class="spacer"></span>
        <div class="bell">
          <button class="btn ghost icon" id="bell-btn" aria-label="Thông báo">${icon('bell')}</button><span class="count hidden" id="bell-count"></span>
          <div class="notif-panel hidden" id="notif-panel"></div>
        </div>
        <div class="user-box" id="header-user"></div>
        <button class="btn ghost icon" id="logout-btn" title="Đăng xuất" aria-label="Đăng xuất">${icon('logout')}</button>
      </header>
      <main class="content"><div class="banner-stack" id="banners"></div><div id="view"></div></main>
    </div>
  </div>`);
  $('#menu-btn').addEventListener('click', () => $('#shell').classList.toggle('nav-open'));
  $('#nav-scrim').addEventListener('click', () => $('#shell').classList.remove('nav-open'));
  $('#nav').addEventListener('click', (e) => { if (e.target.closest('a')) $('#shell').classList.remove('nav-open'); });
  $('#logout-btn').addEventListener('click', async () => { await logout(); });
  $('#header-period').addEventListener('change', (e) => selectPeriod(e.target.value, true));
  $('#bell-btn').addEventListener('click', toggleNotifications);
  document.addEventListener('click', (e) => { if (!e.target.closest('.bell')) $('#notif-panel')?.classList.add('hidden'); });
  on($('#notif-panel'), 'click', '[data-notif]', async (e, el) => {
    const id = el.dataset.notif;
    if (!ctx.notifications[id]?.read) { try { await write({ [`notifications/${ctx.userId}/${id}/read`]: true }); } catch { /* bỏ qua */ } }
    $('#notif-panel').classList.add('hidden');
  });
  on($('#notif-panel'), 'click', '[data-read-all]', async () => {
    const updates = {};
    for (const [id, n] of Object.entries(ctx.notifications)) if (!n.read) updates[`notifications/${ctx.userId}/${id}/read`] = true;
    try { await write(updates); } catch (e) { toast(mapError(e), 'error'); }
  });
  router.setHooks({ onRoute: (match) => { renderNav(); document.title = `${match?.title || 'OPES'} – KPI & KBI`; } });
  renderHeader();
  renderNav();
  renderBanners();
}

function toggleNotifications() {
  const panel = $('#notif-panel');
  const list = Object.entries(ctx.notifications || {}).map(([id, n]) => ({ id, ...n })).sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 30);
  render(panel, html`<div class="row between" style="padding:10px 14px;border-bottom:1px solid var(--border)"><b>Thông báo</b>${counts.notifications ? html`<button class="btn ghost sm" data-read-all>Đánh dấu đã đọc</button>` : ''}</div>
    ${list.length ? list.map((n) => html`<a class="item ${n.read ? '' : 'unread'}" href="${n.link || '#/dashboard'}" data-notif="${n.id}"><b>${n.title}</b><span class="small">${n.message || ''}</span><span class="small muted" style="display:block">${n.fromName || nameOf(n.fromId)} · ${fmt.relative(n.at)}</span></a>`) : html`<div class="empty">Chưa có thông báo.</div>`}`);
  panel.classList.toggle('hidden');
}

// ---------------------------------------------------------------------------
// Ngữ cảnh
// ---------------------------------------------------------------------------
function choosePeriod() {
  let saved = null;
  try { saved = localStorage.getItem('opes.periodId'); } catch { /* bỏ qua */ }
  const ids = Object.keys(ctx.periods || {});
  if (saved && ctx.periods[saved]) return saved;
  const def = ctx.config.appSettings?.defaultPeriodId;
  if (def && ctx.periods[def]) return def;
  const open = ids.find((id) => ctx.periods[id].status === 'open');
  return open || ids.sort((a, b) => (ctx.periods[b].year || 0) - (ctx.periods[a].year || 0))[0] || null;
}

async function selectPeriod(periodId, userAction = false) {
  ctx.periodId = periodId || null;
  ctx.period = periodId ? ctx.periods[periodId] : null;
  if (userAction) { try { localStorage.setItem('opes.periodId', periodId); } catch { /* bỏ qua */ } }
  if (periodListenersFor !== periodId) {
    periodListenersFor = periodId;
    if (periodId) {
      await Promise.all([
        listenFirst(`evaluationPeriodUsers/${periodId}`, (v) => {
          ctx.periodUsers = v || {};
          ctx.periodUser = ctx.periodUsers[ctx.userId] || null;
          if (ctx.ready) { renderNav(); renderBanners(); emit('periodUsers'); }
          restartTaskWatch();
        }, { scope: 'global', key: 'ctx-period-users', onError: () => { ctx.periodUsers = {}; ctx.periodUser = null; } }).catch(() => {}),
        listenFirst(`delegations/${periodId}`, (v) => { ctx.delegations = v || {}; if (ctx.ready) restartTaskWatch(); }, { scope: 'global', key: 'ctx-delegations' }).catch(() => {}),
        listenFirst(`kpiPlans/${periodId}/${ctx.userId}`, (v) => {
          ctx.myPlan = v;
          counts.inbox = Object.values(v?.items || {}).filter((i) => i.spec?.source === 'assigned' && i.spec?.state !== 'revoked' && i.ack?.status === 'pending').length;
          if (ctx.ready) renderNav();
        }, { scope: 'global', key: 'ctx-my-plan' }).catch(() => {}),
      ]);
    } else {
      ctx.periodUsers = {}; ctx.periodUser = null;
    }
  }
  if (ctx.ready) { renderHeader(); renderNav(); renderBanners(); if (userAction) router.refresh(); }
}

function restartTaskWatch() {
  if (!ctx.periodId) return;
  watchTasks(ctx.periodId, (tasks) => { counts.approvals = tasks.length; renderNav(); }, 'tasks');
}

async function loadContext(userId) {
  ctx.userId = userId;
  const g = { scope: 'global' };
  await Promise.all([
    listenFirst('config', (v) => { ctx.config = v || {}; applyTheme(); if (ctx.ready) { renderBanners(); renderNav(); } emit('config'); }, { ...g, key: 'ctx-config' }),
    listenFirst(`userAccess/${userId}`, (v) => { ctx.access = v || { roles: {}, perms: {} }; if (ctx.ready) { renderNav(); router.refresh(); } }, { ...g, key: 'ctx-access' }),
    listenFirst('userProfiles', (v) => { ctx.profiles = v || {}; ctx.profile = ctx.profiles[userId] || null; if (ctx.ready) renderHeader(); }, { ...g, key: 'ctx-profiles' }),
    listenFirst('organizationUnits', (v) => { ctx.units = v || {}; emit('units'); }, { ...g, key: 'ctx-units' }),
    listenFirst('kbiCatalog', (v) => { ctx.kbiCatalog = v || {}; }, { ...g, key: 'ctx-kbi' }),
    listenFirst('evaluationPeriods', (v) => {
      ctx.periods = v || {};
      if (ctx.periodId && ctx.periods[ctx.periodId]) ctx.period = ctx.periods[ctx.periodId];
      if (ctx.ready) { if (!ctx.periods[ctx.periodId]) selectPeriod(choosePeriod()); renderHeader(); renderBanners(); emit('period'); }
    }, { ...g, key: 'ctx-periods' }),
  ]);
  listen(`notifications/${userId}`, (v) => {
    ctx.notifications = v || {};
    counts.notifications = Object.values(ctx.notifications).filter((n) => !n.read).length;
    if (ctx.ready) renderHeader();
  }, { ...g, key: 'ctx-notifications' });
  await selectPeriod(choosePeriod());
}

function renderLinkError(err, user) {
  const notInit = err.code === 'NOT_INITIALIZED';
  render(root, html`<div class="login-page"><section class="login-hero"><div class="brand"><span class="brand-mark"><img src="assets/icons/logo.svg" alt="" width="40" height="40"></span><b>OPES KPI &amp; KBI</b></div><div><h1>${notInit ? 'Khởi tạo hệ thống' : 'Chưa thể vào hệ thống'}</h1><p>Đăng nhập Firebase thành công với ${user.email}.</p></div><div></div></section>
    <section class="login-panel"><div class="card login-card"><div class="card-body" id="link-body">
      <div class="alert ${notInit ? 'info' : 'danger'}"><div>${err.userMessage || err.message}</div></div>
      ${notInit ? html`<div id="bootstrap-area"></div>` : html`<p class="small muted">Quản trị viên cần tạo hồ sơ nhân sự với đúng email này (Quản trị → Người dùng) và bảo đảm hồ sơ đang hoạt động.</p>`}
      <button class="btn" id="link-logout">Đăng xuất</button>
    </div></div></section></div>`);
  $('#link-logout').addEventListener('click', () => logout());
  if (notInit) bootstrapSeedView($('#bootstrap-area'), user);
}

onAuthStateChanged(auth, async (user) => {
  clearAll();
  resetCtx();
  periodListenersFor = null;
  router.stop();
  if (!user) {
    await renderLogin(root);
    return;
  }
  render(root, html`<div class="loading" style="min-height:100vh"><span class="spinner"></span>Đang nạp dữ liệu của ${user.email}…</div>`);
  ctx.authUser = user;
  try {
    const userId = await ensureLinked(user);
    await loadContext(userId);
    if (!ctx.profile) throw Object.assign(new Error('Không đọc được hồ sơ nhân sự.'), { userMessage: 'Không đọc được hồ sơ nhân sự đã liên kết.' });
    ctx.ready = true;
    renderShell();
    if (!location.hash || location.hash === '#' || location.hash === '#/') history.replaceState(null, '', '#/dashboard');
    await router.start();
  } catch (e) {
    console.error(e);
    clearAll();
    renderLinkError(e, user);
  }
});

if (!isConfigured && !usingEmulators) console.warn('firebaseConfig chưa được cấu hình – xem README.');
window.addEventListener('unhandledrejection', (e) => {
  const msg = mapError(e.reason);
  if (msg && !/abort/i.test(msg)) console.warn('Unhandled:', msg);
});
