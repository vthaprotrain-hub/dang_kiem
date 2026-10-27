/**
 * Người dùng: liên kết tài khoản Firebase Authentication ↔ hồ sơ nhân sự, hồ sơ, vai trò & quyền.
 *
 * Mô hình: hồ sơ nhân sự dùng ID nội bộ ổn định (userProfiles/{userId}); UID của Firebase Auth được ánh xạ
 * qua authLinks/{authUid} = {userId}. Rules chỉ cho phép một tài khoản tự liên kết khi email đã xác thực
 * của tài khoản trùng với email trong hồ sơ do HR/Admin tạo – không ai tự cấp quyền cho mình được.
 */
import { activeFirebaseConfig, usingEmulators } from './firebase.js';
import { emulators } from '../firebase-config.js';
import { initializeApp, deleteApp, getAuth, createUserWithEmailAndPassword, signOut, connectAuthEmulator } from './sdk.js';
import { read, write, NOW, DENIED, AppError, auditUpdate } from './database.service.js';
import { ctx } from '../state.js';
import { emailKey, cleanUndefined } from '../utils.js';

export async function loadDemoOptions() {
  try {
    const enabled = await read('public/demoEnabled');
    if (!enabled) return { enabled: false, options: {} };
    const options = await read('public/demoLoginOptions');
    return { enabled: true, options: options || {} };
  } catch (e) {
    return { enabled: false, options: {}, error: e };
  }
}

export async function loadBranding() {
  try { return (await read('public/branding')) || {}; } catch { return {}; }
}

/** Đảm bảo tài khoản đăng nhập đã liên kết với hồ sơ nhân sự. Trả về userId. */
export async function ensureLinked(user) {
  const link = await read(`authLinks/${user.uid}`, { allowDenied: true });
  if (link && link !== DENIED && link.userId) return link.userId;
  const email = String(user.email || '').toLowerCase();
  if (!email) throw new AppError('Tài khoản không có email – không thể liên kết hồ sơ.');
  const userId = await read(`emailIndex/${emailKey(email)}`, { allowDenied: true });
  if (!userId || userId === DENIED) {
    const initialized = await read('system/initializedAt', { allowDenied: true });
    const err = new AppError(initialized
      ? `Email ${email} chưa được cấp hồ sơ nhân sự trong hệ thống. Vui lòng liên hệ quản trị viên/HR.`
      : 'Cơ sở dữ liệu chưa được khởi tạo dữ liệu.');
    err.code = initialized ? 'NO_PROFILE' : 'NOT_INITIALIZED';
    throw err;
  }
  const demoOpt = await read(`public/demoLoginOptions/${userId}`, { allowDenied: true });
  const base = { [`authLinks/${user.uid}`]: { userId, email, linkedAt: NOW() } };
  const extra = { [`userProfiles/${userId}/authUid`]: user.uid };
  if (demoOpt && demoOpt !== DENIED && demoOpt.authUid !== user.uid) extra[`public/demoLoginOptions/${userId}/authUid`] = user.uid;
  try {
    await write({ ...base, ...extra });
  } catch (e) {
    try {
      // Hồ sơ đã có authUid của chính tài khoản này (liên kết cũ bị xóa) → chỉ tạo lại authLinks
      await write(base);
    } catch (e2) {
      const err = new AppError('Không thể liên kết tài khoản với hồ sơ nhân sự: email không khớp, hồ sơ đã ngừng hoạt động hoặc đã liên kết với một tài khoản khác. Liên hệ quản trị viên.', e2);
      err.code = 'LINK_DENIED';
      throw err;
    }
  }
  return userId;
}

export function computePerms(roles, matrix = ctx.config.permissionPolicies?.roles || {}) {
  const perms = {};
  for (const r of Object.keys(roles || {})) {
    if (!roles[r]) continue;
    for (const [k, v] of Object.entries(matrix[r] || {})) if (v === true) perms[k] = true;
  }
  return perms;
}

