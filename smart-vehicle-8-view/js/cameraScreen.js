/**
 * cameraScreen.js — Màn hình 2: camera thông minh. Điều phối toàn bộ module:
 *
 *   camera/DEMO ──► VehicleTracker ─┐
 *   MovementTracker (cảm biến) ─────┼─► ViewAngleDetector ─► ClockwiseNavigator.evaluate() ─► sự kiện FSM + chỉ dẫn
 *   (nhịp điều khiển 200 ms)        ┘                                   │
 *                                                                       ▼
 *                         mini-map · mũi tên · nút chụp · giọng nói · state store
 *
 * Luồng chụp:  SHUTTER → grab khung hình → kiểm tra chất lượng → xác minh góc → lưu → (NEXT | ALL_DONE).
 * Màn hình này là lớp "keo" giao diện; thuật toán nằm ở các module riêng để dễ thay thế/mở rộng.
 */
import { ANGLES, ANGLE_BY_KEY, CONFIG, VEHICLE_SHAPES, VEHICLE_TYPE_BY_ID } from './config.js';
import { acceptedCount, getState, setState, update, subscribe } from './appState.js';
import {
  DetectionLoop, VehicleTracker, classifyView, getAIInfo, isBusy, loadDetectionModel, resetModelLoad,
} from './aiDetector.js';
import {
  cameraEvents, getCameraInfo, initCamera, isCameraActive, stopCamera, switchCamera,
} from './cameraManager.js';
import {
  exitFullscreen, fullscreenSupported, getDeviceTilt, getScreenOrientation, getTiltOverride, isFullscreen, isIOS, isStandalone, orientationEvents,
  setTiltOverride, startOrientationWatch, startTiltWatch, stopOrientationWatch, stopTiltWatch, tiltEvents, tryEnterFullscreen, tryLockOrientation,
  unlockOrientation,
} from './cameraOrientation.js';
import { ClockwiseNavigator } from './clockwiseNavigator.js';
import { E, S, StateMachine } from './stateMachine.js';
import { T, confidenceLabel, lc } from './strings.js';
import { movementTracker } from './movementTracker.js';
import { ViewAngleDetector } from './viewAngleDetector.js';
import { detectVehicleOrientation } from './vehicleOrientationDetector.js';
import { buildGuide } from './placeholders.js';
import { MiniMap } from './miniMap.js';
import { isVoiceEnabled, setVoiceEnabled, speakVietnamese, stopSpeaking } from './voiceGuide.js';
import { chime, setSoundEnabled } from './sound.js';
import { terminateOCR } from './plateOCR.js';
import { DEMO_LABEL, DemoSource, buildDemoPanel } from './demoSource.js';
import {
  acceptCapture, analyzeCapture, cancelRetake, completeSession, decideAngleVerification, finishRetake, grabFrame, markRetake, persistSession,
} from './captureController.js';
import { closeActiveSheet, confirmDialog, hasActiveSheet, makeDraggable, openViewer, showSheet, toast } from './uiKit.js';
import { getObjectUrl, getThumbUrl } from './captureStore.js';
import {
  $, angleDiff, canvasToBlob, clamp, clearNode, h, isAndroid, log, normalizePlate, setHidden, setText, sleep, svg, wrap180,
} from './utils.js';

const GUIDE_ICON = { search: 'search', car: 'car', arrow: 'arrow', camera: 'camera', rotate: 'flip' };
const LEVEL_ICON = { ok: 'check', warn: 'alert', error: 'alert', info: 'info' };
/** Chỉ dẫn lặp liên tục không cần đọc thành tiếng. */
const SILENT = new Set(['finding', 'locating', 'capturing', 'validating', 'orient_ok', 'detected_hold', 'identify', 'ai_loading', 'cam_opening',
  'accepted', 'completed', 'rejected']); // 3 mục cuối được đọc riêng (afterAccepted / rejectCapture)
const isSilent = (id) => SILENT.has(id) || id.startsWith('scan_');

/** Câu báo lỗi chụp ảnh theo đúng bước bị lỗi (kèm chi tiết kỹ thuật ngắn để khách hàng báo lại khi cần). */
function captureErrorText(stage, e) {
  const tech = `${e?.name && e.name !== 'Error' ? `${e.name}: ` : ''}${e?.message ?? ''}`.trim().slice(0, 90);
  const base = {
    grab: 'Không lấy được ảnh từ camera. Hãy giữ màn hình chụp mở và thử lại.',
    analyze: 'Không phân tích được ảnh vừa chụp. Hãy thử chụp lại.',
    encode: 'Thiết bị thiếu bộ nhớ để tạo ảnh JPEG. Hãy đóng bớt ứng dụng/tab khác rồi chụp lại.',
    store: 'Không lưu được ảnh vào bộ nhớ trình duyệt.',
    save: 'Không lưu được ảnh.',
    review: 'Có lỗi khi hiển thị kết quả kiểm tra ảnh. Hãy chụp lại.',
  }[stage] ?? 'Có lỗi khi chụp ảnh. Hãy thử lại.';
  return tech ? `${base} (${tech})` : base;
}

export class CameraScreen {
  /**
   * @param {{onExit:()=>void, onFinished:()=>void, onOpenPreview:()=>void}} cb
   */
  constructor(cb) {
    this.cb = cb;
    this.active = false;
    this.paused = false;
    this.busy = false;
    this.rejectStreak = { key: null, n: 0 };
    this.demo = null;
    this.demoPanel = null;
    this.demoRunner = null;
    this.fsm = new StateMachine();
    this.nav = new ClockwiseNavigator();
    this.angleDet = new ViewAngleDetector();
    this.tracker = new VehicleTracker();
    this.loop = null;
    this.rect = { left: 0, top: 0, w: 0, h: 0 }; // khung video trong hệ toạ độ "đứng thẳng" (theo cách cầm máy)
    /** rot: góc xoay CSS của lớp phủ (0 | 90 | −90); effective: hướng người dùng đang cầm máy. */
    this.view = { rot: 0, effective: 'portrait', screen: 'portrait' };
    this.portraitLocked = false;
    this.guide = null;
    this.guideSig = '';
    this.curGuidance = null;
    this.guidanceAt = 0;
    this.analyzingKey = null;
    this.startId = { status: 'idle' };
    this.idToken = 0;
    this.idRunning = false;
    this.startSheet = null;
    this.rejectMessage = null;
    this.lastAngle = null;
    this.lastSensors = null;
    this.lastVehicle = null;
    this.lastEval = null;
    this.cls = null;
    this.clsAt = 0;
    this.autoSince = 0;
    this.autoArmed = true;
    this.lockedTo = null;
    this.navSig = '';
    this.peekKey = null;
    this.timers = [];
    this.token = 0;
    this.cameraStarting = false;

    this.el = {
      screen: $('#screen-camera'), stage: $('#camStage'), upright: $('#camUpright'), video: $('#camVideo'), demoStage: $('#demoStage'), box: $('#videoBox'),
      guideLayer: $('#guideLayer'), detect: $('#detectLayer'), flash: $('#flash'), aiChip: $('#aiChip'), sensorChip: $('#sensorChip'),
      guidance: $('#guidance'), gIcon: $('#guidanceIcon'), gText: $('#guidanceText'), gSub: $('#guidanceSub'),
      arrow: $('#moveArrow'), arrowText: $('#moveArrowText'), rotate: $('#rotateHint'), rotateText: $('#rotateText'),
      testHud: $('#testHud'), shutter: $('#btnShutter'), autoRing: $('#autoRing'), peekImg: $('#peekImg'), peekCount: $('#peekCount'),
      mmCount: $('#mmCount'), mmNext: $('#mmNext'), mmPos: $('#mmPos'), mmConf: $('#mmConf'),
      block: $('#camBlock'), demoBadge: $('#demoBadge'), demoPanel: $('#demoPanel'), demoBody: $('#demoBody'),
    };
    this.video = this.el.video;
    this.miniMap = new MiniMap($('#miniMap'), { onSelect: (k) => this.onNodeSelect(k) });
    // mini-map kéo thả được; vị trí nhớ riêng cho màn hình dọc/ngang
    this.mmDrag = makeDraggable($('#miniMapBox'), {
      storageKey: 'sv8v-minimap-pos',
      getMode: () => (window.innerWidth > window.innerHeight ? 'landscape' : 'portrait'),
      resetEl: $('#mmGrip'),
      getRotation: () => this.view.rot,
    });
    this.bindControls();
  }

  /* ====================================================================== */
  /* Vòng đời                                                               */
  /* ====================================================================== */
  /**
   * @param {{resume?:boolean, retakeKey?:string|null}} [opts]
   */
  async enter(opts = {}) {
    const token = ++this.token;
    this.opts = opts;
    this.active = true;
    this.paused = false;
    this.busy = false;
    this.rejectStreak = { key: null, n: 0 };
    this.detPaused = false;
    this.stepSay = null;
    this.keepSpeech = false;
    setSoundEnabled(getState().settings.voice);
    const s = getState();
    const demoMode = s.settings.mode === 'demo';

    this.fsm = new StateMachine();
    this.fsm.on('transition', (t) => this.onTransition(t));
    this.tracker.reset();
    this.angleDet.reset();
    this.startId = { status: 'idle' };
    this.idToken += 1;
    this.rejectMessage = null;
    this.analyzingKey = null;
    this.curGuidance = null;
    this.guideSig = '';
    this.cls = null;
    this.autoSince = 0;
    this.autoArmed = true;
    this.lockedTo = null;
    this.peekKey = null;
    this.lastEval = null;
    clearNode(this.el.detect);
    this._det = [];

    // điều hướng: phiên mới / tiếp tục / chụp lại
    const startIndex = s.session.startIndex ?? 0;
    const hasCaptures = acceptedCount() > 0;
    if (opts.retakeKey) {
      markRetake(opts.retakeKey);
      this.nav.reset({ startIndex, retakeKey: opts.retakeKey, calibrate: true, firstCaptureDone: true });
    } else if (opts.resume || hasCaptures) {
      this.nav.reset({ startIndex, calibrate: true, firstCaptureDone: true });
    } else {
      this.nav.reset({ startIndex: 0 });
    }

    this.miniMap.setShape(this.shapeId());
    this.renderChrome();
    this.show();
    startOrientationWatch();
    startTiltWatch();
    this.portraitLocked = false;
    this.lockFailed = false;
    this.timers.push(setInterval(() => this.tick(), CONFIG.ui.controlLoopMs));
    this.unsub = [
      orientationEvents.on('change', () => { this.syncView(true); this.tick(); }),
      tiltEvents.on('change', () => { if (this.syncView()) this.tick(); }),
      cameraEvents.on('ended', () => this.onCameraEnded()),
      subscribe(({ keys }) => { if (keys.includes('captures')) this.updatePeek(); }),
    ];
    this.ro = new ResizeObserver(() => this.layout());
    this.ro.observe(this.el.stage);
    this.onVis = () => this.onVisibility();
    document.addEventListener('visibilitychange', this.onVis);
    this.video.addEventListener('loadedmetadata', this.layoutBound ??= () => this.layout());
    this.video.addEventListener('resize', this.layoutBound);

    this.syncView(true);
    this.syncFullscreenUi();
    if (demoMode) this.startDemo();
    else await this.startLive(token);
    this.syncView(true);
    this.updatePeek();
  }

