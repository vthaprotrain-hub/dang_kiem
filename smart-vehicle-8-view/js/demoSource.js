/**
 * demoSource.js — Chế độ DEMO: nguồn dữ liệu GIẢ LẬP để thử giao diện, state machine và điều hướng
 * khi không có camera/xe thật.
 *
 * Quy tắc trung thực:
 *   - Mọi khung hình DEMO là ảnh wireframe tổng hợp và mang watermark "DEMO — DỮ LIỆU GIẢ LẬP"
 *     (cả khung xem trực tiếp lẫn ảnh "chụp").
 *   - Bounding box DEMO được TÍNH từ mô hình hình học giả lập, hiển thị bằng nét đứt màu cam + nhãn DEMO,
 *     không bao giờ trình bày như kết quả của COCO-SSD.
 *   - Cảm biến DEMO là các góc hướng giả lập được đưa vào CHÍNH MovementTracker/ClockwiseNavigator thật,
 *     nhờ đó logic điều hướng, phát hiện đi sai chiều, state machine… được kiểm thử bằng cùng một đường mã.
 */
import { ANGLES, ANGLE_BY_KEY } from './config.js';
import { computeClipping } from './aiDetector.js';
import { movementTracker } from './movementTracker.js';
import { drawVehicleToCanvas, layoutVehicle } from './placeholders.js';
import { clamp, clearNode, h, sleep, wrap360 } from './utils.js';
import { toast } from './uiKit.js';

export const DEMO_LABEL = 'DEMO — DỮ LIỆU GIẢ LẬP';
const HEADING0 = 40; // hướng giả lập tại góc 0°

const FRAME = { landscape: { w: 960, h: 720 }, portrait: { w: 720, h: 960 } };

