/**
 * movementTracker.js — Ước lượng vị trí NGƯỜI CHỤP quanh xe từ cảm biến + bằng chứng camera.
 *
 * Nguyên lý (heuristic, KHÔNG phải định vị chính xác):
 *   Khi người dùng đi vòng quanh xe và luôn hướng camera vào xe, hướng nhìn của camera (heading) quay
 *   cùng chiều kim đồng hồ theo đúng góc họ đã đi quanh xe. Vì vậy:
 *
 *      góc quỹ đạo θ = góc xuất phát + Δheading + Δ(độ lệch ngang của xe trong khung hình)
 *
 *   - Δheading lấy từ DeviceOrientation (gyro/accel, đã lọc) — chỉ dùng thay đổi TƯƠNG ĐỐI so với mốc,
 *     không phụ thuộc la bàn/GPS.
 *   - Δ độ lệch của xe trong khung hình (từ bbox AI) bù trường hợp người dùng xoay máy tại chỗ mà không di chuyển:
 *     khi đó heading đổi nhưng xe lệch ngược lại nên θ không đổi.
 *   - Xoay điện thoại ≠ di chuyển: mọi kết luận hướng đi đều dựa trên θ chứ không phải heading thô.
 *
 * Giới hạn: trôi gyro theo thời gian, người dùng không giữ xe ở giữa khung, đi thẳng thay vì đi vòng, nhiễu từ
 * trường… Vì vậy mọi kết quả đều kèm `confidence`, và ảnh chỉ được xác nhận khi có thêm bằng chứng hình ảnh
 * hoặc xác nhận thủ công.
 */
import { CONFIG } from './config.js';
import { DEG, Emitter, angleDiff, clamp, isSecure, log, now, wrap180, wrap360 } from './utils.js';
import { T } from './strings.js';

/** Hướng (độ, theo chiều kim đồng hồ từ bắc) mà camera SAU đang chiếu, từ alpha/beta/gamma. */
export function cameraHeading(alpha, beta, gamma) {
  const a = (alpha || 0) * DEG;
  const b = (beta || 0) * DEG;
  const g = (gamma || 0) * DEG;
  const cA = Math.cos(a); const sA = Math.sin(a);
  const sB = Math.sin(b);
  const cG = Math.cos(g); const sG = Math.sin(g);
  // hướng trục -z của thiết bị (mặt sau) trong hệ toạ độ Trái đất, chiếu lên mặt phẳng ngang
  const vx = -cA * sG - sA * sB * cG;
  const vy = -sA * sG + cA * sB * cG;
  const hmag = Math.hypot(vx, vy);
  return { heading: wrap360(Math.atan2(vx, vy) / DEG), hmag };
}

export class MovementTracker extends Emitter {
  constructor(cfg = CONFIG.sensors) {
    super();
    this.cfg = cfg;
    this.active = false;
    this.permission = 'unknown'; // unknown | granted | denied | unsupported | insecure
    this.source = 'device';      // 'device' | 'demo'
    this._bound = false;
    this.resetAll();
  }

  static isSupported() {
    return typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;
  }
  static needsPermission() {
    return typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function';
  }

  resetAll() {
    this.startedAt = 0;
    this.lastEventAt = 0;
    this.eventCount = 0;
    this.hasHeading = false;
    this.fx = 0; this.fy = 0;
    this.headingF = 0;
    this.cum = 0;
    this.hmag = 0;
    this.jitter = 0;
    this.tiltBad = false;
    this.visual = { offset: null, lastUpdate: 0 };
    this.origin = { set: false, angleDeg: 0, cum: 0, visual: 0 };
    this.samples = [];
    this.lastSampleT = 0;
    this.prevOrbit = null;
    this.cwRun = 0;
    this.ccwRun = 0;
    this.direction = 'unknown';
    this.dirCand = null;
    this.dirCandSince = 0;
    this.rate = 0;
    this.motion = { gyro: 0, accelDev: 0, lastAt: 0, steadySince: 0 };
    this.lastEmit = 0;
  }

