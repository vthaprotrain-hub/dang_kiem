/**
 * strings.js — Toàn bộ văn bản hiển thị / đọc giọng nói (tiếng Việt).
 * Tách riêng để dễ rà soát nội dung và đa ngôn ngữ về sau.
 */
import { ANGLE_BY_KEY } from './config.js';

export const angleName = (key) => ANGLE_BY_KEY[key]?.name ?? key;
export const lc = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

export const T = {
  guidance: {
    findingVehicle: 'Đang tìm xe trong khung hình…',
    vehicleDetectedFit: 'Đã phát hiện xe. Vui lòng đưa toàn bộ xe vào khung.',
    vehicleDetectedHold: 'Đã phát hiện xe. Giữ yên điện thoại một chút…',
    identifyingStart: 'Đang xác định đầu xe…',
    confirmStart: 'Hãy xác nhận đây là đầu xe để bắt đầu.',
    startFromFront: 'Hãy bắt đầu từ phía đầu xe.',
    startFromSide: 'Hãy đứng chính diện đầu xe hoặc đuôi xe để bắt đầu.',
    calibrateRetake: (name) => `Hãy đứng tại góc ${lc(name)} rồi xác nhận vị trí.`,
    holdSteady: 'Giữ điện thoại ổn định để chụp ảnh.',
    readyStart: (name) => `Giữ điện thoại ổn định để chụp ảnh ${lc(name)}.`,
    angleOffGeneric: (name) => `Góc chụp chưa chính xác. Hãy đứng đúng vị trí ${lc(name)} của xe.`,
    moveToDetailed: (name) => (/ xe$/i.test(name) ? `Di chuyển tới ${lc(name)}.` : `Di chuyển sang phía ${lc(name)} của xe.`),
    movingOk: 'Bạn đang đi đúng chiều kim đồng hồ.',
    wrongDirection: (name) => `Bạn đang đi ngược chiều. Vui lòng quay lại theo mũi tên để tới ${lc(name)}.`,
    overshoot: (name) => `Bạn đã đi quá ${lc(name)}. Hãy quay lại theo mũi tên.`,
    locating: 'Đang xác định vị trí quanh xe…',
    manualMove: (name) => `Hãy di chuyển tới ${lc(name)} rồi bấm Chụp.`,
    stepBack: 'Hãy lùi lại một chút để lấy trọn thân xe.',
    stepCloser: 'Hãy tiến lại gần xe hơn một chút.',
    fitVehicle: 'Đưa toàn bộ xe vào khung.',
    vehicleLost: 'Không thấy xe. Hãy hướng camera về phía xe.',
    multipleVehicles: 'Phát hiện nhiều xe trong khung. Hãy chạm vào đúng xe cần chụp.',
    angleOff: (towardName) => `Góc chụp chưa chính xác. Tiến thêm về phía ${lc(towardName)}.`,
    angleOffBack: (towardName) => `Góc chụp chưa chính xác. Lùi lại về phía ${lc(towardName)}.`,
    rotatePortrait: (name) => `Hãy xoay điện thoại theo chiều dọc để chụp ${lc(name)}.`,
    rotateLandscape: (name) => `Hãy xoay điện thoại theo chiều ngang để chụp ${lc(name)}.`,
    capturing: 'Đang chụp…',
    validating: 'Đang kiểm tra chất lượng ảnh…',
    accepted: 'Góc này đã đạt. Tiếp tục di chuyển.',
    rejected: 'Ảnh chưa đạt. Hãy chụp lại.',
    completed: 'Bạn đã hoàn thành 8/8 góc.',
    aiLoading: 'Đang khởi tạo AI nhận diện xe…',
    aiUnavailable: 'AI nhận diện chưa sẵn sàng.',
    paused: 'Đã tạm dừng.',
    retake: (name) => `Chụp lại ${lc(name)}.`,
    demo: 'Chế độ DEMO — dữ liệu giả lập, không phải kết quả AI thật.',
  },

  speech: {
    // Câu ngắn hơn cho giọng đọc
    completed: 'Hoàn thành tám trên tám góc.',
    accepted: 'Góc này đã đạt.',
  },

  ai: {
    idle: 'AI: chưa tải',
    loading: 'AI: đang khởi tạo…',
    ready: (backend) => `AI sẵn sàng${backend ? ` · ${backend}` : ''}`,
    error: 'AI: không khả dụng',
  },

  camera: {
    errors: {
      NotAllowedError: 'Bạn chưa cấp quyền camera. Hãy cho phép camera trong cài đặt trình duyệt rồi thử lại.',
      PermissionDeniedError: 'Bạn chưa cấp quyền camera. Hãy cho phép camera trong cài đặt trình duyệt rồi thử lại.',
      NotFoundError: 'Không tìm thấy camera trên thiết bị này.',
      DevicesNotFoundError: 'Không tìm thấy camera trên thiết bị này.',
      NotReadableError: 'Camera đang được ứng dụng khác sử dụng hoặc không thể mở. Hãy đóng ứng dụng đó rồi thử lại.',
      TrackStartError: 'Camera đang được ứng dụng khác sử dụng hoặc không thể mở.',
      OverconstrainedError: 'Camera không đáp ứng cấu hình yêu cầu. Đang thử cấu hình thấp hơn…',
      SecurityError: 'Trình duyệt chặn camera (cần HTTPS hoặc localhost).',
      TypeError: 'Trình duyệt không hỗ trợ truy cập camera.',
      insecure: 'Camera và cảm biến chỉ hoạt động qua HTTPS hoặc localhost.',
      unsupported: 'Trình duyệt này không hỗ trợ truy cập camera (MediaDevices API).',
      unknown: 'Không thể mở camera. Hãy thử lại.',
    },
  },

  sensors: {
    unsupported: 'Thiết bị/trình duyệt không có cảm biến chuyển động. Ứng dụng sẽ dùng hình ảnh và xác nhận thủ công.',
    denied: 'Bạn chưa cấp quyền cảm biến. Ứng dụng vẫn chụp được bằng camera + xác nhận thủ công.',
    granted: 'Cảm biến chuyển động đã sẵn sàng.',
    noData: 'Chưa nhận được dữ liệu cảm biến.',
    insecure: 'Cảm biến cần HTTPS hoặc localhost.',
  },

  quality: {
    dark: 'Ảnh hơi tối, vui lòng chụp lại.',
    veryDark: 'Ảnh quá tối, vui lòng chụp lại ở nơi đủ sáng.',
    bright: 'Ảnh bị cháy sáng, hãy tránh nguồn sáng gắt.',
    lowContrast: 'Ảnh thiếu tương phản, hãy kiểm tra ống kính và ánh sáng.',
    blur: 'Ảnh chưa rõ nét, hãy giữ điện thoại ổn định.',
    blurSevere: 'Ảnh quá mờ, hãy giữ điện thoại ổn định và chụp lại.',
    empty: 'Ảnh gần như không có nội dung.',
    noVehicle: 'Không phát hiện được xe trong ảnh.',
    tooClose: 'Xe đang quá gần, hãy lùi lại.',
    tooFar: 'Xe nằm quá nhỏ trong ảnh, hãy tiến lại gần hơn.',
    clipped: 'Xe bị cắt khỏi khung hình. Hãy đưa toàn bộ xe vào khung.',
    clippedFront: 'Phần đầu xe chưa nằm trọn trong khung.',
    clippedRear: 'Phần đuôi xe chưa nằm trọn trong khung.',
    guide: 'Xe chưa nằm trong vùng hướng dẫn.',
    shaky: 'Điện thoại đang rung khi chụp, hãy giữ ổn định.',
    duplicate: (name) => `Ảnh gần như trùng với ảnh ${name}. Hãy di chuyển tới đúng góc rồi chụp.`,
    angleMismatch: (name) => `Góc chụp có vẻ không phải ${name}.`,
    angleUnverified: 'Chưa có đủ bằng chứng để kiểm tra góc chụp — cần xác nhận thủ công.',
    aiOffline: 'AI không khả dụng nên không kiểm tra được xe trong ảnh.',
  },

  ocr: {
    idle: 'Chưa đọc biển số',
    skipped: 'Bỏ qua OCR',
    unavailable: 'OCR không khả dụng',
    notFound: 'Không đọc được biển số',
    lowConfidence: 'Đọc được biển số nhưng độ tin cậy thấp',
    matched: 'Khớp biển số đã nhập',
    mismatch: 'Không khớp biển số đã nhập',
    manualConfirmed: 'Khách hàng xác nhận thủ công',
  },

  ui: {
    angleStatus: {
      pending: 'Chưa chụp',
      target: 'Góc mục tiêu',
      analyzing: 'Đang phân tích',
      accepted: 'Đã đạt',
      retake: 'Cần chụp lại',
    },
    confidence: { none: '—', low: 'Thấp', mid: 'Vừa', high: 'Cao' },
    verification: {
      auto: 'Xác nhận bằng cảm biến + hình ảnh',
      visual: 'Xác nhận bằng hình ảnh',
      manual: 'Khách hàng xác nhận thủ công',
      classifier: 'Xác nhận bằng model phân loại góc',
      demo: 'DEMO — giả lập',
    },
  },
};

export function confidenceLabel(c) {
  if (c == null || Number.isNaN(c) || c <= 0) return T.ui.confidence.none;
  if (c < 0.45) return T.ui.confidence.low;
  if (c < 0.7) return T.ui.confidence.mid;
  return T.ui.confidence.high;
}
