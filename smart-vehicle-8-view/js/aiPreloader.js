/**
 * aiPreloader.js — Tải trước & khởi tạo dữ liệu AI ngay khi mở trang.
 *
 * Tải song song (tối đa 3 tệp) toàn bộ thư viện + model, có tiến độ theo byte, loại dữ liệu đang tải,
 * tốc độ và thời gian còn lại ước lượng; sau đó nạp model COCO-SSD (WebGL/WASM/CPU) và khởi tạo Tesseract.js.
 *
 *   COCO-SSD : tf.min.js → coco-ssd.min.js → model.json → các shard trọng số → nạp model + chạy thử một lượt
 *   OCR      : tesseract.min.js → worker.min.js → lõi WebAssembly (SIMD nếu có) → dữ liệu chữ eng → tạo worker
 *
 * Bộ nhớ đệm:
 *   - Mọi tệp tải ở luồng chính được lưu vào Cache Storage (`sv8v-ai-v1`) → lần mở sau đọc từ máy, không tốn mạng.
 *   - Thư viện được chạy từ Blob URL; model COCO-SSD được phục vụ từ RAM qua một lớp bọc `fetch` (chỉ cho đúng các URL
 *     của model) nên không tải hai lần. Worker và lõi OCR chạy từ Blob URL. Dữ liệu chữ OCR do worker tự đọc (bộ đệm
 *     HTTP + IndexedDB của Tesseract).
 *
 * Không có gì được gửi đi ngoài các yêu cầu tải thư viện/model công khai từ CDN.
 */
import { ASSET_APPROX_BYTES, COCO_MODELS, CONFIG, LIBS, cocoModelUrl } from './config.js';
import { update } from './appState.js';
import { disposeDetectionModel, getAIInfo, loadDetectionModel } from './aiDetector.js';
import { initOCR, ocrReady, setOCRAssets, terminateOCR } from './plateOCR.js';
import { Emitter, log } from './utils.js';

export const CACHE_NAME = 'sv8v-ai-v1';
const SHARD_BYTES = 4194304; // kích thước shard mặc định của tfjs-converter
const CONCURRENCY = 3;
const STALL_MS = 30000; // không nhận thêm byte nào trong 30 s => coi như lỗi mạng, thử nguồn khác

/* Module WebAssembly nhỏ dùng lệnh SIMD (giống wasm-feature-detect) — để chọn đúng lõi OCR như Tesseract.js. */
const SIMD_TEST = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);
export const wasmSimdSupported = () => { try { return WebAssembly.validate(SIMD_TEST); } catch { return false; } };

const origFetch = typeof window !== 'undefined' ? window.fetch.bind(window) : null;
const memFiles = new Map(); // url -> { buf, type } (chỉ giữ trong lúc nạp model)

/** Bọc fetch: trả trực tiếp từ RAM cho các tệp model vừa tải (TF.js gọi `fetch` toàn cục khi nạp model). */
function installFetchShim() {
  if (window.__sv8FetchShim) return;
  window.__sv8FetchShim = true;
  window.fetch = function sv8Fetch(input, init) {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
    const hit = url ? memFiles.get(url) : null;
    if (hit) return Promise.resolve(new Response(hit.buf, { status: 200, headers: { 'content-type': hit.type || 'application/octet-stream' } }));
    return origFetch(input, init);
  };
}

async function openCache() {
  try { return typeof caches !== 'undefined' ? await caches.open(CACHE_NAME) : null; } catch { return null; }
}

/** Byte của một shard trọng số tính từ weightsManifest (chính xác, trước khi tải). */
function shardSizes(group) {
  const bytesPer = { float32: 4, int32: 4, bool: 1, uint8: 1, uint16: 2, float16: 2, complex64: 8 };
  let total = 0;
  for (const w of group.weights ?? []) {
    const n = (w.shape ?? []).reduce((a, b) => a * b, 1);
    const dt = w.quantization?.dtype ?? w.dtype;
    const b = bytesPer[dt];
    if (!b) return null; // kiểu chưa biết: dùng ước lượng
    total += n * b;
  }
  const paths = group.paths ?? [];
  return paths.map((_, i) => Math.max(0, Math.min(SHARD_BYTES, total - i * SHARD_BYTES)));
}