  /* ---------------------------- quyền & vòng đời ---------------------------- */
  /**
   * Phải được gọi từ một thao tác bấm nút của người dùng (yêu cầu của iOS Safari).
   * @returns {Promise<{ok:boolean, state:string, message:string}>}
   */
  async requestPermission() {
    if (!isSecure()) return this._perm(false, 'insecure', T.sensors.insecure);
    if (!MovementTracker.isSupported()) return this._perm(false, 'unsupported', T.sensors.unsupported);
    if (!MovementTracker.needsPermission()) return this._perm(true, 'granted', T.sensors.granted);
    try {
      const motionReq = typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function'
        ? DeviceMotionEvent.requestPermission()
        : Promise.resolve('granted');
      const [o] = await Promise.all([DeviceOrientationEvent.requestPermission(), motionReq.catch(() => 'denied')]);
      return o === 'granted' ? this._perm(true, 'granted', T.sensors.granted) : this._perm(false, 'denied', T.sensors.denied);
    } catch (e) {
      log.warn('Xin quyền cảm biến lỗi:', e.name);
      return this._perm(false, 'denied', T.sensors.denied);
    }
  }
  _perm(ok, state, message) {
    this.permission = state;
    return { ok, state, message };
  }

  start() {
    if (this.active) return { ok: true };
    if (this.permission === 'denied' || this.permission === 'insecure' || !MovementTracker.isSupported()) {
      return { ok: false, message: this.permission === 'denied' ? T.sensors.denied : T.sensors.unsupported };
    }
    this._onOri = (e) => this._handleOrientation(e);
    this._onMot = (e) => this._handleMotion(e);
    window.addEventListener('deviceorientation', this._onOri, true);
    window.addEventListener('devicemotion', this._onMot, true);
    this.active = true;
    this.startedAt = now();
    return { ok: true };
  }

  stop() {
    if (this._onOri) window.removeEventListener('deviceorientation', this._onOri, true);
    if (this._onMot) window.removeEventListener('devicemotion', this._onMot, true);
    this._onOri = this._onMot = null;
    this.active = false;
  }

  /* ---------------------------- đầu vào ---------------------------- */
  _handleOrientation(e) {
    if (e.alpha == null && e.beta == null && e.gamma == null) return; // trình duyệt desktop bắn sự kiện rỗng
    const { heading, hmag } = cameraHeading(e.alpha, e.beta, e.gamma);
    this.ingestHeading(heading, { hmag });
  }

  _handleMotion(e) {
    const rr = e.rotationRate;
    const ag = e.accelerationIncludingGravity;
    this.ingestMotion({
      gyro: rr ? Math.hypot(rr.alpha || 0, rr.beta || 0, rr.gamma || 0) : null,
      accelDev: ag && ag.x != null ? Math.abs(Math.hypot(ag.x, ag.y, ag.z) - 9.81) : null,
    });
  }

  /**
   * Nhận một mẫu hướng (độ). Dùng chung cho cảm biến thật và chế độ DEMO/kiểm thử.
   */
  ingestHeading(headingDeg, { hmag = 1, t = now() } = {}) {
    const cfg = this.cfg;
    this.lastEventAt = t;
    this.eventCount += 1;
    this.hmag = hmag;
    if (hmag < cfg.minHorizontalMag) {
      this.tiltBad = true; // camera chúc xuống/ngẩng lên: hướng ngang không còn tin cậy
      return;
    }
    this.tiltBad = false;
    const r = headingDeg * DEG;
    if (!this.hasHeading) {
      this.fx = Math.cos(r); this.fy = Math.sin(r);
      this.headingF = wrap360(headingDeg);
      this.hasHeading = true;
      this.cum = 0;
    } else {
      this.fx += (Math.cos(r) - this.fx) * cfg.headingFilter;
      this.fy += (Math.sin(r) - this.fy) * cfg.headingFilter;
      const hf = wrap360(Math.atan2(this.fy, this.fx) / DEG);
      this.cum += wrap180(hf - this.headingF);
      this.headingF = hf;
      this.jitter += (Math.abs(angleDiff(headingDeg, hf)) - this.jitter) * 0.05;
    }
    this._sample(t);
  }