  show() {
    $('#screen-camera').classList.add('is-active');
  }

  async exit({ silent = false } = {}) {
    if (!this.active) return;
    this.active = false;
    this.token += 1;
    this.timers.forEach(clearInterval);
    this.timers = [];
    this.unsub?.forEach((u) => u?.());
    this.unsub = null;
    this.ro?.disconnect();
    document.removeEventListener('visibilitychange', this.onVis);
    this.video.removeEventListener('loadedmetadata', this.layoutBound);
    this.video.removeEventListener('resize', this.layoutBound);
    this.demoRunner?.stop();
    this.teardownLive();
    this.demo?.unmount();
    this.demo = null;
    this.demoPanel = null;
    stopOrientationWatch();
    stopTiltWatch();
    if (getTiltOverride() != null) setTiltOverride(null);
    this.view = { rot: 0, effective: 'portrait', screen: 'portrait' };
    this.applyView();
    unlockOrientation();
    this.portraitLocked = false;
    exitFullscreen();
    if (!this.keepSpeech) stopSpeaking();
    this.keepSpeech = false;
    closeActiveSheet(null);
    this.hideBlock();
    this.miniMap.setUser(null);
    if (getState().retakeKey) cancelRetake();
    await persistSession().catch(() => {});
    if (!silent) this.cb.onExit?.();
  }

  teardownLive() {
    this.loop?.stop();
    this.loop = null;
    stopCamera();
    movementTracker.stop();
    movementTracker.resetAll();
    this.cameraStarting = false;
  }

  shapeId() {
    return VEHICLE_TYPE_BY_ID[getState().vehicle.type]?.shape ?? 'sedan';
  }

  /* ====================================================================== */
  /* Nguồn hình ảnh                                                         */
  /* ====================================================================== */
  async startLive(token) {
    this.video.hidden = false;
    setHidden(this.el.demoStage, true);
    setHidden(this.el.demoBadge, true);
    setHidden(this.el.demoPanel, true);
    this.cameraStarting = true;
    this.hideBlock();
    const r = await initCamera({ video: this.video, facingMode: 'environment' });
    this.cameraStarting = false;
    if (token !== this.token || !this.active) return;
    if (!r.ok) {
      update('camera', { status: 'error', error: r.message });
      this.showCameraBlock(r);
      return;
    }
    update('camera', { status: 'ok', deviceId: r.deviceId, devices: r.devices, facing: r.facing, width: r.width, height: r.height, label: r.label, error: null });
    this.layout();

    movementTracker.resetAll();
    const sr = movementTracker.start();
    update('sensors', { active: sr.ok, permission: movementTracker.permission, supported: movementTracker.status() !== 'unavailable', error: sr.ok ? null : sr.message });
    this.ensureAI(token);
  }

  async ensureAI(token) {
    const s = getState().settings;
    const info = getAIInfo();
    if (info.ready) {
      update('ai', { status: 'ready', backend: info.backend, modelBase: info.modelBase, hasViewClassifier: info.hasViewClassifier, error: null });
      this.startLoop();
      return;
    }
    update('ai', { status: 'loading', error: null });
    setText(this.el.aiChip, T.ai.loading);
    this.renderChips();
    const r = await loadDetectionModel({
      backend: s.backend, base: s.modelBase,
      onStatus: (t) => { if (this.active) setText(this.el.aiChip, `AI: ${t}`); },
    });
    if (token !== this.token || !this.active) return;
    if (r.ok) {
      const i2 = getAIInfo();
      update('ai', { status: 'ready', backend: r.backend, loadMs: r.loadMs ?? null, modelBase: i2.modelBase, hasViewClassifier: i2.hasViewClassifier, error: null });
      this.startLoop();
    } else {
      update('ai', { status: 'error', error: r.error });
      this.showAIBlock(r.error);
    }
  }

  startLoop() {
    if (this.loop) return;
    this.loop = new DetectionLoop({
      getVideo: () => this.video,
      getMinScore: () => getState().settings.confidenceThreshold,
      getRotate: () => -this.view.rot,
      onResult: (r) => this.onDetection(r),
    });
    this.loop.start();
  }

  startDemo() {
    const s = getState();
    this.video.hidden = true;
    stopCamera();
    this.demo = new DemoSource({ vehicleType: s.vehicle.type, getOrientation: () => this.deviceOrientationType() });
    this.demo.mount(this.el.demoStage);
    setHidden(this.el.demoBadge, false);
    setHidden(this.el.demoPanel, false);
    $('#demoToggle').onclick = () => { this.el.demoBody.hidden = !this.el.demoBody.hidden; };
    this.demoPanel = buildDemoPanel(this, this.demo);
    this.demo.onChange(() => this.demoPanel?.refresh());
    update('sensors', { active: true, permission: 'granted', supported: true, error: null });
    this.layout();
    toast(T.guidance.demo, { level: 'warn', ms: 3600 });
  }

  /** Thông tin xe hiện tại: DEMO (giả lập, có nhãn) hoặc VehicleTracker (kết quả COCO-SSD thật). */
  vehicleNow() {
    return this.demo ? this.demo.vehicleInfo() : this.tracker.info;
  }

  /** Hướng người dùng đang CẦM MÁY (không phải hướng trình duyệt): dùng cho yêu cầu ảnh dọc/ngang. */
  screenOrientation() {
    return this.view.effective;
  }

  /** Hướng cầm máy từ cảm biến; nếu trình duyệt đã tự xoay ngang thì theo trình duyệt. */
  deviceOrientationType() {
    if (getScreenOrientation().type === 'landscape') return 'landscape';
    const t = getDeviceTilt();
    return t.available ? t.type : 'portrait';
  }

  computeView() {
    const screenType = getScreenOrientation().type;
    const t = getDeviceTilt();
    const effective = this.demo ? this.demo.effectiveOrientation : this.deviceOrientationType();
    // Chỉ xoay lớp phủ khi trình duyệt đang dọc mà người dùng cầm ngang (màn hình khóa dọc).
    const rot = screenType === 'portrait' && effective === 'landscape' ? (t.available && t.rot ? t.rot : 90) : 0;
    return { rot, effective, screen: screenType };
  }

  /** Cập nhật hướng giao diện; trả về true nếu có thay đổi. */
  syncView(force = false) {
    if (!this.active) return false;
    const v = this.computeView();
    const same = v.rot === this.view.rot && v.effective === this.view.effective && v.screen === this.view.screen;
    if (same && !force) return false;
    const rotChanged = v.rot !== this.view.rot;
    this.view = v;
    if (rotChanged) {
      // ẩn lớp phủ trong một khung hình rồi hiện lại để tránh "giật" khi đổi bố cục
      const up = this.el.upright;
      up.classList.add('rotating');
      requestAnimationFrame(() => requestAnimationFrame(() => up.classList.remove('rotating')));
    }
    this.layout();
    return !same;
  }

  /** Áp góc xoay cho #camUpright và các lớp phủ toàn cục (sheet, toast, trình xem ảnh). */
  applyView() {
    const up = this.el.upright;
    const rot = this.active ? this.view.rot : 0;
    const cw = this.el.stage.clientWidth || window.innerWidth;
    const ch = this.el.stage.clientHeight || window.innerHeight;
    if (up.dataset.rot !== String(rot)) up.dataset.rot = String(rot);
    if (rot) Object.assign(up.style, { width: `${ch}px`, height: `${cw}px`, left: `${(cw - ch) / 2}px`, top: `${(ch - cw) / 2}px`, transform: `rotate(${rot}deg)` });
    else Object.assign(up.style, { width: '', height: '', left: '', top: '', transform: '' });
    const uw = rot ? ch : cw;
    const uh = rot ? cw : ch;
    const land = this.active && uw > uh && uh <= 640;
    this.el.screen.classList.toggle('is-land', land);
    document.body.classList.toggle('cam-land', land);
    const root = document.documentElement.style;
    root.setProperty('--app-w', `${window.innerWidth}px`);
    root.setProperty('--app-h', `${window.innerHeight}px`);
    root.setProperty('--vrot', `${rot}deg`);
    if (rot) document.body.dataset.vrot = String(rot);
    else delete document.body.dataset.vrot;
  }

  /** Đổi toạ độ chạm trên màn hình sang hệ toạ độ "đứng thẳng" của lớp phủ. */
  clientToUpright(x, y) {
    const r = this.el.stage.getBoundingClientRect();
    const rot = this.view.rot;
    const a = (-rot * Math.PI) / 180;
    const dx = x - (r.left + r.width / 2);
    const dy = y - (r.top + r.height / 2);
    const uw = rot ? r.height : r.width;
    const uh = rot ? r.width : r.height;
    return { x: uw / 2 + dx * Math.cos(a) - dy * Math.sin(a), y: uh / 2 + dx * Math.sin(a) + dy * Math.cos(a) };
  }

  fovH() {
    const long = CONFIG.sensors.fovLongSideDeg;
    let vw = this.video.videoWidth;
    let vh = this.video.videoHeight;
    if (!vw || !vh) return long;
    if (this.view.rot) [vw, vh] = [vh, vw];
    return vw >= vh ? long : (long * vw) / vh;
  }

  onDetection(r) {
    if (!this.active || this.demo) return;
    const info = this.tracker.update(r, this.screenOrientation());
    if (info.present && !info.stale) {
      movementTracker.setVisualOffset((info.cx - 0.5) * this.fovH(), !info.clipped.any && !info.multiple);
    }
    this.renderDetect();
  }