/**
 * Tải một tệp với tiến độ theo byte (ReadableStream), thử lần lượt các URL, có bộ đệm Cache Storage.
 * @param {object} item  { urls, cacheKey, est, loaded, total, state }
 * @param {{signal?:AbortSignal, onProgress?:()=>void, cache?:Cache|null, keep?:boolean}} o
 * @returns {Promise<{buf:ArrayBuffer|null, type:string, url:string, fromCache:boolean}>}
 */
export async function downloadAsset(item, { signal, onProgress, cache = null, keep = true } = {}) {
  const key = item.cacheKey ?? item.urls[0];
  if (cache) {
    try {
      const hit = await cache.match(key);
      if (hit) {
        const buf = await hit.arrayBuffer();
        item.loaded = item.total = buf.byteLength;
        item.fromCache = true;
        item.url = hit.headers.get('x-sv8v-url') || item.urls[0];
        onProgress?.();
        return { buf: keep ? buf : null, type: hit.headers.get('content-type') || '', url: item.url, fromCache: true };
      }
    } catch { /* bộ đệm hỏng: tải lại */ }
  }
  let lastErr = null;
  for (const url of item.urls) {
    item.loaded = 0;
    try {
      const res = await origFetch(url, { signal, mode: 'cors', credentials: 'omit' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const len = Number(res.headers.get('content-length')) || 0;
      // content-length có thể là kích thước NÉN (gzip/br) trong khi luồng trả byte đã giải nén → chỉ tin khi hợp lý
      if (len > (item.est || 0) * 0.6) item.total = len;
      const type = res.headers.get('content-type') || '';
      const chunks = [];
      if (res.body?.getReader) {
        const reader = res.body.getReader();
        for (;;) {
          let timer;
          const stall = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('Mạng bị gián đoạn (không nhận được dữ liệu)')), STALL_MS); });
          let r;
          try { r = await Promise.race([reader.read(), stall]); } finally { clearTimeout(timer); }
          if (r.done) break;
          chunks.push(r.value);
          item.loaded += r.value.byteLength;
          if (item.total && item.loaded > item.total) item.total = Math.round(item.loaded * 1.05);
          onProgress?.(r.value.byteLength);
        }
      } else {
        const b = new Uint8Array(await res.arrayBuffer());
        chunks.push(b);
        item.loaded = b.byteLength;
        onProgress?.(b.byteLength);
      }
      const out = new Uint8Array(item.loaded);
      let off = 0;
      for (const c of chunks) { out.set(c, off); off += c.byteLength; }
      item.total = item.loaded;
      item.url = url;
      if (cache) {
        try { await cache.put(key, new Response(out, { headers: { 'content-type': type, 'x-sv8v-url': url } })); } catch (e) { log.warn('Không lưu được vào bộ đệm', e?.message); }
      }
      onProgress?.();
      return { buf: keep ? out.buffer : null, type, url, fromCache: false };
    } catch (e) {
      if (signal?.aborted) throw e;
      lastErr = e;
      log.warn(`Tải ${url} lỗi, thử nguồn khác:`, e?.message);
    }
  }
  throw lastErr ?? new Error('Không có nguồn tải');
}

function injectScript(buf, globalName) {
  if (globalName && window[globalName]) return Promise.resolve();
  const url = URL.createObjectURL(new Blob([buf], { type: 'text/javascript' }));
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = url;
    s.onload = () => { URL.revokeObjectURL(url); resolve(); };
    s.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Không chạy được thư viện đã tải')); };
    document.head.append(s);
  });
}

