/**
 * app.js — Khởi tạo và điều phối: camera → suy luận → kiểm tra → liveness → UI → chụp.
 *
 * Luồng dữ liệu mỗi frame (chỉ khi có frame video MỚI và đã qua khoảng giãn cách tối thiểu):
 *   FaceLandmarker (MediaPipe) → analyzeFrame (hình học) → FaceQualitySampler (sáng/nét)
 *   → StabilityTracker (ổn định theo timestamp) → LivenessChallenge → canCapture → UI.
 *
 * Quyền riêng tư: không có fetch/upload nào trong ứng dụng; video, landmark và ảnh chỉ nằm trong bộ nhớ
 * của trang. Ảnh chỉ được tải xuống khi người dùng bấm nút tải.
 */

import { CONFIG } from './config.js';
import { CameraController, CameraError, CameraErrorCode, checkCameraSupport } from './camera.js';
import { FaceLandmarkerEngine, EngineError } from './face-landmarker.js';
import { analyzeFrame, StabilityTracker, YawSignCalibrator, FaceState } from './geometry-validator.js';
import { FaceQualitySampler, evaluateQuality } from './quality-validator.js';
import { LivenessChallenge, LivenessState, computeEAR } from './liveness.js';
import { canCapture, CaptureController } from './capture-controller.js';
import { UIController, resolveGuidance, resolveGeoStatus, resolveLivenessStatus, secondsLeft } from './ui-controller.js';

const now = () => performance.now();

class App {
  constructor() {
    this.ui = new UIController(CONFIG);
    this.video = document.getElementById('video');
    this.camera = new CameraController(this.video, CONFIG.camera, { onEnded: () => this.onCameraEnded() });
    this.engine = new FaceLandmarkerEngine(CONFIG);
    this.quality = new FaceQualitySampler(CONFIG.quality);
    this.tracker = new StabilityTracker(CONFIG.stability);
    this.calibrator = new YawSignCalibrator();
    this.liveness = new LivenessChallenge(CONFIG.liveness);
    this.capture = new CaptureController(this.video, CONFIG);

    this.sessionActive = false; // đang ở màn hình camera/preview của một phiên
    this.manualMode = false;
    this.cancelFrame = null;
    this.staleTimer = null;
    this.recovering = false;
    this.resumeAfterVisible = false;
    this.lastCapture = null;
    this.confirmedShot = null;
    this.resetRuntime();
  }

  // ------------------------------------------------------------------------------ khởi tạo

  init() {
    this.ui.bind({
      onStart: () => this.startSession(),
      onClose: () => this.closeSession(),
      onSwitchCamera: () => this.switchCamera(),
      onCapture: () => this.takePhoto(),
      onDebugToggle: () => {},
      onRetryLiveness: () => this.retryLiveness(),
      onRetake: () => this.retake(),
      onConfirm: () => this.confirmPhoto(),
      onDownload: () => this.downloadPhoto(),
      onAgain: () => this.startSession(),
      onErrorRetry: () => this.startSession({ manual: this.manualMode }),
      onErrorManual: () => this.startSession({ manual: true }),
      onErrorBack: () => this.closeSession(),
    });
    this.ui.setDebug(CONFIG.ui.startWithDebug);

    const problem = checkCameraSupport();
    if (problem) {
      this.ui.setEnvWarning(problem.message);
      document.getElementById('btn-start').disabled = true;
    }

    document.addEventListener('visibilitychange', () => this.onVisibility());
    window.addEventListener('pagehide', () => this.shutdown());
    if (CONFIG.ui.startWithDebug) window.__poc = { app: this, CONFIG };
  }

  resetRuntime() {
    this.analysis = null;
    this.qualityMetrics = null;
    this.qualityEval = evaluateQuality(null, CONFIG.quality);
    this.stability = this.tracker.snapshot();
    this.capState = { ok: false, reasons: ['Chưa có kết quả phân tích'] };
    this.noFaceSince = null;
    this.passedFaceLostSince = null;
    this.lastEar = null;
    this.lastInferenceTs = -Infinity;
    this.lastFrameTs = null;
    this.fps = 0;
    this.avgInferenceMs = 0;
    this.intervalMs = CONFIG.performance.inferenceIntervalMs;
    this.lowPerf = false;
    this.consecutiveErrors = 0;
    this.tracker.reset();
    this.quality.reset();
    this.liveness.reset();
    this.ui.resetGuidance();
    this.ui.setCaptureEnabled(false);
    this.ui.setRetryLivenessVisible(false);
    this.ui.setChallengeTimer(null);
    this.ui.setPerfNotice(false);
    this.ui.clearOverlay();
  }

