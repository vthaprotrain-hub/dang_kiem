# POC: Real-time Face Capture & Liveness Validation (trình duyệt)

POC hướng dẫn khách hàng đưa khuôn mặt vào đúng vị trí trên camera, đạt tỷ lệ phù hợp, nhìn trực diện, thực hiện **thử thách hành vi cơ bản** rồi mới cho phép chụp ảnh. Chạy hoàn toàn phía client bằng HTML5 / CSS3 / JavaScript ES6+ thuần và MediaPipe Face Landmarker. Không backend, không API key, không gửi dữ liệu đi đâu.

> **Tuyên bố giới hạn (quan trọng).** Đây là POC nghiên cứu tính khả thi. Nó **không** bảo đảm xác minh danh tính và **không** chống giả mạo tuyệt đối. Thử thách chớp mắt/quay đầu không chống được mọi ảnh/video phát lại hay tấn công bằng màn hình. Giao diện chỉ hiển thị **"Đã hoàn thành thử thách cơ bản"**, không bao giờ hiển thị "Đã xác minh người thật".

---

## 1. Công nghệ đã chọn (đã kiểm tra)

| Thành phần | Giá trị | Nguồn / giấy phép |
|---|---|---|
| Thư viện | `@mediapipe/tasks-vision` **0.10.35** (ghim phiên bản) | npm `@mediapipe/tasks-vision` — **Apache-2.0** (xác nhận qua `package.json` của gói). Bản mới nhất lúc kiểm tra là 1.1.1 (phát hành 14/10/2026, mới 2 ngày); POC ghim 0.10.35 (4/2026) vì đã ổn định hơn, API `FaceLandmarker` giống hệt (đã đối chiếu `vision.d.ts` của cả hai bản). Đổi ở `MEDIAPIPE_VERSION` trong `js/config.js` và `VERSION` trong `scripts/download-assets.sh`. |
| Module JS | `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/vision_bundle.mjs` (dự phòng `unpkg.com`) | Gói npm trên |
| WASM | `…/tasks-vision@0.10.35/wasm` | Gói npm trên (đã xác nhận có `vision_wasm_internal.*`, `vision_wasm_nosimd_internal.*`) |
| Model | `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task` | URL chính thức trong README của gói npm và tài liệu Face Landmarker của Google. Hãy tự đọc điều khoản model trên trang chính thức trước khi dùng thương mại. |

**Lý do chọn:** MediaPipe Face Landmarker cho landmark 3D (478 điểm) và **ma trận biến đổi khuôn mặt 4×4**, từ đó tính yaw/pitch/roll bằng phép toán thật thay vì ước chừng từ toạ độ 2D. Chỉ một pipeline nhận diện duy nhất; **không dùng TensorFlow.js** vì không có mô hình bổ sung nào thật sự cần thiết.

**Về anti-spoofing:** POC **không** tích hợp model anti-spoofing. Môi trường phát triển POC không có công cụ tìm kiếm web nên chưa khảo sát được model client-side có giấy phép và hướng dẫn triển khai rõ ràng; theo yêu cầu, thay vào đó POC dùng thử thách hành vi cơ bản và ghi rõ giới hạn. FaceMesh landmark **không** được dùng làm bằng chứng liveness.

**Cấu hình model:** chế độ `VIDEO`, landmark 3D, `outputFaceBlendshapes = false`, `outputFacialTransformationMatrixes = true`, delegate GPU và tự rơi về CPU. `numFaces = 2` (không phải 1) vì với `numFaces = 1` MediaPipe chỉ trả về một mặt nên không thể phát hiện "nhiều khuôn mặt"; mặt phụ nhỏ hơn 12% chiều cao khung bị bỏ qua để tránh nhầm với ảnh/áp phích ở nền.

---

## 2. Cấu trúc dự án