  maybeClassify(vehicle, t) {
    if (this.demo || !getAIInfo().hasViewClassifier || !vehicle.present || t - this.clsAt < 1200 || isBusy()) return;
    this.clsAt = t;
    const src = this.view.rot ? grabFrame(this.video, 320, 'cls-frame', -this.view.rot) : this.video;
    classifyView(src).then((r) => { if (r) this.cls = { ...r, at: Date.now() }; }).catch(() => {});
  }
  classifierNow() {
    return this.cls && Date.now() - this.cls.at < 2500 ? this.cls : null;
  }

  /* ====================================================================== */
  /* Bố cục                                                                  */
  /* ====================================================================== */
  layout() {
    if (!this.active) return;
    this.applyView();
    const stage = this.el.stage;
    const cw = stage.clientWidth;
    const ch = stage.clientHeight;
    if (!cw || !ch) return;
    const rot = this.view.rot;
    const uw = rot ? ch : cw;
    const uh = rot ? cw : ch;
    let rect;
    if (this.demo) rect = this.demo.layout(uw, uh); // cảnh DEMO được vẽ sẵn theo hướng đứng thẳng
    else {
      const vw = this.video.videoWidth;
      const vh = this.video.videoHeight;
      let sr;
      if (!vw || !vh) sr = { left: 0, top: 0, w: cw, h: ch };
      else {
        const k = Math.min(cw / vw, ch / vh);
        const w = vw * k;
        const hh = vh * k;
        sr = { left: (cw - w) / 2, top: (ch - hh) / 2, w, h: hh };
      }
      // video luôn ở toạ độ màn hình; lớp phủ xoay quanh tâm nên khung tương ứng chỉ hoán đổi kích thước
      rect = rot ? { left: sr.top, top: sr.left, w: sr.h, h: sr.w } : sr;
    }
    this.rect = rect;
    Object.assign(this.el.box.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.w}px`, height: `${rect.h}px` });
    this.el.detect.setAttribute('viewBox', `0 0 ${rect.w.toFixed(1)} ${rect.h.toFixed(1)}`);
    this.el.detect.setAttribute('width', rect.w.toFixed(1));
    this.el.detect.setAttribute('height', rect.h.toFixed(1));
    this.guideSig = '';
    this.renderGuide(this.nav.currentTarget(getState().captures));
    this.renderDetect();
    this.mmDrag.apply();
  }

  renderGuide(target) {
    if (!this.rect.w) return;
    const s = getState();
    const key = target ?? this.nav.startKey ?? 'front';
    const sig = `${key}|${s.vehicle.type}|${Math.round(this.rect.w)}x${Math.round(this.rect.h)}`;
    if (sig !== this.guideSig) {
      this.guideSig = sig;
      this.guide = buildGuide({ vehicleType: s.vehicle.type, angleKey: key, width: this.rect.w, height: this.rect.h, withVehicle: false });
      this.el.guideLayer.innerHTML = this.guide.svg;
    }
    this.el.guideLayer.classList.toggle('pre', !this.nav.startConfirmed);
  }

  /** Vẽ hộp nhận diện. Tái sử dụng phần tử SVG (chỉ đổi thuộc tính khi giá trị đổi) để không tạo/xóa DOM mỗi khung. */
  renderDetect() {
    this._det ??= [];
    const info = this.active && this.rect.w ? this.vehicleNow() : null;
    const list = info?.present && !info.stale && !this.detPaused ? (info.vehicles ?? []) : [];
    const W = this.rect.w;
    const H = this.rect.h;
    const demo = Boolean(this.demo);
    const set = (el, k, v) => { if (el.getAttribute(k) !== v) el.setAttribute(k, v); };
    for (let i = 0; i < list.length; i++) {
      const v = list[i];
      let e = this._det[i];
      if (!e) {
        e = { g: svg('g', {}), box: svg('rect', { rx: 6 }), bg: svg('rect', { height: 18, rx: 5 }), text: svg('text', { class: 'det-label' }), hit: svg('rect', { class: 'hit', fill: 'transparent' }) };
        e.text.append(document.createTextNode(''));
        e.hit.addEventListener('click', (ev) => this.onDetectTap(ev));
        e.g.append(e.box, e.bg, e.text, e.hit);
        this.el.detect.append(e.g);
        this._det[i] = e;
      }
      const b = v.isPrimary && info.bbox ? info.bbox : v.bbox;
      const x = (b.x * W).toFixed(1); const y = (b.y * H).toFixed(1);
      const w = (b.w * W).toFixed(1); const hh = (b.h * H).toFixed(1);
      set(e.g, 'visibility', 'visible');
      set(e.box, 'class', `det-box${v.isPrimary ? ' primary' : ''}${v.isPrimary && info.stable && !demo ? ' stable' : ''}${demo ? ' demo' : ''}`);
      set(e.box, 'x', x); set(e.box, 'y', y); set(e.box, 'width', w); set(e.box, 'height', hh);
      const showLabel = v.isPrimary || info.multiple;
      if (showLabel) {
        const label = demo ? 'DEMO · xe giả lập' : `Xe ${Math.round(v.score * 100)}%${v.isPrimary && info.locked ? ' · đã chọn' : ''}`;
        const ly = Math.max(0, b.y * H - 20);
        set(e.bg, 'visibility', 'visible'); set(e.text, 'visibility', 'visible');
        set(e.bg, 'class', `det-label-bg${demo ? ' demo' : v.isPrimary && info.stable ? ' stable' : ''}`);
        set(e.bg, 'x', x); set(e.bg, 'y', ly.toFixed(1)); set(e.bg, 'width', (label.length * 6.8 + 14).toFixed(1));
        set(e.text, 'x', (b.x * W + 7).toFixed(1)); set(e.text, 'y', (ly + 13).toFixed(1));
        if (e.text.firstChild.nodeValue !== label) e.text.firstChild.nodeValue = label;
      } else { set(e.bg, 'visibility', 'hidden'); set(e.text, 'visibility', 'hidden'); }
      if (demo) set(e.hit, 'visibility', 'hidden');
      else { set(e.hit, 'visibility', 'visible'); set(e.hit, 'x', x); set(e.hit, 'y', y); set(e.hit, 'width', w); set(e.hit, 'height', hh); }
    }
    for (let i = list.length; i < this._det.length; i++) set(this._det[i].g, 'visibility', 'hidden');
  }

  onDetectTap(e) {
    const p = this.clientToUpright(e.clientX, e.clientY);
    const nx = (p.x - this.rect.left) / this.rect.w;
    const ny = (p.y - this.rect.top) / this.rect.h;
    if (this.tracker.info.locked) {
      this.tracker.unlock();
      toast('Đã bỏ chọn xe — tự chọn xe lớn nhất', { level: 'info' });
    } else if (this.tracker.lockAt(nx, ny)) toast('Đã chọn xe này để chụp', { level: 'ok' });
  }

  /* ====================================================================== */
  /* Nhịp điều khiển                                                        */
  /* ====================================================================== */
  tick() {
    if (!this.active) return;
    this.loop?.setIdle(this.paused || this.busy || hasActiveSheet() || !this.el.block.hidden);
    if (this.paused) return;
    this.syncView();
    const t = Date.now();
    const s = getState();
    const orientation = this.screenOrientation();
    if (this.demo) this.renderDetect();

    const sensors = movementTracker.getSnapshot();
    const target = this.nav.currentTarget(s.captures);
    // Model chỉ chạy khi đứng gần góc mục tiêu (hoặc khi chưa định vị được) — đang đi giữa hai góc thì tạm nghỉ.
    const detPaused = this.updateDetectionGate(sensors, target);
    const vehicle = detPaused ? { ...this.tracker.empty(), paused: true } : this.vehicleNow();
    this.maybeClassify(vehicle, t);
    this.maybeRecheckStart();
    const angle = this.angleDet.estimate({ vehicle, vehicleType: s.vehicle.type, sensors, classifier: this.classifierNow(), targetKey: target, t });
    this.lastAngle = angle;
    this.lastSensors = sensors;
    this.lastVehicle = vehicle;

    const out = this.nav.evaluate({
      now: t, fsmState: this.fsm.state, captures: s.captures,
      analysis: { vehicle, screenOrientation: orientation, detectionPaused: detPaused },
      sensors, angle, startId: this.startId, rejectMessage: this.rejectMessage, demo: Boolean(this.demo),
      vehicleLengthM: VEHICLE_SHAPES[this.shapeId()]?.L ?? 4.6,
    });
    this.lastEval = out;
    if (out.event && !this.busy) this.fsm.send(out.event.name);

    // thông điệp chính: AI/camera chưa sẵn sàng được ưu tiên
    let g = out.guidance;
    const ai = s.ai.status;
    if (!this.demo && this.cameraStarting) g = { id: 'cam_opening', text: 'Đang mở camera…', level: 'info', icon: 'camera' };
    else if (!this.demo && ai === 'loading') g = { id: 'ai_loading', text: T.guidance.aiLoading, level: 'info', icon: 'search' };
    else if (!this.demo && ai === 'error') g = { id: 'ai_error', text: T.guidance.aiUnavailable, level: 'error', icon: 'alert' };
    else if (!this.demo && ai === 'idle') g = { id: 'ai_loading', text: T.guidance.aiLoading, level: 'info', icon: 'search' };

    this.applyGuidance(g);
    this.speakProgress(g, target, out);
    this.renderRotate(g);
    this.renderArrow(out.arrow);
    this.renderGuide(target);
    this.renderMiniMap(sensors, angle, target, out);
    this.renderChips(sensors);
    this.syncShutter();
    this.maybeAutoCapture(sensors, vehicle);
    this.syncPortraitLock();
    this.renderTestHud(sensors, angle, vehicle, target, out);
    this.syncNavState(target, angle, sensors, g);
  }

  /**
   * Bật/tắt suy luận theo vị trí: có cảm biến tin cậy và còn cách góc mục tiêu > ngưỡng → tạm nghỉ model
   * (tiết kiệm GPU/pin, bớt nóng máy). Trả về true khi KHÔNG có kết quả nhận diện mới để dùng.
   */
  updateDetectionGate(sensors, target) {
    const loop = this.loop;
    if (this.demo || !loop) { this.detPaused = false; return false; }
    const cfg = CONFIG.detection;
    const st = this.fsm.state;
    const capturing = st === S.CAPTURING_FRONT || st === S.CAPTURING_CURRENT_ANGLE || st === S.VALIDATING_CAPTURE;
    const d = this.lastAngle?.deltaToTargetDeg;
    let want = 'full';
    if (this.nav.startConfirmed && target && !capturing && sensors?.usable && (sensors.confidence ?? 0) >= 0.35 && d != null) {
      const a = Math.abs(d);
      want = loop.mode === 'off' ? (a <= cfg.nearWindowDeg ? 'full' : 'off') : (a > cfg.nearWindowExitDeg ? 'off' : 'full');
    }
    if (want !== loop.mode) loop.setMode(want);
    const fresh = loop.lastResultAt > loop.resumedAt;
    const paused = want === 'off' || (loop.resumedAt > 0 && !fresh);
    if (paused !== this.detPaused) { this.detPaused = paused; this.renderDetect(); }
    return paused;
  }

  /** Giọng nói tiến độ: "còn khoảng N bước", "đi chậm lại" — thưa, không lặp. */
  speakProgress(g, target, out) {
    if (!g || !getState().settings.voice) return;
    if (out?.info?.tooFast && g.id?.startsWith('move_')) speakVietnamese(T.say.slowDown, { key: 'slow', priority: 0 });
    if (!g.id?.startsWith('move_') || !g.steps) return;
    const now = Date.now();
    const last = this.stepSay;
    if (!last || last.target !== target) { this.stepSay = { target, steps: g.steps, at: now }; return; }
    if (g.steps <= last.steps - 2 && now - last.at > 6000) {
      speakVietnamese(T.say.stepsLeft(g.steps), { key: `steps_${target}_${g.steps}`, priority: 0 });
      this.stepSay = { target, steps: g.steps, at: now };
    }
  }

  onTransition({ from, to, event }) {
    log.debug(`FSM ${from} → ${to} (${event})`);
    if (to === S.IDENTIFYING_START_POINT) this.beginStartIdentification();
    if (from === S.IDENTIFYING_START_POINT && to !== S.READY_FOR_CAPTURE) this.cancelIdentification();
    if (to === S.READY_FOR_CAPTURE) this.autoArmed = true;
  }

  syncNavState(target, angle, sensors, g) {
    const sig = `${this.fsm.state}|${target}|${angle?.predictedAngle}|${sensors.direction}|${g?.id}`;
    if (sig === this.navSig) return;
    this.navSig = sig;
    update('nav', {
      fsm: this.fsm.state, target, orderStart: this.nav.startIndex,
      estimatedAngle: angle?.predictedAngle ?? null, estimatedDeg: sensors.orbitDeg ?? null,
      confidence: angle?.confidence ?? 0, direction: sensors.direction, guidance: g ? { id: g.id, text: g.text, level: g.level } : null,
      sensorMode: sensors.usable ? 'sensor' : this.lastEval?.info?.manualMode ? 'manual' : 'initializing',
    });
  }

  /* ====================================================================== */
  /* Hiển thị                                                                */
  /* ====================================================================== */
  applyGuidance(g) {
    if (!g) return;
    const t = Date.now();
    const cur = this.curGuidance;
    if (cur && cur.id === g.id) {
      if (cur.text !== g.text) { cur.text = g.text; setText(this.el.gText, g.text); }
      return;
    }
    if (cur && t - this.guidanceAt < CONFIG.ui.guidanceMinHoldMs && g.level !== 'error' && g.id !== 'completed') return;
    this.curGuidance = { ...g };
    this.guidanceAt = t;
    const el = this.el;
    el.guidance.dataset.level = g.level;
    setText(el.gText, g.text);
    el.gSub.hidden = !g.sub;
    setText(el.gSub, g.sub ?? '');
    el.gIcon.setAttribute('href', `#i-${GUIDE_ICON[g.icon] ?? LEVEL_ICON[g.level] ?? 'info'}`);
    el.guidance.classList.remove('swap');
    void el.guidance.offsetWidth;
    el.guidance.classList.add('swap');
    if (!isSilent(g.id) && getState().settings.voice) speakVietnamese(g.say ?? g.text, { key: g.id, priority: g.level === 'error' ? 2 : g.level === 'warn' || g.level === 'ok' ? 1 : 0 }); // 'sẵn sàng chụp' được nói ngay, không chờ câu hướng dẫn đi
    if (g.id.startsWith('ready_') || g.id.startsWith('manual_')) chime('ready');
    else if (g.id === 'wrong_dir' || g.id === 'lost') chime('warn', { minGapMs: 4000 });
    const state = g.level === 'ok' ? 'ready' : g.level === 'warn' ? 'warn' : g.level === 'error' ? 'bad' : '';
    this.el.guideLayer.dataset.state = state;
  }

