/**
 * vehicleOrientationDetector.js — Xác định ĐẦU XE hay ĐUÔI XE để khởi tạo điểm xuất phát.
 *
 * COCO-SSD không phân biệt đầu/đuôi xe. Module gom các bằng chứng khả dụng, mỗi bằng chứng có trọng số
 * thật (không đặt confidence cố định):
 *   1. bbox_aspect   — tỷ lệ khung bbox ↔ mô hình hình học: nhìn dọc (đầu/đuôi) hay nhìn ngang/chéo.
 *   2. plate_ocr     — có đọc được biển số (khớp biển số khách nhập?) ⇒ đang nhìn một đầu xe (chưa biết đầu hay đuôi).
 *   3. lamp_colors   — heuristic màu đèn (đèn hậu đỏ đối xứng / đèn pha sáng đối xứng). RẤT YẾU, bị chặn trần.
 *   4. classifier    — model phân loại 8 góc tùy chọn (nếu có tại assets/models/view-classifier).
 *   5. user_confirmed— khách hàng bấm "Đây là đầu xe / đuôi xe".
 *
 * Khi không đủ bằng chứng, `needsConfirmation = true` và giao diện yêu cầu khách xác nhận thủ công.
 *
 * Trả về: { orientation: 'front'|'rear'|'side'|'unknown', axis, confidence (0–1), evidence[], needsConfirmation, ocr }
 */
import { ANGLES, CONFIG } from './config.js';
import { detectPlate } from './plateOCR.js';
import { vehicleAspect, shapeForType } from './placeholders.js';
import { clamp, scratchCanvas } from './utils.js';

function analyzeAxis(vehicle, vehicleType) {
  if (!vehicle?.present || !vehicle.aspect) return { axis: 'unknown', conf: 0, detail: null };
  const shape = shapeForType(vehicleType);
  const end = vehicleAspect(shape, 0);
  const sides = [45, 90, 135].map((d) => vehicleAspect(shape, d));
  const a = vehicle.aspect;
  const dEnd = Math.abs(Math.log(a / end));
  const dSide = Math.min(...sides.map((s) => Math.abs(Math.log(a / s))));
  const margin = dSide - dEnd;
  const detail = `Tỷ lệ khung ${a.toFixed(2)} (nhìn dọc ≈ ${end.toFixed(2)}, nhìn ngang/chéo ≈ ${Math.max(...sides).toFixed(2)})`;
  if (margin > 0.14) return { axis: 'end_on', conf: clamp(0.45 + margin * 0.9, 0.5, 0.9), detail };
  if (margin < -0.14) return { axis: 'side_on', conf: clamp(0.45 - margin * 0.9, 0.5, 0.9), detail };
  return { axis: 'unknown', conf: 0.2, detail };
}

/** Heuristic màu đèn trên vùng bbox — chỉ là bằng chứng yếu. */
function analyzeLamps(source, boxPx) {
  if (!source || !boxPx) return null;
  const w = 96;
  const h = Math.max(24, Math.round((96 * boxPx.h) / Math.max(1, boxPx.w)));
  const c = scratchCanvas('orient-lamps', w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  try {
    ctx.drawImage(source, boxPx.x, boxPx.y, boxPx.w, boxPx.h, 0, 0, w, h);
  } catch {
    return null;
  }
  const data = ctx.getImageData(0, 0, w, h).data;
  const y0 = Math.floor(h * 0.25);
  const y1 = Math.floor(h * 0.78);
  const thirds = [0, 0, 0].map(() => ({ red: 0, bright: 0, n: 0 }));
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = data[i]; const g = data[i + 1]; const b = data[i + 2];
      const t = thirds[Math.min(2, Math.floor((x / w) * 3))];
      t.n++;
      if (r > 130 && r > g * 1.7 && r > b * 1.7) t.red++;
      const mx = Math.max(r, g, b);
      if ((r + g + b) / 3 > 228 && (mx - Math.min(r, g, b)) / mx < 0.35) t.bright++;
    }
  }
  const f = thirds.map((t) => ({ red: t.red / Math.max(1, t.n), bright: t.bright / Math.max(1, t.n) }));
  return { left: f[0], center: f[1], right: f[2] };
}

/**
 * @param {CanvasImageSource|null} source  khung hình tĩnh
 * @param {object} ctx
 * @param {object} ctx.vehicle        VehicleInfo (bbox chuẩn hóa + aspect)
 * @param {{x,y,w,h}} [ctx.vehicleBoxPx]
 * @param {string} ctx.vehicleType
 * @param {string} [ctx.expectedPlate]
 * @param {boolean} [ctx.useOCR]
 * @param {object|null} [ctx.classifier]   kết quả classifyView()
 * @param {'front'|'rear'|null} [ctx.userHint]
 */
