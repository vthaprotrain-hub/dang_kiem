/**
 * geometry-validator.js — Các hàm THUẦN (không đụng DOM) để kiểm tra hình học khuôn mặt:
 * số lượng mặt, vị trí, tỷ lệ, góc (yaw/pitch/roll) và độ ổn định theo thời gian.
 *
 * Quy ước toạ độ:
 *  - Landmark của MediaPipe: x, y chuẩn hoá 0–1 theo KHUNG VIDEO GỐC (chưa lật gương), z cùng thang với x
 *    (z nhỏ hơn = gần camera hơn).
 *  - "Toạ độ view" = toạ độ chuẩn hoá 0–1 theo VÙNG CAMERA ĐANG HIỂN THỊ (sau object-fit: cover và sau
 *    lật gương nếu có). Mọi quy tắc vị trí/tỷ lệ tính trên toạ độ view, nên hướng dẫn "trái/phải" khớp với
 *    thứ người dùng nhìn thấy. Lật gương chỉ được áp dụng MỘT LẦN, ở `videoToView` (canvas overlay không bị
 *    CSS lật).
 *  - Dấu của yaw: dương = người dùng quay sang TRÁI của chính họ (mũi dịch sang phải khung hình gốc).
 */

export const FaceState = Object.freeze({
  NO_FACE: 'NO_FACE',
  MULTIPLE_FACES: 'MULTIPLE_FACES',
  FACE_DETECTED: 'FACE_DETECTED',
});

/** Chỉ số landmark (mô hình 478 điểm của MediaPipe Face Landmarker). */
export const LM = Object.freeze({
  FOREHEAD: 10,
  CHIN: 152,
  NOSE_TIP: 1,
  /** Mép má bên PHẢI của chủ thể (xuất hiện bên TRÁI khung hình gốc). */
  FACE_EDGE_IMAGE_LEFT: 234,
  /** Mép má bên TRÁI của chủ thể (xuất hiện bên PHẢI khung hình gốc). */
  FACE_EDGE_IMAGE_RIGHT: 454,
  EYE_OUTER_IMAGE_LEFT: 33,
  EYE_OUTER_IMAGE_RIGHT: 263,
});

/** Đường viền oval khuôn mặt (36 điểm) — dùng để vẽ ở chế độ kỹ thuật. */
export const FACE_OVAL_INDICES = Object.freeze([
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176,
  149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
]);

const RAD2DEG = 180 / Math.PI;

// ---------------------------------------------------------------------------------------------
// Ánh xạ toạ độ video → toạ độ view
// ---------------------------------------------------------------------------------------------

/** Biến đổi tương ứng với CSS `object-fit: cover` (video lấp đầy view, cắt phần thừa ở giữa). */
export function computeViewTransform(videoW, videoH, viewW, viewH) {
  const scale = Math.max(viewW / videoW, viewH / videoH);
  const dispW = videoW * scale;
  const dispH = videoH * scale;
  return {
    videoW,
    videoH,
    viewW,
    viewH,
    scale,
    dispW,
    dispH,
    offsetX: (dispW - viewW) / 2,
    offsetY: (dispH - viewH) / 2,
  };
}

/** Chuyển (nx, ny) chuẩn hoá theo video gốc sang toạ độ view chuẩn hoá; lật gương đúng một lần. */
export function videoToView(nx, ny, t, mirrored) {
  let x = (nx * t.dispW - t.offsetX) / t.viewW;
  const y = (ny * t.dispH - t.offsetY) / t.viewH;
  if (mirrored) x = 1 - x;
  return { x, y };
}

/** Hình oval placeholder: px (cx, cy, rx, ry) và toạ độ chuẩn hoá của tâm. */
export function computeOval(viewW, viewH, cfg) {
  let h = cfg.heightRatio * viewH;
  let w = h * cfg.aspect;
  const maxW = cfg.maxWidthRatio * viewW;
  if (w > maxW) {
    w = maxW;
    h = w / cfg.aspect;
  }
  return {
    cx: cfg.centerX * viewW,
    cy: cfg.centerY * viewH,
    rx: w / 2,
    ry: h / 2,
    ncx: cfg.centerX,
    ncy: cfg.centerY,
    heightRatio: h / viewH,
  };
}

// ---------------------------------------------------------------------------------------------
// Bounding box & phân loại số lượng mặt
// ---------------------------------------------------------------------------------------------

