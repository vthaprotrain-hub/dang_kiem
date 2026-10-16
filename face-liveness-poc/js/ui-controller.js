/**
 * ui-controller.js — Overlay, trạng thái, thông báo hướng dẫn và các màn hình.
 *
 * Phần logic chọn thông báo (`resolveGuidance`, `resolveGeoStatus`, `resolveLivenessStatus`) là hàm thuần,
 * tách khỏi DOM để dễ kiểm thử. `UIController` chỉ vẽ lại những gì được yêu cầu và chống nhấp nháy bằng
 * thời gian giữ tối thiểu cho thông báo và màu viền.
 */

import { FaceState, FACE_OVAL_INDICES, computeOval, videoToView } from './geometry-validator.js';
import { LivenessState } from './liveness.js';

// ---------------------------------------------------------------------------------------------
// Nội dung hướng dẫn (tiếng Việt)
// ---------------------------------------------------------------------------------------------

export const MESSAGES = Object.freeze({
  FIND_FACE: { main: 'Đang tìm khuôn mặt…' },
  CENTER_FACE: { main: 'Vui lòng đưa khuôn mặt vào giữa khung.' },
  MOVE_LEFT: { main: 'Di chuyển sang trái một chút.' },
  MOVE_RIGHT: { main: 'Di chuyển sang phải một chút.' },
  RAISE_FACE: { main: 'Nâng mặt lên.' },
  LOWER_FACE: { main: 'Hạ mặt xuống.' },
  LOOK_STRAIGHT: { main: 'Vui lòng nhìn thẳng vào camera.' },
  KEEP_HEAD_STRAIGHT: { main: 'Giữ đầu thẳng.' },
  COME_CLOSER: { main: 'Tiến lại gần camera.' },
  MOVE_BACK: { main: 'Lùi ra một chút.' },
  LOW_LIGHT: { main: 'Ánh sáng chưa đủ, vui lòng di chuyển đến nơi sáng hơn.' },
  TOO_BRIGHT: { main: 'Ánh sáng quá chói, hãy tránh nguồn sáng chiếu thẳng vào camera.' },
  BLURRY: { main: 'Ảnh chưa rõ nét.', sub: 'Lau sạch ống kính và giữ điện thoại ổn định.' },
  HOLD_STEADY: { main: 'Giữ điện thoại ổn định.' },
  SINGLE_FACE: { main: 'Vui lòng chỉ để một khuôn mặt trong khung.' },
  CHECKING: { main: 'Đang kiểm tra điều kiện chụp…', sub: 'Giữ nguyên tư thế.' },
  BLINK: { main: 'Hãy chớp mắt theo hướng dẫn.', sub: 'Chớp mắt một lần, tự nhiên.' },
  TURN_LEFT: { main: 'Hãy quay nhẹ đầu sang trái.', sub: 'Quay sang bên trái của bạn.' },
  TURN_RIGHT: { main: 'Hãy quay nhẹ đầu sang phải.', sub: 'Quay sang bên phải của bạn.' },
  TURN_LEFT_WRONG: { main: 'Sai hướng. Hãy quay nhẹ đầu sang trái.' },
  TURN_RIGHT_WRONG: { main: 'Sai hướng. Hãy quay nhẹ đầu sang phải.' },
  RETURN_FRONT: { main: 'Quay lại nhìn thẳng vào camera.' },
  ACTION_OK: { main: 'Đã ghi nhận.', sub: 'Giữ nguyên tư thế.' },
  LIVENESS_DONE: { main: 'Đã hoàn thành thử thách cơ bản.', sub: 'Đang kiểm tra điều kiện chụp…' },
  MANUAL_MODE: { main: 'Chế độ chụp thủ công.', sub: 'Ảnh sẽ KHÔNG được kiểm tra tự động.' },
  LIVENESS_FAILED: { main: 'Chưa thể xác nhận người thật. Vui lòng thử lại.' },
  READY: {
    main: 'Đã đạt điều kiện chụp.',
    subWithLiveness: 'Đã hoàn thành thử thách cơ bản (không phải xác minh người thật).',
  },
});

// ---------------------------------------------------------------------------------------------
// Logic trạng thái (hàm thuần)
// ---------------------------------------------------------------------------------------------