```
index.html                 Giao diện (các màn hình: giới thiệu, tải, lỗi, camera, xem trước, hoàn tất)
css/styles.css             Giao diện tối giản, ưu tiên điện thoại, safe-area, reduced-motion
js/config.js               Mọi ngưỡng và nguồn tải thư viện/model
js/camera.js               Xin quyền, mở/dừng/chuyển camera, lịch frame video
js/face-landmarker.js      Tải thư viện + model (CDN → self-host), GPU → CPU, suy luận
js/geometry-validator.js   Vị trí, tỷ lệ, góc, độ ổn định (hàm thuần, không DOM)
js/quality-validator.js    Độ sáng, độ nét (hàm thuần + bộ lấy mẫu có giới hạn tần suất)
js/liveness.js             Máy trạng thái thử thách chớp mắt / quay đầu (hàm thuần, thời gian truyền vào)
js/capture-controller.js   canCapture() và chụp/ra ảnh
js/ui-controller.js        Overlay, trạng thái, thông báo tiếng Việt, chế độ kỹ thuật
js/app.js                  Khởi tạo và điều phối
tests/                     Kiểm thử đơn vị các hàm thuần (tests/index.html chạy trong trình duyệt)
scripts/serve.py           Server tĩnh (HTTP/HTTPS) chỉ để phát triển
scripts/download-assets.sh Tải thư viện + model để self-host
```

Điều chỉnh so với đề bài (đều có lý do kỹ thuật): thêm `tests/` và `scripts/` (không thuộc ứng dụng chạy; chỉ phục vụ kiểm thử và triển khai), `numFaces = 2` như giải thích ở trên.

---

## 3. Chạy thử

Cần HTTP server tĩnh vì dùng ES modules (mở `index.html` bằng `file://` sẽ không chạy). Trang chỉ xin được camera trên **HTTPS hoặc `localhost`**.

### Localhost (máy tính, webcam)

```bash
python3 scripts/serve.py            # http://localhost:8000
# hoặc bất kỳ server tĩnh nào khác, ví dụ: npx serve .
```

### HTTPS (thử trên điện thoại qua mạng LAN)

Điện thoại truy cập bằng IP máy tính nên **bắt buộc HTTPS** (HTTP thường bị chặn camera).

```bash
# 1) Tạo chứng chỉ tin cậy cục bộ (mkcert: https://github.com/FiloSottile/mkcert)
mkcert -install
mkcert 192.168.1.50                  # thay bằng IP LAN của máy bạn → tạo 192.168.1.50.pem và -key.pem
# 2) Chạy
python3 scripts/serve.py --https 192.168.1.50.pem 192.168.1.50-key.pem --host 0.0.0.0 --port 8443
# 3) Trên điện thoại mở https://192.168.1.50:8443  (cần cài CA của mkcert lên điện thoại để hết cảnh báo)
```

Cách khác: dùng tunnel HTTPS (ví dụ Cloudflare Tunnel `cloudflared tunnel --url http://localhost:8000`). Lưu ý tunnel đi qua dịch vụ bên thứ ba, nhưng chỉ file tĩnh đi qua đó; video/landmark vẫn chỉ xử lý trên thiết bị.

### Self-host thư viện và model (không phụ thuộc CDN)

```bash
sh scripts/download-assets.sh        # tạo vendor/mediapipe/ và models/face_landmarker.task
# mở trang với ?assets=local  (hoặc đảo thứ tự nguồn trong js/config.js)
```

Nếu CDN/Google Storage không tải được, ứng dụng tự thử nguồn `self-host` ở `vendor/` và `models/`.

### Tham số URL (để kiểm thử)

| Tham số | Tác dụng |
|---|---|
| `?debug=1` | Bật sẵn "Chế độ kỹ thuật" |
| `?assets=local` | Ưu tiên file self-host |
| `?delegate=cpu` / `gpu` | Ép delegate (mặc định tự chọn GPU rồi CPU) |
| `?liveness=off` | Tắt thử thách (chỉ kiểm tra hình học + chất lượng) |
| `?manual=off` | Ẩn nút "Chụp thủ công" khi model lỗi |

---

## 4. Cách hoạt động

**Vòng lặp.** `requestVideoFrameCallback` (dự phòng `requestAnimationFrame` + kiểm tra `currentTime`) chỉ gọi xử lý khi có frame video **mới**; suy luận bị giới hạn tần suất (mặc định ≈25–30 lần/giây) và tự giãn ra nếu thiết bị chậm (hiện thông báo "Thiết bị xử lý chậm"). Suy luận chạy trên luồng chính nhưng ngắn và được giới hạn tần suất; xem mục Giới hạn về việc chuyển sang Web Worker.

