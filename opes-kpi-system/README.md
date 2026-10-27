# Hệ thống Quản lý KPI & KBI – OPES (POC)

Ứng dụng web tĩnh (HTML5 · CSS3 · JavaScript ES6 modules) dùng **Firebase Authentication (Email/Password)** và
**Firebase Realtime Database**. Không có backend riêng (không Node/Express/Python/PHP/Cloud Functions):
mọi kiểm soát truy cập dữ liệu nằm ở **Database Rules** (`database.rules.json`).

> ⚠️ Đây là bản POC. Tên người trong dữ liệu demo là giả lập. Các công thức, trọng số, ngưỡng và bảng xếp loại
> trong dữ liệu mẫu được gắn nhãn **“Cấu hình demo – cần HR xác nhận”** và có thể sửa trên giao diện quản trị.

---

## 0. Triển khai nhanh cho dự án KPI-OPES (`kpi-opes`)

Đã cấu hình sẵn: `projectId = kpi-opes`, `databaseURL = https://kpi-opes-default-rtdb.asia-southeast1.firebasedatabase.app`,
`.firebaserc` trỏ `kpi-opes`, email quản trị/bootstrap = **`quantri@congty.vn`** (trùng tài khoản đã tạo trong Authentication).

1. **Lấy 3 giá trị còn thiếu**: *Project settings (⚙) → General → Your apps*. Nếu chưa có Web app: bấm **</>**, đặt tên `opes-kpi-web`
   → *Register app*. Trong *SDK setup and configuration → Config*, sao chép `apiKey`, `messagingSenderId`, `appId` dán vào
   `js/firebase-config.js` (các dòng có dấu ←).
2. **Bật đăng nhập**: *Authentication → Sign-in method → Email/Password → Enable → Save*.
3. **Dán Database Rules**: *Realtime Database → Rules* → bấm vào ô soạn thảo, **Ctrl+A rồi Delete** để xóa hết nội dung cũ →
   mở `database.rules.json` bằng Notepad/VS Code, **Ctrl+A, Ctrl+C** → dán vào → **Publish**.
   - Dòng *“Error running simulation — Line 1: Parse error (viewing outdated simulation)”* là kết quả cũ của *Rules playground*,
     không phải lỗi của Rules: bấm **Dismiss**. Nếu bấm *Publish* bị báo lỗi, thường do dán thiếu/thừa ký tự (ví dụ còn sót
     `{ "rules": ... }` cũ, hoặc dán từ trình xem có định dạng) – xóa sạch và dán lại từ file gốc.
   - Hoặc dùng CLI: `npm i -g firebase-tools` → `firebase login` → `firebase deploy --only database`.
