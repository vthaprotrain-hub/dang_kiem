# assets/placeholders

Hình hướng dẫn khung xe **không** được lưu thành tệp ảnh. Chúng được vẽ bằng code (`js/placeholders.js`) từ mô hình hình học 3D
của từng loại xe (xe con, SUV, sedan, hatchback, MPV, bán tải, xe tải, xe khách, khác) ở mọi góc nhìn. Lý do:

* khung hướng dẫn luôn khớp tỷ lệ với bộ ước lượng góc (`viewAngleDetector.js` dùng cùng mô hình hình học);
* một mô hình dùng cho cả 8 góc và cả hai hướng dọc/ngang, không cần 8 × N tệp ảnh.

Các thư mục `sedan/`, `suv/`, `pickup/`, `truck/` được giữ làm chỗ đặt tài nguyên ảnh riêng (SVG/PNG, tên `front.svg`, `front_right.svg`, …)
nếu sau này muốn thay khung bằng hình do nhà thiết kế cung cấp. Hiện chưa có đoạn code nào đọc từ các thư mục này.