/* ----------------------------- vẽ cảnh tổng hợp ----------------------------- */
function paintBackground(ctx, w, hgt, az = 0) {
  const horizon = hgt * 0.56;
  let g = ctx.createLinearGradient(0, 0, 0, horizon);
  g.addColorStop(0, '#4b6674');
  g.addColorStop(1, '#2c3d47');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, horizon);
  g = ctx.createLinearGradient(0, horizon, 0, hgt);
  g.addColorStop(0, '#3a474e');
  g.addColorStop(1, '#1b2429');
  ctx.fillStyle = g;
  ctx.fillRect(0, horizon, w, hgt - horizon);

  // Hậu cảnh dạng toàn cảnh 360°: toà nhà đứng yên trong "thế giới", khi người dùng đi vòng quanh xe chúng dịch chuyển theo
  // hướng nhìn (camera ở phương vị az nhìn vào xe => hướng nhìn = az + 180). Nhờ vậy mỗi góc chụp có hậu cảnh khác nhau như ngoài đời.
  const fov = 62;
  const view = (az ?? 0) + 180;
  const wrap = (d) => ((((d + 180) % 360) + 360) % 360) - 180;
  const N = 24;
  const span = 360 / N;
  for (let i = 0; i < N; i++) {
    const frac = (n) => { const x = Math.sin((i + 1) * n) * 43758.5453; return x - Math.floor(x); };
    const bearing = i * span;
    const d = wrap(bearing - view);
    if (Math.abs(d) > fov / 2 + span) continue;
    const cx = w * (0.5 + d / fov);
    const bw = (w * span) / fov;
    const bh = hgt * (0.12 + frac(12.9898) * 0.36); // cao tới sát đỉnh khung để không bị xe che hết
    const v = Math.round(14 + frac(78.233) * 130);
    ctx.fillStyle = `rgb(${v},${v + 9},${v + 14})`;
    ctx.fillRect(cx - bw / 2 + 2, horizon - bh, bw - 4, bh);
    ctx.fillStyle = `rgba(255,224,150,${(0.12 + frac(3.1) * 0.25).toFixed(2)})`;
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) ctx.fillRect(cx - bw / 2 + 8 + c * (bw / 3.4), horizon - bh + 8 + r * (bh / 3.4), bw / 7, bh / 9);
  }
  // mặt trời ở một phương vị cố định của "thế giới" (vùng sáng lớn giúp mỗi góc nhìn khác nhau rõ rệt)
  {
    const d = wrap(105 - view);
    if (Math.abs(d) < fov / 2 + 20) {
      const sx = w * (0.5 + d / fov);
      const sy = hgt * 0.14;
      const rg = ctx.createRadialGradient(sx, sy, 0, sx, sy, hgt * 0.2);
      rg.addColorStop(0, 'rgba(255,244,200,.95)');
      rg.addColorStop(1, 'rgba(255,244,200,0)');
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, w, horizon);
    }
  }
  // dải cột/biển báo cao ở các phương vị giả ngẫu nhiên cố định: tạo "dấu vân tay" hậu cảnh riêng cho mỗi góc nhìn
  for (let i = 0; i < 40; i++) {
    const r1 = Math.sin((i + 3) * 91.17) * 43758.5453; const f1 = r1 - Math.floor(r1);
    const r2 = Math.sin((i + 7) * 12.93) * 24634.6345; const f2 = r2 - Math.floor(r2);
    const r3 = Math.sin((i + 11) * 4.57) * 31415.9265; const f3 = r3 - Math.floor(r3);
    const d = wrap(f1 * 360 - view);
    if (Math.abs(d) > fov / 2 + 4) continue;
    const x = w * (0.5 + d / fov);
    const bwid = w * (0.012 + f2 * 0.03);
    ctx.fillStyle = f3 > 0.5 ? `rgba(240,245,250,${(0.35 + f2 * 0.4).toFixed(2)})` : `rgba(8,12,16,${(0.45 + f3 * 0.4).toFixed(2)})`;
    ctx.fillRect(x - bwid / 2, 0, bwid, horizon + hgt * 0.1);
  }
  // cột đèn ở các phương vị không đều
  ctx.fillStyle = 'rgba(210,225,235,.55)';
  for (const b of [12, 71, 133, 190, 247, 301]) {
    const d = wrap(b - view);
    if (Math.abs(d) > fov / 2) continue;
    const x = w * (0.5 + d / fov);
    ctx.fillRect(x - 2, horizon - hgt * 0.3, 4, hgt * 0.3);
    ctx.fillRect(x - 10, horizon - hgt * 0.3, 20, 4);
  }

  // vạch kẻ bãi đỗ theo phối cảnh
  ctx.strokeStyle = 'rgba(255,255,255,.18)';
  ctx.lineWidth = Math.max(1.5, w / 300);
  ctx.beginPath();
  for (let i = -6; i <= 6; i++) {
    ctx.moveTo(w / 2 + i * w * 0.045, horizon);
    ctx.lineTo(w / 2 + i * w * 0.32, hgt);
  }
  for (let k = 1; k <= 5; k++) {
    const y = horizon + (hgt - horizon) * (k / 5) ** 1.8;
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
  }
  ctx.stroke();
}

function paintWatermark(ctx, w, hgt) {
  const fs = Math.max(14, Math.round(Math.min(w, hgt) * 0.032));
  ctx.save();
  ctx.font = `800 ${fs}px system-ui, sans-serif`;
  const text = DEMO_LABEL;
  const tw = ctx.measureText(text).width;
  const pad = fs * 0.6;
  ctx.fillStyle = 'rgba(248,150,33,.92)';
  ctx.fillRect(pad, hgt - fs - pad * 2.2, tw + pad * 2, fs + pad * 1.3);
  ctx.fillStyle = '#1a1000';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, pad * 2, hgt - fs / 2 - pad * 1.55);
  ctx.restore();
}