  // ------------------------------------------------------------------------------ phiên chụp

  async startSession({ manual = false } = {}) {
    this.manualMode = manual;
    this.stopLoop();
    this.releaseConfirmed();
    this.ui.setLoading('Đang xin quyền camera…');
    this.ui.showScreen('loading');

    const cameraP = this.camera.start();
    const engineP = manual
      ? Promise.resolve()
      : this.engine.init((msg) => this.ui.setLoading(msg));
    const [camRes, engRes] = await Promise.allSettled([cameraP, engineP]);

    if (camRes.status === 'rejected') {
      this.camera.stop();
      this.showCameraError(camRes.reason);
      return;
    }
    if (engRes.status === 'rejected') {
      this.camera.stop();
      this.showEngineError(engRes.reason);
      return;
    }

    this.sessionActive = true;
    this.ui.setMirrored(this.camera.mirrored);
    this.ui.setSwitchVisible(this.camera.canSwitch);
    this.ui.showScreen('camera');
    this.beginAnalysis();
  }

  beginAnalysis() {
    this.resetRuntime();
    if (this.manualMode) {
      this.ui.setChips(
        { tone: 'gray', label: 'Hình học: không kiểm tra' },
        { tone: 'gray', label: 'Liveness: không kiểm tra' }
      );
      this.ui.setGuidance('MANUAL_MODE', 'yellow', now());
      this.ui.drawOverlay({ analysis: null, tone: 'yellow', progress: 0, now: now() });
      this.ui.renderDebug('Chế độ chụp thủ công: không có phân tích khuôn mặt, không có kiểm tra điều kiện.', now());
      this.ui.setCaptureEnabled(true);
      return;
    }
    this.cancelFrame = this.camera.onFrame((t) => this.onVideoFrame(t));
    // Nếu không còn frame mới (video đứng hình), khoá nút chụp thay vì để trạng thái cũ.
    this.staleTimer = setInterval(() => {
      const a = this.analysis;
      if (!a || now() - a.ts > CONFIG.capture.maxAnalysisAgeMs) this.ui.setCaptureEnabled(false);
    }, 200);
  }

  stopLoop() {
    if (this.cancelFrame) this.cancelFrame();
    this.cancelFrame = null;
    if (this.staleTimer) clearInterval(this.staleTimer);
    this.staleTimer = null;
  }

  /** Đóng phiên: dừng camera và giải phóng tài nguyên của phiên; model vẫn được giữ để mở lại nhanh. */
  closeSession() {
    this.stopLoop();
    this.camera.stop();
    this.capture.release();
    this.ui.clearPreview();
    this.sessionActive = false;
    this.lastCapture = null;
    this.releaseConfirmed();
    this.resetRuntime();
    this.ui.showScreen('intro');
  }

  /** Giải phóng toàn bộ khi rời trang. */
  shutdown() {
    this.stopLoop();
    this.camera.stop();
    this.capture.dispose();
    this.engine.dispose();
    this.releaseConfirmed();
  }

  onVisibility() {
    if (document.hidden) {
      if (this.sessionActive && this.camera.running && !this.lastCapture) {
        this.resumeAfterVisible = true;
        this.stopLoop();
        this.camera.stop();
      }
    } else if (this.resumeAfterVisible) {
      this.resumeAfterVisible = false;
      this.restartCamera();
    }
  }

  async restartCamera() {
    try {
      await this.camera.start();
      this.ui.setMirrored(this.camera.mirrored);
      this.beginAnalysis();
    } catch (err) {
      this.showCameraError(err);
    }
  }

  onCameraEnded() {
    if (!this.sessionActive || this.lastCapture || this.resumeAfterVisible) return;
    this.stopLoop();
    this.showCameraError(new CameraError(CameraErrorCode.IN_USE, 'Camera đã bị ngắt kết nối.'));
  }

  async switchCamera() {
    this.stopLoop();
    this.ui.setCaptureEnabled(false);
    try {
      await this.camera.switchCamera();
      this.calibrator.reset();
      this.ui.setMirrored(this.camera.mirrored);
      this.ui.setSwitchVisible(this.camera.canSwitch);
      this.beginAnalysis();
    } catch (err) {
      this.showCameraError(err);
    }
  }

