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
* **Cần Internet lần đầu**: TensorFlow.js, COCO-SSD (và Tesseract.js nếu bật OCR) được tải từ CDN, kèm trọng số COCO-SSD từ `storage.googleapis.com`. Có thể tự host (xem `assets/models/README.md`).
* Không có mạng / CDN bị chặn: ứng dụng hiện khối "AI nhận diện chưa sẵn sàng" với nút **Thử lại**, **Chuyển sang DEMO** (chỉ khi chưa chụp ảnh nào) và **Quay lại**. Nó không bỏ qua bước nhận diện một cách âm thầm.

## 2. Cách dùng

**Màn hình 1 – Thiết lập.** Chọn loại xe (9 loại: xe con, SUV/Crossover, Sedan, Hatchback, MPV, bán tải, xe tải, xe khách/xe buýt, khác), nhập biển số (tùy chọn) và tên phiên, xem sơ đồ 8 góc, đọc hướng dẫn, kiểm tra camera / cảm biến / AI. Tùy chọn: giọng nói tiếng Việt, tự chụp, OCR biển số, chế độ kiểm thử (HUD + thanh chỉnh ngưỡng), backend TF.js, ngưỡng confidence, chế độ DEMO. Có thẻ "tiếp tục phiên dang dở" và nút **Xóa toàn bộ dữ liệu phiên trên thiết bị**.

**Màn hình 2 – Camera thông minh.**
1. Hướng camera vào xe → COCO-SSD phát hiện xe (có thể chạm vào xe để khóa nếu có nhiều xe).
2. Ứng dụng hỏi **"Bạn đang đứng ở đầu xe hay đuôi xe?"** (COCO-SSD không phân biệt được; bằng chứng hình học/OCR được hiển thị kèm theo). Xác nhận xong điểm xuất phát được đặt, mini-map 8 góc xoay theo.
3. Chụp góc xuất phát (ảnh dọc), sau đó đi **sang trái của bạn** quanh xe (khi bạn nhìn vào xe, đi vòng thuận chiều kim đồng hồ nghĩa là bước sang trái). Mỗi lúc chỉ có **một** câu hướng dẫn chính; mũi tên chỉ hướng đi; gợi ý xoay ngang/dọc khi góc kế tiếp yêu cầu khác hướng máy.
4. Khi tới đúng góc, vòng sáng và nút chụp sẵn sàng. Mỗi ảnh được kiểm tra chất lượng (mờ, tối/cháy sáng, xe bị cắt/quá gần/quá xa, trùng ảnh góc khác, góc sai nếu có model). Ảnh không đạt **không được lưu**, có lý do rõ ràng và nút chụp lại.
5. Chạm một nút trên mini-map: chạm góc đã chụp = chụp lại góc đó; chạm góc mục tiêu = đặt lại vị trí khi cảm biến lệch.

**Màn hình 3 – Xem lại.** Lưới 8 ảnh với trạng thái thật của từng góc (đã đạt / cần chụp lại / chưa có), huy hiệu chất lượng, xác minh góc (tự động / model / thủ công / DEMO), xem phóng to, chụp lại một góc (chỉ thay đúng góc đó, ảnh cũ chỉ bị thay khi ảnh mới đạt), xóa, tải từng ảnh, **tải ZIP** (images/ + session.json + README.txt), **xuất JSON**, **xóa toàn bộ dữ liệu phiên**.

**Chế độ DEMO.** Camera là cảnh wireframe tổng hợp (xe, hậu cảnh thay đổi theo góc đi vòng). Bảng DEMO (nút "DEMO" ở góc) cho phép đi bộ quanh xe theo chiều kim đồng hồ/ngược lại, bật/tắt các tình huống *Có xe trong khung*, *Thêm xe thứ hai*, *Xe bị cắt mép*, *Xe quá xa*, *Cảm biến bật*, *Rung / nhiễu*, chọn chất lượng ảnh sắp chụp (*Tốt / Mờ / Tối / Không có xe / Xe bị cắt*, áp dụng cho lần chụp kế tiếp), đổi hướng máy ảo dọc/ngang và **chạy tự động 8 góc**. DEMO đi qua *cùng* navigator, state machine, bộ kiểm tra ảnh và lưu trữ như chế độ thật; chỉ nguồn camera/cảm biến/nhận diện xe là giả lập. Mọi khung hình (kể cả ảnh được "chụp") có watermark **DEMO — DỮ LIỆU GIẢ LẬP**, hộp nhận diện màu cam gắn nhãn DEMO, metadata `source: "demo"`.

