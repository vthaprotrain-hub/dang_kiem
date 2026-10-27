/**
 * setupController.js — Màn hình 1: cấu hình xe, hướng dẫn, kiểm tra thiết bị và tùy chọn POC.
 *
 * Lưu ý về quyền:
 *   - Camera/cảm biến chỉ được xin khi người dùng bấm nút (không tự xin lúc tải trang).
 *   - iOS Safari yêu cầu DeviceOrientationEvent.requestPermission() chạy ngay trong sự kiện bấm nút,
 *     vì vậy handleStart() gọi nó TRƯỚC mọi thao tác bất đồng bộ khác.
 *   - Chỉ cài đặt & ngưỡng kiểm thử được lưu vào localStorage. Ảnh và dữ liệu phiên nằm trong IndexedDB.
 */
import { APP_INFO, COCO_MODELS, CONFIG, DEFAULT_SETTINGS, VEHICLE_TYPES, VEHICLE_TYPE_BY_ID } from './config.js';
import { aiPreloader, fmtBytes, fmtEta, fmtSpeed } from './aiPreloader.js';
import { getState, resetState, setState, subscribe, update, acceptedCount } from './appState.js';
import { clearAll, deleteSession, getLatestSession, loadCaptureSession } from './captureStore.js';
import { isFullscreen, tryEnterFullscreen, tryLockOrientation } from './cameraOrientation.js';
import { testCamera } from './cameraManager.js';
import { movementTracker } from './movementTracker.js';
import { buildIcon } from './placeholders.js';
import { renderRingGuide } from './miniMap.js';
import { primeSpeech, setVoiceEnabled } from './voiceGuide.js';
import { setSoundEnabled, unlockAudio } from './sound.js';
import { confirmDialog, toast } from './uiKit.js';
import {
  $, $$, clearNode, formatDateTime, h, isAndroid, isSecure, log, normalizePlate, formatPlate, safe, sessionStamp, setText, sleep, uid,
} from './utils.js';

const PREFS_KEY = 'sv8v-prefs';
const TH_DEFAULT = {
  blurWarn: CONFIG.quality.blurWarn,
  darkMean: CONFIG.quality.darkMean,
  wrongDirectionMs: CONFIG.navigation.wrongDirectionMs,
  tolerance: CONFIG.angle.toleranceEnterDeg,
};

function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
  } catch {
    return {};
  }
}
function savePrefs(p) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch { /* chế độ riêng tư: bỏ qua */ }
}

/** Áp ngưỡng kiểm thử vào CONFIG (các module đọc CONFIG tại thời điểm dùng). */
function applyThresholds(t) {
  CONFIG.quality.blurWarn = Math.max(t.blurWarn, CONFIG.quality.blurError + 2);
  CONFIG.quality.darkMean = Math.max(t.darkMean, CONFIG.quality.veryDarkMean + 2);
  CONFIG.navigation.wrongDirectionMs = t.wrongDirectionMs;
  CONFIG.angle.toleranceEnterDeg = t.tolerance;
  CONFIG.angle.toleranceExitDeg = t.tolerance + 11;
}

const PLATE_RE = /^\d{2}[A-Z]{1,2}\d?\d{4,5}$/;

export class SetupController {
  /**
   * @param {{onStart:(o:{mode:string})=>void, onResume:(o:{complete:boolean})=>void}} cb
   */
  constructor(cb) {
    this.cb = cb;
    this.cameraOk = false;
    this.starting = false;
    this.thresholds = { ...TH_DEFAULT };
  }

  init() {
    const prefs = loadPrefs();
    if (prefs.settings) update('settings', { ...DEFAULT_SETTINGS, ...prefs.settings });
    if (prefs.thresholds) this.thresholds = { ...TH_DEFAULT, ...prefs.thresholds };
    applyThresholds(this.thresholds);
    setVoiceEnabled(getState().settings.voice);

    setText($('#appVersion'), APP_INFO.version);
    $('#secureWarn').hidden = isSecure();
    $('#sessionName').value = `Xe-${sessionStamp()}`;
    update('vehicle', { sessionName: $('#sessionName').value });

    this.buildTypeGrid();
    this.bindVehicleFields();
    this.bindChecks();
    this.bindOptions();
    this.bindThresholds();
    this.bindStart();
    this.bindAILoader();
    this.renderRing();
    this.syncStartButton();
    subscribe(({ keys }) => { if (keys.includes('settings') || keys.includes('vehicle')) this.syncStartButton(); });
    this.refreshResume();
    // Tải trước COCO-SSD + Tesseract.js ngay khi mở trang
    aiPreloader.start(this.aiCfg());
  }

