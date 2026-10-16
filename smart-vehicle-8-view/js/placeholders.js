/**
 * placeholders.js — Sinh khung hướng dẫn xe (SVG wireframe) cho 9 loại xe × 8 góc.
 *
 * Thay vì vẽ tay 72 hình, module dựng một mô hình 3D "low-poly" tham số hóa (thân xe, cabin, bánh xe,
 * kính, đèn, gương, biển số) rồi chiếu trực giao theo góc nhìn (azimuth 0°/45°/…/315°) có loại bỏ mặt khuất.
 * Nhờ vậy 8 góc luôn nhất quán về hình học và mỗi loại xe tự có tỷ lệ riêng.
 *
 * Các khung CHỈ là placeholder minh họa bố cục — không mô tả chính xác từng mẫu xe ngoài thực tế.
 *
 * Quy ước: x = về phía đầu xe, y = bên TRÁI xe, z = lên trên; azimuth tính theo chiều kim đồng hồ nhìn từ trên
 * xuống, 0° = người xem đứng trước đầu xe, 90° = đứng bên phải xe.
 */
import { ANGLE_BY_KEY, VEHICLE_SHAPES, VEHICLE_TYPE_BY_ID } from './config.js';
import { DEG } from './utils.js';

/* =============================== hình học 3D =============================== */
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const centroid = (pts) => mul(pts.reduce((s, p) => add(s, p), [0, 0, 0]), 1 / pts.length);

function makeSolid(faceDefs) {
  const all = faceDefs.flatMap((f) => f.pts);
  const c = centroid(all);
  const faces = faceDefs.map((f) => {
    let n = norm(cross(sub(f.pts[1], f.pts[0]), sub(f.pts[2], f.pts[0])));
    if (dot(n, sub(centroid(f.pts), c)) < 0) n = mul(n, -1);
    return { ...f, n };
  });
  return { faces };
}

function box(x0, x1, y0, y1, z0, z1) {
  const p = (x, y, z) => [x, y, z];
  const a = [p(x0, y0, z0), p(x1, y0, z0), p(x1, y1, z0), p(x0, y1, z0)];
  const b = [p(x0, y0, z1), p(x1, y0, z1), p(x1, y1, z1), p(x0, y1, z1)];
  return makeSolid([
    { pts: a }, { pts: b },
    { pts: [a[0], a[1], b[1], b[0]] }, { pts: [a[1], a[2], b[2], b[1]] },
    { pts: [a[2], a[3], b[3], b[2]] }, { pts: [a[3], a[0], b[0], b[3]] },
  ]);
}

/** Lăng trụ từ profile lồi (x,z) kéo dọc trục y một khoảng ±hw. */
function prism(profile, hw) {
  const L = profile.map(([x, z]) => [x, hw, z]);
  const R = profile.map(([x, z]) => [x, -hw, z]);
  const faces = [{ pts: L }, { pts: R.slice().reverse() }];
  for (let i = 0; i < profile.length; i++) {
    const j = (i + 1) % profile.length;
    faces.push({ pts: [L[i], L[j], R[j], R[i]] });
  }
  return makeSolid(faces);
}

/** Cabin dạng chóp cụt: đáy ở z = zb, đỉnh ở z = zt. Bốn mặt xung quanh là kính. */
function frustum(zb, zt, bx, tx, bhw, thw) {
  const b = [[bx[0], bhw, zb], [bx[1], bhw, zb], [bx[1], -bhw, zb], [bx[0], -bhw, zb]];
  const t = [[tx[0], thw, zt], [tx[1], thw, zt], [tx[1], -thw, zt], [tx[0], -thw, zt]];
  return makeSolid([
    { pts: [b[1], b[2], t[2], t[1]], glass: 'front' },
    { pts: [b[0], b[3], t[3], t[0]], glass: 'rear' },
    { pts: [b[0], b[1], t[1], t[0]], glass: 'side' },
    { pts: [b[3], b[2], t[2], t[3]], glass: 'side' },
    { pts: t }, { pts: b },
  ]);
}

/* =============================== dựng mô hình xe =============================== */
const modelCache = new Map();

