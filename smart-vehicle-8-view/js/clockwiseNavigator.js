/**
 * clockwiseNavigator.js — Điều hướng chụp 8 góc theo chiều kim đồng hồ.
 *
 * Navigator KHÔNG sửa DOM và KHÔNG tự đổi state: mỗi lần `evaluate()` nó trả về
 *   { event, guidance, arrow, target, info }
 * trong đó `event` là sự kiện để đưa vào state machine (stateMachine.js) và `guidance` là MỘT chỉ dẫn chính.
 * Thứ tự ưu tiên cảnh báo (cao → thấp):
 *   hướng điện thoại sai → không thấy xe → đi ngược chiều → xe/khung chưa đạt (khi đã gần góc) → hướng dẫn di chuyển.
 * Nhờ vậy khi không thấy xe, ứng dụng không đồng thời bảo người dùng đổi hướng di chuyển.
 *
 * Đi sai chiều chỉ được kết luận khi: cảm biến đủ tin cậy + đi ngược liên tục ≥ wrongDirectionMs + đã đi ngược
 * ≥ wrongDirectionMinDeg. Thứ tự 8 góc không bao giờ bị đổi vì cảm biến nhiễu.
 */
import { ANGLES, ANGLE_BY_KEY, CONFIG } from './config.js';
import { E, S } from './stateMachine.js';
import { T, angleName } from './strings.js';

const G = (id, text, level = 'info', extra = {}) => ({ id, text, level, ...extra });

export class ClockwiseNavigator {
  constructor(cfg = CONFIG.navigation, angleCfg = CONFIG.angle) {
    this.cfg = cfg;
    this.angleCfg = angleCfg;
    this.reset();
  }

  /**
   * @param {{startIndex?:number, retakeKey?:string|null}} o
   */
  reset({ startIndex = 0, retakeKey = null, calibrate = false, firstCaptureDone = false } = {}) {
    this.startIndex = startIndex;
    this.retakeKey = retakeKey;
    this.calibrate = calibrate;
    this.retakeDone = false;
    this.manualTarget = null;
    this.startConfirmed = false;
    this.originKey = null;
    this.firstCaptureDone = firstCaptureDone;
    this.acceptedAt = 0;
    this.nearFlag = false;
    this.wrongFlag = false;
    this._wrongSince = null;
    this._cwSince = null;
    this._orientMis = null;
    this._lostSince = null;
    this._locateSince = null;
    this._lastGuidance = null;
  }

  /** Thứ tự 8 góc, bắt đầu từ góc xuất phát. */
  get order() {
    return [...ANGLES.slice(this.startIndex), ...ANGLES.slice(0, this.startIndex)].map((a) => a.key);
  }
  get startKey() {
    return ANGLES[this.startIndex].key;
  }

  /** Góc kế tiếp theo thứ tự chuẩn mà chưa được chấp nhận. */
  getNextExpectedAngle(captures = {}) {
    return this.order.find((k) => !captures[k]?.accepted) ?? null;
  }

  currentTarget(captures = {}) {
    if (this.retakeKey) return this.retakeDone ? null : this.retakeKey;
    if (this.manualTarget) return this.manualTarget;
    return this.getNextExpectedAngle(captures);
  }

  setManualTarget(key) {
    this.manualTarget = ANGLE_BY_KEY[key] ? key : null;
    this.nearFlag = false;
    this.wrongFlag = false;
  }

  confirmStart(angleKey) {
    this.startConfirmed = true;
    this.originKey = angleKey;
    this.nearFlag = false;
  }

  notifyAccepted(key) {
    this.firstCaptureDone = true;
    this.acceptedAt = Date.now();
    this.nearFlag = false;
    this.wrongFlag = false;
    this._wrongSince = null;
    if (key === this.manualTarget) this.manualTarget = null;
    if (key === this.retakeKey) this.retakeDone = true;
  }

  /** Hướng dẫn chung cho chế độ chụp lại/chọn tay: được phép đi theo hướng ngắn nhất. */
  get freeDirection() {
    return Boolean(this.retakeKey || this.manualTarget);
  }