**Toạ độ & lật gương.** Landmark ở toạ độ video gốc. Mọi quy tắc tính trên *toạ độ view* (vùng camera đang hiển thị sau `object-fit: cover`). Camera trước được lật bằng CSS **chỉ trên thẻ `<video>`**; canvas overlay không bị lật và toạ độ được lật đúng một lần trong `videoToView`, nên hướng dẫn "sang trái/phải" khớp với những gì người dùng nhìn thấy.

**Vị trí.** `faceCenter = ((minX+maxX)/2, (minY+maxY)/2)` từ toàn bộ landmark, so với tâm oval; sai lệch tối đa 8% rộng / 8% cao vùng camera.

**Tỷ lệ.** Chiều cao bounding box / chiều cao vùng camera trong khoảng 35%–75%. Tách biệt với vị trí tâm; thông báo ưu tiên: vị trí → tỷ lệ → góc → chất lượng → ổn định.

**Góc.** Từ ma trận biến đổi 4×4 của MediaPipe (tự nhận diện cột-trước/hàng-trước bằng vị trí thành phần tịnh tiến, bỏ hệ số tỷ lệ bằng cách chuẩn hoá cột). Nếu ma trận không có/không hợp lệ thì dùng hình học landmark 3D (xấp xỉ, có độ lệch nền vài độ ở pitch). Dấu yaw (dương = người dùng quay sang **trái của họ**) được căn theo landmark và tự hiệu chuẩn bằng bỏ phiếu; chỉ ảnh hưởng *hướng* của thử thách quay đầu. Không có góc nào được gán cứng.

**Ổn định.** `StabilityTracker` dùng timestamp thực của frame (không đếm frame). Tốc độ dịch chuyển tâm mặt chuẩn hoá theo chiều cao mặt; vượt ngưỡng tức thời hoặc đã làm mượt thì reset bộ đếm. Cần tất cả quy tắc đạt liên tục ≥ 1000 ms.

**Chất lượng.** Crop vùng mặt (thu 10% mỗi cạnh) rút về 128 px, tính độ sáng trung bình (luma) và variance of Laplacian, làm mượt qua 5 mẫu, tối đa mỗi 150 ms. Không bao giờ phân tích cả frame. Các chỉ số này **không** dùng để phát hiện ảnh giả.

**Liveness (máy trạng thái).** `IDLE → CHALLENGE_STARTED → WAITING_FOR_ACTION → ACTION_DETECTED → CHALLENGE_PASSED`, hoặc `LIVENESS_INCONCLUSIVE`.
- Chỉ bắt đầu khi hình học + chất lượng đã ổn định đủ lâu. Thử thách ngẫu nhiên (chớp mắt / quay trái / quay phải; cấu hình được số bước), tránh lặp thử thách đầu của lần trước.
- Trước khi phát lệnh phải thu "đường nền": mắt mở và đầu thẳng liên tục 500 ms → cú chớp/tư thế có sẵn từ trước **không** được tính. Cú chớp trong 250 ms đầu sau lệnh cũng không được tính.
- Chớp mắt: EAR trung bình hai mắt từ 6 landmark mỗi mắt, so với EAR nền (đóng ≤ 65%, mở lại ≥ 82%, có trễ), cần ≥ 2 mẫu liên tiếp, thời lượng 40–1000 ms; một frame nhiễu hoặc nhắm quá lâu không tính.
- Quay đầu: yaw ≥ 15° đúng hướng, giữ ≥ 150 ms và ≥ 2 mẫu; sau đó **phải quay lại nhìn thẳng** ≥ 300 ms. Quay sai hướng được ghi nhận và nhắc.
- Có thời hạn mỗi bước (8 s; 6 s để quay lại), mất mặt > 1 s thì huỷ, có nút "Thử lại thử thách".
- Kết quả chỉ có hiệu lực 20 s và bị huỷ nếu mất mặt > 1,2 s sau khi hoàn thành (chống "hoàn thành rồi đổi người").

