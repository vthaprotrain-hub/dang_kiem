/**
 * quality-validator.js — Kiểm tra sơ bộ chất lượng ảnh vùng mặt: độ sáng và độ nét.
 *
 * Các hàm tính toán là hàm thuần trên mảng pixel RGBA (dễ kiểm thử). `FaceQualitySampler` chỉ làm phần
 * DOM: cắt vùng mặt từ video, thu nhỏ về `analysisWidth` px rồi gọi các hàm thuần, có giới hạn tần suất.
 *
 * Lưu ý: đây KHÔNG phải bộ phát hiện ảnh giả/deepfake; chỉ để hướng dẫn người dùng chụp rõ hơn.
 */

/** Chuyển RGBA → thang xám (Rec. 601). */
export function toGrayscale(rgba, width, height) {
  const gray = new Float32Array(width * height);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
  }
  return gray;
}

/** Độ sáng trung bình (0–255) và tỷ lệ pixel cháy sáng/quá tối. */
export function computeBrightness(gray) {
  let sum = 0;
  let over = 0;
  let under = 0;
  for (let i = 0; i < gray.length; i++) {
    const v = gray[i];
    sum += v;
    if (v >= 250) over++;
    else if (v <= 5) under++;
  }
  const n = gray.length || 1;
  return { mean: sum / n, overexposedFraction: over / n, underexposedFraction: under / n };
}

/** Variance of Laplacian (nhân 3×3: 0 1 0 / 1 -4 1 / 0 1 0), bỏ viền. Càng lớn càng nét. */
export function laplacianVariance(gray, width, height) {
  if (width < 3 || height < 3) return 0;
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    for (let x = 1; x < width - 1; x++) {
      const i = row + x;
      const lap = gray[i - width] + gray[i + width] + gray[i - 1] + gray[i + 1] - 4 * gray[i];
      sum += lap;
      sumSq += lap * lap;
      count++;
    }
  }
  const mean = sum / count;
  return sumSq / count - mean * mean;
}

export function median(values) {
  if (!values.length) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function mean(values) {
  if (!values.length) return NaN;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Đánh giá chỉ số chất lượng theo ngưỡng.
 * @param {{ready:boolean, brightness:number, sharpness:number}} m
 */
export function evaluateQuality(m, cfg) {
  if (!m || !m.ready) {
    return { ok: false, ready: false, brightnessOk: false, sharpnessOk: false, hint: null };
  }
  const tooDark = m.brightness < cfg.minBrightness;
  const tooBright = m.brightness > cfg.maxBrightness;
  const brightnessOk = !tooDark && !tooBright;
  const sharpnessOk = m.sharpness >= cfg.minSharpness;
  let hint = null;
  if (tooDark) hint = 'LOW_LIGHT';
  else if (tooBright) hint = 'TOO_BRIGHT';
  else if (!sharpnessOk) hint = 'BLURRY';
  return { ok: brightnessOk && sharpnessOk, ready: true, brightnessOk, sharpnessOk, hint };
}

/**
 * Lấy mẫu chất lượng từ video, có giới hạn tần suất; không bao giờ phân tích toàn bộ frame.
 */
export class FaceQualitySampler {
  constructor(cfg) {
    this.cfg = cfg;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.reset();
  }

  reset() {
    this.brightnessSamples = [];
    this.sharpnessSamples = [];
    this.lastSampleTs = -Infinity;
    this.lastValidTs = -Infinity;
    this.latest = { ready: false, brightness: NaN, sharpness: NaN, overexposedFraction: 0, ts: -Infinity };
  }

  /**
   * @param {HTMLVideoElement} video
   * @param {{minX:number,maxX:number,minY:number,maxY:number}} rawBox  bounding box mặt theo toạ độ video chuẩn hoá
   * @param {number} ts
   */
  sample(video, rawBox, ts) {
    const cfg = this.cfg;
    if (ts - this.lastSampleTs < cfg.intervalMs) return this.current(ts);
    this.lastSampleTs = ts;
    if (!rawBox || !video.videoWidth) return this.current(ts);

    // Thu hẹp 10% mỗi cạnh để giảm ảnh hưởng của nền/tóc, rồi giới hạn trong khung video.
    const w = rawBox.maxX - rawBox.minX;
    const h = rawBox.maxY - rawBox.minY;
    const x0 = Math.max(0, rawBox.minX + w * 0.1);
    const x1 = Math.min(1, rawBox.maxX - w * 0.1);
    const y0 = Math.max(0, rawBox.minY + h * 0.1);
    const y1 = Math.min(1, rawBox.maxY - h * 0.1);
    const sx = x0 * video.videoWidth;
    const sy = y0 * video.videoHeight;
    const sw = (x1 - x0) * video.videoWidth;
    const sh = (y1 - y0) * video.videoHeight;
    if (sw < 8 || sh < 8) return this.current(ts);

    const aw = cfg.analysisWidth;
    const ah = Math.max(8, Math.round((aw * sh) / sw));
    if (this.canvas.width !== aw || this.canvas.height !== ah) {
      this.canvas.width = aw;
      this.canvas.height = ah;
    }
    try {
      this.ctx.drawImage(video, sx, sy, sw, sh, 0, 0, aw, ah);
      const img = this.ctx.getImageData(0, 0, aw, ah);
      const gray = toGrayscale(img.data, aw, ah);
      const b = computeBrightness(gray);
      const s = laplacianVariance(gray, aw, ah);
      this.push(this.brightnessSamples, b.mean);
      this.push(this.sharpnessSamples, s);
      this.lastValidTs = ts;
      this.overexposedFraction = b.overexposedFraction;
    } catch {
      // drawImage/getImageData có thể lỗi khi video chưa sẵn sàng; bỏ qua mẫu này.
    }
    return this.current(ts);
  }

  push(arr, v) {
    arr.push(v);
    if (arr.length > this.cfg.smoothingWindow) arr.shift();
  }

  /** Giá trị làm mượt hiện tại; `ready=false` nếu chưa đủ mẫu hoặc mẫu đã cũ. */
  current(ts) {
    const enough = this.sharpnessSamples.length >= Math.min(3, this.cfg.smoothingWindow);
    const fresh = ts - this.lastValidTs <= this.cfg.maxAgeMs;
    this.latest = {
      ready: enough && fresh,
      brightness: mean(this.brightnessSamples),
      sharpness: median(this.sharpnessSamples),
      overexposedFraction: this.overexposedFraction || 0,
      ts: this.lastValidTs,
    };
    return this.latest;
  }
}