  /* ------------------------------------------------------------------ */
  /* Bằng chứng đi sai chiều                                              */
  /* ------------------------------------------------------------------ */
  detectWrongDirection(sensors, now) {
    const c = this.cfg;
    if (this.freeDirection || !this.firstCaptureDone) {
      this._wrongSince = null; this.wrongFlag = false;
      return { flag: false };
    }
    if (!sensors?.usable || sensors.confidence < c.wrongDirectionMinSensorConf) {
      this._wrongSince = null;
      if (this.wrongFlag && !sensors?.usable) this.wrongFlag = false; // mất bằng chứng thì không giữ kết luận cũ
      return { flag: this.wrongFlag };
    }
    const ccw = sensors.direction === 'ccw' && sensors.ccwTravelDeg >= c.wrongDirectionMinDeg;
    if (ccw) {
      this._cwSince = null;
      this._wrongSince ??= now;
      if (now - this._wrongSince >= c.wrongDirectionMs) this.wrongFlag = true;
    } else {
      this._wrongSince = null;
      if (this.wrongFlag) {
        if (sensors.direction === 'cw' || this.nearFlag) {
          this._cwSince ??= now;
          if (now - this._cwSince >= c.wrongDirectionClearMs) { this.wrongFlag = false; this._cwSince = null; }
        } else this._cwSince = null;
      }
    }
    return { flag: this.wrongFlag };
  }

