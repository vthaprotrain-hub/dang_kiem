/**
 * aiDetector.js — Lớp 1 của bộ phát hiện: TensorFlow.js + COCO-SSD chạy hoàn toàn trên trình duyệt.
 *
 * - Chỉ phát hiện các lớp COCO `car`, `truck`, `bus`. COCO-SSD KHÔNG nhận diện kính chắn gió, đèn,
 *   biển số hay phân biệt đầu/đuôi xe — những thông tin đó đến từ OCR, heuristic hình ảnh, model phân loại
 *   tùy chọn hoặc xác nhận của người dùng (xem vehicleOrientationDetector.js).
 * - Không bao giờ tạo bbox giả: nếu model chưa trả kết quả thì `vehicles` rỗng.
 * - Không chạy hai lượt suy luận song song (mutex) và tự giãn chu kỳ khi thiết bị chậm.
 *
 * Giao diện chính: loadDetectionModel(), detectVehicle(video), detectStill(canvas), VehicleTracker, DetectionLoop.
 */
import { CONFIG, LIBS, VIEW_CLASSIFIER, ANGLE_KEYS } from './config.js';
import { clamp, iou, loadScriptFirst, log, now, withTimeout } from './utils.js';

let model = null;
let loadingPromise = null;
let backendName = null;
let modelBase = null;
let viewClassifier = null;

/* ----------------------------- mutex suy luận ----------------------------- */
let chain = Promise.resolve();
let busy = false;
async function exclusive(fn) {
  const prev = chain;
  let release;
  chain = new Promise((r) => { release = r; });
  await prev;
  busy = true;
  try {
    return await fn();
  } finally {
    busy = false;
    release();
  }
}
export const isBusy = () => busy;

export function getAIInfo() {
  return {
    ready: Boolean(model),
    backend: backendName,
    modelBase,
    hasViewClassifier: Boolean(viewClassifier),
  };
}

/* ----------------------------- backend ----------------------------- */
async function selectBackend(pref, onStatus) {
  const tf = window.tf;
  const all = ['webgl', 'wasm', 'cpu'];
  const order = pref && pref !== 'auto' ? [pref, ...all.filter((b) => b !== pref)] : all;
  for (const name of order) {
    try {
      onStatus?.(`Đang thử backend ${name}…`);
      if (name === 'wasm') {
        await loadScriptFirst(LIBS.tfjsWasm.urls, CONFIG.detection.loadTimeoutMs);
        window.tf?.wasm?.setWasmPaths?.(LIBS.tfjsWasm.wasmPaths);
      }
      const ok = await tf.setBackend(name);
      await tf.ready();
      if (ok && tf.getBackend() === name) return name;
    } catch (e) {
      log.warn(`Backend ${name} không khả dụng:`, e.message);
    }
  }
  throw new Error('Không có backend TensorFlow.js nào khả dụng trên thiết bị này.');
}

/**
 * Tải TF.js + COCO-SSD. Chỉ cần tải 1 lần; gọi lại trả về kết quả cũ.
 * @returns {Promise<{ok:boolean, backend?:string, loadMs?:number, error?:string}>}
 */
export function loadDetectionModel({ backend = 'auto', base = 'lite_mobilenet_v2', onStatus } = {}) {
  if (model) return Promise.resolve({ ok: true, backend: backendName, loadMs: 0, cached: true });
  if (loadingPromise) return loadingPromise;
  loadingPromise = (async () => {
    const t0 = now();
    try {
      onStatus?.('Đang tải TensorFlow.js…');
      await loadScriptFirst(LIBS.tfjs.urls, CONFIG.detection.loadTimeoutMs);
      if (!window.tf) throw new Error('TensorFlow.js chưa sẵn sàng sau khi tải.');
      backendName = await selectBackend(backend, onStatus);

      onStatus?.('Đang tải model COCO-SSD…');
      await loadScriptFirst(LIBS.cocoSsd.urls, CONFIG.detection.loadTimeoutMs);
      if (!window.cocoSsd) throw new Error('COCO-SSD chưa sẵn sàng sau khi tải.');
      const opts = { base };
      if (LIBS.cocoSsd.modelUrl) opts.modelUrl = LIBS.cocoSsd.modelUrl;
      model = await withTimeout(window.cocoSsd.load(opts), CONFIG.detection.loadTimeoutMs, 'Hết thời gian tải trọng số model COCO-SSD.');
      modelBase = base;

      // warm-up để lượt suy luận đầu tiên không làm giật hình
      onStatus?.('Đang khởi động model…');
      const z = window.tf.zeros([192, 192, 3], 'int32');
      try { await model.detect(z, 1, 0.9); } finally { z.dispose(); }

      loadViewClassifier().catch(() => {});
      const loadMs = Math.round(now() - t0);
      log.info(`AI sẵn sàng: backend=${backendName}, base=${base}, ${loadMs}ms`);
      return { ok: true, backend: backendName, loadMs };
    } catch (e) {
      model = null;
      log.error('Tải model thất bại:', e.message);
      return { ok: false, error: e.message || 'Không tải được model AI' };
    }
  })();
  loadingPromise.then((r) => { if (!r.ok) loadingPromise = null; });
  return loadingPromise;
}

