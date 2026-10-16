/**
 * captureController.js — Luồng "chụp → kiểm tra chất lượng → xác minh góc → lưu".
 *
 * Phân biệt rõ hai khái niệm (yêu cầu cốt lõi của POC):
 *   - "góc được ước lượng"  : ViewAngleDetector đoán người dùng đang ở đâu (chỉ là ước lượng).
 *   - "góc đã chụp đạt"     : ảnh đã chụp + qua kiểm tra chất lượng + góc được xác minh
 *                             (cảm biến+hình ảnh, model phân loại, hoặc khách hàng xác nhận thủ công).
 * Chỉ trường hợp thứ hai mới được ghi vào state.captures với `accepted: true` (nút chuyển xanh).
 *
 * Module này KHÔNG đụng DOM và KHÔNG điều khiển state machine; cameraScreen.js gọi từng bước và gửi sự kiện FSM.
 */
import { ANGLES, ANGLE_BY_KEY, CONFIG } from './config.js';
import { getState, setState, update, acceptedCount } from './appState.js';
import { classifyView, detectStill, getAIInfo } from './aiDetector.js';
import { summarizeStillDetection, validateImageQuality } from './imageQualityValidator.js';
import { deleteCapture, deleteSession, exportSessionMetadata, putCapture, saveCaptureSession } from './captureStore.js';
import { canvasToBlob, log, pad2 } from './utils.js';

/* ----------------------------- tiện ích ----------------------------- */
export function slugify(s, fallback = 'phien-chup') {
  const out = String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .toLowerCase();
  return out || fallback;
}

export function fileNameFor(angleKey) {
  const s = getState();
  const a = ANGLE_BY_KEY[angleKey];
  return `${slugify(s.vehicle.sessionName)}_${pad2(a.index + 1)}-${angleKey}.jpg`;
}

/** Chụp một khung hình đầy đủ (không cắt, không xoay) từ <video> hoặc canvas. */
export function grabFrame(source, maxSide = CONFIG.quality.maxSide) {
  const sw = source.videoWidth || source.width;
  const sh = source.videoHeight || source.height;
  if (!sw || !sh) throw new Error('Chưa có khung hình từ camera.');
  const k = Math.min(1, maxSide / Math.max(sw, sh));
  const w = Math.round(sw * k);
  const hh = Math.round(sh * k);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = hh;
  canvas.getContext('2d').drawImage(source, 0, 0, w, hh);
  return canvas;
}

async function makeThumb(canvas, width = 360) {
  const k = Math.min(1, width / canvas.width);
  const t = document.createElement('canvas');
  t.width = Math.max(1, Math.round(canvas.width * k));
  t.height = Math.max(1, Math.round(canvas.height * k));
  t.getContext('2d').drawImage(canvas, 0, 0, t.width, t.height);
  const blob = await canvasToBlob(t, 'image/jpeg', 0.8);
  t.width = t.height = 0;
  return blob;
}

/* ----------------------------- phân tích ảnh vừa chụp ----------------------------- */
/**
 * @param {object} o
 * @param {HTMLCanvasElement} o.canvas
 * @param {string} o.angleKey
 * @param {'portrait'|'landscape'} o.orientation
 * @param {{nx,ny,nw,nh}|null} o.guideRect
 * @param {boolean} o.steady
 * @param {object|null} o.angleEstimate      kết quả ViewAngleDetector tại thời điểm chụp
 * @param {object|null} [o.demoStill]        DEMO: kết quả "nhận diện" giả lập (đã gắn nhãn DEMO)
 * @param {boolean} [o.demo]
 */
