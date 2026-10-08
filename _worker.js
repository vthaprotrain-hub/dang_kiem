/**
 * Tra cứu GCN Đăng kiểm — Cloudflare Pages (Advanced mode: _worker.js)
 * Tác giả: Hưng.Vũ
 * - Giao diện: index.html (file tĩnh cùng thư mục)
 * - API:       POST /api/v2/q  (công thức truy vấn chỉ nằm ở đây, phía server)
 */
const __SECRET__ = '9ppW-rRV02fDwX8qufa3PUNOV-toKGJY';
/* ===== CORE (server-side only: Worker / Node proxy). Không gửi xuống trình duyệt. ===== */
const UPSTREAM_HOST = 'gcndangkiem.vr.org.vn';
const UPSTREAM_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml',
  'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8',
};

/* --- mask codec (khớp với client) --- */
function _ks(seed) {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  let x = h || 0x9e3779b9;
  return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x & 255; };
}
function _hex(b) { let s = ''; for (const v of b) s += v.toString(16).padStart(2, '0'); return s; }
function maskBytes(bytes) {
  const n = new Uint8Array(8);
  globalThis.crypto.getRandomValues(n);
  const g = _ks(__SECRET__ + _hex(n));
  const out = new Uint8Array(8 + bytes.length);
  out.set(n, 0);
  for (let i = 0; i < bytes.length; i++) out[8 + i] = bytes[i] ^ g();
  return out;
}
function unmaskBytes(buf) {
  const b = new Uint8Array(buf);
  if (b.length < 9) throw new Error('bad payload');
  const g = _ks(__SECRET__ + _hex(b.subarray(0, 8)));
  const out = new Uint8Array(b.length - 8);
  for (let i = 0; i < out.length; i++) out[i] = b[8 + i] ^ g();
  return out;
}
const _te = new TextEncoder(), _td = new TextDecoder();
const packJson = obj => maskBytes(_te.encode(JSON.stringify(obj)));
const unpackJson = buf => JSON.parse(_td.decode(unmaskBytes(buf)));

/* --- quy tắc biển số --- */
function buildQuery(p, c, k) {
  const plate = String(p || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  const color = String(c || '').toUpperCase();
  const sk = String(k || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (!/^\d{2}[A-Z][0-9A-Z]{3,9}$/.test(plate)) throw new Error('Biển kiểm soát không hợp lệ');
  if (!['', 'V', 'T', 'X'].includes(color)) throw new Error('Màu biển không hợp lệ');
  if (!/^[0-9A-Z]{4,8}$/.test(sk)) throw new Error('Số khung không hợp lệ');
  const key = { biendangky: plate + color, sokhung: sk, somay: '', soseri: '', loaipt: '1' };
  const json = JSON.stringify(key);
  const b64 = typeof btoa === 'function' ? btoa(json) : Buffer.from(json).toString('base64');
  return { url: 'https://' + UPSTREAM_HOST + '/chi-tiet?data=' + b64, json };
}

/* --- xử lý API: nhận payload mã hoá -> gọi upstream -> trả payload mã hoá --- */
async function handleQuery(bodyBuf, fetchHtml) {
  let q;
  try { q = unpackJson(bodyBuf); } catch (e) { return packJson({ e: 'Yêu cầu không hợp lệ' }); }
  try {
    const { url, json } = buildQuery(q.p, q.c, q.k);
    const t0 = Date.now();
    const r = await fetchHtml(url);
    return packJson({ u: url, j: json, s: r.status, h: r.text, ms: Date.now() - t0 });
  } catch (e) {
    return packJson({ e: String((e && e.message) || e) });
  }
}


export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (url.pathname === '/api/v2/q') {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
      if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      const out = await handleQuery(await request.arrayBuffer(), async target => {
        const r = await fetch(target, { headers: UPSTREAM_HEADERS, redirect: 'follow' });
        if (new URL(r.url).hostname !== UPSTREAM_HOST) throw new Error('Upstream chuyển hướng bất thường');
        return { status: r.status, text: await r.text() };
      });
      return new Response(out, {
        headers: { ...cors, 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' },
      });
    }

    // Ẩn các file hướng dẫn / cấu hình
    if (/^\/(huong-dan|wrangler|_worker|readme)/i.test(url.pathname)) return new Response('Not found', { status: 404 });

    // Các đường dẫn khác: trả file tĩnh (index.html) + header bảo mật
    const res = await env.ASSETS.fetch(request);
    const h = new Headers(res.headers);
    h.set('X-Robots-Tag', 'noindex, nofollow');
    h.set('X-Frame-Options', 'DENY');
    h.set('X-Content-Type-Options', 'nosniff');
    h.set('Referrer-Policy', 'no-referrer');
    if ((h.get('Content-Type') || '').includes('text/html')) h.set('Cache-Control', 'no-cache');
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
  },
};
