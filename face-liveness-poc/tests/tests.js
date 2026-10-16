/**
 * tests.js — Kiểm thử đơn vị cho các hàm THUẦN (hình học, chất lượng, liveness, điều kiện chụp, chọn thông báo).
 *
 * LƯU Ý QUAN TRỌNG: các test này dùng dữ liệu landmark/EAR TỔNG HỢP để kiểm tra LOGIC của chúng.
 * Chúng KHÔNG thay thế việc kiểm thử với camera và model thật (xem README, mục checklist kiểm thử).
 * Dữ liệu tổng hợp chỉ nằm trong thư mục tests/, không bao giờ được app sử dụng.
 *
 * Chạy trong trình duyệt: mở tests/index.html qua HTTP server tĩnh.
 */

import { CONFIG } from '../js/config.js';
import {
  FaceState,
  LM,
  computeViewTransform,
  videoToView,
  computeOval,
  computeFaceBox,
  classifyFaces,
  checkPosition,
  checkScale,
  estimatePoseFromMatrix,
  estimatePoseFromLandmarks,
  resolvePose,
  evaluatePose,
  analyzeFrame,
  StabilityTracker,
  YawSignCalibrator,
} from '../js/geometry-validator.js';
import { computeBrightness, laplacianVariance, toGrayscale, evaluateQuality, median } from '../js/quality-validator.js';
import {
  LivenessChallenge,
  LivenessState,
  ChallengeType,
  computeEAR,
  pickChallenges,
} from '../js/liveness.js';
import { canCapture } from '../js/capture-controller.js';
import { resolveGuidance, resolveGeoStatus, resolveLivenessStatus } from '../js/ui-controller.js';

// ------------------------------------------------------------------------------------ harness

const registry = [];
const test = (name, fn) => registry.push({ name, fn });