**`canCapture()`** (một hàm duy nhất trong `capture-controller.js`) trả về `{ok, reasons[]}`: đúng một mặt, tâm trong vùng, tỷ lệ đạt, góc đạt, chất lượng đạt và còn mới, ổn định đủ lâu, liveness đã hoàn thành (nếu bật), phân tích không cũ. Nút chụp chỉ phản ánh hàm này, có bộ canh gác khoá nút nếu video đứng hình, và `capture()` kiểm tra lại ngay trước khi lấy ảnh.

**Chụp ảnh.** Vẽ frame hiện tại lên canvas (cạnh dài ≤ 1920 px), xuất JPEG q0.92, hiện xem trước. Mặc định lưu ảnh **gốc từ camera** (không lật gương); đổi bằng `capture.mirrorSavedImage`. "Sử dụng ảnh này" chỉ phát sự kiện `face-capture:confirmed` trên `window` (kèm `blob`) để trang chủ tự quyết định; **không upload**. Tải ảnh xuống chỉ khi người dùng bấm.

### Màu trạng thái
Xám: chưa có mặt. Đỏ: vị trí/góc/chất lượng chưa đạt hoặc nhiều mặt. Vàng: đang điều chỉnh/xác minh. Xanh: điều kiện hình học đạt và ổn định. Trạng thái liveness hiển thị riêng ở chip thứ hai.

### Chế độ kỹ thuật
Nút "Chế độ kỹ thuật" bật/tắt: landmark, đường viền mặt, bounding box, tâm mặt, tâm placeholder, sai lệch, tỷ lệ, yaw/pitch/roll (và nguồn tính), độ sáng, độ nét, thời gian ổn định, FPS, trạng thái từng rule, trạng thái liveness (EAR hiện tại/nền, sự kiện), và **lý do khoá nút chụp**. Mặc định ẩn.

---

## 5. Quyền riêng tư và bảo mật

- Toàn bộ suy luận chạy trong trình duyệt; mã nguồn ứng dụng không có `fetch`/`XMLHttpRequest`/`WebSocket`/`sendBeacon`. Chỉ có hai loại yêu cầu mạng: tải thư viện/WASM/model (file tĩnh) và tải trang.
- Không lưu landmark hoặc ảnh ra `localStorage`/IndexedDB/cookie; không ghi log dữ liệu sinh trắc (log chỉ chứa lý do kỹ thuật, ví dụ "Chụp bị chặn: …").
- Camera dừng khi bấm Đóng, xác nhận ảnh, ẩn tab, hoặc rời trang (`pagehide`); object URL của ảnh được thu hồi khi chụp lại/đóng.
- Khi tích hợp thật: ảnh chụp + dữ liệu liveness cần được kiểm tra **phía server**; kiểm tra phía client luôn có thể bị vượt qua.

---

## 6. Giới hạn đã biết

1. **Không chống giả mạo.** Ảnh in, ảnh/video trên điện thoại hoặc màn hình, mặt nạ, deepfake, tấn công chèn video qua camera ảo đều có thể vượt qua thử thách chớp mắt/quay đầu. Video phát lại có chớp mắt/quay đầu đúng lúc có thể được chấp nhận.
2. **Không xác minh danh tính** và không đối chiếu khuôn mặt với bất kỳ ai; chỉ có biện pháp chống đổi người ngắn hạn (hiệu lực 20 s, huỷ khi mất mặt).
3. **Ngưỡng chưa hiệu chuẩn.** Mọi ngưỡng là giá trị thử nghiệm. Đặc biệt `quality.minSharpness` (variance of Laplacian) phụ thuộc camera và nén hình; hãy đọc giá trị ở chế độ kỹ thuật trên nhiều thiết bị rồi chỉnh. Pitch/yaw dựa vào ma trận của MediaPipe nên cũng chưa được đối chiếu với thiết bị đo góc thật.
4. **Chớp mắt cần FPS đủ cao.** Cú chớp ~100–400 ms cần ≥ ~15 mẫu/giây; trên máy chậm có thể bỏ lỡ (đã giãn tần suất nhưng không thể bù).
5. Suy luận chạy trên **luồng chính** (có giới hạn tần suất). Để mượt hơn nữa trên máy yếu, có thể chuyển sang Web Worker (`vision_bundle.js` dạng classic) — chưa làm trong POC.
6. Khẩu trang, kính tối, tóc che mặt, ngược sáng mạnh, mặt quá nghiêng có thể làm landmark sai hoặc mất mặt.
7. Hướng dẫn "trái/phải" tính theo màn hình (camera trước: như gương). Với camera sau, "trái/phải" là theo màn hình, không theo chủ thể.
8. Tính tương thích: nhắm Chrome/Edge hiện đại. Safari cũ hơn 15.4 không có `requestVideoFrameCallback` (đã có đường dự phòng `requestAnimationFrame`); GPU delegate trên Safari đôi khi lỗi (đã có fallback CPU và `?delegate=cpu`) — **chưa kiểm thử trên thiết bị iOS thật**.
9. Chế độ "Chụp thủ công" (khi model lỗi) **không có bất kỳ kiểm tra nào**; chỉ để POC không bị chặn hoàn toàn. Đặt `allowManualFallback: false` khi triển khai thật.