export async function detectVehicleOrientation(source, ctx = {}) {
  const { vehicle, vehicleBoxPx = null, vehicleType = 'car', expectedPlate = '', useOCR = false, classifier = null, userHint = null } = ctx;
  const evidence = [];
  let sF = 0;
  let sR = 0;

  if (userHint === 'front' || userHint === 'rear') {
    return {
      orientation: userHint, axis: 'end_on', confidence: 1, needsConfirmation: false,
      evidence: [{ source: 'user_confirmed', weight: 1, detail: userHint === 'front' ? 'Khách hàng xác nhận đây là đầu xe' : 'Khách hàng xác nhận đây là đuôi xe' }],
      ocr: null,
    };
  }

  const ax = analyzeAxis(vehicle, vehicleType);
  if (ax.detail) evidence.push({ source: 'bbox_aspect', weight: +ax.conf.toFixed(2), detail: `${ax.detail} → ${ax.axis === 'end_on' ? 'nhìn dọc đầu/đuôi' : ax.axis === 'side_on' ? 'nhìn ngang/chéo' : 'chưa kết luận'}` });

  let ocr = null;
  if (useOCR && ax.axis !== 'side_on' && source && vehicleBoxPx) {
    ocr = await detectPlate(source, { vehicleBox: vehicleBoxPx, expectedPlate });
    if (ocr.status === 'matched') evidence.push({ source: 'plate_ocr', weight: 0.8, detail: `Đọc được biển số khớp biển đã nhập (độ tin cậy OCR ${Math.round(ocr.confidence)}%) — đang nhìn một đầu của xe, chưa phân biệt đầu/đuôi` });
    else if (ocr.status === 'read') evidence.push({ source: 'plate_ocr', weight: 0.5, detail: 'Đọc được biển số nhưng chưa có biển số nhập để so sánh' });
    else if (ocr.status === 'mismatch') evidence.push({ source: 'plate_ocr', weight: 0.2, detail: 'Biển số đọc được KHÔNG khớp biển số đã nhập — cần khách kiểm tra' });
    else evidence.push({ source: 'plate_ocr', weight: 0, detail: ocr.message });
  }

  if (ax.axis === 'end_on' && source && vehicleBoxPx) {
    const lamps = analyzeLamps(source, vehicleBoxPx);
    if (lamps) {
      const minRed = Math.min(lamps.left.red, lamps.right.red);
      const minBright = Math.min(lamps.left.bright, lamps.right.bright);
      if (minRed >= 0.012 && lamps.center.red < minRed * 0.6 + 0.004) {
        sR += 0.4;
        evidence.push({ source: 'lamp_colors', weight: 0.4, detail: 'Có hai cụm màu đỏ đối xứng hai bên — gợi ý đèn hậu (đuôi xe). Bằng chứng yếu.' });
      } else if (minBright >= 0.01 && minRed < 0.006) {
        sF += 0.25;
        evidence.push({ source: 'lamp_colors', weight: 0.25, detail: 'Có hai điểm sáng đối xứng hai bên — gợi ý đèn pha (đầu xe). Bằng chứng rất yếu.' });
      }
    }
  }

  if (classifier) {
    const front = classifier.probs[0];
    const rear = classifier.probs[4];
    if (front + rear > 0.4) {
      sF += front;
      sR += rear;
      evidence.push({ source: 'classifier', weight: +(front + rear).toFixed(2), detail: `Model phân loại góc: đầu xe ${Math.round(front * 100)}%, đuôi xe ${Math.round(rear * 100)}%` });
    }
  }

  const hasStrong = Boolean(classifier);
  const cap = hasStrong ? 0.97 : CONFIG.orientation.weakEvidenceCap;
  let orientation = 'unknown';
  let confidence = 0;
  if (ax.axis === 'side_on') {
    orientation = 'side';
    confidence = ax.conf;
  } else if (Math.abs(sF - sR) >= 0.15) {
    orientation = sF > sR ? 'front' : 'rear';
    confidence = clamp(Math.abs(sF - sR), 0, cap);
  } else if (ax.axis === 'end_on') {
    orientation = 'unknown'; // thấy một đầu xe nhưng chưa biết đầu hay đuôi
    confidence = 0.3 * ax.conf;
  }
  const isEnd = orientation === 'front' || orientation === 'rear';
  const needsConfirmation = orientation === 'side' ? false : !isEnd || confidence < CONFIG.orientation.confirmThreshold;

  return { orientation, axis: ax.axis, confidence, evidence, needsConfirmation, ocr };
}

export const START_CANDIDATES = [ANGLES[0], ANGLES[4]];