/** Cho phép thử lại sau lỗi. */
export function resetModelLoad() {
  if (!model) loadingPromise = null;
}

/* ----------------------------- model phân loại 8 góc (tùy chọn) ----------------------------- */
export async function loadViewClassifier() {
  if (!VIEW_CLASSIFIER.enabled || !window.tf) return null;
  try {
    const res = await fetch(VIEW_CLASSIFIER.url, { cache: 'no-cache' });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') || '';
    if (!/json|octet|text/.test(type) && type) return null; // tránh SPA fallback trả HTML
    const text = await res.text();
    if (text.trim().startsWith('<')) return null;
    viewClassifier = VIEW_CLASSIFIER.format === 'layers'
      ? await window.tf.loadLayersModel(VIEW_CLASSIFIER.url)
      : await window.tf.loadGraphModel(VIEW_CLASSIFIER.url);
    log.info('Đã nạp model phân loại 8 góc tùy chọn');
    return viewClassifier;
  } catch (e) {
    log.debug('Không có model phân loại góc:', e.message);
    viewClassifier = null;
    return null;
  }
}

/**
 * Chạy model phân loại 8 góc (nếu có). Đầu vào ảnh [0,1], kích thước VIEW_CLASSIFIER.inputSize.
 * @returns {Promise<null | {probs:number[], topKey:string, topIndex:number, confidence:number}>}
 */
export async function classifyView(source) {
  if (!viewClassifier || !window.tf) return null;
  return exclusive(async () => {
    const tf = window.tf;
    let input;
    let out;
    try {
      input = tf.tidy(() =>
        tf.browser.fromPixels(source).resizeBilinear([VIEW_CLASSIFIER.inputSize, VIEW_CLASSIFIER.inputSize]).toFloat().div(255).expandDims(0));
      out = viewClassifier.predict(input);
      const t = Array.isArray(out) ? out[0] : out;
      const probs = Array.from(await t.data());
      if (probs.length !== ANGLE_KEYS.length) throw new Error(`Model trả ${probs.length} lớp, cần ${ANGLE_KEYS.length}`);
      const topIndex = probs.indexOf(Math.max(...probs));
      return { probs, topIndex, topKey: ANGLE_KEYS[topIndex], confidence: probs[topIndex] };
    } catch (e) {
      log.warn('classifyView lỗi', e.message);
      return null;
    } finally {
      input?.dispose();
      if (out) (Array.isArray(out) ? out : [out]).forEach((o) => o.dispose());
    }
  });
}

/* ----------------------------- phát hiện xe ----------------------------- */
function toVehicles(preds, w, h) {
  return preds
    .filter((p) => CONFIG.detection.classes.includes(p.class))
    .map((p) => {
      const [x, y, bw, bh] = p.bbox;
      const x0 = clamp(x, 0, w);
      const y0 = clamp(y, 0, h);
      const x1 = clamp(x + bw, 0, w);
      const y1 = clamp(y + bh, 0, h);
      return {
        cls: p.class,
        score: p.score,
        bboxPx: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 },
        bbox: { x: x0 / w, y: y0 / h, w: (x1 - x0) / w, h: (y1 - y0) / h },
      };
    })
    .filter((v) => v.bboxPx.w > 4 && v.bboxPx.h > 4);
}

/**
 * Phát hiện xe trên khung hình video.
 * @returns {Promise<{ok:boolean, busy?:boolean, error?:string, vehicles:object[], width:number, height:number, inferenceMs:number}>}
 */
export async function detectVehicle(video, { minScore = 0.5 } = {}) {
  if (!model) return { ok: false, error: 'model_not_ready', vehicles: [], width: 0, height: 0, inferenceMs: 0 };
  if (!video || video.readyState < 2 || !video.videoWidth) {
    return { ok: false, error: 'video_not_ready', vehicles: [], width: 0, height: 0, inferenceMs: 0 };
  }
  if (busy) return { ok: false, busy: true, vehicles: [], width: 0, height: 0, inferenceMs: 0 };
  return exclusive(async () => {
    const t0 = now();
    const w = video.videoWidth;
    const h = video.videoHeight;
    try {
      const preds = await model.detect(video, CONFIG.detection.maxDetections, minScore);
      return { ok: true, vehicles: toVehicles(preds, w, h), width: w, height: h, inferenceMs: now() - t0 };
    } catch (e) {
      log.warn('Suy luận lỗi:', e.message);
      return { ok: false, error: e.message, vehicles: [], width: w, height: h, inferenceMs: now() - t0 };
    }
  });
}

