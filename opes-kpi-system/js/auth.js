/**
 * Trang đăng nhập & xác thực Firebase Authentication (Email/Password).
 * Danh sách người dùng demo được đọc từ Realtime Database (public/demoLoginOptions) – không chứa mật khẩu.
 * Ứng dụng không bao giờ giả lập đăng nhập theo vai trò: mọi phiên đều qua signInWithEmailAndPassword.
 */
import { auth, isConfigured, usingEmulators } from './services/firebase.js';
import { signInWithEmailAndPassword, signOut } from './services/sdk.js';
import { clearAll, mapError } from './services/database.service.js';
import { loadDemoOptions, loadBranding } from './services/user.service.js';
import { POC_LOGIN_HINT } from './firebase-config.js';
import { html, render, initials, $, busy, raw } from './utils.js';

const LOGO = raw('<img src="assets/icons/logo.svg" alt="" width="40" height="40">');

export async function renderLogin(root, { error = '' } = {}) {
  render(root, html`<div class="login-page"><div class="login-hero"></div><div class="login-panel"><div class="loading"><span class="spinner"></span>Đang tải…</div></div></div>`);
  const [branding, demo] = isConfigured || usingEmulators ? await Promise.all([loadBranding(), loadDemoOptions()]) : [{}, { enabled: false, options: {} }];
  const options = Object.entries(demo.options || {}).map(([id, o]) => ({ id, ...o })).sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  const company = branding.companyName || 'Công ty Cổ phần Bảo hiểm OPES';
  render(root, html`<div class="login-page">
    <section class="login-hero">
      <div class="brand"><span class="brand-mark">${LOGO}</span><div><div style="font-weight:800;letter-spacing:.06em">OPES</div><div class="small" style="opacity:.8">${company}</div></div></div>
      <div>
        <h1>Hệ thống Quản lý KPI &amp; KBI</h1>
        <p>Xây dựng và giao KPI TOP-DOWN từ Phó Tổng Giám đốc thường trực tới từng cán bộ, đánh giá hành vi theo 5 giá trị cốt lõi, trình ký – phê duyệt và tổng hợp kết quả trên một nền tảng dữ liệu thống nhất.</p>
      </div>
      <ul class="hero-extra">
        <li>Kho KPI Public/Private, sub-KPI, hai chế độ phân bổ trọng số</li>
        <li>Biểu mẫu đánh giá theo mẫu BM KPI của OPES</li>
        <li>Phân quyền theo tổ chức, kiểm soát bằng Firebase Database Rules</li>
      </ul>
    </section>
    <section class="login-panel">
      <div class="card login-card">
        <div class="card-header"><div><h2>Đăng nhập</h2><div class="small muted">Xác thực bằng Firebase Authentication</div></div>${usingEmulators ? html`<span class="badge c-purple">Emulator</span>` : ''}</div>
        <form class="card-body" id="login-form" novalidate>
          ${!isConfigured && !usingEmulators ? html`<div class="alert warning"><div><b>Chưa cấu hình Firebase.</b> Mở <span class="kbd">js/firebase-config.js</span> và thay <span class="kbd">firebaseConfig</span> bằng thông số Web App của dự án (xem README – mục 2).</div></div>` : ''}
          ${error ? html`<div class="alert danger" id="login-error"><div>${error}</div></div>` : html`<div class="alert danger hidden" id="login-error"></div>`}
          ${options.length ? html`
            <div class="field">
              <label>Chọn nhanh tài khoản demo</label>
              <div class="demo-list" id="demo-list" role="listbox">
                ${options.map((o) => html`<button type="button" class="demo-option" data-email="${o.email}" data-id="${o.id}" role="option">
                  <span class="avatar">${initials(o.name)}</span>
                  <span><span class="who">${o.name}</span><span class="meta" style="display:block">${o.title} · ${o.unitName}</span><span class="meta" style="display:block">Vai trò: ${o.roleLabel}</span></span>
                </button>`)}
              </div>
            </div>` : html`<div class="alert info"><div>${demo.enabled === false && (isConfigured || usingEmulators) ? 'Danh sách tài khoản demo chưa được bật hoặc cơ sở dữ liệu chưa khởi tạo. Quản trị viên có thể đăng nhập bằng email để khởi tạo dữ liệu (README – mục 4).' : 'Nhập email đã được cấp tài khoản.'}</div></div>`}
          <div class="field">
            <label for="login-email" class="req">Email đăng nhập</label>
            <input type="email" id="login-email" name="email" autocomplete="username" placeholder="ten@congty.vn" required>
          </div>
          <div class="field">
            <label for="login-password" class="req">Mật khẩu</label>
            <input type="password" id="login-password" name="password" autocomplete="current-password" required placeholder="Nhập mật khẩu">
            ${POC_LOGIN_HINT ? html`<span class="help">${POC_LOGIN_HINT}</span>` : ''}
          </div>
          <button class="btn primary" type="submit" id="login-submit" style="min-height:42px">Đăng nhập</button>
          <div class="small muted">Tài khoản phải được tạo sẵn trong Firebase Authentication và có hồ sơ nhân sự cùng email trong hệ thống. Ứng dụng không lưu mật khẩu.</div>
        </form>
      </div>
    </section>
  </div>`);

  const form = $('#login-form', root);
  const emailEl = $('#login-email', root);
  const showErr = (msg) => { const el = $('#login-error', root); el.classList.remove('hidden'); render(el, html`<div>${msg}</div>`); };
  root.querySelectorAll('.demo-option').forEach((b) => b.addEventListener('click', () => {
    root.querySelectorAll('.demo-option').forEach((x) => x.classList.toggle('selected', x === b));
    emailEl.value = b.dataset.email;
    $('#login-password', root).focus();
  }));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = emailEl.value.trim();
    const password = $('#login-password', root).value;
    if (!email || !password) { showErr('Vui lòng nhập email và mật khẩu.'); return; }
    busy($('#login-submit', root), async () => {
      try {
        await signInWithEmailAndPassword(auth, email, password);
      } catch (err) {
        const code = err.code || '';
        let msg = mapError(err);
        if (['auth/invalid-credential', 'auth/user-not-found', 'auth/invalid-login-credentials'].includes(code)) {
          msg += ' Nếu đây là tài khoản demo, hãy kiểm tra tài khoản đã được tạo trong Firebase Authentication với mật khẩu POC (README – mục 3).';
        }
        showErr(msg);
      }
    });
  });
}

export async function logout() {
  clearAll();
  await signOut(auth);
}
