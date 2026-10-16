/**
 * previewController.js — Màn hình 3: xem lại ảnh, chụp lại một góc, xóa, tải từng ảnh, ZIP, JSON, xóa phiên.
 *
 * Chỉ hiển thị trạng thái THẬT của từng góc (đạt / cần chụp lại / chưa có). Ảnh DEMO luôn mang nhãn DEMO.
 * Chụp lại chỉ thay đúng góc đó — ảnh cũ chỉ bị ghi đè khi ảnh mới đạt kiểm tra (xem captureController.js).
 */
import { ANGLES, ANGLE_BY_KEY, VEHICLE_TYPE_BY_ID } from './config.js';
import { acceptedCount, getState, resetState } from './appState.js';
import { deleteAngle, buildExportJson, fileNameFor, slugify, wipeCurrentSession } from './captureController.js';
import { getCapture, getObjectUrl, getThumbUrl, listCaptures } from './captureStore.js';
import { createZip } from './zipWriter.js';
import { T } from './strings.js';
import { confirmDialog, icon, openViewer, toast } from './uiKit.js';
import { $, clearNode, downloadBlob, h, log, sessionStamp, setText } from './utils.js';
import { DEMO_LABEL } from './demoSource.js';

const kb = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export class PreviewController {
  /**
   * @param {{onBack:()=>void, onRetake:(key:string)=>void, onContinue:()=>void, onNewSession:()=>void, onWiped:()=>void}} cb
   */
  constructor(cb) {
    this.cb = cb;
    $('#btnPreviewBack').addEventListener('click', () => this.cb.onBack());
    $('#btnZip').addEventListener('click', () => this.downloadZip());
    $('#btnJson').addEventListener('click', () => this.downloadJson());
    $('#btnContinue').addEventListener('click', () => this.cb.onContinue());
    $('#btnWipeSession').addEventListener('click', () => this.wipeSession());
    $('#btnNewSession').addEventListener('click', () => this.newSession());
  }

  async enter() {
    await this.render();
  }

  /* ----------------------------- hiển thị ----------------------------- */
  async render() {
    const s = getState();
    const n = acceptedCount(s);
    const complete = n >= 8;
    const demo = s.settings.mode === 'demo';
    const missing = ANGLES.filter((a) => !s.captures[a.key]?.accepted || s.captures[a.key]?.retake);
    const manual = ANGLES.filter((a) => s.captures[a.key]?.accepted && s.captures[a.key]?.manualConfirmed && !s.captures[a.key]?.qualityOverride).length;
    const overridden = ANGLES.filter((a) => s.captures[a.key]?.accepted && s.captures[a.key]?.qualityOverride?.length).length;

    setText($('#previewTitle'), complete ? 'Hoàn thành chụp ảnh xe — 8/8 góc.' : `Đã chụp ${n}/8 góc`);
    const typeLabel = VEHICLE_TYPE_BY_ID[s.vehicle.type]?.label ?? '';
    setText($('#previewSub'), [s.vehicle.sessionName, typeLabel, s.vehicle.plate].filter(Boolean).join(' · '));

    const banner = $('#previewBanner');
    const lines = [];
    let level = 'ok';
    if (demo) { lines.push(`${DEMO_LABEL}: các ảnh trong phiên này là ảnh tổng hợp, không phải ảnh xe thật.`); level = 'warn'; }
    if (complete) {
      lines.push(overridden ? `Đã đủ 8/8 góc; ${8 - overridden} ảnh qua kiểm tra chất lượng, ${overridden} ảnh do khách hàng chọn lưu dù bộ kiểm tra báo lỗi.` : 'Đã đủ 8/8 góc và mọi ảnh đều qua kiểm tra chất lượng.');
      if (overridden) level = 'warn';
      if (manual > 0) lines.push(`${manual} góc do khách hàng xác nhận thủ công (không có cảm biến hoặc model tự xác minh).`);
    } else {
      lines.push(`Mới có ${n}/8 góc. Còn thiếu: ${missing.map((a) => a.name.toLowerCase()).join(', ')}.`);
      if (level === 'ok') level = 'warn';
    }
    banner.hidden = false;
    banner.dataset.level = level;
    banner.textContent = lines.join(' ');

    $('#btnContinue').hidden = complete;
    $('#btnZip').disabled = n === 0;

    const grid = $('#previewGrid');
    clearNode(grid);
    const cards = ANGLES.map((a, i) => this.buildCard(a, i, s));
    grid.append(...cards.map((c) => c.el));
    await Promise.all(cards.map((c) => c.ready));
  }

  buildCard(a, i, s) {
    const c = s.captures[a.key];
    const status = c?.retake ? 'retake' : c?.accepted ? 'accepted' : 'missing';
    const sid = s.session.id;
    const statusBadge = { accepted: ['ok', 'Đã đạt'], retake: ['bad', 'Cần chụp lại'], missing: ['warn', 'Chưa có'] }[status];

    const thumb = h('div', { class: 'pv-thumb' }, h('div', { class: 'ph', text: status === 'missing' ? 'Chưa có ảnh' : 'Đang tải…' }));
    const meta = h('div', { class: 'pv-meta' });
    let ready = Promise.resolve();

    if (c?.fileName && sid) {
      ready = getThumbUrl(sid, a.key).then((url) => {
        if (!url) return;
        clearNode(thumb);
        thumb.append(h('img', { src: url, alt: `${a.name} — ảnh đã chụp`, loading: 'lazy' }));
      });
      thumb.addEventListener('click', () => this.view(a.key));
      const q = c.quality ?? {};
      meta.append(
        h('span', { text: `Chất lượng ${q.score ?? '—'}/100 · ${c.width}×${c.height} · ${kb(c.sizeBytes ?? 0)}` }),
        h('span', { text: T.ui.verification[c.verification] ?? c.verification ?? '' }),
      );
      const badges = h('div', { class: 'pv-badges' });
      if (c.source === 'demo') badges.append(h('span', { class: 'badge demo', text: 'DEMO' }));
      badges.append(h('span', { class: 'badge', text: a.orientation === 'portrait' ? 'Ảnh dọc' : 'Ảnh ngang' }));
      if (c.manualConfirmed) badges.append(h('span', { class: 'badge warn', text: 'Xác nhận thủ công' }));
      if (c.qualityOverride?.length) badges.append(h('span', { class: 'badge bad', title: 'Khách hàng chọn lưu dù bộ kiểm tra tự động báo lỗi', text: 'Bỏ qua kiểm tra' }));
      if (q.warnings?.length) badges.append(h('span', { class: 'badge warn', title: q.warnings.map((w) => w.message).join(' · '), text: `${q.warnings.length} cảnh báo` }));
      meta.append(badges);
    } else {
      meta.append(h('span', { text: a.hint }));
    }

    const act = (label, ic, onClick, cls = '') => h('button', { type: 'button', class: cls, title: label, 'aria-label': `${label} — ${a.name}`, onClick }, icon(ic));
    const actions = c?.fileName
      ? h('div', { class: 'pv-actions' },
        act('Xem ảnh', 'eye', () => this.view(a.key), 'primary'),
        act('Chụp lại', 'retake', () => this.cb.onRetake(a.key)),
        act('Tải ảnh', 'download', () => this.downloadOne(a.key)),
        act('Xóa ảnh', 'trash', () => this.remove(a.key), 'danger'))
      : h('div', { class: 'pv-actions single' }, h('button', { type: 'button', class: 'primary', onClick: () => this.cb.onRetake(a.key) }, icon('camera'), ` Chụp ${a.name.toLowerCase()}`));
    if (!c?.fileName) Object.assign(actions.firstChild.style, { display: 'flex', gap: '6px', alignItems: 'center', justifyContent: 'center', fontWeight: '700' });

    const el = h('article', { class: 'pv-card', dataset: { status, key: a.key } },
      h('div', { class: 'pv-head' }, h('span', { class: 'pv-no', text: String(i + 1) }), h('span', { class: 'pv-name', text: a.name }), h('span', { class: `badge ${statusBadge[0]}`, text: statusBadge[1] })),
      thumb, meta, actions);
    return { el, ready };
  }

  /* ----------------------------- thao tác ----------------------------- */
  async view(key) {
    const sid = getState().session.id;
    const url = await getObjectUrl(sid, key);
    if (url) openViewer(url, ANGLE_BY_KEY[key].name);
    else toast('Không đọc được ảnh này.', { level: 'bad' });
  }

  async downloadOne(key) {
    const sid = getState().session.id;
    const rec = await getCapture(sid, key);
    if (!rec?.blob) { toast('Không tìm thấy ảnh.', { level: 'bad' }); return; }
    downloadBlob(rec.blob, rec.meta?.fileName ?? fileNameFor(key));
  }

  async remove(key) {
    const a = ANGLE_BY_KEY[key];
    const ok = await confirmDialog({ title: `Xóa ảnh ${a.name.toLowerCase()}?`, text: 'Ảnh sẽ bị xóa khỏi thiết bị. Bạn có thể chụp lại góc này sau.', confirmLabel: 'Xóa ảnh', danger: true });
    if (!ok) return;
    await deleteAngle(key);
    toast(`Đã xóa ảnh ${a.name.toLowerCase()}`, { level: 'ok' });
    await this.render();
  }

  async downloadZip() {
    const s = getState();
    const btn = $('#btnZip');
    btn.disabled = true;
    try {
      const recs = (await listCaptures(s.session.id)).filter((r) => r.blob && s.captures[r.angleKey]?.accepted && !s.captures[r.angleKey]?.retake);
      if (!recs.length) { toast('Chưa có ảnh để xuất.', { level: 'warn' }); return; }
      const order = (k) => ANGLE_BY_KEY[k].index;
      recs.sort((x, y) => order(x.angleKey) - order(y.angleKey));
      const slug = slugify(s.vehicle.sessionName);
      const files = recs.map((r) => ({ name: `images/${r.meta?.fileName ?? fileNameFor(r.angleKey)}`, data: r.blob, date: new Date(r.meta?.capturedAt ?? Date.now()) }));
      files.push({ name: 'session.json', data: JSON.stringify(buildExportJson(), null, 2) });
      const note = [
        'Smart Vehicle 8-View Capture POC',
        'Ảnh và metadata được tạo hoàn toàn trên thiết bị, không tải lên máy chủ. Không có GPS.',
        s.settings.mode === 'demo' ? `\n${DEMO_LABEL}\nCác ảnh trong gói này là ảnh tổng hợp, không phải ảnh xe thật.` : '',
      ].join('\n');
      files.push({ name: 'README.txt', data: note });
      const blob = await createZip(files);
      downloadBlob(blob, `${slug}_${sessionStamp()}.zip`);
      toast(`Đã tạo ZIP (${recs.length} ảnh + metadata)`, { level: 'ok' });
    } catch (e) {
      log.error('Tạo ZIP lỗi', e);
      toast('Không tạo được tệp ZIP.', { level: 'bad' });
    } finally {
      btn.disabled = acceptedCount() === 0;
    }
  }

  downloadJson() {
    const s = getState();
    const blob = new Blob([JSON.stringify(buildExportJson(), null, 2)], { type: 'application/json' });
    downloadBlob(blob, `${slugify(s.vehicle.sessionName)}_metadata.json`);
  }

  async wipeSession() {
    const ok = await confirmDialog({
      title: 'Xóa toàn bộ dữ liệu phiên?',
      text: 'Ảnh và metadata của phiên này sẽ bị xóa khỏi thiết bị. Các tệp bạn đã tải xuống máy không bị ảnh hưởng.',
      confirmLabel: 'Xóa phiên', danger: true,
    });
    if (!ok) return;
    await wipeCurrentSession();
    resetState(['settings', 'camera', 'sensors', 'ai']);
    toast('Đã xóa phiên khỏi thiết bị', { level: 'ok' });
    this.cb.onWiped();
  }

  async newSession() {
    if (acceptedCount() < 8) {
      const ok = await confirmDialog({ title: 'Bắt đầu phiên mới?', text: 'Phiên hiện tại chưa đủ 8 góc. Ảnh đã chụp vẫn được giữ và có thể tiếp tục từ màn hình đầu.', confirmLabel: 'Phiên mới' });
      if (!ok) return;
    }
    this.cb.onNewSession();
  }
}
