/**
 * CẤU HÌNH FIREBASE – thay bằng thông số Web App của dự án Firebase của bạn
 * (Firebase Console → Project settings → General → Your apps → SDK setup and configuration).
 *
 * Lưu ý bảo mật: firebaseConfig phía client KHÔNG phải cơ chế bảo mật. An toàn dữ liệu dựa vào
 * Firebase Authentication + Database Rules (database.rules.json). Không đặt service account key
 * hoặc khóa đặc quyền trong mã nguồn frontend.
 */
export const firebaseConfig = {
  // Dự án Firebase: KPI-OPES (project id: kpi-opes)
  apiKey: 'AIzaSyCYQXG8z19pRRZXEIjZInEy6Nhrf21Zidw',
  authDomain: 'kpi-opes.firebaseapp.com',
  databaseURL: 'https://kpi-opes-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'kpi-opes',
  storageBucket: 'kpi-opes.firebasestorage.app',
  messagingSenderId: '715669820867',
  appId: '1:715669820867:web:7728ca11317f4b19ca1976',
};

/**
 * Firebase Local Emulator Suite (tùy chọn, dùng khi phát triển):
 *   firebase emulators:start --project demo-opes-kpi --only auth,database,hosting
 * rồi mở http://localhost:5000/?emulator=1 (hoặc đặt enabled: true).
 */
export const emulators = {
  enabled: false,
  authUrl: 'http://127.0.0.1:9099',
  databaseHost: '127.0.0.1',
  databasePort: 9000,
};

/**
 * Dòng gợi ý hiển thị dưới ô mật khẩu ở môi trường POC. Mật khẩu KHÔNG được ghi trong mã nguồn,
 * JSON hay Realtime Database – người dùng nhận mật khẩu POC qua tài liệu hướng dẫn (README).
 * Đặt chuỗi rỗng '' khi triển khai chính thức.
 */
export const POC_LOGIN_HINT = 'Môi trường POC: dùng mật khẩu thử nghiệm được cấp trong tài liệu hướng dẫn. Không dùng cho dữ liệu thật.';

/** Đường dẫn file dữ liệu demo dùng cho chức năng khởi tạo/bảo trì dữ liệu. */
export const SEED_DATA_URL = './js/seed/opes-kpi-data.json';
