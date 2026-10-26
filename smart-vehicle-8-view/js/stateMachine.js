/**
 * stateMachine.js — State machine điều hướng chụp 8 góc.
 *
 * Giao diện KHÔNG được điều khiển bằng các biến boolean rời rạc: mọi thay đổi pha chụp đều đi qua
 * `send(event)` và bảng chuyển trạng thái bên dưới. Sự kiện không hợp lệ ở trạng thái hiện tại bị
 * từ chối (và ghi log) thay vì làm nhảy trạng thái.
 */
import { log, Emitter } from './utils.js';

export const S = Object.freeze({
  WAITING_FOR_VEHICLE: 'WAITING_FOR_VEHICLE',
  VEHICLE_DETECTED: 'VEHICLE_DETECTED',
  IDENTIFYING_START_POINT: 'IDENTIFYING_START_POINT',
  READY_FOR_CAPTURE: 'READY_FOR_CAPTURE',
  CAPTURING_FRONT: 'CAPTURING_FRONT',
  MOVING_CLOCKWISE: 'MOVING_CLOCKWISE',
  POSSIBLE_WRONG_DIRECTION: 'POSSIBLE_WRONG_DIRECTION',
  NEED_REPOSITION: 'NEED_REPOSITION',
  WAITING_FOR_LANDSCAPE: 'WAITING_FOR_LANDSCAPE',
  WAITING_FOR_PORTRAIT: 'WAITING_FOR_PORTRAIT',
  CAPTURING_CURRENT_ANGLE: 'CAPTURING_CURRENT_ANGLE',
  VALIDATING_CAPTURE: 'VALIDATING_CAPTURE',
  CAPTURE_ACCEPTED: 'CAPTURE_ACCEPTED',
  CAPTURE_REJECTED: 'CAPTURE_REJECTED',
  COMPLETED: 'COMPLETED',
});

export const E = Object.freeze({
  RESET: 'RESET',
  RESUME: 'RESUME',
  VEHICLE_FOUND: 'VEHICLE_FOUND',
  VEHICLE_STABLE: 'VEHICLE_STABLE',
  VEHICLE_LOST: 'VEHICLE_LOST',
  START_CONFIRMED: 'START_CONFIRMED',
  AT_TARGET: 'AT_TARGET',
  LEFT_TARGET: 'LEFT_TARGET',
  WRONG_DIRECTION: 'WRONG_DIRECTION',
  DIRECTION_OK: 'DIRECTION_OK',
  NEED_REPOSITION: 'NEED_REPOSITION',
  REPOSITION_OK: 'REPOSITION_OK',
  NEED_LANDSCAPE: 'NEED_LANDSCAPE',
  NEED_PORTRAIT: 'NEED_PORTRAIT',
  ORIENTATION_OK: 'ORIENTATION_OK',
  SHUTTER_START: 'SHUTTER_START', // chụp góc xuất phát
  SHUTTER: 'SHUTTER',             // chụp các góc còn lại
  FRAME_GRABBED: 'FRAME_GRABBED',
  CAPTURE_VALID: 'CAPTURE_VALID',
  CAPTURE_INVALID: 'CAPTURE_INVALID',
  CAPTURE_ABORT: 'CAPTURE_ABORT',
  RETRY: 'RETRY',
  NEXT: 'NEXT',
  ALL_DONE: 'ALL_DONE',
});

const {
  WAITING_FOR_VEHICLE: WFV, VEHICLE_DETECTED: VD, IDENTIFYING_START_POINT: ISP, READY_FOR_CAPTURE: RFC,
  CAPTURING_FRONT: CF, MOVING_CLOCKWISE: MC, POSSIBLE_WRONG_DIRECTION: PWD, NEED_REPOSITION: NR,
  WAITING_FOR_LANDSCAPE: WFL, WAITING_FOR_PORTRAIT: WFP, CAPTURING_CURRENT_ANGLE: CCA,
  VALIDATING_CAPTURE: VC, CAPTURE_ACCEPTED: CA, CAPTURE_REJECTED: CR, COMPLETED: DONE,
} = S;