  /* ----------------------------- dữ liệu AI ----------------------------- */
  /** Cấu hình AI ĐÃ ÁP DỤNG (thay đổi trong phần tùy chọn chỉ có hiệu lực sau khi xác nhận). */
  aiCfg(s = getState().settings) {
    return { modelBase: s.modelBase, backend: s.backend, ocr: Boolean(s.ocrEnabled) };
  }

  aiReady() {
    return aiPreloader.isReadyFor(this.aiCfg());
  }

  bindAILoader() {
    aiPreloader.on((st) => this.renderAILoad(st));
    $('#btnPreloadAI').addEventListener('click', () => aiPreloader.start(this.aiCfg(), { force: true }));
    this.renderAILoad(aiPreloader.getState());
  }

  renderAILoad(st) {
    const card = $('#aiLoadCard');
    const ready = this.aiReady();
    const state = ready ? 'ready' : st.status === 'idle' ? 'downloading' : st.status;
    card.dataset.state = state;
    const pct = ready ? 100 : st.percent;
    $('#alBar').style.width = `${pct}%`;
    $('#alBarWrap').setAttribute('aria-valuenow', String(pct));
    setText($('#alPct'), `${pct}%`);
    $('#alIcon').setAttribute('href', ready ? '#i-check' : state === 'error' ? '#i-alert' : '#i-download');
    const cached = st.fromCacheBytes > 0 && st.fromCacheBytes >= st.totalBytes * 0.95;
    setText($('#alTitle'), ready ? 'Dữ liệu AI đã sẵn sàng'
      : state === 'error' ? (st.stage || 'Chưa tải xong dữ liệu AI')
        : state === 'initializing' ? 'Đang khởi tạo AI trên thiết bị…' : cached ? 'Đang đọc dữ liệu AI đã lưu trên máy…' : 'Đang tải dữ liệu AI…');
    // dòng "đang tải gì"
    let now = st.stage || '';
    if (state === 'downloading') {
      const cur = st.items.filter((i) => i.state === 'downloading');
      if (cur.length) {
        // tệp lớn nhất đang tải là thứ người dùng chờ lâu nhất
        const main = [...cur].sort((a, b) => (b.total || b.est) - (a.total || a.est))[0];
        now = `Đang tải: ${main.label} (${fmtBytes(main.loaded)}/${fmtBytes(main.total || main.est)})${cur.length > 1 ? ` · +${cur.length - 1} tệp song song` : ''}`;
      }
    }
    if (ready) now = st.stage || 'Sẵn sàng';
    if (state === 'error') now = st.error?.message ?? 'Lỗi không xác định';
    setText($('#alNow'), now);
    // dòng số liệu
    const meta = [];
    if (state === 'downloading' || state === 'initializing') {
      meta.push(`${fmtBytes(st.loadedBytes)} / ${fmtBytes(st.totalBytes)}`);
      const sp = fmtSpeed(st.speedBps);
      if (sp) meta.push(sp);
      meta.push(state === 'initializing' ? 'đang khởi tạo, vài giây nữa' : fmtEta(st.etaSec));
    } else if (ready) {
      const secs = st.finishedAt && st.startedAt ? ((st.finishedAt - st.startedAt) / 1000).toFixed(1).replace('.', ',') : null;
      meta.push(`${fmtBytes(st.totalBytes)}${cached ? ' · đọc từ bộ nhớ máy (không tốn dữ liệu di động)' : ' · đã lưu trên máy cho lần sau'}${secs ? ` · ${secs} giây` : ''}`);
    }
    setText($('#alMeta'), meta.join(' · '));
    // chi tiết từng tệp
    const list = $('#alList');
    clearNode(list);
    for (const it of st.items) {
      const tot = it.total || it.est || 0;
      const frac = it.state === 'done' || it.state === 'cached' ? 1 : tot ? Math.min(1, (it.loaded || 0) / tot) : 0;
      const v = it.state === 'cached' ? `${fmtBytes(tot)} · có sẵn trên máy` : it.state === 'done' ? (tot ? `${fmtBytes(tot)} ✓` : '✓')
        : it.state === 'error' ? 'lỗi' : it.state === 'downloading' ? `${Math.round(frac * 100)}%` : 'chờ';
      list.append(h('li', { dataset: { state: it.state } },
        h('span', { class: 'k', text: it.kind || '' }),
        h('span', { text: it.label }), h('span', { class: 'v', text: v }),
        h('span', { class: 'mini' }, h('i', { style: `width:${Math.round(frac * 100)}%` }))));
    }
    // hành động khi lỗi
    const acts = $('#alActions');
    clearNode(acts);
    if (state === 'error') {
      acts.append(h('button', { class: 'btn sm primary', type: 'button', onClick: () => aiPreloader.start(this.aiCfg(), { force: true }) }, 'Thử tải lại'));
      if (st.error?.group === 'ocr' && st.cocoReady) {
        acts.append(h('button', { class: 'btn sm', type: 'button', onClick: () => this.applyAI({ ...this.aiCfg(), ocr: false }, { silent: true }) }, 'Bỏ qua OCR và tiếp tục'));
      }
    }
    acts.hidden = !acts.childElementCount;
    // mục kiểm tra thiết bị
    this.setChk('chkAI', ready ? 'ok' : state === 'error' ? 'bad' : 'busy', ready ? st.stage : state === 'error' ? `Lỗi: ${st.error?.message ?? ''}` : `${pct}% · ${st.stage || 'Đang tải…'}`);
    $('#btnPreloadAI').hidden = state !== 'error';
    if (ready && !this._cacheShown) { this._cacheShown = true; this.refreshCacheSize(); }
    if (ready && this._lastAIState !== 'ready') $('#alDetails').open = false;
    this._lastAIState = state;
    this.syncStartButton();
  }

