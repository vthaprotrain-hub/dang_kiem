/**
 * Khởi tạo / bảo trì dữ liệu demo có kiểm soát.
 *
 * 1. Khởi tạo lần đầu (DB trống): chỉ tài khoản có email bootstrap (cấu hình trong database.rules.json)
 *    mới ghi được – Rules cho phép ghi gốc khi system/initializedAt chưa tồn tại.
 * 2. Bảo trì (DB đã có dữ liệu): System Admin mở "cửa sổ bảo trì" (tối đa 60 phút, có lý do, ghi kiểm toán);
 *    trong thời gian đó có thể: bổ sung phần dữ liệu demo còn thiếu (không ghi đè) hoặc khởi tạo lại toàn bộ
 *    (tự động tải bản sao lưu JSON trước khi ghi đè).
 * Có thể thay thế bằng Firebase Console → Realtime Database → Import JSON (công cụ quản trị tin cậy).
 */
import { SEED_DATA_URL } from '../firebase-config.js';
import { read, write, NOW, auditUpdate, mapError } from '../services/database.service.js';
import { ctx } from '../state.js';
import { html, render, busy, toast, download, fmt, confirmDialog } from '../utils.js';

let cache = null;
export async function loadSeed() {
  if (cache) return cache;
  const res = await fetch(SEED_DATA_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Không tải được ${SEED_DATA_URL} (HTTP ${res.status}).`);
  cache = await res.json();
  return cache;
}

export function seedSummary(data) {
  const n = (o) => Object.keys(o || {}).length;
  const nested = (o) => Object.values(o || {}).reduce((s, x) => s + n(x), 0);
  return [
    ['Người dùng / hồ sơ nhân sự', n(data.userProfiles)], ['Đơn vị tổ chức', n(data.organizationUnits)], ['KPI Public', n(data.kpiCatalogPublic)],
    ['KPI Private', n(data.kpiCatalogPrivate)], ['Giá trị cốt lõi KBI', n(data.kbiCatalog)], ['Kỳ đánh giá', n(data.evaluationPeriods)],
    ['Kế hoạch KPI', nested(data.kpiPlans)], ['Bản ghi giao KPI', Object.values(data.kpiAssignments || {}).reduce((s, x) => s + nested(x), 0)],
    ['Hồ sơ đánh giá', nested(data.evaluations)],
  ];
}

/** Ghi toàn bộ dữ liệu demo vào DB trống (một lệnh ghi nguyên tử). */
export async function bootstrapSeed(data) {
  const updates = {};
  for (const [k, v] of Object.entries(data)) {
    if (k === 'system') continue;
    updates[k] = v;
  }
  updates['system/schemaVersion'] = data.system?.schemaVersion || 1;
  updates['system/seedInfo'] = { ...(data.system?.seedInfo || {}), seededAt: NOW() };
  updates['system/initializedAt'] = NOW();
  await write(updates);
}

/** Bổ sung các bản ghi demo còn thiếu (cấp 2 của mỗi nhánh) – không ghi đè dữ liệu đang có. */
export async function mergeMissing(data, reason) {
  const current = (await read('')) || {};
  const updates = {};
  let added = 0;
  for (const [top, val] of Object.entries(data)) {
    if (top === 'system' || val === null || typeof val !== 'object') continue;
    for (const [k, v] of Object.entries(val)) {
      if (current[top]?.[k] === undefined) { updates[`${top}/${k}`] = v; added++; }
    }
  }
  Object.assign(updates, auditUpdate({ type: 'seed_merge', entity: 'system', entityId: 'seed', after: { added }, reason }));
  await write(updates);
  return added;
}

/** Ghi đè toàn bộ các nhánh dữ liệu demo (giữ nguyên liên kết tài khoản authLinks và cửa sổ bảo trì). */
export async function resetAll(data, reason) {
  const backup = await read('');
  download(`opes-kpi-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, JSON.stringify(backup, null, 2), 'application/json');
  const updates = {};
  for (const [k, v] of Object.entries(data)) if (k !== 'system' && k !== 'authLinks') updates[k] = structuredClone(v);
  // giữ authUid trong hồ sơ để người dùng đã liên kết không phải liên kết lại
  for (const [uid, link] of Object.entries(backup?.authLinks || {})) {
    if (updates.userProfiles?.[link.userId]) updates.userProfiles[link.userId].authUid = uid;
  }
  updates['system/schemaVersion'] = data.system?.schemaVersion || 1;
  updates['system/seedInfo'] = { ...(data.system?.seedInfo || {}), seededAt: NOW(), resetBy: ctx.userId, reason };
  Object.assign(updates, auditUpdate({ type: 'seed_reset', entity: 'system', entityId: 'seed', reason }));
  await write(updates);
}

export async function openMaintenance(minutes, reason) {
  await write({
    'system/maintenance': { until: Date.now() + Math.min(60, Math.max(5, minutes)) * 60000, by: ctx.userId, at: NOW(), reason },
    ...auditUpdate({ type: 'maintenance_open', entity: 'system', entityId: 'maintenance', after: { minutes }, reason }),
  });
}
export async function closeMaintenance() {
  await write({ 'system/maintenance': null, ...auditUpdate({ type: 'maintenance_close', entity: 'system', entityId: 'maintenance' }) });
}