  // ------------------------------------------------------------------------------ vòng lặp xử lý

  onVideoFrame(t) {
    if (this.recovering || !this.video.videoWidth) return;
    // Giới hạn tần suất, bỏ qua frame thừa. Dung sai 20% để không bị "alias" (vd. video 30 fps + giãn cách 40 ms → chỉ xử lý 15 fps).
    if (t - this.lastInferenceTs < this.intervalMs * 0.8) return;
    this.lastInferenceTs = t;

    let det;
    try {
      det = this.engine.detect(this.video, t);
      this.consecutiveErrors = 0;
    } catch (err) {
      this.onInferenceError(err);
      return;
    }

    if (this.lastFrameTs != null) {
      const dt = t - this.lastFrameTs;
      if (dt > 0) this.fps = this.fps ? this.fps * 0.9 + (1000 / dt) * 0.1 : 1000 / dt;
    }
    this.lastFrameTs = t;
    this.trackPerformance(det.inferenceMs);

    const { viewW, viewH } = this.ui.getViewSize();
    const analysis = analyzeFrame(
      det.result,
      {
        videoW: this.video.videoWidth,
        videoH: this.video.videoHeight,
        viewW,
        viewH,
        mirrored: this.camera.mirrored,
        ts: t,
      },
      CONFIG,
      this.calibrator
    );
    this.processAnalysis(analysis, t);
  }

  trackPerformance(ms) {
    const p = CONFIG.performance;
    this.avgInferenceMs = this.avgInferenceMs ? this.avgInferenceMs * 0.9 + ms * 0.1 : ms;
    const slow = this.avgInferenceMs > p.lowPerfInferenceMs;
    this.intervalMs = slow
      ? Math.max(p.inferenceIntervalMs, this.avgInferenceMs * p.lowPerfIntervalFactor)
      : p.inferenceIntervalMs;
    if (slow !== this.lowPerf) {
      this.lowPerf = slow;
      this.ui.setPerfNotice(slow);
    }
  }

  async onInferenceError(err) {
    this.consecutiveErrors++;
    if (this.consecutiveErrors < 3 || this.recovering) return;
    this.recovering = true;
    this.ui.setCaptureEnabled(false);
    const switched = await this.engine.fallbackToCpu();
    this.recovering = false;
    this.consecutiveErrors = 0;
    if (!switched) {
      this.stopLoop();
      this.camera.stop();
      this.showEngineError(
        err instanceof EngineError ? err : new EngineError('INFERENCE_FAILED', err && err.message ? err.message : 'Suy luận thất bại.')
      );
    }
  }

  processAnalysis(a, t) {
    this.analysis = a;
    const single = a.faceState === FaceState.FACE_DETECTED;
    const L = this.liveness;
    const livenessOn = CONFIG.liveness.enabled;

    // --- thời gian không có mặt
    if (a.faceState === FaceState.NO_FACE) this.noFaceSince ??= t;
    else this.noFaceSince = null;
    const noFaceMs = this.noFaceSince == null ? 0 : t - this.noFaceSince;

    // --- chất lượng ảnh
    if (single) {
      this.qualityMetrics = this.quality.sample(this.video, a.rawBox, t);
    } else {
      if (noFaceMs > 1000) this.quality.reset();
      this.qualityMetrics = this.quality.current(t);
    }
    this.qualityEval = single
      ? evaluateQuality(this.qualityMetrics, CONFIG.quality)
      : evaluateQuality(null, CONFIG.quality);

    // --- liveness: cập nhật mẫu nếu đang chạy thử thách
    this.lastEar = single ? computeEAR(a.landmarks, this.video.videoWidth / this.video.videoHeight) : null;
    if (livenessOn && L.active) {
      L.update(
        {
          faceOk: single,
          ear: this.lastEar ? this.lastEar.mean : null,
          yaw: single && a.pose.valid ? a.pose.yaw : null,
          frontalOk: single && a.poseEval.ok,
        },
        t
      );
    }

    // --- ổn định (chỉ khi KHÔNG đang thử thách: lúc đó các quy tắc góc bị tạm hoãn có chủ đích)
    const rulesOk = single && a.geometryOk && this.qualityEval.ok;
    let stab;
    if (livenessOn && L.active) {
      this.tracker.reset();
      stab = this.tracker.snapshot();
    } else {
      stab = this.tracker.update(t, single ? a : null, rulesOk);
    }

    // --- bắt đầu thử thách khi mọi điều kiện đã ổn định
    if (livenessOn && L.state === LivenessState.IDLE && single && stab.stable) {
      L.start(t);
      this.tracker.reset();
      stab = this.tracker.snapshot();
    }

    // --- hết hạn / đổi người
    if (livenessOn) this.guardLivenessResult(a, t, noFaceMs);

    this.stability = stab;

    // --- điều kiện chụp
    this.capState = canCapture(this.captureInput(t), CONFIG);

    // --- UI
    const s = {
      analysis: a,
      qualityEval: this.qualityEval,
      stability: stab,
      liveness: L,
      livenessEnabled: livenessOn,
      canCapture: this.capState.ok,
      noFaceMs,
    };
    const guidance = resolveGuidance(s);
    const geo = resolveGeoStatus(s);
    const live = resolveLivenessStatus(s, t);

    this.ui.drawOverlay({
      analysis: a,
      tone: geo.tone,
      progress: rulesOk && !stab.stable ? stab.progress : 0,
      now: t,
    });
    this.ui.setChips(geo, live);
    this.ui.setGuidance(guidance.key, guidance.tone, t, { livenessEnabled: livenessOn });
    this.ui.setCaptureEnabled(this.capState.ok);
    this.ui.setRetryLivenessVisible(livenessOn && L.state === LivenessState.LIVENESS_INCONCLUSIVE);
    this.ui.setChallengeTimer(livenessOn && L.active ? L.remainingMs(t) : null);
    if (this.ui.debugOn) this.ui.renderDebug(this.buildDebugText(t, noFaceMs), t);
  }

