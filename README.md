# QbD Experimental Design

Ứng dụng web hỗ trợ phát triển sản phẩm dược phẩm theo **Quality by Design (QbD)**. Ứng dụng đưa quy trình từ QTPP/CQA và đánh giá rủi ro đến thiết kế thí nghiệm, phân tích mô hình, tối ưu đa đáp ứng và tạo báo cáo vào cùng một luồng làm việc.

> Các giá trị trong Case Study và tính năng “Điền Mô Phỏng” chỉ phục vụ minh họa, đào tạo và kiểm thử mô hình. Chúng không thay thế dữ liệu thực nghiệm, thẩm định phương pháp hoặc quyết định phát triển/đăng ký thuốc.

## Chức năng

- Xây dựng **QTPP**, CQA, CMA và CPP; quản lý đánh giá rủi ro FMEA (ICH Q9).
- Tạo ma trận DoE toàn diện: full/fractional factorial, Plackett–Burman, Definitive Screening Design (DSD - Jones & Nachtsheim 2011), Box–Behnken, CCD, D-optimal, mixture (Simplex Lattice, Centroid, Extreme Vertices) và combined mixture–process với ràng buộc đa diện Piepel (1983).
- Nhập/xuất ma trận DoE bằng định dạng CSV UTF-8 BOM tương thích Excel và phần mềm thống kê (không phụ thuộc parser workbook nhị phân, phòng chống CSV Injection).
- Phân tích hồi quy đa thức OLS và ANOVA Type I/III, kiểm tra thiếu độ phù hợp (Lack-of-Fit), kiểm tra độ cong (Curvature test), đa cộng tuyến (VIF) và tính khả định của mô hình.
- Huấn luyện mô hình trí tuệ nhân tạo mạng nơ-ron (ANN MLP), máy vectơ hỗ trợ (SVR) và mô hình kết hợp (Ensemble Stacking) với tiêu chuẩn thông tin AICc (Hurvich–Tsai) và giải thích mô hình XAI (Garson, Olden, SHAP values).
- Tối ưu hóa đa đáp ứng Derringer–Suich bằng thuật toán di truyền liên tục (Real-Coded GA + Nelder–Mead simplex local search).
- Hiển thị response surface 2D/3D Plotly, contour/ternary plot, profiler dự đoán động, và đánh giá độ bền vững Design Space qua mô phỏng Monte Carlo 10.000+ lô ảo.
- Quản trị GxP & Vết kiểm toán mật mã học (tham chiếu 21 CFR Part 11 / EU Annex 11): Lưu trữ phiên người dùng (Analyst / Reviewer / Approver), ký duyệt số WebCrypto ECDSA P-256, chuỗi băm SHA-256 phát hiện can thiệp và lưu trữ bền vững IndexedDB.
- Huấn luyện nền Web Worker tránh nghẽn luồng giao diện người dùng.
- Tôn trọng quyền riêng tư dữ liệu: Tích hợp Google Consent Mode v2 (mặc định từ chối telemetry).
- Xác nhận phương án tối ưu bằng các mẻ/thí nghiệm độc lập: chốt điều kiện và ngưỡng sai lệch, so sánh thực nghiệm với khoảng dự đoán (PI 95%) và giới hạn chất lượng.
- Xuất bản thảo báo cáo phát triển CTD 3.2.P.2 sang định dạng Word (.docx) và PDF lưu trữ (Archival PDF kèm siêu dữ liệu XMP).

## Case Study đi kèm

| Case Study | Thiết kế | Một số đáp ứng |
| --- | --- | --- |
| Metoprolol Succinate ER tablet | Box–Behnken | Hòa tan 2 h/8 h, độ cứng, friability |
| Apixaban Intermediate | CCD face-centered | Hiệu suất, tổng tạp chất, D90 |
| Paclitaxel Lipid Nanoemulsion | Combined mixture–process | Kích thước giọt, PDI, hiệu suất nạp thuốc |
| Hoạt Chất Z biphasic MR tablet | CCD face-centered | T50, T80, độ cứng, friability, f2 trong ethanol |

Dữ liệu mô phỏng áp dụng các ràng buộc vật lý cho từng dạng đáp ứng; chẳng hạn PDI luôn dương, phần trăm nằm trong 0–100, còn kích thước hạt và độ cứng phải lớn hơn 0. Các giá trị ngoài specification vẫn có thể xuất hiện khi chúng là kết quả thí nghiệm hợp lý để đánh giá Design Space.