const blankState = () => ({
  status: 'idle', // idle | downloading | initializing | ready | error
  config: null,
  items: [],
  percent: 0,
  loadedBytes: 0,
  totalBytes: 0,
  speedBps: 0,
  etaSec: null,
  stage: '',
  initFrac: 0,
  cocoReady: false,
  ocrReady: false,
  error: null, // { group: 'coco'|'ocr', message }
  startedAt: 0,
  finishedAt: 0,
  fromCacheBytes: 0,
});

/* ====================================================================== */
export class AIPreloader {
  constructor() {
    this.events = new Emitter();
    this.state = blankState();
    this.runId = 0;
    this.ctrl = null;
    this.ocrBlobs = [];
    this._emitAt = 0;
    this._emitTimer = null;
    this._speed = { t: 0, bytes: 0, ema: 0 };
  }

  getState() { return this.state; }
  on(fn) { return this.events.on('change', fn); }

  /** Cấu hình đã nạp xong, khớp với cấu hình yêu cầu. */
  isReadyFor(cfg) {
    const s = this.state;
    if (s.status !== 'ready' || !s.config) return false;
    return s.config.modelBase === cfg.modelBase && s.config.backend === cfg.backend && Boolean(s.config.ocr) === Boolean(cfg.ocr);
  }

  _emit(force = false) {
    const t = performance.now();
    if (!force && t - this._emitAt < 120) {
      if (!this._emitTimer) this._emitTimer = setTimeout(() => { this._emitTimer = null; this._emit(true); }, 120);
      return;
    }
    this._emitAt = t;
    this._recompute();
    this.events.emit('change', this.state);
  }

  _recompute() {
    const s = this.state;
    let loaded = 0;
    let total = 0;
    for (const it of s.items) {
      const tot = it.total || it.est || 0;
      total += tot;
      loaded += it.state === 'done' || it.state === 'cached' ? tot : Math.min(it.loaded || 0, tot);
    }
    s.loadedBytes = loaded;
    s.totalBytes = total;
    const dl = total ? loaded / total : 1;
    s.percent = s.status === 'ready' ? 100 : Math.min(99, Math.round((dl * 0.88 + (s.initFrac || 0) * 0.12) * 100));
    // tốc độ: trung bình trượt của byte tải từ mạng (không tính phần đọc từ bộ đệm)
    const t = performance.now();
    const sp = this._speed;
    const net = s.items.reduce((a, it) => a + (it.fromCache ? 0 : it.loaded || 0), 0);
    if (!sp.t) { sp.t = t; sp.bytes = net; }
    else if (t - sp.t >= 400) {
      const inst = ((net - sp.bytes) * 1000) / (t - sp.t);
      sp.ema = sp.ema ? sp.ema * 0.65 + inst * 0.35 : inst;
      sp.t = t;
      sp.bytes = net;
    }
    s.speedBps = Math.max(0, sp.ema);
    const remaining = Math.max(0, total - loaded);
    if (s.status === 'downloading') {
      const guess = s.speedBps > 2000 ? s.speedBps : (navigator.connection?.downlink ? (navigator.connection.downlink * 1e6) / 8 : 0);
      s.etaSec = remaining <= 0 ? 0 : guess > 0 && t - s.startedAt > 700 ? remaining / guess + (s.config?.ocr ? 4 : 2) : null;
    } else if (s.status === 'initializing') s.etaSec = null;
    else s.etaSec = s.status === 'ready' ? 0 : null;
  }

  _item(id, group, label, urls, est, extra = {}) {
    const it = { id, group, label, urls, est, loaded: 0, total: 0, state: 'pending', fromCache: false, ...extra };
    this.state.items.push(it);
    return it;
  }

