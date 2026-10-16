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

export async function tryEnterFullscreen() {
  const el = document.documentElement;
  if (document.fullscreenElement || !el.requestFullscreen) return false;
  try {
    await el.requestFullscreen({ navigationUI: 'hide' });
    return true;
  } catch {
    return false;
  }
}
export function exitFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
}

/** { needed: 'portrait'|'landscape', current, ok } */
export function orientationStatus(angleKey, current = getScreenOrientation().type) {
  const needed = requiredOrientationFor(angleKey);
  return { needed, current, ok: needed === current };
}