/** Bounding box trong toạ độ view. `mapPoint(nx, ny) → {x, y}`. */
export function computeFaceBox(landmarks, mapPoint) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < landmarks.length; i++) {
    const p = mapPoint(landmarks[i].x, landmarks[i].y);
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return {
    minX,
    maxX,
    minY,
    maxY,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    w: maxX - minX,
    h: maxY - minY,
  };
}

/** Bounding box theo toạ độ video gốc chuẩn hoá (dùng để cắt ảnh phân tích chất lượng). */
export function computeRawBox(landmarks) {
  return computeFaceBox(landmarks, (x, y) => ({ x, y }));
}

/**
 * Phân loại: NO_FACE / MULTIPLE_FACES / FACE_DETECTED.
 * Mặt phụ quá nhỏ (chiều cao < ignoreSmallFaceRatio) bị bỏ qua.
 * @returns {{state:string, primary:number, significant:number[]}}
 */
export function classifyFaces(boxes, cfg) {
  const significant = [];
  boxes.forEach((b, i) => {
    if (b.h >= cfg.ignoreSmallFaceRatio) significant.push(i);
  });
  if (significant.length === 0) return { state: FaceState.NO_FACE, primary: -1, significant };
  if (significant.length > 1) return { state: FaceState.MULTIPLE_FACES, primary: -1, significant };
  return { state: FaceState.FACE_DETECTED, primary: significant[0], significant };
}

// ---------------------------------------------------------------------------------------------
// Vị trí & tỷ lệ
// ---------------------------------------------------------------------------------------------

/**
 * So sánh tâm mặt với tâm placeholder (toạ độ view chuẩn hoá).
 * dx > 0: mặt nằm bên phải tâm oval (trên màn hình) → cần dịch sang TRÁI.
 * dy > 0: mặt nằm thấp hơn tâm oval → cần NÂNG mặt lên.
 */
export function checkPosition(box, ovalCenter, cfg) {
  const dx = box.cx - ovalCenter.x;
  const dy = box.cy - ovalCenter.y;
  const okX = Math.abs(dx) <= cfg.maxOffsetX;
  const okY = Math.abs(dy) <= cfg.maxOffsetY;
  let hint = null;
  if (!okX || !okY) {
    const ex = Math.abs(dx) / cfg.maxOffsetX;
    const ey = Math.abs(dy) / cfg.maxOffsetY;
    if (!okX && (okY || ex >= ey)) hint = dx > 0 ? 'MOVE_LEFT' : 'MOVE_RIGHT';
    else hint = dy > 0 ? 'RAISE_FACE' : 'LOWER_FACE';
  }
  return { ok: okX && okY, okX, okY, dx, dy, hint };
}

/** Tỷ lệ chiều cao bounding box mặt / chiều cao vùng camera. Hoàn toàn độc lập với vị trí tâm. */
export function checkScale(box, cfg) {
  const ratio = box.h;
  let hint = null;
  if (ratio < cfg.min) hint = 'COME_CLOSER';
  else if (ratio > cfg.max) hint = 'MOVE_BACK';
  return { ok: hint === null, ratio, hint };
}

// ---------------------------------------------------------------------------------------------
// Góc mặt
// ---------------------------------------------------------------------------------------------

/**
 * Ước lượng yaw/pitch/roll (độ) từ ma trận biến đổi khuôn mặt 4×4 của MediaPipe.
 * Ma trận biến đổi khuôn mặt chuẩn → camera (hệ toạ độ tay phải: x phải, y lên, z hướng về camera;
 * mặt nhìn thẳng ≈ ma trận đơn vị). Tự nhận diện thứ tự lưu (cột-trước hay hàng-trước) bằng vị trí
 * thành phần tịnh tiến, và loại bỏ hệ số tỷ lệ bằng cách chuẩn hoá cột.
 *
 * Trả về valid=false nếu ma trận không hợp lệ hoặc hướng "mặt" bị đảo (z âm) — khi đó caller phải
 * dùng `estimatePoseFromLandmarks`.
 *
 * Dấu: yawRaw dương = vector hướng mặt lệch về +x (bên phải khung hình gốc) = người dùng quay sang trái;
 * pitch dương = cúi. Roll chỉ dùng trị tuyệt đối.
 */