  /**
   * Bắt đầu (hoặc bắt đầu lại) tải theo cấu hình. Hủy lượt đang chạy nếu cấu hình khác.
   * @param {{modelBase:string, backend:string, ocr:boolean}} cfg
   * @param {{force?:boolean}} [o]
   */
  start(cfg, { force = false } = {}) {
    const same = this.state.config && this.state.config.modelBase === cfg.modelBase && this.state.config.backend === cfg.backend && Boolean(this.state.config.ocr) === Boolean(cfg.ocr);
    if (same && !force && (this.state.status === 'downloading' || this.state.status === 'initializing' || this.state.status === 'ready')) return this.promise;
    this.ctrl?.abort();
    this.ctrl = new AbortController();
    const runId = ++this.runId;
    this.state = { ...blankState(), status: 'downloading', config: { ...cfg }, startedAt: performance.now(), stage: 'Đang chuẩn bị tải dữ liệu AI…' };
    this._speed = { t: 0, bytes: 0, ema: 0 };
    update('ai', { status: 'loading', error: null });
    this._emit(true);
    this.promise = this._run(cfg, runId, this.ctrl.signal).catch((e) => {
      if (runId !== this.runId) return this.state;
      log.error('Tải dữ liệu AI lỗi', e?.message ?? e);
      return this.state;
    });
    return this.promise;
  }

  /** Bật lại OCR nếu worker đã được giải phóng (sau bước xác định điểm xuất phát). */
  async ensure(cfg) {
    if (!this.isReadyFor(cfg)) return this.start(cfg);
    if (cfg.ocr && !ocrReady()) {
      this.state.status = 'initializing';
      this.state.stage = 'Đang khởi động lại OCR…';
      this.state.ocrReady = false;
      this._emit(true);
      const r = await initOCR();
      this.state.ocrReady = r.ok;
      this.state.status = r.ok ? 'ready' : 'error';
      if (!r.ok) this.state.error = { group: 'ocr', message: r.error };
      this.state.stage = r.ok ? this._readyText() : 'OCR không khởi động được';
      this._emit(true);
    }
    return this.state;
  }

  _readyText() {
    const s = this.state;
    const be = getAIInfo().backend ?? '—';
    return `Sẵn sàng · COCO-SSD ${s.config.modelBase} (${be})${s.config.ocr ? ' · OCR biển số' : ''}`;
  }

