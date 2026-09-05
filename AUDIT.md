# Audit kỹ thuật — 05/09/2026

## Phạm vi

Rà soát mã nguồn React/TypeScript, luồng lưu/mở project và lịch sử phiên bản,
vòng đời kết quả ANN/Monte Carlo, nhập JSON, cấu hình chạy/build và bộ kiểm thử
dịch vụ thống kê hiện có. Kiểm tra nhanh giao diện các tab trên trình duyệt cục bộ.
Đây không phải thẩm định toàn bộ thuật toán khoa học hoặc chứng nhận GxP.

## Lỗi đã sửa

| Vấn đề | Tác động trước sửa | Thay đổi |
| --- | --- | --- |
| Truy cập localStorage ngoài khối xử lý lỗi | Trình duyệt chặn storage có thể khiến app không khởi động | Bắt lỗi cả khi đọc thuộc tính localStorage |
| Tin trực tiếp cấu trúc JSON/autosave/history | JSON hợp lệ về cú pháp nhưng sai cấu trúc có thể gây lỗi khi mở hoặc khôi phục | Kiểm tra cấu trúc cốt lõi; bỏ qua autosave/snapshot không hợp lệ; giữ khả năng mở bản nháp chưa hoàn chỉnh |
| Mức định lượng chứa chữ | Validation không báo đúng lỗi mức phi số | Từ chối mức không chuyển được thành số hữu hạn |
| ANN được khôi phục còn sót khi tạo project mới/khôi phục snapshot khác | Có thể dùng mô hình của project trước | Xóa ANN khi tạo mới; khôi phục ANN theo fingerprint của snapshot |
| Đổi chế độ ANN hoặc sao chép cấu hình | Có thể giữ mô hình cũ hoặc tự huấn luyện lại ngoài thao tác Train | Vô hiệu mô hình/artifact và chờ Train |
| CQA đang chọn bị xóa/đổi mã | Các tab phân tích có thể giữ mã đáp ứng không còn tồn tại | Chọn lại CQA còn hợp lệ |
| Kết quả Monte Carlo không phụ thuộc cấu hình mô phỏng trong bước vô hiệu hóa | Kết quả cũ có thể vẫn đi vào báo cáo khi đổi cấu hình | Vô hiệu kết quả khi đổi seed, số mô phỏng hoặc độ biến thiên |
| Timer Monte Carlo không được hủy | Tác vụ cũ có thể cập nhật kết quả sau khi rời tab/đổi project hoặc mô hình | Hủy timer khi đổi ngữ cảnh, unmount hoặc bắt đầu lần chạy mới; khôi phục trạng thái nút nếu mô phỏng lỗi |
| Chọn lại cùng file JSON | Sự kiện mở file có thể không chạy lại | Reset file input; thêm giới hạn 10 MB và xử lý lỗi đọc |
| Yêu cầu Node.js khai báo quá rộng | Cho phép phiên bản không đáp ứng yêu cầu Vite cài sẵn | Đồng bộ package/lockfile/README với `^20.19.0 || >=22.12.0` |

## Kiểm chứng

- Ban đầu: lint đạt; build đạt; 28/28 tests đạt.
- Sau sửa: lint đạt; 39/39 tests trên 6 file đạt.
- Bổ sung 11 ca kiểm thử cho autosave sai cấu trúc, storage bị chặn/hết dung lượng,
  lịch sử hỏng, nhập project sai và mức định lượng phi số; kiểm tra round-trip cả
  các case study đi kèm và bản nháp chưa hoàn chỉnh.
- Kiểm tra nhanh mở các tab QTPP, FMEA, DoE, ANOVA, ANN, RSM, Design Space và báo cáo.
  Không có lỗi JavaScript trong log trình duyệt thu được. Đây chưa phải kiểm thử
  end-to-end mọi thao tác huấn luyện, mô phỏng và xuất Word.

## Điểm còn lại

- Build cảnh báo bundle lớn: Plotly khoảng 1,69 MB trước gzip; gói chính khoảng
  660 kB. Có thể ảnh hưởng tốc độ tải đầu tiên; chưa đổi cách đóng gói trong đợt này.
- `npm audit --json` không lấy được dữ liệu vì endpoint advisory của npm trả lỗi
  kết nối. Chưa kết luận về lỗ hổng dependency; cần chạy lại khi truy cập được registry.
- Kiểm tra JSON bổ sung tập trung cấu trúc cốt lõi, chưa phải schema đầy đủ cho
  mọi trường tùy chọn và toàn bộ trọng số ANN nhập từ bên ngoài.
- Chưa kiểm thử hiển thị trên mọi kích thước màn hình, chưa đối chiếu toàn bộ
  công thức với phần mềm thống kê độc lập.

Các thay đổi được lưu tại thư mục dự án; chưa commit hoặc triển khai lên hosting.