---

## 7. Kết quả kiểm chứng đã thực hiện

Ghi rõ phạm vi để không hiểu nhầm. Môi trường phát triển POC chặn truy cập `storage.googleapis.com` và `cdn.jsdelivr.net`, **nên model Face Landmarker chính thức chưa thể tải và suy luận trên khuôn mặt thật trong lần kiểm chứng này.**

| Hạng mục | Kết quả |
|---|---|
| Kiểm thử đơn vị 46 test (hình học, mirror, pose từ ma trận cột/hàng-trước, ổn định theo timestamp, chất lượng, EAR, liveness, `canCapture`, thông báo) | **46/46 đạt** trên Node và trong Chromium. Đã làm "mutation check": cố ý phá 5 phần logic quan trọng (lật gương hai lần, đếm frame thay vì thời gian, bỏ thu đường nền, đảo dấu yaw, bỏ khoảng chờ phản xạ) → test bắt được cả 5. Dữ liệu landmark trong test là **dữ liệu tổng hợp** chỉ để kiểm tra logic. |
| Nạp thư viện MediaPipe 0.10.35 thật + `FilesetResolver` + `createFromOptions` trong Chromium | Thư viện và WASM nạp được; `createFromOptions` được gọi với đúng tuỳ chọn và chỉ dừng ở bước tải model (không có model). |
| Đường lỗi khi model không tải được | Hiện lỗi rõ nguồn nào thất bại (GPU/CPU × self-host/Google), có Thử lại và Chụp thủ công. |
| Camera giả (video) + chụp → xem trước → chụp lại → xác nhận | Hoạt động: video phát đúng tỷ lệ, ảnh JPEG 640×480, sự kiện `face-capture:confirmed` phát đúng, camera được giải phóng sau xác nhận. |
| Toàn bộ pipeline ứng dụng (hình học → ổn định → liveness → `canCapture` → UI → khoá/mở nút chụp) với frame video thật và **chỉ riêng bước suy luận bị thay bằng landmark tổng hợp** (thử nghiệm riêng, không nằm trong mã giao nộp) | Đúng: các thông báo (không mặt, lệch trái/phải/dưới, quá gần/xa, quay đầu, nghiêng, hai mặt), thử thách ngẫu nhiên → quay đầu → quay lại → "Đã hoàn thành thử thách cơ bản" → "Đã đạt điều kiện chụp" → nút chụp mở; quay đầu đi thì khoá nút ngay; độ sáng/độ nét tính trên pixel video thật. Xử lý ≈30 FPS. |
| Không có camera / từ chối quyền | Có thông báo riêng và nút Thử lại (Chromium headless trả `NotSupportedError` thay vì `NotAllowedError` khi từ chối; cả hai đã được xử lý). |

**Chưa được xác minh (cần bạn thử trên thiết bị thật):** suy luận với model thật; GPU delegate; độ chính xác của yaw/pitch/roll và dấu yaw trên dữ liệu thật; chớp mắt trên mặt thật; hành vi trước ảnh in/video/điện thoại (kịch bản 16–18); Safari iOS; chuyển camera trước/sau trên điện thoại; hiệu năng trên máy yếu; ngưỡng độ nét.

