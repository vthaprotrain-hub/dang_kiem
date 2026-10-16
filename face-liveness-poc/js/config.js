/**
 * config.js — Toàn bộ ngưỡng và cấu hình của POC.
 *
 * Mọi con số bên dưới là ngưỡng THỬ NGHIỆM (POC), chưa được hiệu chuẩn trên tập thiết bị thật.
 * Chỉnh tại đây (hoặc qua query string, xem cuối file) thay vì sửa logic trong các module khác.
 */

/** Phiên bản @mediapipe/tasks-vision được ghim (Apache-2.0). Đổi ở đây để nâng cấp. */
export const MEDIAPIPE_VERSION = '0.10.35';

/** Model chính thức do Google phát hành (Face Landmarker, float16, v1). */
export const FACE_LANDMARKER_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

function readQuery() {
  try {
    return new URLSearchParams(globalThis.location ? globalThis.location.search : '');
  } catch {
    return new URLSearchParams();
  }
}
const query = readQuery();

const jsdelivr = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}`;
const unpkg = `https://unpkg.com/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}`;

const selfHostLib = {
  name: 'self-host',
  moduleUrl: new URL('../vendor/mediapipe/vision_bundle.mjs', import.meta.url).href,
  wasmBase: new URL('../vendor/mediapipe/wasm', import.meta.url).href,
};
const cdnLibs = [
  { name: 'jsdelivr', moduleUrl: `${jsdelivr}/vision_bundle.mjs`, wasmBase: `${jsdelivr}/wasm` },
  { name: 'unpkg', moduleUrl: `${unpkg}/vision_bundle.mjs`, wasmBase: `${unpkg}/wasm` },
];
const googleModel = { name: 'google-storage', url: FACE_LANDMARKER_MODEL_URL };
const selfHostModel = {
  name: 'self-host',
  url: new URL('../models/face_landmarker.task', import.meta.url).href,
};

// ?assets=local → ưu tiên file self-host (vendor/ và models/) trước CDN.
const preferLocal = query.get('assets') === 'local';

