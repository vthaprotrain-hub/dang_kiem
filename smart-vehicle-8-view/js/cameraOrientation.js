/**
 * cameraOrientation.js — Hướng màn hình (dọc/ngang) và yêu cầu hướng theo từng góc chụp.
 *
 * Quy tắc: Front & Rear => dọc; 6 góc còn lại => ngang.
 * Không xoay ảnh bằng CSS: ảnh lưu lấy trực tiếp từ khung hình video (đúng chiều, không kéo giãn).
 */
import { ANGLE_BY_KEY } from './config.js';
import { Emitter, log } from './utils.js';

export const orientationEvents = new Emitter();

export function requiredOrientationFor(angleKey) {
  return ANGLE_BY_KEY[angleKey]?.orientation ?? 'landscape';
}

/** Hướng màn hình hiện tại theo layout mà người dùng đang thấy. */
export function getScreenOrientation() {
  const type = window.innerHeight >= window.innerWidth ? 'portrait' : 'landscape';
  const angle = screen.orientation?.angle ?? window.orientation ?? 0;
  return { type, angle, lockSupported: typeof screen.orientation?.lock === 'function' };
}

let last = null;
let timer = null;
function check() {
  const cur = getScreenOrientation();
  if (!last || last.type !== cur.type) {
    last = cur;
    orientationEvents.emit('change', cur);
  }
}
const onChange = () => {
  clearTimeout(timer);
  timer = setTimeout(check, 120);
};

export function startOrientationWatch() {
  last = getScreenOrientation();
  window.addEventListener('resize', onChange);
  window.addEventListener('orientationchange', onChange);
  screen.orientation?.addEventListener?.('change', onChange);
  return last;
}
export function stopOrientationWatch() {
  window.removeEventListener('resize', onChange);
  window.removeEventListener('orientationchange', onChange);
  screen.orientation?.removeEventListener?.('change', onChange);
  clearTimeout(timer);
}

/**
 * Thử khóa hướng màn hình. Nhiều trình duyệt (iOS Safari, Firefox, Chrome desktop) KHÔNG cho phép;
 * Chrome Android thường yêu cầu fullscreen. Không giả định thành công — luôn trả về kết quả rõ ràng.
 */
export async function tryLockOrientation(type) {
  if (typeof screen.orientation?.lock !== 'function') return { ok: false, reason: 'unsupported' };
  try {
    await screen.orientation.lock(type === 'portrait' ? 'portrait' : 'landscape');
    return { ok: true };
  } catch (e) {
    log.debug('orientation.lock thất bại:', e.name);
    return { ok: false, reason: e.name || 'error' };
  }
}
export function unlockOrientation() {
  try {
    screen.orientation?.unlock?.();
  } catch { /* noop */ }
}

/** Phải được gọi trực tiếp trong sự kiện chạm/nhấp của người dùng. */
export async function tryEnterFullscreen() {
  const el = document.documentElement;
  if (isFullscreen()) return true;
  try {
    if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    else return false;
    return true;
  } catch {
    return false;
  }
}
export function exitFullscreen() {
  try {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    else if (document.webkitFullscreenElement) document.webkitExitFullscreen?.();
  } catch { /* noop */ }
}

/** { needed: 'portrait'|'landscape', current, ok } */
export function orientationStatus(angleKey, current = getScreenOrientation().type) {
  const needed = requiredOrientationFor(angleKey);
  return { needed, current, ok: needed === current };
}

/* ====================================================================== */
/* Hướng CẦM MÁY theo cảm biến (khi trình duyệt bị khóa dọc)               */
/* ====================================================================== */
/**
 * Khi màn hình khóa dọc, trình duyệt không xoay nhưng người dùng vẫn cầm máy ngang để chụp. Module này đọc
 * DeviceOrientation (alpha/beta/gamma), tính vector "hướng lên" của trọng lực trong hệ toạ độ màn hình và suy ra
 * người dùng đang cầm dọc hay ngang (và ngang về phía nào). Giao diện sẽ tự xoay bằng CSS thay vì xoay cả trình
 * duyệt — tránh khựng/lag do trình duyệt dựng lại toàn trang.
 *
 *   up = (−sinγ·cosβ, sinβ, cosβ·cosγ)  (x: sang phải màn hình, y: lên trên màn hình, z: ra khỏi màn hình)
 *   góc θ = atan2(up.x, up.y): 0° = cầm dọc, +90° = cầm ngang đỉnh máy sang TRÁI, −90° = đỉnh máy sang PHẢI.
 *
 * `rot` là góc xoay CSS cần áp cho giao diện để chữ đứng thẳng với người dùng: +90 (đỉnh máy sang trái),
 * −90 (đỉnh máy sang phải), 0 (dọc). Khi máy nằm gần phẳng, giữ nguyên trạng thái cũ.
 */