## 3. Cấu trúc dự án

```
index.html                      3 màn hình + SVG sprite + sheet/viewer/demo panel
assets/
  icons/favicon.svg
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
  cameraOrientation.js          dọc/ngang thật của màn hình (Screen Orientation API + dự phòng)
  aiDetector.js                 nạp TF.js + COCO-SSD, chọn backend, vòng lặp nhận diện, tracker ổn định, classifier tùy chọn
  plateOCR.js                   OCR biển số bằng Tesseract.js (tùy chọn), chuẩn hóa/so khớp biển số VN
  vehicleOrientationDetector.js xác định đầu/đuôi xe bằng danh sách bằng chứng có trọng số
  viewAngleDetector.js          ước lượng góc nhìn (5 lớp, xem mục 4)
  movementTracker.js            góc quỹ đạo người chụp từ DeviceOrientation/Motion + bằng chứng camera
  clockwiseNavigator.js         chọn một chỉ dẫn chính + sự kiện cho FSM
  imageQualityValidator.js      kiểm tra ảnh (mờ, tối, bbox, trùng, góc) + điểm chất lượng
  miniMap.js                    mini-map 8 góc (SVG) + sơ đồ vòng ở màn hình 1
  voiceGuide.js                 Web Speech API (giọng vi-VN, chống lặp)
  captureController.js          chụp → phân tích → xác minh góc → lưu; chụp lại; xóa; export
  cameraScreen.js               điều phối màn hình 2
  setupController.js            màn hình 1        previewController.js  màn hình 3
  demoSource.js                 nguồn giả lập DEMO + bảng điều khiển + chạy tự động
  placeholders.js               khung xe wireframe 3D vẽ bằng code (9 loại, mọi góc)
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

**Phát hiện xe (COCO-SSD, `lite_mobilenet_v2`).** Chỉ dùng các lớp `car`, `truck`, `bus` với ngưỡng confidence chỉnh được. Tracker yêu cầu bbox ổn định N khung liên tiếp (IoU), cho phép mất vài khung (grace), phát hiện nhiều xe và cho khóa chiếc xe chính, phát hiện xe bị cắt mép/quá gần/quá xa. COCO-SSD **không** nhận ra kính, đèn, biển số, đầu xe hay đuôi xe.

**Điểm xuất phát (đầu hay đuôi).** `vehicleOrientationDetector` gom bằng chứng, mỗi bằng chứng có trọng số riêng: tỷ lệ bbox so với khung hình học của loại xe (chỉ cho biết đang nhìn *dọc* hay *chéo/ngang*), OCR biển số (cho biết đang nhìn một đầu xe nhưng *không biết đầu hay đuôi*), màu đèn (rất yếu, bị chặn trần), classifier tùy chọn, và xác nhận của khách. Đầu/đuôi hầu như luôn cần **một lần chạm xác nhận**; nếu OCR đọc ra biển số khác biển nhập thì phải tick xác nhận thêm. Nếu không có biển số kỳ vọng thì OCR không được chạy (không tải Tesseract vô ích).

**Vị trí người chụp quanh xe.** `movementTracker` tính hướng nhìn camera từ alpha/beta/gamma, lọc EMA, rồi
`θ = góc xuất phát + Δheading + Δ(độ lệch ngang của xe trong khung)`.
Chỉ dùng thay đổi *tương đối* so với mốc (không dựa vào la bàn/GPS); độ lệch của xe bù trường hợp xoay máy tại chỗ. Có hysteresis hướng đi và `confidence` từ độ tươi của cảm biến, độ nghiêng, độ rung. Đây là ước lượng heuristic: gyro trôi, người dùng không giữ xe ở giữa khung hoặc đi thẳng thay vì đi vòng đều làm θ lệch. Vì vậy mini-map có thể được đặt lại bằng một lần chạm.

**Ước lượng góc nhìn 5 lớp (`viewAngleDetector`).** (1) COCO-SSD → có xe/bbox; (2) tỷ lệ bbox ↔ khung hình học (phân biệt dọc/chéo/ngang, *không* phân biệt trước↔sau hay trái↔phải); (3) cảm biến → θ; (4) classifier 8 góc tùy chọn; (5) hợp nhất xác suất có trọng số + EMA + hysteresis. Khi thiếu nguồn phân biệt (cảm biến đủ tin cậy hoặc classifier) kết quả được gắn `needsManualConfirmation`.

**"Ước lượng được góc" ≠ "đã chụp đạt góc".** Một góc chỉ chuyển xanh trên mini-map sau khi: ảnh đã chụp → qua kiểm tra chất lượng → góc được xác minh (tự động nhờ cảm biến+hình ảnh, nhờ classifier, hoặc khách hàng xác nhận thủ công) → ghi vào IndexedDB.

**Kiểm tra chất lượng ảnh (`imageQualityValidator`).** Độ nét (phương sai Laplacian của 25% khối nét nhất, trên ảnh 480px), độ sáng trung bình/cháy sáng/tương phản, nhận diện xe lại trên ảnh tĩnh (không có xe, bị cắt ở mép, quá gần, quá xa, ngoài vùng hướng dẫn), ảnh trùng với góc khác (dHash 64-bit), góc sai (chỉ khi có classifier). Điểm 0–100 là chỉ số tham khảo của POC, **không** phải chuẩn giám định. Ngưỡng mặc định trong `CONFIG.quality` chưa được hiệu chỉnh trên ảnh xe thật nhiều thiết bị — dùng chế độ kiểm thử để chỉnh.

**Chống kẹt.** Nếu cùng một góc bị từ chối liên tiếp ≥ 2 lần *chỉ vì lỗi phụ thuộc AI/khung hình* (không thấy xe, bị cắt, quá gần, quá xa), ứng dụng cho khách chọn **"Vẫn lưu"**. Ảnh đó được đánh dấu `manualConfirmed` + `qualityOverride:[mã lỗi]`, hiển thị huy hiệu "Bỏ qua kiểm tra" ở màn hình 3 và trong JSON. Lỗi mờ/tối/trùng ảnh không bao giờ được bỏ qua.

## 5. Giới hạn & những gì chưa kiểm chứng

* **Đã chạy tự động trong môi trường kiểm thử (Chromium headless, camera giả của Chromium):** toàn bộ luồng DEMO 8 góc → xem lại → chụp lại một góc → xóa góc → tiếp tục phiên → ZIP/JSON hợp lệ → xóa phiên (IndexedDB rỗng); các ca ảnh mờ/tối/không có xe/xe bị cắt bị từ chối và không được lưu; sai chiều và hồi phục; đổi hướng màn hình; chế độ không cảm biến + xác nhận thủ công; đường chạy camera thật với TF.js thật; AI không tải được và thử lại; camera không có.
* **Chưa kiểm chứng:** (a) trọng số COCO-SSD thật chưa được tải trong môi trường kiểm thử (CDN bị chặn) — đường chạy camera thật được thử với **mô-đun COCO-SSD giả lập trả về hộp cố định** (chỉ dùng trong test, không nằm trong sản phẩm) nên *độ chính xác phát hiện xe thật chưa được đo*; (b) **cảm biến chuyển động thật trên điện thoại** chưa được thử — thuật toán θ đã được chạy bằng nguồn heading tổng hợp qua đúng mã navigator/FSM, nhưng độ trôi, nhiễu, hành vi iOS/Android thực tế chưa được đo; (c) ngưỡng độ nét/độ tối chưa được hiệu chỉnh trên ảnh camera điện thoại thật; (d) giọng nói tiếng Việt phụ thuộc voice của thiết bị.
* **Đầu/đuôi xe** hầu như luôn cần một lần chạm xác nhận (COCO-SSD không phân biệt được).
* **Không có cảm biến** (từ chối quyền, máy tính, trình duyệt cũ): ứng dụng chuyển *chế độ thủ công* — nút chụp mở sau vài giây, **mọi góc phải do khách hàng xác nhận** là đúng góc.
* Xe nhiều màu, ánh sáng gắt, nhiều xe trong khung, xe dài hơn khung hình khi đứng gần có thể làm nhận diện sai; ứng dụng báo "không thấy xe / xe bị cắt / xe quá gần" thay vì đoán.
* Khóa hướng màn hình chỉ thử trên Android; trên iOS ứng dụng gợi ý xoay máy bằng giao diện.
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
| 11 | AI không tải được | Chặn CDN / tắt mạng | Khối lỗi + Thử lại / DEMO / Quay lại; trạng thái AI = lỗi | Có (CDN bị chặn) |
| 12 | Chụp lại một góc | Màn hình 3 → nút "Chụp lại" ở một góc | Chỉ góc đó bị thay; ảnh cũ giữ đến khi ảnh mới đạt; quay về màn hình 3 | DEMO |

## 8. Dữ liệu xuất & quyền riêng tư

* `session.json` (schema `sv8v-session/1`): app/version, mode, `demoNotice` (nếu DEMO), loại xe, biển số *đã nhập*, điểm xuất phát + cách xác nhận, OCR, thứ tự chụp, `completed`, và với từng góc: tên tệp, thời điểm, kích thước, hướng màn hình, điểm/lỗi/cảnh báo chất lượng, cách xác minh góc + bằng chứng, `manualConfirmed`, `qualityOverride`, `dataSource`. **Không có GPS, không có định danh thiết bị.**
* Tên tệp ảnh: `<tên-phiên>_<01..08>-<angleKey>.jpg`, `angleKey` ∈ `front, front_right, right, rear_right, rear, rear_left, left, front_left`.
* Cài đặt giao diện lưu ở `localStorage` (`sv8v-prefs`); ảnh/metadata phiên chỉ ở IndexedDB. Nút **Xóa toàn bộ dữ liệu phiên** (màn hình 1 và 3) xóa ảnh, thumbnail và metadata. Các tệp bạn đã tải xuống không bị ảnh hưởng.

## 9. Mở rộng sang hệ thống cấp đơn thực tế

* **Lưu trữ/đồng bộ**: `captureStore.js` là điểm duy nhất chạm vào ảnh; thay hoặc bọc bằng bộ upload có chữ ký/mã hóa (JSON schema đã ổn định, ảnh là JPEG Blob).
* **Xác minh phía máy chủ**: `session.json` giữ đủ bằng chứng (`angleVerification`, `angleEvidence`, `manualConfirmed`, `qualityOverride`) để máy chủ chạy lại model mạnh hơn và chấm điểm/duyệt lại. Không nên coi `qualityScore` phía client là kết luận cuối cùng.
* **Model riêng**: đặt classifier 8 góc vào `assets/models/view-classifier/` (hợp đồng đầu vào/đầu ra ở `assets/models/README.md`) để góc được xác minh tự động thay cho bước xác nhận thủ công; có thể thay COCO-SSD bằng detector chuyên cho xe tại `aiDetector.js` (giữ nguyên cấu trúc kết quả).
* **Chống gian lận**: cần thêm các lớp ngoài phạm vi POC (chữ ký thời gian, kiểm tra EXIF/ảnh chụp lại màn hình, đối chiếu biển số/VIN phía máy chủ).
* **Cấu hình**: mọi ngưỡng nằm ở `js/config.js`; chuỗi giao diện/giọng nói ở `js/strings.js` (sẵn sàng bản địa hóa).

## 10. Khác biệt so với bản đặc tả ban đầu

* **Không có file ảnh `assets/placeholders/*.png`**: khung xe wireframe được vẽ bằng code từ mô hình hình học 3D của từng loại xe (`placeholders.js`, 9 loại, mọi góc nhìn). Nhờ vậy hình hướng dẫn luôn khớp tỷ lệ với bộ ước lượng góc và không cần tài nguyên ảnh. Thư mục `assets/placeholders/{sedan,suv,pickup,truck}` được giữ làm chỗ thay bằng ảnh thật nếu muốn.
* **Thêm module** ngoài danh sách gốc: `appState.js`, `uiKit.js`, `strings.js`, `placeholders.js`, `zipWriter.js`, `demoSource.js`, `setupController.js`, `cameraScreen.js`. Lý do: tách store trung tâm, thành phần giao diện dùng chung, chuỗi tiếng Việt, ZIP không phụ thuộc thư viện, nguồn DEMO và hai bộ điều khiển màn hình.
* **Phân loại 8 góc bằng model là tùy chọn và mặc định TẮT** (`VIEW_CLASSIFIER.enabled = false`) vì dự án không kèm model; code nạp/suy luận đã có và dùng chung hợp đồng với `viewAngleDetector`.
* **Bổ sung ngoài đặc tả**: hiệu chuẩn lại vị trí bằng một chạm ("Bạn đang đứng ở…?"), tiếp tục phiên dang dở, "Vẫn lưu" chống kẹt khi AI sai lặp lại, xem ảnh phóng to, giọng nói tiếng Việt.
