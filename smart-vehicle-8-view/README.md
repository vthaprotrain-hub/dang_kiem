# Smart Vehicle 8-View Capture POC

POC chạy hoàn toàn trên trình duyệt, hướng dẫn khách hàng chụp **8 góc xe** theo chiều kim đồng hồ để phục vụ cấp đơn bảo hiểm.
Không có backend, không upload ảnh, không GPS. Ảnh và metadata chỉ nằm trong IndexedDB của thiết bị và có nút xóa sạch.

> **Trạng thái trung thực của POC** — hãy đọc mục [Giới hạn & những gì chưa kiểm chứng](#giới-hạn--những-gì-chưa-kiểm-chứng) trước khi đánh giá kết quả.
> Ứng dụng *không* giả vờ AI nhận diện được những thứ mà COCO-SSD không làm được (kính chắn gió, đèn, biển số, đầu xe và đuôi xe).
> Mọi dữ liệu giả lập đều mang nhãn **"DEMO — DỮ LIỆU GIẢ LẬP"**.

---

## 1. Chạy thử

Cần một static server (ES module không chạy được từ `file://`). Không cần build, không cần `npm install`.

```bash
cd smart-vehicle-8-view
python3 -m http.server 8080        # hoặc: npx serve .   /   php -S localhost:8080
# mở http://localhost:8080
```

* **Máy tính** (`localhost` được trình duyệt coi là an toàn): thử được camera thật (webcam) và chế độ **DEMO**. Máy tính không có cảm biến chuyển động nên ứng dụng tự chuyển sang *chế độ thủ công*.
* **Điện thoại thật** — camera và cảm biến chuyển động **bắt buộc HTTPS**. Cách nhanh nhất:
  * Đẩy thư mục lên hosting tĩnh có HTTPS (Cloudflare Pages, GitHub Pages, Netlify, Vercel…), hoặc
  * Mở tunnel tới server local: `cloudflared tunnel --url http://localhost:8080` hoặc `ngrok http 8080`, rồi mở URL `https://…` trên điện thoại.
* **iOS Safari**: quyền cảm biến chỉ được xin khi người dùng bấm nút ("Bật quyền cảm biến" hoặc "Bắt đầu chụp ảnh") — ứng dụng đã xử lý đúng yêu cầu này.
* **Toàn màn hình (ẩn thanh địa chỉ)**: trên Android, bấm "Bắt đầu chụp ảnh" là tự vào toàn màn hình và khóa trình duyệt ở hướng dọc; nút ⛶ trên màn hình chụp để bật/tắt. **Safari trên iPhone không cho trang web vào toàn màn hình** — hãy "Chia sẻ → Thêm vào MH chính" rồi mở từ biểu tượng (dự án có `manifest.webmanifest` + biểu tượng nên chạy như ứng dụng, không có thanh địa chỉ), và bật *Khóa hướng dọc* trong Trung tâm điều khiển.
* **Cần Internet lần đầu**: TensorFlow.js, COCO-SSD (và Tesseract.js nếu bật OCR) được tải từ CDN, kèm trọng số COCO-SSD từ `storage.googleapis.com`. Từ lần thứ hai dữ liệu được lấy lại từ bộ nhớ đệm trên máy (xem mục *Tải sẵn dữ liệu AI*). Có thể tự host (xem `assets/models/README.md`).
* Không có mạng / CDN bị chặn: thẻ tải AI chuyển sang trạng thái lỗi, nêu rõ tệp nào không tải được, có nút **Thử tải lại**; nếu chỉ OCR lỗi mà model nhận diện xe đã sẵn sàng thì có thêm **Bỏ qua OCR và tiếp tục**. Chế độ DEMO vẫn dùng được (không cần AI). Ứng dụng không bỏ qua bước nhận diện một cách âm thầm.
* **Khi cập nhật lên bản mới**: tải lại trang có xóa cache (Ctrl/Cmd + Shift + R; trên điện thoại: đóng tab rồi mở lại) để trình duyệt lấy mã JS mới.

### Tải sẵn dữ liệu AI (v0.4)

* **Tải ngay khi mở trang.** Vừa vào màn hình 1, ứng dụng tải và khởi tạo luôn TF.js + COCO-SSD và Tesseract.js (worker, lõi WASM, dữ liệu ngôn ngữ `eng`) — không đợi tới lúc bấm chụp.
* **Nút "Bắt đầu chụp ảnh" chỉ mở khi AI đã sẵn sàng** (chế độ camera thật). Trong lúc tải, nút hiện "Đang tải AI… 64% · ~8 giây" và được tô dần theo %. Chế độ **DEMO không bị chặn** vì DEMO không dùng AI. Nút "Tiếp tục phiên dang dở" cũng chờ AI.
* **Thẻ tiến trình** ở đầu màn hình 1: thanh % (88% là dung lượng tải về theo byte thật, 12% là bước khởi tạo model/OCR), **loại dữ liệu đang tải** ("Đang tải: Trọng số COCO-SSD (phần 3/5) · +2 tệp song song"), **dung lượng đã tải / tổng**, **tốc độ** và **thời gian ước lượng còn lại**. Mở "Chi tiết từng tệp" để xem trạng thái từng tệp (đang tải / xong / lấy từ bộ nhớ máy / lỗi). Khi xong: "Dữ liệu AI đã sẵn sàng · COCO-SSD lite_mobilenet_v2 (webgl) · OCR biển số", tổng dung lượng và thời gian tải.
  * Tổng dung lượng được biết trước khá chính xác: kích thước từng phần trọng số đọc từ `model.json` (mỗi phần 4 MB), các tệp khác dùng `Content-Length` hoặc kích thước ước lượng sẵn trong `config.js`.
  * Thời gian còn lại = dung lượng còn lại ÷ tốc độ trung bình trượt (EMA), cộng vài giây khởi tạo; lúc mới bắt đầu dùng `navigator.connection.downlink` nếu trình duyệt có. Đây là **ước lượng**, mạng di động dao động thì con số dao động theo.
* **Lưu trên máy cho lần sau.** Thư viện, model.json và trọng số COCO-SSD, worker/lõi Tesseract được lưu trong **Cache Storage** (`sv8v-ai-v1`); dữ liệu ngôn ngữ Tesseract được chính Tesseract lưu trong IndexedDB `keyval-store`. Lần mở sau gần như không tải lại từ mạng. Mục **"Dữ liệu AI đã lưu trên máy: … MB · Xóa"** trong Cấu hình để giải phóng dung lượng. Dữ liệu AI này không phải dữ liệu phiên chụp nên nút *Xóa toàn bộ dữ liệu phiên* không xóa nó.
* **Chịu lỗi mạng:** tải song song tối đa 3 tệp, mỗi tệp có nguồn dự phòng (jsDelivr → unpkg), tệp "đứng" quá 30 giây thì bỏ và thử nguồn khác; COCO-SSD và OCR tải song song nhưng độc lập, OCR lỗi không làm hỏng model nhận diện xe.
* **Đổi model trong Cấu hình rồi xác nhận để tải luôn.** Chọn model nhận diện (`lite_mobilenet_v2` ~18 MB, nhanh – mặc định; `mobilenet_v1` ~27 MB; `mobilenet_v2` ~67 MB, chính xác hơn nhưng nặng và chậm trên điện thoại), backend (WebGL / WASM / CPU) hoặc bật/tắt OCR → xuất hiện khối **"Áp dụng & tải ngay" / "Hủy"**. Bấm áp dụng: model lớn (> 40 MB) có hộp thoại xác nhận dung lượng; sau đó thẻ tiến trình chạy lại và nút bắt đầu khóa cho tới khi model mới sẵn sàng. Model cũ được giải phóng khỏi bộ nhớ GPU. Lựa chọn được nhớ cho lần sau.
* Kỹ thuật: mã thư viện được nạp từ Blob URL của dữ liệu đã tải; trọng số COCO-SSD được TF.js đọc thẳng từ bộ nhớ (không tải lần hai); lõi Tesseract chọn bản SIMD nếu trình duyệt hỗ trợ (`tesseract-core-simd-lstm`), ngược lại bản thường. Mã ở `js/aiPreloader.js`.

## 2. Cách dùng

**Màn hình 1 – Thiết lập.** Chọn loại xe (9 loại: xe con, SUV/Crossover, Sedan, Hatchback, MPV, bán tải, xe tải, xe khách/xe buýt, khác), nhập biển số (tùy chọn) và tên phiên, xem sơ đồ 8 góc, đọc hướng dẫn, kiểm tra camera / cảm biến / AI. Đầu màn hình là thẻ **tải dữ liệu AI** (%, loại dữ liệu, thời gian còn lại). Tùy chọn: giọng nói tiếng Việt, tự chụp, OCR biển số, model COCO-SSD, backend TF.js (đổi xong bấm *Áp dụng & tải ngay*), ngưỡng confidence, chế độ kiểm thử (HUD + thanh chỉnh ngưỡng), chế độ DEMO, xóa dữ liệu AI đã lưu. Có thẻ "tiếp tục phiên dang dở" và nút **Xóa toàn bộ dữ liệu phiên trên thiết bị**.

**Màn hình 2 – Camera thông minh.**
1. Hướng camera vào xe → COCO-SSD phát hiện xe (có thể chạm vào xe để khóa nếu có nhiều xe). Trên màn hình chỉ có **khung bao xe** (góc khung + viền đứt) với tỷ lệ theo loại xe và góc cần chụp; không vẽ hình xe đè lên ảnh camera.
2. Ứng dụng hỏi **"Bạn đang đứng ở đầu xe hay đuôi xe?"** (COCO-SSD không phân biệt được; bằng chứng hình học/OCR được hiển thị kèm theo). Nếu hình dạng xe trong khung trông giống góc chéo/ngang, ứng dụng nhắc đứng chính diện, nhưng người dùng vẫn có thể **bấm nút chụp để tự xác nhận** (không bị kẹt chờ heuristic). Xác nhận xong điểm xuất phát được đặt, mini-map 8 góc xoay theo.
3. Chụp góc xuất phát (ảnh dọc), sau đó đi **sang trái của bạn** quanh xe (khi bạn nhìn vào xe, đi vòng thuận chiều kim đồng hồ nghĩa là bước sang trái). Mỗi lúc chỉ có **một** câu hướng dẫn chính; mũi tên chỉ hướng đi kèm **số bước ước lượng** ("~4 bước"); khi sắp tới góc thì nhắc "đi chậm lại"; tới đúng chỗ có âm báo nhẹ + rung nhẹ (Android) + câu "Đúng vị trí rồi…".
   * **Xoay máy mà không xoay trình duyệt.** Màn hình được khóa dọc (Android: tự khóa khi toàn màn hình; iPhone: bật khóa xoay). Khi bạn cầm ngang, ứng dụng đọc **cảm biến hướng (gyro/gia tốc)** và **xoay riêng lớp giao diện** (chữ, khung, nút, bản đồ, hộp thoại) bằng CSS — trình duyệt không phải dựng lại trang nên không khựng. Khung hình đưa vào AI và **ảnh lưu được xoay về đúng chiều ngang/dọc** theo cách bạn cầm máy. Nếu máy không có cảm biến hướng, gợi ý xoay có nút "Giao diện không tự xoay? Chạm để chuyển". Nếu trình duyệt vẫn tự xoay (không khóa), ứng dụng dùng bố cục ngang thật như bình thường.
   * **Giọng nói**: chọn giọng tiếng Việt tự nhiên nhất trên máy (ưu tiên giọng Natural/Online/Google), đọc chậm và mềm hơn, câu thân thiện ("…nhé"); không ngắt câu đang đọc trừ khi có thông điệp quan trọng hơn (sai chiều, đúng vị trí, ảnh chưa đạt); không lặp một câu trong ~9 giây. Nút loa tắt cả giọng nói và âm báo.
4. **AI chỉ chạy khi cần**: lúc đang đi giữa hai góc (cảm biến cho biết còn cách góc mục tiêu > ~38°) model tạm nghỉ (chip "AI: nghỉ khi đang di chuyển"), tới gần (≤ ~32°) thì chạy lại và chỉ cho chụp khi có kết quả nhận diện MỚI. Không có cảm biến thì model chạy liên tục (không biết bạn đang ở đâu). OCR biển số chỉ chạy ở bước xác định điểm xuất phát (khi có nhập biển số); worker Tesseract được khởi tạo sẵn từ màn hình 1 nên không phải chờ tải lúc đang chụp.
   Khi tới đúng góc, vòng sáng và nút chụp sẵn sàng. Mỗi ảnh được kiểm tra chất lượng (mờ, tối/cháy sáng, xe bị cắt/quá gần/quá xa, trùng ảnh góc khác, góc sai nếu có model). Ảnh không đạt **không được lưu**, có lý do rõ ràng và nút chụp lại.
5. Mini-map 8 góc nhỏ gọn (~92 px), **kéo thả được** tới bất kỳ chỗ nào trên màn hình (vị trí nhớ riêng cho dọc/ngang; chạm đúp thanh kéo phía trên để về chỗ mặc định). Chạm một nút: góc đã chụp = chụp lại góc đó; góc mục tiêu = đặt lại vị trí khi cảm biến lệch. Kéo bắt đầu từ một nút sẽ không kích hoạt nút đó.
6. Nếu chụp lỗi vì lý do kỹ thuật, thông báo nói rõ **bước nào** lỗi (lấy khung hình / phân tích / mã hóa JPEG / lưu vào trình duyệt) kèm chi tiết ngắn để báo lại; state machine luôn quay về trạng thái chụp được.

**Màn hình 3 – Xem lại.** Mỗi thẻ có khung ảnh cố định 4:3 hiển thị **trọn** ảnh (ảnh dọc đầu/đuôi xe không bị cắt hay làm lệch lưới), nhãn "Dọc/Ngang" theo ảnh thực tế. Lưới 8 ảnh với trạng thái thật của từng góc (đã đạt / cần chụp lại / chưa có), huy hiệu chất lượng, xác minh góc (tự động / model / thủ công / DEMO), xem phóng to, chụp lại một góc (chỉ thay đúng góc đó, ảnh cũ chỉ bị thay khi ảnh mới đạt), xóa, tải từng ảnh, **tải ZIP** (images/ + session.json + README.txt), **xuất JSON**, **xóa toàn bộ dữ liệu phiên**.

**Chế độ DEMO.** Camera là cảnh wireframe tổng hợp (xe, hậu cảnh thay đổi theo góc đi vòng). Bảng DEMO (nút "DEMO" ở góc) cho phép đi bộ quanh xe theo chiều kim đồng hồ/ngược lại, bật/tắt các tình huống *Có xe trong khung*, *Thêm xe thứ hai*, *Xe bị cắt mép*, *Xe quá xa*, *Cảm biến bật*, *Rung / nhiễu*, chọn chất lượng ảnh sắp chụp (*Tốt / Mờ / Tối / Không có xe / Xe bị cắt*, áp dụng cho lần chụp kế tiếp), đổi hướng máy ảo dọc/ngang và **chạy tự động 8 góc**. DEMO đi qua *cùng* navigator, state machine, bộ kiểm tra ảnh và lưu trữ như chế độ thật; chỉ nguồn camera/cảm biến/nhận diện xe là giả lập. Mọi khung hình (kể cả ảnh được "chụp") có watermark **DEMO — DỮ LIỆU GIẢ LẬP**, hộp nhận diện màu cam gắn nhãn DEMO, metadata `source: "demo"`.

## 3. Cấu trúc dự án

```
index.html                      3 màn hình + SVG sprite + sheet/viewer/demo panel
manifest.webmanifest            chạy như ứng dụng (toàn màn hình, hướng dọc) khi "Thêm vào màn hình chính"
assets/
  icons/favicon.svg, icon-180/192/512.png
  placeholders/{sedan,suv,pickup,truck}/   (xem README trong thư mục: khung xe được vẽ bằng code)
  models/                       chỗ đặt model tùy chọn (README.md hướng dẫn)
css/                            reset, variables, layout, setup, camera, mini-map, overlays, preview
js/
  app.js                        điểm vào, định tuyến 3 màn hình, bắt lỗi toàn cục
  config.js                     TOÀN BỘ ngưỡng, danh sách 8 góc, mô hình hình học 9 loại xe, URL thư viện
  stateMachine.js               FSM 15 trạng thái dạng bảng chuyển
  appState.js                   store trung tâm (settings, vehicle, session, captures, nav, sensors, ai…)
  captureStore.js               IndexedDB (ảnh Blob + thumbnail + metadata) + dự phòng RAM + export JSON
  cameraManager.js              getUserMedia, đổi camera, vòng đời stream
  cameraOrientation.js          hướng màn hình + hướng CẦM MÁY từ cảm biến (xoay giao diện ảo) + toàn màn hình/khóa hướng
  aiPreloader.js                tải sẵn TF.js/COCO-SSD/Tesseract khi mở trang: % theo byte, tốc độ, thời gian còn lại, Cache Storage
  aiDetector.js                 nạp TF.js + COCO-SSD, chọn backend, vòng lặp nhận diện, tracker ổn định, classifier tùy chọn
  plateOCR.js                   OCR biển số bằng Tesseract.js (tùy chọn), chuẩn hóa/so khớp biển số VN
  vehicleOrientationDetector.js xác định đầu/đuôi xe bằng danh sách bằng chứng có trọng số
  viewAngleDetector.js          ước lượng góc nhìn (5 lớp, xem mục 4)
  movementTracker.js            góc quỹ đạo người chụp từ DeviceOrientation/Motion + bằng chứng camera
  clockwiseNavigator.js         chọn một chỉ dẫn chính + sự kiện cho FSM
  imageQualityValidator.js      kiểm tra ảnh (mờ, tối, bbox, trùng, góc) + điểm chất lượng
  miniMap.js                    mini-map 8 góc (SVG) + sơ đồ vòng ở màn hình 1
  voiceGuide.js                 Web Speech API: chọn giọng vi-VN tự nhiên, xếp hàng câu nói, không nói đè
  sound.js                      âm báo nhẹ (Web Audio) + rung nhẹ khi tới góc / ảnh đạt / cảnh báo
  captureController.js          chụp → phân tích → xác minh góc → lưu; chụp lại; xóa; export
  cameraScreen.js               điều phối màn hình 2
  setupController.js            màn hình 1        previewController.js  màn hình 3
  demoSource.js                 nguồn giả lập DEMO + bảng điều khiển + chạy tự động
  placeholders.js               mô hình hình học 3D 9 loại xe: khung bao hướng dẫn, icon loại xe, cảnh DEMO
  uiKit.js · strings.js · utils.js · zipWriter.js
```

### Luồng dữ liệu

```
camera ──► DetectionLoop (COCO-SSD) ─► VehicleTracker ─┐
sensors ─► MovementTracker (θ quỹ đạo + confidence) ───┼─► ViewAngleDetector ─► ClockwiseNavigator ─► event ─► StateMachine
orientation ───────────────────────────────────────────┘                          │ guidance (1 câu)            │
                                                                                  ▼                             ▼
                                                              UI: banner · mũi tên · mini-map · giọng nói · nút chụp
shutter ─► grab frame ─► analyzeCapture (chất lượng + nhận diện ảnh tĩnh + classifier?) ─► decideAngleVerification
        ─► [không đạt → sheet lý do, KHÔNG lưu]  [cần xác nhận → sheet xác nhận thủ công]  ─► acceptCapture (IndexedDB) ─► NEXT / COMPLETED
```

### State machine

```
WAITING_FOR_VEHICLE ─VEHICLE_FOUND→ VEHICLE_DETECTED ─VEHICLE_STABLE→ IDENTIFYING_START_POINT ─START_CONFIRMED→ READY_FOR_CAPTURE
        ▲                                   │ VEHICLE_LOST (về WAITING_FOR_VEHICLE)                                   │ SHUTTER_START
        │                                                                                                           ▼
        │    ┌──────── AT_TARGET ────────┐                                                        CAPTURING_FRONT / CAPTURING_CURRENT_ANGLE
        │    ▼                           │                                                                          │ FRAME_GRABBED
        │ READY_FOR_CAPTURE ◄── MOVING_CLOCKWISE ◄──NEXT── CAPTURE_ACCEPTED ◄──CAPTURE_VALID── VALIDATING_CAPTURE ──CAPTURE_INVALID→ CAPTURE_REJECTED ─RETRY→ READY_FOR_CAPTURE
        │                                   │  ├ WRONG_DIRECTION → POSSIBLE_WRONG_DIRECTION ─DIRECTION_OK→
        │                                   │  ├ NEED_REPOSITION → NEED_REPOSITION ─REPOSITION_OK→
        │                                   │  └ NEED_LANDSCAPE / NEED_PORTRAIT → WAITING_FOR_LANDSCAPE / WAITING_FOR_PORTRAIT ─ORIENTATION_OK→
                                            └ ALL_DONE (8/8) → COMPLETED
```

Giao diện không dùng cờ boolean rời rạc để quyết định pha chụp: mọi chuyển pha đi qua `fsm.send(event)`; sự kiện không hợp lệ tại trạng thái hiện tại bị từ chối và ghi log. Thứ tự ưu tiên của chỉ dẫn: *sai hướng điện thoại → không thấy xe → đi ngược chiều → xe/khung chưa đạt khi đã gần góc → hướng dẫn di chuyển.*

## 4. Các thuật toán (và độ tin cậy thực tế)

**Phát hiện xe (COCO-SSD, mặc định `lite_mobilenet_v2`, đổi được sang `mobilenet_v1`/`mobilenet_v2`).** Chỉ dùng các lớp `car`, `truck`, `bus` với ngưỡng confidence chỉnh được. Tracker yêu cầu bbox ổn định N khung liên tiếp (IoU), cho phép mất vài khung (grace), phát hiện nhiều xe và cho khóa chiếc xe chính, phát hiện xe bị cắt mép/quá gần/quá xa. COCO-SSD **không** nhận ra kính, đèn, biển số, đầu xe hay đuôi xe.

**Điểm xuất phát (đầu hay đuôi).** `vehicleOrientationDetector` gom bằng chứng, mỗi bằng chứng có trọng số riêng: tỷ lệ bbox so với khung hình học của loại xe (chỉ cho biết đang nhìn *dọc* hay *chéo/ngang*), OCR biển số (cho biết đang nhìn một đầu xe nhưng *không biết đầu hay đuôi*), màu đèn (rất yếu, bị chặn trần), classifier tùy chọn, và xác nhận của khách. Đầu/đuôi hầu như luôn cần **một lần chạm xác nhận**; nếu OCR đọc ra biển số khác biển nhập thì phải tick xác nhận thêm. Nếu không có biển số kỳ vọng thì OCR không được chạy (không tải Tesseract vô ích).

**Vị trí người chụp quanh xe.** `movementTracker` tính hướng nhìn camera từ alpha/beta/gamma, lọc EMA, rồi
`θ = góc xuất phát + Δheading + Δ(độ lệch ngang của xe trong khung)`.
Chỉ dùng thay đổi *tương đối* so với mốc (không dựa vào la bàn/GPS); độ lệch của xe bù trường hợp xoay máy tại chỗ. Có hysteresis hướng đi và `confidence` từ độ tươi của cảm biến, độ nghiêng, độ rung. Đây là ước lượng heuristic: gyro trôi, người dùng không giữ xe ở giữa khung hoặc đi thẳng thay vì đi vòng đều làm θ lệch. Vì vậy mini-map có thể được đặt lại bằng một lần chạm.

**Ước lượng góc nhìn 5 lớp (`viewAngleDetector`).** (1) COCO-SSD → có xe/bbox; (2) tỷ lệ bbox ↔ khung hình học (phân biệt dọc/chéo/ngang, *không* phân biệt trước↔sau hay trái↔phải); (3) cảm biến → θ; (4) classifier 8 góc tùy chọn; (5) hợp nhất xác suất có trọng số + EMA + hysteresis. Khi thiếu nguồn phân biệt (cảm biến đủ tin cậy hoặc classifier) kết quả được gắn `needsManualConfirmation`.

**Hướng cầm máy khi màn hình khóa dọc (`cameraOrientation.js`).** Từ DeviceOrientation tính vector trọng lực trong hệ toạ độ màn hình: `up = (−sinγ·cosβ, sinβ, cosβ·cosγ)`, góc `θ = atan2(up.x, up.y)`. |θ| ≥ 58° (giữ ≥ 260 ms) → cầm ngang (đỉnh máy sang trái: giao diện xoay +90°, sang phải: −90°); |θ| ≤ 32° → dọc; máy gần nằm phẳng thì giữ nguyên. Khi xoay, toàn bộ lớp phủ nằm trong `#camUpright` (kích thước hoán đổi, xoay quanh tâm) nên khung hướng dẫn/hộp nhận diện dùng toạ độ "đứng thẳng"; video vẫn ở toạ độ màn hình. Khung đưa vào COCO-SSD và ảnh lưu được xoay −90°/+90° tương ứng (COCO-SSD nhận xe nằm nghiêng 90° rất kém nên bước này cần thiết).

**Ước lượng số bước.** Bán kính vòng đi ≈ 0,55 × chiều dài xe + 2 m; số bước ≈ cung còn lại / 0,65 m (chỉ khi cảm biến đủ tin cậy, hiển thị "khoảng", tối đa 10).

**"Ước lượng được góc" ≠ "đã chụp đạt góc".** Một góc chỉ chuyển xanh trên mini-map sau khi: ảnh đã chụp → qua kiểm tra chất lượng → góc được xác minh (tự động nhờ cảm biến+hình ảnh, nhờ classifier, hoặc khách hàng xác nhận thủ công) → ghi vào IndexedDB.

**Kiểm tra chất lượng ảnh (`imageQualityValidator`).** Độ nét (phương sai Laplacian của 25% khối nét nhất, trên ảnh 480px), độ sáng trung bình/cháy sáng/tương phản, nhận diện xe lại trên ảnh tĩnh (không có xe, bị cắt ở mép, quá gần, quá xa, ngoài vùng hướng dẫn), ảnh trùng với góc khác (dHash 64-bit), góc sai (chỉ khi có classifier). Điểm 0–100 là chỉ số tham khảo của POC, **không** phải chuẩn giám định. Ngưỡng mặc định trong `CONFIG.quality` chưa được hiệu chỉnh trên ảnh xe thật nhiều thiết bị — dùng chế độ kiểm thử để chỉnh.

**Chống kẹt.** Nếu cùng một góc bị từ chối liên tiếp ≥ 2 lần *chỉ vì lỗi phụ thuộc AI/khung hình* (không thấy xe, bị cắt, quá gần, quá xa), ứng dụng cho khách chọn **"Vẫn lưu"**. Ảnh đó được đánh dấu `manualConfirmed` + `qualityOverride:[mã lỗi]`, hiển thị huy hiệu "Bỏ qua kiểm tra" ở màn hình 3 và trong JSON. Lỗi mờ/tối/trùng ảnh không bao giờ được bỏ qua.

## 5. Giới hạn & những gì chưa kiểm chứng

* **Đã chạy tự động trong môi trường kiểm thử (Chromium headless, camera giả của Chromium):** toàn bộ luồng DEMO 8 góc → xem lại → chụp lại một góc → xóa góc → tiếp tục phiên → ZIP/JSON hợp lệ → xóa phiên (IndexedDB rỗng); các ca ảnh mờ/tối/không có xe/xe bị cắt bị từ chối và không được lưu; sai chiều và hồi phục; đổi hướng màn hình; chế độ không cảm biến + xác nhận thủ công; AI không tải được và thử lại; camera không có; mini-map kéo thả; giả lập lỗi (IndexedDB từ chối Blob, IndexedDB đầy, `toBlob` trả về null, mất khung hình, lỗi sau khi lưu) — ảnh vẫn được lưu hoặc báo đúng nguyên nhân, không kẹt; giao diện xoay ±90° khi cầm ngang trên màn hình dọc (kể cả hộp thoại, kéo mini-map theo đúng ngón tay), nút xoay thủ công khi không có cảm biến hướng; nút toàn màn hình và hướng dẫn cho trình duyệt không hỗ trợ; giọng đọc (giọng giả lập để ghi lại câu đọc: chọn đúng giọng Natural, câu có số bước, không nói đè); màn hình xem lại với ảnh dọc + ngang.
* **Cầm ngang trên màn hình khóa dọc với AI thật**: video khung dọc chứa cảnh bị nghiêng 90° (đúng như camera điện thoại khi cầm ngang) + sự kiện cảm biến hướng giả lập → giao diện xoay 90°, COCO-SSD thật nhận ra xe trên khung đã xoay đứng thẳng (tỷ lệ khung > 1,4), khi còn xa góc mục tiêu model tạm nghỉ và tới gần thì chạy lại, ảnh "Bên phải" lưu dạng ngang và khớp cảnh đứng thẳng (hệ số tương quan > 0,8, không lộn ngược).
* **COCO-SSD thật**: đã chạy TF.js 4.22.0 + COCO-SSD 2.2.3 với trọng số `lite_mobilenet_v2` thật (bản Apache-2.0 lấy từ gói npm `node-red-contrib-tfjs-coco-ssd`, vì CDN của Google bị chặn trong môi trường kiểm thử) trên video dựng từ **một ảnh chụp thật** chiếc xe bán tải: xe được nhận là `car` với độ tin cậy 0,77–0,94, chụp và lưu được ảnh. Phiên 2 phút: số tensor giữ nguyên 262, bộ nhớ JS ~32–43 MB, số node DOM không tăng (không rò rỉ).
* **Tải sẵn AI (v0.4)** — đã chạy với tệp thật (TF.js 4.22.0, COCO-SSD 2.2.3 + trọng số `lite_mobilenet_v2` 5 phần, Tesseract.js 5.1.1 worker + lõi WASM + `eng.traineddata`): thanh % tăng dần theo byte, hiện đúng tên tệp đang tải, có tốc độ và thời gian còn lại, chuyển sang "Đang khởi tạo" rồi "Sẵn sàng"; COCO-SSD thật và worker OCR thật được khởi tạo; nút bắt đầu chỉ mở khi sẵn sàng; **tải lại trang lấy toàn bộ từ Cache Storage, không có yêu cầu mạng nào**; đổi sang `mobilenet_v1` (có xác nhận) tải model mới và dùng được; model lớn hiện hộp thoại dung lượng, Hủy thì giữ nguyên; OCR tắt/OCR lỗi → Thử tải lại / Bỏ qua OCR; chặn CDN → báo lỗi + thử lại; tiến trình theo byte với server bị giới hạn băng thông. Vì CDN của Google/jsDelivr bị chặn trong môi trường kiểm thử, các tệp được phục vụ từ bản sao cục bộ **giống hệt** gói npm gốc (đường dẫn URL giữ nguyên). Thời gian tải trên mạng 4G/Wi-Fi thật **chưa đo**.
* **Chưa kiểm chứng:** (a) độ chính xác phát hiện xe trên nhiều xe/ánh sáng/góc chụp thật — mới thử một ảnh; (b) **tốc độ và nhiệt trên điện thoại thật**: môi trường kiểm thử dùng WebGL mô phỏng bằng CPU (mỗi lần suy luận ~1,2 s, chậm hơn nhiều so với GPU điện thoại) nên chưa đo được độ mượt thực tế; (c) **cảm biến chuyển động thật trên điện thoại** — thuật toán θ đã chạy bằng nguồn heading tổng hợp qua đúng mã navigator/FSM, nhưng độ trôi, nhiễu, hành vi iOS/Android thực tế chưa được đo; (d) ngưỡng độ nét/độ tối chưa hiệu chỉnh trên ảnh camera điện thoại thật; (e) giọng nói tiếng Việt phụ thuộc giọng có sẵn trên thiết bị (iPhone thường có "Linh", Android có giọng Google, Edge có giọng Natural) — chưa nghe thử trên máy thật; (f) xoay giao diện theo cảm biến mới thử bằng sự kiện cảm biến giả lập, chưa thử trên iPhone/Android thật (dấu của beta/gamma theo chuẩn W3C, giống nhau trên hai nền tảng).
* **Đầu/đuôi xe** hầu như luôn cần một lần chạm xác nhận (COCO-SSD không phân biệt được).
* **Không có cảm biến** (từ chối quyền, máy tính, trình duyệt cũ): ứng dụng chuyển *chế độ thủ công* — nút chụp mở sau vài giây, **mọi góc phải do khách hàng xác nhận** là đúng góc.
* Xe nhiều màu, ánh sáng gắt, nhiều xe trong khung, xe dài hơn khung hình khi đứng gần có thể làm nhận diện sai; ứng dụng báo "không thấy xe / xe bị cắt / xe quá gần" thay vì đoán.
* Khóa hướng dọc bằng `screen.orientation.lock` chỉ hoạt động khi toàn màn hình (chủ yếu Android Chrome). iPhone: người dùng tự bật khóa xoay; nếu không bật, trình duyệt sẽ xoay và ứng dụng dùng bố cục ngang thật (vẫn đúng nhưng có thể khựng như trước).
* **Hiệu năng (đã tối ưu, chưa đo trên máy thật):** khung video được thu nhỏ còn 416 px trước khi đưa vào model (model tự resize ~300 px nên không mất độ chính xác); nhịp suy luận tự giãn theo tốc độ máy (≥ 280 ms và ≥ 2,8 × thời gian suy luận), giảm về ~0,9 s khi đang mở hộp thoại/tạm dừng/đang phân tích ảnh; không dùng `backdrop-filter` và không có animation SVG chạy liên tục trên nền video; canvas tạm được dùng lại (Safari/iOS giới hạn tổng bộ nhớ canvas và giải phóng chậm); lớp hộp nhận diện và mini-map chỉ cập nhật thuộc tính khi giá trị đổi. Ảnh lưu có cạnh dài tối đa 1920 px (JPEG 0,9).
* **Lưu ảnh**: thử Blob trong IndexedDB → nếu trình duyệt từ chối (một số Safari/iOS, trình duyệt nhúng trong Zalo/Facebook) lưu dạng ArrayBuffer → nếu vẫn lỗi (đầy bộ nhớ, chế độ riêng tư) giữ tạm trong RAM và cảnh báo khách tải ZIP trước khi đóng trang.
* Ứng dụng là POC đánh giá trải nghiệm chụp. **Không** thay thế giám định/thẩm định rủi ro; điểm chất lượng và độ tin cậy không có giá trị pháp lý.

## 6. Thư viện bên thứ ba và giấy phép

| Thư viện | Phiên bản | Giấy phép | Nguồn CDN | Dùng để |
|---|---|---|---|---|
| TensorFlow.js | 4.22.0 | Apache-2.0 | `cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js` (dự phòng `unpkg.com`) | suy luận trên trình duyệt |
| TensorFlow.js WASM backend | 4.22.0 | Apache-2.0 | `cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-wasm@4.22.0/dist/…` | backend dự phòng khi WebGL không có |
| COCO-SSD | 2.2.3 | Apache-2.0 | `cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js`; trọng số từ `storage.googleapis.com/tfjs-models` | phát hiện xe |
| Tesseract.js (tùy chọn) | 5.1.1 | Apache-2.0 | `cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js` (dự phòng `unpkg.com`) | đọc biển số |

Mô hình COCO-SSD được huấn luyện trên COCO (CC BY 4.0 cho nhãn/ảnh); dữ liệu ngôn ngữ của Tesseract (`eng`) tải từ CDN của dự án Tesseract.js khi OCR chạy. Rà soát lại điều khoản trước khi dùng thương mại. ZIP do `js/zipWriter.js` tự tạo (không dùng thư viện ngoài); mã còn lại là mã gốc của dự án, không phụ thuộc framework. Các web API sử dụng: MediaDevices, DeviceOrientation/DeviceMotion, Screen Orientation, IndexedDB, Web Speech, Canvas, Vibration (nếu có).

## 7. Nghiệm thu: 12 kịch bản

Cách thử nhanh nhất là chế độ **DEMO** (bảng DEMO ở góc dưới trái màn hình camera). Cột "Đã kiểm" là kết quả chạy tự động trong môi trường kiểm thử; **chưa có kết quả trên điện thoại thật**.

| # | Kịch bản | Cách thử | Kết quả mong đợi | Đã kiểm |
|---|---|---|---|---|
| 1 | Chưa có xe | DEMO: tắt "Có xe trong khung" / live: che camera | "Không thấy xe. Hãy hướng camera về phía xe." Nút chụp khóa | DEMO + live (mock AI) |
| 2 | Phát hiện xe | Bật xe; đợi ~1 s | Hộp nhận diện ổn định, chuyển sang xác định điểm xuất phát | DEMO + live (mock AI) |
| 3 | Xác định điểm xuất phát | Sheet "Đầu xe hay đuôi xe?" | Nêu giới hạn COCO-SSD, kèm bằng chứng; chọn xong mini-map xoay đúng | DEMO + live (mock AI) |
| 4 | Chụp đầu xe | Bấm chụp khi nút sáng | Ảnh dọc, qua kiểm tra, góc 1 xanh, câu "Góc này đã đạt…" | DEMO + live (mock AI) |
| 5 | Đi đúng chiều | DEMO: "đi bộ" tới 45° | Chỉ dẫn "Di chuyển sang phía trước phải…", tới nơi nút chụp sáng | DEMO |
| 6 | Đi sai chiều | DEMO: đi ngược ≥ 18° trong ≥ 1,6 s | Cảnh báo ngược chiều + mũi tên quay lại; thoát cảnh báo khi đi đúng | DEMO (nguồn heading tổng hợp) |
| 7 | Chuyển dọc/ngang | Đầu/đuôi xe ảnh dọc, 6 góc còn lại ảnh ngang | "Hãy xoay điện thoại theo chiều ngang…" + biểu tượng xoay máy | DEMO |
| 8 | Ảnh lỗi | DEMO: chọn ảnh Mờ / Tối / Không có xe / Xe bị cắt rồi chụp | Sheet "Ảnh chưa đạt" nêu lý do, ảnh không được lưu | DEMO |
| 9 | Hoàn thành | "Chạy tự động 8 góc" hoặc chụp đủ | "Hoàn thành chụp ảnh xe — 8/8 góc." chỉ khi đủ 8 ảnh đạt | DEMO |
| 10 | Không có quyền cảm biến | Từ chối quyền / DEMO: tắt "Cảm biến" | "Chế độ thủ công", mỗi góc phải xác nhận thủ công, lưu `verification:"manual"` | DEMO + live |
| 11 | AI không tải được | Chặn CDN / tắt mạng | Thẻ tải AI báo lỗi + Thử tải lại; nút bắt đầu (camera thật) khóa; DEMO vẫn dùng được | Có (CDN bị chặn) |
| 12 | Chụp lại một góc | Màn hình 3 → nút "Chụp lại" ở một góc | Chỉ góc đó bị thay; ảnh cũ giữ đến khi ảnh mới đạt; quay về màn hình 3 | DEMO |

## 8. Dữ liệu xuất & quyền riêng tư

* `session.json` (schema `sv8v-session/1`): app/version, mode, `demoNotice` (nếu DEMO), loại xe, biển số *đã nhập*, điểm xuất phát + cách xác nhận, OCR, thứ tự chụp, `completed`, và với từng góc: tên tệp, thời điểm, kích thước, hướng màn hình, điểm/lỗi/cảnh báo chất lượng, cách xác minh góc + bằng chứng, `manualConfirmed`, `qualityOverride`, `dataSource`. **Không có GPS, không có định danh thiết bị.**
* Tên tệp ảnh: `<tên-phiên>_<01..08>-<angleKey>.jpg`, `angleKey` ∈ `front, front_right, right, rear_right, rear, rear_left, left, front_left`.
* Cài đặt giao diện lưu ở `localStorage` (`sv8v-prefs`, vị trí mini-map `sv8v-minimap-pos`); ảnh/metadata phiên chỉ ở IndexedDB. Nút **Xóa toàn bộ dữ liệu phiên** (màn hình 1 và 3) xóa ảnh, thumbnail và metadata. Các tệp bạn đã tải xuống không bị ảnh hưởng.

## 9. Mở rộng sang hệ thống cấp đơn thực tế

* **Lưu trữ/đồng bộ**: `captureStore.js` là điểm duy nhất chạm vào ảnh; thay hoặc bọc bằng bộ upload có chữ ký/mã hóa (JSON schema đã ổn định, ảnh là JPEG Blob).
* **Xác minh phía máy chủ**: `session.json` giữ đủ bằng chứng (`angleVerification`, `angleEvidence`, `manualConfirmed`, `qualityOverride`) để máy chủ chạy lại model mạnh hơn và chấm điểm/duyệt lại. Không nên coi `qualityScore` phía client là kết luận cuối cùng.
* **Model riêng**: đặt classifier 8 góc vào `assets/models/view-classifier/` (hợp đồng đầu vào/đầu ra ở `assets/models/README.md`) để góc được xác minh tự động thay cho bước xác nhận thủ công; có thể thay COCO-SSD bằng detector chuyên cho xe tại `aiDetector.js` (giữ nguyên cấu trúc kết quả).
* **Chống gian lận**: cần thêm các lớp ngoài phạm vi POC (chữ ký thời gian, kiểm tra EXIF/ảnh chụp lại màn hình, đối chiếu biển số/VIN phía máy chủ).
* **Cấu hình**: mọi ngưỡng nằm ở `js/config.js`; chuỗi giao diện/giọng nói ở `js/strings.js` (sẵn sàng bản địa hóa).

## 10. Khác biệt so với bản đặc tả ban đầu

* **Không có file ảnh `assets/placeholders/*.png`**: khung bao hướng dẫn được tính bằng code từ mô hình hình học 3D của từng loại xe (`placeholders.js`, 9 loại, mọi góc nhìn) nên tỷ lệ khung luôn khớp với bộ ước lượng góc. Theo góp ý thử nghiệm, màn hình camera **chỉ vẽ khung bao xe**, không vẽ hình xe đè lên video (hình xe vẫn dùng cho icon loại xe ở màn hình 1 và cảnh DEMO; bật lại bằng `buildGuide({ withVehicle: true })`). Thư mục `assets/placeholders/{sedan,suv,pickup,truck}` được giữ làm chỗ thay bằng ảnh thật nếu muốn.
* **Thêm module** ngoài danh sách gốc: `appState.js`, `uiKit.js`, `strings.js`, `placeholders.js`, `zipWriter.js`, `demoSource.js`, `setupController.js`, `cameraScreen.js`. Lý do: tách store trung tâm, thành phần giao diện dùng chung, chuỗi tiếng Việt, ZIP không phụ thuộc thư viện, nguồn DEMO và hai bộ điều khiển màn hình.
* **Phân loại 8 góc bằng model là tùy chọn và mặc định TẮT** (`VIEW_CLASSIFIER.enabled = false`) vì dự án không kèm model; code nạp/suy luận đã có và dùng chung hợp đồng với `viewAngleDetector`.
* **Bổ sung ngoài đặc tả**: tải sẵn dữ liệu AI khi mở trang (thanh %, loại dữ liệu, thời gian còn lại, lưu trên máy, đổi model rồi tải ngay), giao diện xoay theo cảm biến khi màn hình khóa dọc, toàn màn hình + chế độ ứng dụng (manifest), âm báo/rung nhẹ, ước lượng số bước, AI chỉ chạy gần góc chụp, hiệu chuẩn lại vị trí bằng một chạm ("Bạn đang đứng ở…?"), tiếp tục phiên dang dở, "Vẫn lưu" chống kẹt khi AI sai lặp lại, xem ảnh phóng to, giọng nói tiếng Việt.
