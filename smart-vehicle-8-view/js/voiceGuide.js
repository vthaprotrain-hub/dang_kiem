/**
 * voiceGuide.js — Giọng đọc hướng dẫn tiếng Việt (Web Speech API), nhẹ nhàng và không "nói đè".
 *
 * - Chọn giọng tiếng Việt tự nhiên nhất mà thiết bị có (ưu tiên giọng "Natural/Neural/Online", Google, HoaiMy, Linh…).
 * - Tốc độ chậm hơn một chút, cao độ hơi cao, câu ngắn có "nhé" để nghe thân thiện thay vì ra lệnh.
 * - Không ngắt câu đang đọc trừ khi thông điệp mới QUAN TRỌNG hơn (sai chiều, ảnh chưa đạt, hoàn thành).
 *   Thông điệp cùng mức ưu tiên được xếp hàng — chỉ giữ thông điệp MỚI NHẤT và đọc sau một khoảng nghỉ ngắn.
 * - Cùng một `key` không đọc lại trong `CONFIG.ui.speakRepeatMs` (trừ khi `force`).
 */
import { CONFIG } from './config.js';
import { log, now } from './utils.js';

let enabled = true;
let viVoice = null;
let voicesLoaded = false;
const lastSpoken = new Map(); // key -> time
let current = null; // { u, priority, key, startedAt }
let pending = null; // { text, key, priority, at }
let gapTimer = null;

const PROSODY = { rate: 0.94, pitch: 1.06, volume: 1 };
const GAP_MS = 380;
const PENDING_TTL_MS = 4500;

export const voiceSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

/** Chấm điểm giọng: giọng tự nhiên (neural/online) đọc mềm hơn hẳn giọng tổng hợp cũ. */
function scoreVoice(v) {
  let s = 0;
  if (/^vi[-_]?VN/i.test(v.lang)) s += 10;
  else if (/^vi/i.test(v.lang)) s += 8;
  else return -1;
  if (/natural|neural|online|premium|enhanced/i.test(v.name)) s += 6;
  if (/google/i.test(v.name)) s += 4;
  if (/hoai ?my|linh|nam ?minh/i.test(v.name)) s += 3;
  if (/female|nữ/i.test(v.name)) s += 1;
  if (v.localService) s += 0.5; // không cần mạng
  return s;
}

function pickVoice() {
  if (!voiceSupported()) return;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return;
  voicesLoaded = true;
  const ranked = voices.map((v) => [scoreVoice(v), v]).filter(([sc]) => sc >= 0).sort((a, b) => b[0] - a[0]);
  viVoice = ranked[0]?.[1] ?? null;
  if (viVoice) log.debug(`Giọng đọc: ${viVoice.name} (${viVoice.lang})`);
}

export function initVoice() {
  if (!voiceSupported()) return false;
  pickVoice();
  window.speechSynthesis.addEventListener?.('voiceschanged', pickVoice);
  return true;
}
export const hasVietnameseVoice = () => Boolean(viVoice);
export const voicesReady = () => voicesLoaded;
export const voiceName = () => viVoice?.name ?? null;

/** iOS chỉ cho đọc sau cử chỉ người dùng: phát một câu rỗng trong sự kiện bấm nút để "mở khóa". */
export function primeSpeech() {
  if (!voiceSupported()) return;
  try {
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    window.speechSynthesis.speak(u);
  } catch { /* noop */ }
}

export function setVoiceEnabled(on) {
  enabled = Boolean(on);
  if (!enabled) stopSpeaking();
}
export const isVoiceEnabled = () => enabled;

export function stopSpeaking() {
  clearTimeout(gapTimer);
  pending = null;
  current = null;
  if (voiceSupported()) window.speechSynthesis.cancel();
}

function utter(text, key, priority) {
  const u = new SpeechSynthesisUtterance(text);
  u.lang = viVoice?.lang || 'vi-VN';
  if (viVoice) u.voice = viVoice;
  u.rate = PROSODY.rate;
  u.pitch = PROSODY.pitch;
  u.volume = PROSODY.volume;
  const done = () => {
    if (current?.u !== u) return;
    current = null;
    clearTimeout(gapTimer);
    gapTimer = setTimeout(flushPending, GAP_MS);
  };
  u.onend = done;
  u.onerror = done;
  current = { u, key, priority, startedAt: now() };
  lastSpoken.set(key, now());
  window.speechSynthesis.speak(u);
}

function flushPending() {
  if (!pending || current) return;
  const p = pending;
  pending = null;
  if (now() - p.at > PENDING_TTL_MS) return; // đã cũ, tình huống có thể đã khác
  utter(p.text, p.key, p.priority);
}

/**
 * @param {string} message
 * @param {{key?:string, force?:boolean, priority?:number}} opts  priority: 0 thông tin · 1 cảnh báo · 2 quan trọng
 * @returns {{spoken:boolean, queued?:boolean, reason?:string, hasViVoice?:boolean}}
 */
export function speakVietnamese(message, { key = message, force = false, priority = 0 } = {}) {
  if (!enabled) return { spoken: false, reason: 'disabled' };
  if (!voiceSupported()) return { spoken: false, reason: 'unsupported' };
  if (!message) return { spoken: false, reason: 'empty' };
  const t = now();
  if (!force && t - (lastSpoken.get(key) ?? -1e9) < CONFIG.ui.speakRepeatMs) return { spoken: false, reason: 'repeat' };
  try {
    const synth = window.speechSynthesis;
    // một câu "treo" quá lâu (một số trình duyệt không gọi onend) thì coi như đã xong
    if (current && t - current.startedAt > 12000) current = null;
    const busy = Boolean(current) || synth.speaking;
    if (busy) {
      if (current && current.key === key) return { spoken: false, reason: 'same' };
      // chỉ ngắt lời khi thông điệp mới quan trọng hơn; còn lại xếp hàng (giữ thông điệp mới nhất)
      if (priority > (current?.priority ?? 0) || (force && priority >= 2)) {
        pending = null;
        current = null;
        synth.cancel();
        utter(message, key, priority);
        return { spoken: true, hasViVoice: Boolean(viVoice) };
      }
      pending = { text: message, key, priority, at: t };
      lastSpoken.set(key, t);
      return { spoken: false, queued: true };
    }
    utter(message, key, priority);
    return { spoken: true, hasViVoice: Boolean(viVoice) };
  } catch (e) {
    log.warn('Speech lỗi', e.message);
    return { spoken: false, reason: 'error' };
  }
}

/** Đọc số bằng chữ cho tự nhiên (0–12). */
export function numberWord(n) {
  const w = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín', 'mười', 'mười một', 'mười hai'];
  return w[n] ?? String(n);
}