export async function analyzeCapture({ canvas, angleKey, orientation, guideRect, steady, angleEstimate, demoStill = null, demo = false }) {
  const captures = getState().captures;
  const otherHashes = Object.entries(captures)
    .filter(([k, c]) => k !== angleKey && c?.accepted && !c.retake && c.hash)
    .map(([k, c]) => ({ key: k, name: ANGLE_BY_KEY[k].name, hash: c.hash }));

  let stillDetection = null;
  let aiAvailable = false;
  let classifier = null;
  if (demo) {
    stillDetection = demoStill;
    aiAvailable = true;
  } else {
    const info = getAIInfo();
    aiAvailable = info.ready;
    if (info.ready) {
      const det = await detectStill(canvas);
      stillDetection = det.ok ? summarizeStillDetection(det) : null;
      if (!det.ok) aiAvailable = false;
    }
    if (info.hasViewClassifier) classifier = await classifyView(canvas);
  }

  const validation = validateImageQuality(canvas, angleKey, {
    orientation,
    stillDetection,
    aiAvailable,
    guideRect,
    steady,
    stability: null,
    otherHashes,
    classifier,
    angleEstimate,
  });
  return { validation, stillDetection, classifier, aiAvailable };
}

/* ----------------------------- xác minh góc ----------------------------- */
/**
 * Quyết định ảnh đã chụp có thể được gán cho `angleKey` mà không cần khách hàng xác nhận hay không.
 * @returns {{method:'auto'|'classifier'|'manual'|'demo', needsManual:boolean, confidence:number, evidence:object[], reason:string}}
 */
export function decideAngleVerification({ angleKey, estimate, classifier, demo = false, isStart = false, startConfirmation = null }) {
  const evidence = [...(estimate?.angleEvidence ?? [])];
  if (demo) return { method: 'demo', needsManual: false, confidence: estimate?.confidence ?? 0, evidence, reason: 'DEMO — dữ liệu giả lập' };

  if (isStart && startConfirmation) {
    const m = startConfirmation.method;
    evidence.push(...(startConfirmation.evidence ?? []));
    return {
      method: m === 'classifier' ? 'classifier' : 'manual',
      needsManual: false,
      confidence: startConfirmation.confidence ?? 1,
      evidence,
      reason: m === 'classifier' ? 'Model phân loại xác định điểm xuất phát' : 'Khách hàng xác nhận điểm xuất phát (đầu/đuôi xe)',
    };
  }

  if (classifier && classifier.confidence >= 0.6 && classifier.topKey === angleKey) {
    return { method: 'classifier', needsManual: false, confidence: classifier.confidence, evidence, reason: 'Model phân loại góc khớp góc mục tiêu' };
  }

  if (
    estimate && !estimate.needsManualConfirmation && estimate.predictedAngle === angleKey &&
    estimate.sensorConfidence >= 0.35
  ) {
    return { method: 'auto', needsManual: false, confidence: estimate.confidence, evidence, reason: 'Cảm biến và hình ảnh cùng chỉ về góc mục tiêu' };
  }

  const why = !estimate || estimate.sensorConfidence < 0.35
    ? 'Không có cảm biến đủ tin cậy để xác minh góc'
    : estimate.predictedAngle !== angleKey
      ? `Ước lượng góc (${ANGLE_BY_KEY[estimate.predictedAngle]?.name ?? '—'}) chưa khớp góc mục tiêu`
      : 'Độ tin cậy ước lượng góc còn thấp';
  return { method: 'manual', needsManual: true, confidence: estimate?.confidence ?? 0, evidence, reason: why };
}

/* ----------------------------- lưu ảnh ----------------------------- */
/**
 * Ghi ảnh đã đạt vào IndexedDB + state. Chỉ gọi sau khi validation.isValid và đã xác minh góc.
 */
