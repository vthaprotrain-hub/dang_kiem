/**
 * plateOCR.js — OCR biển kiểm soát bằng Tesseract.js (chạy trên trình duyệt, tải khi cần).
 *
 * Nguyên tắc:
 *  - Chỉ là BẰNG CHỨNG phụ. Kết quả có độ tin cậy thấp KHÔNG bao giờ được tính là "khớp".
 *  - Tìm vùng biển số bằng xử lý ảnh nhẹ (màu trắng/vàng/xanh + nét chữ tối) ở nửa dưới bbox xe,
 *    rồi mới OCR vùng đó. Nếu không tìm thấy vùng nào đủ giống biển số → `not_found`.
 *  - Cho phép bỏ qua OCR; luôn có xác nhận thủ công ở luồng chính.
 *
 * detectPlate(source, { vehicleBox, expectedPlate }) → {status, text, normalized, confidence, similarity, region, message}
 *   status ∈ matched | mismatch | read | low_confidence | not_found | unavailable
 */
import { CONFIG, LIBS } from './config.js';
import { T } from './strings.js';
import { clamp, loadScriptFirst, log, normalizePlate, now, plateSimilarity, scratchCanvas } from './utils.js';

let worker = null;
let initPromise = null;

export const ocrReady = () => Boolean(worker);

export async function initOCR(onStatus) {
  if (worker) return { ok: true };
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      onStatus?.('Đang tải OCR (Tesseract.js)…');
      await loadScriptFirst(LIBS.tesseract.urls, 30000);
      if (!window.Tesseract) throw new Error('Tesseract chưa sẵn sàng sau khi tải');
      worker = await window.Tesseract.createWorker('eng', 1, { logger: () => {} });
      await worker.setParameters({ tessedit_char_whitelist: CONFIG.ocr.plateWhitelist });
      return { ok: true };
    } catch (e) {
      log.warn('OCR không khả dụng:', e.message);
      worker = null;
      return { ok: false, error: e.message };
    }
  })();
  const r = await initPromise;
  if (!r.ok) initPromise = null;
  return r;
}

export async function terminateOCR() {
  if (worker) {
    try { await worker.terminate(); } catch { /* noop */ }
  }
  worker = null;
  initPromise = null;
}

/* ----------------------------- tìm vùng biển số ----------------------------- */
function buildIntegral(mask, w, h) {
  const I = new Int32Array((w + 1) * (h + 1));
  for (let y = 1; y <= h; y++) {
    let row = 0;
    for (let x = 1; x <= w; x++) {
      row += mask[(y - 1) * w + (x - 1)];
      I[y * (w + 1) + x] = I[(y - 1) * (w + 1) + x] + row;
    }
  }
  return I;
}
const sumRect = (I, w, x0, y0, x1, y1) => I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0];

/**
 * Tìm cửa sổ giống biển số nhất trong nửa dưới của bbox xe.
 * @param {CanvasImageSource & {width?:number,height?:number}} source
 * @param {{x:number,y:number,w:number,h:number}} boxPx  bbox xe (pixel của source)
 * @returns {{x:number,y:number,w:number,h:number,score:number,aspect:number}|null}
 */
export function findPlateRegion(source, boxPx) {
  const sw = source.videoWidth || source.naturalWidth || source.width;
  const sh = source.videoHeight || source.naturalHeight || source.height;
  const area = {
    x: boxPx.x + boxPx.w * 0.1,
    y: boxPx.y + boxPx.h * 0.45,
    w: boxPx.w * 0.8,
    h: boxPx.h * 0.55,
  };
  area.w = Math.min(area.w, sw - area.x);
  area.h = Math.min(area.h, sh - area.y);
  if (area.w < 40 || area.h < 20) return null;

  const scale = Math.min(1, 280 / area.w);
  const w = Math.max(8, Math.round(area.w * scale));
  const h = Math.max(8, Math.round(area.h * scale));
  const c = scratchCanvas('ocr-search', w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, area.x, area.y, area.w, area.h, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;

  const plate = new Uint8Array(w * h);
  const dark = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const r = data[i]; const g = data[i + 1]; const b = data[i + 2];
    const mx = Math.max(r, g, b); const mn = Math.min(r, g, b);
    const sat = mx ? (mx - mn) / mx : 0;
    const white = mx > 150 && sat < 0.28;
    const yellow = r > 160 && g > 130 && b < 120 && r >= g;
    const blue = b > 90 && b > r + 35 && b > g + 10;
    plate[p] = white || yellow || blue ? 1 : 0;
    dark[p] = mx < 95 ? 1 : 0;
  }
  const Ip = buildIntegral(plate, w, h);
  const Id = buildIntegral(dark, w, h);

  let best = null;
  for (const aspect of [4.4, 1.35]) {
    for (let ww = Math.round(w * 0.1); ww <= w * 0.5; ww = Math.round(ww * 1.18) + 1) {
      const wh = Math.round(ww / aspect);
      if (wh < 8 || wh > h) continue;
      const stride = Math.max(2, Math.round(ww / 6));
      for (let y = 0; y + wh <= h; y += Math.max(2, Math.round(wh / 5))) {
        for (let x = 0; x + ww <= w; x += stride) {
          const n = ww * wh;
          const pf = sumRect(Ip, w, x, y, x + ww, y + wh) / n;
          if (pf < 0.35) continue;
          const df = sumRect(Id, w, x, y, x + ww, y + wh) / n;
          if (df < 0.04 || df > 0.5) continue;
          const score = pf * Math.min(1, df / 0.1) * (df > 0.38 ? 0.6 : 1);
          if (!best || score > best.score) best = { x, y, w: ww, h: wh, score, aspect };
        }
      }
    }
  }
  if (!best || best.score < 0.3) return null;
  const inv = 1 / scale;
  const pad = 0.1;
  const rx = clamp(area.x + best.x * inv - best.w * inv * pad, 0, sw - 4);
  const ry = clamp(area.y + best.y * inv - best.h * inv * pad, 0, sh - 4);
  const rw = Math.min(best.w * inv * (1 + pad * 2), sw - rx);
  const rh = Math.min(best.h * inv * (1 + pad * 2), sh - ry);
  return { x: rx, y: ry, w: rw, h: rh, score: best.score, aspect: best.aspect };
}