/** Lưu hồ sơ nhân sự (HR/Admin có quyền manageUsers). */
export async function saveProfile(userId, data, { previous = null, demoOption } = {}) {
  const email = String(data.email || '').trim().toLowerCase();
  const profile = cleanUndefined({
    ...(previous || {}),
    ...data,
    email,
    status: data.status || 'active',
    updatedAt: NOW(),
    updatedBy: ctx.userId,
    ...(previous ? {} : { createdAt: NOW() }),
  });
  for (const k of ['managerId', 'skipManagerId']) if (!profile[k]) delete profile[k];
  if (previous?.authUid) profile.authUid = previous.authUid;
  const updates = { [`userProfiles/${userId}`]: profile, [`emailIndex/${emailKey(email)}`]: userId };
  if (previous?.email && previous.email !== email) updates[`emailIndex/${emailKey(previous.email)}`] = null;
  if (demoOption !== undefined) {
    updates[`public/demoLoginOptions/${userId}`] = demoOption ? cleanUndefined({ ...demoOption, email, name: profile.name, title: profile.title }) : null;
  }
  Object.assign(updates, auditUpdate({ type: previous ? 'user_update' : 'user_create', entity: 'user', entityId: userId, before: previous ? { name: previous.name, email: previous.email, unitId: previous.unitId, managerId: previous.managerId || null, status: previous.status } : null, after: { name: profile.name, email, unitId: profile.unitId, managerId: profile.managerId || null, status: profile.status } }));
  await write(updates);
}

/** Gán vai trò (chỉ System Admin). Quyền hiệu lực được tính sẵn từ ma trận. */
export async function saveAccess(userId, roles, previous = null, reason = '') {
  const clean = Object.fromEntries(Object.entries(roles || {}).filter(([, v]) => v));
  const perms = computePerms(clean);
  await write({
    [`userAccess/${userId}`]: { roles: clean, perms, updatedAt: NOW(), updatedBy: ctx.userId },
    ...auditUpdate({ type: 'access_change', entity: 'userAccess', entityId: userId, before: previous?.roles || null, after: clean, reason }),
  });
}

/** Áp dụng lại ma trận quyền cho toàn bộ người dùng (sau khi sửa ma trận). */
export async function applyMatrixToAll(accessMap, matrix) {
  const updates = {};
  for (const [uid, acc] of Object.entries(accessMap || {})) {
    updates[`userAccess/${uid}/perms`] = computePerms(acc.roles || {}, matrix);
    updates[`userAccess/${uid}/updatedAt`] = NOW();
    updates[`userAccess/${uid}/updatedBy`] = ctx.userId;
  }
  Object.assign(updates, auditUpdate({ type: 'permission_matrix_apply', entity: 'permissionPolicies', entityId: 'roles', after: { users: Object.keys(accessMap || {}).length } }));
  await write(updates);
}

export async function unlinkAccount(userId, authUid, reason) {
  await write({
    [`authLinks/${authUid}`]: null,
    [`userProfiles/${userId}/authUid`]: null,
    ...auditUpdate({ type: 'auth_unlink', entity: 'user', entityId: userId, before: { authUid }, reason }),
  });
}

/**
 * Tạo tài khoản Firebase Authentication cho email (công cụ hỗ trợ provision demo).
 * Dùng một Firebase App phụ để phiên đăng nhập của quản trị viên không bị thay thế.
 * Yêu cầu: Email/Password và "Enable create (sign-up)" đang bật. Tài khoản mới không có quyền gì
 * cho tới khi tự liên kết với hồ sơ có cùng email (Rules kiểm tra).
 */
export async function provisionAuthAccounts(emails, password, onProgress = () => {}) {
  const app2 = initializeApp(activeFirebaseConfig, `provision-${Date.now()}`);
  const auth2 = getAuth(app2);
  if (usingEmulators) { try { connectAuthEmulator(auth2, emulators.authUrl, { disableWarnings: true }); } catch { /* ignore */ } }
  const results = [];
  try {
    for (const email of emails) {
      try {
        const cred = await createUserWithEmailAndPassword(auth2, email, password);
        results.push({ email, ok: true, uid: cred.user.uid });
        await signOut(auth2);
      } catch (e) {
        results.push({ email, ok: false, code: e.code || '', message: e.code === 'auth/email-already-in-use' ? 'Đã tồn tại' : e.message });
      }
      onProgress(results.length, emails.length);
    }
  } finally {
    try { await deleteApp(app2); } catch { /* ignore */ }
  }
  return results;
}