/** Phát hiện xe trên ảnh tĩnh (canvas/ảnh) — xếp hàng chờ nếu đang suy luận khung video. */
export async function detectStill(source, { minScore = 0.4 } = {}) {
  if (!model) return { ok: false, error: 'model_not_ready', vehicles: [], width: 0, height: 0, inferenceMs: 0 };
  return exclusive(async () => {
    const t0 = now();
    const w = source.width || source.naturalWidth;
    const h = source.height || source.naturalHeight;
    try {
      const preds = await model.detect(source, CONFIG.detection.maxDetections, minScore);
      return { ok: true, vehicles: toVehicles(preds, w, h), width: w, height: h, inferenceMs: now() - t0 };
    } catch (e) {
      log.warn('Suy luận ảnh tĩnh lỗi:', e.message);
      return { ok: false, error: e.message, vehicles: [], width: w, height: h, inferenceMs: now() - t0 };
    }
  });
}

/* ----------------------------- tổng hợp thông tin xe ----------------------------- */
const emptyClip = () => ({ left: false, right: false, top: false, bottom: false, count: 0, any: false, severe: false });

export function computeClipping(bbox, margin = CONFIG.detection.edgeMargin) {
  const c = {
    left: bbox.x <= margin,
    right: bbox.x + bbox.w >= 1 - margin,
    top: bbox.y <= margin,
    bottom: bbox.y + bbox.h >= 1 - margin,
  };
  c.count = [c.left, c.right, c.top, c.bottom].filter(Boolean).length;
  c.any = c.count > 0;
  c.severe = c.count >= 2;
  return c;
}

/**
 * VehicleTracker — gộp kết quả suy luận theo thời gian: chọn xe chính, làm mượt bbox, đo độ ổn định,
 * tính độ phủ khung, mức bị cắt, số xe. Không tạo dữ liệu khi model chưa trả kết quả.
 */
export class VehicleTracker {
  constructor() {
    this.reset();
  }

  reset() {
    this.prevRaw = null;
    this.smooth = null;
    this.stableFrames = 0;
    this.stableSince = 0;
    this.lostFrames = 0;
    this.lockBox = null;
    this.info = this.empty();
  }

  empty() {
    return {
      source: 'live', present: false, stale: false, count: 0, multiple: false, locked: false,
      bbox: null, cls: null, score: 0, areaRatio: 0, aspect: 0, cx: 0.5, cy: 0.5,
      clipped: emptyClip(), tooClose: false, tooFar: false,
      stable: false, stableFrames: 0, stableMs: 0, lostFrames: 0, vehicles: [], width: 0, height: 0,
    };
  }

  /** Người dùng chạm vào màn hình để chọn xe (toạ độ chuẩn hóa 0–1 trong khung video). */
  lockAt(nx, ny) {
    const hit = (this.info.vehicles || []).filter((v) => nx >= v.bbox.x && nx <= v.bbox.x + v.bbox.w && ny >= v.bbox.y && ny <= v.bbox.y + v.bbox.h);
    if (!hit.length) return false;
    hit.sort((a, b) => a.bbox.w * a.bbox.h - b.bbox.w * b.bbox.h); // ưu tiên xe nhỏ nhất chứa điểm chạm
    this.lockBox = { ...hit[0].bbox };
    this.smooth = null;
    this.stableFrames = 0;
    return true;
  }
  unlock() {
    this.lockBox = null;
  }