  /** Kết quả thử thách chỉ có giá trị ngắn hạn và chỉ khi khuôn mặt không biến mất (chống "hoàn thành rồi đổi người"). */
  guardLivenessResult(a, t, noFaceMs) {
    const L = this.liveness;
    const cfg = CONFIG.liveness;
    const single = a.faceState === FaceState.FACE_DETECTED;
    if (L.state === LivenessState.CHALLENGE_PASSED) {
      if (!L.isValid(t)) {
        L.reset();
        return;
      }
      if (single) this.passedFaceLostSince = null;
      else {
        this.passedFaceLostSince ??= t;
        if (t - this.passedFaceLostSince > cfg.passedFaceLostResetMs) {
          L.reset();
          this.passedFaceLostSince = null;
        }
      }
    } else if (L.state === LivenessState.LIVENESS_INCONCLUSIVE && noFaceMs > cfg.inconclusiveResetAfterNoFaceMs) {
      L.reset();
    }
  }

  retryLiveness() {
    this.liveness.reset();
    this.tracker.reset();
    this.ui.setRetryLivenessVisible(false);
  }

  captureInput(t) {
    return {
      analysis: this.analysis,
      qualityEval: this.qualityEval,
      stability: this.stability,
      liveness: this.liveness,
      now: t,
      cameraRunning: this.camera.running,
    };
  }

  // ------------------------------------------------------------------------------ chụp ảnh

  async takePhoto() {
    try {
      const shot = await this.capture.capture(() => this.captureInput(now()), {
        force: this.manualMode,
        mirrored: this.camera.mirrored,
      });
      this.lastCapture = shot;
      this.stopLoop();
      this.ui.setCaptureEnabled(false);
      this.ui.showPreview({
        url: shot.url,
        note: shot.validated
          ? 'Ảnh đã đạt các điều kiện chụp của POC. Đây chưa phải xác minh danh tính hoặc người thật.'
          : 'Chụp thủ công: ảnh CHƯA qua kiểm tra tự động.',
      });
    } catch (err) {
      // Điều kiện không còn đạt (hoặc lỗi canvas): khoá nút; thông báo hướng dẫn sẽ tự cập nhật ở frame kế tiếp.
      this.ui.setCaptureEnabled(false);
      if (err && err.reasons) console.info('Chụp bị chặn:', err.reasons.join('; '));
      else console.warn('Không chụp được:', err && err.message);
    }
  }

  retake() {
    this.capture.release();
    this.ui.clearPreview();
    this.lastCapture = null;
    this.ui.showScreen('camera');
    if (this.camera.running) this.beginAnalysis();
    else this.restartCamera();
  }