export const CONFIG = {
  version: '0.1.0-poc',

  /** Nguồn tải thư viện + model. Thử lần lượt, nguồn đầu tiên thành công sẽ được dùng. */
  assets: {
    libraries: preferLocal ? [selfHostLib, ...cdnLibs] : [...cdnLibs, selfHostLib],
    models: preferLocal ? [selfHostModel, googleModel] : [googleModel, selfHostModel],
  },

  camera: {
    /** 'user' = camera trước. */
    facingMode: 'user',
    idealWidth: 1280,
    idealHeight: 720,
  },

  detection: {
    /**
     * Cần ≥ 2 để phát hiện được "nhiều khuôn mặt" (với numFaces = 1 MediaPipe chỉ trả về 1 mặt).
     * Không bật blendshapes; chỉ bật ma trận biến đổi khuôn mặt để ước lượng góc.
     */
    numFaces: 2,
    minFaceDetectionConfidence: 0.5,
    minFacePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    /** Delegate: 'auto' (GPU rồi CPU) | 'gpu' | 'cpu'. Query ?delegate=cpu để ép CPU. */
    delegate: ['gpu', 'cpu'].includes(query.get('delegate')) ? query.get('delegate') : 'auto',
    /** Khuôn mặt phụ có chiều cao < ngưỡng này (so với chiều cao khung nhìn) bị bỏ qua (mặt nhỏ ở nền, ảnh trên tường...). */
    ignoreSmallFaceRatio: 0.12,
  },

  /** Placeholder hình oval (toạ độ chuẩn hoá theo vùng camera đang hiển thị). */
  oval: {
    centerX: 0.5,
    centerY: 0.46,
    heightRatio: 0.62,
    aspect: 0.76, // rộng / cao
    maxWidthRatio: 0.86,
  },

  position: {
    maxOffsetX: 0.08, // 8% chiều rộng vùng camera
    maxOffsetY: 0.08, // 8% chiều cao vùng camera
  },

  /** Tỷ lệ chiều cao bounding box khuôn mặt / chiều cao vùng camera. */
  scale: {
    min: 0.35,
    max: 0.75,
  },

  /** Góc tối đa (độ). */
  pose: {
    maxYaw: 10,
    maxPitch: 10,
    maxRoll: 8,
    /** Chênh lệch tối đa (độ) giữa góc từ ma trận và từ landmark trước khi cảnh báo xung đột (chỉ để debug). */
    conflictWarnDeg: 25,
  },

  stability: {
    /** Thời gian liên tục tất cả điều kiện phải đạt (ms). Khuyến nghị 800–1200. */
    requiredMs: 1000,
    /** Tốc độ dịch chuyển đã làm mượt tối đa, đơn vị = chiều cao mặt / giây. */
    maxSmoothedSpeed: 0.3,
    /** Tốc độ tức thời tối đa (chuyển động đột ngột). */
    maxInstantSpeed: 0.9,
    /** Hằng số thời gian làm mượt tốc độ (ms). */
    smoothingMs: 250,
    /** Khoảng trống giữa hai lần cập nhật vượt ngưỡng này thì reset bộ đếm ổn định (ms). */
    maxGapMs: 500,
  },

  quality: {
    /** Chiều rộng ảnh phân tích (px). Giữ nhỏ để không tốn CPU. */
    analysisWidth: 128,
    /** Khoảng cách tối thiểu giữa hai lần phân tích (ms). */
    intervalMs: 150,
    /** Độ sáng trung bình (luma 0–255) vùng mặt. */
    minBrightness: 70,
    maxBrightness: 225,
    /**
     * Variance of Laplacian trên crop mặt đã thu về `analysisWidth` px (thang xám 0–255).
     * CHƯA hiệu chuẩn — hãy đọc giá trị ở chế độ kỹ thuật trên thiết bị thật rồi chỉnh.
     */
    minSharpness: 20,
    /** Số mẫu dùng cho trung vị / trung bình (làm mượt). */
    smoothingWindow: 5,
    /** Kết quả cũ hơn ngưỡng này coi như không còn hiệu lực (ms). */
    maxAgeMs: 1000,
  },

  liveness: {
    enabled: query.get('liveness') !== 'off',
    /** Danh sách thử thách có thể được chọn ngẫu nhiên. */
    challenges: ['BLINK', 'TURN_LEFT', 'TURN_RIGHT'],
    /** Số thử thách liên tiếp mỗi lần xác minh. */
    challengeCount: 1,
    /** Thời gian chờ hành động sau khi phát lệnh (ms). */
    stepTimeoutMs: 8000,
    /** Thời gian chờ quay lại nhìn thẳng sau khi quay đầu (ms). */
    returnTimeoutMs: 6000,
    /** Thời gian tối đa để thu "đường nền" (mắt mở, nhìn thẳng) trước khi phát lệnh (ms). */
    baselineTimeoutMs: 6000,
    /** Mắt phải mở và đầu thẳng liên tục tối thiểu ngần này ms trước khi phát lệnh. */
    baselineMs: 500,
    baselineMinSamples: 5,
    /** Hành động xảy ra trong khoảng ngắn ngay sau lệnh không được tính (phản xạ tự nhiên có từ trước). */
    promptGraceMs: 250,
    /** Mất mặt quá lâu trong lúc thử thách thì huỷ (ms). */
    faceLostMs: 1000,
    /** Thời gian hiển thị trạng thái ACTION_DETECTED trước khi chuyển bước (ms). */
    actionDisplayMs: 500,
    blink: {
      /** EAR tuyệt đối tối thiểu khi "mắt mở" lúc thu đường nền. */
      minOpenEar: 0.16,
      /** Mắt coi là nhắm khi EAR ≤ closeRatio × EAR nền; mở lại khi EAR ≥ openRatio × EAR nền (trễ/hysteresis). */
      closeRatio: 0.65,
      openRatio: 0.82,
      minClosedMs: 40,
      maxClosedMs: 1000,
      minClosedSamples: 2,
    },
    turn: {
      /** Góc quay tối thiểu (độ) theo hướng yêu cầu. */
      minDeg: 15,
      holdMs: 150,
      minSamples: 2,
      /** Quay lại "nhìn thẳng": |yaw| ≤ returnMaxDeg và các góc khác đạt, liên tục returnHoldMs. */
      returnHoldMs: 300,
    },
    /** Sau khi hoàn thành, kết quả chỉ có hiệu lực trong khoảng này (ms) — tránh "hoàn thành rồi đổi người". */
    validityMs: 20000,
    /** Sau khi hoàn thành, nếu mất mặt quá lâu thì huỷ kết quả (tránh đổi người) (ms). */
    passedFaceLostResetMs: 1200,
    /** Khi đang ở trạng thái "chưa xác nhận được" mà không còn mặt quá lâu thì tự đặt lại (ms). */
    inconclusiveResetAfterNoFaceMs: 3000,
  },

  capture: {
    mimeType: 'image/jpeg',
    quality: 0.92,
    /** Giới hạn cạnh dài của ảnh xuất ra (px). */
    maxLongSide: 1920,
    /** Ảnh lưu có lật gương như màn hình xem không. false = ảnh gốc từ camera. */
    mirrorSavedImage: false,
    /** Phân tích cũ hơn ngưỡng này thì không cho chụp (ms). */
    maxAnalysisAgeMs: 400,
  },

  performance: {
    /** Khoảng cách tối thiểu giữa hai lần suy luận (ms). 40 ≈ 25 lần/giây. */
    inferenceIntervalMs: 40,
    /** Nếu thời gian suy luận trung bình vượt ngưỡng này, giãn tần suất xử lý. */
    lowPerfInferenceMs: 45,
    /** Hệ số giãn: interval = max(inferenceIntervalMs, avgInferenceMs × hệ số). */
    lowPerfIntervalFactor: 2,
  },

  ui: {
    /** Thời gian tối thiểu giữa hai lần đổi thông báo hướng dẫn (ms) để tránh nhấp nháy. */
    guidanceHoldMs: 350,
    debugRefreshMs: 250,
    startWithDebug: query.get('debug') === '1',
  },

  /**
   * Chế độ chụp thủ công (không kiểm tra) khi model không khởi tạo được.
   * Chỉ phục vụ POC; đặt false khi triển khai thật.
   */
  allowManualFallback: query.get('manual') !== 'off',
};