/** Hộp chứa xe (theo cùng quy tắc với khung hướng dẫn: ~86% chiều rộng, 50%/70% chiều cao). */
function vehicleBox(w, hgt, { far = false, clipped = false } = {}) {
  const portrait = hgt >= w;
  let bw = w * 0.86;
  let bh = hgt * (portrait ? 0.5 : 0.7);
  let cx = w / 2;
  const cy = hgt * 0.5;
  if (far) { bw *= 0.42; bh *= 0.42; }
  if (clipped) cx -= w * 0.36;
  return { x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh };
}

function drawScene(canvas, { mode = 'good', az, vehicleType, flags }) {
  const w = canvas.width;
  const hgt = canvas.height;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  paintBackground(ctx, w, hgt, az);
  const showCar = mode !== 'noCar' && flags.present;
  if (showCar) {
    const box = vehicleBox(w, hgt, { far: flags.far, clipped: flags.clipped || mode === 'cut' });
    // bóng xe
    ctx.fillStyle = 'rgba(0,0,0,.32)';
    ctx.beginPath();
    ctx.ellipse(box.x + box.w / 2, box.y + box.h * 0.9, box.w * 0.42, box.h * 0.08, 0, 0, Math.PI * 2);
    ctx.fill();
    drawVehicleToCanvas(ctx, { vehicleType, azDeg: az, ...box });
    if (flags.multiple) {
      const sm = { x: w * 0.64, y: hgt * 0.22, w: w * 0.32, h: hgt * 0.22 };
      drawVehicleToCanvas(ctx, { vehicleType: 'sedan', azDeg: az + 35, ...sm, colors: { body: '#aab6bd', detail: '#8a969d' } });
    }
  }
  paintWatermark(ctx, w, hgt);
}

