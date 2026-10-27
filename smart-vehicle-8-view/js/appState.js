/**
 * appState.js — State trung tâm của phiên chụp.
 * Một nguồn sự thật duy nhất: thông tin xe, trạng thái AI, camera, cảm biến, điều hướng, ảnh đã chụp.
 * Các module KHÔNG sửa DOM tùy ý: chúng trả dữ liệu có cấu trúc, UI đăng ký subscribe để vẽ lại.
 */
import { DEFAULT_SETTINGS } from './config.js';
import { Emitter } from './utils.js';

const bus = new Emitter();

const initialState = () => ({
  screen: 'setup', // setup | camera | preview
  settings: { ...DEFAULT_SETTINGS },
  vehicle: { type: 'car', plate: '', plateNorm: '', sessionName: '' },
  session: {
    id: null,
    createdAt: null,
    status: 'new', // new | in_progress | completed
    startIndex: 0,
    startConfirmation: null, // { method, orientation, confidence, evidence[] }
    ocr: { status: 'idle', text: null, normalized: null, confidence: null, similarity: null, manualConfirmed: false },
  },
  ai: { status: 'idle', backend: null, error: null, loadMs: null, modelBase: null, hasViewClassifier: false },
  camera: { status: 'idle', deviceId: null, devices: [], facing: null, width: 0, height: 0, error: null, label: '' },
  sensors: { supported: null, permission: 'unknown', active: false, error: null },
  nav: {
    fsm: 'WAITING_FOR_VEHICLE',
    target: 'front',
    orderStart: 0,
    estimatedAngle: null,
    estimatedDeg: null,
    confidence: 0,
    direction: 'unknown',
    guidance: null,
    sensorMode: 'initializing',
  },
  captures: {}, // angleKey -> meta (không chứa blob)
  retakeKey: null,
  completed: false,
});

let state = initialState();

export const getState = () => state;

/** Gộp nông các khóa cấp 1. */
export function setState(patch) {
  const prev = state;
  state = { ...state, ...patch };
  bus.emit('change', { state, prev, keys: Object.keys(patch) });
  return state;
}

/** Gộp nông vào một khóa con: update('ai', { status: 'ready' }). */
export function update(key, patch) {
  return setState({ [key]: { ...state[key], ...patch } });
}

export function subscribe(fn) {
  return bus.on('change', fn);
}

export function resetState(keep = ['settings']) {
  const fresh = initialState();
  for (const k of keep) fresh[k] = state[k];
  state = fresh;
  bus.emit('change', { state, prev: null, keys: Object.keys(fresh) });
}

/** Số góc đã được chấp nhận. */
export function acceptedCount(s = state) {
  return Object.values(s.captures).filter((c) => c && c.accepted && !c.retake).length;
}
export function isComplete(s = state) {
  return acceptedCount(s) >= 8;
}
