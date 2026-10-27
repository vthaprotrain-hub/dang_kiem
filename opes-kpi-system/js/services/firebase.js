/**
 * Khởi tạo Firebase ở MỘT nơi duy nhất. Các module khác chỉ import { auth, db } từ đây.
 */
import { firebaseConfig, emulators } from '../firebase-config.js';
import { initializeApp, getAuth, getDatabase, connectAuthEmulator, connectDatabaseEmulator } from './sdk.js';

export const isConfigured = !String(firebaseConfig.apiKey || '').startsWith('YOUR_') && !String(firebaseConfig.databaseURL || '').includes('YOUR_PROJECT_ID');

const params = new URLSearchParams(location.search);
export const usingEmulators = emulators.enabled || (params.get('emulator') === '1' && ['localhost', '127.0.0.1'].includes(location.hostname));

const config = usingEmulators && !isConfigured
  ? { ...firebaseConfig, apiKey: 'demo-key', projectId: 'demo-opes-kpi', databaseURL: `http://${emulators.databaseHost}:${emulators.databasePort}?ns=demo-opes-kpi-default-rtdb` }
  : firebaseConfig;

export const app = initializeApp(config);
export const auth = getAuth(app);
export const db = getDatabase(app);

if (usingEmulators) {
  try {
    connectAuthEmulator(auth, emulators.authUrl, { disableWarnings: true });
    connectDatabaseEmulator(db, emulators.databaseHost, emulators.databasePort);
  } catch (e) {
    console.warn('Không kết nối được Firebase Emulator:', e.message);
  }
}

export { config as activeFirebaseConfig };
