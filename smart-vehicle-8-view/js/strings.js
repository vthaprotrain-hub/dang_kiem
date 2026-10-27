/**
 * strings.js — Toàn bộ văn bản hiển thị / đọc giọng nói (tiếng Việt).
 * Tách riêng để dễ rà soát nội dung và đa ngôn ngữ về sau.
 */
import { ANGLE_BY_KEY } from './config.js';

export const angleName = (key) => ANGLE_BY_KEY[key]?.name ?? key;
export const lc = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
/** Số bước bằng chữ để giọng đọc tự nhiên. */
export const stepWord = (n) => ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín', 'mười'][n] ?? String(n);

export const T = {
  guidance: {
    findingVehicle: 'Đang tìm xe trong khung hình…',
    vehicleDetectedFit: 'Đã phát hiện xe. Vui lòng đưa toàn bộ xe vào khung.',
    vehicleDetectedHold: 'Đã phát hiện xe. Giữ yên điện thoại một chút…',
    identifyingStart: 'Đang xác định đầu xe…',
    confirmStart: 'Hãy xác nhận đây là đầu xe để bắt đầu.',
    startFromFront: 'Hãy bắt đầu từ phía đầu xe.',
    startFromSide: 'Hãy đứng chính diện đầu xe hoặc đuôi xe, hoặc bấm nút chụp để tự xác nhận.',
    calibrateRetake: (name) => `Hãy đứng tại góc ${lc(name)} rồi xác nhận vị trí.`,
    holdSteady: 'Đúng vị trí — giữ máy vững rồi bấm chụp.',
    readyStart: (name) => `Giữ máy vững để chụp ${lc(name)}.`,
    approach: (name) => `Sắp tới ${lc(name)} — đi chậm lại.`,
    scanning: 'Đang kiểm tra xe trong khung…',
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
    accepted: 'Ảnh đạt! Sang góc tiếp theo nhé.',
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
    completed: 'Tuyệt vời! Bạn đã chụp đủ tám góc xe. Cảm ơn bạn nhé.',
    accepted: 'Ảnh đẹp rồi! Mình sang góc tiếp theo nhé.',
  },

  /**
   * Câu ĐỌC (giọng nói) — mềm và thân thiện hơn chữ hiển thị. Màn hình cần ngắn gọn để liếc nhanh;
   * giọng đọc cần tự nhiên, có "nhé", tránh giọng ra lệnh.
   */
  say: {
    findVehicle: 'Bạn hướng camera về phía chiếc xe nhé.',
    fitVehicle: 'Bạn đưa cả chiếc xe vào trong khung nhé.',
    startSide: 'Bạn đứng chính diện đầu xe hoặc đuôi xe để bắt đầu nhé. Hoặc bấm nút chụp để tự xác nhận.',
    confirmStart: 'Bạn xác nhận giúp mình đây là đầu xe hay đuôi xe nhé.',
    calibrate: (name) => `Bạn đứng ở ${lc(name)} rồi xác nhận vị trí nhé.`,
    move: (name, steps) => {
      const to = / xe$/i.test(name) ? lc(name) : `phía ${lc(name)} của xe`;
      return steps ? `Mời bạn đi sang trái, tới ${to}, khoảng ${stepWord(steps)} bước nhé.` : `Mời bạn đi chậm sang trái, vòng tới ${to} nhé.`;
    },
    moveFree: (name) => `Bạn di chuyển tới ${lc(name)} nhé.`,
    stepsLeft: (steps) => `Còn khoảng ${stepWord(steps)} bước nữa.`,
    approach: 'Sắp tới rồi, bạn đi chậm lại nhé.',
    slowDown: 'Bạn đi chậm lại một chút nhé.',
    ready: 'Đúng vị trí rồi. Bạn giữ máy thật vững rồi bấm chụp nhé.',
    readyStart: (name) => `Tốt lắm. Bạn giữ máy thật vững rồi chụp ${lc(name)} nhé.`,
    manual: (name) => `Bạn di chuyển tới ${lc(name)}, rồi bấm chụp nhé.`,
    wrongDirection: 'Hình như bạn đang đi ngược chiều. Bạn quay lại, đi sang bên trái nhé.',
    overshoot: 'Bạn đi hơi quá rồi, lùi lại một chút nhé.',
    rotateLandscape: 'Bạn xoay ngang điện thoại giúp mình nhé.',
    rotatePortrait: 'Bạn xoay dọc điện thoại giúp mình nhé.',
    lost: 'Mình chưa thấy xe. Bạn hướng camera về phía xe nhé.',
    stepBack: 'Bạn lùi ra sau một chút để thấy trọn chiếc xe nhé.',
    stepCloser: 'Bạn tiến lại gần xe thêm một chút nhé.',
    multi: 'Có nhiều xe trong khung. Bạn chạm vào đúng chiếc xe cần chụp nhé.',
    angleOff: 'Gần đúng rồi, bạn nhích thêm một chút nữa nhé.',
    rejected: (reason) => `Ảnh chưa đạt. ${reason ? `${reason} ` : ''}Bạn chụp lại giúp mình nhé.`,
    dirOk: 'Đúng hướng rồi, bạn đi tiếp nhé.',
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