---

## 8. Checklist kiểm thử (22 kịch bản)

Cách làm chung: mở `?debug=1`, ghi lại số liệu ở bảng kỹ thuật, điền cột "Kết quả thực tế". Cột "Kỳ vọng" là kỳ vọng thiết kế, **chưa phải kết quả đã đo**. Với kịch bản 16–18, hãy ghi nhận kết quả thực tế; đừng mặc định POC sẽ chặn được.

| # | Kịch bản | Cách thực hiện | Kỳ vọng | Kết quả thực tế |
|---|---|---|---|---|
| 1 | Không có khuôn mặt | Che camera / hướng ra tường | Xám, "Đang tìm khuôn mặt…" (sau 3 s: "Vui lòng đưa khuôn mặt vào giữa khung."); nút khoá | ☐ Đạt ☐ Không |
| 2 | Một khuôn mặt chính diện | Ngồi giữa khung, đủ sáng | Qua các rule, vàng → xanh sau ~1 s; bắt đầu thử thách | ☐ Đạt ☐ Không |
| 3 | Hai khuôn mặt | Hai người cùng vào khung | Đỏ, "Vui lòng chỉ để một khuôn mặt trong khung."; nút khoá | ☐ Đạt ☐ Không |
| 4 | Mặt quá gần | Tiến sát camera | "Lùi ra một chút." khi tỷ lệ > 75% | ☐ Đạt ☐ Không |
| 5 | Mặt quá xa | Lùi xa | "Tiến lại gần camera." khi tỷ lệ < 35% | ☐ Đạt ☐ Không |
| 6 | Mặt lệch trái/phải | Dịch người sang hai bên | Hướng dẫn đúng chiều trên màn hình gương (mặt lệch phải → "sang trái") khi sai lệch > 8% | ☐ Đạt ☐ Không |
| 7 | Mặt lệch trên/dưới | Nâng/hạ camera hoặc người | Mặt thấp → "Nâng mặt lên."; cao → "Hạ mặt xuống." | ☐ Đạt ☐ Không |
| 8 | Quay đầu trái/phải | Quay > 10° | "Vui lòng nhìn thẳng vào camera."; kiểm tra yaw ở bảng kỹ thuật tăng đúng dấu | ☐ Đạt ☐ Không |
| 9 | Cúi/ngửa | Cúi/ngửa > 10° | "Vui lòng nhìn thẳng vào camera." | ☐ Đạt ☐ Không |
| 10 | Nghiêng đầu | Nghiêng > 8° | "Giữ đầu thẳng." | ☐ Đạt ☐ Không |
| 11 | Ánh sáng yếu | Tắt đèn / che nguồn sáng | "Ánh sáng chưa đủ, vui lòng di chuyển đến nơi sáng hơn."; ghi giá trị độ sáng | ☐ Đạt ☐ Không |
| 12 | Ảnh bị mờ | Làm mờ ống kính / lấy nét sai | "Ảnh chưa rõ nét…"; ghi giá trị độ nét và hiệu chỉnh `minSharpness` | ☐ Đạt ☐ Không |
| 13 | Di chuyển nhanh | Lắc điện thoại / đưa đầu nhanh | "Giữ điện thoại ổn định."; bộ đếm ổn định về 0 | ☐ Đạt ☐ Không |
| 14 | Chớp mắt đúng & sai thời điểm | (a) chớp đúng sau lệnh; (b) chớp liên tục *trước* lệnh; (c) nhắm mắt giữ lâu; (d) không chớp | (a) qua; (b) không tính cú chớp trước lệnh; (c) không tính; (d) hết 8 s → "Chưa thể xác nhận người thật. Vui lòng thử lại." | ☐ Đạt ☐ Không |
| 15 | Quay đầu đúng & sai hướng | Làm thử thách quay: (a) đúng hướng rồi quay lại; (b) sai hướng; (c) quay rồi không quay lại | (a) qua; (b) nhắc "Sai hướng…", hết giờ thì thất bại; (c) thất bại sau 6 s. **Kiểm tra dấu yaw thật có khớp "trái của bạn" không** | ☐ Đạt ☐ Không |
| 16 | Ảnh in trước camera | Đưa ảnh chân dung in | Ghi nhận thực tế. Kỳ vọng: không chớp/quay được → thất bại thử thách; nếu uốn/lắc ảnh vẫn qua thì ghi lại | ☐ Chặn ☐ Qua — ghi chú |
| 17 | Điện thoại hiển thị ảnh mặt | Đưa màn hình điện thoại | Ghi nhận thực tế (xem lưu ý giới hạn) | ☐ Chặn ☐ Qua — ghi chú |
| 18 | Phát video khuôn mặt trên màn hình | Video có chớp mắt/quay đầu | Ghi nhận thực tế. **POC không chặn được mọi trường hợp** | ☐ Chặn ☐ Qua — ghi chú |
| 19 | Từ chối quyền camera | Chặn quyền | Màn hình "Chưa được cấp quyền camera" + Thử lại | ☐ Đạt ☐ Không |
| 20 | Model tải thất bại | Chặn mạng tới CDN/Google hoặc đổi URL sai | Màn hình lỗi nêu nguồn thất bại; Thử lại / Chụp thủ công | ☐ Đạt ☐ Không |
| 21 | Chuyển camera | Bấm nút đổi camera (cần ≥ 2 camera) | Đổi trước/sau, lật gương đúng (chỉ camera trước), phân tích chạy lại từ đầu | ☐ Đạt ☐ Không |
| 22 | Chụp lại và xác nhận | Chụp → Chụp lại → Chụp → Sử dụng ảnh này | Preview đúng; chụp lại phải làm lại thử thách; xác nhận phát sự kiện, camera tắt, không có yêu cầu mạng nào gửi ảnh (kiểm tra tab Network) | ☐ Đạt ☐ Không |