/**
 * Chọn thông báo hướng dẫn + tông màu (gray|red|yellow|green).
 * @param {object} s {analysis, qualityEval, stability, liveness(instance), livenessEnabled, canCapture, noFaceMs}
 */
export function resolveGuidance(s) {
  const a = s.analysis;
  if (!a || a.faceState === FaceState.NO_FACE) {
    return { key: s.noFaceMs > 3000 ? 'CENTER_FACE' : 'FIND_FACE', tone: 'gray' };
  }
  if (a.faceState === FaceState.MULTIPLE_FACES) return { key: 'SINGLE_FACE', tone: 'red' };

  const L = s.liveness;
  if (s.livenessEnabled && L) {
    if (L.active) return { key: L.instructionKey, tone: 'yellow' };
    if (L.state === LivenessState.LIVENESS_INCONCLUSIVE) return { key: 'LIVENESS_FAILED', tone: 'red' };
  }

  if (!a.rules.position || !a.rules.scale || !a.rules.pose) return { key: a.hint, tone: 'red' };

  const q = s.qualityEval;
  if (!q || !q.ready) return { key: 'CHECKING', tone: 'yellow' };
  if (!q.ok) return { key: q.hint, tone: 'red' };
  if (!s.stability.motionOk) return { key: 'HOLD_STEADY', tone: 'red' };
  if (s.canCapture) return { key: 'READY', tone: 'green' };
  if (s.livenessEnabled && L && L.state === LivenessState.CHALLENGE_PASSED) {
    return { key: 'LIVENESS_DONE', tone: 'yellow' };
  }
  return { key: 'CHECKING', tone: 'yellow' };
}

/** Trạng thái hình học (chip + màu viền oval). Tách riêng khỏi liveness. */
export function resolveGeoStatus(s) {
  const a = s.analysis;
  if (!a || a.faceState === FaceState.NO_FACE) return { tone: 'gray', label: 'Hình học: chưa có mặt' };
  if (a.faceState === FaceState.MULTIPLE_FACES) return { tone: 'red', label: 'Hình học: nhiều khuôn mặt' };
  if (s.livenessEnabled && s.liveness && s.liveness.active) return { tone: 'yellow', label: 'Hình học: đang theo dõi' };
  if (!a.geometryOk) return { tone: 'red', label: 'Hình học: chưa đạt' };
  const q = s.qualityEval;
  if (!q || !q.ready) return { tone: 'yellow', label: 'Hình học: đang kiểm tra' };
  if (!q.ok || !s.stability.motionOk) return { tone: 'red', label: 'Hình học: chất lượng chưa đạt' };
  if (!s.stability.stable) return { tone: 'yellow', label: 'Hình học: đang xác minh' };
  return { tone: 'green', label: 'Hình học: đạt' };
}

/** Trạng thái liveness hiển thị riêng. Không bao giờ dùng cụm "người thật đã được xác minh". */
/** Làm tròn lên theo giây, bỏ qua sai số dấu phẩy động (8000.0000001 ms vẫn là 8 s). */
export const secondsLeft = (ms) => Math.max(0, Math.ceil(ms / 1000 - 0.01));

export function resolveLivenessStatus(s, now) {
  if (!s.livenessEnabled) return { tone: 'gray', label: 'Liveness: tắt' };
  const L = s.liveness;
  if (!L) return { tone: 'gray', label: 'Liveness: chưa bắt đầu' };
  switch (L.state) {
    case LivenessState.IDLE:
      return { tone: 'gray', label: 'Liveness: chưa bắt đầu' };
    case LivenessState.CHALLENGE_STARTED:
      return { tone: 'yellow', label: 'Liveness: đang chuẩn bị' };
    case LivenessState.WAITING_FOR_ACTION: {
      const ms = L.remainingMs(now);
      return { tone: 'yellow', label: `Liveness: đang kiểm tra${ms != null ? ` (${secondsLeft(ms)}s)` : ''}` };
    }
    case LivenessState.ACTION_DETECTED:
      return { tone: 'yellow', label: 'Liveness: đã nhận hành động' };
    case LivenessState.LIVENESS_INCONCLUSIVE:
      return { tone: 'red', label: 'Liveness: chưa xác nhận được' };
    case LivenessState.CHALLENGE_PASSED:
      return L.isValid(now)
        ? { tone: 'green', label: 'Liveness: đã hoàn thành thử thách cơ bản' }
        : { tone: 'gray', label: 'Liveness: đã hết hạn' };
    default:
      return { tone: 'gray', label: 'Liveness: —' };
  }
}