export function estimatePoseFromMatrix(matrix) {
  const d = matrix && (matrix.data || matrix);
  if (!d || d.length < 16) return { valid: false, reason: 'NO_MATRIX' };
  for (let i = 0; i < 16; i++) if (!Number.isFinite(d[i])) return { valid: false, reason: 'NAN' };

  const colMajorScore = Math.abs(d[3]) + Math.abs(d[7]) + Math.abs(d[11]);
  const rowMajorScore = Math.abs(d[12]) + Math.abs(d[13]) + Math.abs(d[14]);
  const columnMajor = colMajorScore <= rowMajorScore;
  const at = (r, c) => (columnMajor ? d[c * 4 + r] : d[r * 4 + c]);

  // Chuẩn hoá từng cột của ma trận 3×3 để bỏ hệ số tỷ lệ.
  const R = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let c = 0; c < 3; c++) {
    const n = Math.hypot(at(0, c), at(1, c), at(2, c));
    if (n < 1e-6) return { valid: false, reason: 'DEGENERATE' };
    for (let r = 0; r < 3; r++) R[r][c] = at(r, c) / n;
  }

  if (R[2][2] < -0.2) return { valid: false, reason: 'FLIPPED_FORWARD_AXIS' };

  const yawRaw = Math.atan2(R[0][2], R[2][2]) * RAD2DEG;
  const pitch = Math.asin(Math.max(-1, Math.min(1, -R[1][2]))) * RAD2DEG;
  const roll = Math.atan2(R[1][0], R[1][1]) * RAD2DEG;
  return { valid: true, yawRaw, pitch, roll, columnMajor };
}

/**
 * Ước lượng góc từ landmark 3D (dự phòng / đối chiếu). Dùng hình học thật của các điểm:
 *  - yaw  : vector giữa hai mép má (234 → 454) trong mặt phẳng x–z.
 *  - pitch: vector trán → cằm trong mặt phẳng y–z.
 *  - roll : đường nối hai khoé mắt ngoài trong mặt phẳng ảnh.
 * Đây là xấp xỉ (khuôn mặt thật không phẳng, nên pitch có độ lệch nền vài độ); KHÔNG phải góc chính xác.
 * @param {number} aspect videoWidth / videoHeight (để đưa y về cùng thang với x và z)
 */
export function estimatePoseFromLandmarks(lm, aspect) {
  const L = lm[LM.FACE_EDGE_IMAGE_LEFT];
  const R = lm[LM.FACE_EDGE_IMAGE_RIGHT];
  const F = lm[LM.FOREHEAD];
  const C = lm[LM.CHIN];
  const eL = lm[LM.EYE_OUTER_IMAGE_LEFT];
  const eR = lm[LM.EYE_OUTER_IMAGE_RIGHT];
  if (!L || !R || !F || !C || !eL || !eR) return { valid: false };

  const yaw = Math.atan2(R.z - L.z, R.x - L.x) * RAD2DEG;
  const faceH = (C.y - F.y) / aspect;
  const pitch = Math.atan2(-(F.z - C.z), faceH) * RAD2DEG;
  const roll = Math.atan2((eR.y - eL.y) / aspect, eR.x - eL.x) * RAD2DEG;
  return { valid: true, yaw, pitch, roll };
}

/**
 * Bộ hiệu chuẩn dấu yaw của ma trận so với landmark: bỏ phiếu mỗi khi cả hai đều cho thấy quay đầu rõ ràng.
 * Chỉ ảnh hưởng đến DẤU (hướng trái/phải của thử thách quay đầu), không bao giờ tạo ra góc giả.
 */
export class YawSignCalibrator {
  constructor({ minLandmarkDeg = 8, minMatrixDeg = 5, minVotes = 8, minAgreement = 0.6 } = {}) {
    this.minLandmarkDeg = minLandmarkDeg;
    this.minMatrixDeg = minMatrixDeg;
    this.minVotes = minVotes;
    this.minAgreement = minAgreement;
    this.reset();
  }

  reset() {
    this.votes = 0;
    this.balance = 0; // +1 mỗi phiếu "cùng dấu", -1 mỗi phiếu "ngược dấu"
  }

  observe(yawMatrixRaw, yawLandmark) {
    if (Math.abs(yawLandmark) < this.minLandmarkDeg || Math.abs(yawMatrixRaw) < this.minMatrixDeg) return;
    this.votes++;
    this.balance += Math.sign(yawMatrixRaw) === Math.sign(yawLandmark) ? 1 : -1;
  }