/** Các trạng thái "đang di chuyển / chuẩn bị chụp" sau khi đã xác nhận điểm xuất phát. */
const NAV_STATES = [RFC, MC, PWD, NR, WFL, WFP];

/**
 * Bảng chuyển trạng thái: TRANSITIONS[event] = { [fromState]: toState }
 * Dạng bảng dễ rà soát hơn chuỗi if/else.
 */
function table() {
  const t = {};
  const add = (event, froms, to) => {
    t[event] ??= {};
    for (const f of [].concat(froms)) t[event][f] = to;
  };

  // Giai đoạn tìm xe & xác định điểm xuất phát
  add(E.VEHICLE_FOUND, WFV, VD);
  add(E.VEHICLE_STABLE, VD, ISP);
  add(E.VEHICLE_LOST, [VD, ISP], WFV);
  add(E.START_CONFIRMED, ISP, RFC);

  // Điều hướng sau khi đã có điểm xuất phát
  add(E.AT_TARGET, [MC, PWD, NR, WFL, WFP], RFC);
  add(E.LEFT_TARGET, RFC, MC);
  add(E.WRONG_DIRECTION, [MC, RFC, NR], PWD);
  add(E.DIRECTION_OK, PWD, MC);
  add(E.NEED_REPOSITION, [RFC, MC, PWD, WFL, WFP, NR], NR);
  add(E.REPOSITION_OK, NR, MC);
  add(E.NEED_LANDSCAPE, [RFC, MC, PWD, NR, WFP, WFL], WFL);
  add(E.NEED_PORTRAIT, [RFC, MC, PWD, NR, WFP, WFL], WFP);
  add(E.ORIENTATION_OK, [WFL, WFP], MC);

  // Chụp & kiểm tra
  add(E.SHUTTER_START, [RFC, NR, MC], CF);
  add(E.SHUTTER, [RFC, NR, MC], CCA);
  add(E.FRAME_GRABBED, [CF, CCA], VC);
  add(E.CAPTURE_VALID, VC, CA);
  add(E.CAPTURE_INVALID, VC, CR);
  add(E.CAPTURE_ABORT, [CF, CCA, VC], RFC);
  add(E.RETRY, CR, RFC);
  add(E.NEXT, CA, MC);
  add(E.ALL_DONE, CA, DONE);

  // Tiếp tục phiên đã có điểm xuất phát (không cần nhận diện lại)
  add(E.RESUME, WFV, MC);

  // Reset từ bất kỳ trạng thái nào
  add(E.RESET, Object.values(S), WFV);
  return t;
}

export const TRANSITIONS = Object.freeze(table());

export class StateMachine extends Emitter {
  constructor(initial = WFV) {
    super();
    this.state = initial;
    this.enteredAt = Date.now();
    this.history = [];
  }

  can(event) {
    return Boolean(TRANSITIONS[event]?.[this.state]);
  }

  /** @returns {{changed:boolean, from:string, to:string, rejected:boolean}} */
  send(event, payload) {
    const to = TRANSITIONS[event]?.[this.state];
    const from = this.state;
    if (!to) {
      log.debug(`FSM: bỏ qua ${event} tại ${from}`);
      return { changed: false, from, to: from, rejected: true };
    }
    if (to === from) return { changed: false, from, to, rejected: false };
    this.state = to;
    this.enteredAt = Date.now();
    this.history.push({ t: this.enteredAt, event, from, to });
    if (this.history.length > 60) this.history.shift();
    log.debug(`FSM: ${from} --${event}--> ${to}`);
    this.emit('transition', { event, from, to, payload });
    return { changed: true, from, to, rejected: false };
  }

  /** Thời gian (ms) đã ở trạng thái hiện tại. */
  dwell() {
    return Date.now() - this.enteredAt;
  }

  is(...states) {
    return states.includes(this.state);
  }

  isNavigating() {
    return NAV_STATES.includes(this.state);
  }
}

export const isCapturingState = (s) => s === CF || s === CCA || s === VC;
export const isTerminalHold = (s) => s === CA || s === CR || s === DONE;
export const NAVIGATION_STATES = Object.freeze(NAV_STATES);