  renderRotate(g) {
    const show = Boolean(g?.rotate) && this.nav.startConfirmed;
    this.el.rotate.hidden = !show;
    if (!show) { this.rotateSince = 0; return; }
    this.rotateSince ||= Date.now();
    this.el.rotate.querySelector('.phone-anim').dataset.to = g.rotate;
    setText(this.el.rotateText, g.rotate === 'portrait' ? 'Xoay máy theo chiều dọc' : 'Xoay máy theo chiều ngang');
    // Không có cảm biến hướng (hoặc đang ghi đè thủ công) và trình duyệt bị khóa xoay: cho phép tự chuyển giao diện
    const tilt = getDeviceTilt();
    const manualOk = (!tilt.available || tilt.source === 'manual') && getScreenOrientation().type === 'portrait' && Date.now() - this.rotateSince > 2000;
    $('#btnRotateManual').hidden = !manualOk;
  }

  /** Chuyển giao diện dọc/ngang bằng tay (khi máy không có cảm biến hướng mà màn hình lại khóa xoay). */
  manualRotate() {
    const want = this.lastEval?.guidance?.rotate ?? (this.view.effective === 'portrait' ? 'landscape' : 'portrait');
    setTiltOverride(want === 'landscape' ? 90 : 0);
    this.syncView(true);
    this.tick();
  }

  renderArrow(a) {
    const el = this.el.arrow;
    if (!a?.show || this.busy) { el.hidden = true; return; }
    el.hidden = false;
    el.dataset.dir = a.dir;
    el.dataset.tone = a.tone;
    setText(this.el.arrowText, a.label);
  }

  renderMiniMap(sensors, angle, target, out) {
    const s = getState();
    const startOk = this.nav.startConfirmed;
    const userDeg = startOk && sensors.usable ? sensors.orbitDeg : null;
    let lastAcc = null;
    for (const [k, c] of Object.entries(s.captures)) if (c?.accepted && !c.retake && (!lastAcc || c.capturedAt > s.captures[lastAcc].capturedAt)) lastAcc = k;
    const fromDeg = userDeg ?? (lastAcc ? ANGLE_BY_KEY[lastAcc].deg : null);
    let flow = null;
    if (startOk && target && fromDeg != null && !out.info.near && !this.busy) {
      const to = ANGLE_BY_KEY[target].deg;
      flow = { from: fromDeg, to, dir: this.nav.freeDirection && wrap180(to - fromDeg) < 0 ? -1 : 1 };
    }
    this.miniMap.render({ order: this.nav.order, captures: s.captures, target, analyzing: this.analyzingKey, userDeg, userConf: sensors.confidence, flow });

    const n = acceptedCount(s);
    setText(this.el.mmCount, `${n}/8`);
    setText(this.el.mmNext, target ? `→ ${ANGLE_BY_KEY[target].short}` : 'Xong');
    const pred = angle?.predictedAngle;
    const conf = sensors.usable ? sensors.confidence : 0;
    let pos = '—';
    if (!startOk) pos = 'Chưa xuất phát';
    else if (userDeg != null && pred) pos = `≈ ${ANGLE_BY_KEY[pred].short}`;
    else if (['unavailable', 'denied', 'insecure', 'inactive'].includes(sensors.status) || out.info.manualMode) pos = 'Thủ công';
    else if (sensors.tiltBad) pos = 'Máy nghiêng';
    else if (sensors.status === 'stale') pos = 'Mất cảm biến';
    else pos = 'Định vị…';
    setText(this.el.mmPos, pos);
    setText(this.el.mmConf, confidenceLabel(conf));
    this.el.mmConf.dataset.level = conf <= 0 ? 'none' : conf < 0.45 ? 'low' : conf < 0.7 ? 'mid' : 'high';
  }

  renderChips(sensors = movementTracker.getSnapshot()) {
    const ai = getState().ai;
    const chip = this.el.aiChip;
    if (this.demo) { chip.dataset.state = 'warn'; setText(chip, 'AI: giả lập (DEMO)'); } else {
      const st = ai.status === 'ready' ? 'ready' : ai.status === 'loading' ? 'loading' : ai.status === 'error' ? 'error' : 'idle';
      const resting = st === 'ready' && this.loop?.mode === 'off';
      chip.dataset.state = resting ? 'idle' : st;
      if (resting) setText(chip, 'AI: nghỉ khi đang di chuyển');
      else if (st !== 'loading' || !chip.textContent.startsWith('AI: ')) setText(chip, st === 'ready' ? T.ai.ready(ai.backend) : st === 'error' ? T.ai.error : st === 'loading' ? T.ai.loading : T.ai.idle);
    }
    this.el.sensorChip.hidden = true; // trạng thái cảm biến được gộp vào khung mini-map để tiết kiệm chỗ
  }

  renderTestHud(sensors, angle, vehicle, target, out) {
    const el = this.el.testHud;
    const on = getState().settings.testMode;
    el.hidden = !on;
    if (!on) return;
    const f = (v, d = 0) => (v == null || Number.isNaN(v) ? '—' : Number(v).toFixed(d));
    el.textContent = [
      `FSM ${this.fsm.state}`,
      `mục tiêu ${target ?? '—'} · near ${out.info.near} · Δ ${f(out.info.deltaDeg)}°`,
      `orbit ${f(sensors.orbitDeg)}° · conf ${f(sensors.confidence, 2)} · ${sensors.direction} ${f(sensors.rateDegPerSec, 1)}°/s`,
      `sensor ${sensors.status} · cw ${f(sensors.cwTravelDeg)}° ccw ${f(sensors.ccwTravelDeg)}°`,
      `xe ${vehicle.present ? `${f(vehicle.score, 2)} area ${f(vehicle.areaRatio, 2)} ar ${f(vehicle.aspect, 2)}` : 'không'} stable ${vehicle.stable}`,
      `góc ước lượng ${angle?.predictedAngle ?? '—'} (${f(angle?.confidence, 2)}) vis ${f(angle?.visualConsistencyTarget, 2)}`,
      this.demo ? 'DEMO — dữ liệu giả lập' : `suy luận ${f(this.loop?.lastInferMs)}ms · chu kỳ ${f(this.loop?.interval)}ms · ${getState().ai.backend ?? '—'} · model ${this.loop?.mode ?? '—'}`,
      `giao diện xoay ${this.view.rot}° · cầm ${this.view.effective} · cảm biến hướng ${getDeviceTilt().source}`,
      `màn hình ${this.screenOrientation()} · cần ${target ? ANGLE_BY_KEY[target].orientation : '—'}`,
    ].join('\n');
  }