function rectOnPlane(plane, a0, a1, b0, b1, off = 0.004) {
  // plane: 'x+', 'x-' => (y,z) ; 'y+', 'y-' => (x,z) ; 'z+' => (x,y)
  switch (plane.axis) {
    case 'x': { const x = plane.v + (plane.sign > 0 ? off : -off); return [[x, a0, b0], [x, a1, b0], [x, a1, b1], [x, a0, b1]]; }
    case 'y': { const y = plane.v + (plane.sign > 0 ? off : -off); return [[a0, y, b0], [a1, y, b0], [a1, y, b1], [a0, y, b1]]; }
    default: { const z = plane.v + off; return [[a0, b0, z], [a1, b0, z], [a1, b1, z], [a0, b1, z]]; }
  }
}

function buildModel(shapeId) {
  if (modelCache.has(shapeId)) return modelCache.get(shapeId);
  const s = VEHICLE_SHAPES[shapeId];
  const hw = s.W / 2;
  const solids = [];
  const deco = []; // { kind, pts, closed, n, fill }
  const wheels = [];

  const frontX = s.kind === 'truck' ? s.cabin.bx[1] : s.L / 2;
  const rearX = -s.L / 2;
  let cabinSolid;

  if (s.kind === 'truck') {
    solids.push(prism([[s.L / 2, s.c], [s.L / 2, s.chassisTop], [-s.L / 2, s.chassisTop], [-s.L / 2, s.c]], hw));
    cabinSolid = frustum(s.cabin.z[0], s.cabin.z[1], s.cabin.bx, s.cabin.tx, hw * s.cabin.bw, hw * s.cabin.tw);
    solids.push(cabinSolid);
    const cw = hw * s.cargo.w;
    solids.push(box(s.cargo.x[0], s.cargo.x[1], -cw, cw, s.cargo.z[0], s.cargo.z[1]));
    // gân thùng hàng + khe cửa sau
    for (let i = 1; i <= 4; i++) {
      const x = s.cargo.x[0] + ((s.cargo.x[1] - s.cargo.x[0]) * i) / 5;
      for (const sg of [1, -1]) deco.push({ kind: 'detail', pts: [[x, sg * (cw + 0.004), s.cargo.z[0] + 0.15], [x, sg * (cw + 0.004), s.cargo.z[1] - 0.15]], n: [0, sg, 0] });
    }
    deco.push({ kind: 'detail', pts: [[s.cargo.x[0] - 0.004, 0, s.cargo.z[0] + 0.1], [s.cargo.x[0] - 0.004, 0, s.cargo.z[1] - 0.1]], n: [-1, 0, 0] });
  } else if (s.kind === 'bus') {
    solids.push(prism([[s.L / 2, s.c], [s.L / 2, s.chassisTop], [-s.L / 2, s.chassisTop], [-s.L / 2, s.c]], hw));
    cabinSolid = frustum(s.cabin.z[0], s.cabin.z[1], s.cabin.bx, s.cabin.tx, hw * s.cabin.bw, hw * s.cabin.tw);
    solids.push(cabinSolid);
  } else {
    const bx = s.cabin.bx;
    solids.push(prism([[s.L / 2, s.c], [s.L / 2, s.hood], [bx[1], s.belt], [bx[0], s.belt], [-s.L / 2, s.rear], [-s.L / 2, s.c]], hw));
    cabinSolid = frustum(s.belt, s.H, bx, s.cabin.tx, hw * s.cabin.bw, hw * s.cabin.tw);
    solids.push(cabinSolid);
    if (s.bed) {
      deco.push({
        kind: 'detail', closed: true, n: [0, 0, 1],
        pts: rectOnPlane({ axis: 'z', v: s.belt, sign: 1 }, s.bed.x[0] + 0.08, s.bed.x[1] - 0.04, -(hw - 0.12), hw - 0.12),
      });
    }
    // đường khe cửa trên thân (2 bên)
    const seams = [bx[1] - 0.12, (bx[0] + bx[1]) / 2, bx[0] + 0.12];
    for (const sg of [1, -1]) {
      for (const x of seams) deco.push({ kind: 'detail', pts: [[x, sg * (hw + 0.004), s.c + 0.2], [x, sg * (hw + 0.004), s.belt]], n: [0, sg, 0] });
    }
  }

  /* gương chiếu hậu */
  const mx = s.kind === 'truck' ? s.cabin.bx[1] - 0.2 : s.kind === 'bus' ? s.cabin.bx[1] - 0.15 : s.cabin.bx[1] - 0.1;
  const my = hw * s.cabin.bw;
  const mr = s.kind === 'truck' || s.kind === 'bus' ? 0.12 : 0.085;
  for (const sg of [1, -1]) {
    solids.push(box(mx - mr, mx + mr, sg > 0 ? my : -my - 0.2, sg > 0 ? my + 0.2 : -my, s.mirrorZ - mr * 1.2, s.mirrorZ + mr * 1.2));
  }

  /* đèn, lưới tản nhiệt, biển số — mặt trước & mặt sau */
  const lz0 = s.lightZ - 0.13;
  const lz1 = s.lightZ + 0.01;
  const lw = s.kind === 'car' || s.kind === 'pickup' ? hw : hw * 0.92;
  for (const sg of [1, -1]) {
    deco.push({ kind: 'light', closed: true, n: [1, 0, 0], pts: rectOnPlane({ axis: 'x', v: frontX, sign: 1 }, sg * lw * 0.58, sg * lw * 0.93, lz0, lz1) });
    deco.push({ kind: 'tail', closed: true, n: [-1, 0, 0], pts: rectOnPlane({ axis: 'x', v: rearX, sign: -1 }, sg * lw * 0.58, sg * lw * 0.93, lz0, lz1) });
  }
  const gz = s.c + 0.3;
  deco.push({ kind: 'detail', closed: true, n: [1, 0, 0], pts: rectOnPlane({ axis: 'x', v: frontX, sign: 1 }, -hw * 0.34, hw * 0.34, gz, gz + 0.18) });
  const pz = s.c + (s.kind === 'car' || s.kind === 'pickup' ? 0.08 : 0.12);
  deco.push({ kind: 'plate', closed: true, n: [1, 0, 0], pts: rectOnPlane({ axis: 'x', v: frontX, sign: 1 }, -0.26, 0.26, pz, pz + 0.13) });
  deco.push({ kind: 'plate', closed: true, n: [-1, 0, 0], pts: rectOnPlane({ axis: 'x', v: rearX, sign: -1 }, -0.26, 0.26, pz + (s.kind === 'truck' || s.kind === 'bus' ? 0 : 0.04), pz + 0.13 + (s.kind === 'truck' || s.kind === 'bus' ? 0 : 0.04)) });

  /* bánh xe */
  const over = (s.L - s.wb) * 0.45;
  const xf = s.L / 2 - over;
  const xr = xf - s.wb;
  const tw = s.kind === 'truck' || s.kind === 'bus' ? 0.3 : 0.22;
  for (const [axle, x] of [['F', xf], ['R', xr]]) {
    for (const [side, sg] of [['L', 1], ['R', -1]]) {
      wheels.push({ axle, side, sg, x, r: s.wr, yOuter: sg * (hw - 0.03), yInner: sg * (hw - 0.03 - tw) });
    }
  }

  /* kính: chuẩn bị đa giác thụt vào */
  const glass = [];
  for (const f of cabinSolid.faces.filter((fc) => fc.glass)) {
    const c = centroid(f.pts);
    const k = s.glassInset;
    const poly = f.pts.map((p) => add(c, mul(sub(p, c), k)));
    glass.push({ pts: poly, n: f.n });
    // trụ kính
    const pillars = s.kind === 'bus' && f.glass === 'side' ? 5 : s.kind === 'car' && f.glass === 'side' ? 1 : s.kind === 'pickup' && f.glass === 'side' ? 1 : 0;
    for (let i = 1; i <= pillars; i++) {
      const t = i / (pillars + 1);
      const bot = add(poly[0], mul(sub(poly[1], poly[0]), t));
      const top = add(poly[3], mul(sub(poly[2], poly[3]), t));
      deco.push({ kind: 'detail', pts: [bot, top], n: f.n });
    }
  }

  const model = { shape: s, solids, deco, wheels, glass };
  modelCache.set(shapeId, model);
  return model;
}

