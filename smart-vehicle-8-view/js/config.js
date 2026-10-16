/**
 * config.js — Toàn bộ hằng số, ngưỡng và cấu hình mặc định của POC.
 * Mọi ngưỡng đều có thể chỉnh trong "Chế độ kiểm thử POC" (màn hình 1) hoặc sửa trực tiếp tại đây.
 * Không chứa logic — chỉ dữ liệu.
 */

export const APP_INFO = Object.freeze({
  name: 'Smart Vehicle 8-View Capture POC',
  version: '0.1.0',
  dbName: 'sv8v-poc',
  dbVersion: 1,
});

/* ------------------------------------------------------------------ */
/* 8 góc chuẩn — thứ tự chiều kim đồng hồ nhìn từ trên xuống           */
/* deg = góc quỹ đạo của NGƯỜI CHỤP quanh xe, 0° = đứng trước đầu xe  */
/* ------------------------------------------------------------------ */
export const ANGLES = Object.freeze([
  { key: 'front',       index: 0, deg: 0,   name: 'Đầu xe',     short: 'Trước',     orientation: 'portrait',  family: 'end',
    action: 'Chụp đầu xe',
    hint: 'Đứng chính diện trước đầu xe. Lấy trọn đầu xe, kính chắn gió và biển số.' },
  { key: 'front_right', index: 1, deg: 45,  name: 'Trước phải', short: 'Tr.phải',   orientation: 'landscape', family: 'oblique',
    action: 'Chụp trước phải',
    hint: 'Đứng chéo ở phía trước bên phải của xe, thấy cả đầu xe và thân bên phải.' },
  { key: 'right',       index: 2, deg: 90,  name: 'Bên phải',   short: 'Phải',      orientation: 'landscape', family: 'side',
    action: 'Chụp bên phải',
    hint: 'Đứng vuông góc với thân bên phải, lấy trọn chiều dài xe.' },
  { key: 'rear_right',  index: 3, deg: 135, name: 'Sau phải',   short: 'S.phải',    orientation: 'landscape', family: 'oblique',
    action: 'Chụp sau phải',
    hint: 'Đứng chéo ở phía sau bên phải của xe, thấy cả đuôi xe và thân bên phải.' },
  { key: 'rear',        index: 4, deg: 180, name: 'Đuôi xe',    short: 'Sau',       orientation: 'portrait',  family: 'end',
    action: 'Chụp đuôi xe',
    hint: 'Đứng chính diện sau đuôi xe. Lấy trọn đuôi xe, đèn hậu và biển số.' },
  { key: 'rear_left',   index: 5, deg: 225, name: 'Sau trái',   short: 'S.trái',    orientation: 'landscape', family: 'oblique',
    action: 'Chụp sau trái',
    hint: 'Đứng chéo ở phía sau bên trái của xe, thấy cả đuôi xe và thân bên trái.' },
  { key: 'left',        index: 6, deg: 270, name: 'Bên trái',   short: 'Trái',      orientation: 'landscape', family: 'side',
    action: 'Chụp bên trái',
    hint: 'Đứng vuông góc với thân bên trái, lấy trọn chiều dài xe.' },
  { key: 'front_left',  index: 7, deg: 315, name: 'Trước trái', short: 'Tr.trái',   orientation: 'landscape', family: 'oblique',
    action: 'Chụp trước trái',
    hint: 'Đứng chéo ở phía trước bên trái của xe, thấy cả đầu xe và thân bên trái.' },
]);
export const ANGLE_KEYS = Object.freeze(ANGLES.map((a) => a.key));
export const ANGLE_BY_KEY = Object.freeze(Object.fromEntries(ANGLES.map((a) => [a.key, a])));

/* ------------------------------------------------------------------ */
/* Loại xe                                                              */
/* ------------------------------------------------------------------ */
export const VEHICLE_TYPES = Object.freeze([
  { id: 'car',       label: 'Xe con',           shape: 'sedan' },
  { id: 'suv',       label: 'SUV/Crossover',    shape: 'suv' },
  { id: 'sedan',     label: 'Sedan',            shape: 'sedan' },
  { id: 'hatchback', label: 'Hatchback',        shape: 'hatchback' },
  { id: 'mpv',       label: 'MPV',              shape: 'mpv' },
  { id: 'pickup',    label: 'Bán tải',          shape: 'pickup' },
  { id: 'truck',     label: 'Xe tải',           shape: 'truck' },
  { id: 'bus',       label: 'Xe khách/xe buýt', shape: 'bus' },
  { id: 'other',     label: 'Khác',             shape: 'sedan' },
]);
export const VEHICLE_TYPE_BY_ID = Object.freeze(Object.fromEntries(VEHICLE_TYPES.map((v) => [v.id, v])));

