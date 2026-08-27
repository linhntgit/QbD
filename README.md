# QbD Experimental Design

Ứng dụng web hỗ trợ phát triển sản phẩm dược phẩm theo **Quality by Design (QbD)**. Ứng dụng đưa quy trình từ QTPP/CQA và đánh giá rủi ro đến thiết kế thí nghiệm, phân tích mô hình, tối ưu đa đáp ứng và tạo báo cáo vào cùng một luồng làm việc.

> Các giá trị trong Case Study và tính năng “Điền Mô Phỏng” chỉ phục vụ minh họa, đào tạo và kiểm thử mô hình. Chúng không thay thế dữ liệu thực nghiệm, thẩm định phương pháp hoặc quyết định phát triển/đăng ký thuốc.

## Chức năng

- Xây dựng **QTPP**, CQA, CMA và CPP; quản lý đánh giá rủi ro FMEA.
- Tạo ma trận DoE: full/fractional factorial, Box–Behnken, CCD, D-optimal, mixture và combined mixture–process; thiết kế mixture–process có tùy chọn D-optimal 14/24/30 run theo mức độ mô hình.
- Nhập/xuất bảng DoE qua Excel hoặc CSV; tạo dữ liệu thử nghiệm mô phỏng có giới hạn vật lý phù hợp theo loại đáp ứng.
- Phân tích hồi quy đa thức và ANOVA, bao gồm kiểm tra thiếu bậc tự do, đa cộng tuyến và tính khả định của mô hình.
- Huấn luyện mô hình mạng nơ-ron theo từng CQA hoặc đa đầu ra.
- Hiển thị response surface, contour/ternary plot, profiler, desirability và Design Space qua mô phỏng Monte Carlo.
- Tạo báo cáo phát triển theo cấu trúc CTD 3.2.P.2 và xuất Word.

## Case Study đi kèm

| Case Study | Thiết kế | Một số đáp ứng |
| --- | --- | --- |
| Metoprolol Succinate ER tablet | Box–Behnken | Hòa tan 2 h/8 h, độ cứng, friability |
| Apixaban Intermediate | CCD face-centered | Hiệu suất, tổng tạp chất, D90 |
| Paclitaxel Lipid Nanoemulsion | Combined mixture–process | Kích thước giọt, PDI, hiệu suất nạp thuốc |
| Hoạt Chất Z biphasic MR tablet | CCD face-centered | T50, T80, độ cứng, friability, f2 trong ethanol |

Dữ liệu mô phỏng áp dụng các ràng buộc vật lý cho từng dạng đáp ứng; chẳng hạn PDI luôn dương, phần trăm nằm trong 0–100, còn kích thước hạt và độ cứng phải lớn hơn 0. Các giá trị ngoài specification vẫn có thể xuất hiện khi chúng là kết quả thí nghiệm hợp lý để đánh giá Design Space.

## Khởi chạy cục bộ

Yêu cầu: Node.js 20 trở lên và npm.

```bash
npm ci
npm run dev
```

Mở địa chỉ do Vite hiển thị (thường là `http://localhost:5173`).

## Kiểm tra và build

```bash
npm run lint
npm run build
npm run preview
```

`npm run build` thực hiện kiểm tra TypeScript và tạo bản phát hành trong thư mục `dist`.

## Công nghệ

- React 19 + TypeScript
- Vite
- Plotly.js cho biểu đồ và bề mặt đáp ứng
- SheetJS (`xlsx`) cho Excel/CSV
- `docx` cho báo cáo Word

## Cấu trúc chính

```text
src/
  data/        Case Study mẫu
  components/  Giao diện theo các bước QbD
  services/    DoE, thống kê, tối ưu, AI và xuất báo cáo
  types/       Kiểu dữ liệu miền QbD
```

## Triển khai

Kho đã có GitHub Actions để build và triển khai GitHub Pages khi có thay đổi trên nhánh `main`. Cần bật GitHub Pages trong phần Settings của repository nếu chưa được cấu hình.

## Lưu ý khoa học

Kết quả thống kê và Design Space phụ thuộc vào chất lượng, cỡ mẫu, thiết kế, phương pháp phân tích và giả định mô hình. Trước khi sử dụng cho mục đích GxP hoặc hồ sơ đăng ký, cần có đánh giá độc lập của chuyên gia phát triển dược phẩm và thống kê.