Bổ sung nên làm: tắt mạng sau khi trang đã tải (với self-host) để xác nhận chạy offline; kiểm tra tab Network không có yêu cầu nào mang dữ liệu khuôn mặt; thử ≥ 3 thiết bị (Android Chrome, iOS Safari, laptop webcam).

### Gợi ý hiệu chuẩn ngưỡng
Ghi 30–50 lần chụp hợp lệ + 30–50 lần cố ý sai trên mỗi thiết bị; vẽ phân phối `sharpness`, `brightness`, `smoothedSpeed`, EAR nền và EAR khi nhắm; đặt ngưỡng tại điểm tách hai phân phối rồi chỉnh trong `js/config.js`. Đặt dung sai theo tỷ lệ thất bại chấp nhận được của khách hàng thật.

---

## 9. Khắc phục sự cố

| Triệu chứng | Nguyên nhân thường gặp |
|---|---|
| Nút Bắt đầu bị khoá, báo "không qua HTTPS" | Mở bằng `http://<IP>` hoặc `file://`. Dùng `localhost` hoặc HTTPS. |
| Báo không tải được thư viện/model | Mạng chặn jsdelivr/unpkg/storage.googleapis.com → chạy `scripts/download-assets.sh` và mở `?assets=local`. |
| Lỗi GPU/WebGL | Mở `?delegate=cpu`; ứng dụng cũng tự chuyển sang CPU khi GPU lỗi. |
| Luôn "Ảnh chưa rõ nét" | Ngưỡng `minSharpness` quá cao với camera của bạn; đọc giá trị ở chế độ kỹ thuật rồi hạ. |
| Thử thách quay đầu nhận sai hướng | Báo lỗi kèm ảnh chụp bảng kỹ thuật (yaw ma trận, yaw landmark, "dấu yaw"). |
| Giao diện chậm | Thiết bị yếu: xem "Thiết bị xử lý chậm", tăng `performance.inferenceIntervalMs`. |

## 10. Tích hợp

```js
window.addEventListener('face-capture:confirmed', (e) => {
  const { blob, width, height, mimeType, validated, capturedAt } = e.detail;
  // `validated === false` nghĩa là ảnh chụp thủ công, KHÔNG qua kiểm tra.
  // Việc gửi ảnh lên server (nếu có) là quyết định của hệ thống tích hợp; POC không làm.
});
```
