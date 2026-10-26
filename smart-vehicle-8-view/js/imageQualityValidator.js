/**
 * imageQualityValidator.js — Kiểm tra chất lượng ảnh ngay trên trình duyệt.
 *
 * Điểm `qualityScore` là điểm đánh giá của POC (0–100), KHÔNG phải chỉ số kiểm định chuyên ngành.
 * Mọi ngưỡng nằm trong CONFIG.quality và chỉnh được ở chế độ kiểm thử, vì một ngưỡng cố định không phù hợp
 * mọi thiết bị/ánh sáng.
 *
 * validateImageQuality(image, expectedAngle, context) → { isValid, qualityScore, errors, warnings, suggestedAction, metrics, hash }
 */
import { ANGLE_BY_KEY, CONFIG } from './config.js';
import { T, angleName } from './strings.js';
import { clamp, containedRatio, scratchCanvas } from './utils.js';

/* ----------------------------- phân tích điểm ảnh ----------------------------- */
function toGrayImage(canvas, maxSide) {
  const sw = canvas.width;
  const sh = canvas.height;
  const k = Math.min(1, maxSide / Math.max(sw, sh));
  const w = Math.max(16, Math.round(sw * k));
  const h = Math.max(16, Math.round(sh * k));
  const c = scratchCanvas('quality-analysis', w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(canvas, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const gray = new Float32Array(w * h);
  let sum = 0;
  let sum2 = 0;
  let hi = 0;
  let lo = 0;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    gray[p] = g;
    sum += g;
    sum2 += g * g;
    if (g > 250) hi++;
    if (g < 20) lo++;
  }
  const n = gray.length;
  const mean = sum / n;
  const std = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
  return { gray, w, h, mean, std, clippedHigh: hi / n, clippedLow: lo / n };
}

/** Điểm sắc nét: trung bình phương sai Laplacian của 25% khối sắc nét nhất (tránh vùng sơn trơn kéo điểm xuống). */
function sharpness(gray, w, h) {
  const block = 32;
  const bw = Math.max(1, Math.floor(w / block));
  const bh = Math.max(1, Math.floor(h / block));
  const vars = [];
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      let s = 0;
      let s2 = 0;
      let n = 0;
      const x0 = bx * block + 1;
      const y0 = by * block + 1;
      const x1 = Math.min(w - 1, (bx + 1) * block - 1);
      const y1 = Math.min(h - 1, (by + 1) * block - 1);
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = y * w + x;
          const lap = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w];
          s += lap;
          s2 += lap * lap;
          n++;
        }
      }
      if (n) vars.push(s2 / n - (s / n) * (s / n));
    }
  }
  if (!vars.length) return 0;
  vars.sort((a, b) => b - a);
  const top = vars.slice(0, Math.max(1, Math.ceil(vars.length * 0.25)));
  return top.reduce((a, b) => a + b, 0) / top.length;
}

/** dHash 64-bit (hex) — dùng để phát hiện ảnh gần như trùng nhau. */
function dHash(gray, w, h) {
  const cols = 9;
  const rows = 8;
  const cell = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x0 = Math.floor((c * w) / cols);
      const x1 = Math.max(x0 + 1, Math.floor(((c + 1) * w) / cols));
      const y0 = Math.floor((r * h) / rows);
      const y1 = Math.max(y0 + 1, Math.floor(((r + 1) * h) / rows));
      let s = 0;
      let n = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { s += gray[y * w + x]; n++; }
      cell.push(s / n);
    }
  }
  let bits = '';
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols - 1; c++) bits += cell[r * cols + c] > cell[r * cols + c + 1] ? '1' : '0';
  let hex = '';
  for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}
export function hammingHex(a, b) {
  if (!a || !b || a.length !== b.length) return 64;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) { d += x & 1; x >>= 1; }
  }
  return d;
}

export function analyzePixels(canvas, cfg = CONFIG.quality) {
  const { gray, w, h, mean, std, clippedHigh, clippedLow } = toGrayImage(canvas, cfg.analysisMaxSide);
  return { mean, std, clippedHigh, clippedLow, sharp: sharpness(gray, w, h), hash: dHash(gray, w, h), analyzedSize: [w, h] };
}

/* ----------------------------- bbox xe trong ảnh tĩnh ----------------------------- */
/**
 * Chọn xe chính từ kết quả detectStill() và tính các số đo khung.
 * @returns {null|{bbox, areaRatio, clipped, score, cls}}
 */