/**
 * Kích thước gần đúng (mét) dùng cho (1) sinh khung placeholder 3D dạng wireframe,
 * (2) mô hình tỷ lệ khung bbox ↔ góc nhìn. Chỉ là tham số tượng trưng của một "xe điển hình"
 * trong mỗi nhóm — KHÔNG mô tả chính xác từng mẫu xe.
 * Quy ước trục: x = hướng về phía đầu xe, y = bên trái xe, z = lên trên.
 */
export const VEHICLE_SHAPES = Object.freeze({
  sedan: {
    kind: 'car', L: 4.7, W: 1.85, H: 1.45, c: 0.17, wr: 0.33, wb: 2.8,
    hood: 0.86, belt: 0.98, rear: 0.95,
    cabin: { bx: [-1.15, 0.85], tx: [-0.65, 0.15], bw: 0.9, tw: 0.76 },
    lightZ: 0.8, mirrorZ: 1.08, glassInset: 0.82,
  },
  hatchback: {
    kind: 'car', L: 4.0, W: 1.75, H: 1.5, c: 0.17, wr: 0.31, wb: 2.55,
    hood: 0.78, belt: 0.92, rear: 0.92,
    cabin: { bx: [-1.6, 0.65], tx: [-1.4, 0.05], bw: 0.9, tw: 0.78 },
    lightZ: 0.74, mirrorZ: 1.02, glassInset: 0.82,
  },
  suv: {
    kind: 'car', L: 4.6, W: 1.9, H: 1.72, c: 0.22, wr: 0.38, wb: 2.75,
    hood: 0.95, belt: 1.05, rear: 1.05,
    cabin: { bx: [-1.95, 0.8], tx: [-1.85, 0.1], bw: 0.9, tw: 0.8 },
    lightZ: 0.9, mirrorZ: 1.18, glassInset: 0.82,
  },
  mpv: {
    kind: 'car', L: 4.5, W: 1.8, H: 1.75, c: 0.18, wr: 0.34, wb: 2.75,
    hood: 0.82, belt: 0.95, rear: 0.95,
    cabin: { bx: [-2.0, 1.0], tx: [-1.9, 0.4], bw: 0.9, tw: 0.82 },
    lightZ: 0.78, mirrorZ: 1.1, glassInset: 0.84,
  },
  pickup: {
    kind: 'pickup', L: 5.3, W: 1.9, H: 1.8, c: 0.25, wr: 0.4, wb: 3.2,
    hood: 0.98, belt: 1.1, rear: 1.1,
    cabin: { bx: [-0.6, 1.0], tx: [-0.5, 0.45], bw: 0.9, tw: 0.78 },
    bed: { x: [-2.55, -0.72] },
    lightZ: 0.92, mirrorZ: 1.22, glassInset: 0.82,
  },
  truck: {
    kind: 'truck', L: 7.0, W: 2.4, H: 3.0, c: 0.5, wr: 0.5, wb: 4.2,
    chassisTop: 1.3,
    cabin: { bx: [1.7, 3.5], tx: [1.8, 3.38], z: [1.3, 2.7], bw: 0.96, tw: 0.9 },
    cargo: { x: [-3.5, 1.6], z: [1.3, 3.0], w: 0.98 },
    lightZ: 1.0, mirrorZ: 2.1, glassInset: 0.8,
  },
  bus: {
    kind: 'bus', L: 9.5, W: 2.5, H: 3.2, c: 0.4, wr: 0.5, wb: 5.6,
    chassisTop: 1.2,
    cabin: { bx: [-4.75, 4.75], tx: [-4.7, 4.6], z: [1.2, 3.2], bw: 0.98, tw: 0.94 },
    lightZ: 0.85, mirrorZ: 2.2, glassInset: 0.88,
  },
});

