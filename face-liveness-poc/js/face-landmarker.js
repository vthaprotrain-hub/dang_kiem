/**
 * face-landmarker.js — Tải MediaPipe Tasks Vision (Face Landmarker) và chạy suy luận trong trình duyệt.
 *
 * - Chỉ khởi tạo MỘT lần (initPromise); gọi lại `init()` sẽ trả về cùng promise (trừ khi lần trước thất bại).
 * - Chế độ VIDEO, landmark 3D, KHÔNG bật blendshapes; bật ma trận biến đổi khuôn mặt để ước lượng góc.
 * - Delegate GPU nếu có, tự rơi về CPU khi GPU/WebGL lỗi (lúc tạo, lúc chạy thử, hoặc lúc suy luận).
 * - Thư viện và model được thử lần lượt theo `CONFIG.assets` (CDN → self-host) để dễ chuyển sang tự lưu trữ.
 * - Toàn bộ suy luận chạy phía client; không có dữ liệu nào rời khỏi trình duyệt.
 */

export const EngineErrorCode = Object.freeze({
  LIB_LOAD_FAILED: 'LIB_LOAD_FAILED',
  MODEL_LOAD_FAILED: 'MODEL_LOAD_FAILED',
  INFERENCE_FAILED: 'INFERENCE_FAILED',
});

export class EngineError extends Error {
  constructor(code, message, attempts = []) {
    super(message);
    this.name = 'EngineError';
    this.code = code;
    this.attempts = attempts; // [{source, error}]
  }
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}: quá thời gian chờ ${Math.round(ms / 1000)}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export class FaceLandmarkerEngine {
  /**
   * @param {object} cfg  CONFIG (dùng cfg.assets và cfg.detection)
   */
  constructor(cfg) {
    this.cfg = cfg;
    this.initPromise = null;
    this.landmarker = null;
    this.vision = null; // module @mediapipe/tasks-vision
    this.fileset = null;
    this.delegate = null; // 'GPU' | 'CPU' sau khi khởi tạo
    this.libSource = null;
    this.modelSource = null;
    this.lastTimestamp = -1;
    this.gpuErrors = 0;
  }

  get ready() {
    return !!this.landmarker;
  }

  /**
   * @param {(msg:string)=>void} [onProgress]
   */
  init(onProgress = () => {}) {
    if (!this.initPromise) {
      this.initPromise = this.doInit(onProgress).catch((err) => {
        this.initPromise = null; // cho phép thử lại
        throw err;
      });
    }
    return this.initPromise;
  }

  async doInit(onProgress) {
    await this.loadLibrary(onProgress);
    const wanted = this.cfg.detection.delegate; // 'auto' | 'gpu' | 'cpu'
    const order = wanted === 'cpu' ? ['CPU'] : wanted === 'gpu' ? ['GPU'] : ['GPU', 'CPU'];

    const modelAttempts = [];
    for (const delegate of order) {
      for (const model of this.cfg.assets.models) {
        onProgress(`Đang tải mô hình nhận diện (${model.name}, ${delegate})…`);
        try {
          this.landmarker = await withTimeout(this.createLandmarker(model.url, delegate), 60000, model.name);
          await this.warmUp();
          this.delegate = delegate;
          this.modelSource = model.name;
          return this;
        } catch (err) {
          this.disposeLandmarker();
          modelAttempts.push({ source: `${model.name}/${delegate}`, error: err });
        }
      }
    }
    throw new EngineError(
      EngineErrorCode.MODEL_LOAD_FAILED,
      'Không tải hoặc khởi tạo được mô hình nhận diện khuôn mặt.',
      modelAttempts
    );
  }

  async loadLibrary(onProgress) {
    const attempts = [];
    for (const lib of this.cfg.assets.libraries) {
      onProgress(`Đang tải thư viện MediaPipe (${lib.name})…`);
      try {
        const mod = await withTimeout(import(/* @vite-ignore */ lib.moduleUrl), 30000, lib.name);
        if (!mod.FaceLandmarker || !mod.FilesetResolver) throw new Error('Module thiếu FaceLandmarker/FilesetResolver');
        this.fileset = await withTimeout(mod.FilesetResolver.forVisionTasks(lib.wasmBase), 30000, `${lib.name} wasm`);
        this.vision = mod;
        this.libSource = lib.name;
        return;
      } catch (err) {
        attempts.push({ source: lib.name, error: err });
      }
    }
    throw new EngineError(EngineErrorCode.LIB_LOAD_FAILED, 'Không tải được thư viện MediaPipe Tasks Vision.', attempts);
  }

  createLandmarker(modelUrl, delegate) {
    const d = this.cfg.detection;
    return this.vision.FaceLandmarker.createFromOptions(this.fileset, {
      baseOptions: { modelAssetPath: modelUrl, delegate },
      runningMode: 'VIDEO',
      numFaces: d.numFaces,
      minFaceDetectionConfidence: d.minFaceDetectionConfidence,
      minFacePresenceConfidence: d.minFacePresenceConfidence,
      minTrackingConfidence: d.minTrackingConfidence,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: true,
    });
  }

  /** Chạy thử một lần trên canvas trống để lộ sớm lỗi GPU/WebGL và biên dịch shader trước frame đầu. */
  async warmUp() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    c.getContext('2d').fillRect(0, 0, 64, 64);
    this.landmarker.detectForVideo(c, this.nextTimestamp(performance.now()));
  }

  nextTimestamp(nowMs) {
    // MediaPipe yêu cầu timestamp tăng nghiêm ngặt giữa các lần gọi trong chế độ VIDEO.
    this.lastTimestamp = Math.max(Math.round(nowMs), this.lastTimestamp + 1);
    return this.lastTimestamp;
  }

  /**
   * Suy luận một frame video.
   * @returns {{result: object, inferenceMs: number}}
   */
  detect(video, nowMs) {
    if (!this.landmarker) throw new EngineError(EngineErrorCode.INFERENCE_FAILED, 'Mô hình chưa sẵn sàng.');
    const t0 = performance.now();
    const result = this.landmarker.detectForVideo(video, this.nextTimestamp(nowMs));
    return { result, inferenceMs: performance.now() - t0 };
  }

  /**
   * Khi suy luận GPU lỗi lúc chạy (mất context WebGL...), tạo lại bằng CPU. Trả về true nếu đã chuyển được.
   */
  async fallbackToCpu() {
    if (this.delegate === 'CPU') return false;
    const model = this.cfg.assets.models.find((m) => m.name === this.modelSource) || this.cfg.assets.models[0];
    this.disposeLandmarker();
    try {
      this.landmarker = await this.createLandmarker(model.url, 'CPU');
      await this.warmUp();
      this.delegate = 'CPU';
      return true;
    } catch {
      this.disposeLandmarker();
      return false;
    }
  }

  disposeLandmarker() {
    if (this.landmarker) {
      try {
        this.landmarker.close();
      } catch {
        // đã đóng
      }
      this.landmarker = null;
    }
  }

  /** Giải phóng model/WASM. Gọi khi rời trang. */
  dispose() {
    this.disposeLandmarker();
    this.initPromise = null;
  }
}