  async refreshCacheSize() {
    const n = await aiPreloader.cacheBytes();
    setText($('#aiCacheSize'), n ? fmtBytes(n) : 'chưa có');
  }

  /** Hiện khối "Xác nhận & tải ngay" khi cấu hình AI đang chọn khác cấu hình đã áp dụng. */
  syncAIPending() {
    const want = { modelBase: $('#optModel').value, backend: $('#optBackend').value, ocr: $('#optOCR').checked };
    const cur = this.aiCfg();
    const changes = [];
    if (want.modelBase !== cur.modelBase) changes.push(`model ${want.modelBase} (~${fmtBytes(COCO_MODELS[want.modelBase]?.approxBytes ?? 0)})`);
    if (want.backend !== cur.backend) changes.push(`backend ${want.backend === 'auto' ? 'tự động' : want.backend.toUpperCase()}`);
    if (want.ocr !== cur.ocr) changes.push(want.ocr ? 'bật OCR biển số (~7 MB)' : 'tắt OCR biển số');
    this.pendingAI = changes.length ? want : null;
    $('#aiApply').hidden = !changes.length;
    if (changes.length) setText($('#aiApplyText'), `Thay đổi chưa áp dụng: ${changes.join(', ')}. Bấm xác nhận để tải và nạp ngay — nút "Bắt đầu chụp ảnh" sẽ mở lại khi tải xong.`);
  }

