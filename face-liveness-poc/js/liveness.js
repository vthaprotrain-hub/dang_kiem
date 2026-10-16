/**
 * liveness.js — Máy trạng thái thử thách hành vi cơ bản (chớp mắt / quay đầu).
 *
 * ⚠️ GIỚI HẠN: đây KHÔNG phải anti-spoofing. Thử thách chớp mắt/quay đầu không chống được mọi ảnh/video
 * phát lại hay tấn công bằng màn hình. Kết quả tốt nhất có thể nói là "đã hoàn thành thử thách cơ bản".
 *
 * Module này không đụng DOM và không đọc đồng hồ: thời gian luôn được truyền vào (`now`, ms) nên có thể
 * kiểm thử bằng dữ liệu tổng hợp.
 *
 * Mỗi mẫu đầu vào (`update`) gồm:
 *   faceOk   : có đúng một khuôn mặt hợp lệ
 *   ear      : Eye Aspect Ratio trung bình hai mắt (null nếu không có)
 *   yaw      : độ; dương = người dùng quay sang TRÁI của họ
 *   frontalOk: góc yaw/pitch/roll đang trong ngưỡng "nhìn thẳng"
 */

import { median } from './quality-validator.js';

export const LivenessState = Object.freeze({
  IDLE: 'IDLE',
  CHALLENGE_STARTED: 'CHALLENGE_STARTED',
  WAITING_FOR_ACTION: 'WAITING_FOR_ACTION',
  ACTION_DETECTED: 'ACTION_DETECTED',
  LIVENESS_INCONCLUSIVE: 'LIVENESS_INCONCLUSIVE',
  CHALLENGE_PASSED: 'CHALLENGE_PASSED',
});

export const ChallengeType = Object.freeze({
  BLINK: 'BLINK',
  TURN_LEFT: 'TURN_LEFT',
  TURN_RIGHT: 'TURN_RIGHT',
});

// 6 điểm quanh mỗi mắt: [p1 khoé ngoài, p2, p3 (mí trên), p4 khoé trong, p5, p6 (mí dưới)]
const EYE_IMAGE_LEFT = [33, 160, 158, 133, 153, 144];
const EYE_IMAGE_RIGHT = [362, 385, 387, 263, 373, 380];

/**
 * Eye Aspect Ratio = (|p2−p6| + |p3−p5|) / (2·|p1−p4|), tính trong cùng thang đo
 * (y được quy về đơn vị chiều rộng bằng cách chia cho aspect = videoW / videoH).
 */
export function computeEAR(lm, aspect) {
  const dist = (a, b) => Math.hypot(lm[a].x - lm[b].x, (lm[a].y - lm[b].y) / aspect);
  const eye = (idx) => {
    const horizontal = dist(idx[0], idx[3]);
    if (horizontal < 1e-6) return NaN;
    return (dist(idx[1], idx[5]) + dist(idx[2], idx[4])) / (2 * horizontal);
  };
  const a = eye(EYE_IMAGE_LEFT);
  const b = eye(EYE_IMAGE_RIGHT);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return { mean: (a + b) / 2, imageLeft: a, imageRight: b };
}

/** Chọn ngẫu nhiên `count` thử thách khác nhau, tránh lặp lại thử thách đầu tiên của lần trước. */
export function pickChallenges(pool, count, rng, avoidFirst = null) {
  const available = [...pool];
  const picked = [];
  while (picked.length < count && available.length) {
    let candidates = available;
    if (picked.length === 0 && avoidFirst && available.length > 1) {
      candidates = available.filter((t) => t !== avoidFirst);
    }
    const t = candidates[Math.min(candidates.length - 1, Math.floor(rng() * candidates.length))];
    picked.push(t);
    available.splice(available.indexOf(t), 1);
  }
  return picked;
}

export class LivenessChallenge {
  /**
   * @param {object} cfg  CONFIG.liveness
   * @param {() => number} [rng]  nguồn ngẫu nhiên [0,1)
   * @param {{turnMaxDeg:number}} [poseCfg]  không dùng; giữ chữ ký ổn định
   */
  constructor(cfg, rng = Math.random) {
    this.cfg = cfg;
    this.rng = rng;
    this.lastFirstType = null;
    this.reset();
  }

  // ----------------------------------------------------------------------------- vòng đời

  reset() {
    this.state = LivenessState.IDLE;
    this.steps = [];
    this.stepIndex = 0;
    this.phase = null; // 'ACTION' | 'RETURN'
    this.reason = null;
    this.startedAt = null;
    this.promptTs = null;
    this.deadline = null;
    this.actionAt = null;
    this.passedAt = null;
    this.faceLostSince = null;
    this.baseline = { windowStart: null, ears: [], ear: null };
    this.blinkSt = null;
    this.turnSt = null;
    this.returnSt = null;
    this.wrongDirection = false;
    this.events = [];
  }

