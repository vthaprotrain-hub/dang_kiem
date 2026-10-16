/**
 * viewAngleDetector.js — Ước lượng GÓC NHÌN hiện tại của camera so với xe (8 lớp).
 *
 * Kiến trúc 5 lớp, thay thế được từng lớp:
 *   1. COCO-SSD            → có xe không, bbox, confidence            (aiDetector.js)
 *   2. Image features      → tỷ lệ bbox ↔ mô hình hình học của loại xe (file này)
 *   3. Device sensors      → góc quỹ đạo từ movementTracker           (movementTracker.js)
 *   4. Optional classifier → model TF.js phân loại 8 góc (nếu có)      (aiDetector.classifyView)
 *   5. Decision fusion     → nhân xác suất có trọng số theo độ tin cậy của từng nguồn (file này)
 *
 * QUAN TRỌNG: tỷ lệ bbox chỉ phân biệt được "nhìn dọc đầu/đuôi" với "nhìn chéo/ngang" (đối xứng trước↔sau,
 * trái↔phải). Phân biệt cụ thể từng góc phải dựa vào cảm biến hoặc model phân loại. Khi thiếu các nguồn đó,
 * kết quả trả về `needsManualConfirmation = true`.
 *
 * "Đã ước lượng được góc" KHÁC "đã chụp đạt góc": module này không bao giờ đánh dấu hoàn thành góc nào.
 */
import { ANGLES, ANGLE_BY_KEY, CONFIG } from './config.js';
import { vehicleAspect, shapeForType } from './placeholders.js';
import { angleDiff, clamp } from './utils.js';

const N = ANGLES.length;
const EPS = 0.03;

function normalize(arr) {
  const s = arr.reduce((a, b) => a + b, 0) || 1;
  return arr.map((v) => v / s);
}

export class ViewAngleDetector {
  constructor(cfg = CONFIG.angle) {
    this.cfg = cfg;
    this.reset();
  }

  reset() {
    this.post = null;
    this.postAt = 0;
    this.current = null;
    this.currentSince = 0;
  }

  /** Hợp lý hình học: khung bbox quan sát được vs khung kỳ vọng ở mỗi góc. */
  visualLikelihood(vehicle, vehicleType) {
    const shapeId = shapeForType(vehicleType);
    const ones = Array(N).fill(1);
    if (!vehicle?.present || vehicle.stale || !vehicle.aspect || vehicle.areaRatio < 0.03) {
      return { L: ones, reliable: false, aspect: null, expected: null };
    }
    const expected = ANGLES.map((a) => vehicleAspect(shapeId, a.deg));
    const L = expected.map((A) => {
      const z = Math.log(vehicle.aspect / A) / this.cfg.visualSigma;
      return Math.max(EPS, Math.exp(-0.5 * z * z));
    });
    return { L, reliable: true, aspect: vehicle.aspect, expected };
  }

  sensorPrior(sensors) {
    if (!sensors?.usable || sensors.orbitDeg == null) return { P: Array(N).fill(1), w: 0 };
    const sig = this.cfg.sensorSigmaDeg;
    const P = ANGLES.map((a) => {
      const d = angleDiff(sensors.orbitDeg, a.deg) / sig;
      return Math.max(1e-4, Math.exp(-0.5 * d * d));
    });
    return { P, w: clamp(sensors.confidence, 0, 1) };
  }