/** Làm mờ bằng thu nhỏ → phóng to (chạy được ở mọi trình duyệt, không cần ctx.filter). */
/** Làm mờ mạnh bằng box-blur 3 lượt (xấp xỉ Gaussian) — không phụ thuộc ctx.filter (Safari không hỗ trợ). */
function applyBlur(canvas) {
  const ctx = canvas.getContext('2d');
  const { width: w, height: h } = canvas;
  const img = ctx.getImageData(0, 0, w, h);
  const src = img.data;
  const r = Math.max(6, Math.round(Math.min(w, h) * 0.022));
  const tmp = new Uint8ClampedArray(src.length);
  const pass = (from, to, horizontal) => {
    const len = horizontal ? w : h;
    const lines = horizontal ? h : w;
    const stride = horizontal ? 4 : w * 4;
    const lineStride = horizontal ? w * 4 : 4;
    const win = 2 * r + 1;
    for (let l = 0; l < lines; l++) {
      const base = l * lineStride;
      for (let c = 0; c < 3; c++) {
        let acc = 0;
        for (let i = -r; i <= r; i++) acc += from[base + Math.min(len - 1, Math.max(0, i)) * stride + c];
        for (let i = 0; i < len; i++) {
          to[base + i * stride + c] = acc / win;
          acc += from[base + Math.min(len - 1, i + r + 1) * stride + c] - from[base + Math.max(0, i - r) * stride + c];
        }
      }
    }
    for (let i = 3; i < to.length; i += 4) to[i] = 255;
  };
  for (let k = 0; k < 3; k++) { pass(src, tmp, true); pass(tmp, src, false); }
  ctx.putImageData(img, 0, 0);
}
function applyDark(canvas) {
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(0,0,0,0.9)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

/* ====================================================================== */
export class DemoSource {
  /**
   * @param {{vehicleType:string, getOrientation:()=>'portrait'|'landscape'}} o
   */
  constructor({ vehicleType, getOrientation }) {
    this.vehicleType = vehicleType;
    this.getOrientation = getOrientation;
    this.orbit = 0;           // góc quỹ đạo giả lập của "người chụp" (độ, không quấn)
    this.walk = null;         // { to, speed }
    this.flags = { present: true, multiple: false, clipped: false, far: false, sensors: true, shake: false };
    this.captureMode = 'good';
    this.virtualOrientation = null;
    this.stage = null;
    this.canvas = null;
    this.timer = null;
    this.dirty = true;
    this.lastTick = 0;
    this.changedAt = performance.now();
    this.listeners = new Set();
  }

  get effectiveOrientation() {
    return this.virtualOrientation ?? this.getOrientation();
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _emit() { this.listeners.forEach((fn) => fn()); }

  /* ----------------------------- vòng đời ----------------------------- */
  mount(stage) {
    this.stage = stage;
    clearNode(stage);
    this.canvas = document.createElement('canvas');
    stage.append(this.canvas);
    stage.hidden = false;
    movementTracker.resetAll();
    movementTracker.useSyntheticSource(true);
    this.lastTick = performance.now();
    this.timer = setInterval(() => this._tick(), 50);
  }

  unmount() {
    clearInterval(this.timer);
    this.timer = null;
    if (this.stage) { clearNode(this.stage); this.stage.hidden = true; }
    this.canvas = null;
    movementTracker.useSyntheticSource(false);
    movementTracker.permission = 'unknown';
    movementTracker.resetAll();
  }

  /** Đặt kích thước khung demo theo khung hiển thị (tỷ lệ 4:3 hoặc 3:4). Trả về hình chữ nhật (px CSS). */
  layout(cw, ch) {
    const portrait = this.effectiveOrientation === 'portrait';
    const ar = portrait ? 3 / 4 : 4 / 3;
    let w = cw;
    let hgt = w / ar;
    if (hgt > ch) { hgt = ch; w = hgt * ar; }
    const rect = { left: (cw - w) / 2, top: (ch - hgt) / 2, w, h: hgt };
    if (this.stage) {
      Object.assign(this.stage.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${w}px`, height: `${hgt}px` });
      const k = Math.min(window.devicePixelRatio || 1, 1.5);
      const cwPx = Math.round(w * k);
      const chPx = Math.round(hgt * k);
      if (this.canvas && (this.canvas.width !== cwPx || this.canvas.height !== chPx)) {
        this.canvas.width = cwPx;
        this.canvas.height = chPx;
      }
    }
    this.dirty = true;
    return rect;
  }

  /* ----------------------------- mô phỏng chuyển động ----------------------------- */
  _touch() {
    this.changedAt = performance.now();
    this.dirty = true;
    this._emit();
  }

  setFlag(k, v) { this.flags[k] = v; if (k === 'sensors') this._applySensorFlag(); this._touch(); }
  toggleFlag(k) { this.setFlag(k, !this.flags[k]); return this.flags[k]; }
  setCaptureMode(m) { this.captureMode = m; this._emit(); }
  setVirtualOrientation(o) { this.virtualOrientation = o; this.dirty = true; this._emit(); }

  _applySensorFlag() {
    movementTracker.permission = this.flags.sensors ? 'granted' : 'denied';
  }

  /** Đi THEO CHIỀU KIM ĐỒNG HỒ tới góc `deg`. */
  walkTo(deg, speed = 40) {
    const cw = (((deg - this.orbit) % 360) + 360) % 360;
    this.walk = { to: this.orbit + cw, speed };
  }
  /** Đi một đoạn (dương = xuôi chiều kim đồng hồ, âm = NGƯỢC chiều). */
  walkBy(delta, speed = 22) {
    this.walk = { to: this.orbit + delta, speed };
  }
  stopWalking() { this.walk = null; }
  teleport(deg) { this.orbit = deg; this.walk = null; this._touch(); }
  get walking() { return Boolean(this.walk); }

  _tick() {
    const t = performance.now();
    const dt = Math.min(0.2, (t - this.lastTick) / 1000);
    this.lastTick = t;
    if (this.walk) {
      const d = this.walk.to - this.orbit;
      const step = this.walk.speed * dt;
      if (Math.abs(d) <= step) { this.orbit = this.walk.to; this.walk = null; } else this.orbit += Math.sign(d) * step;
      this.dirty = true;
      this._emit();
    }
    if (this.flags.sensors) {
      const noise = this.flags.shake ? (Math.random() - 0.5) * 6 : 0;
      movementTracker.ingestHeading(wrap360(HEADING0 + this.orbit + noise), { hmag: 1 });
      movementTracker.ingestMotion({ gyro: this.flags.shake ? 45 : this.walk ? 14 : 2, accelDev: this.flags.shake ? 3 : 0.3 });
      // xe luôn nằm giữa khung khi người dùng đi vòng và hướng camera vào xe
      movementTracker.setVisualOffset(0, true);
    }
    if (this.dirty && this.canvas && this.canvas.width) {
      this.dirty = false;
      drawScene(this.canvas, { mode: 'good', az: this.orbit, vehicleType: this.vehicleType, flags: this.flags });
    }
  }

  /* ----------------------------- "phát hiện" giả lập ----------------------------- */
  _geometry(orientation, forceMode = null) {
    const f = FRAME[orientation] ?? FRAME.landscape;
    const mode = forceMode ?? 'good';
    const flags = { ...this.flags, clipped: this.flags.clipped || mode === 'cut' };
    const box = vehicleBox(f.w, f.h, { far: flags.far, clipped: flags.clipped });
    const { solid } = layoutVehicle({ vehicleType: this.vehicleType, azDeg: this.orbit, ...box });
    const x0 = clamp(solid.x, 0, f.w); const y0 = clamp(solid.y, 0, f.h);
    const x1 = clamp(solid.x + solid.w, 0, f.w); const y1 = clamp(solid.y + solid.h, 0, f.h);
    const bbox = { x: x0 / f.w, y: y0 / f.h, w: (x1 - x0) / f.w, h: (y1 - y0) / f.h };
    return { f, bbox, flags };
  }

  /** Thông tin xe theo cùng cấu trúc VehicleTracker.info, đánh dấu source:'demo'. */
  vehicleInfo(orientation = this.effectiveOrientation) {
    const present = this.flags.present;
    const base = {
      source: 'demo', present: false, stale: false, count: 0, multiple: false, locked: false,
      bbox: null, cls: null, score: 0, areaRatio: 0, aspect: 0, cx: 0.5, cy: 0.5,
      clipped: { left: false, right: false, top: false, bottom: false, count: 0, any: false, severe: false },
      tooClose: false, tooFar: false, stable: false, stableFrames: 0, stableMs: 0, lostFrames: 0, vehicles: [], width: 0, height: 0,
    };
    if (!present) return base;
    const { f, bbox } = this._geometry(orientation);
    const clipped = computeClipping(bbox);
    const areaRatio = bbox.w * bbox.h;
    const minArea = orientation === 'portrait' ? 0.07 : 0.17;
    const sinceChange = performance.now() - this.changedAt;
    const stable = sinceChange > 700;
    const vehicles = [{ bbox, cls: 'car', score: 0.9, isPrimary: true }];
    if (this.flags.multiple) vehicles.push({ bbox: { x: 0.64, y: 0.22, w: 0.32, h: 0.22 }, cls: 'car', score: 0.8, isPrimary: false });
    return {
      ...base,
      present: true,
      count: vehicles.length,
      multiple: this.flags.multiple,
      bbox,
      cls: 'car',
      score: 0.9,
      areaRatio,
      aspect: (bbox.w * f.w) / Math.max(1, bbox.h * f.h),
      cx: bbox.x + bbox.w / 2,
      cy: bbox.y + bbox.h / 2,
      clipped,
      tooClose: clipped.severe,
      tooFar: areaRatio < minArea,
      stable,
      stableFrames: stable ? 8 : 1,
      stableMs: stable ? sinceChange : 0,
      vehicles,
      width: f.w,
      height: f.h,
    };
  }

  /** Kết quả "nhận diện ảnh tĩnh" giả lập cho bộ kiểm tra chất lượng (cùng cấu trúc summarizeStillDetection). */
  stillDetection(mode, orientation) {
    if (mode === 'noCar' || !this.flags.present) return { none: true };
    const { bbox } = this._geometry(orientation, mode);
    const m = 0.012;
    const clipped = { left: bbox.x <= m, right: bbox.x + bbox.w >= 1 - m, top: bbox.y <= m, bottom: bbox.y + bbox.h >= 1 - m };
    clipped.count = [clipped.left, clipped.right, clipped.top, clipped.bottom].filter(Boolean).length;
    return { none: false, bbox, areaRatio: bbox.w * bbox.h, clipped, score: 0.9, cls: 'car', count: this.flags.multiple ? 2 : 1 };
  }

  /** Ảnh "chụp" giả lập (luôn có watermark DEMO). */
  grabFrame(orientation = this.effectiveOrientation, mode = this.captureMode) {
    const f = FRAME[orientation] ?? FRAME.landscape;
    const c = document.createElement('canvas');
    c.width = f.w;
    c.height = f.h;
    drawScene(c, { mode, az: this.orbit, vehicleType: this.vehicleType, flags: this.flags });
    if (mode === 'blur') applyBlur(c);
    if (mode === 'dark') applyDark(c);
    return c;
  }
}

/* ====================================================================== */
/* Bảng điều khiển DEMO                                                   */
/* ====================================================================== */
const btn = (label, onClick, cls = '') => h('button', { class: `demo-btn ${cls}`.trim(), type: 'button', onClick }, label);

/**
 * @param {object} host   CameraScreen (xem cameraScreen.js: autoSnapshot, handleShutter, confirmStartAs)
 * @param {DemoSource} demo
 */
export function buildDemoPanel(host, demo) {
  const body = document.getElementById('demoBody');
  clearNode(body);
  const section = (title, ...kids) => h('div', {}, h('h4', { text: title }), h('div', { class: 'demo-row' }, ...kids));
  const toggles = new Map();
  const toggle = (label, flag, invert = false) => {
    const b = btn(label, () => { demo.toggleFlag(flag); refresh(); });
    toggles.set(flag, { b, invert });
    return b;
  };
  const segs = new Map();
  const seg = (group, label, value, onPick) => {
    const b = btn(label, () => { onPick(value); refresh(); });
    (segs.get(group) ?? segs.set(group, []).get(group)).push({ b, value });
    return b;
  };

  const runner = new DemoAutoRunner(host, demo);
  host.demoRunner = runner;
  const runBtn = btn('▶ Chạy tự động 8 góc', () => { if (runner.running) runner.stop(); else runner.run(); refresh(); });

  body.append(
    section('Kịch bản', runBtn),
    section('Di chuyển giả lập',
      btn('↺ Đi NGƯỢC 45°', () => { demo.walkBy(-45, 20); toast('DEMO: đang đi ngược chiều kim đồng hồ', { level: 'warn' }); }),
      btn('Đi xuôi 45° ↻', () => demo.walkBy(45, 30)),
      btn('Tới góc mục tiêu', () => { const d = host.getTargetDeg(); if (d != null) demo.walkTo(d, 55); }),
      btn('Dừng', () => demo.stopWalking())),
    section('Điểm xuất phát (trước khi xác nhận)',
      btn('Đứng ở đầu xe', () => demo.teleport(0)),
      btn('Đứng ở đuôi xe', () => demo.teleport(180)),
      btn('Đứng bên hông', () => demo.teleport(90))),
    section('Xe & khung hình', toggle('Có xe trong khung', 'present'), toggle('Thêm xe thứ hai', 'multiple'), toggle('Xe bị cắt mép', 'clipped'), toggle('Xe quá xa', 'far')),
    section('Cảm biến', toggle('Cảm biến bật', 'sensors'), toggle('Rung / nhiễu', 'shake')),
    section('Ảnh chụp kế tiếp',
      ...[['Tốt', 'good'], ['Mờ', 'blur'], ['Tối', 'dark'], ['Không có xe', 'noCar'], ['Xe bị cắt', 'cut']].map(([l, v]) => seg('mode', l, v, (x) => demo.setCaptureMode(x)))),
    section('Hướng màn hình',
      seg('orient', 'Theo thiết bị', null, (x) => demo.setVirtualOrientation(x)),
      seg('orient', 'Dọc', 'portrait', (x) => demo.setVirtualOrientation(x)),
      seg('orient', 'Ngang', 'landscape', (x) => demo.setVirtualOrientation(x))),
    h('p', { class: 'hint', text: 'Nhãn DEMO luôn hiển thị. Cảm biến/nhận diện ở đây là giả lập, không phải kết quả AI thật.' }),
  );

  function refresh() {
    for (const [flag, { b, invert }] of toggles) b.classList.toggle('on', invert ? !demo.flags[flag] : Boolean(demo.flags[flag]));
    for (const { b, value } of segs.get('mode')) b.classList.toggle('on', demo.captureMode === value);
    for (const { b, value } of segs.get('orient')) b.classList.toggle('on', demo.virtualOrientation === value);
    runBtn.textContent = runner.running ? '■ Dừng chạy tự động' : '▶ Chạy tự động 8 góc';
    runBtn.classList.toggle('on', runner.running);
  }
  runner.onStop = refresh;
  refresh();
  return { refresh };
}

/* ====================================================================== */
/* Chạy tự động: mô phỏng một người dùng đi đủ 8 góc                      */
/* ====================================================================== */
export class DemoAutoRunner {
  constructor(host, demo) {
    this.host = host;
    this.demo = demo;
    this.running = false;
    this.onStop = null;
    this._orientSince = 0;
  }

  stop() {
    this.running = false;
    this.demo.stopWalking();
    this.onStop?.();
  }

  async run() {
    if (this.running) return;
    this.running = true;
    this.demo.flags.present = true;
    this.demo.captureMode = 'good';
    let stuck = 0;
    while (this.running && this.host.active) {
      await sleep(300);
      const s = this.host.autoSnapshot();
      if (!s || s.completed) break;
      if (s.busy) continue;

      if (s.fsm === 'IDENTIFYING_START_POINT') {
        if (s.startStatus === 'needs_confirm' || s.startStatus === 'confirmed') await this.host.confirmStartAs('front');
        else if (s.startStatus === 'side') this.demo.teleport(0);
        continue;
      }
      if (s.fsm === 'CAPTURE_REJECTED' || s.sheetOpen) { this.host.autoDismiss?.(); continue; }
      if (!s.target) continue;
      const A = ANGLE_BY_KEY[s.target];

      // mô phỏng người dùng xoay điện thoại sau một nhịp chờ để thấy gợi ý xoay máy
      if (s.orientation !== A.orientation) {
        this._orientSince ||= Date.now();
        if (Date.now() - this._orientSince > 1400) { this.demo.setVirtualOrientation(A.orientation); this._orientSince = 0; }
        continue;
      }
      this._orientSince = 0;

      if (s.ready) {
        this.demo.stopWalking();
        stuck = 0;
        await this.host.handleShutter();
        continue;
      }
      if (s.startConfirmed && !s.near && !this.demo.walking) {
        this.demo.walkTo(ANGLES[A.index].deg, 45);
      }
      if (!this.demo.walking && !s.ready) {
        stuck += 1;
        if (stuck > 25) { this.demo.walkBy(0.1, 5); stuck = 0; }
      }
    }
    this.running = false;
    this.onStop?.();
  }
}