  async applyAI(want, { silent = false } = {}) {
    const big = (COCO_MODELS[want.modelBase]?.approxBytes ?? 0) > 40e6 && want.modelBase !== this.aiCfg().modelBase;
    if (big && !silent) {
      const ok = await confirmDialog({
        title: `Tải model ${want.modelBase}?`,
        text: `Model này khoảng ${fmtBytes(COCO_MODELS[want.modelBase].approxBytes)} — nên dùng Wi-Fi. Model nặng hơn chính xác hơn nhưng chạy chậm hơn trên điện thoại tầm trung.`,
        confirmLabel: 'Tải ngay',
      });
      if (!ok) return;
    }
    update('settings', { modelBase: want.modelBase, backend: want.backend, ocrEnabled: want.ocr });
    this.persist();
    $('#optModel').value = want.modelBase;
    $('#optBackend').value = want.backend;
    $('#optOCR').checked = want.ocr;
    this.syncAIPending();
    $('#aiLoadCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    toast('Đang tải cấu hình AI mới…', { level: 'info' });
    await aiPreloader.start(this.aiCfg(), { force: true });
    this.refreshCacheSize();
  }

  /* ----------------------------- thông tin xe ----------------------------- */
  buildTypeGrid() {
    const grid = $('#vehicleTypeGrid');
    clearNode(grid);
    const current = getState().vehicle.type;
    for (const t of VEHICLE_TYPES) {
      const b = h('button', { class: 'type-btn', type: 'button', role: 'radio', 'aria-checked': String(t.id === current), dataset: { type: t.id } });
      const wrap = h('span', { class: 'icon-wrap' });
      wrap.innerHTML = buildIcon({ vehicleType: t.id, angleKey: 'front_right', size: 64 });
      b.append(wrap, h('span', { class: 't-name', text: t.label }));
      b.addEventListener('click', () => {
        update('vehicle', { type: t.id });
        $$('.type-btn', grid).forEach((x) => x.setAttribute('aria-checked', String(x === b)));
        this.renderRing();
      });
      grid.append(b);
    }
  }

  renderRing() {
    const shape = VEHICLE_TYPE_BY_ID[getState().vehicle.type]?.shape ?? 'sedan';
    renderRingGuide($('#ringGuide'), $('#ringLegend'), shape);
  }

  bindVehicleFields() {
    const plate = $('#plateInput');
    const hint = $('#plateHint');
    const base = hint.textContent;
    plate.addEventListener('input', () => {
      plate.value = plate.value.toUpperCase();
      const norm = normalizePlate(plate.value);
      update('vehicle', { plate: plate.value.trim(), plateNorm: norm });
      if (!norm) hint.textContent = base;
      else if (PLATE_RE.test(norm)) hint.textContent = `Biển số chuẩn hóa: ${formatPlate(norm)}`;
      else hint.textContent = 'Định dạng biển số chưa quen thuộc — vẫn dùng được, chỉ ảnh hưởng đối chiếu OCR.';
    });
    $('#sessionName').addEventListener('input', (e) => update('vehicle', { sessionName: e.target.value.trim() }));
  }

  /* ----------------------------- kiểm tra thiết bị ----------------------------- */
  setChk(id, state, text) {
    const li = $(`#${id}`);
    if (li) li.dataset.state = state;
    setText($(`#${id}Text`), text);
  }

  bindChecks() {
    $('#btnCheckCamera').addEventListener('click', () => this.checkCamera());
    $('#btnCheckSensor').addEventListener('click', () => this.checkSensors());
  }

  async checkCamera() {
    this.setChk('chkCamera', 'busy', 'Đang mở camera…');
    $('#btnCheckCamera').disabled = true;
    try {
      const r = await testCamera();
      if (r.ok) {
        this.cameraOk = true;
        const dims = r.width && r.height ? ` · ${r.width}×${r.height}` : '';
        this.setChk('chkCamera', 'ok', `${r.label || 'Camera sẵn sàng'}${dims}`);
        update('camera', { status: 'ok', label: r.label, width: r.width, height: r.height, facing: r.facing, devices: r.devices ?? [], error: null });
      } else {
        this.cameraOk = false;
        this.setChk('chkCamera', 'bad', r.message);
        update('camera', { status: 'error', error: r.message });
      }
    } finally {
      $('#btnCheckCamera').disabled = false;
      this.syncStartButton();
    }
    return this.cameraOk;
  }

  async checkSensors() {
    this.setChk('chkSensor', 'busy', 'Đang kiểm tra cảm biến…');
    $('#btnCheckSensor').disabled = true;
    try {
      const p = await movementTracker.requestPermission();
      update('sensors', { permission: p.state, supported: p.state !== 'unsupported' });
      if (!p.ok) {
        this.setChk('chkSensor', p.state === 'denied' ? 'bad' : 'warn', p.message);
        return;
      }
      const start = movementTracker.start();
      if (!start.ok) { this.setChk('chkSensor', 'warn', start.message); return; }
      await sleep(1700);
      const st = movementTracker.status();
      const events = movementTracker.eventCount;
      movementTracker.stop();
      movementTracker.resetAll();
      if (events > 0 || st === 'ok') {
        this.setChk('chkSensor', 'ok', 'Cảm biến chuyển động sẵn sàng');
        update('sensors', { active: false, error: null });
      } else {
        this.setChk('chkSensor', 'warn', 'Không nhận được dữ liệu cảm biến (thường gặp trên máy tính). Ứng dụng sẽ dùng chế độ thủ công.');
      }
    } finally {
      $('#btnCheckSensor').disabled = false;
    }
  }

  /* ----------------------------- tùy chọn ----------------------------- */
  persist() {
    savePrefs({ settings: getState().settings, thresholds: this.thresholds });
  }

  bindOptions() {
    const s = getState().settings;
    const setS = (patch) => { update('settings', patch); this.persist(); };

    $$('.seg-btn').forEach((b) => {
      const on = b.dataset.mode === s.mode;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-checked', String(on));
      b.addEventListener('click', () => {
        setS({ mode: b.dataset.mode });
        $$('.seg-btn').forEach((x) => {
          x.classList.toggle('is-on', x === b);
          x.setAttribute('aria-checked', String(x === b));
        });
      });
    });

    const bindCheck = (id, key, after) => {
      const el = $(`#${id}`);
      el.checked = Boolean(s[key]);
      el.addEventListener('change', () => { setS({ [key]: el.checked }); after?.(el.checked); });
      after?.(el.checked);
    };
    bindCheck('optVoice', 'voice', (v) => { setVoiceEnabled(v); setSoundEnabled(v); });
    bindCheck('optFullscreen', 'autoFullscreen');
    const ocrEl = $('#optOCR');
    ocrEl.checked = Boolean(s.ocrEnabled);
    ocrEl.addEventListener('change', () => this.syncAIPending());
    bindCheck('optAuto', 'autoCapture');
    bindCheck('optLock', 'tryOrientationLock');
    bindCheck('optTest', 'testMode', (v) => { $('#testPanel').hidden = !v; });

    const conf = $('#optConf');
    conf.value = String(s.confidenceThreshold);
    setText($('#optConfVal'), Number(conf.value).toFixed(2));
    conf.addEventListener('input', () => {
      setText($('#optConfVal'), Number(conf.value).toFixed(2));
      setS({ confidenceThreshold: Number(conf.value) });
    });

    const be = $('#optBackend');
    be.value = s.backend;
    be.addEventListener('change', () => this.syncAIPending());
    const md = $('#optModel');
    md.value = COCO_MODELS[s.modelBase] ? s.modelBase : 'lite_mobilenet_v2';
    md.addEventListener('change', () => this.syncAIPending());
    $('#btnApplyAI').addEventListener('click', () => { if (this.pendingAI) this.applyAI(this.pendingAI); });
    $('#btnCancelAI').addEventListener('click', () => {
      const c = this.aiCfg();
      md.value = c.modelBase; be.value = c.backend; ocrEl.checked = c.ocr;
      this.syncAIPending();
    });
    $('#btnClearAICache').addEventListener('click', async () => {
      const ok = await confirmDialog({ title: 'Xóa dữ liệu AI đã lưu?', text: 'Thư viện và model đã lưu trên máy sẽ bị xóa rồi tải lại từ mạng (khoảng 25 MB với cấu hình mặc định). Ảnh và phiên chụp không bị ảnh hưởng.', confirmLabel: 'Xóa & tải lại', danger: true });
      if (!ok) return;
      const n = await aiPreloader.clearCache();
      toast(`Đã xóa ${fmtBytes(n)} dữ liệu AI — đang tải lại`, { level: 'ok' });
      await aiPreloader.start(this.aiCfg(), { force: true });
      this.refreshCacheSize();
    });

    $('#btnWipe').addEventListener('click', () => this.wipeAll());
  }

  bindThresholds() {
    const map = [
      ['thBlur', 'blurWarn', (v) => String(v)],
      ['thDark', 'darkMean', (v) => String(v)],
      ['thWrongMs', 'wrongDirectionMs', (v) => `${v} ms`],
      ['thTol', 'tolerance', (v) => `${v}°`],
    ];
    const sync = () => {
      for (const [id, key, fmt] of map) {
        $(`#${id}`).value = String(this.thresholds[key]);
        setText($(`#${id}Val`), fmt(this.thresholds[key]));
      }
    };
    for (const [id, key, fmt] of map) {
      $(`#${id}`).addEventListener('input', (e) => {
        this.thresholds[key] = Number(e.target.value);
        setText($(`#${id}Val`), fmt(this.thresholds[key]));
        applyThresholds(this.thresholds);
        this.persist();
      });
    }
    $('#btnResetTh').addEventListener('click', () => {
      this.thresholds = { ...TH_DEFAULT };
      applyThresholds(this.thresholds);
      sync();
      this.persist();
      toast('Đã đặt lại ngưỡng mặc định', { level: 'ok' });
    });
    sync();
  }

  /* ----------------------------- bắt đầu ----------------------------- */
  syncStartButton() {
    const s = getState().settings;
    const demo = s.mode === 'demo';
    const st = aiPreloader.getState();
    const ready = this.aiReady();
    const waitAI = !demo && !ready; // chế độ camera thật cần AI đã tải xong
    const btn = $('#btnStart');
    btn.classList.toggle('is-loading', waitAI && st.status !== 'error');
    btn.style.setProperty('--p', `${ready ? 100 : st.percent}%`);
    if (waitAI) {
      setText($('#btnStartText'), st.status === 'error' ? 'Chưa tải được dữ liệu AI' : `Đang tải AI… ${st.percent}%${st.status === 'downloading' && st.etaSec != null ? ` · ${fmtEta(st.etaSec).replace('còn ', '')}` : ''}`);
      setText($('#startHint'), st.status === 'error' ? 'Xem lỗi ở thẻ "Dữ liệu AI" phía trên và bấm "Thử tải lại".' : 'Nút sẽ mở khi COCO-SSD và OCR tải xong. Bạn có thể nhập thông tin xe trong lúc chờ.');
    } else {
      setText($('#btnStartText'), demo ? 'Bắt đầu chụp ảnh (DEMO)' : 'Bắt đầu chụp ảnh');
      setText($('#startHint'), demo
        ? 'DEMO — dữ liệu giả lập, không cần camera và AI. Không phải kết quả AI thật.'
        : this.cameraOk ? 'AI và camera đã sẵn sàng.' : 'AI đã sẵn sàng. Bấm để cấp quyền camera và bắt đầu.');
    }
    btn.setAttribute('aria-disabled', String(this.starting || waitAI));
  }

  bindStart() {
    $('#btnStart').addEventListener('click', () => this.handleStart());
  }

  /** Xin quyền cần cử chỉ người dùng — phải gọi đồng bộ trong handler bấm nút. */
  primeGesture() {
    const s = getState().settings;
    // Mọi thứ cần "cử chỉ người dùng" phải được gọi ĐỒNG BỘ ngay trong sự kiện bấm nút:
    unlockAudio();   // âm báo nhẹ (Web Audio)
    if (s.voice) primeSpeech(); // iOS: mở khóa giọng đọc
    const touch = window.matchMedia?.('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
    if (s.autoFullscreen && touch && !isFullscreen()) {
      safe(tryEnterFullscreen, false, 'fullscreen')().then((ok) => {
        if (ok && s.tryOrientationLock) tryLockOrientation('portrait');
      });
    }
    // quyền cảm biến (iOS): cần cho định vị quanh xe VÀ cho giao diện tự xoay khi cầm ngang
    const p = movementTracker.requestPermission();
    if (s.mode === 'demo') { p.catch(() => {}); return Promise.resolve({ ok: true, state: 'granted' }); }
    return p;
  }

  async handleStart() {
    if (this.starting) return;
    if (getState().settings.mode === 'live' && !this.aiReady()) {
      toast(aiPreloader.getState().status === 'error' ? 'Chưa tải được dữ liệu AI — hãy bấm "Thử tải lại".' : 'Đang tải dữ liệu AI, vui lòng chờ một chút…', { level: 'warn' });
      $('#aiLoadCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    this.starting = true;
    this.syncStartButton();
    try {
      const mode = getState().settings.mode;
      const permP = this.primeGesture();
      if (mode === 'live') {
        if (!this.cameraOk) await this.checkCamera();
        const p = await permP;
        update('sensors', { permission: p.state, supported: p.state !== 'unsupported' });
        if (!p.ok) this.setChk('chkSensor', p.state === 'denied' ? 'bad' : 'warn', p.message);
        if (!this.cameraOk) {
          toast('Chưa mở được camera. Xem thông báo ở bước 3 hoặc dùng chế độ DEMO.', { level: 'bad', ms: 4200 });
          return;
        }
      }
      this.createSession(mode);
      this.cb.onStart({ mode });
    } catch (e) {
      log.error('Bắt đầu thất bại', e);
      toast('Không thể bắt đầu phiên chụp. Hãy thử lại.', { level: 'bad' });
    } finally {
      this.starting = false;
      this.syncStartButton();
    }
  }

  createSession(mode) {
    const type = getState().vehicle.type;
    const plate = $('#plateInput').value.trim();
    const name = $('#sessionName').value.trim() || `Xe-${sessionStamp()}`;
    resetState(['settings', 'camera', 'sensors', 'ai']);
    update('vehicle', { type, plate, plateNorm: normalizePlate(plate), sessionName: name });
    update('session', {
      id: uid('sess'),
      createdAt: Date.now(),
      status: 'in_progress',
      startIndex: 0,
      startConfirmation: null,
      ocr: { status: 'idle', text: null, normalized: null, confidence: null, similarity: null, manualConfirmed: false },
    });
    update('settings', { mode });
  }

  /* ----------------------------- phiên cũ ----------------------------- */
  async refreshResume() {
    const card = $('#resumeCard');
    try {
      const s = await getLatestSession();
      if (!s) { card.hidden = true; return; }
      const done = s.status === 'completed' || (s.acceptedCount ?? 0) >= 8;
      card.hidden = false;
      card.querySelector('b').textContent = done ? 'Phiên chụp gần nhất đã hoàn thành' : 'Có phiên chụp chưa hoàn tất';
      setText($('#resumeInfo'), `${s.name || 'Phiên chụp'} · ${s.acceptedCount ?? 0}/8 góc · ${formatDateTime(s.updatedAt ?? s.createdAt)}${s.mode === 'demo' ? ' · DEMO' : ''}`);
      setText($('#btnResume'), done ? 'Xem lại' : 'Tiếp tục');
      $('#btnResume').onclick = () => this.resume(s.id);
      $('#btnDiscardResume').onclick = async () => {
        if (!(await confirmDialog({ title: 'Xóa phiên này?', text: 'Ảnh và dữ liệu của phiên sẽ bị xóa khỏi thiết bị.', confirmLabel: 'Xóa', danger: true }))) return;
        await deleteSession(s.id);
        card.hidden = true;
        toast('Đã xóa phiên', { level: 'ok' });
      };
    } catch (e) {
      log.warn('Không đọc được phiên cũ', e);
      card.hidden = true;
    }
  }

  async resume(id) {
    const loaded = await loadCaptureSession(id);
    if (!loaded) { toast('Không đọc được phiên này.', { level: 'bad' }); return; }
    const { session, captures } = loaded;
    const done = Object.values(captures).filter((c) => c.meta?.accepted && !c.meta?.retake).length >= 8;
    if (session.mode !== 'demo' && !done && !this.aiReady()) {
      toast('Đang tải dữ liệu AI — tiếp tục phiên được khi tải xong.', { level: 'warn' });
      $('#aiLoadCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    const gesture = this.primeGesture();
    const metas = {};
    for (const [k, v] of Object.entries(captures)) metas[k] = { ...v.meta };
    resetState(['settings', 'camera', 'sensors', 'ai']);
    update('settings', { mode: session.mode === 'demo' ? 'demo' : 'live' });
    update('vehicle', { type: session.vehicleType, plate: session.plate || '', plateNorm: normalizePlate(session.plate), sessionName: session.name });
    update('session', {
      id: session.id, createdAt: session.createdAt, status: session.status === 'completed' ? 'completed' : 'in_progress',
      startIndex: session.startIndex ?? 0, startConfirmation: session.startConfirmation ?? null,
      ocr: session.ocr ?? getState().session.ocr,
    });
    setState({ captures: metas });
    const complete = acceptedCount() >= 8;
    setState({ completed: complete });
    await gesture;
    this.cb.onResume({ complete });
  }

  async wipeAll() {
    const ok = await confirmDialog({
      title: 'Xóa toàn bộ dữ liệu phiên?',
      text: 'Tất cả phiên chụp, ảnh và metadata lưu trong ứng dụng trên thiết bị này sẽ bị xóa. Các ảnh bạn đã tải xuống máy không bị ảnh hưởng.',
      confirmLabel: 'Xóa toàn bộ', danger: true,
    });
    if (!ok) return;
    await clearAll();
    resetState(['settings', 'camera', 'sensors', 'ai']);
    $('#resumeCard').hidden = true;
    toast('Đã xóa toàn bộ dữ liệu phiên khỏi thiết bị', { level: 'ok' });
  }

  /** Gọi khi quay lại màn hình 1. */
  onShow() {
    this.refreshResume();
    this.syncStartButton();
    // OCR được giải phóng sau bước xác định điểm xuất phát: khởi động lại từ dữ liệu đã tải (không tốn mạng)
    aiPreloader.ensure(this.aiCfg());
  }
}
