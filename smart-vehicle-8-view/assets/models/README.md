# assets/models

Repo **không kèm model nào**. Mặc định ứng dụng tải COCO-SSD (thư viện + trọng số) từ CDN. Hai nơi dưới đây là tùy chọn.

## 1. Tự host trọng số COCO-SSD (tùy chọn)

1. Tải trọng số của `lite_mobilenet_v2` (hoặc `mobilenet_v2`) từ `storage.googleapis.com/tfjs-models/savedmodel/ssdlite_mobilenet_v2/` (giữ cả `model.json` và các tệp `group*-shard*`).
2. Đặt vào `assets/models/coco-ssd/`.
3. Trong `js/config.js` đặt `LIBS.cocoSsd.modelUrl = 'assets/models/coco-ssd/model.json'`.

Thư viện `tf.min.js` / `coco-ssd.min.js` vẫn tải từ CDN trừ khi bạn tự host và sửa `LIBS.*.urls`.

## 2. Model phân loại 8 góc (tùy chọn, mặc định TẮT)

Dự án chưa kèm model này. Nếu bạn có (hoặc tự huấn luyện) một model phân loại góc chụp xe:

* Đặt vào `assets/models/view-classifier/model.json` (+ shard), định dạng TensorFlow.js `graph` (hoặc `layers`, chỉnh `VIEW_CLASSIFIER.format`).
* **Đầu vào**: ảnh RGB, giá trị `[0, 1]`, kích thước `224×224` (`VIEW_CLASSIFIER.inputSize`), batch 1.
* **Đầu ra**: vector softmax 8 phần tử theo đúng thứ tự `ANGLE_KEYS`:
  `front, front_right, right, rear_right, rear, rear_left, left, front_left`
  (đầu xe → đi theo chiều kim đồng hồ; "right" = phía bên phải của xe khi nhìn từ phía sau xe).
* Đổi `VIEW_CLASSIFIER.enabled = true` trong `js/config.js`.

Khi có classifier: (a) bước xác định điểm xuất phát có thêm bằng chứng `classifier`; (b) `viewAngleDetector` cộng thêm xác suất của model; (c) `imageQualityValidator` có thể từ chối ảnh khi model tự tin (≥ 0,7) rằng góc chụp khác góc mục tiêu;
(d) `decideAngleVerification` coi góc là *đã xác minh bằng model* khi độ tin cậy ≥ 0,6 và khớp góc mục tiêu, không cần khách xác nhận thủ công.
Nếu model không nạp được, ứng dụng tiếp tục chạy bằng cảm biến + xác nhận thủ công (không báo lỗi).

Lưu ý giấy phép/dữ liệu huấn luyện của model bạn dùng; ảnh khách hàng không bao giờ được gửi đi bởi ứng dụng này.
