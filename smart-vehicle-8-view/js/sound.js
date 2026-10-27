/**
 * sound.js — Âm báo nhẹ (earcon) bằng Web Audio + rung nhẹ, không cần tệp âm thanh.
 *
 * Âm báo giúp người dùng biết "đã tới đúng góc" / "ảnh đã đạt" mà không phải nhìn màn hình hay chờ giọng đọc hết câu.
 * Âm lượng thấp, sóng sin có bao biên mềm (không chói). Trình duyệt chỉ cho phát âm thanh sau một cử chỉ của người
 * dùng, nên `unlockAudio()` được gọi trong sự kiện bấm "Bắt đầu chụp ảnh".
 */
let ctx = null;
let enabled = true;
const lastAt = new Map();

export function setSoundEnabled(on) {
  enabled = Boolean(on);
}

/** Gọi trong sự kiện chạm/nhấp của người dùng. */
export function unlockAudio() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx ??= new AC();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    // phát một mẫu im lặng để iOS "mở khóa" đường âm thanh
    const b = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = b;
    src.connect(ctx.destination);
    src.start(0);
    return true;
  } catch {
    return false;
  }
}

function tone(freq, start, dur, { gain = 0.08, type = 'sine' } = {}) {
  const t0 = ctx.currentTime + start;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

const PATTERNS = {
  // tới đúng góc: hai nốt đi lên, nhẹ
  ready: [[659.25, 0, 0.16], [880, 0.11, 0.22]],
  // ảnh đạt: hợp âm rải trưởng
  accepted: [[523.25, 0, 0.18], [659.25, 0.09, 0.2], [783.99, 0.18, 0.3]],
  // cảnh báo: một nốt trầm ngắn
  warn: [[392, 0, 0.22]],
  // lỗi / ảnh chưa đạt: hai nốt đi xuống
  reject: [[440, 0, 0.16], [349.23, 0.13, 0.24]],
  // hoàn thành 8/8
  done: [[523.25, 0, 0.2], [659.25, 0.12, 0.2], [783.99, 0.24, 0.2], [1046.5, 0.36, 0.42]],
};
const VIBRATE = { ready: 18, accepted: [18, 60, 18], warn: 30, reject: [40, 50, 40], done: [20, 60, 20, 60, 40] };

/**
 * @param {'ready'|'accepted'|'warn'|'reject'|'done'} kind
 * @param {{minGapMs?:number}} [o]
 */
export function chime(kind, { minGapMs = 1200 } = {}) {
  const t = performance.now();
  if (t - (lastAt.get(kind) ?? -1e9) < minGapMs) return false;
  lastAt.set(kind, t);
  try { navigator.vibrate?.(VIBRATE[kind] ?? 0); } catch { /* không hỗ trợ rung */ }
  if (!enabled || !ctx || ctx.state !== 'running') return false;
  const p = PATTERNS[kind];
  if (!p) return false;
  try {
    for (const [f, s, d] of p) tone(f, s, d, { gain: kind === 'warn' || kind === 'reject' ? 0.06 : 0.075 });
    return true;
  } catch {
    return false;
  }
}
