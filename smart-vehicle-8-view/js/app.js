/**
 * app.js — Điểm vào: khởi tạo module, định tuyến 3 màn hình, bắt lỗi toàn cục.
 *
 * Màn hình 1 (setup) → Màn hình 2 (camera) → Màn hình 3 (preview) và quay lại (tiếp tục chụp / chụp lại một góc).
 * Không có backend: mọi thứ chạy trong trình duyệt; ảnh lưu trong IndexedDB của thiết bị.
 */
import { acceptedCount, getState, setState } from './appState.js';
import { initStore, isPersistent } from './captureStore.js';
import { initVoice } from './voiceGuide.js';
import { SetupController } from './setupController.js';
import { CameraScreen } from './cameraScreen.js';
import { PreviewController } from './previewController.js';
import { toast } from './uiKit.js';
import { aiPreloader } from './aiPreloader.js';
import { $$, log } from './utils.js';

function showScreen(name) {
  for (const el of $$('.screen')) el.classList.toggle('is-active', el.dataset.screen === name);
  setState({ screen: name });
  window.scrollTo(0, 0);
}

const setup = new SetupController({
  onStart: () => goCamera({}),
  onResume: ({ complete }) => (complete ? goPreview() : goCamera({ resume: true })),
});

const camera = new CameraScreen({
  onExit: () => goSetup(),
  onFinished: async () => { await camera.exit({ silent: true }); await goPreview(); },
  onOpenPreview: async () => { await camera.exit({ silent: true }); await goPreview(); },
});

const preview = new PreviewController({
  onBack: () => (acceptedCount() < 8 ? goCamera({ resume: true }) : goSetup()),
  onRetake: (key) => goCamera({ retakeKey: key }),
  onContinue: () => goCamera({ resume: true }),
  onNewSession: () => goSetup(),
  onWiped: () => goSetup(),
});

async function goCamera(opts = {}) {
  showScreen('camera');
  try {
    await camera.enter(opts);
  } catch (e) {
    log.error('Không vào được màn hình camera', e);
    toast('Không mở được màn hình chụp ảnh.', { level: 'bad' });
    await camera.exit({ silent: true }).catch(() => {});
    goSetup();
  }
}

function goSetup() {
  showScreen('setup');
  setup.onShow();
}

async function goPreview() {
  showScreen('preview');
  await preview.enter();
}

/* ----------------------------- lỗi toàn cục ----------------------------- */
let lastErrorToast = 0;
function notifyError() {
  const t = Date.now();
  if (t - lastErrorToast < 4000) return;
  lastErrorToast = t;
  toast('Đã xảy ra lỗi không mong muốn. Nếu lặp lại, hãy quay về màn hình đầu và thử lại.', { level: 'bad', ms: 4200 });
}
window.addEventListener('error', (e) => {
  log.error('window.error', e.message, `${e.filename ?? ''}:${e.lineno ?? ''}`);
  notifyError();
});
window.addEventListener('unhandledrejection', (e) => {
  log.error('unhandledrejection', e.reason?.message ?? String(e.reason));
  notifyError();
});

/* ----------------------------- khởi động ----------------------------- */
async function boot() {
  await initStore().catch((e) => log.warn('initStore lỗi', e));
  initVoice();
  setup.init();
  showScreen('setup');
  if (!isPersistent()) toast('IndexedDB không khả dụng: ảnh chỉ được giữ tạm trong bộ nhớ của tab này.', { level: 'warn', ms: 4800 });

  // móc gỡ lỗi / kiểm thử (không chứa dữ liệu nhạy cảm)
  window.__sv8 = {
    getState,
    camera,
    setup,
    preview,
    goCamera,
    goSetup,
    goPreview,
    preloader: aiPreloader,
    log: () => log.buffer(),
  };
}

boot().catch((e) => {
  log.error('Khởi động thất bại', e);
  notifyError();
});