  updatePeek() {
    const s = getState();
    setText(this.el.peekCount, `${acceptedCount(s)}/8`);
    let last = null;
    for (const [k, c] of Object.entries(s.captures)) if (c?.fileName && (!last || c.capturedAt > s.captures[last].capturedAt)) last = k;
    if (!last || !s.session.id) { this.el.peekImg.hidden = true; this.peekKey = null; return; }
    const sig = `${last}|${s.captures[last].capturedAt}`;
    if (sig === this.peekKey) return;
    this.peekKey = sig;
    getThumbUrl(s.session.id, last).then((url) => {
      if (url && this.peekKey === sig) { this.el.peekImg.src = url; this.el.peekImg.hidden = false; }
    });
  }

  renderChrome() {
    const demo = getState().settings.mode === 'demo';
    this.el.screen.classList.toggle('is-demo', demo);
    setHidden(this.el.demoBadge, !demo);
    $('#btnFlip').hidden = demo;
    this.syncSoundIcon();
    this.el.shutter.dataset.ready = 'false';
    this.el.shutter.dataset.busy = 'false';
    this.el.arrow.hidden = true;
    this.el.rotate.hidden = true;
    this.el.autoRing.style.strokeDashoffset = '220';
  }

  syncSoundIcon() {
    $('#btnSound use').setAttribute('href', getState().settings.voice ? '#i-sound' : '#i-mute');
  }

  flash() {
    const f = this.el.flash;
    f.classList.remove('go');
    void f.offsetWidth;
    f.classList.add('go');
  }

  /* ====================================================================== */
  /* Nút chụp                                                               */
  /* ====================================================================== */
  isReady() {
    return this.fsm.state === S.READY_FOR_CAPTURE && Boolean(this.lastEval?.info?.ready) && Boolean(this.lastVehicle?.present);
  }

  syncShutter() {
    const btn = this.el.shutter;
    const needStartConfirm = this.fsm.state === S.IDENTIFYING_START_POINT && ['needs_confirm', 'side'].includes(this.startId.status) && Boolean(this.lastVehicle?.present);
    const ready = !this.busy && (this.isReady() || needStartConfirm);
    btn.dataset.ready = String(ready);
    btn.dataset.busy = String(this.busy);
    const label = needStartConfirm ? 'Xác nhận đầu xe hoặc đuôi xe' : ready ? 'Chụp ảnh' : 'Chưa sẵn sàng chụp';
    if (btn.getAttribute('aria-label') !== label) btn.setAttribute('aria-label', label);
  }

  maybeAutoCapture(sensors, vehicle) {
    const ring = this.el.autoRing;
    const enabled = getState().settings.autoCapture && this.autoArmed && this.isReady() && !this.busy && vehicle.stable && sensors.steady !== false;
    if (!enabled) {
      this.autoSince = 0;
      ring.style.strokeDashoffset = '220';
      return;
    }
    this.autoSince ||= Date.now();
    const p = clamp((Date.now() - this.autoSince) / 1300, 0, 1);
    ring.style.strokeDashoffset = String(220 * (1 - p));
    if (p >= 1) {
      this.autoSince = 0;
      this.autoArmed = false;
      ring.style.strokeDashoffset = '220';
      this.handleShutter();
    }
  }

  async handleShutter() {
    if (this.busy || !this.active || this.paused) return;
    const st = this.fsm.state;
    if (st === S.IDENTIFYING_START_POINT) {
      // Không ép người dùng chờ heuristic: chạm nút chụp luôn mở được bước xác nhận đầu/đuôi xe khi đã thấy xe.
      if (['needs_confirm', 'side', 'checking'].includes(this.startId.status) && this.vehicleNow()?.present) {
        if (this.startId.status !== 'needs_confirm') this.startId = { ...this.startId, status: 'needs_confirm', mode: 'start', forced: true };
        this.openStartSheet();
      } else toast(this.curGuidance?.text ?? T.guidance.identifyingStart, { level: 'warn' });
      return;
    }
    if (!this.isReady()) {
      toast(this.curGuidance?.text ?? 'Chưa sẵn sàng chụp.', { level: 'warn' });
      return;
    }
    const s = getState();
    const target = this.nav.currentTarget(s.captures);
    if (!target) return;
    const isStart = !this.nav.firstCaptureDone && !this.nav.freeDirection;
    if (this.fsm.send(isStart ? E.SHUTTER_START : E.SHUTTER).rejected) { this.tick(); return; }
    this.busy = true;
    this.analyzingKey = target;
    this.loop?.setIdle(true);
    this.syncShutter();
    this.el.arrow.hidden = true;
    let grabbed = null;
    let stage = 'grab';
    let accepted = false;
    try {
      try {
        await this.waitSteady();
        if (!this.active) return;
        const orientation = this.screenOrientation();
        const mode = this.demo?.captureMode ?? 'good';
        grabbed = this.demo ? this.demo.grabFrame(orientation, mode) : grabFrame(this.video, undefined, null, -this.view.rot);
        const demoStill = this.demo ? this.demo.stillDetection(mode, orientation) : null;
        if (this.demo) { this.demo.setCaptureMode('good'); }
        this.flash();
        this.fsm.send(E.FRAME_GRABBED);
        const angleSnap = this.lastAngle;
        const sensorSnap = this.lastSensors;
        stage = 'analyze';
        const analysis = await analyzeCapture({
          canvas: grabbed, angleKey: target, orientation, guideRect: this.guide?.rect ?? null,
          steady: sensorSnap?.steady !== false, angleEstimate: angleSnap, demoStill, demo: Boolean(this.demo),
        });
        if (!this.active) return;
        const v = analysis.validation;
        let override = null;
        stage = 'review';
        if (!v.isValid) {
          if (this.canOverride(target, v) && (await this.askOverride(target, grabbed, v))) override = v.errors.map((e) => e.code);
          else { await this.rejectCapture(target, grabbed, v); return; }
        }

        const verification = decideAngleVerification({
          angleKey: target, estimate: angleSnap, classifier: analysis.classifier, demo: Boolean(this.demo && this.demo.flags.sensors !== false), isStart,
          startConfirmation: getState().session.startConfirmation,
        });
        let manualConfirmed = false;
        if (verification.needsManual) {
          const ok = await this.askManualAngleConfirm(target, grabbed, v, verification);
          if (!ok) { await this.rejectCapture(target, grabbed, v, { manualDeclined: true }); return; }
          manualConfirmed = true;
        }
        stage = 'save';
        const res = await acceptCapture({
          angleKey: target, canvas: grabbed, validation: v, verification, orientation, source: this.demo ? 'demo' : 'live',
          angleEstimate: angleSnap, manualConfirmed: manualConfirmed || Boolean(override), sensors: sensorSnap, qualityOverride: override,
        });
        accepted = true;
        if (res?.warning) toast(res.warning, { level: 'warn', ms: 5600 });
        this.rejectStreak = { key: null, n: 0 };
        this.fsm.send(E.CAPTURE_VALID);
        this.nav.notifyAccepted(target);
        this.analyzingKey = null;
      } catch (e) {
        const where = e?.stage ?? stage;
        this.lastCaptureError = { stage: where, name: e?.name ?? 'Error', message: e?.message ?? String(e), at: Date.now() };
        log.error(`Chụp ảnh lỗi ở bước "${where}"`, `${e?.name ?? ''}: ${e?.message ?? e}`);
        closeActiveSheet(null);
        toast(captureErrorText(where, e), { level: 'bad', ms: 6500 });
        if (!this.fsm.send(E.CAPTURE_ABORT).changed && this.fsm.state === S.CAPTURE_REJECTED) this.fsm.send(E.RETRY);
        return;
      }
      // Ảnh đã lưu xong: lỗi ở bước chuyển góc không được báo là "lỗi chụp" và không được làm kẹt state machine.
      try {
        await this.afterAccepted(target);
      } catch (e) {
        log.error('Lỗi sau khi lưu ảnh', e?.message ?? e);
        if (this.fsm.state === S.CAPTURE_ACCEPTED) this.fsm.send(acceptedCount() >= 8 ? E.ALL_DONE : E.NEXT);
      }
    } finally {
      if (grabbed) { grabbed.width = 1; grabbed.height = 1; }
      this.busy = false;
      this.analyzingKey = null;
      this.loop?.setIdle(this.paused || hasActiveSheet());
      this.syncShutter();
      if (this.active && !accepted) this.tick();
    }
  }

  async waitSteady() {
    const limit = Date.now() + CONFIG.quality.steadyWaitMs;
    while (Date.now() < limit) {
      if (movementTracker.getSnapshot().steady !== false) return true;
      await sleep(60);
    }
    return false;
  }

  async thumbNode(canvas) {
    const blob = await canvasToBlob(canvas, 'image/jpeg', 0.7);
    const url = URL.createObjectURL(blob);
    const img = h('img', { class: 'sheet-thumb', alt: 'Ảnh vừa chụp', src: url });
    return { img, revoke: () => URL.revokeObjectURL(url) };
  }

  /** Chỉ cho phép "vẫn lưu" khi MỌI lỗi đều là lỗi phụ thuộc AI/khung hình (không phải mờ/tối/trùng) và đã bị từ chối liên tiếp. */
  canOverride(target, v) {
    const q = CONFIG.quality;
    const streak = this.rejectStreak?.key === target ? this.rejectStreak.n : 0;
    return streak >= q.overrideAfterRejects && v.errors.length > 0 && v.errors.every((e) => q.overridableCodes.includes(e.code));
  }