  ingestMotion({ gyro, accelDev, t = now() }) {
    const m = this.motion;
    const a = 0.3;
    if (gyro != null) m.gyro += (gyro - m.gyro) * a;
    if (accelDev != null) m.accelDev += (accelDev - m.accelDev) * a;
    m.lastAt = t;
    const calm = m.gyro < this.cfg.steadyRotationDegPerSec && m.accelDev < this.cfg.steadyAccelDeviation;
    if (calm) { if (!m.steadySince) m.steadySince = t; } else m.steadySince = 0;
  }

  /** Độ lệch ngang (độ) của xe so với tâm khung hình; null/unreliable => coi như không có bằng chứng mới. */
  setVisualOffset(offsetDeg, reliable = true) {
    if (offsetDeg == null || !reliable) return;
    const v = this.visual;
    const o = clamp(offsetDeg, -this.cfg.maxVisualOffsetDeg, this.cfg.maxVisualOffsetDeg);
    v.offset = v.offset == null ? o : v.offset + (o - v.offset) * this.cfg.visualFilter;
    v.lastUpdate = now();
  }

  /** Đặt mốc: vị trí hiện tại tương ứng góc quỹ đạo `angleDeg` (0 = đầu xe, 45 = trước phải, …). */
  setOrigin({ angleDeg = 0, visualOffsetDeg = null } = {}) {
    this.origin = { set: true, angleDeg, cum: this.cum, visual: visualOffsetDeg ?? this.visual.offset ?? 0 };
    this.samples = [];
    this.prevOrbit = null;
    this.cwRun = 0;
    this.ccwRun = 0;
    this.direction = this.hasHeading ? 'still' : 'unknown';
    this.dirCand = null;
    this.rate = 0;
    log.debug(`Mốc quỹ đạo = ${angleDeg}°`);
  }
  clearOrigin() {
    this.origin.set = false;
  }

  /* ---------------------------- tính toán ---------------------------- */
  orbitUnwrapped() {
    if (!this.origin.set) return null;
    const visualTerm = this.visual.offset == null ? 0 : this.visual.offset - this.origin.visual;
    return this.origin.angleDeg + (this.cum - this.origin.cum) + visualTerm;
  }

  _sample(t) {
    if (!this.origin.set) return;
    if (t - this.lastSampleT < 45) return;
    this.lastSampleT = t;
    const orbit = this.orbitUnwrapped();
    this.samples.push({ t, orbit });
    const win = this.cfg.rateWindowMs;
    while (this.samples.length > 2 && t - this.samples[0].t > win) this.samples.shift();

    // chuyển động ròng ngược/xuôi (bù trừ: đi xuôi triệt tiêu đi ngược gấp đôi)
    if (this.prevOrbit != null) {
      const d = orbit - this.prevOrbit;
      if (Math.abs(d) > 0.12) {
        if (d > 0) {
          this.cwRun += d;
          this.ccwRun = Math.max(0, this.ccwRun - d * 2);
        } else {
          this.ccwRun += -d;
          this.cwRun = Math.max(0, this.cwRun + d * 2);
        }
      }
    }
    this.prevOrbit = orbit;

    // tốc độ góc quỹ đạo
    const first = this.samples[0];
    const dt = (t - first.t) / 1000;
    this.rate = dt > 0.35 ? (orbit - first.orbit) / dt : this.rate;

    // hướng + hysteresis
    let cand = this.direction;
    if (this.rate > this.cfg.cwRateDegPerSec) cand = 'cw';
    else if (this.rate < -this.cfg.cwRateDegPerSec) cand = 'ccw';
    else if (Math.abs(this.rate) < this.cfg.stillRateDegPerSec) cand = 'still';
    if (this.direction === 'unknown') this.direction = cand;
    else if (cand !== this.direction) {
      if (this.dirCand !== cand) { this.dirCand = cand; this.dirCandSince = t; }
      else if (t - this.dirCandSince >= this.cfg.directionHoldMs) { this.direction = cand; this.dirCand = null; }
    } else this.dirCand = null;

    if (t - this.lastEmit >= this.cfg.emitIntervalMs) {
      this.lastEmit = t;
      this.emit('update', this.getSnapshot());
    }
  }