4. **Chạy ứng dụng** trên máy: `python3 -m http.server 8080` trong thư mục dự án → mở <http://localhost:8080>
   (hoặc `firebase deploy --only hosting` → <https://kpi-opes.web.app>).
5. **Đăng nhập `quantri@congty.vn`** (mật khẩu đã đặt khi tạo user) → màn hình báo DB trống → **Khởi tạo dữ liệu demo**.
6. **Tạo 16 tài khoản còn lại**: *Quản trị → Người dùng → Tạo tài khoản Auth (demo)* → nhập mật khẩu POC `Opes@123` → *Tạo tài khoản*.
   Sau đó *Authentication → Settings → User actions* → bỏ chọn **Enable create (sign-up)** → *Save*.
7. Đăng xuất, thử các tài khoản ở mục 4 (ví dụ `nv.maianh@opes-kpi.demo`).

---

## 1. Cấu trúc thư mục

```
opes-kpi-system/
├── index.html                  # Trang duy nhất (SPA, router theo hash #/...)
├── README.md
├── firebase.json               # Cấu hình Firebase Hosting + Database Rules + Emulator
├── .firebaserc                 # Dự án mặc định: kpi-opes
├── database.rules.json         # Database Rules (sinh từ tools/build-rules.mjs – đã có sẵn)
├── package.json                # CHỈ cho công cụ dev/test (ứng dụng không cần Node khi chạy)
├── css/
│   ├── styles.css              # Thành phần giao diện, bảng kiểu Excel, trạng thái
│   ├── layout.css              # Khung: sidebar, header, đăng nhập, responsive
│   └── print.css               # Bản in biểu mẫu đánh giá
├── assets/icons/               # logo.svg, favicon.svg
├── js/
│   ├── firebase-config.js      # ← THAY bằng cấu hình Web App của bạn
│   ├── app.js                  # Khởi động, menu theo quyền, header, thông báo, chọn kỳ
│   ├── auth.js                 # Trang đăng nhập (danh sách tài khoản demo đọc từ RTDB)
│   ├── router.js               # Router hash + chặn route theo quyền
│   ├── permissions.js          # Kiểm tra quyền phía giao diện (Rules kiểm tra lại phía server)
│   ├── utils.js                # html`` tự escape, định dạng số/ngày VN, modal, toast…
│   ├── state.js, labels.js, icons.js, components.js
│   ├── core/
│   │   ├── scoring.js          # Bộ máy tính điểm KPI/KBI/xếp loại (thuần JS, cấu hình từ DB)
│   │   ├── expression.js       # Bộ phân tích biểu thức an toàn cho công thức tùy biến (không eval)
│   │   └── carryover.js        # Phân loại & sao chép KPI từ kỳ trước
│   ├── services/               # Truy cập Firebase theo nghiệp vụ
│   │   ├── sdk.js, firebase.js # Firebase modular SDK 12.12.0 qua CDN gstatic
│   │   ├── database.service.js # read/write/listen, cập nhật đa đường dẫn, audit log, lịch sử
│   │   ├── user.service.js, organization.service.js, catalog.service.js, kbi.service.js,
│   │   ├── period.service.js, kpi.service.js, evaluation.service.js, workflow.service.js,
│   │   └── report.service.js   # CSV/XLSX trong phạm vi quyền
│   ├── modules/                # Màn hình
│   │   ├── dashboard.js, organization.js, catalog.js, kbi-management.js,
│   │   ├── kpi-management.js, kpi-plan.js, kpi-assign.js, kpi-tree.js,
│   │   ├── evaluations.js, evaluation-form.js, approvals.js, reports.js,
│   │   └── admin.js, admin-periods.js, admin-policies.js, admin-system.js
│   └── seed/
│       ├── opes-kpi-data.json  # Cấu hình vận hành + 25 nhân sự + kỳ 2025 đã khóa (KHÔNG chứa mật khẩu)
│       ├── demo-data.json      # Bộ POC trình diễn trạng thái quy trình
│       └── seed.js             # Khởi tạo lần đầu / bổ sung / đặt lại dữ liệu (có sao lưu)
├── tools/                      # Công cụ dev chạy trên máy quản trị (không phải backend)
│   ├── build-rules.mjs         # Sinh database.rules.json
│   ├── generate-opes-data.mjs  # Sinh js/seed/opes-kpi-data.json
│   └── generate-demo-data.mjs  # Sinh js/seed/demo-data.json
└── tests/
    ├── scoring.test.mjs        # Kiểm thử bộ máy tính điểm (gồm đối chiếu công thức Excel)
    ├── carryover.test.mjs      # Kiểm thử "Thêm KPI từ năm trước"
    └── rules/
        ├── scenarios.mjs       # 28 kịch bản (130 bước) cho phép/từ chối của Database Rules
        └── run-emulator.mjs    # Chạy kịch bản trên Firebase Emulator
```

---

## 2. Cấu hình Firebase (từng bước)

### 2.1. Tạo dự án
1. Vào <https://console.firebase.google.com> → **Add project** (có thể tắt Google Analytics).
2. **Build → Realtime Database → Create database** → chọn vị trí (khuyến nghị `asia-southeast1`) → **Start in locked mode**.
3. **Build → Authentication → Get started → Sign-in method → Email/Password → Enable** (không cần Email link).
4. **Project settings → General → Your apps → Web (</>)** → đăng ký app (không cần Hosting ở bước này) →
   sao chép khối `firebaseConfig`.

### 2.2. Khai báo cấu hình cho ứng dụng
Mở `js/firebase-config.js` và thay các giá trị `YOUR_...`:

```js
export const firebaseConfig = {
  apiKey: '...',
  authDomain: '<project-id>.firebaseapp.com',
  databaseURL: 'https://<project-id>-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: '<project-id>',
  storageBucket: '<project-id>.firebasestorage.app',
  messagingSenderId: '...',
  appId: '...',
};
```

> `firebaseConfig` phía client **không phải bí mật và không phải cơ chế bảo mật**. Bảo mật dựa vào
> Authentication + Database Rules. Không đặt service account / Admin SDK trong mã client.

### 2.3. Triển khai Database Rules
Cách A – Firebase CLI (khuyến nghị):
```bash
npm install -g firebase-tools        # hoặc dùng npx
firebase login
firebase use --add                   # chọn project vừa tạo
firebase deploy --only database
```
Cách B – Console: **Realtime Database → Rules** → dán toàn bộ nội dung `database.rules.json` → **Publish**.

Email được phép khởi tạo dữ liệu lần đầu (bootstrap) mặc định là `quantri@congty.vn`. Muốn đổi:
```bash
BOOTSTRAP_ADMIN_EMAIL=email@congty.vn node tools/generate-demo-data.mjs
BOOTSTRAP_ADMIN_EMAIL=email@congty.vn node tools/build-rules.mjs   # sinh lại database.rules.json
```
(lệnh thứ nhất đổi email hồ sơ `u_admin` trong dữ liệu demo, lệnh thứ hai đổi email trong Rules – hai giá trị phải trùng nhau).

### 2.4. Tạo tài khoản demo trong Firebase Authentication
Mật khẩu chung cho POC: **`Opes@123`** – chỉ dùng cho môi trường thử nghiệm. Mật khẩu **không** được lưu trong
Realtime Database, mã nguồn frontend hay file JSON; chỉ xuất hiện trong tài liệu này.

- **Cách 1 – Thủ công trên Console**: *Authentication → Users → Add user* cho từng email ở [mục 4](#4-danh-sách-tài-khoản-demo).
- **Cách 2 – Công cụ hỗ trợ trong ứng dụng** (sau khi đã nạp dữ liệu, xem 2.5):
  1. Tạo thủ công **một** tài khoản `quantri@congty.vn` trên Console.
  2. Đăng nhập bằng tài khoản này → **Quản trị → Người dùng → “Tạo tài khoản Auth (demo)”** → nhập mật khẩu POC → **Tạo tài khoản**.
     Công cụ dùng Auth SDK trên một *app phụ* (không phải Admin SDK, không có khóa đặc quyền), nên yêu cầu
     *Authentication → Settings → User actions → Enable create (sign-up)* đang bật.
  3. **Sau khi tạo xong, tắt “Enable create (sign-up)”** để không ai tự đăng ký thêm tài khoản.

**Ánh xạ UID**: hồ sơ nhân sự dùng mã ổn định (`userProfiles/u_nv_qlda2`…). Lần đăng nhập đầu tiên, ứng dụng ghi
`authLinks/{authUid} = { userId, email }` và `userProfiles/{userId}/authUid`. Database Rules **chỉ cho phép** ghi liên kết
khi `auth.token.email` trùng email của hồ sơ, hồ sơ đang hoạt động và chưa liên kết với UID khác. Vì vậy không cần
nhập UID thủ công, và không thể nhận hồ sơ của người khác. Quản trị viên có thể *Hủy liên kết* trong màn hình Người dùng.

### 2.5. Nạp dữ liệu
Có hai bộ dữ liệu trong `js/seed/`:

| File | Nội dung | Dùng khi |
|---|---|---|
| **`opes-kpi-data.json`** (mặc định) | Cấu hình vận hành đầy đủ + 25 nhân sự + kỳ **2025 đã chốt & khóa** (20 người); **chưa có kỳ 2026** | Chạy thật / đào tạo – HR tự tạo kỳ 2026 |
| `demo-data.json` | Bộ POC cũ: kỳ 2026 đang mở với hồ sơ ở nhiều trạng thái | Trình diễn nhanh các trạng thái quy trình |

- **Console (nhanh nhất)**: *Realtime Database → Data → ⋮ → Import JSON* → chọn `js/seed/opes-kpi-data.json` → *Import*.
  Thao tác **ghi đè toàn bộ** DB (kể cả liên kết tài khoản cũ); mỗi người tự liên kết lại ở lần đăng nhập kế tiếp.
- **Trong ứng dụng**: khi DB trống, đăng nhập `quantri@congty.vn` → **Khởi tạo dữ liệu** (dùng `SEED_DATA_URL` trong `js/firebase-config.js`).
- **Bổ sung / đặt lại sau này**: *Quản trị → Cấu hình & dữ liệu → Bảo trì*: System Admin bấm **Mở cửa sổ bảo trì (30 phút)**
  (Rules giới hạn tối đa 60 phút, có lý do, ghi audit) → *Bổ sung dữ liệu demo còn thiếu* hoặc *Khởi tạo lại toàn bộ dữ liệu demo…*
  (tự tải bản sao lưu JSON trước khi ghi đè) → *Đóng cửa sổ bảo trì*.
- Sinh lại dữ liệu: `BOOTSTRAP_ADMIN_EMAIL=quantri@congty.vn node tools/generate-opes-data.mjs`.

### 2.6. Tên miền được phép
Nếu chạy trên tên miền riêng: *Authentication → Settings → Authorized domains* → thêm tên miền
(`localhost` và `<project>.web.app` có sẵn).

---

## 3. Chạy ứng dụng

ES modules không chạy khi mở file trực tiếp (`file://`) – cần một web server tĩnh bất kỳ:

```bash
cd opes-kpi-system
python3 -m http.server 8080          # hoặc: npx http-server . -p 8080 -c-1
# mở http://localhost:8080
```

**Firebase Hosting**:
```bash
firebase deploy --only database,hosting      # hosting public = thư mục gốc, bỏ qua tools/, tests/
# mở https://<project-id>.web.app
```

**Firebase Local Emulator Suite** (không cần dự án thật):
```bash
npm install
npm run emulators            # = firebase emulators:start --project demo-opes-kpi --only auth,database,hosting
```
1. Mở Emulator UI <http://localhost:4000/auth> → *Add user* `quantri@congty.vn` / `Opes@123`.
2. Mở ứng dụng ở chế độ emulator: <http://localhost:5000/?emulator=1> (tham số chỉ có tác dụng trên localhost).
3. Đăng nhập admin → *Khởi tạo dữ liệu demo* → *Quản trị → Người dùng → Tạo tài khoản Auth (demo)*.

---

## 4. Danh sách tài khoản (bộ `opes-kpi-data.json`)

Mật khẩu POC: `Opes@123`. Trang đăng nhập hiển thị danh sách này (đọc từ `public/demoLoginOptions` trong RTDB);
chọn một dòng chỉ điền sẵn email – **vẫn phải đăng nhập Firebase Auth bằng mật khẩu**. Tài khoản Auth chưa có thì tạo bằng
*Quản trị → Người dùng → Tạo tài khoản Auth (demo)* (công cụ chỉ liệt kê hồ sơ chưa liên kết).

| Email | Họ tên (giả lập) | Chức danh | Vai trò | Quản lý trực tiếp | Xếp loại 2025 |
|---|---|---|---|---|---|
| quantri@congty.vn | Cao Văn Long | Chuyên viên Quản trị hệ thống | System Admin (không tham gia đánh giá) | – | – |
| ptgd@opes-kpi.demo | Hoàng Đức Thịnh | Phó Tổng Giám đốc thường trực | PTGĐ (cấp cao nhất) | – (HR duyệt cấp cao nhất) | Hoàn thành |
| gd.cntt@opes-kpi.demo | Trần Minh Đức | GĐ TT Công nghệ thông tin | Giám đốc + Người phê duyệt | PTGĐ | Hoàn thành |
| tb.qlda@opes-kpi.demo | Lê Thu Hà | Trưởng ban Quản lý dự án CNTT | Trưởng ban + Người phê duyệt | GĐ CNTT | Hoàn thành tốt |
| tn.qlda@opes-kpi.demo | Phạm Quốc Bảo | Trưởng nhóm Dự án số | Quản lý trực tiếp | TB QLDA | Cần cố gắng |
| nv.nam@opes-kpi.demo | Nguyễn Hoàng Nam | Chuyên viên Quản lý dự án | Nhân viên | TN Dự án số | Hoàn thành |
| nv.maianh@opes-kpi.demo | Đỗ Mai Anh | Chuyên viên Phân tích nghiệp vụ | Nhân viên | TN Dự án số | Xuất sắc |
| tb.ptht@opes-kpi.demo | Võ Thanh Tùng | Trưởng ban Phát triển hệ thống | Trưởng ban | GĐ CNTT | Hoàn thành |
| nv.huy@opes-kpi.demo | Hoàng Gia Huy | Kỹ sư phát triển phần mềm | Nhân viên | TB PTHT | Hoàn thành |
| nv.ngoc@opes-kpi.demo | Phùng Thị Ngọc | Kỹ sư kiểm thử phần mềm | Nhân viên | TB PTHT | *Mới 2026* |
| tb.hatang@opes-kpi.demo | Bùi Văn Khánh | Trưởng ban Hạ tầng và ATTT | Trưởng ban | GĐ CNTT | Hoàn thành tốt |
| nv.quan@opes-kpi.demo | Trương Minh Quân | Kỹ sư hạ tầng và ATTT | Nhân viên | TB Hạ tầng | Hoàn thành |
| tb.vanhanh@opes-kpi.demo | Nghiêm Văn Sơn | Trưởng ban Vận hành và quản trị dữ liệu | Trưởng ban | GĐ CNTT | Hoàn thành |
| nv.phuong@opes-kpi.demo | Hà Thị Phương | Chuyên viên Quản trị dữ liệu | Nhân viên | TB Vận hành | *Mới 2026* |
| gd.taichinh@opes-kpi.demo | Ngô Thị Lan | GĐ TT Tài chính | Giám đốc + Người phê duyệt | PTGĐ | Hoàn thành tốt |
| tp.ketoan@opes-kpi.demo | Đặng Hữu Phúc | Trưởng phòng Kế toán | Trưởng phòng | GĐ Tài chính | Hoàn thành |
| nv.hong@opes-kpi.demo | Lý Thị Hồng | Chuyên viên Kế toán tổng hợp | Nhân viên | TP Kế toán | Xuất sắc |
| nv.trang@opes-kpi.demo | Đinh Thu Trang | Chuyên viên Kế toán thanh toán | Nhân viên | TP Kế toán | *Mới 2026* |
| gd.banca@opes-kpi.demo | Trịnh Quang Vinh | GĐ TT Đối tác chiến lược và Bancassurance | Giám đốc + Người phê duyệt | PTGĐ | Hoàn thành tốt |
| tp.banca@opes-kpi.demo | Lương Văn Hải | Trưởng ban Kinh doanh Bancassurance | Trưởng ban | GĐ Banca | Hoàn thành |
| nv.yen@opes-kpi.demo | Tạ Thị Yến | Chuyên viên Phát triển kênh Bancassurance | Nhân viên | TB Kinh doanh Banca | Cần cố gắng |
| nv.manh@opes-kpi.demo | Kim Đức Mạnh | Chuyên viên Hỗ trợ kinh doanh | Nhân viên | TB Kinh doanh Banca | *Mới 2026* |
| gd.nhansu@opes-kpi.demo | Mai Thị Thu | GĐ TT Quản trị nguồn nhân lực | Giám đốc + Người phê duyệt | PTGĐ | Hoàn thành tốt |
| hr.admin@opes-kpi.demo | Phan Ngọc Linh | Chuyên viên C&B – Quản trị KPI | HR/KPI Admin + Nhân viên | GĐ Nhân sự | Hoàn thành |
| tp.hrbp@opes-kpi.demo | Vương Thị Hạnh | Trưởng ban Đối tác nhân sự | Trưởng ban | GĐ Nhân sự | Hoàn thành |
| nv.toan@opes-kpi.demo | Lâm Quốc Toàn | Chuyên viên Tuyển dụng | Nhân viên | TB Đối tác nhân sự | *Mới 2026* |

### Trạng thái dữ liệu
- **25 nhân sự** tham gia đánh giá + 1 tài khoản quản trị (`evaluationExempt` – tự loại khỏi danh sách khi khởi tạo kỳ).
- **Kỳ 2025** (`P2025`) – *Đã khóa*: 20 người, đủ bộ KPI giao TOP-DOWN (35 lần giao, chế độ A/B, có sub-KPI), tự đánh giá, QL trực tiếp
  đánh giá, QL trên 1 cấp phê duyệt, xác nhận điện tử, lịch sử, HR khóa 22/01/2026. Phân bố: Xuất sắc 2 · Hoàn thành tốt 5 · Hoàn thành 11 · Cần cố gắng 2.
- **Kỳ 2026** – *chưa tạo*. HR: *Quản trị → Kỳ đánh giá → Sao chép cấu hình sang kỳ mới* (trên kỳ 2025) → *Lưu* → *Khởi tạo danh sách nhân sự*
  (25 người) → *→ Đã cấu hình* → *→ Đang mở*. Sau đó các cấp lập/giao KPI và đánh giá như bình thường.

---

## 5. Hướng dẫn 8 kịch bản nghiệm thu

| # | Kịch bản | Tài khoản & thao tác chính |
|---|---|---|
| 1 | Đăng nhập & phân quyền | Đăng nhập sai mật khẩu → báo lỗi; `nv.maianh` chỉ thấy menu nhân viên; sửa URL `#/eval/form/P2026/u_nv_qlda1` → *Không có quyền*; đăng xuất → không vào lại được màn hình nghiệp vụ. |
| 2 | Cấu hình (HR) | `hr.admin`: *Kho KPI* (nhóm, KPI Public/Private + người được dùng), *KBI – Giá trị cốt lõi* (5 giá trị, mô tả mức 1–5), *Công thức, trọng số & xếp loại* (công thức + thử nghiệm, trọng số/X%, ma trận xếp loại + thử nghiệm), *Kỳ đánh giá* (tạo/sao chép cấu hình/chuyển trạng thái/chụp chính sách). |
| 3 | Giao KPI TOP-DOWN | `ptgd`: *Giao KPI TOP-DOWN* cho GĐ (chế độ A cố định hoặc B linh hoạt ≥ X%); kế hoạch đã duyệt cần *Mở sửa đổi* (có lý do) trước. `gd.cntt`: *Nhận KPI được giao* → tiếp nhận → giao tiếp sub-KPI cho Trưởng ban. `tb.hatang`: chỉnh trọng số dưới X% bị từ chối, trong giới hạn được chấp nhận (có lịch sử). |
| 4 | Sub-KPI | Trong *KPI của tôi* → biểu tượng *Tạo sub-KPI* ở chỉ tiêu cha; *Sửa chỉ tiêu → Phương pháp tổng hợp* (chấm trực tiếp / lấy kết quả sub-KPI / kết hợp). *Cây KPI* hiển thị cha – con, không tính trùng trọng số. |
| 5 | Đánh giá KPI | `nv.maianh`: *Đánh giá của tôi* → nhập kết quả, giải trình; tỷ lệ quy đổi & điểm KPI tính tức thời theo công thức của kỳ. |
| 6 | Đánh giá KBI | Cùng biểu mẫu: chọn mức 1–5 cho 5 giá trị cốt lõi (tự đánh giá); `tn.qlda` chấm cột quản lý, đánh dấu “hành vi mức 1–2” → giới hạn tối đa mức 3. |
| 7 | Trình ký & phê duyệt | Mai Anh *Gửi* → `tn.qlda` *Xác nhận* → `tb.qlda` *Phê duyệt* hoặc *Trả lại* (bắt buộc lý do) → `hr.admin` *Trình ký & phê duyệt → Khóa hồ sơ*; mở khóa phải có lý do. |
| 8 | Báo cáo | *Báo cáo & xuất dữ liệu*: theo cá nhân/đơn vị/nhóm KPI/KBI/xếp loại/so sánh kỳ/tiến độ/trọng số; xuất CSV/XLSX có metadata; *In* biểu mẫu theo mẫu BM KPI2025. Quản lý chỉ xuất được nhân sự thuộc phạm vi. |

---

## 6. Mô hình dữ liệu Realtime Database (tóm tắt)

| Đường dẫn | Nội dung |
|---|---|
| `system` | `initializedAt`, `schemaVersion`, `maintenance` (cửa sổ bảo trì) |
| `public/demoLoginOptions`, `public/branding` | Đọc công khai (trang đăng nhập) – không có mật khẩu |
| `emailIndex/{email,}` | Tra cứu userId theo email (chỉ chủ email đọc được) |
| `authLinks/{authUid}` | `{ userId, email }` – ánh xạ UID Firebase ↔ hồ sơ |
| `userProfiles/{userId}` | Hồ sơ nhân sự, đơn vị, quản lý trực tiếp, trạng thái |
| `userAccess/{userId}` | Vai trò + quyền đã tính theo ma trận (chỉ chính chủ/quản trị đọc) |
| `config/*` | `kpiGroups`, `scoringPolicies`, `kpiAggregation`, `kbiPolicies`, `gradingBands`, `weightPolicies`, `workflowTemplates`, `formTemplates`, `permissionPolicies`, `appSettings` |
| `organizationUnits`, `organizationVersions` | Cây tổ chức và các phiên bản cơ cấu |
| `kpiCatalogPublic`, `kpiCatalogPrivate`, `kpiCatalogAccessIndex/{userId}` | Danh mục KPI; Private chỉ người được cấp đọc được |
| `catalogHistory/{kpiId}` | Lịch sử chỉnh sửa danh mục |
| `kbiCatalog` | 5 giá trị cốt lõi + mô tả hành vi mức 1–5 |
| `evaluationPeriods/{p}` | Kỳ, trạng thái, `policies` (bản chụp chính sách của kỳ), phiên bản cơ cấu |
| `evaluationPeriodUsers/{p}/{u}` | Bản chụp người tham gia: đơn vị, quản lý trực tiếp, QL trên 1 cấp, chuỗi quản lý |
| `kpiPlans/{p}/{u}` | Kế hoạch KPI: chỉ tiêu, trọng số, tiếp nhận, lịch sử, xác nhận điện tử |
| `kpiAssignments/{p}/{fromUserId}/{id}` | Bản ghi giao KPI TOP-DOWN |
| `evaluations/{p}/{u}` | Tự đánh giá / quản lý / phê duyệt, kết quả cuối, chữ ký điện tử, lịch sử, trả lại |
| `delegations`, `notifications/{u}`, `auditLogs` | Ủy quyền, thông báo trong ứng dụng, nhật ký (chỉ thêm, không sửa/xóa) |

---

## 7. Phân quyền & Database Rules

- **Mặc định từ chối**; chỉ người đã đăng nhập *và* đã liên kết hồ sơ mới đọc dữ liệu nghiệp vụ.
- Quyền theo vai trò (ma trận trong `config/permissionPolicies`, sửa tại *Quản trị → Vai trò & phân quyền*) được tính sẵn
  vào `userAccess/{id}/perms`; chỉ người có `manageUsers` mới ghi được, người dùng không tự cấp quyền.
- Quyền theo **quan hệ** do Rules kiểm tra trực tiếp trên bản chụp của kỳ (`evaluationPeriodUsers`):
  quản lý trực tiếp, quản lý trên 1 cấp, chuỗi quản lý (người giao KPI phải là cấp trên trong chuỗi).
- **Quy trình**: Rules ràng buộc từng chuyển trạng thái hợp lệ (ai, từ trạng thái nào sang trạng thái nào), bắt buộc
  tăng phiên bản, đóng dấu thời gian máy chủ (`now`), lý do khi trả lại/mở khóa, khóa nội dung sau khi gửi.
- **KPI được giao**: chế độ A – người nhận không sửa được trọng số; chế độ B – Rules chặn trọng số < X% (và > tối đa nếu có).
- **Danh mục Private**: chỉ người tạo, người được cấp (qua chỉ mục) và quản trị đọc được.
- **Audit log / lịch sử**: chỉ được thêm mới, `actorId` phải là chính người ghi, không sửa/xóa.

Sinh lại Rules sau khi chỉnh logic: `node tools/build-rules.mjs`.

### Kiểm thử
```bash
npm test               # bộ máy tính điểm (16 kiểm thử, gồm đối chiếu công thức Excel BM KPI2025)
node --test tests/carryover.test.mjs   # Thêm KPI từ năm trước (6 nhóm kiểm thử trên dữ liệu kỳ 2025)
npm run test:rules     # chạy tests/rules/scenarios.mjs trên Firebase Database Emulator (cần Java 11+)
```
Có thể thử nhanh trên Console: *Realtime Database → Rules → Rules Playground*, ví dụ:
- *Read* `/userAccess` với *Authenticated* (uid bất kỳ) → **Denied**.
- *Write* `/evaluations/P2026/u_nv_qlda2/status` = `"approved"` với uid của nhân viên → **Denied**.

---

## 8. Chức năng đã hoàn thành

- **Đăng nhập** Firebase Auth Email/Password, thông báo lỗi tiếng Việt, danh sách tài khoản demo từ RTDB, tự liên kết UID,
  đăng xuất hủy toàn bộ listener.
- **Dashboard** theo vai trò: tiến độ kỳ, việc cần xử lý, thống kê trạng thái, phân bố xếp loại, cảnh báo quá hạn.
- **Cơ cấu tổ chức**: cây từ PTGĐ thường trực → 12 trung tâm → ban/phòng/nhóm; thêm/sửa/đổi đơn vị cha/ngừng đơn vị, người đứng đầu,
  hiệu lực và phiên bản cơ cấu.
- **Danh mục KPI**: nhóm KPI, KPI Public/Private, phạm vi áp dụng, phiên bản, sao chép, ngừng dùng, tra cứu nơi đang dùng, lịch sử.
- **Danh mục KBI**: 5 giá trị cốt lõi (Khát Vọng, Kỷ cương, Sáng tạo, Chính trực, Hiệu quả), mô tả hành vi mức 1–5, theo dõi KBI.
- **Kỳ đánh giá**: tạo, sao chép cấu hình, luồng trạng thái Nháp → … → Đã lưu trữ, chụp chính sách & phiên bản cơ cấu, khởi tạo danh sách nhân sự tham gia, hạn chót.
- **Thêm KPI từ năm trước**: chọn lại KPI trong kế hoạch kỳ trước của chính mình; KPI danh mục được kiểm tra lại (còn tồn tại, đang sử dụng, áp dụng cho vị trí/đơn vị, KPI Private còn quyền) và thêm theo phiên bản danh mục hiện hành; KPI không có trong danh mục được thêm như KPI tạo mới; KPI ngừng sử dụng/không áp dụng/hết quyền hoặc đã có trong kế hoạch không chọn được; giữ quan hệ KPI cha – sub-KPI, tùy chọn giữ mục tiêu năm trước, sửa trọng số trước khi thêm, ghi lịch sử & audit.
- **Kế hoạch KPI**: thêm từ kho/tạo mới, trọng số, kiểm tra tổng 100% (KPI cấp cao nhất và tổng tỷ lệ sub-KPI trong từng KPI cha) và ràng buộc nhóm, trình duyệt, phê duyệt 2 cấp, trả lại, mở sửa đổi.
- **Giao KPI TOP-DOWN**: giao từ kho/KPI của mình/KPI mới cho nhiều người, chế độ A (cố định) / B (linh hoạt ≥ X%), nháp – gửi – thu hồi – điều chỉnh,
  hộp thư *KPI được giao*, tiếp nhận / đề nghị điều chỉnh, thông báo, lịch sử.
- **Sub-KPI**: nhiều cấp, tỷ lệ trong KPI cha, 3 cách tổng hợp, không tính trùng trọng số, *Cây KPI* truy vết cha – con và giao xuống cấp dưới.
- **Biểu mẫu đánh giá** kiểu Excel theo BM KPI2025 (phần I–VI): nhập kết quả, giải trình, minh chứng, cột quản lý, KBI mức 1–5,
  tính điểm tức thời, lưu từng trường, xác nhận điện tử 3 bên (người, thời điểm, phiên bản, mã băm nội dung).
- **Trình ký & phê duyệt**: hàng đợi theo vai trò, trả lại về nhân viên/quản lý trực tiếp, khóa/mở khóa (có lý do), ủy quyền.
- **Báo cáo**: theo cá nhân, đơn vị, nhóm KPI, KBI, xếp loại, so sánh kỳ, tiến độ, trọng số; xuất CSV/XLSX kèm metadata; in biểu mẫu.
- **Quản trị**: người dùng, ma trận vai trò & quyền, công thức tính điểm (8 phương pháp + công thức tùy biến an toàn + thử nghiệm),
  tổng hợp KPI, chính sách KBI, ma trận xếp loại (+ thử nghiệm), trọng số & X%, quy trình, biểu mẫu, nhãn trạng thái, audit log, bảo trì dữ liệu.
- Giao diện tiếng Việt, responsive desktop/tablet/mobile, định dạng số/ngày kiểu Việt Nam, chống chèn HTML (mọi dữ liệu được escape).

---

## 9. Giới hạn của POC (không có backend)

1. **Tính điểm ở trình duyệt**: điểm KPI/KBI/xếp loại cuối được client tính và ghi (`final`). Rules kiểm soát *ai* được ghi và *khi nào*,
   kèm mã băm nội dung; khi HR khóa hồ sơ, ứng dụng tính lại và cập nhật nếu lệch, nhưng máy chủ không tự kiểm chứng phép tính. Môi trường thật
   nên tính lại bằng Cloud Functions hoặc backend.
2. **Nội dung audit log do client ghi**: Rules bảo đảm chỉ thêm mới, đúng người ghi, đúng thời điểm máy chủ, nhưng không thể bảo đảm
   mọi thao tác đều có log hay nội dung `before/after` chính xác.
3. **Hạn chót** chỉ cảnh báo trên giao diện; Rules chưa chặn theo ngày (tùy chọn `enforceDeadlines` để dành cho backend).
4. **Xác nhận điện tử không phải chữ ký số** có giá trị pháp lý – chỉ là bản ghi người/thời điểm/phiên bản/mã băm.
5. **Danh bạ nhân sự** (`userProfiles`) đọc được bởi mọi người dùng đã liên kết (cần cho hiển thị tên/cây tổ chức). Dữ liệu nhạy cảm
   (quyền, đánh giá, kế hoạch) vẫn được giới hạn theo phạm vi.
6. **Danh sách tài khoản demo** ở `public/demoLoginOptions` đọc công khai khi `public/demoEnabled = true` – tắt tại *Quản trị → Cấu hình & dữ liệu → Tắt danh sách demo*.
7. **Liên kết tài khoản theo email**, không bắt buộc `email_verified`. Phải tắt *sign-up* sau khi tạo tài khoản; môi trường thật nên dùng SSO
   hoặc yêu cầu xác minh email.
8. **Thông báo trong ứng dụng** do client ghi (không gửi email/push). Người dùng có thể nhận thông báo từ người có quan hệ nghiệp vụ hợp lệ.
9. **Tạo tài khoản Auth** chỉ qua Console hoặc công cụ provision dùng Auth SDK thông thường – không tạo tài khoản đặc quyền từ RTDB.
10. Các thao tác nhiều bản ghi (khóa hàng loạt, áp dụng ma trận quyền) chạy tuần tự từ trình duyệt; không có giao dịch phân tán.
11. File `js/seed/demo-data.json` được phục vụ công khai cùng Hosting để phục vụ nút khởi tạo – xóa khỏi bản triển khai thật.

---

## 10. Cấu hình demo cần HR xác nhận

Tất cả nằm trong `config/*` (sửa trên giao diện), được gắn nhãn *“Cấu hình demo – cần HR xác nhận”* và được **chụp vào từng kỳ**
khi mở kỳ (thay đổi sau đó không ảnh hưởng kỳ đang chạy cho tới khi HR dùng *Cập nhật chính sách áp dụng cho kỳ*, có lý do).

| Cấu hình | Giá trị demo |
|---|---|
| `sp_tiered_excel` – Ba mốc theo Excel 2025 | < Ngưỡng → 0%; = Ngưỡng → 80%; Ngưỡng–Cơ bản = KQ/Ngưỡng × 80%; = Cơ bản → 100%; Cơ bản–Đẩy mạnh = KQ/Cơ bản × 100%; ≥ Đẩy mạnh → 120% |
| `sp_tiered_linear` / `sp_tiered_lower` | Nội suy tuyến tính (Ngưỡng 80% – Cơ bản 100% – Đẩy mạnh 120%); bản “càng thấp càng tốt” cho sự cố/thời gian xử lý |
| `sp_scale_1_5` – Thang 1–5 | Mức 1–2 → 0%, 3 → 80%, 4 → 100%, 5 → 120% |
| `sp_ratio`, `sp_pass_fail`, `sp_milestone`, `sp_formula_demo` | KQ/Cơ bản tối đa 120%; Đạt 100%/Không đạt 0%; mốc tiến độ 110/100/90/80% → 120/100/80/50%; `clamp(A/B, 0, 1.2)` |
| Tổng hợp KPI | Điểm KPI = Σ(Trọng số × Tỷ lệ quy đổi); lấy số quản lý nếu có, không thì số tự đánh giá; thiếu dữ liệu → chưa hoàn thành; làm tròn 2 chữ số |
| Chính sách KBI | Điểm chính thức = điểm quản lý trực tiếp (tự đánh giá để đối chiếu); trung bình cộng 5 giá trị; “đạt 4 nhưng có hành vi mức 1–2” → tối đa mức 3 |
| Ma trận xếp loại | Băng KPI 70/80/95/110/120% × băng KBI 2/3/4/4,5 theo công thức ô “Điểm xếp loại” mẫu Excel; **KPI < 70% → “Không hoàn thành” là giả định demo** (Excel không quy định) |
| Phương án thay thế (tắt) | Điểm chung = 70% KPI + 30% KBI quy đổi; quy tắc đặc biệt “có giá trị mức 1 → tối đa Cần cố gắng” (đang tắt) |
| Trọng số | Tổng 100% (sai số 0,01); mỗi chỉ tiêu 5–50%; không giới hạn theo nhóm (có thể thêm tại *Công thức, trọng số & xếp loại*); X% mặc định 5% (người giao đặt cao hơn được) |
| Quy trình | Kế hoạch: nhân viên → QL trực tiếp → QL trên 1 cấp; Đánh giá: nhân viên → QL trực tiếp → QL trên 1 cấp → HR khóa |

### Khác biệt phát hiện trong mẫu Excel `BM KPI2025` (đề nghị HR xác nhận)
1. `D44` (Điểm KBI) = `O38` – chỉ lấy điểm quản lý của giá trị **Hiệu quả**, không phải trung bình KBI.
2. `O39` = `AVERAGE(O35:O38)` và `I39` = `AVERAGE(I35:I38)` bỏ sót dòng 34 (**Khát Vọng**).
3. `I38` = `AVERAGE(I34:I37)` thay vì công thức mức của dòng Hiệu quả; `I35` (Kỷ cương – tự đánh giá) không có công thức.
4. Ô kết quả KPI để trống được tính **0%** – ứng dụng coi là *Chưa có dữ liệu* (không tính 0, không xếp loại chính thức).
5. Công thức ba mốc chỉ liên tục khi Ngưỡng = 80% Cơ bản; không hỗ trợ chỉ tiêu “càng thấp càng tốt”.
6. `D45` không quy định KPI < 70% và KPI ≥ 200% (trả “Chưa có kết quả”); với KPI ≥ 120% và KBI trống (= 0) vẫn ra “Cần cố gắng”.
7. Sheet *B.Hành vi cốt lõi* là bộ giá trị cũ – ứng dụng dùng bộ 5 giá trị cốt lõi mới theo yêu cầu.

---

## 11. Trước khi dùng thật (checklist)
- Đặt `POC_LOGIN_HINT = ''`, tắt danh sách demo (`public/demoEnabled = false`), xóa `js/seed/demo-data.json` khỏi Hosting.
- Đổi mật khẩu/tài khoản, tắt sign-up, cân nhắc SSO và `email_verified`.
- Chuyển tính điểm cuối, khóa hàng loạt, audit log và thông báo sang Cloud Functions/backend.
- Bổ sung Content-Security-Policy trong `firebase.json` (ví dụ `script-src 'self' https://www.gstatic.com`; `connect-src` cho
  `*.firebaseio.com`, `*.firebasedatabase.app`, `identitytoolkit.googleapis.com`, `securetoken.googleapis.com`).
- HR xác nhận toàn bộ cấu hình ở mục 10 và bỏ nhãn demo.
