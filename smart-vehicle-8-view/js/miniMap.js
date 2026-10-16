/**
 * miniMap.js — Bản đồ 8 góc quanh xe (nhìn từ trên xuống, đầu xe ở phía trên).
 *
 * Màu nút = trạng thái THẬT của từng góc:
 *   xám = chưa chụp · trắng viền đậm = góc mục tiêu · vàng = đang phân tích ·
 *   xanh = đã chụp + đạt chất lượng + đã xác nhận góc · đỏ = cần chụp lại.
 * Chấm người dùng chỉ là ƯỚC LƯỢNG (cảm biến + hình ảnh) — độ tin cậy được hiển thị riêng; không bao giờ
 * làm một nút chuyển xanh.
 */
import { ANGLES, ANGLE_BY_KEY, VEHICLE_SHAPES } from './config.js';
import { T } from './strings.js';
import { svg, h, wrap180, clearNode, clamp } from './utils.js';

const CX = 100;
const CY = 105;
const RING = { rx: 70, ry: 82 };
const USER_RING = { rx: 88, ry: 96 };
const NODE_R = 13;
const RAD = Math.PI / 180;

const ringPoint = (deg, ring = RING) => [CX + ring.rx * Math.sin(deg * RAD), CY - ring.ry * Math.cos(deg * RAD)];

function carPath(cx, cy, w, hgt) {
  const x0 = cx - w / 2; const x1 = cx + w / 2;
  const y0 = cy - hgt / 2; const y1 = cy + hgt / 2;
  const r = Math.min(w * 0.36, 12);
  const f = Math.min(w * 0.55, 20);
  return `M${x0},${y0 + f} Q${x0},${y0} ${cx - w * 0.2},${y0} L${cx + w * 0.2},${y0} Q${x1},${y0} ${x1},${y0 + f} L${x1},${y1 - r} Q${x1},${y1} ${x1 - r},${y1} L${x0 + r},${y1} Q${x0},${y1} ${x0},${y1 - r} Z`;
}

/** Hình xe nhìn từ trên xuống, tỷ lệ theo loại xe. */
function buildCar(shapeId) {
  const s = VEHICLE_SHAPES[shapeId] ?? VEHICLE_SHAPES.sedan;
  const scale = Math.min(112 / s.L, 54 / s.W);
  const w = s.W * scale;
  const hgt = s.L * scale;
  const g = svg('g', { class: 'mm-car-group' });
  g.append(svg('path', { class: 'mm-car', d: carPath(CX, CY, w, hgt) }));
  const top = CY - hgt / 2;
  const hh = (a, b) => top + hgt * a + (hgt * (b - a)) / 2; // tâm
  if (s.kind === 'truck' || s.kind === 'bus') {
    // buồng lái ở phía trước, thùng/khoang phía sau
    g.append(svg('rect', { class: 'mm-car-glass', x: CX - w * 0.36, y: top + hgt * 0.06, width: w * 0.72, height: hgt * 0.1, rx: 2 }));
    g.append(svg('rect', { class: 'mm-car-detail', x: CX - w * 0.4, y: top + hgt * 0.22, width: w * 0.8, height: hgt * 0.7, rx: 2 }));
  } else {
    g.append(svg('path', { class: 'mm-car-glass', d: `M${CX - w * 0.36},${top + hgt * 0.3} L${CX + w * 0.36},${top + hgt * 0.3} L${CX + w * 0.4},${top + hgt * 0.4} L${CX - w * 0.4},${top + hgt * 0.4} Z` }));
    g.append(svg('path', { class: 'mm-car-glass', d: `M${CX - w * 0.38},${top + hgt * 0.74} L${CX + w * 0.38},${top + hgt * 0.74} L${CX + w * 0.34},${top + hgt * 0.83} L${CX - w * 0.34},${top + hgt * 0.83} Z` }));
    g.append(svg('rect', { class: 'mm-car-detail', x: CX - w * 0.32, y: top + hgt * 0.42, width: w * 0.64, height: hgt * 0.3, rx: 3 }));
  }
  // bánh xe
  for (const fy of [0.2, 0.78]) {
    for (const sx of [-1, 1]) {
      g.append(svg('rect', { class: 'mm-car-detail', x: CX + sx * (w / 2) - (sx > 0 ? 0 : 3), y: hh(fy - 0.07, fy + 0.07) - 6, width: 3, height: 12, rx: 1 }));
    }
  }
  // đầu xe: hai đèn pha
  for (const sx of [-1, 1]) g.append(svg('circle', { class: 'mm-front-mark', cx: CX + sx * w * 0.28, cy: top + 3.5, r: 2.4 }));
  return g;
}