  async askOverride(target, canvas, v) {
    const A = ANGLE_BY_KEY[target];
    const thumb = await this.thumbNode(canvas);
    const res = await showSheet({
      title: 'Ảnh chưa đạt — bạn vẫn muốn lưu?',
      text: 'Bạn đã chụp lại nhiều lần nhưng bộ kiểm tra tự động vẫn báo lỗi dưới đây. AI trong trình duyệt có thể nhận diện sai. Nếu tự xem thấy ảnh đã thấy rõ toàn bộ xe ở góc đúng, bạn có thể lưu — ảnh sẽ được đánh dấu "khách hàng xác nhận, bỏ qua kiểm tra".',
      body: [thumb.img, h('ul', { class: 'sheet-list' }, ...v.errors.map((e) => h('li', { class: 'err', text: e.message })))],
      row: true,
      actions: [
        { label: 'Chụp lại', kind: 'primary', value: false, icon: 'retake' },
        { label: `Vẫn lưu ${lc(A.short)}`, kind: 'ghost', value: true },
      ],
      dismissible: false,
    }).closed;
    thumb.revoke();
    return res === true;
  }

  async rejectCapture(target, canvas, v, { manualDeclined = false } = {}) {
    if (!manualDeclined) this.rejectStreak = { key: target, n: (this.rejectStreak?.key === target ? this.rejectStreak.n : 0) + 1 };
    this.fsm.send(E.CAPTURE_INVALID);
    this.analyzingKey = null;
    this.rejectMessage = manualDeclined ? 'Hãy chụp lại đúng góc.' : v.errors[0]?.message ?? T.guidance.rejected;
    navigator.vibrate?.(140);
    chime('reject');
    if (getState().settings.voice) speakVietnamese(T.say.rejected(this.rejectMessage), { key: `rej-${target}`, force: true, priority: 2 });
    const thumb = await this.thumbNode(canvas);
    const items = [
      ...v.errors.map((e) => h('li', { class: 'err', text: e.message })),
      ...v.warnings.map((w) => h('li', { class: 'warn', text: w.message })),
    ];
    if (manualDeclined) items.unshift(h('li', { class: 'warn', text: 'Bạn chọn chụp lại vì ảnh chưa đúng góc.' }));
    const sheet = showSheet({
      title: manualDeclined ? `Chụp lại ${lc(ANGLE_BY_KEY[target].name)}` : 'Ảnh chưa đạt',
      text: manualDeclined ? 'Ảnh này không được lưu.' : `Điểm chất lượng ${v.qualityScore}/100 (chỉ số tham khảo của POC). Ảnh này không được lưu.`,
      body: [thumb.img, items.length ? h('ul', { class: 'sheet-list' }, ...items) : null],
      actions: [{ label: 'Chụp lại', kind: 'primary', value: 'retry', icon: 'retake' }],
      dismissible: false,
    });
    await sheet.closed;
    thumb.revoke();
    this.fsm.send(E.RETRY);
    this.rejectMessage = null;
    this.tick();
  }

  async askManualAngleConfirm(target, canvas, v, verification) {
    const A = ANGLE_BY_KEY[target];
    const thumb = await this.thumbNode(canvas);
    const warns = v.warnings.map((w) => h('li', { class: 'warn', text: w.message }));
    const evid = (verification.evidence ?? []).slice(0, 3).map((e) => h('li', { text: e.detail }));
    const res = await showSheet({
      title: `Xác nhận đây là ${lc(A.name)}`,
      text: `Ứng dụng chưa đủ bằng chứng để tự kiểm tra góc (${verification.reason.toLowerCase()}). Hãy xem ảnh và xác nhận.`,
      body: [thumb.img, warns.length ? h('ul', { class: 'sheet-list' }, ...warns) : null, evid.length ? h('ul', { class: 'sheet-evidence' }, ...evid) : null],
      row: true,
      actions: [
        { label: 'Chụp lại', kind: 'ghost', value: false },
        { label: `Đúng, lưu ${lc(A.short)}`, kind: 'primary', value: true, icon: 'check' },
      ],
      dismissible: false,
    }).closed;
    thumb.revoke();
    return res === true;
  }

  async afterAccepted(target) {
    const allDone = acceptedCount() >= 8;
    chime(allDone ? 'done' : 'accepted');
    if (!allDone) speakVietnamese(T.speech.accepted, { key: `acc-${target}`, force: true, priority: 1 });
    const s = getState();
    const wasRetake = this.nav.retakeKey === target;
    if (wasRetake) finishRetake();
    if (acceptedCount(s) >= 8) {
      await sleep(CONFIG.navigation.acceptedHoldMs);
      this.fsm.send(E.ALL_DONE);
      await completeSession();
      speakVietnamese(T.speech.completed, { key: 'done', force: true, priority: 2 });
      await sleep(1100);
      this.keepSpeech = true; // để câu chúc mừng đọc hết khi chuyển sang màn hình xem lại
      if (this.active) this.cb.onFinished();
      return;
    }
    await sleep(CONFIG.navigation.acceptedHoldMs);
    if (wasRetake && this.opts.retakeKey) {
      // chụp lại từ màn hình xem trước → quay về xem trước
      if (this.active) this.cb.onFinished();
      return;
    }
    if (wasRetake) this.restoreNormalNavigation();
    this.fsm.send(E.NEXT);
    this.tick();
  }

  /** Sau khi chụp lại một góc ngay trong màn hình camera: trở về thứ tự chuẩn, giữ nguyên mốc cảm biến. */
  restoreNormalNavigation() {
    const idx = getState().session.startIndex ?? 0;
    this.nav.reset({ startIndex: idx, firstCaptureDone: true });
    this.nav.confirmStart(this.nav.startKey);
  }

  /* ====================================================================== */
  /* Xác định điểm xuất phát (đầu/đuôi xe)                                  */
  /* ====================================================================== */
  cancelIdentification() {
    this.idToken += 1;
    this.idRunning = false;
    this.startId = { status: 'idle' };
    this.startSheet?.close(null);
    this.startSheet = null;
  }

  async beginStartIdentification() {
    const token = ++this.idToken;
    if (this.nav.calibrate || this.nav.retakeKey || this.nav.manualTarget) {
      this.startId = { status: 'needs_confirm', mode: 'calibrate' };
      this.openStartSheet();
      return;
    }
    this.startId = { status: 'checking' };
    await this.runIdentification(token);
  }

  async runIdentification(token) {
    this.idRunning = true;
    try {
      const frame = this.demo ? this.demo.grabFrame(this.screenOrientation(), 'good') : grabFrame(this.video, 960, 'start-frame', -this.view.rot);
      const vehicle = this.vehicleNow();
      const s = getState();
      let boxPx = null;
      if (vehicle.bbox) boxPx = { x: vehicle.bbox.x * frame.width, y: vehicle.bbox.y * frame.height, w: vehicle.bbox.w * frame.width, h: vehicle.bbox.h * frame.height };
      const classifier = !this.demo && getAIInfo().hasViewClassifier ? await classifyView(frame) : null;
      const res = await detectVehicleOrientation(this.demo ? null : frame, {
        vehicle, vehicleBoxPx: boxPx, vehicleType: s.vehicle.type, expectedPlate: s.vehicle.plate,
        useOCR: s.settings.ocrEnabled && !this.demo && Boolean(s.vehicle.plate), classifier, // không có biển số kỳ vọng thì OCR không giúp được gì → khỏi tải Tesseract
      });
      if (token !== this.idToken || !this.active) return;
      this.startId.frame = frame;
      if (res.orientation === 'side') {
        this.startId = { status: 'side', result: res, recheckAt: Date.now() + 2500 };
        return;
      }
      if (!res.needsConfirmation && (res.orientation === 'front' || res.orientation === 'rear')) {
        this.confirmStart(res.orientation, { method: 'classifier', confidence: res.confidence, evidence: res.evidence, ocr: res.ocr });
        return;
      }
      this.startId = { status: 'needs_confirm', result: res, frame, mode: 'start' };
      this.openStartSheet();
    } catch (e) {
      log.warn('Xác định điểm xuất phát lỗi', e);
      if (token === this.idToken) this.startId = { status: 'needs_confirm', result: null, mode: 'start' };
      if (token === this.idToken) this.openStartSheet();
    } finally {
      if (token === this.idToken) this.idRunning = false;
    }
  }

  /** Nhận diện lại khi người dùng đang ở góc nhìn ngang. */
  maybeRecheckStart() {
    if (this.fsm.state === S.IDENTIFYING_START_POINT && this.startId.status === 'side' && !this.idRunning && Date.now() >= this.startId.recheckAt) {
      this.runIdentification(this.idToken);
    }
  }