## Khởi chạy cục bộ

Yêu cầu: Node.js 20.19+ hoặc 22.12+ và npm (theo yêu cầu của Vite).

```bash
npm ci
npm run dev
```

Mở địa chỉ do Vite hiển thị (thường là `http://localhost:5173`).

## Kiểm tra và build

```bash
npm run lint
npm test
npm run build
npm run preview
```

`npm run build` thực hiện kiểm tra TypeScript và tạo bản phát hành trong thư mục `dist`.

## Công nghệ

- React 19 + TypeScript
- Vite
- Plotly.js cho biểu đồ và mặt đáp
- Trình đọc/ghi CSV nội bộ, giới hạn import 10 MB; không phụ thuộc parser workbook nhị phân
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

## Lưu ý khoa học & Tuân thủ GxP (CSV / GAMP 5)

Kết quả thống kê, tối ưu hóa và Design Space phụ thuộc vào chất lượng, cỡ mẫu, thiết kế, phương pháp phân tích và giả định mô hình. Trước khi sử dụng cho mục đích GxP hoặc hồ sơ đăng ký, cần có đánh giá độc lập của chuyên gia phát triển dược phẩm và thống kê.

Ứng dụng **QbD Studio™** phiên bản client-side được thiết kế chuyên biệt cho mục đích **Nghiên cứu & Phát triển (Exploratory Formulation R&D)**. Ứng dụng tích hợp hỗ trợ quản trị GxP và vết kiểm toán mật mã học tham chiếu 21 CFR Part 11 / EU Annex 11, nhưng **không thay thế** hệ thống quản lý tài liệu điện tử (eDMS) hoặc LIMS đã được thẩm định GAMP 5/CSV đầy đủ của doanh nghiệp. Mọi dữ liệu hoặc báo cáo xuất ra cần được thẩm định nội bộ, ký ướt hoặc ký số trên hệ thống chính thức trước khi nộp cơ quan quản lý.

Các dải được lưu từ Prediction Profiler là **provisional screening ranges**, không phải PAR đã xác nhận. PAR/Design Space chính thức cần đánh giá đa biến, uncertainty phù hợp, confirmation run độc lập và phê duyệt theo hệ thống chất lượng. OLS/ANOVA có biến giả cho hiệu ứng block cố định; đây không phải mô hình random-effects. Xem [báo cáo đối chiếu thống kê](STATISTICAL_AUDIT.md) để biết phạm vi kiểm chứng và giới hạn.

## Thí nghiệm xác nhận phương án tối ưu

Trong bước **7. Không gian Thiết kế**, chọn một điều kiện trong Profiler hoặc một kịch bản đã lưu rồi bấm **Tạo thí nghiệm xác nhận**. Điều chỉnh thông số thực hiện sau làm tròn nếu cần; app kiểm tra miền thiết kế và tính lại dự đoán tại điều kiện này. Chọn số mẻ độc lập, mức PI, cách kiểm tra specification và ngưỡng sai lệch riêng cho từng đáp ứng **trước khi** chốt kế hoạch.

Sau khi chốt, nhập mỗi mẻ trên một dòng hoặc dán bảng tab từ Excel với tiêu đề `batch`, các mã X, rồi các mã Y. Các phép đo lặp trên cùng một mẫu cần được tổng hợp trước khi nhập; chúng không được tính là các mẻ độc lập. App báo cáo bias, độ lệch tuyệt đối, lệch tương đối, SD, RMSE, PI của từng mẻ và trung bình nếu mô hình OLS có đủ thông tin. Với đáp ứng phân loại, app so sánh mức thực tế với mức đích và không tính PI số học. Với ANN hoặc mô hình chưa có phương sai dự đoán hợp lệ, app vẫn đánh giá specification nhưng ghi rõ PI chưa có. Kết quả nằm trong PI không tự chứng minh tương đương và xác nhận tại một điểm không xác nhận toàn bộ Design Space/PAR.

Hồ sơ giữ nguyên mô hình/dự đoán ban đầu khi dữ liệu DoE được thay đổi. Dữ liệu xác nhận chỉ được thêm vào tập xây dựng mô hình khi người dùng chọn thao tác đó sau khi hoàn tất đánh giá; app đưa các mẻ này vào block mới và lưu dấu thời gian. Từ lúc đó, chúng không còn là tập xác nhận độc lập cho mô hình mới.