export const tiltEvents = new Emitter();
const TILT = { enterDeg: 58, exitDeg: 32, flatZ: 0.86, holdMs: 260, staleMs: 5000 }; // staleMs dài: máy chậm có thể dồn sự kiện cảm biến
const tilt = { rot: 0, theta: null, at: 0, cand: null, candSince: 0, listening: false, override: null };

function onTiltEvent(e) {
  if (e.beta == null || e.gamma == null) return;
  const b = (e.beta * Math.PI) / 180;
  const g = (e.gamma * Math.PI) / 180;
  const ux = -Math.sin(g) * Math.cos(b);
  const uy = Math.sin(b);
  const uz = Math.cos(b) * Math.cos(g);
  const t = performance.now();
  tilt.at = t;
  if (Math.abs(uz) > TILT.flatZ) return; // máy gần nằm phẳng: không đủ thông tin, giữ trạng thái cũ
  const theta = (Math.atan2(ux, uy) * 180) / Math.PI;
  tilt.theta = theta;
  const a = Math.abs(theta);
  let want = tilt.rot;
  if (tilt.rot === 0) {
    if (a >= TILT.enterDeg && a <= 180 - TILT.exitDeg) want = theta > 0 ? 90 : -90;
  } else if (a <= TILT.exitDeg) want = 0;
  else if (a >= TILT.enterDeg && a <= 180 - TILT.exitDeg) want = theta > 0 ? 90 : -90;
  if (want === tilt.rot) { tilt.cand = null; return; }
  if (tilt.cand !== want) { tilt.cand = want; tilt.candSince = t; return; }
  if (t - tilt.candSince >= TILT.holdMs) {
    tilt.rot = want;
    tilt.cand = null;
    tiltEvents.emit('change', getDeviceTilt());
  }
}

export function startTiltWatch() {
  if (tilt.listening || typeof window === 'undefined') return;
  tilt.listening = true;
  window.addEventListener('deviceorientation', onTiltEvent, true);
}
export function stopTiltWatch() {
  tilt.listening = false;
  window.removeEventListener('deviceorientation', onTiltEvent, true);
}

/**
 * @returns {{available:boolean, rot:0|90|-90, type:'portrait'|'landscape', theta:number|null, source:'sensor'|'manual'|'none'}}
 */
export function getDeviceTilt() {
  if (tilt.override != null) return { available: true, rot: tilt.override, type: tilt.override ? 'landscape' : 'portrait', theta: tilt.theta, source: 'manual' };
  const fresh = tilt.at > 0 && performance.now() - tilt.at < TILT.staleMs;
  return { available: fresh, rot: fresh ? tilt.rot : 0, type: fresh && tilt.rot ? 'landscape' : 'portrait', theta: tilt.theta, source: fresh ? 'sensor' : 'none' };
}

/** Ghi đè thủ công (khi không có cảm biến): null = theo cảm biến, 0 = dọc, 90/−90 = ngang. */
export function setTiltOverride(rot) {
  tilt.override = rot == null ? null : rot;
  tiltEvents.emit('change', getDeviceTilt());
}
export const getTiltOverride = () => tilt.override;

/* ---------------------------- toàn màn hình ---------------------------- */
export function fullscreenSupported() {
  const el = document.documentElement;
  return Boolean(document.fullscreenEnabled || document.webkitFullscreenEnabled) && Boolean(el.requestFullscreen || el.webkitRequestFullscreen);
}
export const isFullscreen = () => Boolean(document.fullscreenElement || document.webkitFullscreenElement);
/** Đang chạy như ứng dụng (đã "Thêm vào màn hình chính") — không có thanh địa chỉ. */
export function isStandalone() {
  return Boolean(window.navigator.standalone) || ['fullscreen', 'standalone'].some((m) => window.matchMedia?.(`(display-mode: ${m})`).matches);
}
export const isIOS = () => /iP(hone|od|ad)/.test(navigator.platform || '') || (/Mac/.test(navigator.platform || '') && navigator.maxTouchPoints > 1);
