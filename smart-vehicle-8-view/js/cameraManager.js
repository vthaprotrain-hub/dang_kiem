/**
 * cameraManager.js — Quản lý camera bằng MediaDevices API.
 *
 * initCamera / switchCamera / stopCamera đều trả về dữ liệu có cấu trúc { ok, ... } và KHÔNG ném lỗi
 * ra ngoài (lỗi được map sang thông báo tiếng Việt) để một lỗi camera không làm trắng màn hình.
 */
import { T } from './strings.js';
import { isSecure, log, sleep, Emitter } from './utils.js';

export const cameraEvents = new Emitter(); // 'ended' khi track bị ngắt (ứng dụng khác chiếm camera…)

let stream = null;
let videoEl = null;
let opening = null;
let cameras = [];
let current = { deviceId: null, label: '', facing: null, width: 0, height: 0 };

export function cameraSupported() {
  return Boolean(navigator.mediaDevices?.getUserMedia);
}

function mapError(e) {
  const name = e?.name || 'unknown';
  const message = T.camera.errors[name] || T.camera.errors.unknown;
  return { name, message, detail: e?.message || '' };
}

const guessFacing = (label = '', settings = {}) => {
  if (settings.facingMode) return settings.facingMode === 'user' ? 'user' : 'environment';
  if (/back|rear|environment|sau|world/i.test(label)) return 'environment';
  if (/front|user|facetime|trước/i.test(label)) return 'user';
  return null;
};

export async function listCameras() {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  try {
    const devs = await navigator.mediaDevices.enumerateDevices();
    cameras = devs
      .filter((d) => d.kind === 'videoinput')
      .map((d, i) => ({
        deviceId: d.deviceId,
        label: d.label || `Camera ${i + 1}`,
        facing: guessFacing(d.label),
      }));
  } catch (e) {
    log.warn('enumerateDevices lỗi', e.message);
    cameras = [];
  }
  return cameras;
}

function buildAttempts({ deviceId, facingMode }) {
  const base = deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: facingMode || 'environment' } };
  return [
    { video: { ...base, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false },
    { video: { ...base }, audio: false },
    { video: deviceId ? { deviceId: { ideal: deviceId } } : true, audio: false },
  ];
}

function stopStreamOnly() {
  if (stream) {
    stream.getTracks().forEach((t) => {
      t.onended = null;
      try { t.stop(); } catch { /* noop */ }
    });
    stream = null;
  }
}

/**
 * Mở camera và gắn vào <video>.
 * @returns {Promise<{ok:true, deviceId, label, facing, width, height, devices} | {ok:false, name, message, detail}>}
 */
export function initCamera({ video, deviceId = null, facingMode = 'environment' } = {}) {
  if (opening) return opening;
  opening = (async () => {
    if (!isSecure()) return { ok: false, name: 'insecure', message: T.camera.errors.insecure };
    if (!cameraSupported()) return { ok: false, name: 'unsupported', message: T.camera.errors.unsupported };

    stopStreamOnly();
    videoEl = video ?? videoEl;
    let lastErr = null;
    for (const constraints of buildAttempts({ deviceId, facingMode })) {
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        log.warn('getUserMedia thất bại:', e.name);
        // Lỗi quyền / thiết bị bận / không có camera: không thử lại cấu hình thấp hơn.
        if (['NotAllowedError', 'PermissionDeniedError', 'NotFoundError', 'DevicesNotFoundError', 'NotReadableError', 'SecurityError', 'TrackStartError'].includes(e.name)) break;
      }
    }
    if (!stream) return { ok: false, ...mapError(lastErr) };

    const track = stream.getVideoTracks()[0];
    track.onended = () => {
      log.warn('Camera track đã kết thúc');
      cameraEvents.emit('ended');
    };
    const settings = track.getSettings?.() ?? {};

    if (videoEl) {
      videoEl.muted = true;
      videoEl.setAttribute('playsinline', '');
      videoEl.srcObject = stream;
      try {
        await videoEl.play();
      } catch (e) {
        log.warn('video.play() lỗi', e.name);
      }
      // đợi có kích thước khung hình
      for (let i = 0; i < 40 && !videoEl.videoWidth; i++) await sleep(50);
    }

    const devices = await listCameras();
    const found = devices.find((d) => d.deviceId === settings.deviceId);
    current = {
      deviceId: settings.deviceId ?? deviceId ?? null,
      label: found?.label ?? track.label ?? '',
      facing: guessFacing(track.label, settings) ?? found?.facing ?? null,
      width: videoEl?.videoWidth || settings.width || 0,
      height: videoEl?.videoHeight || settings.height || 0,
    };
    return { ok: true, ...current, devices };
  })().finally(() => {
    opening = null;
  });
  return opening;
}

/** Chuyển sang camera khác. Không truyền deviceId => chuyển vòng tròn sang camera kế tiếp. */
export async function switchCamera(deviceId) {
  const devices = cameras.length ? cameras : await listCameras();
  if (!devices.length) return { ok: false, name: 'NotFoundError', message: T.camera.errors.NotFoundError };
  let target = deviceId;
  if (!target) {
    const idx = devices.findIndex((d) => d.deviceId === current.deviceId);
    target = devices[(idx + 1) % devices.length].deviceId;
  }
  if (target === current.deviceId && devices.length === 1) {
    return { ok: false, name: 'single', message: 'Thiết bị chỉ có một camera.' };
  }
  return initCamera({ deviceId: target });
}

export function stopCamera() {
  stopStreamOnly();
  if (videoEl) {
    try { videoEl.pause(); } catch { /* noop */ }
    videoEl.srcObject = null;
  }
  current = { ...current, width: 0, height: 0 };
}

export const getCameraInfo = () => ({ ...current, devices: cameras, active: Boolean(stream) });
export const getCameraList = () => cameras;
export const isCameraActive = () => Boolean(stream && stream.getVideoTracks().some((t) => t.readyState === 'live'));

/** Kiểm tra nhanh camera ở màn hình 1: mở → đọc thông tin → đóng. */
export async function testCamera() {
  const probe = document.createElement('video');
  const r = await initCamera({ video: probe });
  const info = r.ok ? { ...r } : r;
  stopCamera();
  videoEl = null;
  return info;
}

/** Gắn lại <video> (khi chuyển màn hình) mà không mở lại stream nếu stream còn sống. */
export async function attachVideo(video) {
  videoEl = video;
  if (stream && video.srcObject !== stream) {
    video.srcObject = stream;
    try { await video.play(); } catch { /* noop */ }
  }
}