  /**
   * @param {object} o
   * @param {object} o.vehicle      VehicleInfo từ VehicleTracker (hoặc DEMO, có `source:'demo'`)
   * @param {string} o.vehicleType  id loại xe
   * @param {object} o.sensors      snapshot từ MovementTracker
   * @param {object|null} o.classifier  kết quả classifyView() hoặc null
   * @param {string|null} o.targetKey   góc đang cần chụp
   * @param {number} o.t
   */
  estimate({ vehicle, vehicleType, sensors, classifier = null, targetKey = null, t = Date.now() }) {
    const cfg = this.cfg;
    const vis = this.visualLikelihood(vehicle, vehicleType);
    const sen = this.sensorPrior(sensors);
    const clipPenalty = vehicle?.clipped?.any ? 0.5 : 1;
    const wV = vis.reliable ? cfg.visualWeight * clipPenalty : 0;
    const wS = sen.w;
    const wC = classifier ? cfg.classifierWeight * clamp(classifier.confidence, 0, 1) : 0;

    const evidence = [];
    let predicted = null;
    let confidence = 0;
    let post = null;

    if (wS + wV + wC > 0) {
      const logp = ANGLES.map((_, k) => wS * Math.log(sen.P[k]) + wV * Math.log(vis.L[k]) + (classifier ? wC * Math.log(Math.max(EPS, classifier.probs[k])) : 0));
      const mx = Math.max(...logp);
      post = normalize(logp.map((v) => Math.exp(v - mx)));
      if (this.post && t - this.postAt < 1500) {
        const a = cfg.smoothing;
        post = normalize(post.map((v, k) => a * this.post[k] + (1 - a) * v));
      }
      this.post = post;
      this.postAt = t;

      let best = post.indexOf(Math.max(...post));
      if (this.current != null && best !== this.current && post[best] - post[this.current] < 0.08) best = this.current; // hysteresis
      if (best !== this.current) { this.current = best; this.currentSince = t; }
      predicted = ANGLES[best].key;
      confidence = post[best];
    } else {
      this.post = null;
      this.current = null;
    }

    if (sen.w > 0) evidence.push({ source: 'sensor', weight: +wS.toFixed(2), detail: `Góc quỹ đạo ước lượng ${Math.round(sensors.orbitDeg)}° (độ chắc chắn cảm biến ${Math.round(wS * 100)}%)` });
    if (vis.reliable) {
      const k = predicted ? ANGLE_BY_KEY[predicted].index : 0;
      evidence.push({ source: 'visual', weight: +wV.toFixed(2), detail: `Tỷ lệ khung xe ${vis.aspect.toFixed(2)} (kỳ vọng ${vis.expected[k].toFixed(2)} tại góc ${ANGLES[k].name.toLowerCase()})` });
    }
    if (classifier) evidence.push({ source: 'classifier', weight: +wC.toFixed(2), detail: `Model phân loại: ${classifier.topKey} (${Math.round(classifier.confidence * 100)}%)` });

    const maxL = Math.max(...vis.L);
    const consistency = (k) => (vis.reliable ? vis.L[k] / maxL : 1);
    const predIdx = predicted ? ANGLE_BY_KEY[predicted].index : null;
    const target = targetKey ? ANGLE_BY_KEY[targetKey] : null;

    const deltaToTargetDeg = target && sensors?.usable && sensors.orbitDeg != null ? angleDiff(target.deg, sensors.orbitDeg) : null;
    const visualConsistencyTarget = target ? consistency(target.index) : 1;

    const needsReposition = Boolean(target) && (
      (deltaToTargetDeg != null && Math.abs(deltaToTargetDeg) > cfg.toleranceExitDeg) ||
      (vis.reliable && visualConsistencyTarget < cfg.minVisualConsistency)
    );
    const hasDiscriminatingSource = wS >= 0.35 || wC > 0;
    const needsManualConfirmation = !predicted || confidence < cfg.manualConfirmBelow || !hasDiscriminatingSource;

    return {
      predictedAngle: predicted,
      predictedIndex: predIdx,
      confidence,
      detectionConfidence: vehicle?.score ?? 0,
      sensorConfidence: wS,
      visualConfidence: predIdx != null && vis.reliable ? consistency(predIdx) * clipPenalty : 0,
      classifierConfidence: classifier?.confidence ?? 0,
      angleEvidence: evidence,
      needsReposition,
      needsManualConfirmation,
      orbitDeg: sensors?.usable ? sensors.orbitDeg : null,
      deltaToTargetDeg,
      visualConsistencyTarget,
      visualReliable: vis.reliable,
      posterior: post,
      stableMs: this.current != null ? t - this.currentSince : 0,
      evidenceKinds: evidence.map((e) => e.source),
      source: vehicle?.source ?? 'live',
    };
  }
}

/** Dạng hàm theo đặc tả: estimateCurrentViewAngle(frame, sensorData). */
const shared = new ViewAngleDetector();
export function estimateCurrentViewAngle(frame, sensorData, opts = {}) {
  return shared.estimate({
    vehicle: frame?.vehicle,
    vehicleType: opts.vehicleType ?? 'car',
    sensors: sensorData,
    classifier: opts.classifier ?? null,
    targetKey: opts.targetKey ?? null,
    t: opts.t ?? Date.now(),
  });
}
export const resetViewAngleEstimate = () => shared.reset();
