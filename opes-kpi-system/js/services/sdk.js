/**
 * Điểm duy nhất nạp Firebase Web SDK (modular) qua CDN chính thức.
 * Muốn đổi phiên bản SDK chỉ cần sửa ở file này.
 */
export {
  initializeApp, deleteApp, getApps,
} from 'https://www.gstatic.com/firebasejs/12.12.0/firebase-app.js';
export {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, createUserWithEmailAndPassword,
  connectAuthEmulator, setPersistence, browserLocalPersistence,
} from 'https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js';
export {
  getDatabase, connectDatabaseEmulator, ref, child, get, set, update, push, remove, onValue,
  query, orderByChild, orderByKey, equalTo, limitToLast, limitToFirst, startAt, endAt,
  serverTimestamp, runTransaction,
} from 'https://www.gstatic.com/firebasejs/12.12.0/firebase-database.js';