// ---------------------------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------------------------

const TONE_COLOR = { gray: '#9aa3b2', red: '#ef4444', yellow: '#f5b301', green: '#22c55e' };
const SCREENS = ['intro', 'loading', 'error', 'camera', 'preview', 'done'];

export class UIController {
  constructor(cfg) {
    this.cfg = cfg;
    const $ = (id) => document.getElementById(id);
    this.el = {
      stage: $('stage'),
      video: $('video'),
      overlay: $('overlay'),
      guidance: $('guidance'),
      guidanceMain: $('guidance-main'),
      guidanceSub: $('guidance-sub'),
      timer: $('challenge-timer'),
      perfNotice: $('perf-notice'),
      debugPanel: $('debug-panel'),
      chipGeo: $('chip-geo'),
      chipLive: $('chip-live'),
      btnCapture: $('btn-capture'),
      btnDebug: $('btn-debug'),
      btnSwitch: $('btn-switch'),
      btnRetryLiveness: $('btn-retry-liveness'),
      loadingText: $('loading-text'),
      envWarning: $('env-warning'),
      errorTitle: $('error-title'),
      errorMessage: $('error-message'),
      errorDetails: $('error-details'),
      errorDetailsText: $('error-details-text'),
      btnErrorManual: $('btn-error-manual'),
      previewImg: $('preview-img'),
      previewNote: $('preview-note'),
    };
    this.ctx = this.el.overlay.getContext('2d');
    this.dpr = 1;
    this.viewW = 0;
    this.viewH = 0;
    this.debugOn = false;

    this.shownGuidance = { key: null, tone: null, at: -Infinity };
    this.shownTone = { tone: 'gray', candidate: 'gray', candidateSince: 0 };
    this.cache = { geo: '', geoTone: '', live: '', liveTone: '', debug: '', debugAt: -Infinity, timer: '' };

    this.resizeObserver = new ResizeObserver(() => this.resizeOverlay());
    this.resizeObserver.observe(this.el.stage);
  }

  /** @param {Record<string, () => void>} h */
  bind(h) {
    const on = (id, fn) => document.getElementById(id).addEventListener('click', fn);
    on('btn-start', h.onStart);
    on('btn-close', h.onClose);
    on('btn-switch', h.onSwitchCamera);
    on('btn-capture', h.onCapture);
    on('btn-debug', () => {
      this.setDebug(!this.debugOn);
      h.onDebugToggle?.(this.debugOn);
    });
    on('btn-retry-liveness', h.onRetryLiveness);
    on('btn-retake', h.onRetake);
    on('btn-confirm', h.onConfirm);
    on('btn-download', h.onDownload);
    on('btn-done-download', h.onDownload);
    on('btn-again', h.onAgain);
    on('btn-error-retry', h.onErrorRetry);
    on('btn-error-manual', h.onErrorManual);
    on('btn-error-back', h.onErrorBack);
  }

  // ------------------------------------------------------------------ màn hình

  showScreen(name) {
    for (const s of SCREENS) document.getElementById(`screen-${s}`).hidden = s !== name;
    if (name === 'camera') this.resizeOverlay();
  }

  setEnvWarning(text) {
    this.el.envWarning.hidden = !text;
    this.el.envWarning.textContent = text || '';
  }

  setLoading(text) {
    this.el.loadingText.textContent = text;
  }

  showError({ title, message, details, allowManual = false }) {
    this.el.errorTitle.textContent = title;
    this.el.errorMessage.textContent = message;
    this.el.errorDetails.hidden = !details;
    this.el.errorDetailsText.textContent = details || '';
    this.el.btnErrorManual.hidden = !allowManual;
    this.showScreen('error');
  }

  showPreview({ url, note }) {
    this.el.previewImg.src = url;
    this.el.previewNote.textContent = note || '';
    this.showScreen('preview');
  }

  clearPreview() {
    this.el.previewImg.removeAttribute('src');
  }

  setMirrored(mirrored) {
    this.el.stage.classList.toggle('is-mirrored', !!mirrored);
  }