  /* ------------------------------------------------------------------ */
  /* Vấn đề về xe/khung hình                                              */
  /* ------------------------------------------------------------------ */
  vehicleProblem(v, { includeLost = true } = {}) {
    if (!v?.present) return includeLost ? { id: 'lost', text: T.guidance.vehicleLost, level: 'warn' } : null;
    if (v.multiple) return { id: 'multi', text: T.guidance.multipleVehicles, level: 'warn' };
    if (v.clipped?.severe || v.areaRatio > CONFIG.detection.maxAreaRatio) return { id: 'close', text: T.guidance.stepBack, level: 'warn' };
    if (v.clipped?.any) return { id: 'clip', text: T.guidance.fitVehicle, level: 'warn' };
    if (v.tooFar) return { id: 'far', text: T.guidance.stepCloser, level: 'warn' };
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* Đánh giá một nhịp                                                    */
  /* ------------------------------------------------------------------ */
  /**
   * @param {object} inp
   * @param {number} inp.now                    Date.now()
   * @param {string} inp.fsmState
   * @param {object} inp.captures               angleKey -> meta
   * @param {{vehicle:object, screenOrientation:'portrait'|'landscape'}} inp.analysis
   * @param {object} inp.sensors                snapshot MovementTracker
   * @param {object} inp.angle                  kết quả ViewAngleDetector
   * @param {{status:string}} inp.startId       trạng thái nhận diện điểm xuất phát
   * @param {string} [inp.rejectMessage]
   * @param {boolean} inp.demo
   */
  evaluate(inp) {
    const { fsmState: st, captures, analysis } = inp;
    const target = this.currentTarget(captures);
    const out = { event: null, guidance: null, arrow: { show: false }, target, info: { near: false, deltaDeg: null, manualMode: false } };
    const A = target ? ANGLE_BY_KEY[target] : null;

    // Các trạng thái do captureController điều khiển — navigator chỉ đưa ra thông điệp thụ động.
    switch (st) {
      case S.COMPLETED: out.guidance = G('completed', T.guidance.completed, 'ok'); return out;
      case S.CAPTURING_FRONT:
      case S.CAPTURING_CURRENT_ANGLE: out.guidance = G('capturing', T.guidance.capturing, 'info'); return out;
      case S.VALIDATING_CAPTURE: out.guidance = G('validating', T.guidance.validating, 'info'); return out;
      case S.CAPTURE_ACCEPTED: out.guidance = G('accepted', T.guidance.accepted, 'ok'); return out;
      case S.CAPTURE_REJECTED: out.guidance = G('rejected', inp.rejectMessage || T.guidance.rejected, 'error'); return out;
      default: break;
    }
    if (!target) return out;

    return this.startConfirmed ? this._evalNavigation(inp, A, out) : this._evalPreStart(inp, A, out);
  }

  _evalPreStart(inp, A, out) {
    const { fsmState: st, analysis, startId } = inp;
    const v = analysis.vehicle;
    const retake = Boolean(this.retakeKey || this.manualTarget || this.calibrate);

    if (!v.present) {
      if (st !== S.WAITING_FOR_VEHICLE) out.event = { name: E.VEHICLE_LOST };
      out.guidance = G('finding', T.guidance.findingVehicle, 'info', { icon: 'search' });
      return out;
    }
    if (st === S.WAITING_FOR_VEHICLE) {
      out.event = { name: E.VEHICLE_FOUND };
      out.guidance = G('detected_fit', T.guidance.vehicleDetectedFit, 'info', { icon: 'car' });
      return out;
    }
    const problem = this.vehicleProblem(v, { includeLost: false });
    if (st === S.VEHICLE_DETECTED) {
      if (!problem && v.stable && v.stableMs >= this.cfg.startIdentifyMinStableMs) {
        out.event = { name: E.VEHICLE_STABLE };
        out.guidance = G('identify', retake ? T.guidance.calibrateRetake(A.name) : T.guidance.identifyingStart, 'info', { icon: 'car' });
      } else if (problem) {
        out.guidance = G(`pre_${problem.id}`, problem.id === 'multi' ? problem.text : T.guidance.vehicleDetectedFit, problem.level, { icon: 'car' });
      } else {
        out.guidance = G('detected_hold', T.guidance.vehicleDetectedHold, 'info', { icon: 'car' });
      }
      return out;
    }
    // IDENTIFYING_START_POINT
    if (retake) out.guidance = G('calibrate', T.guidance.calibrateRetake(A.name), 'info', { icon: 'car' });
    else if (startId?.status === 'side') out.guidance = G('start_side', T.guidance.startFromSide, 'warn', { icon: 'rotate' });
    else if (startId?.status === 'needs_confirm') out.guidance = G('confirm_start', T.guidance.confirmStart, 'info', { icon: 'car' });
    else if (startId?.status === 'confirmed') out.guidance = G('start_front', T.guidance.startFromFront, 'ok', { icon: 'car' });
    else out.guidance = G('identify', T.guidance.identifyingStart, 'info', { icon: 'car' });
    if (problem && problem.id === 'multi') out.guidance = G('pre_multi', problem.text, 'warn', { icon: 'car' });
    return out;
  }

  _evalNavigation(inp, A, out) {
    const { now, fsmState: st, analysis, sensors, angle, captures } = inp;
    const v = analysis.vehicle;
    const orient = analysis.screenOrientation;
    const cfg = this.cfg;
    const target = A.key;

    /* --- 1. hướng điện thoại --- */
    if (orient !== A.orientation) {
      this._orientMis ??= now;
      const want = A.orientation === 'portrait' ? S.WAITING_FOR_PORTRAIT : S.WAITING_FOR_LANDSCAPE;
      if (now - this._orientMis >= cfg.orientationDebounceMs && st !== want) {
        out.event = { name: A.orientation === 'portrait' ? E.NEED_PORTRAIT : E.NEED_LANDSCAPE };
      }
      out.guidance = G(`rotate_${A.orientation}_${target}`, A.orientation === 'portrait' ? T.guidance.rotatePortrait(A.name) : T.guidance.rotateLandscape(A.name), 'warn', { icon: 'rotate', rotate: A.orientation });
      return out;
    }
    this._orientMis = null;
    const needOrientExit = st === S.WAITING_FOR_PORTRAIT || st === S.WAITING_FOR_LANDSCAPE;
    if (needOrientExit) {
      out.event = { name: E.ORIENTATION_OK };
      out.guidance = G('orient_ok', T.guidance.moveToDetailed(A.name), 'info', { icon: 'arrow' });
      return out;
    }

    /* --- 2. không thấy xe (có thời gian châm chước) --- */
    if (!v.present) {
      this._lostSince ??= now;
      if (now - this._lostSince >= cfg.vehicleLostGraceMs) {
        if (st !== S.NEED_REPOSITION) out.event = { name: E.NEED_REPOSITION };
        out.guidance = G('lost', T.guidance.vehicleLost, 'warn', { icon: 'search' });
        return out;
      }
    } else this._lostSince = null;

    /* --- 3. mốc cảm biến --- */
    const sensorsUsable = Boolean(sensors?.usable);
    const sensorless = ['unavailable', 'denied', 'insecure', 'inactive'].includes(sensors?.status);
    if (!sensorsUsable && !sensorless) this._locateSince ??= now; else this._locateSince = null;
    const locateTimedOut = this._locateSince != null && now - this._locateSince > cfg.locateTimeoutMs;
    const manualMode = sensorless || locateTimedOut;
    out.info.manualMode = manualMode;
    out.info.sensorsUsable = sensorsUsable;

    /* --- 4. đi ngược chiều --- */
    const wrong = this.detectWrongDirection(sensors, now);
    if (wrong.flag && v.present) {
      if (st !== S.POSSIBLE_WRONG_DIRECTION) out.event = { name: E.WRONG_DIRECTION };
      out.guidance = G('wrong_dir', T.guidance.wrongDirection(A.name), 'error', { icon: 'arrow' });
      out.arrow = { show: true, dir: 'left', tone: 'error', label: 'Quay lại' };
      return out;
    }
    if (st === S.POSSIBLE_WRONG_DIRECTION) {
      out.event = { name: E.DIRECTION_OK };
      out.guidance = G('dir_ok', T.guidance.movingOk, 'ok', { icon: 'arrow' });
      return out;
    }

    /* --- 5. khoảng cách tới góc mục tiêu --- */
    let near = null;
    let delta = null;
    if (sensorsUsable && angle?.deltaToTargetDeg != null) {
      delta = angle.deltaToTargetDeg; // + = mục tiêu nằm phía trước theo chiều kim đồng hồ
      const abs = Math.abs(delta);
      this.nearFlag = this.nearFlag ? abs <= this.angleCfg.toleranceExitDeg : abs <= this.angleCfg.toleranceEnterDeg;
      near = this.nearFlag;
    } else if (manualMode) {
      near = Date.now() - this.acceptedAt >= cfg.sensorlessReadyDelayMs || !this.firstCaptureDone;
      this.nearFlag = near;
    } else {
      this.nearFlag = false;
    }
    out.info.near = Boolean(near);
    out.info.deltaDeg = delta;

    const firstCapture = !this.firstCaptureDone;
    const free = this.freeDirection;

    /* --- 6a. chưa xác định được vị trí --- */
    if (near == null) {
      if (st === S.READY_FOR_CAPTURE) out.event = { name: E.LEFT_TARGET };
      out.guidance = G('locating', T.guidance.locating, 'info', { icon: 'search' });
      return out;
    }

    /* --- 6b. chưa tới góc mục tiêu --- */
    if (!near) {
      if (st === S.READY_FOR_CAPTURE) out.event = { name: E.LEFT_TARGET };
      else if (st === S.NEED_REPOSITION && v.present) out.event = { name: E.REPOSITION_OK };
      const overshoot = delta != null && delta < -this.angleCfg.toleranceExitDeg && !free;
      const forward = delta == null ? true : free ? delta >= 0 : !overshoot;
      out.arrow = { show: true, dir: forward ? 'left' : 'right', tone: overshoot ? 'warn' : 'info', label: forward ? 'Đi tiếp' : 'Quay lại' };
      out.guidance = overshoot
        ? G('overshoot', T.guidance.overshoot(A.name), 'warn', { icon: 'arrow' })
        : G(`move_${target}`, T.guidance.moveToDetailed(A.name), 'info', { icon: 'arrow', sub: free ? null : 'Đi sang bên TRÁI của bạn, vòng quanh xe theo chiều kim đồng hồ.' });
      return out;
    }

    /* --- 6c. đã gần góc mục tiêu: kiểm tra xe/khung --- */
    const problem = this.vehicleProblem(v);
    if (problem) {
      if (st !== S.NEED_REPOSITION) out.event = { name: E.NEED_REPOSITION };
      out.guidance = G(`near_${problem.id}`, problem.text, problem.level, { icon: 'car' });
      return out;
    }
    // góc hình học không khớp (chỉ khi có bằng chứng hình ảnh đáng tin)
    if (angle?.visualReliable && angle.visualConsistencyTarget < this.angleCfg.minVisualConsistency) {
      if (st !== S.NEED_REPOSITION) out.event = { name: E.NEED_REPOSITION };
      out.guidance = delta != null
        ? G('angle_off', delta >= 0 ? T.guidance.angleOff(A.name) : T.guidance.angleOffBack(A.name), 'warn', { icon: 'arrow' })
        : G('angle_off_manual', T.guidance.angleOffGeneric(A.name), 'warn', { icon: 'arrow' });
      return out;
    }

    // sẵn sàng chụp
    if (st !== S.READY_FOR_CAPTURE) {
      out.event = { name: E.AT_TARGET };
    }
    if (manualMode && !firstCapture) out.guidance = G(`manual_${target}`, T.guidance.manualMove(A.name), 'info', { icon: 'camera' });
    else out.guidance = G(`ready_${target}`, firstCapture && !free ? T.guidance.readyStart(A.name) : T.guidance.holdSteady, 'ok', { icon: 'camera' });
    out.info.ready = true;
    return out;
  }
}

export { angleName };