export function summarizeStillDetection(det) {
  if (!det?.ok) return null;
  if (!det.vehicles.length) return { none: true };
  const v = [...det.vehicles].sort((a, b) => b.bbox.w * b.bbox.h * b.score - a.bbox.w * a.bbox.h * a.score)[0];
  const m = CONFIG.detection.edgeMargin;
  const b = v.bbox;
  const clipped = { left: b.x <= m, right: b.x + b.w >= 1 - m, top: b.y <= m, bottom: b.y + b.h >= 1 - m };
  clipped.count = [clipped.left, clipped.right, clipped.top, clipped.bottom].filter(Boolean).length;
  return { none: false, bbox: b, areaRatio: b.w * b.h, clipped, score: v.score, cls: v.cls, count: det.vehicles.length };
}

/* ----------------------------- hàm chính ----------------------------- */
/**
 * @param {HTMLCanvasElement} image
 * @param {string} expectedAngle  khóa góc dự kiến
 * @param {object} ctx
 * @param {'portrait'|'landscape'} ctx.orientation
 * @param {object|null} ctx.stillDetection     kết quả detectStill() (hoặc DEMO) — null nếu AI không khả dụng
 * @param {boolean} ctx.aiAvailable
 * @param {{nx,ny,nw,nh}|null} ctx.guideRect   khung hướng dẫn (chuẩn hóa)
 * @param {boolean} ctx.steady                 điện thoại có ổn định khi chụp
 * @param {{stable:boolean}|null} ctx.stability
 * @param {{key:string,name:string,hash:string}[]} ctx.otherHashes  ảnh đã chụp của các góc KHÁC
 * @param {object|null} ctx.classifier         kết quả classifyView() trên ảnh
 * @param {object|null} ctx.angleEstimate      kết quả ViewAngleDetector tại thời điểm chụp
 * @param {object} [ctx.config]                ghi đè ngưỡng (chế độ kiểm thử)
 */