/** Cung ellipse đi theo chiều kim đồng hồ (dir=1) hoặc ngược (dir=-1) từ `from` đến `to`. */
function arcPoints(from, to, dir = 1, ring = RING) {
  let span = dir > 0 ? ((to - from) % 360 + 360) % 360 : ((from - to) % 360 + 360) % 360;
  if (span < 0.01) span = 0;
  const n = Math.max(2, Math.ceil(span / 5));
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push(ringPoint(from + dir * (span * i) / n, ring));
  return { pts, span };
}
const toD = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');

/* ====================================================================== */
export class MiniMap {
  /**
   * @param {SVGSVGElement} el
   * @param {{onSelect?:(key:string)=>void}} [o]
   */
  constructor(el, { onSelect } = {}) {
    this.el = el;
    this.onSelect = onSelect;
    this.nodes = new Map();
    this.userCur = null;
    this.userTarget = null;
    this.raf = 0;
    this.shape = null;
    this._build();
  }

  _build() {
    clearNode(this.el);
    this.carHost = svg('g', {});
    this.el.append(
      svg('ellipse', { class: 'mm-ring', cx: CX, cy: CY, rx: RING.rx, ry: RING.ry }),
      this.carHost,
    );
    this.flow = svg('path', { class: 'mm-flow', d: '' });
    this.flow.setAttribute('visibility', 'hidden');
    this.el.append(this.flow);

    for (const a of ANGLES) {
      const [x, y] = ringPoint(a.deg);
      const g = svg('g', { class: 'mm-node', transform: `translate(${x.toFixed(1)},${y.toFixed(1)})`, 'data-key': a.key, 'data-status': 'pending', role: 'button', tabindex: '0' });
      const title = svg('title', {});
      const pulse = svg('circle', { class: 'mm-pulse', r: NODE_R });
      const base = svg('circle', { class: 'base', r: NODE_R });
      const num = svg('text', { class: 'num' });
      g.append(title, pulse, base, num);
      const select = () => this.onSelect?.(a.key);
      g.addEventListener('click', select);
      g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(); } });
      this.el.append(g);
      this.nodes.set(a.key, { g, title, num });
    }

    this.user = svg('g', { class: 'mm-user', 'data-conf': 'none' });
    this.user.style.transition = 'none';
    this.user.append(
      svg('path', { class: 'u-cone', d: 'M0,0 L-10,24 Q0,30 10,24 Z' }),
      svg('circle', { class: 'u-dot', r: 6 }),
    );
    this.user.setAttribute('visibility', 'hidden');
    this.el.append(this.user);
    this.setShape('sedan');
  }

  setShape(shapeId) {
    if (this.shape === shapeId) return;
    this.shape = shapeId;
    clearNode(this.carHost);
    this.carHost.append(buildCar(shapeId));
  }

  /**
   * @param {object} s
   * @param {string[]} s.order              thứ tự chụp (bắt đầu từ góc xuất phát)
   * @param {Record<string,object>} s.captures
   * @param {string|null} s.target
   * @param {string|null} [s.analyzing]
   * @param {number|null} [s.userDeg]       góc quỹ đạo ước lượng
   * @param {number} [s.userConf]           0–1
   * @param {{from:number,to:number,dir?:1|-1}|null} [s.flow]
   */
  render({ order, captures, target, analyzing = null, userDeg = null, userConf = 0, flow = null }) {
    for (const a of ANGLES) {
      const n = this.nodes.get(a.key);
      const c = captures[a.key];
      let status = 'pending';
      if (c?.retake) status = 'retake';
      else if (c?.accepted) status = 'accepted';
      else if (analyzing === a.key) status = 'analyzing';
      else if (target === a.key) status = 'target';
      if (analyzing === a.key && status !== 'accepted') status = 'analyzing';
      if (n.g.dataset.status !== status) n.g.dataset.status = status;
      const seq = order.indexOf(a.key) + 1;
      const label = status === 'accepted' ? '✓' : String(seq);
      if (n.num.textContent !== label) n.num.textContent = label;
      const title = `${seq}. ${a.name} — ${T.ui.angleStatus[status]}`;
      if (n.title.textContent !== title) {
        n.title.textContent = title;
        n.g.setAttribute('aria-label', title);
      }
    }

    // mũi tên dòng chảy theo chiều kim đồng hồ tới góc mục tiêu
    if (flow && flow.from != null && flow.to != null) {
      const { pts, span } = arcPoints(flow.from, flow.to, flow.dir ?? 1);
      if (span > 8 && span < 330) {
        this.flow.setAttribute('d', toD(pts));
        this.flow.setAttribute('visibility', 'visible');
      } else this.flow.setAttribute('visibility', 'hidden');
    } else this.flow.setAttribute('visibility', 'hidden');

    this.setUser(userDeg, userConf);
  }

  setUser(deg, conf = 0) {
    if (deg == null || Number.isNaN(deg)) {
      this.user.setAttribute('visibility', 'hidden');
      this.userCur = null;
      this.userTarget = null;
      return;
    }
    const level = conf >= 0.7 ? 'high' : conf >= 0.45 ? 'mid' : conf > 0 ? 'low' : 'none';
    if (this.user.dataset.conf !== level) this.user.dataset.conf = level;
    this.user.setAttribute('visibility', 'visible');
    if (this.userCur == null) {
      this.userCur = deg;
      this.userTarget = deg;
      this._place();
      return;
    }
    this.userTarget = deg;
    if (!this.raf) this.raf = requestAnimationFrame(() => this._step());
  }

  _step() {
    this.raf = 0;
    if (this.userCur == null || this.userTarget == null) return;
    const d = wrap180(this.userTarget - this.userCur);
    if (Math.abs(d) < 0.25) {
      this.userCur = this.userTarget;
      this._place();
      return;
    }
    this.userCur += d * 0.24;
    this._place();
    this.raf = requestAnimationFrame(() => this._step());
  }

  _place() {
    const [x, y] = ringPoint(this.userCur, USER_RING);
    this.user.setAttribute('transform', `translate(${x.toFixed(1)},${y.toFixed(1)}) rotate(${this.userCur.toFixed(1)})`);
  }

  destroy() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }
}