  get confident() {
    return this.votes >= this.minVotes && Math.abs(this.balance) >= this.minAgreement * this.votes;
  }

  get sign() {
    return this.balance >= 0 ? 1 : -1;
  }
}

/**
 * Gộp ước lượng từ ma trận và landmark thành một bộ góc duy nhất.
 * - Pitch/roll: lấy từ ma trận (chỉ dùng trị tuyệt đối cho quy tắc), dự phòng landmark.
 * - Yaw: độ lớn từ ma trận; dấu từ bộ hiệu chuẩn (khi đã tin cậy) hoặc từ dấu của landmark.
 */
export function resolvePose(matrix, landmarks, aspect, calibrator) {
  const m = estimatePoseFromMatrix(matrix);
  const l = estimatePoseFromLandmarks(landmarks, aspect);

  if (m.valid) {
    if (l.valid && calibrator) calibrator.observe(m.yawRaw, l.yaw);
    let sign = 1;
    if (calibrator && calibrator.confident) sign = calibrator.sign;
    else if (l.valid && Math.abs(l.yaw) >= 1) sign = Math.sign(l.yaw) * Math.sign(m.yawRaw || 1);
    const yaw = sign * m.yawRaw;
    const conflict =
      l.valid && (Math.abs(Math.abs(l.yaw) - Math.abs(yaw)) > 25 || Math.abs(Math.abs(l.pitch) - Math.abs(m.pitch)) > 40);
    return {
      valid: true,
      source: 'matrix',
      yaw,
      pitch: m.pitch,
      roll: m.roll,
      landmarkYaw: l.valid ? l.yaw : null,
      landmarkPitch: l.valid ? l.pitch : null,
      conflict,
      yawSignConfident: !!(calibrator && calibrator.confident),
    };
  }
  if (l.valid) {
    return {
      valid: true,
      source: 'landmarks',
      yaw: l.yaw,
      pitch: l.pitch,
      roll: l.roll,
      landmarkYaw: l.yaw,
      landmarkPitch: l.pitch,
      conflict: false,
      yawSignConfident: false,
    };
  }
  return { valid: false, source: 'none', yaw: 0, pitch: 0, roll: 0, conflict: false, yawSignConfident: false };
}

/** Đánh giá góc theo ngưỡng. `hint` dùng chung thông báo "nhìn thẳng"/"giữ đầu thẳng". */
export function evaluatePose(pose, cfg) {
  if (!pose || !pose.valid) return { ok: false, yawOk: false, pitchOk: false, rollOk: false, hint: 'LOOK_STRAIGHT' };
  const yawOk = Math.abs(pose.yaw) <= cfg.maxYaw;
  const pitchOk = Math.abs(pose.pitch) <= cfg.maxPitch;
  const rollOk = Math.abs(pose.roll) <= cfg.maxRoll;
  let hint = null;
  if (!yawOk || !pitchOk) hint = 'LOOK_STRAIGHT';
  else if (!rollOk) hint = 'KEEP_HEAD_STRAIGHT';
  return { ok: yawOk && pitchOk && rollOk, yawOk, pitchOk, rollOk, hint };
}

// ---------------------------------------------------------------------------------------------
// Phân tích một frame
// ---------------------------------------------------------------------------------------------

/**
 * Từ kết quả Face Landmarker → toàn bộ đánh giá hình học của một frame.
 * @param {{faceLandmarks:Array, facialTransformationMatrixes?:Array}} result
 * @param {{videoW:number, videoH:number, viewW:number, viewH:number, mirrored:boolean, ts:number}} ctx
 * @param {object} cfg  CONFIG
 * @param {YawSignCalibrator} [calibrator]
 */
