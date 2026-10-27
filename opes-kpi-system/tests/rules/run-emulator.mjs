/**
 * Chạy bộ kịch bản kiểm thử Database Rules (tests/rules/scenarios.mjs) trên Firebase Realtime Database Emulator.
 *
 *   npm install
 *   npm run test:rules
 *     (= firebase emulators:exec --project demo-opes-kpi --only database "node tests/rules/run-emulator.mjs")
 *
 * Mỗi kịch bản: xóa DB → nạp dữ liệu nền (bỏ qua Rules) → chạy lần lượt các bước với đúng danh tính
 * (chưa đăng nhập / uid + email) → so sánh kết quả cho phép/từ chối với kỳ vọng.
 * Chỉ dùng cho kiểm thử cục bộ – không phải backend của ứng dụng.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { scenarios, baseData, authUid, emailOf } from './scenarios.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const [host, port] = (process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000').split(':');
const only = process.argv[2];

const env = await initializeTestEnvironment({
  projectId: 'demo-opes-kpi',
  database: { host, port: Number(port), rules: readFileSync(join(root, 'database.rules.json'), 'utf8') },
});

function contextFor(as) {
  if (as === null || as === undefined) return env.unauthenticatedContext();
  if (typeof as === 'string') return env.authenticatedContext(authUid(as), { email: emailOf(as), email_verified: true });
  return env.authenticatedContext(as.uid, { email: as.email, email_verified: true });
}

async function attempt(fn) {
  try { await fn(); return { ok: true }; } catch (e) { return { ok: false, error: String(e?.message || e) }; }
}

let pass = 0, fail = 0;
for (const sc of scenarios) {
  if (only && !sc.name.includes(only)) continue;
  await env.clearDatabase();
  const data = sc.data === 'empty' ? null : baseData(sc.data || {});
  if (data) await env.withSecurityRulesDisabled(async (c) => { await c.database().ref().set(data); });
  for (const [i, st] of sc.steps.entries()) {
    const db = contextFor(st.as).database();
    const r = st.op === 'read'
      ? await attempt(() => db.ref(st.path).get())
      : await attempt(() => db.ref().update(st.updates));
    const want = st.expect === 'allow';
    if (r.ok === want) pass++;
    else {
      fail++;
      const who = st.as === null ? 'khách' : typeof st.as === 'string' ? st.as : st.as.uid;
      console.log(`✘ [${sc.name}] bước ${i + 1} (${who} ${st.op} ${st.path || Object.keys(st.updates || {}).join(', ')}) – kỳ vọng ${st.expect}${st.note ? ` (${st.note})` : ''}${r.error ? `\n   ${r.error.slice(0, 300)}` : ''}`);
    }
  }
}
await env.cleanup();
console.log(`\nDatabase Rules (emulator): ${pass} đạt, ${fail} không đạt`);
process.exit(fail ? 1 : 0);
