/**
 * voiceGuide.js — Đọc hướng dẫn tiếng Việt bằng Web Speech API (khi trình duyệt hỗ trợ).
 * Tránh đọc lặp: cùng một `key` không được đọc lại trong khoảng `speakRepeatMs`, trừ khi `force`.
 */
import { CONFIG } from './config.js';
import { log, now } from './utils.js';

let enabled = true;
let viVoice = null;
let voicesLoaded = false;
const lastSpoken = new Map(); // key -> time
let lastPriority = 0;

export const voiceSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

function pickVoice() {
  if (!voiceSupported()) return;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return;
  voicesLoaded = true;
  viVoice = voices.find((v) => /^vi/i.test(v.lang)) ?? null;
}

export function initVoice() {
  if (!voiceSupported()) return false;
  pickVoice();
  window.speechSynthesis.addEventListener?.('voiceschanged', pickVoice);
  return true;
}
export const hasVietnameseVoice = () => Boolean(viVoice);
export const voicesReady = () => voicesLoaded;

export function setVoiceEnabled(on) {
  enabled = Boolean(on);
  if (!enabled) stopSpeaking();
}
export const isVoiceEnabled = () => enabled;

export function stopSpeaking() {
  if (voiceSupported()) window.speechSynthesis.cancel();
  lastPriority = 0;
}

/**
 * @param {string} message
 * @param {{key?:string, force?:boolean, priority?:number}} opts
 * @returns {{spoken:boolean, reason?:string, hasViVoice?:boolean}}
 */
export function speakVietnamese(message, { key = message, force = false, priority = 0 } = {}) {
  if (!enabled) return { spoken: false, reason: 'disabled' };
  if (!voiceSupported()) return { spoken: false, reason: 'unsupported' };
  if (!message) return { spoken: false, reason: 'empty' };
  const t = now();
  if (!force && t - (lastSpoken.get(key) ?? -1e9) < CONFIG.ui.speakRepeatMs) return { spoken: false, reason: 'repeat' };
  const synth = window.speechSynthesis;
  if (synth.speaking && !force) {
    if (priority <= lastPriority) return { spoken: false, reason: 'busy' };
  }
  try {
    synth.cancel();
    const u = new SpeechSynthesisUtterance(message);
    u.lang = 'vi-VN';
    if (viVoice) u.voice = viVoice;
    u.rate = 1.0;
    u.pitch = 1.0;
    u.onend = () => { lastPriority = 0; };
    u.onerror = () => { lastPriority = 0; };
    lastPriority = priority;
    lastSpoken.set(key, t);
    synth.speak(u);
    return { spoken: true, hasViVoice: Boolean(viVoice) };
  } catch (e) {
    log.warn('Speech lỗi', e.message);
    return { spoken: false, reason: 'error' };
  }
}