  async openStartSheet() {
    if (this.startSheet || !this.active) return;
    const s = getState();
    const calibrate = this.startId.mode === 'calibrate';
    const target = this.nav.currentTarget(s.captures);
    const res = this.startId.result;
    const ocr = res?.ocr ?? null;

    let thumb = null;
    if (this.startId.frame) thumb = await this.thumbNode(this.startId.frame);
    if (!this.active || this.fsm.state !== S.IDENTIFYING_START_POINT) { thumb?.revoke(); return; }

    const body = [];
    if (thumb) body.push(thumb.img);

    let plateBox = null;
    if (!calibrate) {
      const evid = (res?.evidence ?? []).filter((e) => e.weight > 0 || e.source === 'plate_ocr').map((e) => h('li', { text: e.detail }));
      if (evid.length) body.push(h('ul', { class: 'sheet-evidence' }, ...evid));
      if (s.vehicle.plate) {
        const status = ocr?.status ?? (s.settings.ocrEnabled && !this.demo ? 'idle' : 'skipped');
        const statusText = ({ matched: T.ocr.matched, mismatch: T.ocr.mismatch, read: 'Đã đọc biển số', low_confidence: T.ocr.lowConfidence, not_found: T.ocr.notFound, unavailable: T.ocr.unavailable, skipped: T.ocr.skipped, idle: T.ocr.idle })[status] ?? status;
        body.push(h('dl', { class: 'kv' },
          h('dt', { text: 'Biển số đã nhập' }), h('dd', { text: s.vehicle.plate }),
          h('dt', { text: 'Kết quả OCR' }), h('dd', { text: `${statusText}${ocr?.text ? ` (“${ocr.normalized}”)` : ''}` })));
        if (status !== 'matched') {
          const cb = h('input', { type: 'checkbox', id: 'plateConfirm' });
          plateBox = cb;
          body.push(h('label', { class: 'switch' }, cb, h('span', { class: 'track' }), h('span', { class: 'sw-text', text: `Tôi xác nhận đây đúng là xe có biển số ${s.vehicle.plate}` })));
        }
      }
    }

    const actions = calibrate
      ? [{ label: 'Hủy', kind: 'ghost', value: null }, { label: 'Xác nhận vị trí', kind: 'primary', value: 'here', icon: 'check' }]
      : [
        { label: 'Đây là ĐẦU xe', kind: 'primary', value: 'front', icon: 'car' },
        { label: 'Đây là ĐUÔI xe', kind: 'primary', value: 'rear', icon: 'car' },
        { label: 'Chưa đúng — tôi sẽ đổi vị trí', kind: 'ghost', value: null },
      ];
    const A = target ? ANGLE_BY_KEY[target] : null;
    const handle = showSheet({
      title: calibrate ? `Bạn đang đứng ở ${lc(A?.name ?? 'góc này')}?` : 'Bạn đang đứng ở đầu xe hay đuôi xe?',
      text: calibrate
        ? 'Đứng đúng vị trí của góc này, hướng camera vào xe rồi xác nhận để đặt lại mốc vị trí.'
        : `${this.startId.forced ? 'Hình dạng xe trong khung giống góc nhìn chéo/ngang hơn — hãy kiểm tra lại vị trí. ' : ''}COCO-SSD chỉ phát hiện “có xe”, không phân biệt được đầu xe và đuôi xe. Hãy chọn để bắt đầu chụp theo chiều kim đồng hồ.`,
      body,
      actions,
      dismissible: true,
    });
    this.startSheet = handle;
    if (plateBox && res?.ocr?.status === 'mismatch') {
      handle.setDisabled('front', true);
      handle.setDisabled('rear', true);
      plateBox.addEventListener('change', () => { handle.setDisabled('front', !plateBox.checked); handle.setDisabled('rear', !plateBox.checked); });
    }
    const choice = await handle.closed;
    this.startSheet = null;
    thumb?.revoke();
    if (!choice || !this.active || this.fsm.state !== S.IDENTIFYING_START_POINT) return;
    const plateConfirmed = Boolean(plateBox?.checked);
    if (choice === 'here') { this.confirmStart(target, { method: 'manual', confidence: 1, evidence: [{ source: 'user_confirmed', weight: 1, detail: 'Khách hàng xác nhận vị trí hiện tại' }] }); return; }
    this.confirmStart(choice, {
      method: 'manual', confidence: 1,
      evidence: [{ source: 'user_confirmed', weight: 1, detail: choice === 'front' ? 'Khách hàng xác nhận đây là đầu xe' : 'Khách hàng xác nhận đây là đuôi xe' }, ...(res?.evidence ?? [])],
      ocr, plateConfirmed,
    });
  }

  /** Dùng cho DEMO tự động và cho phím tắt kiểm thử. */
  async confirmStartAs(key) {
    if (this.fsm.state !== S.IDENTIFYING_START_POINT) return;
    if (this.startSheet) { this.startSheet.close(key); return; }
    this.confirmStart(key, { method: 'manual', confidence: 1, evidence: [{ source: 'user_confirmed', weight: 1, detail: 'DEMO — xác nhận giả lập' }] });
  }

  confirmStart(key, info = {}) {
    const A = ANGLE_BY_KEY[key];
    if (!A) return;
    const calibrate = this.nav.calibrate || this.nav.retakeKey || this.nav.manualTarget;
    if (calibrate) {
      movementTracker.setOrigin({ angleDeg: A.deg });
      this.nav.confirmStart(key);
    } else {
      const ocr = info.ocr;
      update('session', {
        startIndex: A.index,
        startConfirmation: { method: info.method ?? 'manual', orientation: key, confidence: Number((info.confidence ?? 1).toFixed(2)), evidence: (info.evidence ?? []).map((e) => ({ source: e.source, weight: e.weight, detail: e.detail })) },
        ocr: ocr
          ? { status: ocr.status, text: ocr.text, normalized: ocr.normalized, confidence: ocr.confidence, similarity: ocr.similarity, manualConfirmed: Boolean(info.plateConfirmed) }
          : { ...getState().session.ocr, manualConfirmed: Boolean(info.plateConfirmed) },
      });
      this.nav.reset({ startIndex: A.index });
      this.nav.confirmStart(key);
      movementTracker.setOrigin({ angleDeg: A.deg });
      this.angleDet.reset();
      persistSession();
      terminateOCR().catch(() => {}); // OCR chỉ cần ở bước xác định điểm xuất phát: giải phóng worker Tesseract (~vài chục MB)
    }
    this.startId = { status: 'confirmed' };
    this.guideSig = '';
    this.fsm.send(E.START_CONFIRMED);
    this.tick(); // cập nhật ngay để nút chụp không bị "trễ một nhịp" sau khi xác nhận
    toast(calibrate ? 'Đã đặt lại vị trí' : `Điểm xuất phát: ${A.name.toLowerCase()}. Đi sang bên trái của bạn để vòng quanh xe.`, { level: 'ok', ms: 3200 });
  }

  /* ====================================================================== */
  /* Mini-map: chọn góc                                                     */
  /* ====================================================================== */
  async onNodeSelect(key) {
    if (this.busy || !this.active) return;
    const s = getState();
    const A = ANGLE_BY_KEY[key];
    if (!this.nav.startConfirmed) { toast('Hãy xác nhận đầu xe hoặc đuôi xe trước.', { level: 'warn' }); return; }
    const target = this.nav.currentTarget(s.captures);
    const c = s.captures[key];
    if (key === target) {
      const ok = await confirmDialog({ title: `Bạn đang đứng ở ${lc(A.name)}?`, text: 'Xác nhận để đặt lại mốc vị trí khi cảm biến bị lệch. Ảnh vẫn phải qua kiểm tra chất lượng như bình thường.', confirmLabel: 'Xác nhận vị trí' });
      if (ok) { movementTracker.setOrigin({ angleDeg: A.deg }); this.angleDet.reset(); toast('Đã đặt lại vị trí', { level: 'ok' }); }
    } else if (c?.accepted && !c.retake) {
      const ok = await confirmDialog({ title: `Chụp lại ${lc(A.name)}?`, text: 'Ảnh cũ chỉ bị thay thế khi ảnh mới đạt chất lượng.', confirmLabel: 'Chụp lại' });
      if (ok) {
        markRetake(key);
        this.nav.reset({ startIndex: s.session.startIndex ?? 0, retakeKey: key, firstCaptureDone: true });
        this.nav.confirmStart(key);
      }
    } else {
      const ok = await confirmDialog({ title: `Chuyển sang ${lc(A.name)}?`, text: 'Thứ tự chuẩn là theo chiều kim đồng hồ. Bạn vẫn có thể chọn góc khác khi cần.', confirmLabel: 'Chuyển' });
      if (ok) this.nav.setManualTarget(key);
    }
  }

  /* ====================================================================== */
  /* Khóa hướng màn hình (nếu trình duyệt hỗ trợ)                           */
  /* ====================================================================== */
  /**
   * Khóa trình duyệt ở hướng DỌC (chỉ được phép khi đang toàn màn hình, chủ yếu Android). Người dùng xoay máy
   * thì giao diện tự xoay theo cảm biến — trình duyệt không phải dựng lại trang nên không bị khựng.
   */
  syncPortraitLock() {
    if (!getState().settings.tryOrientationLock || this.portraitLocked || this.lockTrying || this.lockFailed || !isFullscreen()) return;
    this.lockTrying = true;
    tryLockOrientation('portrait').then((r) => { this.portraitLocked = r.ok; this.lockFailed = !r.ok; }).finally(() => { this.lockTrying = false; });
  }

  syncFullscreenUi() {
    const btn = $('#btnFullscreen');
    btn.hidden = isStandalone();
    const fs = isFullscreen();
    $('#fsIcon').setAttribute('href', fs ? '#i-compress' : '#i-expand');
    btn.setAttribute('aria-label', fs ? 'Thoát toàn màn hình' : 'Toàn màn hình');
  }

  async toggleFullscreen() {
    if (isFullscreen()) { unlockOrientation(); this.portraitLocked = false; exitFullscreen(); return; }
    if (!fullscreenSupported()) {
      const ios = isIOS();
      showSheet({
        title: 'Mở toàn màn hình',
        text: ios
          ? 'Safari trên iPhone không cho trang web ẩn thanh địa chỉ. Hãy bấm nút Chia sẻ → "Thêm vào MH chính", rồi mở ứng dụng từ biểu tượng mới: camera sẽ hiển thị toàn màn hình. Nên bật "Khóa hướng dọc" trong Trung tâm điều khiển — giao diện vẫn tự xoay khi bạn cầm ngang.'
          : 'Trình duyệt này không hỗ trợ chế độ toàn màn hình. Bạn có thể "Thêm vào màn hình chính" (menu trình duyệt) để mở như ứng dụng, không có thanh địa chỉ.',
        actions: [{ label: 'Đã hiểu', kind: 'primary', value: true }],
      });
      return;
    }
    const ok = await tryEnterFullscreen();
    if (!ok) toast('Không mở được toàn màn hình trên trình duyệt này.', { level: 'warn' });
    this.syncPortraitLock();
  }

  /* ====================================================================== */
  /* Điều khiển & hộp thoại                                                 */
  /* ====================================================================== */
  bindControls() {
    this.el.shutter.addEventListener('click', () => this.handleShutter());
    $('#btnExit').addEventListener('click', () => this.confirmExit());
    $('#btnPause').addEventListener('click', () => this.pause());
    $('#btnHelp').addEventListener('click', () => this.showHelp());
    $('#btnPeek').addEventListener('click', () => this.showPeek());
    $('#btnSound').addEventListener('click', () => {
      const on = !getState().settings.voice;
      update('settings', { voice: on });
      setVoiceEnabled(on);
      setSoundEnabled(on);
      this.syncSoundIcon();
      toast(on ? 'Đã bật giọng nói hướng dẫn' : 'Đã tắt giọng nói hướng dẫn');
    });
    $('#btnFlip').addEventListener('click', () => this.flipCamera());
    $('#btnFullscreen').addEventListener('click', () => this.toggleFullscreen());
    $('#btnRotateManual').addEventListener('click', () => this.manualRotate());
    const onFs = () => {
      if (!isFullscreen()) this.portraitLocked = false;
      this.lockFailed = false;
      this.syncFullscreenUi();
      if (this.active) { this.syncPortraitLock(); setTimeout(() => this.syncView(true), 250); }
    };
    document.addEventListener('fullscreenchange', onFs);
    document.addEventListener('webkitfullscreenchange', onFs);
    // phím tắt để kiểm thử trên máy tính
    document.addEventListener('keydown', (e) => {
      if (!this.active || e.target.matches?.('input,textarea,select')) return;
      if (e.code === 'Space') { e.preventDefault(); this.handleShutter(); }
    });
  }