  async _run(cfg, runId, signal) {
    installFetchShim();
    const live = () => runId === this.runId;
    const s = this.state;
    const cache = await openCache();
    const A = ASSET_APPROX_BYTES;
    const modelUrl = cocoModelUrl(cfg.modelBase);
    const modelApprox = COCO_MODELS[cfg.modelBase]?.approxBytes ?? 18e6;

    // ---- danh sách tệp ----
    const info = getAIInfo();
    const cocoLoaded = info.ready && info.modelBase === cfg.modelBase && (cfg.backend === 'auto' || cfg.backend === info.backend);
    const items = {};
    if (!cocoLoaded) {
      if (!window.tf) items.tf = this._item('tfjs', 'coco', 'Thư viện TensorFlow.js', LIBS.tfjs.urls, A.tfjs, { kind: 'Thư viện' });
      if (cfg.backend === 'wasm' && !window.tf?.wasm) items.wasm = this._item('tfjs-wasm', 'coco', 'Backend WASM của TensorFlow.js', LIBS.tfjsWasm.urls, 160e3, { kind: 'Thư viện' });
      if (!window.cocoSsd) items.coco = this._item('coco-lib', 'coco', 'Thư viện COCO-SSD', LIBS.cocoSsd.urls, A.cocoLib, { kind: 'Thư viện' });
      items.json = this._item('coco-json', 'coco', `Cấu trúc model COCO-SSD (${cfg.modelBase})`, [modelUrl], A.cocoJson, { kind: 'Model' });
      items.weights = this._item('coco-weights', 'coco', `Trọng số model COCO-SSD (${cfg.modelBase})`, [], Math.max(1e6, modelApprox - A.cocoJson), { kind: 'Model', placeholder: true });
    } else {
      this._item('coco-ready', 'coco', `Model COCO-SSD ${cfg.modelBase} — đã nạp`, [], 0, { state: 'done', kind: 'Model' });
    }
    const wantOcr = cfg.ocr && !ocrReady();
    let coreFile = null;
    if (wantOcr) {
      coreFile = wasmSimdSupported() ? LIBS.tesseract.coreFiles.simd : LIBS.tesseract.coreFiles.plain;
      if (!window.Tesseract) items.tess = this._item('tess-lib', 'ocr', 'Thư viện OCR Tesseract.js', LIBS.tesseract.urls, A.tessLib, { kind: 'Thư viện' });
      items.tworker = this._item('tess-worker', 'ocr', 'Tiến trình OCR (worker)', LIBS.tesseract.workerUrls, A.tessWorker, { kind: 'Thư viện' });
      items.tcore = this._item('tess-core', 'ocr', `Lõi OCR WebAssembly${coreFile.includes('simd') ? ' (SIMD)' : ''}`, LIBS.tesseract.coreBases.map((b) => b + coreFile), A.tessCore, { kind: 'Lõi WASM' });
      items.tlang = this._item('tess-lang', 'ocr', 'Dữ liệu chữ OCR (eng, LSTM)', LIBS.tesseract.langDirs.map((d) => `${d}/${LIBS.tesseract.lang}.traineddata.gz`), A.tessLang, { kind: 'Dữ liệu ngôn ngữ' });
    } else if (cfg.ocr) {
      this._item('ocr-ready', 'ocr', 'OCR Tesseract.js — đã khởi tạo', [], 0, { state: 'done', kind: 'OCR' });
    }
    this._emit(true);

    // ---- hàng đợi tải (tối đa 3 tệp cùng lúc) ----
    let active = 0;
    const waiting = [];
    const pump = () => {
      while (active < CONCURRENCY && waiting.length) {
        const job = waiting.shift();
        active++;
        job().finally(() => { active--; pump(); });
      }
    };
    const fetchItem = (it, keep = true) => new Promise((resolve, reject) => {
      waiting.push(async () => {
        if (!live()) { reject(new Error('cancelled')); return; }
        it.state = 'downloading';
        this.state.stage = `Đang tải: ${it.label}`;
        this._emit();
        try {
          const r = await downloadAsset(it, { signal, cache, keep, onProgress: () => this._emit() });
          it.state = r.fromCache ? 'cached' : 'done';
          if (r.fromCache) this.state.fromCacheBytes += it.total;
          this._emit();
          resolve(r);
        } catch (e) {
          it.state = 'error';
          it.error = e?.message ?? String(e);
          this._emit(true);
          reject(signal.aborted ? e : new Error(`Không tải được ${it.label} (${it.error}). Kiểm tra kết nối mạng rồi thử lại.`));
        }
      });
      pump();
    });

    // Lỗi của một nhánh không dừng nhánh còn lại; trạng thái "error" chỉ được chốt khi cả hai nhánh đã xong.
    const fail = (group, e) => {
      if (!live()) return;
      if (!s.error || group === 'coco') s.error = { group, message: e?.message ?? String(e) };
      if (group === 'coco') update('ai', { status: 'error', error: s.error.message });
      this._emit(true);
    };

    // ---- COCO-SSD ----
    const cocoTask = (async () => {
      if (cocoLoaded) { s.cocoReady = true; return; }
      const pTf = items.tf ? fetchItem(items.tf) : null;
      const pWasm = items.wasm ? fetchItem(items.wasm) : null;
      const pCoco = items.coco ? fetchItem(items.coco) : null;
      const json = await fetchItem(items.json);
      // biết số shard + kích thước chính xác từ model.json
      const manifest = JSON.parse(new TextDecoder().decode(json.buf));
      const dir = modelUrl.replace(/[^/]*$/, '');
      const groups = manifest.weightsManifest ?? [];
      const shards = [];
      for (const g of groups) {
        const sizes = shardSizes(g);
        g.paths.forEach((p, i) => shards.push({ url: dir + p, size: sizes?.[i] ?? null }));
      }
      const ph = items.weights;
      const idx = s.items.indexOf(ph);
      const perShard = ph.est / Math.max(1, shards.length);
      const shardItems = shards.map((sh, i) => ({
        id: `coco-w${i + 1}`, group: 'coco', label: `Trọng số model COCO-SSD ${i + 1}/${shards.length}`, urls: [sh.url],
        est: sh.size ?? perShard, total: 0, loaded: 0, state: 'pending', fromCache: false, kind: 'Model',
      }));
      s.items.splice(idx, 1, ...shardItems);
      this._emit(true);
      const bins = await Promise.all(shardItems.map((it) => fetchItem(it)));
      const [tfR, wasmR, cocoR] = await Promise.all([pTf, pWasm, pCoco]);
      if (!live()) return;

      // ---- khởi tạo ----
      s.status = 'initializing';
      s.stage = 'Đang khởi động TensorFlow.js…';
      s.initFrac = 0.05;
      this._emit(true);
      if (tfR) await injectScript(tfR.buf, 'tf');
      if (wasmR && !window.tf?.wasm) { await injectScript(wasmR.buf, null); window.tf?.wasm?.setWasmPaths?.(LIBS.tfjsWasm.wasmPaths); }
      if (cocoR) await injectScript(cocoR.buf, 'cocoSsd');
      memFiles.set(modelUrl, { buf: json.buf, type: 'application/json' });
      shards.forEach((sh, i) => memFiles.set(sh.url, { buf: bins[i].buf, type: 'application/octet-stream' }));
      s.initFrac = 0.15;
      this._emit(true);
      const r = await loadDetectionModel({
        backend: cfg.backend, base: cfg.modelBase, modelUrl,
        onStatus: (t) => { if (live()) { s.stage = t; s.initFrac = Math.min(0.5, s.initFrac + 0.1); this._emit(); } },
      });
      memFiles.delete(modelUrl);
      shards.forEach((sh) => memFiles.delete(sh.url));
      if (!live()) return;
      if (!r.ok) throw new Error(r.error || 'Không nạp được model COCO-SSD');
      const i2 = getAIInfo();
      update('ai', { status: 'ready', backend: r.backend, loadMs: r.loadMs ?? null, modelBase: i2.modelBase, hasViewClassifier: i2.hasViewClassifier, error: null });
      s.cocoReady = true;
      s.initFrac = cfg.ocr ? 0.55 : 1;
      this._emit(true);
    })().catch((e) => { if (e?.message !== 'cancelled' && !signal.aborted) fail('coco', e); throw e; });

    // ---- OCR (tải song song, khởi tạo sau khi model xe đã nạp để không tranh CPU) ----
    const ocrTask = (async () => {
      if (!cfg.ocr) { await terminateOCR(); setOCRAssets(null); return; }
      if (!wantOcr) { s.ocrReady = true; return; }
      const [libR, wR, cR, lR] = await Promise.all([
        items.tess ? fetchItem(items.tess) : null,
        fetchItem(items.tworker),
        fetchItem(items.tcore),
        fetchItem(items.tlang, false), // worker tự đọc tệp này (bộ đệm HTTP/IndexedDB của Tesseract)
      ]);
      await cocoTask.catch(() => {});
      if (!live()) return;
      if (libR) await injectScript(libR.buf, 'Tesseract');
      this.ocrBlobs.forEach((u) => URL.revokeObjectURL(u));
      const workerUrl = URL.createObjectURL(new Blob([wR.buf], { type: 'text/javascript' }));
      const coreUrl = URL.createObjectURL(new Blob([cR.buf], { type: 'text/javascript' }));
      this.ocrBlobs = [workerUrl, coreUrl];
      const langDir = lR.url.replace(/\/[^/]*$/, '');
      // Tesseract.js dùng corePath trực tiếp khi chuỗi kết thúc bằng "js": thêm #tên-tệp vào Blob URL (phần # bị bỏ qua khi tải)
      setOCRAssets({ workerPath: workerUrl, corePath: `${coreUrl}#${coreFile}`, langPath: langDir });
      s.status = 'initializing';
      s.stage = 'Đang khởi tạo OCR (Tesseract.js)…';
      this._emit(true);
      const base = s.initFrac;
      const r = await initOCR((t) => { if (live()) { s.stage = t; this._emit(); } }, {
        onProgress: ({ status, progress }) => {
          if (!live()) return;
          s.initFrac = Math.min(0.98, base + (1 - base) * progress * 0.9);
          s.stage = /traineddata/i.test(status) ? `OCR: đang nạp dữ liệu chữ ${Math.round(progress * 100)}%` : /initializ/i.test(status) ? 'OCR: đang khởi tạo…' : s.stage;
          this._emit();
        },
      });
      if (!live()) return;
      if (!r.ok) throw new Error(r.error || 'Không khởi tạo được OCR');
      s.ocrReady = true;
    })().catch((e) => { if (e?.message !== 'cancelled' && !signal.aborted) fail('ocr', e); throw e; });

    const results = await Promise.allSettled([cocoTask, ocrTask]);
    if (!live()) return this.state;
    if (results.some((x) => x.status === 'rejected')) {
      s.status = 'error';
      s.stage = s.error?.group === 'ocr' && s.cocoReady ? 'Model nhận diện xe đã sẵn sàng nhưng OCR chưa tải được' : 'Không tải được model nhận diện xe';
      if (!s.error) s.error = { group: 'coco', message: String(results.find((x) => x.status === 'rejected')?.reason?.message ?? 'Lỗi không xác định') };
      this._emit(true);
    } else {
      s.status = 'ready';
      s.initFrac = 1;
      s.finishedAt = performance.now();
      s.stage = this._readyText();
      this._emit(true);
    }
    return this.state;
  }