  status() {
    const t = now();
    if (this.permission === 'denied') return 'denied';
    if (this.permission === 'insecure') return 'insecure';
    if (this.source === 'demo') return this.eventCount > 0 && t - this.lastEventAt < this.cfg.staleMs * 3 ? 'ok' : 'stale';
    if (!MovementTracker.isSupported() || this.permission === 'unsupported') return 'unavailable';
    if (!this.active) return 'inactive';
    if (this.eventCount === 0) return t - this.startedAt > 1800 ? 'unavailable' : 'initializing';
    if (t - this.lastEventAt > this.cfg.staleMs && !this.tiltBad) return 'stale';
    return 'ok';
  }

  getSnapshot() {
    const t = now();
    const status = this.status();
    const orbit = this.orbitUnwrapped();
    const fresh = t - this.lastEventAt < this.cfg.staleMs * (this.source === 'demo' ? 3 : 1);
    const tiltQuality = clamp((this.hmag - 0.15) / 0.35, 0, 1);
    const noise = clamp(1 - this.jitter / 12, 0.3, 1);
    const visualFresh = this.visual.offset != null && t - this.visual.lastUpdate < 2500;
    const usable = status === 'ok' && this.origin.set && this.hasHeading && !this.tiltBad && fresh;
    let confidence = 0;
    if (usable) confidence = clamp((0.35 + 0.65 * tiltQuality) * noise * (visualFresh ? 1 : 0.72), 0, 1);

    const m = this.motion;
    const motionKnown = m.lastAt > 0 && t - m.lastAt < 1500;
    const steady = motionKnown ? m.steadySince > 0 && t - m.steadySince >= this.cfg.steadyHoldMs : Math.abs(this.rate) < this.cfg.steadyRotationDegPerSec;

    return {
      source: this.source,
      status,
      supported: MovementTracker.isSupported(),
      permission: this.permission,
      active: this.active,
      fresh,
      calibrated: this.origin.set,
      usable,
      tiltBad: this.tiltBad,
      headingDeg: this.hasHeading ? this.headingF : null,
      orbitUnwrapped: orbit,
      orbitDeg: orbit == null ? null : wrap360(orbit),
      rateDegPerSec: this.rate,
      direction: this.direction,
      cwTravelDeg: this.cwRun,
      ccwTravelDeg: this.ccwRun,
      confidence,
      steady,
      motionKnown,
      shake: motionKnown ? m.gyro : null,
      visualOffsetDeg: this.visual.offset,
      visualFresh,
      jitterDeg: this.jitter,
      updatedAt: this.lastEventAt,
    };
  }

  /** Dành cho DEMO/kiểm thử: đánh dấu nguồn dữ liệu giả lập. */
  useSyntheticSource(on = true) {
    this.source = on ? 'demo' : 'device';
    if (on) {
      this.permission = 'granted';
      this.active = true;
      this.startedAt = now();
    }
  }
}

/* Singleton dùng trong ứng dụng; test có thể tự tạo instance riêng. */
export const movementTracker = new MovementTracker();
export const startMovementTracking = () => movementTracker.start();
export const stopMovementTracking = () => movementTracker.stop();