  async confirmExit() {
    if (this.busy) return;
    const n = acceptedCount();
    const ok = await confirmDialog({
      title: 'Thoát chụp ảnh?',
      text: n > 0 ? `${n}/8 góc đã chụp được giữ lại trên thiết bị. Bạn có thể tiếp tục phiên này sau.` : 'Chưa có ảnh nào được lưu.',
      confirmLabel: 'Thoát', cancelLabel: 'Ở lại',
    });
    if (ok) await this.exit();
  }

  async pause() {
    if (this.busy || this.paused) return;
    this.paused = true;
    this.loop?.stop();
    this.demoRunner?.stop();
    this.demo?.stopWalking();
    stopSpeaking();
    setText(this.el.gText, T.guidance.paused);
    const v = await showSheet({
      title: 'Đã tạm dừng',
      text: 'Camera vẫn mở nhưng ứng dụng tạm ngừng nhận diện.',
      row: true,
      actions: [{ label: 'Thoát', kind: 'ghost', value: 'exit' }, { label: 'Tiếp tục', kind: 'primary', value: 'go', icon: 'play' }],
      dismissible: false,
    }).closed;
    if (v === 'exit') { this.paused = false; await this.exit(); return; }
    this.paused = false;
    this.curGuidance = null;
    if (!this.demo && getAIInfo().ready) { this.loop = null; this.startLoop(); }
  }

  showHelp() {
    const s = getState();
    const kv = h('dl', { class: 'kv' },
      h('dt', { text: 'Trạng thái' }), h('dd', { text: this.fsm.state }),
      h('dt', { text: 'Cảm biến' }), h('dd', { text: movementTracker.getSnapshot().status }),
      h('dt', { text: 'AI' }), h('dd', { text: this.demo ? 'giả lập (DEMO)' : `${s.ai.status}${s.ai.backend ? ` · ${s.ai.backend}` : ''}` }),
      h('dt', { text: 'Chế độ' }), h('dd', { text: this.demo ? DEMO_LABEL : 'Camera thật' }),
      h('dt', { text: 'Hướng cầm máy' }), h('dd', { text: `${this.view.effective === 'landscape' ? 'ngang' : 'dọc'}${this.view.rot ? ' · giao diện xoay theo cảm biến' : ''}` }),
      h('dt', { text: 'Model AI' }), h('dd', { text: this.demo ? '—' : this.loop?.mode === 'off' ? 'tạm nghỉ (đang đi giữa hai góc)' : 'đang chạy' }));
    showSheet({
      title: 'Hướng dẫn nhanh',
      body: [
        h('ul', { class: 'sheet-list' },
          h('li', { text: 'Giữ cả xe trong khung và đi sang bên TRÁI của bạn để vòng quanh xe theo chiều kim đồng hồ.' }),
          h('li', { text: 'Đầu xe và đuôi xe chụp dọc; sáu góc còn lại chụp ngang. Nên bật khóa xoay màn hình (dọc): khi bạn cầm ngang, giao diện tự xoay theo cảm biến và ảnh vẫn được lưu đúng chiều.' }),
          h('li', { text: 'Nút ⛶ ở góc trên: mở toàn màn hình để ẩn thanh địa chỉ. Kéo bản đồ 8 góc tới chỗ bạn muốn.' }),
          h('li', { text: 'Nút chụp sáng lên khi đủ điều kiện. Chạm vào số trên bản đồ để đổi góc, chụp lại hoặc đặt lại vị trí.' }),
          h('li', { text: 'Có nhiều xe trong khung? Chạm vào đúng xe cần chụp.' })),
        kv,
      ],
      actions: [{ label: 'Đã hiểu', kind: 'primary', value: 'ok' }],
    });
  }

  async showPeek() {
    if (this.busy) return;
    const s = getState();
    const grid = h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '6px' } });
    const loads = [];
    ANGLES.forEach((a, i) => {
      const c = s.captures[a.key];
      const cell = h('button', { type: 'button', style: { position: 'relative', aspectRatio: '4/3', borderRadius: '10px', overflow: 'hidden', background: '#0b1317', border: `1.5px solid ${c?.accepted && !c.retake ? 'var(--ok)' : 'var(--line-2)'}`, color: 'var(--ink-2)', fontSize: '11px' } },
        h('span', { text: `${i + 1}. ${a.short}`, style: { position: 'absolute', left: '4px', top: '3px', zIndex: '2', textShadow: '0 1px 3px #000', fontWeight: '700' } }));
      if (c?.fileName && s.session.id) {
        loads.push(getThumbUrl(s.session.id, a.key).then((url) => {
          if (url) cell.append(h('img', { src: url, alt: a.name, style: { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'cover' } }));
        }));
        cell.addEventListener('click', async () => {
          const full = await getObjectUrl(s.session.id, a.key);
          if (full) openViewer(full, a.name);
        });
      }
      grid.append(cell);
    });
    const handle = showSheet({
      title: `Ảnh đã chụp: ${acceptedCount(s)}/8`,
      body: [grid],
      row: true,
      actions: [{ label: 'Đóng', kind: 'ghost', value: 'close' }, { label: 'Xem tất cả & xuất', kind: 'primary', value: 'preview' }],
    });
    await Promise.all(loads);
    const v = await handle.closed;
    if (v === 'preview') this.cb.onOpenPreview();
  }

  async flipCamera() {
    if (this.demo) { toast('DEMO không dùng camera thật.', { level: 'warn' }); return; }
    if (this.busy) return;
    this.cameraStarting = true;
    const r = await switchCamera();
    this.cameraStarting = false;
    if (!r.ok) { toast(r.message ?? 'Không đổi được camera.', { level: 'warn' }); return; }
    update('camera', { deviceId: r.deviceId, facing: r.facing, width: r.width, height: r.height, label: r.label });
    this.layout();
    toast(`Camera: ${r.label || 'đã đổi'}`, { level: 'ok' });
  }

  /* ====================================================================== */
  /* Lỗi camera / AI / vòng đời trình duyệt                                  */
  /* ====================================================================== */
  showBlock({ icon: ic = 'alert', title, text, actions = [] }) {
    $('#blockIcon').setAttribute('href', `#i-${ic}`);
    setText($('#blockTitle'), title);
    setText($('#blockText'), text);
    const host = $('#blockActions');
    clearNode(host);
    for (const a of actions) host.append(h('button', { class: `btn ${a.kind ?? ''}`.trim(), type: 'button', onClick: a.onClick }, a.label));
    this.el.block.hidden = false;
  }
  hideBlock() { this.el.block.hidden = true; }

  showCameraBlock(r) {
    const canDemo = acceptedCount() === 0;
    this.showBlock({
      icon: 'camera',
      title: 'Không thể mở camera',
      text: r.message,
      actions: [
        { label: 'Thử lại', kind: 'primary', onClick: () => { this.hideBlock(); this.startLive(this.token); } },
        ...(canDemo ? [{ label: 'Dùng chế độ DEMO (giả lập)', kind: '', onClick: () => this.switchToDemo() }] : []),
        { label: 'Quay lại', kind: 'ghost', onClick: () => this.exit() },
      ],
    });
  }

  showAIBlock(error) {
    const canDemo = acceptedCount() === 0;
    this.showBlock({
      icon: 'alert',
      title: 'AI nhận diện chưa sẵn sàng',
      text: `${error || 'Không tải được TensorFlow.js / COCO-SSD.'} Kiểm tra kết nối mạng (thư viện được tải từ CDN) rồi thử lại. Không có AI thì ứng dụng không thể phát hiện xe thật.`,
      actions: [
        { label: 'Thử lại tải AI', kind: 'primary', onClick: () => { this.hideBlock(); resetModelLoad(); this.ensureAI(this.token); } },
        ...(canDemo ? [{ label: 'Chuyển sang chế độ DEMO (giả lập)', kind: '', onClick: () => this.switchToDemo() }] : []),
        { label: 'Quay lại', kind: 'ghost', onClick: () => this.exit() },
      ],
    });
  }

  switchToDemo() {
    this.hideBlock();
    this.teardownLive();
    update('settings', { mode: 'demo' });
    this.tracker.reset();
    this.startDemo();
    this.renderChrome();
    persistSession();
  }

  onCameraEnded() {
    if (!this.active || this.demo) return;
    this.showBlock({
      icon: 'camera',
      title: 'Camera đã bị ngắt',
      text: 'Camera bị ứng dụng khác chiếm hoặc bị thu hồi quyền. Hãy mở lại camera để tiếp tục — ảnh đã chụp vẫn được giữ.',
      actions: [
        { label: 'Mở lại camera', kind: 'primary', onClick: () => { this.hideBlock(); this.startLive(this.token); } },
        { label: 'Quay lại', kind: 'ghost', onClick: () => this.exit() },
      ],
    });
  }

  async onVisibility() {
    if (!this.active || this.demo || document.hidden) return;
    if (!isCameraActive() && this.el.block.hidden && !this.cameraStarting) {
      toast('Đang mở lại camera…', { level: 'warn' });
      await this.startLive(this.token);
    }
  }

  /* ====================================================================== */
  /* API cho bảng DEMO                                                      */
  /* ====================================================================== */
  getTargetDeg() {
    const t = this.nav.currentTarget(getState().captures);
    return t ? ANGLE_BY_KEY[t].deg : null;
  }
  autoSnapshot() {
    const s = getState();
    return {
      fsm: this.fsm.state,
      target: this.nav.currentTarget(s.captures),
      ready: this.isReady(),
      near: Boolean(this.lastEval?.info?.near),
      startStatus: this.startId.status,
      startConfirmed: this.nav.startConfirmed,
      busy: this.busy || this.idRunning,
      completed: s.completed || this.fsm.state === S.COMPLETED,
      orientation: this.screenOrientation(),
      sheetOpen: hasActiveSheet() && !this.startSheet,
    };
  }
  autoDismiss() { closeActiveSheet('retry'); }
}