  /** Xóa dữ liệu AI đã lưu trên máy (Cache Storage + bộ đệm dữ liệu chữ của Tesseract). */
  async clearCache() {
    let bytes = 0;
    try {
      const c = await openCache();
      if (c) for (const req of await c.keys()) { const r = await c.match(req); bytes += Number(r?.headers.get('content-length')) || (await r?.clone().arrayBuffer())?.byteLength || 0; }
      if (typeof caches !== 'undefined') await caches.delete(CACHE_NAME);
    } catch (e) { log.warn('Xóa bộ đệm AI lỗi', e?.message); }
    try { indexedDB.deleteDatabase('keyval-store'); } catch { /* noop */ } // nơi Tesseract.js lưu dữ liệu chữ
    return bytes;
  }

  /** Dung lượng dữ liệu AI đang lưu (byte), để hiển thị. */
  async cacheBytes() {
    try {
      const c = await openCache();
      if (!c) return 0;
      let total = 0;
      for (const req of await c.keys()) {
        const r = await c.match(req);
        const len = Number(r?.headers.get('content-length'));
        total += len || (await r.clone().arrayBuffer()).byteLength;
      }
      return total;
    } catch { return 0; }
  }
}

export const aiPreloader = new AIPreloader();

/* ----------------------------- định dạng hiển thị ----------------------------- */
export function fmtBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '0 MB';
  if (n < 1e6) return `${Math.max(1, Math.round(n / 1e3))} KB`;
  return `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0).replace('.', ',')} MB`;
}
export function fmtEta(sec) {
  if (sec == null || !Number.isFinite(sec)) return 'đang ước lượng thời gian…';
  if (sec < 1.5) return 'sắp xong';
  if (sec < 60) return `còn ~${Math.round(sec)} giây`;
  const m = Math.floor(sec / 60);
  const r = Math.round(sec % 60);
  return `còn ~${m} phút${r ? ` ${r} giây` : ''}`;
}
export function fmtSpeed(bps) {
  if (!bps || bps < 1000) return '';
  return bps >= 1e6 ? `${(bps / 1e6).toFixed(1).replace('.', ',')} MB/s` : `${Math.round(bps / 1e3)} KB/s`;
}
export { CONFIG };