function assert(cond, msg = 'assertion failed') {
  if (!cond) throw new Error(msg);
}
function eq(actual, expected, msg = '') {
  if (actual !== expected) throw new Error(`${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function close(actual, expected, tol = 0.01, msg = '') {
  if (!(Math.abs(actual - expected) <= tol)) throw new Error(`${msg} expected ≈${expected} (±${tol}), got ${actual}`);
}

export function runAll() {
  const results = [];
  for (const t of registry) {
    try {
      t.fn();
      results.push({ name: t.name, ok: true });
    } catch (e) {
      results.push({ name: t.name, ok: false, error: e.message });
    }
  }
  return results;
}

// ------------------------------------------------------------------------------------ dữ liệu tổng hợp

const DEG = Math.PI / 180;
const ASPECT = 16 / 9;

/** Ma trận xoay R = Ry(yaw)·Rx(pitch)·Rz(roll), hệ x phải / y lên / z về camera. */
function rotation(yawDeg, pitchDeg, rollDeg) {
  const [y, p, r] = [yawDeg * DEG, pitchDeg * DEG, rollDeg * DEG];
  const Ry = [[Math.cos(y), 0, Math.sin(y)], [0, 1, 0], [-Math.sin(y), 0, Math.cos(y)]];
  const Rx = [[1, 0, 0], [0, Math.cos(p), -Math.sin(p)], [0, Math.sin(p), Math.cos(p)]];
  const Rz = [[Math.cos(r), -Math.sin(r), 0], [Math.sin(r), Math.cos(r), 0], [0, 0, 1]];
  const mul = (A, B) => A.map((row, i) => B[0].map((_, j) => row.reduce((s, _v, k) => s + A[i][k] * B[k][j], 0)));
  return mul(mul(Ry, Rx), Rz);
}

function makeMatrix(yaw, pitch, roll, { columnMajor = true, scale = 1 } = {}) {
  const R = rotation(yaw, pitch, roll);
  const t = [1.2, -0.8, -40];
  const M = [
    [R[0][0] * scale, R[0][1] * scale, R[0][2] * scale, t[0]],
    [R[1][0] * scale, R[1][1] * scale, R[1][2] * scale, t[1]],
    [R[2][0] * scale, R[2][1] * scale, R[2][2] * scale, t[2]],
    [0, 0, 0, 1],
  ];
  const data = [];
  if (columnMajor) for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) data.push(M[r][c]);
  else for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) data.push(M[r][c]);
  return { rows: 4, columns: 4, data };
}

const EYE_A = [33, 160, 158, 133, 153, 144];
const EYE_B = [362, 385, 387, 263, 373, 380];

/**
 * Tạo 478 landmark tổng hợp: nằm trên elip bao quanh nên bounding box = (cx±w/2, cy±h/2) (toạ độ video chuẩn hoá).
 * Các điểm chủ chốt (trán, cằm, mép má, khoé mắt, 6 điểm mỗi mắt) được đặt đúng chỉ số để kiểm tra pose/EAR.
 */
function makeFace({ cx = 0.5, cy = 0.5, h = 0.5, w = 0.3, yaw = 0, ear = 0.3 } = {}) {
  const lm = [];
  for (let i = 0; i < 478; i++) {
    const a = (2 * Math.PI * i) / 478;
    lm.push({ x: cx + (w / 2) * Math.cos(a) * 0.98, y: cy + (h / 2) * Math.sin(a) * 0.98, z: 0, visibility: 1 });
  }
  const set = (i, x, y, z = 0) => (lm[i] = { x, y, z, visibility: 1 });
  set(LM.FOREHEAD, cx, cy - h / 2);
  set(LM.CHIN, cx, cy + h / 2);
  const dz = (w / 2) * Math.tan(yaw * DEG);
  set(LM.FACE_EDGE_IMAGE_LEFT, cx - w / 2, cy, -dz);
  set(LM.FACE_EDGE_IMAGE_RIGHT, cx + w / 2, cy, dz);
  const eyeY = cy - h / 6;
  const placeEye = (idx, ex) => {
    const ew = w * 0.1; // nửa chiều rộng mắt
    const v = ear * 2 * ew; // độ mở theo đơn vị chiều rộng
    const dyN = v * ASPECT; // đổi sang toạ độ y chuẩn hoá
    set(idx[0], ex - ew, eyeY);
    set(idx[3], ex + ew, eyeY);
    set(idx[1], ex - ew / 2, eyeY - dyN / 2);
    set(idx[2], ex + ew / 2, eyeY - dyN / 2);
    set(idx[5], ex - ew / 2, eyeY + dyN / 2);
    set(idx[4], ex + ew / 2, eyeY + dyN / 2);
  };
  placeEye(EYE_A, cx - w / 4);
  placeEye(EYE_B, cx + w / 4);
  set(LM.EYE_OUTER_IMAGE_LEFT, lm[33].x, lm[33].y);
  set(LM.EYE_OUTER_IMAGE_RIGHT, lm[263].x, lm[263].y);
  return lm;
}

const VIEW = { videoW: 1280, videoH: 720, viewW: 720, viewH: 1280, mirrored: true, ts: 0 };

/** Mặt nằm đúng giữa oval, tỷ lệ ~55% chiều cao view, nhìn thẳng. */
function goodFace(over = {}) {
  // view dọc 720×1280 từ video ngang 1280×720: scale = 1280/720; chiều cao hiển thị = 1280 → hệ số y = 1.
  // toạ độ view x = (nx*dispW - offsetX)/viewW với dispW = 2275.6, offsetX = 777.8
  const t = computeViewTransform(1280, 720, 720, 1280);
  const rawCx = (0.5 * 720 + t.offsetX) / t.dispW; // view x = 0.5 (không mirror)
  const rawCy = CONFIG.oval.centerY;
  return makeFace({ cx: rawCx, cy: rawCy, h: 0.55, w: 0.55 * (1280 / 2275.6) * 0.75, ...over });
}

const resultOf = (faces, matrices) => ({ faceLandmarks: faces, facialTransformationMatrixes: matrices });
const frontalMatrix = () => makeMatrix(0, 0, 0);

// ------------------------------------------------------------------------------------ hình học

test('computeViewTransform: object-fit cover căn giữa và cắt phần thừa', () => {
  const t = computeViewTransform(1280, 720, 720, 1280);
  close(t.scale, 1280 / 720, 1e-9);
  close(videoToView(0.5, 0.5, t, false).x, 0.5, 1e-9);
  close(videoToView(0.5, 0.5, t, false).y, 0.5, 1e-9);
});

test('videoToView: lật gương đúng MỘT lần (x → 1 − x), y không đổi', () => {
  const t = computeViewTransform(1280, 720, 720, 1280);
  const a = videoToView(0.6, 0.4, t, false);
  const b = videoToView(0.6, 0.4, t, true);
  close(a.x + b.x, 1, 1e-9);
  close(a.y, b.y, 1e-9);
});

test('computeOval: giới hạn theo chiều rộng khi view hẹp', () => {
  const wide = computeOval(1600, 900, CONFIG.oval);
  close(wide.ry * 2, 0.62 * 900, 1e-6);
  const narrow = computeOval(300, 900, CONFIG.oval);
  assert(narrow.rx * 2 <= 0.86 * 300 + 1e-6, 'oval vượt quá chiều rộng view');
  close(narrow.rx / narrow.ry, CONFIG.oval.aspect, 1e-6);
});

test('checkPosition: hướng dẫn đúng chiều (mặt bên phải → sang trái; thấp → nâng lên)', () => {
  const c = { x: 0.5, y: 0.46 };
  const box = (cx, cy) => ({ cx, cy });
  eq(checkPosition(box(0.62, 0.46), c, CONFIG.position).hint, 'MOVE_LEFT');
  eq(checkPosition(box(0.38, 0.46), c, CONFIG.position).hint, 'MOVE_RIGHT');
  eq(checkPosition(box(0.5, 0.6), c, CONFIG.position).hint, 'RAISE_FACE');
  eq(checkPosition(box(0.5, 0.3), c, CONFIG.position).hint, 'LOWER_FACE');
  assert(checkPosition(box(0.55, 0.5), c, CONFIG.position).ok, 'trong ngưỡng 8% phải đạt');
  assert(!checkPosition(box(0.59, 0.46), c, CONFIG.position).ok, 'vượt 8% phải không đạt');
});

test('checkScale: ngưỡng 35%–75%, độc lập với vị trí', () => {
  eq(checkScale({ h: 0.3 }, CONFIG.scale).hint, 'COME_CLOSER');
  eq(checkScale({ h: 0.8 }, CONFIG.scale).hint, 'MOVE_BACK');
  assert(checkScale({ h: 0.5 }, CONFIG.scale).ok);
});

test('classifyFaces: NO_FACE / MULTIPLE_FACES / FACE_DETECTED và bỏ qua mặt nhỏ', () => {
  const d = CONFIG.detection;
  eq(classifyFaces([], d).state, FaceState.NO_FACE);
  eq(classifyFaces([{ h: 0.5 }], d).state, FaceState.FACE_DETECTED);
  eq(classifyFaces([{ h: 0.5 }, { h: 0.4 }], d).state, FaceState.MULTIPLE_FACES);
  eq(classifyFaces([{ h: 0.5 }, { h: 0.05 }], d).state, FaceState.FACE_DETECTED);
  eq(classifyFaces([{ h: 0.05 }], d).state, FaceState.NO_FACE);
});

test('estimatePoseFromMatrix: khôi phục yaw/pitch/roll (cột-trước, có tỷ lệ)', () => {
  for (const [y, p, r] of [[0, 0, 0], [12, 0, 0], [-25, 5, 0], [0, 15, 0], [0, -10, 6], [20, -8, -9]]) {
    const e = estimatePoseFromMatrix(makeMatrix(y, p, r, { scale: 1.3 }));
    assert(e.valid, 'ma trận hợp lệ');
    eq(e.columnMajor, true);
    close(e.yawRaw, y, 0.01, `yaw(${y},${p},${r})`);
    close(e.pitch, p, 0.01, `pitch(${y},${p},${r})`);
    close(e.roll, r, 0.01, `roll(${y},${p},${r})`);
  }
});

test('estimatePoseFromMatrix: tự nhận diện thứ tự hàng-trước', () => {
  const e = estimatePoseFromMatrix(makeMatrix(18, -7, 4, { columnMajor: false }));
  eq(e.columnMajor, false);
  close(e.yawRaw, 18, 0.01);
  close(e.pitch, -7, 0.01);
  close(e.roll, 4, 0.01);
});

test('estimatePoseFromMatrix: từ chối dữ liệu không hợp lệ (không bịa góc)', () => {
  assert(!estimatePoseFromMatrix(null).valid);
  assert(!estimatePoseFromMatrix({ data: [1, 2, 3] }).valid);
  assert(!estimatePoseFromMatrix({ data: new Array(16).fill(0) }).valid);
  const flipped = estimatePoseFromMatrix(makeMatrix(180, 0, 0));
  assert(!flipped.valid, 'hướng mặt bị đảo phải bị từ chối');
});

test('estimatePoseFromLandmarks: dấu yaw dương = quay sang trái của người dùng', () => {
  const left = estimatePoseFromLandmarks(makeFace({ yaw: 20 }), ASPECT);
  close(left.yaw, 20, 0.5);
  const right = estimatePoseFromLandmarks(makeFace({ yaw: -15 }), ASPECT);
  close(right.yaw, -15, 0.5);
  close(estimatePoseFromLandmarks(makeFace({}), ASPECT).yaw, 0, 0.01);
});

test('resolvePose: dấu yaw lấy theo landmark khi ma trận ngược quy ước', () => {
  // Ma trận báo yaw -20 (ngược dấu) trong khi landmark thực tế cho thấy +20.
  const cal = new YawSignCalibrator();
  const lm = makeFace({ yaw: 20 });
  const p = resolvePose(makeMatrix(-20, 0, 0), lm, ASPECT, cal);
  close(p.yaw, 20, 0.05);
  assert(p.source === 'matrix');
  // Sau đủ phiếu, bộ hiệu chuẩn tin cậy và áp dấu cho cả khi landmark nhiễu.
  for (let i = 0; i < 10; i++) resolvePose(makeMatrix(-20, 0, 0), lm, ASPECT, cal);
  assert(cal.confident && cal.sign === -1);
});

test('resolvePose: dự phòng landmark khi không có ma trận', () => {
  const p = resolvePose(undefined, makeFace({ yaw: 10 }), ASPECT, null);
  eq(p.source, 'landmarks');
  close(p.yaw, 10, 0.5);
});

test('evaluatePose: ngưỡng 10°/10°/8°', () => {
  const ok = evaluatePose({ valid: true, yaw: 9, pitch: -9, roll: 7 }, CONFIG.pose);
  assert(ok.ok);
  eq(evaluatePose({ valid: true, yaw: 11, pitch: 0, roll: 0 }, CONFIG.pose).hint, 'LOOK_STRAIGHT');
  eq(evaluatePose({ valid: true, yaw: 0, pitch: -11, roll: 0 }, CONFIG.pose).hint, 'LOOK_STRAIGHT');
  eq(evaluatePose({ valid: true, yaw: 0, pitch: 0, roll: 9 }, CONFIG.pose).hint, 'KEEP_HEAD_STRAIGHT');
  assert(!evaluatePose({ valid: false }, CONFIG.pose).ok);
});

test('analyzeFrame: mặt chuẩn → đạt mọi quy tắc hình học', () => {
  const a = analyzeFrame(resultOf([goodFace()], [frontalMatrix()]), VIEW, CONFIG, null);
  eq(a.faceState, FaceState.FACE_DETECTED);
  assert(a.rules.position, `vị trí dx=${a.position.dx} dy=${a.position.dy}`);
  assert(a.rules.scale, `tỷ lệ ${a.scale.ratio}`);
  assert(a.rules.pose);
  assert(a.geometryOk);
  close(a.box.cx, 0.5, 0.01);
});

test('analyzeFrame: không có mặt / nhiều mặt', () => {
  eq(analyzeFrame(resultOf([], []), VIEW, CONFIG, null).faceState, FaceState.NO_FACE);
  eq(analyzeFrame(resultOf([], []), VIEW, CONFIG, null).hint, 'FIND_FACE');
  const two = analyzeFrame(resultOf([goodFace(), goodFace({ cx: 0.7 })], [frontalMatrix(), frontalMatrix()]), VIEW, CONFIG, null);
  eq(two.faceState, FaceState.MULTIPLE_FACES);
  eq(two.hint, 'SINGLE_FACE');
  assert(!two.geometryOk);
});

test('analyzeFrame: mirror nhất quán — mặt lệch về bên phải MÀN HÌNH bất kể camera có lật gương hay không', () => {
  // Đặt mặt ở bên phải màn hình (view x ≈ 0.65). Với camera gương, raw x phải nhỏ hơn (bị lật).
  const t = computeViewTransform(1280, 720, 720, 1280);
  const rawFor = (viewX, mirrored) => ((mirrored ? 1 - viewX : viewX) * 720 + t.offsetX) / t.dispW;
  for (const mirrored of [true, false]) {
    const face = goodFace({ cx: rawFor(0.65, mirrored) });
    const a = analyzeFrame(resultOf([face], [frontalMatrix()]), { ...VIEW, mirrored }, CONFIG, null);
    close(a.box.cx, 0.65, 0.01, `mirrored=${mirrored}`);
    eq(a.position.hint, 'MOVE_LEFT', `mirrored=${mirrored}`);
  }
});

test('analyzeFrame: quá gần / quá xa chỉ cho hướng dẫn tỷ lệ khi đã căn giữa', () => {
  const near = analyzeFrame(resultOf([goodFace({ h: 0.9, w: 0.3 })], [frontalMatrix()]), VIEW, CONFIG, null);
  eq(near.scale.hint, 'MOVE_BACK');
  const far = analyzeFrame(resultOf([goodFace({ h: 0.25, w: 0.1 })], [frontalMatrix()]), VIEW, CONFIG, null);
  eq(far.scale.hint, 'COME_CLOSER');
});

test('analyzeFrame: quay đầu / cúi / nghiêng bị chặn bởi quy tắc góc', () => {
  const turned = analyzeFrame(resultOf([goodFace({ yaw: 25 })], [makeMatrix(25, 0, 0)]), VIEW, CONFIG, null);
  assert(!turned.rules.pose);
  eq(turned.hint, 'LOOK_STRAIGHT');
  const tilted = analyzeFrame(resultOf([goodFace()], [makeMatrix(0, 0, 14)]), VIEW, CONFIG, null);
  eq(tilted.hint, 'KEEP_HEAD_STRAIGHT');
});

test('computeFaceBox: tâm = (min+max)/2', () => {
  const box = computeFaceBox([{ x: 0.2, y: 0.1 }, { x: 0.6, y: 0.5 }], (x, y) => ({ x, y }));
  close(box.cx, 0.4, 1e-9);
  close(box.cy, 0.3, 1e-9);
  close(box.h, 0.4, 1e-9);
});

// ------------------------------------------------------------------------------------ ổn định

test('StabilityTracker: tính bằng timestamp — 10 FPS và 60 FPS đều đạt đúng sau ~1000 ms', () => {
  for (const fps of [10, 60]) {
    const tr = new StabilityTracker(CONFIG.stability);
    const dt = 1000 / fps;
    let reachedAt = null;
    for (let t = 0; t <= 2000; t += dt) {
      const s = tr.update(t, { box: { cx: 0.5, cy: 0.46, h: 0.5 } }, true);
      if (s.stable && reachedAt === null) reachedAt = t;
    }
    assert(reachedAt !== null, `fps ${fps}: phải đạt`);
    close(reachedAt, 1000, dt + 1, `fps ${fps}`);
  }
});

test('StabilityTracker: reset khi vi phạm quy tắc hoặc mất mặt', () => {
  const tr = new StabilityTracker(CONFIG.stability);
  const box = { cx: 0.5, cy: 0.46, h: 0.5 };
  for (let t = 0; t <= 800; t += 50) tr.update(t, { box }, true);
  assert(tr.snapshot().stableMs >= 700);
  tr.update(850, { box }, false);
  eq(tr.snapshot().stableMs, 0);
  for (let t = 900; t <= 1100; t += 50) tr.update(t, { box }, true);
  tr.update(1150, null, true);
  eq(tr.snapshot().stableMs, 0);
});

test('StabilityTracker: chuyển động đột ngột / rung mạnh làm mất ổn định', () => {
  const tr = new StabilityTracker(CONFIG.stability);
  let x = 0.5;
  for (let t = 0; t <= 600; t += 33) tr.update(t, { box: { cx: x, cy: 0.46, h: 0.5 } }, true);
  assert(tr.snapshot().stableMs > 400);
  // nhảy 0.1 đơn vị trong 33 ms = 0.1/0.033/0.5 ≈ 6 chiều cao mặt/giây
  x = 0.6;
  const s = tr.update(633, { box: { cx: x, cy: 0.46, h: 0.5 } }, true);
  assert(!s.motionOk, 'phải phát hiện chuyển động đột ngột');
  eq(s.stableMs, 0);
});

test('StabilityTracker: khoảng trống giữa hai frame quá lớn thì reset', () => {
  const tr = new StabilityTracker(CONFIG.stability);
  const box = { cx: 0.5, cy: 0.46, h: 0.5 };
  for (let t = 0; t <= 500; t += 50) tr.update(t, { box }, true);
  tr.update(1500, { box }, true); // trống 1 s
  assert(tr.snapshot().stableMs < 100);
});

// ------------------------------------------------------------------------------------ chất lượng

function grayFrom(fn, w = 64, h = 64) {
  const g = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g[y * w + x] = fn(x, y);
  return { g, w, h };
}
function boxBlur(src, w, h) {
  const out = new Float32Array(src.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      let n = 0;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < w && yy < h) {
            s += src[yy * w + xx];
            n++;
          }
        }
      out[y * w + x] = s / n;
    }
  return out;
}

test('laplacianVariance: ảnh phẳng = 0; ảnh nhiều chi tiết > ảnh làm mờ', () => {
  const flat = grayFrom(() => 120);
  eq(laplacianVariance(flat.g, flat.w, flat.h), 0);
  let seed = 7;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296) * 255;
  const sharp = grayFrom(() => rnd());
  const blurred = boxBlur(sharp.g, sharp.w, sharp.h);
  const vs = laplacianVariance(sharp.g, sharp.w, sharp.h);
  const vb = laplacianVariance(blurred, sharp.w, sharp.h);
  assert(vs > vb * 5, `sharp ${vs} phải lớn hơn nhiều so với blur ${vb}`);
});

test('computeBrightness & toGrayscale', () => {
  const rgba = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]);
  const g = toGrayscale(rgba, 2, 1);
  close(g[0], 255, 0.01);
  close(g[1], 0, 0.01);
  const b = computeBrightness(g);
  close(b.mean, 127.5, 0.01);
  close(b.overexposedFraction, 0.5, 1e-9);
});

test('evaluateQuality: tối / chói / mờ / đạt / chưa sẵn sàng', () => {
  const q = CONFIG.quality;
  eq(evaluateQuality({ ready: true, brightness: 40, sharpness: 100 }, q).hint, 'LOW_LIGHT');
  eq(evaluateQuality({ ready: true, brightness: 240, sharpness: 100 }, q).hint, 'TOO_BRIGHT');
  eq(evaluateQuality({ ready: true, brightness: 120, sharpness: 2 }, q).hint, 'BLURRY');
  assert(evaluateQuality({ ready: true, brightness: 120, sharpness: 100 }, q).ok);
  assert(!evaluateQuality({ ready: false }, q).ok);
  close(median([5, 1, 3]), 3, 1e-9);
});

// ------------------------------------------------------------------------------------ EAR

test('computeEAR: mắt mở > mắt nhắm, đo đúng giá trị dựng', () => {
  const open = computeEAR(makeFace({ ear: 0.3 }), ASPECT);
  const closed = computeEAR(makeFace({ ear: 0.08 }), ASPECT);
  close(open.mean, 0.3, 0.005);
  close(closed.mean, 0.08, 0.005);
});

// ------------------------------------------------------------------------------------ liveness

const LCFG = CONFIG.liveness;

/** Chạy mô phỏng theo timeline: fn(t) trả về mẫu tại thời điểm t (ms). */
function simulate(ch, fn, from, to, step = 33) {
  for (let t = from; t <= to; t += step) ch.update(fn(t), t);
}
const sample = (o = {}) => ({ faceOk: true, ear: 0.3, yaw: 0, frontalOk: true, ...o });

function seqRng(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

test('pickChallenges: ngẫu nhiên, không lặp, tránh lặp thử thách đầu của lần trước', () => {
  const pool = ['BLINK', 'TURN_LEFT', 'TURN_RIGHT'];
  const picked = pickChallenges(pool, 2, seqRng([0, 0]), null);
  eq(picked.length, 2);
  assert(picked[0] !== picked[1]);
  for (let i = 0; i < 20; i++) assert(pickChallenges(pool, 1, Math.random, 'BLINK')[0] !== 'BLINK');
});

test('Liveness BLINK: thu đường nền → phát lệnh → chớp mắt SAU lệnh → CHALLENGE_PASSED', () => {
  const ch = new LivenessChallenge({ ...LCFG, challenges: ['BLINK'] }, seqRng([0]));
  ch.start(0);
  eq(ch.state, LivenessState.CHALLENGE_STARTED);
  simulate(ch, () => sample(), 0, 700);
  eq(ch.state, LivenessState.WAITING_FOR_ACTION);
  eq(ch.instructionKey, 'BLINK');
  const prompt = ch.promptTs;
  // mắt mở 700 ms sau lệnh, rồi nhắm ~150 ms rồi mở
  simulate(ch, (t) => sample({ ear: t >= prompt + 700 && t < prompt + 850 ? 0.07 : 0.3 }), 700, 1700);
  assert([LivenessState.ACTION_DETECTED, LivenessState.CHALLENGE_PASSED].includes(ch.state), `state=${ch.state}`);
  simulate(ch, () => sample(), 1700, 2500);
  eq(ch.state, LivenessState.CHALLENGE_PASSED);
  assert(ch.isValid(2500));
});

test('Liveness BLINK: cú chớp xảy ra TRƯỚC lệnh (trong lúc thu đường nền) không được tính', () => {
  const ch = new LivenessChallenge({ ...LCFG, challenges: ['BLINK'] }, seqRng([0]));
  ch.start(0);
  // chớp ở 200–330 ms (trong khi đang thu đường nền) → cửa sổ nền phải làm lại
  simulate(ch, (t) => sample({ ear: t >= 200 && t < 330 ? 0.07 : 0.3 }), 0, 600);
  eq(ch.state, LivenessState.CHALLENGE_STARTED, 'chưa được phát lệnh vì nền bị gián đoạn');
  simulate(ch, () => sample(), 600, 1400);
  eq(ch.state, LivenessState.WAITING_FOR_ACTION);
  assert(ch.state !== LivenessState.CHALLENGE_PASSED);
});

test('Liveness BLINK: cú chớp ngay trong khoảng chờ phản xạ sau lệnh không được tính', () => {
  const ch = new LivenessChallenge({ ...LCFG, challenges: ['BLINK'] }, seqRng([0]));
  ch.start(0);
  let t = 0;
  while (ch.state === LivenessState.CHALLENGE_STARTED && t < 3000) {
    ch.update(sample(), t);
    t += 33;
  }
  eq(ch.state, LivenessState.WAITING_FOR_ACTION);
  const p = ch.promptTs;
  // mắt mở ở mẫu đầu sau lệnh, nhắm từ p+66 đến p+200 (nằm trọn trong khoảng chờ phản xạ 250 ms)
  simulate(ch, (x) => sample({ ear: x >= p + 66 && x < p + 200 ? 0.07 : 0.3 }), t, p + 600);
  eq(ch.state, LivenessState.WAITING_FOR_ACTION, 'cú chớp trong khoảng chờ phản xạ không được tính');
  // nhưng một cú chớp thật sự sau đó thì được tính
  simulate(ch, (x) => sample({ ear: x >= p + 800 && x < p + 950 ? 0.07 : 0.3 }), p + 600, p + 1500);
  assert([LivenessState.ACTION_DETECTED, LivenessState.CHALLENGE_PASSED].includes(ch.state), `state=${ch.state}`);
});

test('Liveness BLINK: nhiễu một frame hoặc nhắm quá lâu không phải chớp mắt', () => {
  const ch = new LivenessChallenge({ ...LCFG, challenges: ['BLINK'] }, seqRng([0]));
  ch.start(0);
  simulate(ch, () => sample(), 0, 700);
  const p = ch.promptTs;
  // một frame EAR thấp (nhiễu)
  simulate(ch, (t) => sample({ ear: Math.abs(t - (p + 800)) < 16 ? 0.05 : 0.3 }), 700, 1300);
  eq(ch.state, LivenessState.WAITING_FOR_ACTION, 'một frame đơn lẻ không đủ');
  // nhắm 1.6 s liên tục
  simulate(ch, (t) => sample({ ear: t >= 1400 && t < 3000 ? 0.05 : 0.3 }), 1300, 3300);
  eq(ch.state, LivenessState.WAITING_FOR_ACTION, 'nhắm quá lâu không tính');
});

test('Liveness: hết thời gian → LIVENESS_INCONCLUSIVE và có thể thử lại', () => {
  const ch = new LivenessChallenge({ ...LCFG, challenges: ['BLINK'] }, seqRng([0]));
  ch.start(0);
  simulate(ch, () => sample(), 0, 700);
  simulate(ch, () => sample(), 700, 700 + LCFG.stepTimeoutMs + 500);
  eq(ch.state, LivenessState.LIVENESS_INCONCLUSIVE);
  eq(ch.reason, 'TIMEOUT');
  eq(ch.instructionKey, 'LIVENESS_FAILED');
  ch.start(20000);
  eq(ch.state, LivenessState.CHALLENGE_STARTED);
});

test('Liveness TURN_LEFT: quay đúng hướng → quay lại nhìn thẳng → PASSED', () => {
  const ch = new LivenessChallenge({ ...LCFG, challenges: ['TURN_LEFT'] }, seqRng([0]));
  ch.start(0);
  simulate(ch, () => sample(), 0, 700);
  eq(ch.state, LivenessState.WAITING_FOR_ACTION);
  eq(ch.instructionKey, 'TURN_LEFT');
  simulate(ch, () => sample({ yaw: 22, frontalOk: false }), 700, 1100);
  eq(ch.state, LivenessState.ACTION_DETECTED);
  eq(ch.instructionKey, 'RETURN_FRONT');
  simulate(ch, () => sample({ yaw: 2, frontalOk: true }), 1100, 1700);
  eq(ch.state, LivenessState.CHALLENGE_PASSED);
});

test('Liveness TURN_RIGHT: quay SAI hướng được ghi nhận và không vượt qua', () => {
  const ch = new LivenessChallenge({ ...LCFG, challenges: ['TURN_RIGHT'] }, seqRng([0]));
  ch.start(0);
  simulate(ch, () => sample(), 0, 700);
  simulate(ch, () => sample({ yaw: 24, frontalOk: false }), 700, 1500); // quay trái trong khi cần phải
  eq(ch.state, LivenessState.WAITING_FOR_ACTION);
  assert(ch.wrongDirection);
  eq(ch.instructionKey, 'TURN_RIGHT_WRONG');
  simulate(ch, () => sample({ yaw: -20, frontalOk: false }), 1500, 1900);
  eq(ch.state, LivenessState.ACTION_DETECTED);
});

test('Liveness TURN: đã quay sẵn từ trước khi bắt đầu thì không thể thu đường nền', () => {
  const ch = new LivenessChallenge({ ...LCFG, challenges: ['TURN_LEFT'] }, seqRng([0]));
  ch.start(0);
  simulate(ch, () => sample({ yaw: 25, frontalOk: false }), 0, 3000);
  eq(ch.state, LivenessState.CHALLENGE_STARTED, 'không được phát lệnh/ghi nhận khi chưa nhìn thẳng');
});

test('Liveness: không quay lại nhìn thẳng kịp → INCONCLUSIVE (TIMEOUT_RETURN)', () => {
  const ch = new LivenessChallenge({ ...LCFG, challenges: ['TURN_LEFT'] }, seqRng([0]));
  ch.start(0);
  simulate(ch, () => sample(), 0, 700);
  simulate(ch, () => sample({ yaw: 25, frontalOk: false }), 700, 700 + LCFG.returnTimeoutMs + 1500);
  eq(ch.state, LivenessState.LIVENESS_INCONCLUSIVE);
  eq(ch.reason, 'TIMEOUT_RETURN');
});

test('Liveness: mất mặt quá lâu giữa thử thách → huỷ; mất ngắn thì tha', () => {
  const ch = new LivenessChallenge({ ...LCFG, challenges: ['BLINK'] }, seqRng([0]));
  ch.start(0);
  simulate(ch, () => sample(), 0, 700);
  simulate(ch, (t) => sample({ faceOk: !(t >= 900 && t < 1300) }), 700, 1500);
  eq(ch.state, LivenessState.WAITING_FOR_ACTION, 'mất 400 ms vẫn ổn');
  simulate(ch, (t) => sample({ faceOk: false }), 1500, 3000);
  eq(ch.state, LivenessState.LIVENESS_INCONCLUSIVE);
  eq(ch.reason, 'FACE_LOST');
});

test('Liveness: kết quả hết hạn sau validityMs', () => {
  const ch = new LivenessChallenge({ ...LCFG, challenges: ['BLINK'], validityMs: 5000 }, seqRng([0]));
  ch.start(0);
  simulate(ch, () => sample(), 0, 700);
  const p = ch.promptTs;
  simulate(ch, (t) => sample({ ear: t >= p + 700 && t < p + 850 ? 0.07 : 0.3 }), 700, 2600);
  eq(ch.state, LivenessState.CHALLENGE_PASSED);
  assert(ch.isValid(ch.passedAt + 4000));
  assert(!ch.isValid(ch.passedAt + 6000));
});

test('Liveness: nhiều bước liên tiếp (challengeCount = 2)', () => {
  const ch = new LivenessChallenge({ ...LCFG, challenges: ['BLINK', 'TURN_LEFT'], challengeCount: 2 }, seqRng([0, 0]));
  ch.start(0);
  eq(ch.steps.length, 2);
  simulate(ch, () => sample(), 0, 700);
  const t0 = ch.promptTs;
  simulate(ch, (t) => sample({ ear: t >= t0 + 700 && t < t0 + 850 ? 0.07 : 0.3 }), 700, 2300);
  eq(ch.state, LivenessState.WAITING_FOR_ACTION);
  eq(ch.currentType, ChallengeType.TURN_LEFT);
});

// ------------------------------------------------------------------------------------ canCapture & thông báo

function readyState(overrides = {}) {
  const analysis = analyzeFrame(resultOf([goodFace()], [frontalMatrix()]), { ...VIEW, ts: 1000 }, CONFIG, null);
  const live = new LivenessChallenge(LCFG, seqRng([0]));
  return {
    analysis,
    qualityEval: { ready: true, ok: true, brightnessOk: true, sharpnessOk: true },
    stability: { stable: true, stableMs: 1200, motionOk: true },
    liveness: live,
    now: 1100,
    cameraRunning: true,
    ...overrides,
  };
}

function passedLiveness() {
  const ch = new LivenessChallenge({ ...LCFG, challenges: ['BLINK'] }, seqRng([0]));
  ch.start(0);
  simulate(ch, () => sample(), 0, 700);
  const p = ch.promptTs;
  simulate(ch, (t) => sample({ ear: t >= p + 700 && t < p + 850 ? 0.07 : 0.3 }), 700, 2300);
  return ch;
}

test('canCapture: tắt liveness → chỉ cần hình học + chất lượng + ổn định', () => {
  const cfg = { ...CONFIG, liveness: { ...CONFIG.liveness, enabled: false } };
  const r = canCapture(readyState(), cfg);
  assert(r.ok, r.reasons.join('; '));
});

test('canCapture: bật liveness → chưa hoàn thành thử thách thì khoá', () => {
  const r = canCapture(readyState(), CONFIG);
  assert(!r.ok);
  assert(r.reasons.some((x) => x.includes('Thử thách')));
});

test('canCapture: đạt khi đủ mọi điều kiện (có liveness đã PASSED)', () => {
  const ch = passedLiveness();
  const s = readyState({ liveness: ch, now: ch.passedAt + 1100 });
  s.analysis.ts = s.now - 50;
  const r = canCapture(s, CONFIG);
  assert(r.ok, r.reasons.join('; '));
});

test('canCapture: từng điều kiện vi phạm đều khoá nút', () => {
  const cfg = { ...CONFIG, liveness: { ...CONFIG.liveness, enabled: false } };
  const base = () => readyState({ now: 1100 });
  const cases = {
    'nhiều mặt': (s) => (s.analysis = analyzeFrame(resultOf([goodFace(), goodFace({ cx: 0.7 })], [frontalMatrix(), frontalMatrix()]), { ...VIEW, ts: 1000 }, CONFIG, null)),
    'không mặt': (s) => (s.analysis = analyzeFrame(resultOf([], []), { ...VIEW, ts: 1000 }, CONFIG, null)),
    'mặt quá gần': (s) => (s.analysis = analyzeFrame(resultOf([goodFace({ h: 0.9, w: 0.3 })], [frontalMatrix()]), { ...VIEW, ts: 1000 }, CONFIG, null)),
    'mặt nghiêng': (s) => (s.analysis = analyzeFrame(resultOf([goodFace()], [makeMatrix(0, 0, 15)]), { ...VIEW, ts: 1000 }, CONFIG, null)),
    'chất lượng kém': (s) => (s.qualityEval = { ready: true, ok: false, brightnessOk: false, sharpnessOk: true }),
    'chưa đo chất lượng': (s) => (s.qualityEval = { ready: false, ok: false }),
    'chưa ổn định': (s) => (s.stability = { stable: false, stableMs: 300, motionOk: true }),
    'phân tích đã cũ': (s) => (s.now = 5000),
    'camera dừng': (s) => (s.cameraRunning = false),
  };
  for (const [name, mutate] of Object.entries(cases)) {
    const s = base();
    mutate(s);
    assert(!canCapture(s, cfg).ok, `phải khoá khi: ${name}`);
  }
  assert(canCapture(base(), cfg).ok, 'trạng thái gốc phải đạt');
});

test('resolveGuidance: đúng thông báo & màu theo tình huống', () => {
  const cfg = { ...CONFIG, liveness: { ...CONFIG.liveness, enabled: false } };
  const mk = (face, matrix = frontalMatrix(), over = {}) => ({
    analysis: analyzeFrame(resultOf(face ? [face] : [], face ? [matrix] : []), { ...VIEW, ts: 0 }, cfg, null),
    qualityEval: { ready: true, ok: true, brightnessOk: true, sharpnessOk: true },
    stability: { stable: false, stableMs: 200, motionOk: true, progress: 0.2 },
    liveness: new LivenessChallenge(cfg.liveness),
    livenessEnabled: false,
    canCapture: false,
    noFaceMs: 0,
    ...over,
  });
  let g = resolveGuidance(mk(null));
  eq(g.key, 'FIND_FACE');
  eq(g.tone, 'gray');
  eq(resolveGuidance(mk(null, undefined, { noFaceMs: 4000 })).key, 'CENTER_FACE');
  eq(resolveGuidance(mk(goodFace({ yaw: 25 }), makeMatrix(25, 0, 0))).key, 'LOOK_STRAIGHT');
  eq(resolveGuidance(mk(goodFace({ h: 0.9, w: 0.3 }))).key, 'MOVE_BACK');
  eq(resolveGuidance(mk(goodFace({ h: 0.25, w: 0.1 }))).key, 'COME_CLOSER');
  g = resolveGuidance(mk(goodFace()));
  eq(g.key, 'CHECKING');
  eq(g.tone, 'yellow');
  g = resolveGuidance(mk(goodFace(), undefined, { qualityEval: { ready: true, ok: false, hint: 'LOW_LIGHT' } }));
  eq(g.key, 'LOW_LIGHT');
  g = resolveGuidance(mk(goodFace(), undefined, { stability: { stable: false, motionOk: false } }));
  eq(g.key, 'HOLD_STEADY');
  g = resolveGuidance(mk(goodFace(), undefined, { canCapture: true, stability: { stable: true, motionOk: true } }));
  eq(g.key, 'READY');
  eq(g.tone, 'green');
});

test('resolveLivenessStatus: không bao giờ tuyên bố "người thật đã được xác minh"', () => {
  const ch = passedLiveness();
  const s = { livenessEnabled: true, liveness: ch };
  const label = resolveLivenessStatus(s, ch.passedAt + 100).label;
  assert(label.includes('thử thách cơ bản'), label);
  assert(!/đã được xác minh|người thật đã/i.test(label), label);
  eq(resolveLivenessStatus({ livenessEnabled: false }, 0).tone, 'gray');
  const geo = resolveGeoStatus({
    analysis: analyzeFrame(resultOf([], []), { ...VIEW, ts: 0 }, CONFIG, null),
  });
  eq(geo.tone, 'gray');
});