  /**
   * @param {object} result  kết quả của detectVehicle()
   * @param {'portrait'|'landscape'} orientation
   */
  update(result, orientation = 'landscape') {
    if (!result?.ok) return this.info; // lỗi/busy: giữ nguyên, không bịa dữ liệu
    const cfg = CONFIG.detection;
    const { vehicles, width, height } = result;
    const significant = vehicles.filter((v) => v.score >= cfg.multiVehicleMinScore && v.bbox.w * v.bbox.h >= cfg.multiVehicleMinAreaRatio);

    // chọn xe chính
    let primary = null;
    if (this.lockBox) {
      let best = 0;
      for (const v of vehicles) {
        const s = iou(v.bbox, this.lockBox);
        if (s > best) { best = s; primary = v; }
      }
      if (best < 0.15) primary = null;
    } else if (vehicles.length) {
      primary = [...vehicles].sort((a, b) => b.bbox.w * b.bbox.h * b.score - a.bbox.w * a.bbox.h * a.score)[0];
    }

    const t = now();
    if (!primary) {
      this.lostFrames += 1;
      this.stableFrames = 0;
      this.prevRaw = null;
      if (this.lostFrames > cfg.lostFrames) {
        this.smooth = null;
        this.info = { ...this.empty(), lostFrames: this.lostFrames, vehicles: [], width, height };
      } else {
        this.info = { ...this.info, stale: true, stable: false, stableFrames: 0, lostFrames: this.lostFrames, vehicles: [], width, height };
      }
      return this.info;
    }

    this.lostFrames = 0;
    const raw = primary.bbox;
    if (this.prevRaw && iou(raw, this.prevRaw) >= cfg.stableIou) {
      this.stableFrames += 1;
    } else {
      this.stableFrames = 1;
      this.stableSince = t;
    }
    this.prevRaw = raw;

    const a = 0.55;
    this.smooth = this.smooth
      ? { x: this.smooth.x + (raw.x - this.smooth.x) * a, y: this.smooth.y + (raw.y - this.smooth.y) * a, w: this.smooth.w + (raw.w - this.smooth.w) * a, h: this.smooth.h + (raw.h - this.smooth.h) * a }
      : { ...raw };
    const bb = this.smooth;

    const areaRatio = raw.w * raw.h;
    const clipped = computeClipping(raw);
    const minArea = cfg.minAreaRatio[orientation] ?? cfg.minAreaRatio.landscape;
    const stable = this.stableFrames >= cfg.stableFrames;
    this.info = {
      source: 'live',
      present: true,
      stale: false,
      count: Math.max(significant.length, 1),
      multiple: significant.length > 1 && !this.lockBox,
      locked: Boolean(this.lockBox),
      bbox: bb,
      cls: primary.cls,
      score: primary.score,
      areaRatio,
      aspect: (raw.w * width) / Math.max(1, raw.h * height),
      cx: raw.x + raw.w / 2,
      cy: raw.y + raw.h / 2,
      clipped,
      tooClose: areaRatio > cfg.maxAreaRatio || clipped.severe,
      tooFar: areaRatio < minArea,
      stable,
      stableFrames: this.stableFrames,
      stableMs: stable ? t - this.stableSince : 0,
      lostFrames: 0,
      vehicles: vehicles.map((v) => ({ bbox: v.bbox, cls: v.cls, score: v.score, isPrimary: v === primary })),
      width,
      height,
    };
    return this.info;
  }
}

/* ----------------------------- vòng lặp suy luận có điều tiết ----------------------------- */
export class DetectionLoop {
  /**
   * @param {{getVideo:()=>HTMLVideoElement, getMinScore:()=>number, onResult:(r:object)=>void}} o
   */
  constructor({ getVideo, getMinScore, onResult }) {
    this.getVideo = getVideo;
    this.getMinScore = getMinScore;
    this.onResult = onResult;
    this.running = false;
    this.timer = null;
    this.interval = CONFIG.detection.intervalMs;
    this.fps = 0;
    this.lastInferMs = 0;
    this.errors = 0;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.errors = 0;
    this.schedule(0);
  }
  stop() {
    this.running = false;
    clearTimeout(this.timer);
    this.timer = null;
  }
  schedule(ms) {
    clearTimeout(this.timer);
    if (this.running) this.timer = setTimeout(() => this.tick(), ms);
  }
  async tick() {
    if (!this.running) return;
    if (document.hidden) return this.schedule(500);
    const t0 = now();
    let r;
    try {
      r = await detectVehicle(this.getVideo(), { minScore: this.getMinScore() });
    } catch (e) {
      r = { ok: false, error: e.message, vehicles: [] };
    }
    if (!this.running) return;
    if (r.ok) {
      this.errors = 0;
      this.lastInferMs = r.inferenceMs;
      // chu kỳ thích nghi: suy luận càng chậm càng giãn khoảng cách để không làm giật hình/nóng máy
      const target = clamp(r.inferenceMs * 1.8, CONFIG.detection.intervalMs, CONFIG.detection.maxIntervalMs);
      this.interval = this.interval * 0.7 + target * 0.3;
      this.onResult(r);
    } else if (!r.busy) {
      this.errors += 1;
      this.onResult(r);
      if (this.errors > 8) this.interval = CONFIG.detection.maxIntervalMs;
    }
    const spent = now() - t0;
    this.schedule(Math.max(30, this.interval - spent));
  }
}