export async function acceptCapture({ angleKey, canvas, validation, verification, orientation, source = 'live', angleEstimate = null, manualConfirmed = false, sensors = null, qualityOverride = null }) {
  const s = getState();
  if (!s.session.id) throw new Error('Chưa có phiên chụp.');
  const blob = await canvasToBlob(canvas, 'image/jpeg', CONFIG.quality.jpegQuality);
  const thumb = await makeThumb(canvas);
  const meta = {
    angleKey,
    accepted: true,
    retake: false,
    fileName: fileNameFor(angleKey),
    capturedAt: Date.now(),
    width: canvas.width,
    height: canvas.height,
    sizeBytes: blob.size,
    screenOrientation: orientation,
    requiredOrientation: ANGLE_BY_KEY[angleKey].orientation,
    hash: validation.hash,
    quality: {
      score: validation.qualityScore,
      isValid: validation.isValid,
      errors: validation.errors,
      warnings: validation.warnings,
      suggestedAction: validation.suggestedAction,
      metrics: validation.metrics,
    },
    verification: verification.method,
    verificationReason: verification.reason,
    manualConfirmed: Boolean(manualConfirmed || verification.method === 'manual'),
    qualityOverride: qualityOverride?.length ? qualityOverride : null, // mã lỗi mà khách hàng chọn bỏ qua (nếu có)
    angle: {
      predicted: angleEstimate?.predictedAngle ?? null,
      confidence: angleEstimate ? +angleEstimate.confidence.toFixed(3) : null,
      sensorConfidence: angleEstimate ? +angleEstimate.sensorConfidence.toFixed(3) : null,
      visualConfidence: angleEstimate ? +angleEstimate.visualConfidence.toFixed(3) : null,
      orbitDeg: sensors?.orbitDeg != null ? Math.round(sensors.orbitDeg) : null,
      evidence: verification.evidence,
    },
    source, // 'live' | 'demo'
  };
  await putCapture(s.session.id, angleKey, blob, meta, thumb);
  setState({ captures: { ...getState().captures, [angleKey]: meta } });
  await persistSession();
  log.info(`Đã lưu ${angleKey} (${verification.method}, điểm ${validation.qualityScore})`);
  return meta;
}

/* ----------------------------- chụp lại / xóa ----------------------------- */
/** Đánh dấu một góc cần chụp lại. Ảnh cũ chỉ bị thay khi ảnh mới được chấp nhận. */
export function markRetake(angleKey) {
  const s = getState();
  const old = s.captures[angleKey];
  setState({
    captures: { ...s.captures, [angleKey]: { ...(old ?? { angleKey, accepted: false }), retake: true } },
    retakeKey: angleKey,
    completed: false,
  });
}

/** Hủy chụp lại: giữ nguyên ảnh cũ. */
export function cancelRetake() {
  const s = getState();
  const k = s.retakeKey;
  if (!k) return;
  const c = s.captures[k];
  const captures = { ...s.captures };
  if (c?.fileName) captures[k] = { ...c, retake: false };
  else delete captures[k];
  setState({ captures, retakeKey: null, completed: acceptedCount({ captures }) >= 8 });
}

export function finishRetake() {
  setState({ retakeKey: null });
}

export async function deleteAngle(angleKey) {
  const s = getState();
  if (s.session.id) await deleteCapture(s.session.id, angleKey);
  const captures = { ...s.captures };
  delete captures[angleKey];
  setState({ captures, completed: false, retakeKey: s.retakeKey === angleKey ? null : s.retakeKey });
  update('session', { status: 'in_progress' });
  await persistSession();
}

export async function completeSession() {
  update('session', { status: 'completed' });
  setState({ completed: true, retakeKey: null });
  await persistSession();
}

/** Xóa toàn bộ dữ liệu của phiên hiện tại khỏi thiết bị. */
export async function wipeCurrentSession() {
  const id = getState().session.id;
  if (id) await deleteSession(id);
}

/* ----------------------------- phiên ----------------------------- */
export function buildSessionMeta() {
  const s = getState();
  return {
    id: s.session.id,
    name: s.vehicle.sessionName,
    createdAt: s.session.createdAt,
    mode: s.settings.mode,
    vehicleType: s.vehicle.type,
    plate: s.vehicle.plate,
    startIndex: s.session.startIndex,
    startConfirmation: s.session.startConfirmation,
    ocr: s.session.ocr,
  };
}

export function buildExportJson() {
  return exportSessionMetadata(buildSessionMeta(), getState().captures);
}

export async function persistSession() {
  const s = getState();
  if (!s.session.id) return null;
  const count = acceptedCount(s);
  return saveCaptureSession({
    id: s.session.id,
    name: s.vehicle.sessionName,
    vehicleType: s.vehicle.type,
    plate: s.vehicle.plate,
    createdAt: s.session.createdAt,
    status: count >= 8 ? 'completed' : s.session.status,
    startIndex: s.session.startIndex,
    startConfirmation: s.session.startConfirmation,
    ocr: s.session.ocr,
    mode: s.settings.mode,
    acceptedCount: count,
  });
}

export { ANGLES };