export function validateImageQuality(image, expectedAngle, ctx = {}) {
  const cfg = { ...CONFIG.quality, ...(ctx.config || {}) };
  const orientation = ctx.orientation ?? (image.height >= image.width ? 'portrait' : 'landscape');
  const errors = [];
  const warnings = [];
  const addE = (code, message) => errors.push({ code, message });
  const addW = (code, message) => warnings.push({ code, message });
  const angle = ANGLE_BY_KEY[expectedAngle];

  const px = analyzePixels(image, cfg);

  /* --- trống / tối / sáng / tương phản --- */
  if (px.mean < cfg.veryDarkMean) addE('too_dark', T.quality.veryDark);          // kể cả ảnh đen do che ống kính
  else if (px.std < cfg.emptyStd) addE('empty', T.quality.empty);
  else if (px.mean < cfg.darkMean) addW('dark', T.quality.dark);
  if (px.mean > cfg.brightMean || px.clippedHigh > 0.35) addW('overexposed', T.quality.bright);
  if (px.std >= cfg.emptyStd && px.std < cfg.lowContrastStd) addW('low_contrast', T.quality.lowContrast);

  /* --- độ nét --- */
  if (px.std >= cfg.emptyStd) {
    if (px.sharp < cfg.blurError) addE('blurry', T.quality.blurSevere);
    else if (px.sharp < cfg.blurWarn) addW('soft', T.quality.blur);
  }

  /* --- rung khi chụp --- */
  if (ctx.steady === false) addW('shaky', T.quality.shaky);

  /* --- xe trong ảnh --- */
  const sd = ctx.aiAvailable === false ? null : ctx.stillDetection ?? null;
  let framing = 0.5;
  let coverage = null;
  let det = null;
  if (ctx.aiAvailable === false || !ctx.stillDetection) {
    addW('vehicle_unchecked', T.quality.aiOffline);
  } else if (sd?.none) {
    addE('no_vehicle', T.quality.noVehicle);
    framing = 0;
  } else if (sd) {
    det = sd;
    const minArea = cfg.minAreaRatio[orientation] ?? cfg.minAreaRatio.landscape;
    const endName = expectedAngle === 'front' ? T.quality.clippedFront : expectedAngle === 'rear' ? T.quality.clippedRear : T.quality.clipped;
    framing = 1;
    if (sd.clipped.count >= 2 || sd.areaRatio > cfg.maxAreaRatio) {
      addE('too_close', `${T.quality.tooClose} ${endName}`);
      framing = 0.1;
    } else if (sd.clipped.count === 1) {
      // Xe bị cắt ở một mép khung: ảnh hồ sơ cần thấy trọn xe → mặc định coi là lỗi (có thể hạ xuống cảnh báo qua config).
      if (cfg.clippedIsError) addE('clipped', endName); else addW('clipped', endName);
      framing = 0.55;
    }
    if (sd.areaRatio < minArea * 0.5) {
      addE('too_far', T.quality.tooFar);
      framing = Math.min(framing, 0.15);
    } else if (sd.areaRatio < minArea) {
      addW('small', T.quality.tooFar);
      framing = Math.min(framing, 0.6);
    }
    if (ctx.guideRect) {
      const e = cfg.guideExpand;
      const g = { x: ctx.guideRect.nx - e, y: ctx.guideRect.ny - e, w: ctx.guideRect.nw + 2 * e, h: ctx.guideRect.nh + 2 * e };
      coverage = containedRatio(sd.bbox, g);
      if (coverage < cfg.minGuideCoverage) {
        addW('outside_guide', T.quality.guide);
        framing = Math.min(framing, 0.5 + 0.5 * coverage);
      }
    }
  }

  /* --- trùng ảnh góc khác --- */
  let duplicateOf = null;
  let minHamming = 64;
  for (const o of ctx.otherHashes || []) {
    const d = hammingHex(px.hash, o.hash);
    if (d < minHamming) { minHamming = d; if (d <= cfg.duplicateHamming) duplicateOf = o; }
  }
  if (duplicateOf) addE('duplicate', T.quality.duplicate(angleName(duplicateOf.key)));

  /* --- kiểm tra góc bằng classifier (nếu có) --- */
  let angleScore = 0.5;
  if (ctx.classifier) {
    const p = ctx.classifier.probs;
    const exp = p[angle.index];
    const top = ctx.classifier.topKey;
    if (top !== expectedAngle && ctx.classifier.confidence >= 0.7 && exp < 0.2) {
      addE('angle_mismatch', T.quality.angleMismatch(angle.name.toLowerCase()));
      angleScore = 0;
    } else angleScore = clamp(exp * 1.4, 0.2, 1);
  } else if (ctx.angleEstimate?.predictedAngle) {
    angleScore = ctx.angleEstimate.predictedAngle === expectedAngle ? clamp(ctx.angleEstimate.confidence + 0.15, 0, 1) : 0.25;
  }

  /* --- điểm tổng --- */
  const w = cfg.weights;
  const sharpScore = clamp((px.sharp - cfg.blurError) / (cfg.blurWarn * 1.6 - cfg.blurError), 0, 1);
  const exposure = clamp(
    Math.min(
      (px.mean - cfg.veryDarkMean) / Math.max(1, cfg.darkMean + 25 - cfg.veryDarkMean),
      (255 - px.mean - 20) / Math.max(1, 255 - cfg.brightMean + 10),
      px.std / (cfg.lowContrastStd * 1.5),
    ), 0, 1);
  const steady = ctx.steady === false ? 0.3 : ctx.stability?.stable === false ? 0.6 : 1;
  const total = w.sharp + w.exposure + w.framing + w.steady + w.angle;
  const qualityScore = Math.round((100 * (w.sharp * sharpScore + w.exposure * exposure + w.framing * framing + w.steady * steady + w.angle * angleScore)) / total);

  if (errors.length === 0 && qualityScore < cfg.passScore) addE('low_score', 'Điểm chất lượng tổng thể thấp, vui lòng chụp lại.');

  let suggestedAction = 'accept';
  const first = errors[0]?.code;
  if (first) {
    suggestedAction = ({
      too_dark: 'improve_light', empty: 'check_camera', blurry: 'hold_steady', no_vehicle: 'fit_vehicle',
      too_close: 'step_back', too_far: 'step_closer', duplicate: 'move_to_angle', angle_mismatch: 'move_to_angle', low_score: 'retake',
    })[first] ?? 'retake';
  } else if (warnings.length) suggestedAction = 'accept_with_warnings';

  return {
    isValid: errors.length === 0 && qualityScore >= cfg.passScore,
    qualityScore,
    errors,
    warnings,
    suggestedAction,
    hash: px.hash,
    metrics: {
      meanLuma: +px.mean.toFixed(1),
      stdLuma: +px.std.toFixed(1),
      sharpness: +px.sharp.toFixed(1),
      overexposedFraction: +px.clippedHigh.toFixed(3),
      vehicleAreaRatio: det ? +det.areaRatio.toFixed(3) : null,
      guideCoverage: coverage == null ? null : +coverage.toFixed(2),
      minDuplicateHamming: minHamming,
      width: image.width,
      height: image.height,
      orientation,
    },
  };
}