/* ------------------------------------------------------------------ */
/* Thư viện bên thứ ba (chạy hoàn toàn trên client)                     */
/* ------------------------------------------------------------------ */
export const LIBS = Object.freeze({
  tfjs: {
    name: 'TensorFlow.js', version: '4.22.0', license: 'Apache-2.0', global: 'tf',
    urls: [
      'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js',
      'https://unpkg.com/@tensorflow/tfjs@4.22.0/dist/tf.min.js',
    ],
  },
  tfjsWasm: {
    name: 'TensorFlow.js WASM backend', version: '4.22.0', license: 'Apache-2.0', global: 'tf',
    urls: [
      'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-wasm@4.22.0/dist/tf-backend-wasm.min.js',
      'https://unpkg.com/@tensorflow/tfjs-backend-wasm@4.22.0/dist/tf-backend-wasm.min.js',
    ],
    wasmPaths: 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-wasm@4.22.0/dist/',
  },
  cocoSsd: {
    name: 'COCO-SSD', version: '2.2.3', license: 'Apache-2.0', global: 'cocoSsd',
    urls: [
      'https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js',
      'https://unpkg.com/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js',
    ],
    /** Để trống = dùng URL mặc định của thư viện (storage.googleapis.com/tfjs-models). Đặt về
     *  'assets/models/coco-ssd/model.json' nếu tự host trọng số model. */
    modelUrl: '',
  },
  tesseract: {
    name: 'Tesseract.js', version: '5.1.1', license: 'Apache-2.0', global: 'Tesseract',
    urls: [
      'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
      'https://unpkg.com/tesseract.js@5.1.1/dist/tesseract.min.js',
    ],
  },
  jsZipNotUsed: 'ZIP được tạo bằng js/zipWriter.js (không dùng thư viện ngoài).',
});

/** Đường dẫn tùy chọn tới model phân loại 8 góc (TensorFlow.js). Xem assets/models/README.md. */
export const VIEW_CLASSIFIER = Object.freeze({
  url: 'assets/models/view-classifier/model.json',
  format: 'graph', // 'graph' (tf.loadGraphModel) | 'layers' (tf.loadLayersModel)
  inputSize: 224,
  /** Thứ tự lớp đầu ra phải đúng thứ tự ANGLE_KEYS. */
  /** Mặc định TẮT (repo không kèm model). Đặt model vào assets/models/view-classifier/ rồi đổi thành true. */
  enabled: false,
});

/* ------------------------------------------------------------------ */
/* Cài đặt mặc định (người dùng chỉnh ở màn hình 1)                     */
/* ------------------------------------------------------------------ */
export const DEFAULT_SETTINGS = Object.freeze({
  mode: 'live',               // 'live' = camera thật | 'demo' = dữ liệu giả lập
  voice: true,
  autoCapture: false,         // tự chụp khi đủ điều kiện (mặc định tắt trong POC)
  testMode: false,
  ocrEnabled: true,
  confidenceThreshold: 0.5,   // ngưỡng confidence COCO-SSD
  backend: 'auto',            // auto | webgl | wasm | cpu
  modelBase: 'lite_mobilenet_v2',
  tryOrientationLock: true,
});