/* =============================== chiếu & loại mặt khuất =============================== */
function makeProjector(azDeg, elevDeg) {
  const a = azDeg * DEG;
  const e = elevDeg * DEG;
  const c = Math.cos(a);
  const sn = Math.sin(a);
  const ce = Math.cos(e);
  const se = Math.sin(e);
  const toCam = [c * ce, -sn * ce, se];
  const project = (p) => {
    const sx = p[0] * sn + p[1] * c;           // trục phải của màn hình
    const depth = -p[0] * c + p[1] * sn;        // khoảng cách xa dần theo hướng nhìn
    const sy = p[2] * ce + depth * se;          // camera nhìn hơi từ trên xuống
    return [sx, -sy];
  };
  return { toCam, project, c, sn };
}

function convexHull(points) {
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cr(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cr(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

const projCache = new Map();

/**
 * Chiếu mô hình theo azimuth/elevation.
 * @returns {{groups:Record<string, {segs:number[][][], polys:number[][][]}>, bounds:{minX,maxX,minY,maxY,w,h}, solidBounds}}
 */
export function getProjected(shapeId, azDeg, elevDeg = 10) {
  const key = `${shapeId}|${azDeg}|${elevDeg}`;
  if (projCache.has(key)) return projCache.get(key);
  const m = buildModel(shapeId);
  const { toCam, project, c, sn } = makeProjector(azDeg, elevDeg);
  const groups = {};
  const grp = (k) => (groups[k] ??= { segs: [], polys: [] });
  const edgeSeen = new Set();
  const k3 = (p) => `${p[0].toFixed(3)},${p[1].toFixed(3)},${p[2].toFixed(3)}`;
  const solidPts = [];

  // 1) cạnh của các mặt nhìn thấy (mỗi cạnh vẽ một lần)
  for (const solid of m.solids) {
    for (const f of solid.faces) {
      if (dot(f.n, toCam) <= 0.02) continue;
      for (let i = 0; i < f.pts.length; i++) {
        const p = f.pts[i];
        const q = f.pts[(i + 1) % f.pts.length];
        const a = k3(p);
        const b = k3(q);
        const ek = a < b ? `${a}|${b}` : `${b}|${a}`;
        if (edgeSeen.has(ek)) continue;
        edgeSeen.add(ek);
        grp('body').segs.push([project(p), project(q)]);
      }
      for (const p of f.pts) solidPts.push(project(p));
    }
  }
  // 2) kính (chỉ mặt hướng về camera)
  for (const g of m.glass) {
    if (dot(g.n, toCam) <= 0.04) continue;
    grp('glass').polys.push(g.pts.map(project));
  }
  // 3) chi tiết (đèn, biển số, khe cửa…)
  for (const d of m.deco) {
    if (dot(d.n, toCam) <= 0.05) continue;
    const pts = d.pts.map(project);
    if (d.closed) grp(d.kind).polys.push(pts);
    else grp(d.kind).segs.push(pts);
  }
  // 4) bánh xe + vòm bánh
  const sh = m.shape;
  const hw = sh.W / 2;
  for (const w of m.wheels) {
    const sd = dot([0, w.sg, 0], toCam);
    const nearAxle = (w.axle === 'F') === (c > 0);
    const sideVisible = sd > 0.12;
    const endVisible = Math.abs(sn) < 0.35 && nearAxle;
    if (!sideVisible && !endVisible) continue;
    const ring = (y, r) => Array.from({ length: 28 }, (_, i) => {
      const t = (i / 28) * Math.PI * 2;
      return project([w.x + Math.cos(t) * r, y, w.r + Math.sin(t) * r]);
    });
    const hull = convexHull([...ring(w.yOuter, w.r), ...ring(w.yInner, w.r)]);
    grp('wheel').polys.push(hull);
    if (sideVisible) {
      grp('wheel').polys.push(ring(w.yOuter, w.r * 0.6));
      const arch = Array.from({ length: 15 }, (_, i) => {
        const t = (i / 14) * Math.PI;
        return project([w.x + Math.cos(t) * (w.r + 0.07), w.sg * (hw + 0.004), w.r + Math.sin(t) * (w.r + 0.07)]);
      });
      grp('detail').segs.push(arch);
    }
  }

  // bounds
  const all = [];
  for (const g of Object.values(groups)) {
    g.segs.forEach((s) => all.push(...s));
    g.polys.forEach((p) => all.push(...p));
  }
  const bnd = (pts) => {
    let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
    for (const [x, y] of pts) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    return { minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY };
  };
  const out = { groups, bounds: bnd(all), solidBounds: bnd(solidPts.length ? solidPts : all) };
  projCache.set(key, out);
  return out;
}

export const shapeForType = (vehicleType) => VEHICLE_TYPE_BY_ID[vehicleType]?.shape ?? 'sedan';

/** Tỷ lệ w/h dự kiến của bbox xe tại một góc nhìn — dùng cho heuristic nhận diện góc. */
export function vehicleAspect(vehicleTypeOrShape, azDeg) {
  const shapeId = VEHICLE_SHAPES[vehicleTypeOrShape] ? vehicleTypeOrShape : shapeForType(vehicleTypeOrShape);
  const b = getProjected(shapeId, ((azDeg % 360) + 360) % 360, 4).solidBounds;
  return b.w / b.h;
}

/* =============================== xuất SVG =============================== */
const f1 = (n) => n.toFixed(1);

function segsToPath(segs, tf) {
  return segs
    .map((s) => 'M' + s.map((p) => { const q = tf(p); return `${f1(q[0])},${f1(q[1])}`; }).join('L'))
    .join('');
}
function polysToPath(polys, tf) {
  return polys
    .map((s) => 'M' + s.map((p) => { const q = tf(p); return `${f1(q[0])},${f1(q[1])}`; }).join('L') + 'Z')
    .join('');
}

function cornerBrackets(r, len) {
  const { x, y, w, h } = r;
  const l = Math.min(len, w / 2, h / 2);
  return [
    `M${f1(x)},${f1(y + l)}V${f1(y)}H${f1(x + l)}`,
    `M${f1(x + w - l)},${f1(y)}H${f1(x + w)}V${f1(y + l)}`,
    `M${f1(x + w)},${f1(y + h - l)}V${f1(y + h)}H${f1(x + w - l)}`,
    `M${f1(x + l)},${f1(y + h)}H${f1(x)}V${f1(y + h - l)}`,
  ].join('');
}

/**
 * Dựng khung hướng dẫn kích thước đúng bằng vùng video hiển thị.
 * @param {{vehicleType:string, angleKey:string, width:number, height:number, withFrame?:boolean, fill?:number}} o
 * @returns {{svg:string, rect:{x,y,w,h,nx,ny,nw,nh}, aspect:number}}
 */
export function buildGuide({ vehicleType, angleKey, width, height, withFrame = true, fill = 0.86, offsetY = 0 }) {
  const shapeId = shapeForType(vehicleType);
  const az = ANGLE_BY_KEY[angleKey]?.deg ?? 0;
  const proj = getProjected(shapeId, az, 10);
  const b = proj.bounds;
  const portrait = height >= width;
  const availW = width * fill;
  const availH = height * (portrait ? 0.5 : 0.7);
  const scale = Math.min(availW / b.w, availH / b.h);
  const cx = width / 2;
  const cy = height * 0.5 + offsetY;
  const bcx = (b.minX + b.maxX) / 2;
  const bcy = (b.minY + b.maxY) / 2;
  const tf = (p) => [cx + (p[0] - bcx) * scale, cy + (p[1] - bcy) * scale];

  const sb = proj.solidBounds;
  const tl = tf([sb.minX, sb.minY]);
  const br = tf([sb.maxX, sb.maxY]);
  const pad = Math.min(width, height) * 0.025;
  const rect = { x: tl[0] - pad, y: tl[1] - pad, w: br[0] - tl[0] + pad * 2, h: br[1] - tl[1] + pad * 2 };
  rect.nx = rect.x / width; rect.ny = rect.y / height; rect.nw = rect.w / width; rect.nh = rect.h / height;

  const G = proj.groups;
  const layer = (cls, g, closedOnly = false) => {
    if (!g) return '';
    const d = (closedOnly ? '' : segsToPath(g.segs, tf)) + polysToPath(g.polys, tf);
    return d ? `<path class="${cls}" d="${d}"/>` : '';
  };
  const shadow = [layer('g-shadow', G.body), layer('g-shadow', G.wheel)].join('');
  const glass = G.glass ? `<path class="g-glass" d="${polysToPath(G.glass.polys, tf)}"/>` : '';
  const body = [
    layer('g-body', G.body),
    layer('g-wheel', G.wheel),
    layer('g-detail', G.detail),
    layer('g-light', G.light),
    layer('g-tail', G.tail),
    layer('g-plate', G.plate),
  ].join('');
  const frame = withFrame
    ? `<path class="g-frame" d="${cornerBrackets(rect, Math.min(rect.w, rect.h) * 0.22)}"/>`
    : '';
  const svgStr = `<svg xmlns="http://www.w3.org/2000/svg" class="guide-svg" viewBox="0 0 ${f1(width)} ${f1(height)}" width="${f1(width)}" height="${f1(height)}" preserveAspectRatio="none" aria-hidden="true">${frame}${glass}${shadow}${body}</svg>`;
  return { svg: svgStr, rect, aspect: b.w / b.h };
}

/** Biểu tượng nhỏ cho ô chọn loại xe / minh họa (viewBox tự co theo hình). */
export function buildIcon({ vehicleType, angleKey = 'front_right', size = 96 }) {
  const shapeId = shapeForType(vehicleType);
  const az = ANGLE_BY_KEY[angleKey]?.deg ?? 45;
  const proj = getProjected(shapeId, az, 10);
  const b = proj.bounds;
  const w = size * 1.5;
  const h = size;
  const scale = Math.min((w * 0.92) / b.w, (h * 0.82) / b.h);
  const bcx = (b.minX + b.maxX) / 2;
  const bcy = (b.minY + b.maxY) / 2;
  const tf = (p) => [w / 2 + (p[0] - bcx) * scale, h / 2 + (p[1] - bcy) * scale];
  const G = proj.groups;
  const l = (cls, g) => (g ? `<path class="${cls}" d="${segsToPath(g.segs, tf)}${polysToPath(g.polys, tf)}"/>` : '');
  return `<svg xmlns="http://www.w3.org/2000/svg" class="icon-svg" viewBox="0 0 ${f1(w)} ${f1(h)}" aria-hidden="true">${l('g-glass', G.glass)}${l('g-body', G.body)}${l('g-wheel', G.wheel)}${l('g-light', G.light)}${l('g-tail', G.tail)}</svg>`;
}

/**
 * Vẽ xe wireframe lên canvas (dùng cho ảnh giả lập ở chế độ DEMO).
 * @param {CanvasRenderingContext2D} ctx
 */
export function drawVehicleToCanvas(ctx, { vehicleType, angleKey, azDeg = null, x, y, w, h, colors = {} }) {
  const shapeId = shapeForType(vehicleType);
  const az = azDeg != null ? Math.round(((azDeg % 360) + 360) % 360) % 360 : ANGLE_BY_KEY[angleKey]?.deg ?? 0;
  const proj = getProjected(shapeId, az, 10);
  const b = proj.bounds;
  const scale = Math.min(w / b.w, h / b.h);
  const bcx = (b.minX + b.maxX) / 2;
  const bcy = (b.minY + b.maxY) / 2;
  const tf = (p) => [x + w / 2 + (p[0] - bcx) * scale, y + h / 2 + (p[1] - bcy) * scale];
  const G = proj.groups;
  const draw = (g, stroke, width, fill) => {
    if (!g) return;
    ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath();
    g.segs.forEach((s) => s.forEach((p, i) => { const q = tf(p); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); }));
    ctx.stroke();
    g.polys.forEach((poly) => {
      ctx.beginPath();
      poly.forEach((p, i) => { const q = tf(p); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); });
      ctx.closePath();
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      ctx.stroke();
    });
  };
  const lw = Math.max(2, scale * 0.045);
  draw(G.glass, colors.glass ?? '#9fd8f0', lw * 0.7, 'rgba(120,190,230,0.35)');
  draw(G.body, colors.body ?? '#e8eef2', lw);
  draw(G.wheel, colors.wheel ?? '#c8d2d8', lw, 'rgba(20,24,28,0.75)');
  draw(G.detail, colors.detail ?? '#aab6bd', lw * 0.6);
  draw(G.light, colors.light ?? '#ffe08a', lw * 0.8, 'rgba(255,224,138,0.4)');
  draw(G.tail, colors.tail ?? '#ff7a7a', lw * 0.8, 'rgba(255,90,90,0.4)');
  draw(G.plate, colors.plate ?? '#ffffff', lw * 0.6, 'rgba(255,255,255,0.5)');
  const sb = proj.solidBounds;
  const tl = tf([sb.minX, sb.minY]);
  return { scale, solid: { x: tl[0], y: tl[1], w: (sb.maxX - sb.minX) * scale, h: (sb.maxY - sb.minY) * scale } };
}

/** Hình chữ nhật (px) mà drawVehicleToCanvas sẽ chiếm trong hộp x,y,w,h tại azimuth cho trước — không vẽ gì. */
export function layoutVehicle({ vehicleType, azDeg, x, y, w, h }) {
  const shapeId = shapeForType(vehicleType);
  const az = Math.round(((azDeg % 360) + 360) % 360) % 360;
  const proj = getProjected(shapeId, az, 10);
  const b = proj.bounds;
  const scale = Math.min(w / b.w, h / b.h);
  const bcx = (b.minX + b.maxX) / 2;
  const bcy = (b.minY + b.maxY) / 2;
  const sb = proj.solidBounds;
  return {
    scale,
    solid: {
      x: x + w / 2 + (sb.minX - bcx) * scale,
      y: y + h / 2 + (sb.minY - bcy) * scale,
      w: (sb.maxX - sb.minX) * scale,
      h: (sb.maxY - sb.minY) * scale,
    },
  };
}