  /** Bắt đầu một lần xác minh mới với thử thách ngẫu nhiên. */
  start(now) {
    this.reset();
    this.steps = pickChallenges(this.cfg.challenges, this.cfg.challengeCount, this.rng, this.lastFirstType);
    this.lastFirstType = this.steps[0] || null;
    this.state = LivenessState.CHALLENGE_STARTED;
    this.startedAt = now;
    this.log(now, 'start', { steps: this.steps.join(',') });
  }

  get active() {
    return (
      this.state === LivenessState.CHALLENGE_STARTED ||
      this.state === LivenessState.WAITING_FOR_ACTION ||
      this.state === LivenessState.ACTION_DETECTED
    );
  }

  get currentType() {
    return this.steps[this.stepIndex] || null;
  }

  /** Khoá thông báo hiện tại cho UI. */
  get instructionKey() {
    switch (this.state) {
      case LivenessState.CHALLENGE_STARTED:
        return 'CHECKING';
      case LivenessState.WAITING_FOR_ACTION:
        if (this.currentType === ChallengeType.BLINK) return 'BLINK';
        if (this.currentType === ChallengeType.TURN_LEFT) return this.wrongDirection ? 'TURN_LEFT_WRONG' : 'TURN_LEFT';
        return this.wrongDirection ? 'TURN_RIGHT_WRONG' : 'TURN_RIGHT';
      case LivenessState.ACTION_DETECTED:
        return this.phase === 'RETURN' ? 'RETURN_FRONT' : 'ACTION_OK';
      case LivenessState.LIVENESS_INCONCLUSIVE:
        return 'LIVENESS_FAILED';
      case LivenessState.CHALLENGE_PASSED:
        return 'LIVENESS_DONE';
      default:
        return null;
    }
  }

  isValid(now) {
    return this.state === LivenessState.CHALLENGE_PASSED && now - this.passedAt <= this.cfg.validityMs;
  }

  remainingMs(now) {
    if (this.deadline == null || !this.active) return null;
    return Math.max(0, this.deadline - now);
  }

  snapshot(now) {
    return {
      state: this.state,
      type: this.currentType,
      step: `${Math.min(this.stepIndex + 1, this.steps.length)}/${this.steps.length}`,
      phase: this.phase,
      reason: this.reason,
      remainingMs: this.remainingMs(now),
      baselineEar: this.baseline.ear,
      wrongDirection: this.wrongDirection,
      instructionKey: this.instructionKey,
    };
  }

  log(now, name, extra = {}) {
    this.events.push({ t: Math.round(now), name, ...extra });
    if (this.events.length > 30) this.events.shift();
  }

  // ----------------------------------------------------------------------------- cập nhật

  update(sample, now) {
    if (!this.active) return;

    // Mất mặt: tạm thời chấp nhận, quá lâu thì huỷ.
    if (!sample.faceOk) {
      if (this.faceLostSince === null) this.faceLostSince = now;
      this.baseline.windowStart = null;
      this.baseline.ears.length = 0;
      if (now - this.faceLostSince > this.cfg.faceLostMs) this.fail('FACE_LOST', now);
      return;
    }
    this.faceLostSince = null;

    switch (this.state) {
      case LivenessState.CHALLENGE_STARTED:
        this.updateBaseline(sample, now);
        break;
      case LivenessState.WAITING_FOR_ACTION:
        if (now > this.deadline) {
          this.fail('TIMEOUT', now);
          return;
        }
        if (this.currentType === ChallengeType.BLINK) this.updateBlink(sample, now);
        else this.updateTurn(sample, now);
        break;
      case LivenessState.ACTION_DETECTED:
        this.updateAfterAction(sample, now);
        break;
      default:
    }
  }

  fail(reason, now) {
    this.state = LivenessState.LIVENESS_INCONCLUSIVE;
    this.reason = reason;
    this.deadline = null;
    this.log(now, 'inconclusive', { reason });
  }

  // ----------------------------------------------------------------------------- đường nền

  /**
   * Trước khi phát lệnh phải thu được "đường nền": mắt mở và đầu thẳng liên tục `baselineMs`.
   * Nhờ vậy một cái chớp mắt/ tư thế có sẵn từ trước không thể được tính là phản hồi cho lệnh.
   */
  updateBaseline(s, now) {
    const cfg = this.cfg;
    const b = this.baseline;
    if (now - this.startedAt > cfg.baselineTimeoutMs) {
      this.fail('BASELINE_FAILED', now);
      return;
    }
    const eyesOpen = s.ear != null && s.ear >= cfg.blink.minOpenEar;
    if (!(eyesOpen && s.frontalOk)) {
      b.windowStart = null;
      b.ears.length = 0;
      return;
    }
    if (b.windowStart === null) b.windowStart = now;
    b.ears.push(s.ear);
    if (now - b.windowStart >= cfg.baselineMs && b.ears.length >= cfg.baselineMinSamples) {
      b.ear = median(b.ears);
      this.beginStep(now);
    }
  }

