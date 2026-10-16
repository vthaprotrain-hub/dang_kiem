/**
 * camera.js — Xin quyền, mở, dừng và chuyển camera (getUserMedia / MediaDevices).
 * Video chỉ được gắn vào thẻ <video> cục bộ; không có luồng nào được gửi đi đâu cả.
 */

export const CameraErrorCode = Object.freeze({
  INSECURE_CONTEXT: 'INSECURE_CONTEXT',
  UNSUPPORTED: 'UNSUPPORTED',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  NO_CAMERA: 'NO_CAMERA',
  IN_USE: 'IN_USE',
  UNKNOWN: 'UNKNOWN',
});

export class CameraError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = 'CameraError';
    this.code = code;
    this.cause = cause;
  }
}

/** Kiểm tra môi trường trước khi xin quyền. Trả về null nếu ổn, ngược lại là CameraError. */
export function checkCameraSupport() {
  if (!window.isSecureContext) {
    return new CameraError(
      CameraErrorCode.INSECURE_CONTEXT,
      'Trang đang chạy không qua HTTPS nên trình duyệt chặn camera. Hãy mở bằng HTTPS hoặc http://localhost.'
    );
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return new CameraError(
      CameraErrorCode.UNSUPPORTED,
      'Trình duyệt này không hỗ trợ truy cập camera (getUserMedia).'
    );
  }
  return null;
}

function mapMediaError(err) {
  const name = err && err.name;
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
    return new CameraError(CameraErrorCode.PERMISSION_DENIED, 'Bạn đã từ chối quyền truy cập camera.', err);
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
    return new CameraError(CameraErrorCode.NO_CAMERA, 'Không tìm thấy camera phù hợp trên thiết bị.', err);
  }
  if (name === 'NotSupportedError') {
    return new CameraError(
      CameraErrorCode.UNSUPPORTED,
      'Trình duyệt không cho phép mở camera trong ngữ cảnh này (quyền camera bị chặn hoặc cấu hình không được hỗ trợ).',
      err
    );
  }
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') {
    return new CameraError(CameraErrorCode.IN_USE, 'Không thể mở camera. Có thể ứng dụng khác đang dùng camera.', err);
  }
  return new CameraError(CameraErrorCode.UNKNOWN, `Lỗi camera: ${(err && err.message) || name || 'không xác định'}`, err);
}

export class CameraController {
  /**
   * @param {HTMLVideoElement} video
   * @param {{facingMode:string, idealWidth:number, idealHeight:number}} cfg
   * @param {{onEnded?:()=>void}} [hooks]
   */
  constructor(video, cfg, hooks = {}) {
    this.video = video;
    this.cfg = cfg;
    this.hooks = hooks;
    this.stream = null;
    this.facingMode = cfg.facingMode; // 'user' | 'environment'
    this.deviceId = null;
    this.devices = [];
    this.hasFacingModeSetting = false;
  }

  get running() {
    return !!this.stream && this.stream.getVideoTracks().some((t) => t.readyState === 'live');
  }

  /** Camera trước (hoặc webcam không báo facingMode) thì hiển thị lật gương. */
  get mirrored() {
    return this.facingMode !== 'environment';
  }

  get canSwitch() {
    return this.devices.length > 1;
  }

  async refreshDevices() {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      this.devices = all.filter((d) => d.kind === 'videoinput');
    } catch {
      this.devices = [];
    }
    return this.devices;
  }

  buildConstraints({ exactFacing = false } = {}) {
    const video = {
      width: { ideal: this.cfg.idealWidth },
      height: { ideal: this.cfg.idealHeight },
    };
    if (this.deviceId) {
      video.deviceId = { exact: this.deviceId };
    } else {
      video.facingMode = exactFacing ? { exact: this.facingMode } : { ideal: this.facingMode };
    }
    return { audio: false, video };
  }

  async start(opts = {}) {
    const unsupported = checkCameraSupport();
    if (unsupported) throw unsupported;
    this.stop();

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(this.buildConstraints(opts));
    } catch (err) {
      if (opts.exactFacing && err && err.name === 'OverconstrainedError') {
        // Thiết bị không có camera đúng hướng yêu cầu → thử lại ở chế độ "ưu tiên".
        return this.start({ exactFacing: false });
      }
      throw mapMediaError(err);
    }

    this.stream = stream;
    const track = stream.getVideoTracks()[0];
    const settings = track.getSettings ? track.getSettings() : {};
    this.hasFacingModeSetting = !!settings.facingMode;
    if (settings.facingMode) this.facingMode = settings.facingMode === 'environment' ? 'environment' : 'user';
    if (settings.deviceId) this.deviceId = settings.deviceId;
    track.addEventListener('ended', () => {
      if (this.stream === stream && this.hooks.onEnded) this.hooks.onEnded();
    });

    this.video.muted = true;
    this.video.playsInline = true;
    this.video.srcObject = stream;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new CameraError(CameraErrorCode.UNKNOWN, 'Camera không phát hình.')), 10000);
      const ready = () => {
        clearTimeout(timer);
        resolve();
      };
      if (this.video.readyState >= 1 && this.video.videoWidth) ready();
      else this.video.addEventListener('loadedmetadata', ready, { once: true });
    });
    try {
      await this.video.play();
    } catch (err) {
      throw mapMediaError(err);
    }

    // Sau khi được cấp quyền mới có nhãn/ID thiết bị đầy đủ.
    await this.refreshDevices();
    return { width: this.video.videoWidth, height: this.video.videoHeight, mirrored: this.mirrored };
  }

  /** Đổi camera: đảo trước/sau nếu thiết bị báo facingMode, ngược lại xoay vòng danh sách camera. */
  async switchCamera() {
    await this.refreshDevices();
    if (this.devices.length < 2) return null;

    if (this.hasFacingModeSetting) {
      this.facingMode = this.facingMode === 'user' ? 'environment' : 'user';
      this.deviceId = null;
      return this.start({ exactFacing: true });
    }
    const idx = this.devices.findIndex((d) => d.deviceId === this.deviceId);
    const next = this.devices[(idx + 1) % this.devices.length];
    this.deviceId = next.deviceId;
    this.facingMode = /back|rear|environment|sau/i.test(next.label) ? 'environment' : 'user';
    return this.start();
  }

  /** Dừng mọi track và giải phóng video. An toàn khi gọi nhiều lần. */
  stop() {
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    if (this.video) {
      this.video.pause();
      this.video.srcObject = null;
    }
  }

  /**
   * Gọi `cb(nowMs)` cho mỗi frame video MỚI (requestVideoFrameCallback), dự phòng requestAnimationFrame
   * kèm kiểm tra currentTime để bỏ qua frame cũ. Trả về hàm huỷ.
   */
  onFrame(cb) {
    const video = this.video;
    let cancelled = false;
    let handle = null;
    if ('requestVideoFrameCallback' in video) {
      const loop = (now) => {
        if (cancelled) return;
        cb(now);
        if (!cancelled) handle = video.requestVideoFrameCallback(loop);
      };
      handle = video.requestVideoFrameCallback(loop);
      return () => {
        cancelled = true;
        if (handle != null && video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(handle);
      };
    }
    let lastTime = -1;
    const loop = (now) => {
      if (cancelled) return;
      if (video.readyState >= 2 && video.currentTime !== lastTime) {
        lastTime = video.currentTime;
        cb(now);
      }
      if (!cancelled) handle = requestAnimationFrame(loop);
    };
    handle = requestAnimationFrame(loop);
    return () => {
      cancelled = true;
      if (handle != null) cancelAnimationFrame(handle);
    };
  }
}