  setSwitchVisible(visible) {
    this.el.btnSwitch.hidden = !visible;
  }

  // ------------------------------------------------------------------ overlay

  /** Cập nhật kích thước canvas theo kích thước hiển thị × devicePixelRatio. */
  resizeOverlay() {
    const rect = this.el.stage.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.viewW = rect.width;
    this.viewH = rect.height;
    this.el.overlay.width = Math.round(rect.width * this.dpr);
    this.el.overlay.height = Math.round(rect.height * this.dpr);
    // Đổi kích thước làm canvas bị xoá: vẽ lại ngay bằng tham số lần vẽ gần nhất (cần khi không có frame mới, vd. chế độ thủ công).
    if (this.lastDraw) this.drawOverlay({ ...this.lastDraw, now: performance.now() });
  }

  getViewSize() {
    if (!this.viewW) this.resizeOverlay();
    return { viewW: this.viewW, viewH: this.viewH };
  }

  clearOverlay() {
    this.lastDraw = null;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.el.overlay.width, this.el.overlay.height);
  }

  /** Màu viền được giữ tối thiểu 200 ms trước khi đổi, tránh nhấp nháy khi số đo dao động quanh ngưỡng. */
  smoothTone(tone, now) {
    const t = this.shownTone;
    if (tone === t.tone) {
      t.candidate = tone;
      return t.tone;
    }
    if (tone !== t.candidate) {
      t.candidate = tone;
      t.candidateSince = now;
    } else if (now - t.candidateSince >= 200) {
      t.tone = tone;
    }
    return t.tone;
  }

  drawOverlay({ analysis, tone, progress, now }) {
    const { viewW: W, viewH: H, ctx, dpr } = this;
    if (!W) return;
    this.lastDraw = { analysis, tone, progress };
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const oval = analysis ? analysis.oval : computeOval(W, H, this.cfg.oval);
    const shown = this.smoothTone(tone, now);
    const color = TONE_COLOR[shown];

    // Làm tối vùng ngoài oval
    ctx.fillStyle = 'rgba(4, 9, 20, 0.55)';
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.ellipse(oval.cx, oval.cy, oval.rx, oval.ry, 0, 0, Math.PI * 2);
    ctx.fill('evenodd');

    // Viền oval
    ctx.lineWidth = 4;
    ctx.strokeStyle = color;
    ctx.setLineDash(shown === 'gray' ? [10, 8] : []);
    ctx.beginPath();
    ctx.ellipse(oval.cx, oval.cy, oval.rx, oval.ry, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Vòng tiến độ ổn định
    if (progress > 0 && progress < 1) {
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.strokeStyle = TONE_COLOR.yellow;
      ctx.beginPath();
      ctx.ellipse(oval.cx, oval.cy, oval.rx + 10, oval.ry + 10, 0, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
      ctx.stroke();
    }

    if (this.debugOn && analysis) this.drawDebugShapes(analysis);
  }

  drawDebugShapes(a) {
    const { viewW: W, viewH: H, ctx } = this;
    const map = (p) => {
      const v = videoToView(p.x, p.y, a.transform, a.mirrored);
      return [v.x * W, v.y * H];
    };

    // Các khuôn mặt phụ (nếu có): chỉ vẽ khung
    ctx.lineWidth = 2;
    a.boxes.forEach((b, i) => {
      if (i === a.primary) return;
      ctx.strokeStyle = a.significant.includes(i) ? '#ef4444' : '#64748b';
      ctx.strokeRect(b.minX * W, b.minY * H, b.w * W, b.h * H);
    });

    if (a.landmarks) {
      // Landmark
      ctx.fillStyle = 'rgba(56, 189, 248, 0.85)';
      for (let i = 0; i < a.landmarks.length; i++) {
        const [x, y] = map(a.landmarks[i]);
        ctx.fillRect(x - 1, y - 1, 2, 2);
      }
      // Đường viền khuôn mặt
      ctx.strokeStyle = '#a3e635';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      FACE_OVAL_INDICES.forEach((idx, i) => {
        const [x, y] = map(a.landmarks[idx]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.stroke();
    }

    if (a.box) {
      const b = a.box;
      ctx.strokeStyle = '#22d3ee';
      ctx.lineWidth = 2;
      ctx.strokeRect(b.minX * W, b.minY * H, b.w * W, b.h * H);
      // Tâm mặt
      ctx.fillStyle = '#22d3ee';
      ctx.beginPath();
      ctx.arc(b.cx * W, b.cy * H, 5, 0, Math.PI * 2);
      ctx.fill();
      // Tâm placeholder
      const ox = a.oval.cx;
      const oy = a.oval.cy;
      ctx.strokeStyle = '#e879f9';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(ox - 9, oy);
      ctx.lineTo(ox + 9, oy);
      ctx.moveTo(ox, oy - 9);
      ctx.lineTo(ox, oy + 9);
      ctx.stroke();
      // Sai lệch
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.lineTo(b.cx * W, b.cy * H);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // ------------------------------------------------------------------ chip, thông báo, nút

  setChips(geo, live) {
    const c = this.cache;
    if (geo.label !== c.geo || geo.tone !== c.geoTone) {
      this.el.chipGeo.className = `chip chip--${geo.tone}`;
      this.el.chipGeo.lastElementChild.textContent = geo.label;
      c.geo = geo.label;
      c.geoTone = geo.tone;
    }
    if (live.label !== c.live || live.tone !== c.liveTone) {
      this.el.chipLive.className = `chip chip--${live.tone}`;
      this.el.chipLive.lastElementChild.textContent = live.label;
      c.live = live.label;
      c.liveTone = live.tone;
    }
  }

  /** Đổi nội dung thông báo tối đa mỗi `guidanceHoldMs`; khoá gọi mỗi frame nên thông báo đích luôn được áp dụng sau đó. */
  setGuidance(key, tone, now, { livenessEnabled = false } = {}) {
    const g = this.shownGuidance;
    if (key === g.key) {
      if (tone !== g.tone) {
        this.el.guidance.className = `guidance guidance--${tone}`;
        g.tone = tone;
      }
      return;
    }
    if (g.key !== null && now - g.at < this.cfg.ui.guidanceHoldMs) return;
    const msg = MESSAGES[key] || { main: '' };
    this.el.guidanceMain.textContent = msg.main;
    const sub = (livenessEnabled && msg.subWithLiveness) || msg.sub || '';
    this.el.guidanceSub.textContent = sub;
    this.el.guidanceSub.hidden = !sub;
    this.el.guidance.className = `guidance guidance--${tone}`;
    this.shownGuidance = { key, tone, at: now };
  }

  resetGuidance() {
    this.shownGuidance = { key: null, tone: null, at: -Infinity };
    this.shownTone = { tone: 'gray', candidate: 'gray', candidateSince: 0 };
  }

  setChallengeTimer(ms) {
    const text = ms == null ? '' : `${secondsLeft(ms)}s`;
    if (text === this.cache.timer) return;
    this.cache.timer = text;
    this.el.timer.hidden = !text;
    this.el.timer.textContent = text;
  }

  setPerfNotice(show) {
    this.el.perfNotice.hidden = !show;
  }

  setCaptureEnabled(enabled) {
    const b = this.el.btnCapture;
    if (b.disabled === !enabled) return;
    b.disabled = !enabled;
    b.setAttribute('aria-disabled', String(!enabled));
  }

  setRetryLivenessVisible(visible) {
    this.el.btnRetryLiveness.hidden = !visible;
  }

  // ------------------------------------------------------------------ debug

  setDebug(on) {
    this.debugOn = !!on;
    this.el.debugPanel.hidden = !this.debugOn;
    this.el.btnDebug.setAttribute('aria-pressed', String(this.debugOn));
    this.cache.debugAt = -Infinity;
    if (!this.debugOn) this.el.debugPanel.textContent = '';
  }

  /** Cập nhật bảng kỹ thuật tối đa mỗi `debugRefreshMs` để không làm nặng giao diện. */
  renderDebug(text, now) {
    if (!this.debugOn) return;
    if (now - this.cache.debugAt < this.cfg.ui.debugRefreshMs) return;
    this.cache.debugAt = now;
    if (text !== this.cache.debug) {
      this.el.debugPanel.textContent = text;
      this.cache.debug = text;
    }
  }

  dispose() {
    this.resizeObserver.disconnect();
  }
}