/** Tiền xử lý: phóng to, chuyển xám, kéo giãn tương phản, đảo màu nếu nền tối. */
function preprocess(source, region) {
  const targetH = clamp(Math.round(region.h * 3), 96, 220);
  const scale = targetH / region.h;
  const tw = Math.min(CONFIG.ocr.cropMaxWidth, Math.round(region.w * scale));
  const th = Math.round(region.h * (tw / region.w));
  const c = scratchCanvas('ocr-crop', tw, th);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, region.x, region.y, region.w, region.h, 0, 0, tw, th);
  const img = ctx.getImageData(0, 0, tw, th);
  const d = img.data;
  const gray = new Uint8Array(tw * th);
  const hist = new Uint32Array(256);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const g = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0;
    gray[p] = g;
    hist[g]++;
  }
  const total = gray.length;
  const pct = (q) => { let s = 0; for (let v = 0; v < 256; v++) { s += hist[v]; if (s >= total * q) return v; } return 255; };
  const lo = pct(0.05);
  const hi = Math.max(lo + 20, pct(0.95));
  let sum = 0;
  for (let p = 0; p < total; p++) sum += gray[p];
  const invert = sum / total < 105;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    let v = clamp(((gray[p] - lo) / (hi - lo)) * 255, 0, 255);
    if (invert) v = 255 - v;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/**
 * @param {CanvasImageSource} source  khung hình tĩnh (canvas/video/img)
 * @param {{vehicleBox?:{x:number,y:number,w:number,h:number}, expectedPlate?:string, minConfidence?:number}} opts
 *        vehicleBox là pixel của source; bỏ trống => dùng toàn khung.
 */
export async function detectPlate(source, { vehicleBox = null, expectedPlate = '', minConfidence = CONFIG.ocr.minConfidence } = {}) {
  const t0 = now();
  const ready = await initOCR();
  if (!ready.ok) return { status: 'unavailable', message: T.ocr.unavailable, text: null, normalized: null, confidence: null, similarity: null, region: null, ms: 0 };

  const sw = source.videoWidth || source.naturalWidth || source.width;
  const sh = source.videoHeight || source.naturalHeight || source.height;
  const box = vehicleBox ?? { x: 0, y: 0, w: sw, h: sh };
  const region = findPlateRegion(source, box);
  if (!region) return { status: 'not_found', message: T.ocr.notFound, text: null, normalized: null, confidence: null, similarity: null, region: null, ms: Math.round(now() - t0) };

  try {
    const canvas = preprocess(source, region);
    await worker.setParameters({ tessedit_pageseg_mode: region.aspect > 2.6 ? '7' : '6' });
    const { data } = await worker.recognize(canvas);
    const text = (data.text || '').trim();
    const normalized = normalizePlate(text);
    const confidence = typeof data.confidence === 'number' ? data.confidence : 0;
    const digits = (normalized.match(/\d/g) || []).length;
    const base = { text, normalized, confidence, region, ms: Math.round(now() - t0), similarity: null };
    if (normalized.length < 5 || digits < 3) return { ...base, status: 'not_found', message: T.ocr.notFound };
    if (confidence < minConfidence) return { ...base, status: 'low_confidence', message: T.ocr.lowConfidence };
    const exp = normalizePlate(expectedPlate);
    if (!exp) return { ...base, status: 'read', message: 'Đã đọc biển số (chưa có biển số nhập để so sánh)' };
    const similarity = plateSimilarity(normalized, exp);
    return similarity >= CONFIG.ocr.matchSimilarity
      ? { ...base, similarity, status: 'matched', message: T.ocr.matched }
      : { ...base, similarity, status: 'mismatch', message: T.ocr.mismatch };
  } catch (e) {
    log.warn('OCR lỗi:', e.message);
    return { status: 'unavailable', message: T.ocr.unavailable, text: null, normalized: null, confidence: null, similarity: null, region, ms: Math.round(now() - t0) };
  }
}