/* ------------------------------------------------------------------ */
/* Ngưỡng và tham số thuật toán                                         */
/* ------------------------------------------------------------------ */
export const CONFIG = {
  detection: {
    classes: ['car', 'truck', 'bus'],
    maxDetections: 8,
    intervalMs: 220,           // chu kỳ suy luận mục tiêu
    minIntervalMs: 150,
    maxIntervalMs: 1100,       // tự giãn khi thiết bị chậm
    loadTimeoutMs: 45000,
    stableFrames: 4,           // số lần liên tiếp bbox ổn định
    stableIou: 0.72,
    lostFrames: 5,             // mất xe sau N lần không thấy
    edgeMargin: 0.012,         // bbox sát mép khung trong 1.2% => coi là bị cắt
    minAreaRatio: { portrait: 0.07, landscape: 0.17 },
    maxAreaRatio: 0.9,
    multiVehicleMinScore: 0.5,
    multiVehicleMinAreaRatio: 0.04,
  },

  sensors: {
    fovLongSideDeg: 66,        // FOV của cạnh dài khung hình camera (ước lượng điển hình)
    headingFilter: 0.22,       // hệ số lọc EMA vector hướng
    minHorizontalMag: 0.28,    // camera chúc xuống/ngẩng lên quá nhiều => hướng không tin cậy
    visualFilter: 0.3,         // lọc độ lệch bbox
    maxVisualOffsetDeg: 40,
    rateWindowMs: 1400,
    cwRateDegPerSec: 5,
    stillRateDegPerSec: 2.5,
    directionHoldMs: 450,      // hysteresis: giữ hướng tối thiểu trước khi đổi
    staleMs: 900,              // quá thời gian này không có sự kiện cảm biến => stale
    emitIntervalMs: 100,
    steadyRotationDegPerSec: 14,
    steadyAccelDeviation: 1.6, // m/s²
    steadyHoldMs: 350,
  },

  angle: {
    sensorSigmaDeg: 24,
    visualSigma: 0.34,         // sigma (log) của tỷ lệ khung bbox
    visualWeight: 0.6,
    classifierWeight: 1.0,
    smoothing: 0.55,           // EMA hậu nghiệm (giá trị lớn = mượt hơn)
    toleranceEnterDeg: 25,     // vào vùng mục tiêu
    toleranceExitDeg: 36,      // rời vùng mục tiêu (hysteresis)
    minConfidence: 0.45,       // dưới ngưỡng => cần xác nhận thủ công
    manualConfirmBelow: 0.6,
    minVisualConsistency: 0.12,
    stableMs: 700,
  },

  navigation: {
    wrongDirectionMs: 1600,        // trạng thái sai chiều phải ổn định tối thiểu bấy lâu
    wrongDirectionMinDeg: 18,      // và đã đi ngược tối thiểu bấy nhiêu độ
    wrongDirectionClearMs: 900,
    wrongDirectionMinSensorConf: 0.4,
    sensorlessReadyDelayMs: 2500,  // chế độ không cảm biến: chờ trước khi cho chụp góc kế
    locateTimeoutMs: 6000,         // quá thời gian này chưa định vị => chuyển hướng dẫn thủ công
    vehicleLostGraceMs: 900,
    acceptedHoldMs: 1100,
    orientationDebounceMs: 350,
    startIdentifyMinStableMs: 600,
    startOcrAttempts: 2,
  },

  quality: {
    analysisMaxSide: 480,
    darkMean: 62,              // < ngưỡng => cảnh báo tối
    veryDarkMean: 38,          // < ngưỡng => lỗi
    brightMean: 222,           // > ngưỡng => cảnh báo cháy sáng
    lowContrastStd: 24,
    emptyStd: 7,
    blurWarn: 55,              // điểm sắc nét (Laplacian, top-25% block) dưới ngưỡng => cảnh báo
    blurError: 18,             // dưới ngưỡng => lỗi
    minAreaRatio: { portrait: 0.07, landscape: 0.17 },
    maxAreaRatio: 0.93,
    clippedIsError: true,      // xe chạm mép khung ở 1 phía: true = từ chối ảnh, false = chỉ cảnh báo
    overrideAfterRejects: 2,   // sau N lần liên tiếp bị từ chối ở cùng góc vì lỗi do AI/khung hình, cho phép khách hàng "vẫn lưu"
    overridableCodes: ['no_vehicle', 'clipped', 'too_close', 'too_far'],
    minGuideCoverage: 0.72,    // phần bbox xe nằm trong khung hướng dẫn mở rộng
    guideExpand: 0.08,
    duplicateHamming: 3,       // dHash 64-bit: khoảng cách <= ngưỡng => ảnh gần như trùng
    steadyWaitMs: 800,
    jpegQuality: 0.92,
    maxSide: 2560,
    weights: { sharp: 30, exposure: 20, framing: 30, steady: 10, angle: 10 },
    passScore: 50,
  },

  ocr: {
    minConfidence: 55,          // Tesseract word confidence (0–100)
    matchSimilarity: 0.8,
    plateWhitelist: '0123456789ABCDEFGHKLMNPRSTUVXYZ',
    cropMaxWidth: 640,
  },

  orientation: {                // vehicleOrientationDetector
    confirmThreshold: 0.75,
    weakEvidenceCap: 0.6,
  },

  ui: {
    toastMs: 2600,
    guidanceMinHoldMs: 700,     // giữ chỉ dẫn tối thiểu để tránh nhấp nháy
    speakRepeatMs: 9000,
    controlLoopMs: 200,
  },
};

/** Gộp ghi đè từ settings vào bản sao của CONFIG (dùng ở chế độ kiểm thử). */
export function cloneConfig() {
  return JSON.parse(JSON.stringify(CONFIG));
}