  confirmPhoto() {
    const shot = this.lastCapture;
    if (!shot) return;
    this.confirmedShot = shot;
    this.lastCapture = null;
    this.stopLoop();
    this.camera.stop();
    this.sessionActive = false;
    this.ui.clearPreview();
    // Thông báo cho trang chủ (nếu nhúng) — KHÔNG upload. Người tích hợp tự quyết định bước tiếp theo.
    window.dispatchEvent(
      new CustomEvent('face-capture:confirmed', {
        detail: {
          blob: shot.blob,
          width: shot.width,
          height: shot.height,
          mimeType: shot.mimeType,
          validated: shot.validated,
          capturedAt: shot.capturedAt,
        },
      })
    );
    this.ui.showScreen('done');
  }

  downloadPhoto() {
    const shot = this.lastCapture || this.confirmedShot;
    if (!shot) return;
    const ext = shot.mimeType === 'image/webp' ? 'webp' : 'jpg';
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const a = document.createElement('a');
    a.href = shot.url;
    a.download = `face-capture-${stamp}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  releaseConfirmed() {
    if (this.confirmedShot) {
      this.capture.release();
      this.confirmedShot = null;
    }
  }

  // ------------------------------------------------------------------------------ lỗi

  showCameraError(err) {
    let title = 'Không mở được camera';
    let message = (err && err.message) || 'Lỗi không xác định.';
    switch (err && err.code) {
      case CameraErrorCode.PERMISSION_DENIED:
        title = 'Chưa được cấp quyền camera';
        message =
          'Bạn đã từ chối quyền camera. Hãy cho phép camera cho trang này trong cài đặt trình duyệt, rồi bấm “Thử lại”.';
        break;
      case CameraErrorCode.NO_CAMERA:
        title = 'Không tìm thấy camera';
        message = 'Thiết bị không có camera phù hợp hoặc camera đang bị tắt. Hãy kết nối camera rồi bấm “Thử lại”.';
        break;
      case CameraErrorCode.IN_USE:
        title = 'Không thể dùng camera';
        message = `${message} Hãy đóng ứng dụng khác đang dùng camera rồi thử lại.`;
        break;
      case CameraErrorCode.INSECURE_CONTEXT:
        title = 'Môi trường không hỗ trợ camera';
        break;
      case CameraErrorCode.UNSUPPORTED:
        title = 'Không thể mở camera';
        break;
      default:
    }
    this.sessionActive = false;
    this.ui.showError({ title, message, details: err && err.cause ? String(err.cause) : '' });
  }

  showEngineError(err) {
    const lines = [];
    if (err && err.attempts) {
      for (const a of err.attempts) lines.push(`• ${a.source}: ${(a.error && a.error.message) || a.error}`);
    } else if (err) {
      lines.push(String(err.message || err));
    }
    const isLib = err && err.code === 'LIB_LOAD_FAILED';
    this.sessionActive = false;
    this.ui.showError({
      title: isLib ? 'Không tải được thư viện nhận diện' : 'Không khởi tạo được mô hình nhận diện',
      message:
        (isLib
          ? 'Không tải được thư viện MediaPipe (kiểm tra kết nối mạng hoặc cấu hình self-host).'
          : 'Không tải hoặc chạy được mô hình khuôn mặt (kiểm tra mạng, WebGL/GPU hoặc cấu hình self-host).') +
        ' Bạn có thể thử lại' +
        (CONFIG.allowManualFallback ? ' hoặc chụp thủ công (ảnh sẽ không được kiểm tra).' : '.'),
      details: lines.join('\n'),
      allowManual: CONFIG.allowManualFallback,
    });
  }

  // ------------------------------------------------------------------------------ chế độ kỹ thuật

  buildDebugText(t, noFaceMs) {
    const a = this.analysis;
    const q = this.qualityMetrics;
    const qe = this.qualityEval;
    const st = this.stability;
    const L = this.liveness;
    const tick = (v) => (v ? '✓' : '✗');
    const f = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '—');
    const sg = (v, d = 1) => (Number.isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(d) : '—');
    const lines = [];

    lines.push(
      `FPS xử lý ${f(this.fps, 1)} | suy luận ${f(this.avgInferenceMs, 1)}ms | giãn cách ${Math.round(this.intervalMs)}ms | ${this.engine.delegate || '—'}`
    );
    lines.push(`Nguồn: lib=${this.engine.libSource || '—'} model=${this.engine.modelSource || '—'}`);

    if (!a) {
      lines.push('Chưa có kết quả phân tích.');
    } else {
      lines.push(
        `Khuôn mặt: ${a.faceState} (phát hiện ${a.faceCount}, đáng kể ${a.significantFaceCount})${a.faceState === FaceState.NO_FACE ? ` ${Math.round(noFaceMs)}ms` : ''}`
      );
      lines.push(`Video ${a.transform.videoW}×${a.transform.videoH} → view ${Math.round(a.transform.viewW)}×${Math.round(a.transform.viewH)} | mirror ${a.mirrored}`);
      if (a.box) {
        const cfgP = CONFIG.position;
        lines.push(`Tâm mặt (${f(a.box.cx, 3)}, ${f(a.box.cy, 3)}) | tâm khung (${f(a.oval.ncx, 3)}, ${f(a.oval.ncy, 3)})`);
        lines.push(
          `Sai lệch dx ${sg(a.position.dx, 3)} (≤${cfgP.maxOffsetX}) ${tick(a.position.okX)} | dy ${sg(a.position.dy, 3)} (≤${cfgP.maxOffsetY}) ${tick(a.position.okY)}`
        );
        lines.push(`Tỷ lệ mặt ${f(a.scale.ratio, 3)} (${CONFIG.scale.min}–${CONFIG.scale.max}) ${tick(a.scale.ok)}`);
        const p = a.pose;
        lines.push(
          `Góc [${p.source}] yaw ${sg(p.yaw)}° ${tick(a.poseEval.yawOk)} | pitch ${sg(p.pitch)}° ${tick(a.poseEval.pitchOk)} | roll ${sg(p.roll)}° ${tick(a.poseEval.rollOk)}`
        );
        lines.push(
          `  ngưỡng ${CONFIG.pose.maxYaw}/${CONFIG.pose.maxPitch}/${CONFIG.pose.maxRoll}° | yaw(landmark) ${sg(p.landmarkYaw)}° | dấu yaw ${p.yawSignConfident ? 'đã hiệu chuẩn' : 'theo landmark'}${p.conflict ? ' | ⚠ ma trận/landmark lệch nhau' : ''}`
        );
      }
    }

    lines.push(
      `Độ sáng ${f(q && q.brightness, 1)} (${CONFIG.quality.minBrightness}–${CONFIG.quality.maxBrightness}) ${tick(qe.brightnessOk)} | độ nét ${f(q && q.sharpness, 1)} (≥${CONFIG.quality.minSharpness}) ${tick(qe.sharpnessOk)}${qe.ready ? '' : ' (chưa sẵn sàng)'}`
    );
    lines.push(
      `Ổn định ${Math.round(st.stableMs)}/${CONFIG.stability.requiredMs}ms | tốc độ ${f(st.smoothedSpeed)} (≤${CONFIG.stability.maxSmoothedSpeed}) tức thời ${f(st.instantSpeed)} (≤${CONFIG.stability.maxInstantSpeed}) ${tick(st.motionOk)}`
    );

    if (a) {
      const r = a.rules;
      lines.push(
        `Rule: 1 mặt ${tick(r.singleFace)} | vị trí ${tick(r.position)} | tỷ lệ ${tick(r.scale)} | góc ${tick(r.pose)} | chất lượng ${tick(qe.ok)} | ổn định ${tick(st.stable)} | liveness ${tick(!CONFIG.liveness.enabled || L.state === LivenessState.CHALLENGE_PASSED)}`
      );
    }

    const snap = L.snapshot(t);
    lines.push(
      `Liveness: ${CONFIG.liveness.enabled ? snap.state : 'TẮT'}${snap.type ? ` | ${snap.type} (${snap.step}${snap.phase ? ' ' + snap.phase : ''})` : ''}${snap.reason ? ` | lý do: ${snap.reason}` : ''}`
    );
    lines.push(
      `  EAR hiện ${f(this.lastEar && this.lastEar.mean, 3)} | EAR nền ${f(snap.baselineEar, 3)} | còn ${snap.remainingMs == null ? '—' : secondsLeft(snap.remainingMs) + 's'}${snap.wrongDirection ? ' | SAI HƯỚNG' : ''}`
    );
    const last = L.events.slice(-3).map((e) => `${e.name}${e.reason ? ':' + e.reason : ''}`);
    if (last.length) lines.push(`  sự kiện: ${last.join(' → ')}`);

    lines.push(
      this.capState.ok ? 'Nút chụp: MỞ' : `Nút chụp: KHOÁ — ${this.capState.reasons.slice(0, 3).join('; ')}${this.capState.reasons.length > 3 ? '…' : ''}`
    );
    return lines.join('\n');
  }
}

const app = new App();
app.init();