/** Giao diện khởi tạo lần đầu (hiển thị khi đăng nhập nhưng DB chưa có dữ liệu). */
export async function bootstrapSeedView(el, user) {
  render(el, html`<div class="loading"><span class="spinner"></span>Đang đọc dữ liệu demo…</div>`);
  let data;
  try { data = await loadSeed(); } catch (e) { render(el, html`<div class="alert danger"><div>${e.message}</div></div>`); return; }
  render(el, html`<div class="stack">
    <p>Cơ sở dữ liệu Firebase chưa có dữ liệu. Nếu <b>${user.email}</b> là email bootstrap được khai báo trong <span class="kbd">database.rules.json</span>, bạn có thể khởi tạo bộ dữ liệu POC:</p>
    <table class="data"><tbody>${seedSummary(data).map(([k, v]) => html`<tr><td>${k}</td><td class="num">${v}</td></tr>`)}</tbody></table>
    <div class="alert warning"><div>Dữ liệu demo chứa cấu hình mẫu được gắn nhãn <b>"Cấu hình demo – cần HR xác nhận"</b>. Mật khẩu không được lưu trong dữ liệu.</div></div>
    <button class="btn primary" id="do-bootstrap">Khởi tạo dữ liệu demo</button>
  </div>`);
  el.querySelector('#do-bootstrap').addEventListener('click', (e) => busy(e.currentTarget, async () => {
    try {
      await bootstrapSeed(data);
      toast('Đã khởi tạo dữ liệu demo. Đang tải lại…');
      setTimeout(() => location.reload(), 800);
    } catch (err) {
      render(el, html`<div class="alert danger"><div><b>Không khởi tạo được:</b> ${mapError(err)}<br>Email này có thể không phải email bootstrap, hoặc DB đã có dữ liệu. Có thể dùng Firebase Console → Import JSON với file <span class="kbd">js/seed/demo-data.json</span>.</div></div>`);
    }
  }));
}

/** Khối bảo trì dữ liệu trong trang Quản trị → Cấu hình & dữ liệu. */
export async function maintenancePanel(el) {
  const sys = (await read('system')) || {};
  const active = sys.maintenance?.until > Date.now();
  let data = null;
  try { data = await loadSeed(); } catch { /* hiển thị lỗi bên dưới */ }
  render(el, html`<div class="stack">
    <div class="row between"><div><b>Trạng thái:</b> ${active ? html`<span class="badge c-amber">Đang bảo trì đến ${fmt.datetime(sys.maintenance.until)}</span> <span class="small muted">(${sys.maintenance.reason})</span>` : html`<span class="badge c-green">Bình thường</span>`}</div>
      <div class="small muted">Khởi tạo lúc: ${fmt.datetime(sys.initializedAt)} · Phiên bản dữ liệu: ${sys.schemaVersion || '—'} · Seed: ${sys.seedInfo?.version || '—'}</div></div>
    ${data ? html`<details><summary>Nội dung bộ dữ liệu demo</summary><table class="data mt-1"><tbody>${seedSummary(data).map(([k, v]) => html`<tr><td>${k}</td><td class="num">${v}</td></tr>`)}</tbody></table></details>` : html`<div class="alert danger"><div>Không đọc được file dữ liệu demo.</div></div>`}
    <div class="btn-group">
      ${active ? html`<button class="btn" data-m="close">Đóng cửa sổ bảo trì</button>` : html`<button class="btn" data-m="open">Mở cửa sổ bảo trì (30 phút)</button>`}
      <button class="btn" data-m="merge" ${active && data ? '' : html`disabled`}>Bổ sung dữ liệu demo còn thiếu</button>
      <button class="btn outline-danger" data-m="reset" ${active && data ? '' : html`disabled`}>Khởi tạo lại toàn bộ dữ liệu demo…</button>
      <button class="btn" data-m="backup" ${active ? '' : html`disabled`}>Tải bản sao lưu JSON</button>
    </div>
    <div class="small muted">Chỉ System Admin mới mở được cửa sổ bảo trì (Rules kiểm tra). Mọi thao tác được ghi lịch sử kiểm toán.</div>
  </div>`);
  el.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => busy(b, async () => {
    const m = b.dataset.m;
    try {
      if (m === 'open') {
        const r = await confirmDialog({ title: 'Mở cửa sổ bảo trì', message: 'Trong 30 phút, System Admin có quyền ghi toàn bộ dữ liệu để khởi tạo/khôi phục. Chỉ dùng khi cần.', requireReason: true, confirmText: 'Mở bảo trì' });
        if (!r) return;
        await openMaintenance(30, r.reason);
      } else if (m === 'close') await closeMaintenance();
      else if (m === 'merge') {
        const r = await confirmDialog({ title: 'Bổ sung dữ liệu demo', message: 'Chỉ thêm các bản ghi demo chưa tồn tại; dữ liệu hiện có được giữ nguyên.', requireReason: true });
        if (!r) return;
        const n = await mergeMissing(data, r.reason);
        toast(`Đã bổ sung ${n} bản ghi.`);
      } else if (m === 'reset') {
        const r = await confirmDialog({ title: 'Khởi tạo lại toàn bộ dữ liệu demo', danger: true, confirmText: 'Ghi đè dữ liệu', message: 'Toàn bộ kế hoạch, đánh giá, danh mục và cấu hình sẽ bị thay bằng dữ liệu demo. Bản sao lưu JSON sẽ được tải xuống trước khi ghi đè. Liên kết tài khoản được giữ nguyên.', requireReason: true });
        if (!r) return;
        await resetAll(data, r.reason);
        toast('Đã khởi tạo lại dữ liệu demo.');
      } else if (m === 'backup') {
        const all = await read('');
        download(`opes-kpi-backup-${Date.now()}.json`, JSON.stringify(all, null, 2), 'application/json');
      }
      await maintenancePanel(el);
    } catch (e) { toast(mapError(e), 'error'); }
  })));
}