export function analyzeFrame(result, ctx, cfg, calibrator) {
  const faces = (result && result.faceLandmarks) || [];
  const matrices = (result && result.facialTransformationMatrixes) || [];
  const transform = computeViewTransform(ctx.videoW, ctx.videoH, ctx.viewW, ctx.viewH);
  const map = (x, y) => videoToView(x, y, transform, ctx.mirrored);
  const boxes = faces.map((lm) => computeFaceBox(lm, map));
  const cls = classifyFaces(boxes, cfg.detection);
  const oval = computeOval(ctx.viewW, ctx.viewH, cfg.oval);

  const analysis = {
    ts: ctx.ts,
    faceState: cls.state,
    faceCount: faces.length,
    significantFaceCount: cls.significant.length,
    transform,
    mirrored: ctx.mirrored,
    oval,
    boxes,
    significant: cls.significant,
    primary: cls.primary,
    box: null,
    rawBox: null,
    landmarks: null,
    position: null,
    scale: null,
    pose: null,
    poseEval: null,
    rules: { singleFace: false, position: false, scale: false, pose: false },
    geometryOk: false,
    hint: cls.state === FaceState.NO_FACE ? 'FIND_FACE' : 'SINGLE_FACE',
  };

  if (cls.state !== FaceState.FACE_DETECTED) return analysis;

  const lm = faces[cls.primary];
  analysis.landmarks = lm;
  analysis.box = boxes[cls.primary];
  analysis.rawBox = computeRawBox(lm);
  analysis.position = checkPosition(analysis.box, { x: oval.ncx, y: oval.ncy }, cfg.position);
  analysis.scale = checkScale(analysis.box, cfg.scale);
  analysis.pose = resolvePose(matrices[cls.primary], lm, ctx.videoW / ctx.videoH, calibrator);
  analysis.poseEval = evaluatePose(analysis.pose, cfg.pose);
  analysis.rules = {
    singleFace: true,
    position: analysis.position.ok,
    scale: analysis.scale.ok,
    pose: analysis.poseEval.ok,
  };
  analysis.geometryOk = analysis.rules.position && analysis.rules.scale && analysis.rules.pose;
  analysis.hint =
    analysis.position.hint || analysis.scale.hint || analysis.poseEval.hint || null;
  return analysis;
}

// ---------------------------------------------------------------------------------------------
// Độ ổn định theo thời gian
// ---------------------------------------------------------------------------------------------

/**
 * Theo dõi độ ổn định bằng TIMESTAMP thực của frame (không đếm số frame).
 * - Tốc độ dịch chuyển tâm mặt được chuẩn hoá theo chiều cao mặt (đơn vị: chiều cao mặt / giây),
 *   nên độc lập với khoảng cách tới camera và với FPS.
 * - `stableMs` chỉ tăng khi mọi quy tắc đạt VÀ chuyển động nằm trong ngưỡng; bất kỳ vi phạm nào cũng reset.
 */
export class StabilityTracker {
  constructor(cfg) {
    this.cfg = cfg;
    this.reset();
  }

  reset() {
    this.prev = null; // {ts, cx, cy}
    this.smoothedSpeed = 0;
    this.instantSpeed = 0;
    this.stableSince = null;
    this.stableMs = 0;
    this.motionOk = true;
  }

  /**
   * @param {number} ts   timestamp frame (ms)
   * @param {{box:object}|null} sample  null khi không có đúng một mặt
   * @param {boolean} rulesOk  tất cả quy tắc (hình học + chất lượng) đang đạt
   */
  update(ts, sample, rulesOk) {
    const cfg = this.cfg;
    if (!sample || !sample.box) {
      this.reset();
      return this.snapshot();
    }
    const { cx, cy, h } = sample.box;
    if (this.prev) {
      const dt = ts - this.prev.ts;
      if (dt <= 0) return this.snapshot();
      if (dt > cfg.maxGapMs) {
        this.stableSince = null;
        this.smoothedSpeed = 0;
        this.instantSpeed = 0;
      } else {
        const dist = Math.hypot(cx - this.prev.cx, cy - this.prev.cy);
        this.instantSpeed = dist / (dt / 1000) / Math.max(h, 1e-3);
        const alpha = 1 - Math.exp(-dt / cfg.smoothingMs);
        this.smoothedSpeed += alpha * (this.instantSpeed - this.smoothedSpeed);
      }
    }
    this.prev = { ts, cx, cy };

    this.motionOk =
      this.smoothedSpeed <= cfg.maxSmoothedSpeed && this.instantSpeed <= cfg.maxInstantSpeed;

    if (rulesOk && this.motionOk) {
      if (this.stableSince === null) this.stableSince = ts;
      this.stableMs = ts - this.stableSince;
    } else {
      this.stableSince = null;
      this.stableMs = 0;
    }
    return this.snapshot();
  }

  snapshot() {
    return {
      stableMs: this.stableMs,
      stable: this.stableMs >= this.cfg.requiredMs,
      progress: Math.min(1, this.stableMs / this.cfg.requiredMs),
      motionOk: this.motionOk,
      smoothedSpeed: this.smoothedSpeed,
      instantSpeed: this.instantSpeed,
    };
  }
}