  beginStep(now) {
    this.state = LivenessState.WAITING_FOR_ACTION;
    this.phase = 'ACTION';
    this.promptTs = now;
    this.deadline = now + this.cfg.stepTimeoutMs;
    this.wrongDirection = false;
    this.blinkSt = { openSeen: false, closed: false, closedSince: null, closedSamples: 0, minEar: Infinity };
    this.turnSt = { holdStart: null, count: 0, wrongStart: null };
    this.returnSt = null;
    this.log(now, 'prompt', { type: this.currentType });
  }

  // ----------------------------------------------------------------------------- chớp mắt

  updateBlink(s, now) {
    if (s.ear == null) return;
    const cfg = this.cfg.blink;
    const base = this.baseline.ear;
    const closeThr = base * cfg.closeRatio;
    const openThr = base * cfg.openRatio;
    const st = this.blinkSt;
    const afterGrace = now >= this.promptTs + this.cfg.promptGraceMs;

    if (!st.closed) {
      if (s.ear >= openThr) {
        // Chỉ tính "mắt đã mở" từ sau thời gian chờ phản xạ → cú chớp phải BẮT ĐẦU sau lệnh.
        if (afterGrace) st.openSeen = true;
      } else if (s.ear <= closeThr && st.openSeen) {
        st.closed = true;
        st.closedSince = now;
        st.closedSamples = 1;
        st.minEar = s.ear;
      }
      return;
    }

    // Đang nhắm
    if (s.ear < openThr) {
      st.closedSamples++;
      st.minEar = Math.min(st.minEar, s.ear);
      if (now - st.closedSince > cfg.maxClosedMs) {
        // Nhắm quá lâu: không phải chớp mắt. Bắt buộc mở lại rồi chớp lại.
        st.closed = false;
        st.openSeen = false;
        this.log(now, 'blink-too-long');
      }
      return;
    }
    // Mở lại
    const duration = now - st.closedSince;
    st.closed = false;
    if (duration >= cfg.minClosedMs && duration <= cfg.maxClosedMs && st.closedSamples >= cfg.minClosedSamples) {
      this.log(now, 'blink', { durationMs: Math.round(duration), minEar: +st.minEar.toFixed(3) });
      this.actionDetected(now);
    } else {
      this.log(now, 'blink-rejected', { durationMs: Math.round(duration), samples: st.closedSamples });
    }
  }

  // ----------------------------------------------------------------------------- quay đầu

  updateTurn(s, now) {
    if (s.yaw == null) return;
    const cfg = this.cfg.turn;
    const dir = this.currentType === ChallengeType.TURN_LEFT ? 1 : -1;
    const signed = dir * s.yaw; // dương = đúng hướng yêu cầu
    const st = this.turnSt;

    if (signed >= cfg.minDeg) {
      st.holdStart ??= now;
      st.count++;
      if (now - st.holdStart >= cfg.holdMs && st.count >= cfg.minSamples) {
        this.log(now, 'turn', { yaw: +s.yaw.toFixed(1) });
        this.actionDetected(now);
      }
      return;
    }
    st.holdStart = null;
    st.count = 0;

    if (-signed >= cfg.minDeg) {
      st.wrongStart ??= now;
      if (!this.wrongDirection && now - st.wrongStart >= cfg.holdMs) {
        this.wrongDirection = true;
        this.log(now, 'wrong-direction', { yaw: +s.yaw.toFixed(1) });
      }
    } else {
      st.wrongStart = null;
      if (Math.abs(s.yaw) <= cfg.minDeg / 2) this.wrongDirection = false;
    }
  }

  // ----------------------------------------------------------------------------- sau hành động

  actionDetected(now) {
    this.state = LivenessState.ACTION_DETECTED;
    this.actionAt = now;
    this.blinkSt = null;
    if (this.currentType === ChallengeType.BLINK) {
      this.phase = 'ACTION';
    } else {
      // Quay đầu xong phải quay lại nhìn thẳng.
      this.phase = 'RETURN';
      this.deadline = now + this.cfg.returnTimeoutMs;
      this.returnSt = { holdStart: null, count: 0 };
    }
  }

  updateAfterAction(s, now) {
    if (this.phase === 'RETURN') {
      if (now > this.deadline) {
        this.fail('TIMEOUT_RETURN', now);
        return;
      }
      const cfg = this.cfg.turn;
      const st = this.returnSt;
      if (s.frontalOk) {
        st.holdStart ??= now;
        st.count++;
        if (now - st.holdStart >= cfg.returnHoldMs && st.count >= cfg.minSamples) {
          this.log(now, 'returned');
          this.advance(now);
        }
      } else {
        st.holdStart = null;
        st.count = 0;
      }
      return;
    }
    if (now - this.actionAt >= this.cfg.actionDisplayMs) this.advance(now);
  }

  advance(now) {
    this.stepIndex++;
    if (this.stepIndex >= this.steps.length) {
      this.state = LivenessState.CHALLENGE_PASSED;
      this.passedAt = now;
      this.deadline = null;
      this.phase = null;
      this.log(now, 'passed');
    } else {
      this.beginStep(now);
    }
  }
}
