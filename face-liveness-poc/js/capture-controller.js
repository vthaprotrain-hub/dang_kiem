/**
 * capture-controller.js — Điều kiện cho phép chụp (`canCapture`) và xử lý ảnh chụp.
 *
 * `canCapture` là NGUỒN SỰ THẬT DUY NHẤT cho nút chụp: UI chỉ phản chiếu kết quả của hàm này, và
 * `CaptureController.capture` gọi lại nó ngay trước khi lấy ảnh.
 */

import { FaceState } from './geometry-validator.js';
import { LivenessState } from './liveness.js';

/**
 * @param {object} s
 * @param {object|null} s.analysis   kết quả analyzeFrame
 * @param {{ready:boolean, ok:boolean, brightnessOk:boolean, sharpnessOk:boolean}|null} s.qualityEval
 * @param {{stable:boolean, stableMs:number, motionOk:boolean}|null} s.stability
 * @param {object|null} s.liveness   instance LivenessChallenge
 * @param {number} s.now             timestamp hiện tại (ms)
 * @param {boolean} s.cameraRunning
 * @param {object} cfg               CONFIG
 * @returns {{ok:boolean, reasons:string[]}}  `reasons` rỗng khi ok; dùng cho chế độ kỹ thuật
 */
export function canCapture(s, cfg) {
  const reasons = [];
  const a = s.analysis;

  if (!s.cameraRunning) reasons.push('Camera chưa chạy');
  if (!a) {
    reasons.push('Chưa có kết quả phân tích');
    return { ok: false, reasons };
  }
  if (s.now - a.ts > cfg.capture.maxAnalysisAgeMs) reasons.push('Kết quả phân tích đã cũ');

  if (a.faceState === FaceState.NO_FACE) reasons.push('Không có khuôn mặt');
  else if (a.faceState === FaceState.MULTIPLE_FACES) reasons.push('Có nhiều hơn một khuôn mặt');
  else {
    if (!a.rules.position) reasons.push('Tâm mặt lệch khỏi vùng cho phép');
    if (!a.rules.scale) reasons.push('Tỷ lệ khuôn mặt chưa đạt');
    if (!a.rules.pose) reasons.push('Góc mặt chưa đạt');
  }

  const q = s.qualityEval;
  if (!q || !q.ready) reasons.push('Chưa đo được chất lượng ảnh');
  else {
    if (!q.brightnessOk) reasons.push('Độ sáng chưa đạt');
    if (!q.sharpnessOk) reasons.push('Độ nét chưa đạt');
  }

  if (!s.stability || !s.stability.stable) {
    const ms = s.stability ? Math.round(s.stability.stableMs) : 0;
    reasons.push(`Chưa ổn định đủ ${cfg.stability.requiredMs} ms (hiện ${ms} ms)`);
  } else if (!s.stability.motionOk) {
    reasons.push('Chuyển động quá nhanh');
  }

  if (cfg.liveness.enabled) {
    const l = s.liveness;
    if (!l || l.state !== LivenessState.CHALLENGE_PASSED) {
      reasons.push(`Thử thách cơ bản chưa hoàn thành (${l ? l.state : 'N/A'})`);
    } else if (!l.isValid(s.now)) {
      reasons.push('Kết quả thử thách đã hết hạn');
    }
  }

  return { ok: reasons.length === 0, reasons };
}

export class CaptureController {
  /**
   * @param {HTMLVideoElement} video
   * @param {object} cfg  CONFIG
   */
  constructor(video, cfg) {
    this.video = video;
    this.cfg = cfg;
    this.canvas = document.createElement('canvas');
    this.currentUrl = null;
  }

  /**
   * Chụp frame hiện tại.
   * @param {()=>object} getState  trả về tham số của `canCapture` TẠI THỜI ĐIỂM GỌI (kiểm tra lại)
   * @param {{force?:boolean, mirrored?:boolean}} [opts]  force: chế độ thủ công, bỏ qua canCapture
   * @returns {Promise<{blob:Blob, url:string, width:number, height:number, mimeType:string, validated:boolean, capturedAt:number}>}
   */
  async capture(getState, opts = {}) {
    const verdict = canCapture(getState(), this.cfg);
    if (!verdict.ok && !opts.force) {
      const err = new Error('Điều kiện chụp không còn đạt.');
      err.reasons = verdict.reasons;
      throw err;
    }
    const v = this.video;
    if (!v.videoWidth || v.readyState < 2) throw new Error('Video chưa sẵn sàng.');

    const { maxLongSide, mimeType, quality, mirrorSavedImage } = this.cfg.capture;
    const longSide = Math.max(v.videoWidth, v.videoHeight);
    const k = longSide > maxLongSide ? maxLongSide / longSide : 1;
    const w = Math.round(v.videoWidth * k);
    const h = Math.round(v.videoHeight * k);
    this.canvas.width = w;
    this.canvas.height = h;
    const ctx = this.canvas.getContext('2d');
    ctx.save();
    if (mirrorSavedImage && opts.mirrored) {
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(v, 0, 0, w, h);
    ctx.restore();

    const blob = await new Promise((resolve) => this.canvas.toBlob(resolve, mimeType, quality));
    if (!blob) throw new Error('Không tạo được ảnh từ canvas.');
    this.release();
    this.currentUrl = URL.createObjectURL(blob);
    return {
      blob,
      url: this.currentUrl,
      width: w,
      height: h,
      mimeType: blob.type || mimeType,
      validated: verdict.ok,
      capturedAt: Date.now(),
    };
  }

  /** Thu hồi object URL của ảnh hiện tại và xoá nội dung canvas. */
  release() {
    if (this.currentUrl) {
      URL.revokeObjectURL(this.currentUrl);
      this.currentUrl = null;
    }
  }

  dispose() {
    this.release();
    this.canvas.width = this.canvas.height = 0;
  }
}