/* ====================================================================== */
/* Sơ đồ tĩnh ở màn hình 1                                                */
/* ====================================================================== */
export function renderRingGuide(host, legendEl, shapeId = 'sedan') {
  clearNode(host);
  const s = svg('svg', { viewBox: '0 0 200 210', xmlns: 'http://www.w3.org/2000/svg', role: 'img' });
  s.append(
    svg('ellipse', { class: 'mm-ring', cx: CX, cy: CY, rx: RING.rx, ry: RING.ry }),
    buildCar(shapeId),
  );
  // cung chiều kim đồng hồ + đầu mũi tên giữa góc 1 → 2
  const { pts } = arcPoints(12, 33, 1);
  s.append(svg('path', { class: 'mm-flow', d: toD(pts) }));
  const [ax, ay] = ringPoint(33);
  const [bx, by] = ringPoint(40);
  const ang = Math.atan2(by - ay, bx - ax);
  const hx = ax + Math.cos(ang) * 6;
  const hy = ay + Math.sin(ang) * 6;
  s.append(svg('path', { class: 'mm-flow-head', d: `M${hx.toFixed(1)},${hy.toFixed(1)} L${(hx - Math.cos(ang - 0.5) * 9).toFixed(1)},${(hy - Math.sin(ang - 0.5) * 9).toFixed(1)} L${(hx - Math.cos(ang + 0.5) * 9).toFixed(1)},${(hy - Math.sin(ang + 0.5) * 9).toFixed(1)} Z` }));
  ANGLES.forEach((a, i) => {
    const [x, y] = ringPoint(a.deg);
    const g = svg('g', { class: 'mm-node', transform: `translate(${x.toFixed(1)},${y.toFixed(1)})`, 'data-status': i === 0 ? 'target' : 'pending' });
    g.append(svg('circle', { class: 'base', r: NODE_R }), svg('text', { class: 'num' }, String(i + 1)));
    g.style.cursor = 'default';
    s.append(g);
  });
  host.append(s);

  if (legendEl) {
    clearNode(legendEl);
    ANGLES.forEach((a, i) => {
      legendEl.append(h('li', {}, h('span', { class: 'n', text: String(i + 1) }), a.name, h('span', { class: 'o', text: a.orientation === 'portrait' ? 'dọc' : 'ngang' })));
    });
  }
}

export { ANGLE_BY_KEY, clamp };
