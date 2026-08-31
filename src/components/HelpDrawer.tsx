import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  X,
  Search,
  Target,
  ShieldAlert,
  LayoutGrid,
  Calculator,
  BrainCircuit,
  Compass,
  Boxes,
  FileCheck2,
  ChevronDown,
  ChevronRight,
  BookOpen,
  Lightbulb,
  Sliders,
  Activity,
  ArrowRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Pin,
  PinOff,
} from 'lucide-react';
import type { TabKey } from './TabNavigation';
import type { QBDProject, ModelingEngine } from '../types/qbd';
import { InlineMath, BlockMath } from './MathView';

interface HelpDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  activeTab: TabKey;
  project: QBDProject;
  modelingEngine: ModelingEngine;
  selectedCQA?: string;
  onNavigateToTab?: (tab: TabKey) => void;
  isPinned?: boolean;
  onTogglePin?: () => void;
}

interface HelpSection {
  id: string;
  title: string;
  icon: any;
  content: React.ReactNode;
}

export const HelpDrawer: React.FC<HelpDrawerProps> = ({
  isOpen,
  onClose,
  activeTab,
  project,
  modelingEngine,
  selectedCQA,
  onNavigateToTab,
  isPinned = true,
  onTogglePin,
}) => {
  const [viewingTab, setViewingTab] = useState<TabKey>(activeTab);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isCompactViewport, setIsCompactViewport] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const effectivePinned = isPinned && !isCompactViewport;
  
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    workflow: true,
    inputs: true,
    algorithms: true,
    diagnostics: true,
    tips: true,
  });

  useEffect(() => {
    if (isOpen) {
      setViewingTab(activeTab);
    }
  }, [isOpen, activeTab]);

  useEffect(() => {
    setExpandedSections({
      workflow: true,
      inputs: true,
      algorithms: true,
      diagnostics: true,
      tips: true,
    });
  }, [viewingTab]);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 900px)');
    const updateViewport = () => setIsCompactViewport(media.matches);
    updateViewport();
    media.addEventListener('change', updateViewport);
    return () => media.removeEventListener('change', updateViewport);
  }, []);

  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      window.requestAnimationFrame(() => drawerRef.current?.focus());
    } else {
      previousFocusRef.current?.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
        return;
      }
      if (e.key === 'Tab' && isOpen && !effectivePinned && drawerRef.current) {
        const focusable = [...drawerRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])')]
          .filter((element) => element.offsetParent !== null);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [effectivePinned, isOpen, onClose]);

  const toggleSection = (id: string) => {
    setExpandedSections((prev) => {
      const isCurrentlyExpanded = prev[id] !== undefined ? prev[id] : true;
      return {
        ...prev,
        [id]: !isCurrentlyExpanded,
      };
    });
  };

  const expandAll = () => {
    setExpandedSections({
      workflow: true,
      inputs: true,
      algorithms: true,
      diagnostics: true,
      tips: true,
    });
  };

  const collapseAll = () => {
    setExpandedSections({
      workflow: false,
      inputs: false,
      algorithms: false,
      diagnostics: false,
      tips: false,
    });
  };

  const tabsList: Array<{ key: TabKey; label: string; short: string; icon: any; standard: string }> = [
    { key: 'qtpp', label: '1. QTPP & CQAs', short: 'QTPP/CQA', icon: Target, standard: 'ICH Q8(R2)' },
    { key: 'fmea', label: '2. Rủi ro FMEA', short: 'FMEA/Ishikawa', icon: ShieldAlert, standard: 'ICH Q9' },
    { key: 'doe', label: '3. Thiết kế DoE', short: 'Ma trận DoE', icon: LayoutGrid, standard: 'DoE Matrix' },
    { key: 'anova', label: '4. Thống kê ANOVA', short: 'ANOVA Models', icon: Calculator, standard: 'MLR & Diagnostics' },
    { key: 'neural', label: '5. Mạng Nơ-ron', short: 'Neural AI', icon: BrainCircuit, standard: 'ANN Platform' },
    { key: 'rsm', label: '6. Bề mặt RSM', short: 'RSM & Contour', icon: Compass, standard: '3D/2D/Ternary' },
    { key: 'design_space', label: '7. Vùng Thiết kế', short: 'Design Space', icon: Boxes, standard: 'ICH Q8/Q9/Q10' },
    { key: 'report', label: '8. Báo Cáo Hồ Sơ', short: 'CTD 3.2.P.2', icon: FileCheck2, standard: 'CTD Dossier' },
  ];

  const currentCQAObj = project.cqas.find((c) => c.code === selectedCQA) || project.cqas[0];

  const getHelpContent = (tabKey: TabKey): HelpSection[] => {
    switch (tabKey) {
      case 'qtpp':
        return [
          {
            id: 'workflow',
            title: 'Quy Trình & Thứ Tự Các Bước Thực Hiện (Workflow)',
            icon: Target,
            content: (
              <div>
                <p style={{ marginBottom: '0.6rem' }}>
                  Thiết lập hồ sơ chất lượng sản phẩm đích (<strong>QTPP</strong>), xác định các thuộc tính chất lượng trọng yếu (<strong>CQAs</strong>) và phân loại các biến đầu vào (<strong>CMAs/CPPs</strong>) theo chuẩn <strong>ICH Q8(R2)</strong>.
                </p>
                <div style={{ backgroundColor: '#f0fdf4', padding: '0.6rem 0.8rem', borderRadius: '0.4rem', border: '1px solid #bbf7d0', fontSize: '0.78rem', color: '#166534', lineHeight: 1.6 }}>
                  <strong>Thứ tự thao tác chuẩn:</strong>
                  <br />1. Nhập <strong>Thông tin Tổng quan Dự án</strong> (Metadata).
                  <br />2. Bấm <strong>"+ Thêm Yếu tố QTPP"</strong> để khai báo các chỉ tiêu lâm sàng đích.
                  <br />3. Bấm <strong>"+ Thêm CQA (Đáp ứng Y)"</strong> để khai báo các biến đầu ra cần kiểm soát và khoảng chấp nhận LSL–USL.
                  <br />4. Bấm <strong>"+ Thêm Nhân Tố (X)"</strong> để khai báo các biến công thức/quy trình sẽ đưa vào nghiên cứu thực nghiệm.
                </div>
              </div>
            ),
          },
          {
            id: 'inputs',
            title: 'Chi Tiết Từng Nút Bấm, Ô Nhập Liệu & Thao Tác',
            icon: Sliders,
            content: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.78rem' }}>
                <div style={{ backgroundColor: '#f8fafc', padding: '0.65rem', borderRadius: '0.375rem', border: '1px solid #e2e8f0' }}>
                  <strong style={{ color: '#1e3a8a' }}>1. Khung "Thông tin Tổng quan Dự án (Project Metadata)":</strong>
                  <ul style={{ paddingLeft: '1.2rem', marginTop: '0.3rem', color: '#334155', lineHeight: 1.5 }}>
                    <li><strong>Tên Dự án / Nghiên cứu:</strong> Tiêu đề nghiên cứu (vd: <em>Tối ưu hóa viên nén Metoprolol 100mg</em>).</li>
                    <li><strong>Tên Hoạt chất / API:</strong> Tên hoạt chất mục tiêu (vd: <em>Metoprolol Succinate</em>).</li>
                    <li><strong>Dạng bào chế &amp; Đường dùng:</strong> Ví dụ: <em>Viên nén giải phóng kéo dài, dùng đường uống</em>.</li>
                    <li><strong>Đơn vị / Nhóm nghiên cứu:</strong> Đơn vị R&amp;D thực hiện.</li>
                  </ul>
                </div>

                <div style={{ backgroundColor: '#f8fafc', padding: '0.65rem', borderRadius: '0.375rem', border: '1px solid #e2e8f0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                    <strong style={{ color: '#0f766e' }}>2. Khung "1. Hồ sơ Chất lượng Sản phẩm Mục tiêu (QTPP)":</strong>
                    <span className="badge badge-teal" style={{ fontSize: '0.68rem' }}>Nút: + Thêm Yếu tố QTPP</span>
                  </div>
                  <ul style={{ paddingLeft: '1.2rem', color: '#334155', lineHeight: 1.5 }}>
                    <li><strong>Nút "+ Thêm Yếu tố QTPP":</strong> Tạo thêm 1 dòng chỉ tiêu chất lượng đích mới.</li>
                    <li><strong>Yếu tố QTPP (Element):</strong> Chỉ tiêu chất lượng (vd: Độ hòa tan sau 12h, Hàm lượng hoạt chất, Độ cứng...).</li>
                    <li><strong>Mục tiêu Đích (Target):</strong> Mức tiêu chuẩn cần đạt (vd: 95.0% – 105.0%, giải phóng &ge; 80%).</li>
                    <li><strong>Căn cứ Khoa học / Dược điển (Justification):</strong> Trích dẫn Dược điển Việt Nam V, USP, hoặc Ph. Eur.</li>
                    <li><strong>Nút 🗑️ (Xóa):</strong> Xóa mục QTPP tương ứng.</li>
                  </ul>
                </div>

                <div style={{ backgroundColor: '#f8fafc', padding: '0.65rem', borderRadius: '0.375rem', border: '1px solid #e2e8f0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                    <strong style={{ color: '#1e40af' }}>3. Khung "2. Thuộc tính Chất lượng Trọng yếu (CQAs - Biến Đầu Ra)":</strong>
                    <span className="badge badge-primary" style={{ fontSize: '0.68rem' }}>Nút: + Thêm CQA (Đáp ứng Y)</span>
                  </div>
                  <ul style={{ paddingLeft: '1.2rem', color: '#334155', lineHeight: 1.5 }}>
                    <li><strong>Nút "+ Thêm CQA (Đáp ứng Y)":</strong> Thêm một biến đáp ứng mới (<InlineMath math="Y_1, Y_2\dots" />).</li>
                    <li><strong>Bản Chất Dữ Liệu (Data Type):</strong>
                      <br />• <em>Continuous:</em> Định lượng liên tục (Độ hòa tan %, Độ cứng N, Kích thước hạt &micro;m).
                      <br />• <em>Discrete Numeric:</em> Định lượng rời rạc nhiều mức số (vd: 1, 2, 3).
                      <br />• <em>Categorical (Đạt / Không đạt):</em> Định tính nhị phân 2 mức.
                      <br />• <em>Categorical (Nhiều mức / Thứ bậc):</em> Định tính phân loại nhiều cấp.
                    </li>
                    <li><strong>Nút "+ Thêm mức" / 🗑️ Xóa mức:</strong> Tùy chỉnh danh sách các mức cho biến Discrete / Categorical (tối đa 10 mức).</li>
                    <li><strong>LSL / Mục tiêu / USL:</strong> Giới hạn dưới (<InlineMath math="\text{LSL}" />), Đích lý tưởng, Giới hạn trên (<InlineMath math="\text{USL}" />).</li>
                    <li><strong>Mục tiêu Tối ưu:</strong>
                      <br />• 🎯 <em>Đạt Target:</em> Nằm trong khoảng <InlineMath math="[\text{LSL}, \text{USL}]" /> quanh Target.
                      <br />• 📈 <em>Càng lớn càng tốt (Max):</em> Tối đa hóa giá trị đáp ứng.
                      <br />• 📉 <em>Càng nhỏ càng tốt (Min):</em> Tối thiểu hóa (tạp chất, thời gian rã).
                      <br />• 📏 <em>Nằm trong khoảng:</em> Giữ an toàn giữa LSL và USL.
                      <br />• 🏆 <em>Đạt Tiêu Chuẩn:</em> Ưu tiên đạt phân loại mục tiêu.
                    </li>
                    <li><strong>Trọng số (<InlineMath math="w_i \in [0.1, 5.0]" />):</strong> Mức độ quan trọng tương đối khi tính độ thỏa dụng tổng thể.</li>
                    <li><strong>Nút 🗑️ (Xóa CQA):</strong> Xóa biến đáp ứng.</li>
                  </ul>
                </div>

                <div style={{ backgroundColor: '#f8fafc', padding: '0.65rem', borderRadius: '0.375rem', border: '1px solid #e2e8f0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                    <strong style={{ color: '#b45309' }}>4. Khung "3. Các Biến Đầu Vào Khảo Sát (CMA / CPP - Biến Đầu Vào)":</strong>
                    <span className="badge badge-warning" style={{ fontSize: '0.68rem' }}>Nút: + Thêm Nhân Tố (X)</span>
                  </div>
                  <ul style={{ paddingLeft: '1.2rem', color: '#334155', lineHeight: 1.5 }}>
                    <li><strong>Nút "+ Thêm Nhân Tố (X)":</strong> Thêm một biến đầu vào mới (<InlineMath math="X_1, X_2\dots" />).</li>
                    <li><strong>Vai Trò (Phân Loại X):</strong>
                      <br />• 🧪 <em>Thành phần Hỗn hợp (&Sigma;=100%):</em> Ràng buộc tổng tỷ lệ luôn bằng 100%.
                      <br />• 💊 <em>Biến công thức khác:</em> Lượng chất, tỷ lệ ngoài hỗn hợp.
                      <br />• ⚙️ <em>Biến quy trình:</em> Lực dập, nhiệt độ sấy, tốc độ cánh khuấy.
                    </li>
                    <li><strong>Bản Chất Dữ Liệu:</strong> Continuous (Liên tục), Discrete Numeric, Categorical.</li>
                    <li><strong>Khả Năng Kiểm Soát:</strong>
                      <br />• 🎯 <em>Kiểm soát được (Control):</em> Cài đặt chủ động trong DoE.
                      <br />• 🌪️ <em>Không kiểm soát (Noise):</em> Biến nhiễu môi trường.
                      <br />• 🔒 <em>Hằng số cố định (Constant):</em> Cố định xuyên suốt (không tăng số lần chạy DoE).
                    </li>
                    <li><strong>Khoảng liên tục (Thấp / Tâm / Cao):</strong> Giá trị thực tế tương ứng với mức mã hóa <InlineMath math="[-1, 0, +1]" />.</li>
                    <li><strong>Nút 🗑️ (Xóa Factor):</strong> Xóa biến đầu vào.</li>
                  </ul>
                </div>
              </div>
            ),
          },
          {
            id: 'algorithms',
            title: 'Thuật Toán Mã Hóa & Ràng Buộc Hỗn Hợp Trong App',
            icon: Calculator,
            content: (
              <div style={{ fontSize: '0.78rem', color: '#334155', lineHeight: 1.6 }}>
                <p><strong>1. Công thức Mã Hóa Biến Định Lượng (Coded Factors):</strong></p>
                <BlockMath math="x_{\text{coded}} = \frac{X_{\text{actual}} - X_{\text{center}}}{(X_{\text{high}} - X_{\text{low}}) / 2} \in [-1, +1]" />
                
                <p style={{ marginTop: '0.5rem' }}><strong>2. Ràng Buộc Simplex Cho Biến Hỗn Hợp (Mixture Constraint):</strong></p>
                <p>Bảo toàn định luật tổng nồng độ <InlineMath math="\sum_{i=1}^q X_i = 100\%" />. Để ma trận DoE khả thi, hệ thống bắt buộc kiểm tra điều kiện:</p>
                <BlockMath math="\sum_{i=1}^q L_i \le 100\% \le \sum_{i=1}^q U_i" />

                <p style={{ marginTop: '0.5rem' }}><strong>3. Hàm Thỏa Dụng Thành Phần Desirability (<InlineMath math="d_i" />):</strong></p>
                <p>• Tối đa hóa (Maximize):</p>
                <BlockMath math="d_i = \left( \frac{y_i - \text{LSL}_i}{\text{USL}_i - \text{LSL}_i} \right)^s \quad (s > 0)" />
                <p>• Tối thiểu hóa (Minimize):</p>
                <BlockMath math="d_i = \left( \frac{\text{USL}_i - y_i}{\text{USL}_i - \text{LSL}_i} \right)^t \quad (t > 0)" />
              </div>
            ),
          },
          {
            id: 'tips',
            title: 'Mẹo Thực Hành & Xử Lý Tình Huống',
            icon: Lightbulb,
            content: (
              <ul style={{ paddingLeft: '1.2rem', fontSize: '0.78rem', color: '#334155', lineHeight: 1.6 }}>
                <li><strong>Cảnh báo màu vàng ở Hỗn hợp:</strong> Nếu <InlineMath math="\sum L_i > 100\%" /> hoặc <InlineMath math="\sum U_i < 100\%" />, hãy điều chỉnh lại dải Low/High của các tá dược để tổng có thể đạt đúng 100%.</li>
                <li><strong>Biến hằng số (Constant):</strong> Tự động được khóa cố định, giúp tiết kiệm số lần chạy thí nghiệm không cần thiết.</li>
              </ul>
            ),
          },
        ];

      case 'fmea':
        return [
          {
            id: 'workflow',
            title: 'Quy Trình & Thứ Tự Các Bước Thực Hiện (Workflow)',
            icon: ShieldAlert,
            content: (
              <div>
                <p style={{ marginBottom: '0.6rem' }}>
                  Đánh giá và sàng lọc các yếu tố nguy cơ cao nhất theo chuẩn <strong>ICH Q9 (Quality Risk Management)</strong> trước khi tiến hành thực nghiệm DoE.
                </p>
                <div style={{ backgroundColor: '#fffbeb', padding: '0.6rem 0.8rem', borderRadius: '0.4rem', border: '1px solid #fde68a', fontSize: '0.78rem', color: '#92400e', lineHeight: 1.6 }}>
                  <strong>Thứ tự thao tác chuẩn:</strong>
                  <br />1. Bấm nút <strong>"Ma trận FMEA"</strong> để chấm điểm rủi ro số lượng, hoặc <strong>"Sơ đồ Xương cá (Ishikawa)"</strong> để rà soát nguyên nhân gốc rễ (6M).
                  <br />2. Bấm <strong>"+ Thêm Hàng Đánh Giá Rủi Ro"</strong> để bổ sung cặp tương tác [Biến đầu vào &times; CQA].
                  <br />3. Cho điểm từ 1–10 cho 3 chỉ số <strong>S</strong> (Mức nghiêm trọng), <strong>P</strong> (Xác suất xảy ra), <strong>D</strong> (Khó phát hiện).
                  <br />4. Quan sát hệ thống tự tính <strong>RPN</strong> và phân loại mức độ rủi ro (Cao / Trung bình / Thấp).
                  <br />5. Bấm nút <strong>"Chuyển sang DoE"</strong> ở góc phải để tiến hành thiết kế ma trận thí nghiệm.
                </div>
              </div>
            ),
          },
          {
            id: 'inputs',
            title: 'Chi Tiết Từng Nút Bấm, Bảng Điểm S-P-D & Phân Loại Rủi Ro',
            icon: Sliders,
            content: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', fontSize: '0.78rem' }}>
                <div style={{ backgroundColor: '#f8fafc', padding: '0.6rem', borderRadius: '0.375rem', border: '1px solid #e2e8f0' }}>
                  <strong style={{ color: '#1e3a8a' }}>1. Nút Chuyển Chế Độ &amp; Điều Hướng:</strong>
                  <ul style={{ paddingLeft: '1.2rem', marginTop: '0.3rem', color: '#334155', lineHeight: 1.5 }}>
                    <li><strong>Nút "Ma trận FMEA":</strong> Hiển thị bảng tính chấm điểm S, P, D và tính chỉ số RPN.</li>
                    <li><strong>Nút "Sơ đồ Xương cá (Ishikawa)":</strong> Trực quan hóa sơ đồ nguyên nhân - kết quả theo 6 nhóm: <em>Material, Machine, Method, Measurement, Environment, People</em>.</li>
                    <li><strong>Nút "Chuyển sang DoE":</strong> Chuyển nhanh sang Tab 3 (DoE Designer).</li>
                  </ul>
                </div>

                <div style={{ backgroundColor: '#f8fafc', padding: '0.6rem', borderRadius: '0.375rem', border: '1px solid #e2e8f0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                    <strong style={{ color: '#0f766e' }}>2. Bảng Phân Tích Chế Độ Hư Hỏng &amp; Tác Động (FMEA Matrix):</strong>
                    <span className="badge badge-teal" style={{ fontSize: '0.68rem' }}>Nút: + Thêm Hàng Đánh Giá Rủi Ro</span>
                  </div>
                  <ul style={{ paddingLeft: '1.2rem', color: '#334155', lineHeight: 1.5 }}>
                    <li><strong>Nút "+ Thêm Hàng Đánh Giá Rủi Ro":</strong> Thêm một dòng phân tích rủi ro mới.</li>
                    <li><strong>Biến Đầu Vào (Factor):</strong> Chọn nhân tố X cần đánh giá.</li>
                    <li><strong>CQA Bị Ảnh Hưởng:</strong> Chọn chỉ tiêu chất lượng tương ứng.</li>
                    <li><strong>Chế độ sai lỗi / Cơ chế ảnh hưởng:</strong> Mô tả cơ chế lý hóa gây nguy cơ sai lệch.</li>
                    <li><strong>S (Severity - Mức nghiêm trọng, 1–10):</strong> 1–3 (Nhẹ), 4–6 (Vừa), 7–10 (Nghiêm trọng, vi phạm Dược điển/mất an toàn).</li>
                    <li><strong>P (Probability - Xác suất xảy ra, 1–10):</strong> 1–3 (Hiếm gặp), 4–6 (Thỉnh thoảng), 7–10 (Thường xuyên).</li>
                    <li><strong>D (Detectability - Độ khó phát hiện, 1–10):</strong> 1–3 (Dễ phát hiện ngay qua IPC), 4–6 (Phát hiện qua QC), 7–10 (Rất khó phát hiện).</li>
                    <li><strong>Biện pháp kiểm soát &amp; Checkbox "Đưa vào DoE":</strong> Đánh dấu các biến cần đưa vào khảo sát thực nghiệm.</li>
                    <li><strong>Nút 🗑️ (Xóa):</strong> Xóa dòng đánh giá rủi ro.</li>
                  </ul>
                </div>
              </div>
            ),
          },
          {
            id: 'algorithms',
            title: 'Công Thức RPN & Cách Dùng Điểm Rủi Ro Trong Ứng Dụng',
            icon: Calculator,
            content: (
              <div style={{ fontSize: '0.78rem', color: '#334155', lineHeight: 1.6 }}>
                <BlockMath math="\text{RPN} = \text{Severity } (S) \times \text{Probability } (P) \times \text{Detectability } (D) \in [1, 1000]" />
                
                <div style={{ marginTop: '0.6rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  <div style={{ padding: '0.45rem 0.65rem', borderRadius: '0.35rem', backgroundColor: '#fee2e2', color: '#991b1b' }}>
                    🔴 <strong>RỦI RO CAO (<InlineMath math="\text{RPN} \ge 100" />):</strong> Đây là ngưỡng cấu hình của ứng dụng; ô “Khảo sát DoE” được đề xuất. Hãy xác nhận bằng cơ chế tác động, kiến thức sẵn có và nguồn lực trước khi đưa biến vào DoE.
                  </div>
                  <div style={{ padding: '0.45rem 0.65rem', borderRadius: '0.35rem', backgroundColor: '#fef3c7', color: '#92400e' }}>
                    🟡 <strong>RỦI RO TRUNG BÌNH (<InlineMath math="50 \le \text{RPN} < 100" />):</strong> Cân nhắc khảo sát, đặt kiểm soát bổ sung hoặc lập luận khoa học để loại trừ.
                  </div>
                  <div style={{ padding: '0.45rem 0.65rem', borderRadius: '0.35rem', backgroundColor: '#dcfce7', color: '#166534' }}>
                    🟢 <strong>RỦI RO THẤP (<InlineMath math="\text{RPN} < 50" />):</strong> Có thể kiểm soát bằng SOP/giám sát thường quy nếu lập luận và bằng chứng phù hợp.
                  </div>
                </div>
              </div>
            ),
          },
          {
            id: 'tips',
            title: 'Mẹo Thực Hành Quản Lý Rủi Ro ICH Q9',
            icon: Lightbulb,
            content: (
              <ul style={{ paddingLeft: '1.2rem', fontSize: '0.78rem', color: '#334155', lineHeight: 1.6 }}>
                <li><strong>Sơ đồ xương cá 6M:</strong> Giúp tránh bỏ sót các yếu tố tiềm ẩn từ Môi trường (Environment) và Phương pháp đo lường (Measurement).</li>
                <li><strong>Diễn giải đúng RPN:</strong> ICH Q9(R1) không quy định ngưỡng RPN cố định. RPN là công cụ ưu tiên hóa nội bộ; hai rủi ro có cùng RPN vẫn cần xem riêng mức nghiêm trọng, khả năng phát hiện và biện pháp kiểm soát.</li>
                <li><strong>Đánh giá cập nhật sau DoE:</strong> Báo cáo có thể tạo bảng đánh giá rủi ro cập nhật từ kết quả mô hình. Bảng FMEA ban đầu không tự sửa điểm S/P/D; hãy rà soát và phê duyệt thay đổi thủ công.</li>
              </ul>
            ),
          },
        ];

      case 'doe':
        return [
          {
            id: 'workflow',
            title: 'Quy Trình & Thứ Tự Các Bước Thực Hiện (Workflow)',
            icon: LayoutGrid,
            content: (
              <div>
                <p style={{ marginBottom: '0.6rem' }}>
                  Thiết kế ma trận thực nghiệm tối ưu thống kê (<strong>DoE Matrix</strong>), đánh giá độ hiệu quả ma trận (<strong>D-Efficiency</strong>) và nhập/đồng bộ số liệu thực nghiệm với <strong>MS Excel</strong>.
                </p>
                <div style={{ backgroundColor: '#f0fdf4', padding: '0.6rem 0.8rem', borderRadius: '0.4rem', border: '1px solid #bbf7d0', fontSize: '0.78rem', color: '#166534', lineHeight: 1.6 }}>
                  <strong>Thứ tự thao tác chuẩn:</strong>
                  <br />1. Chọn <em>Mục tiêu nghiên cứu</em> và <em>Ngân sách run</em> trong <strong>Design Wizard</strong> &rarr; Bấm <strong>"Chọn phương án"</strong> (hoặc tự chọn dạng thiết kế).
                  <br />2. Bấm <strong>"Tạo Ma Trận Thí Nghiệm"</strong> để tạo bảng chạy thực nghiệm.
                  <br />3. (Tùy chọn) Bấm <strong>"+ Thêm run thông tin nhất"</strong> nếu cần bổ sung tuần tự (Sequential DoE).
                  <br />4. Xem chẩn đoán ma trận: tính khả định (rank/term), bậc tự do phần dư và D-efficiency. Các mức 70%/85% là thang xếp hạng nội bộ của app, không phải tiêu chuẩn đạt/không đạt phổ quát.
                  <br />5. Nhập số liệu thực nghiệm vào các cột CQA màu xanh ngọc (hoặc bấm <strong>"Điền Mô Phỏng"</strong> / dán từ Excel bằng <strong>"📥 Dán Dữ Liệu (Ctrl+V)"</strong>).
                  <br />6. Bấm <strong>"Phân Tích ANOVA"</strong> để chuyển sang bước tính toán thống kê.
                </div>
              </div>
            ),
          },
          {
            id: 'inputs',
            title: 'Chi Tiết Từng Nút Bấm, Menu Thao Tác & Bảng Tính Excel',
            icon: Sliders,
            content: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', fontSize: '0.78rem' }}>
                <div style={{ backgroundColor: '#f8fafc', padding: '0.6rem', borderRadius: '0.375rem', border: '1px solid #e2e8f0' }}>
                  <strong style={{ color: '#1e3a8a' }}>1. Khung Điều Khiển Đầu Trang &amp; Design Wizard:</strong>
                  <ul style={{ paddingLeft: '1.2rem', marginTop: '0.3rem', color: '#334155', lineHeight: 1.5 }}>
                    <li><strong>Nút "Tạo Ma Trận Thí Nghiệm":</strong> Khởi tạo toàn bộ ma trận thí nghiệm theo cấu hình đã chọn.</li>
                    <li><strong>Nút "Phân Tích ANOVA":</strong> Chuyển sang Tab 4 để phân tích mô hình.</li>
                    <li><strong>Design Wizard:</strong> Nhập <em>Mục tiêu nghiên cứu</em> (Sàng lọc / Tối ưu hóa / Robustness) và <em>Ngân sách tối đa (run)</em> &rarr; Bấm nút <strong>"Chọn phương án"</strong> tương ứng.</li>
                    <li><strong>Khung "Bổ sung tuần tự D-optimal (Sequential DoE)":</strong> Nhập <em>Số run bổ sung</em> &rarr; Bấm nút <strong>"+ Thêm run thông tin nhất"</strong> để bổ sung điểm thực nghiệm mà không làm mất các lần chạy đã có.</li>
                  </ul>
                </div>

                <div style={{ backgroundColor: '#f8fafc', padding: '0.6rem', borderRadius: '0.375rem', border: '1px solid #e2e8f0' }}>
                  <strong style={{ color: '#0f766e' }}>2. Thanh Công Cụ Thao Tác Bảng Tính (Spreadsheet Action Toolbar):</strong>
                  <ul style={{ paddingLeft: '1.2rem', marginTop: '0.3rem', color: '#334155', lineHeight: 1.5 }}>
                    <li><strong>Nút "+ Thêm Dòng" (Menu xổ xuống):</strong>
                      <br />• <em>+ Thêm 1 dòng ở cuối:</em> Thêm 1 lần chạy mới vào cuối bảng.
                      <br />• <em>+ Chèn 1 dòng tại vị trí chọn:</em> Chèn ngay dưới hàng đang kích hoạt.
                      <br />• <em>📑 Nhân bản dòng đang chọn:</em> Nhân bản các giá trị biến để làm điểm lặp.
                      <br />• <em>+ Thêm 5 dòng thí nghiệm / + Thêm 10 dòng thí nghiệm:</em> Thêm hàng loạt nhiều dòng.
                    </li>
                    <li><strong>Nút "Xóa Hàng / Xóa n Dòng":</strong> Xóa các dòng thí nghiệm đang được bôi đen.</li>
                    <li><strong>Nút "📋 Copy Vùng (Ctrl+C)":</strong> Sao chép vùng ô đang chọn hoặc toàn bộ bảng sang Clipboard.</li>
                    <li><strong>Nút "📥 Dán Dữ Liệu (Ctrl+V)":</strong> Dán trực tiếp số liệu từ Excel vào bảng tính.</li>
                    <li><strong>Nút "Xóa Ô (Del)":</strong> Xóa trắng nội dung trong các ô đang bôi đen.</li>
                    <li><strong>Nút "📤 Tải Lên":</strong> Nạp file dữ liệu thực nghiệm định dạng `.csv`.</li>
                    <li><strong>Nút "🎲 Xáo Run":</strong> Xáo ngẫu nhiên thứ tự thực hiện thí nghiệm (Randomized Run Order).</li>
                    <li><strong>Nút "Sắp (Run)" / "Sắp (Std)":</strong> Sắp xếp bảng hiển thị theo Run Order hoặc Standard Order.</li>
                    <li><strong>Nút "Điền Mô Phỏng":</strong> Sinh dữ liệu minh họa để kiểm tra luồng giao diện/phân tích; không dùng dữ liệu này để kết luận khoa học, lập hồ sơ hay xác nhận mô hình.</li>
                    <li><strong>Nút "Xuất File":</strong> Tải bảng số liệu về máy tính định dạng `.csv`.</li>
                  </ul>
                </div>
              </div>
            ),
          },
          {
            id: 'algorithms',
            title: 'Thuật Toán Đánh Giá Ma Trận (D-Efficiency, A-Eff, G-Eff, Leverage)',
            icon: Calculator,
            content: (
              <div style={{ fontSize: '0.78rem', color: '#334155', lineHeight: 1.6 }}>
                <p><strong>1. Chỉ số Hiệu Suất Định Thức D-Efficiency:</strong></p>
                <BlockMath math="\text{D-Efficiency} = 100 \times \left[ \frac{|\mathbf{X}^T \mathbf{X}|^{1/p}}{N} \right]" />
                <p>Đo lường độ tập trung của thông tin để ước lượng các hệ số hồi quy <InlineMath math="\boldsymbol{\beta}" />; giá trị cao hơn thường tốt hơn khi so sánh các thiết kế cùng mô hình và cùng miền khảo sát. App xếp hạng &gt;85% “Xuất sắc”, 70–85% “Tốt”, 50–70% “Chấp nhận được”; đây là hướng dẫn nội bộ, không thay thế kiểm tra rank, bậc tự do hay tính khả thi vận hành.</p>
                
                <p style={{ marginTop: '0.5rem' }}><strong>2. Đòn Bẩy (Leverage <InlineMath math="h_{ii}" />) &amp; Condition Number <InlineMath math="\kappa" />:</strong></p>
                <BlockMath math="h_{ii} = \mathbf{x}_i (\mathbf{X}^T \mathbf{X})^{-1} \mathbf{x}_i^T, \quad \bar{h} = \frac{p}{N}" />
                <BlockMath math="\kappa = \sqrt{\frac{\lambda_{\max}}{\lambda_{\min}}}" />
                <p>• <strong>Leverage</strong> cho biết một run có vị trí “xa tâm” đến mức nào trong ma trận; <strong>Condition number</strong> cảnh báo các cột thiết kế gần phụ thuộc tuyến tính. Giá trị xấu gợi ý ước lượng hệ số kém ổn định, không tự động chứng minh dữ liệu sai.</p>
              </div>
            ),
          },
          {
            id: 'tips',
            title: 'Mẹo Thực Hành Khi Triển Khai DoE Tại Phòng Thí Nghiệm',
            icon: Lightbulb,
            content: (
              <ul style={{ paddingLeft: '1.2rem', fontSize: '0.78rem', color: '#334155', lineHeight: 1.6 }}>
                <li><strong>Điểm tâm và run lặp:</strong> Khi thiết kế cho phép, thêm run lặp (thường gồm điểm tâm) để ước lượng <em>pure error</em>—dao động giữa các phép đo cùng điều kiện—và hỗ trợ kiểm định Lack of Fit. Số lần lặp phải dựa trên độ biến thiên và mục tiêu nghiên cứu.</li>
                <li><strong>Thứ tự ngẫu nhiên hóa (Randomized Run Order):</strong> Thực hiện các mẻ thử theo thứ tự ngẫu nhiên của cột Run Order để triệt tiêu sai số hệ thống theo thời gian.</li>
              </ul>
            ),
          },
        ];

      case 'anova':
        return [
          {
            id: 'workflow',
            title: 'Quy Trình & Thứ Tự Các Bước Thực Hiện (Workflow)',
            icon: Calculator,
            content: (
              <div>
                <p style={{ marginBottom: '0.6rem' }}>
                  Xây dựng phương trình hồi quy mô tả mối quan hệ giữa biến đầu vào <InlineMath math="\mathbf{X}" /> và đáp ứng CQA (<InlineMath math="Y" />). Kết quả là bằng chứng phát triển theo cách tiếp cận ICH Q8, không phải bằng chứng xác nhận quy trình thay thế cho các thí nghiệm xác nhận.
                </p>
                <div style={{ backgroundColor: '#f0fdf4', padding: '0.6rem 0.8rem', borderRadius: '0.4rem', border: '1px solid #bbf7d0', fontSize: '0.78rem', color: '#166534', lineHeight: 1.6 }}>
                  <strong>Thứ tự thao tác chuẩn:</strong>
                  <br />1. Chọn <strong>Đáp ứng CQA</strong> cần phân tích (<InlineMath math="Y_1, Y_2\dots" />) từ dropdown đầu trang.
                  <br />2. Xem gợi ý của <strong>Analysis Wizard</strong> &rarr; Bấm <strong>"Áp dụng"</strong> mô hình đề xuất (hoặc chọn thủ công từ dropdown <em>Dạng mô hình</em>: Quadratic, 2FI, Linear).
                  <br />3. (Tùy chọn) Bấm <strong>"Áp dụng [Mô hình] cho tất cả Y"</strong> để đồng bộ nhanh dạng mô hình cho các CQA còn lại.
                  <br />4. Đọc <strong>Bảng ANOVA</strong> cùng <InlineMath math="R^2, R^2_{adj}, Q^2" />, Lack of Fit, VIF và 4 biểu đồ chẩn đoán (Pareto, phần dư–dự đoán, Normal Plot, Cook's Distance).
                  <br />5. Chỉ chọn <strong>"Tiếp Tục Với Đa Thức (Bước 6, 7, 8)"</strong> sau khi mô hình phù hợp mục đích sử dụng, không có dấu hiệu chẩn đoán nghiêm trọng và đã lập kế hoạch run xác nhận.
                </div>
              </div>
            ),
          },
          {
            id: 'inputs',
            title: 'Chi Tiết Từng Nút Bấm, Menu Thao Tác & 4 Biểu Đồ Chẩn Đoán',
            icon: Sliders,
            content: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', fontSize: '0.78rem' }}>
                <div style={{ backgroundColor: '#f8fafc', padding: '0.6rem', borderRadius: '0.375rem', border: '1px solid #e2e8f0' }}>
                  <strong style={{ color: '#1e3a8a' }}>1. Khung Điều Khiển Đầu Trang:</strong>
                  <ul style={{ paddingLeft: '1.2rem', marginTop: '0.3rem', color: '#334155', lineHeight: 1.5 }}>
                    <li><strong>Dropdown "Đáp ứng CQA":</strong> Chọn CQA đang phân tích.</li>
                    <li><strong>Dropdown "Dạng mô hình":</strong> Chọn giữa <em>Đa thức Bậc 2 (Quadratic)</em>, <em>Tương tác 2 Nhân tố (2FI)</em>, <em>Tuyến tính (Linear)</em>.</li>
                    <li><strong>Nút "Thử Mạng Nơ-ron":</strong> Chuyển nhanh sang Tab 5 (Neural Network Tab) để so sánh với AI.</li>
                    <li><strong>Nút "Tiếp Tục Với Đa Thức (Bước 6, 7, 8)":</strong> Khóa mô hình Hồi quy Đa thức bậc &le; 2 làm phương pháp chính cho toàn bộ các bước tiếp theo.</li>
                  </ul>
                </div>

                <div style={{ backgroundColor: '#f8fafc', padding: '0.6rem', borderRadius: '0.375rem', border: '1px solid #e2e8f0' }}>
                  <strong style={{ color: '#0f766e' }}>2. Khung "Analysis Wizard — chọn mô hình và xác nhận":</strong>
                  <ul style={{ paddingLeft: '1.2rem', marginTop: '0.3rem', color: '#334155', lineHeight: 1.5 }}>
                    <li><strong>Nút "Áp dụng":</strong> Áp dụng cấu hình mô hình từ bảng so sánh ứng viên (AICc, <InlineMath math="Q^2" />, LOF p, df dư).</li>
                    <li><strong>Nút "Áp dụng [Mô hình] cho tất cả Y":</strong> Áp dụng đồng loạt dạng mô hình hiện chọn cho toàn bộ các CQA.</li>
                    <li><strong>Khung "Kế hoạch thí nghiệm xác nhận":</strong> Gợi ý run xác nhận, điều kiện chạy và khoảng tin cậy 95% (CI) khi mô hình OLS có thể ước lượng. CI là độ không chắc chắn của giá trị trung bình dự đoán; cần xác nhận bằng số liệu mới trước khi dùng để ra quyết định quy trình.</li>
                  </ul>
                </div>

                <div style={{ backgroundColor: '#f8fafc', padding: '0.6rem', borderRadius: '0.375rem', border: '1px solid #e2e8f0' }}>
                  <strong style={{ color: '#b45309' }}>3. 4 Biểu Đồ Chẩn Đoán Mô Hình (Diagnostic Plots):</strong>
                  <ul style={{ paddingLeft: '1.2rem', marginTop: '0.3rem', color: '#334155', lineHeight: 1.5 }}>
                    <li><strong>Biểu đồ Pareto (<InlineMath math="|t\text{-value}|" />):</strong> Xếp hạng độ lớn hiệu ứng chuẩn hóa. Vượt vạch tham chiếu nghĩa là có tín hiệu thống kê theo mô hình; vẫn cần kiểm tra ý nghĩa dược học và khoảng tin cậy.</li>
                    <li><strong>Phần dư vs Dự đoán:</strong> <em>Phần dư</em> = giá trị quan sát − dự đoán. Một dải ngẫu nhiên quanh 0 ủng hộ phương sai tương đối ổn định; dạng phễu, cong hoặc cụm gợi ý xem lại mô hình/dữ liệu. Dải ±3 chỉ là quy tắc sàng lọc cho phần dư student hóa.</li>
                    <li><strong>Xác suất Chuẩn (Normal Plot):</strong> Điểm gần đường thẳng ủng hộ giả định phần dư gần chuẩn; một vài lệch nhẹ không tự động làm mô hình vô hiệu, nhưng lệch hệ thống cần được điều tra.</li>
                    <li><strong>Khoảng cách Cook:</strong> Đo ảnh hưởng của một run lên ước lượng mô hình, không đồng nghĩa với “điểm sai”. <InlineMath math="D_i > 1" /> là cờ sàng lọc mạnh; cần kiểm tra nguyên nhân gốc, không xóa số liệu chỉ vì chỉ số cao.</li>
                  </ul>
                </div>
              </div>
            ),
          },
          {
            id: 'algorithms',
            title: 'OLS, ANOVA & Cách Kết Luận Mô Hình',
            icon: Calculator,
            content: (
              <div style={{ fontSize: '0.78rem', color: '#334155', lineHeight: 1.6 }}>
                <p><strong>1. Các Dạng Phương Trình Hồi Quy:</strong></p>
                <p>• Tuyến tính (Linear):</p>
                <BlockMath math="Y = \beta_0 + \sum_{i=1}^k \beta_i x_i" />
                <p>• Tương tác 2 nhân tố (2FI):</p>
                <BlockMath math="Y = \beta_0 + \sum_{i=1}^k \beta_i x_i + \sum_{i < j} \beta_{ij} x_i x_j" />
                <p>• Đa thức bậc 2 (Quadratic / RSM):</p>
                <BlockMath math="Y = \beta_0 + \sum_{i=1}^k \beta_i x_i + \sum_{i < j} \beta_{ij} x_i x_j + \sum_{i=1}^k \beta_{ii} x_i^2" />

                <p style={{ marginTop: '0.5rem' }}><strong>2. Ước lượng OLS và cách đọc các chỉ số:</strong></p>
                <BlockMath math="\hat{\boldsymbol{\beta}} = (\mathbf{X}^T \mathbf{X})^{-1} \mathbf{X}^T \mathbf{Y}" />
                <ul style={{ paddingLeft: '1.2rem', marginTop: '0.3rem' }}>
                  <li><strong><InlineMath math="R^2" /> và <InlineMath math="R^2_{adj}" />:</strong> tỷ lệ biến thiên được mô hình giải thích trên dữ liệu đã khớp; <InlineMath math="R^2_{adj}" /> phạt việc thêm số hạng. Giá trị cao không tự nó chứng minh dự báo tốt.</li>
                  <li><strong><InlineMath math="Q^2" />:</strong> app tính predicted <InlineMath math="R^2" /> theo leave-one-out/PRESS. Giá trị dương và gần <InlineMath math="R^2_{adj}" /> là tín hiệu tốt hơn; chênh lệch lớn gợi ý quá khớp. Không dùng một ngưỡng cứng thay cho thí nghiệm xác nhận.</li>
                  <li><strong>Lack of Fit (LOF):</strong> so sánh sai số mô hình với <em>pure error</em> từ các run lặp có cùng điều kiện. <InlineMath math="p \ge 0.05" /> nghĩa là chưa có bằng chứng LOF ở mức đã chọn, không phải chứng minh mô hình đúng; LOF không tính được nếu thiếu run lặp hoặc df = 0.</li>
                  <li><strong>VIF:</strong> đo đa cộng tuyến—các biến/số hạng quá tương quan làm hệ số thiếu ổn định. VIF cao là tín hiệu cần đơn giản hóa mô hình hoặc cải thiện thiết kế; ngưỡng 5 chỉ là quy ước tham khảo.</li>
                  <li><strong>Quy tắc kết luận:</strong> báo cáo chiều và độ lớn hiệu ứng, độ không chắc chắn, chẩn đoán phần dư và run xác nhận; không kết luận chỉ từ một p-value.</li>
                </ul>
              </div>
            ),
          },
          {
            id: 'tips',
            title: 'Giải Đáp Tình Huống: Vì Sao Lack of Fit df = 0?',
            icon: Lightbulb,
            content: (
              <div style={{ fontSize: '0.78rem', color: '#334155', lineHeight: 1.6 }}>
                <div style={{ backgroundColor: '#fffbeb', padding: '0.6rem', borderRadius: '0.35rem', border: '1px solid #fde68a', color: '#92400e' }}>
                  <strong>Hiện tượng Mô hình Bão hòa (Saturated Model):</strong>
                  <br />Khi số tham số <InlineMath math="p" /> của mô hình đúng bằng số lần chạy thực nghiệm độc lập <InlineMath math="N" />, bậc tự do phần dư không còn dư cho Lack of Fit (<InlineMath math="df_{\text{LOF}} = 0" />).
                  <br /><strong>Cách xử lý:</strong> Chuyển sang dạng mô hình <em>Tuyến tính (Linear)</em> hoặc <em>Tương tác (2FI)</em>, hoặc bấm nút <em>"+ Thêm run thông tin nhất"</em> ở Tab 3 để bổ sung thêm các điểm chạy thực nghiệm.
                </div>
              </div>
            ),
          },
        ];

      case 'neural':
        return [
          {
            id: 'workflow',
            title: 'Quy Trình & Thứ Tự Các Bước Thực Hiện (Workflow)',
            icon: BrainCircuit,
            content: (
              <div>
                <p style={{ marginBottom: '0.6rem' }}>
                  Nền tảng <strong>Mạng Nơ-ron Nhân Tạo AI (Artificial Neural Network - ANN)</strong> ứng dụng kiến trúc Multi-Layer Perceptron (MLP) chuyên dụng cho dữ liệu thực nghiệm dược phẩm để nắm bắt các phi tuyến tính phức tạp.
                </p>
                <div style={{ backgroundColor: '#faf5ff', padding: '0.6rem 0.8rem', borderRadius: '0.4rem', border: '1px solid #e9d5ff', fontSize: '0.78rem', color: '#6b21a8', lineHeight: 1.6 }}>
                  <strong>Thứ tự thao tác chuẩn:</strong>
                  <br />1. Chọn <strong>Chế độ Huấn luyện</strong> (Độc lập từng CQA hoặc Mạng chung đa đầu ra Shared).
                  <br />2. Điều chỉnh <strong>Số nơ-ron lớp ẩn 1 &amp; 2</strong>, <strong>Hàm kích hoạt</strong> (Tanh/Sigmoid/ReLU) và <strong>Weight Decay (<InlineMath math="\lambda" />)</strong>.
                  <br />3. Kiểm tra tỷ lệ <strong>N/P</strong> (số mẫu huấn luyện/số tham số). App dùng <InlineMath math="N/P \ge 2" /> như cảnh báo sàng lọc, không phải bằng chứng đủ dữ liệu.
                  <br />4. Bấm nút <strong>"Huấn Luyện Lại (Train Network)"</strong> để tiến hành huấn luyện mạng nơ-ron với thanh tiến trình trực quan.
                  <br />5. Đọc <strong>Sơ đồ tôpô</strong>, tầm quan trọng biến theo <strong>độ nhạy nhiễu loạn</strong> và hiệu năng trên tập validation. So sánh với đa thức chỉ có ý nghĩa khi dùng cùng dữ liệu/miền dự đoán.
                  <br />6. Bấm nút <strong>"Tiếp Tục Với Mạng Nơ-ron (Bước 6, 7, 8)"</strong> để khóa mô hình AI làm phương pháp chính.
                </div>
              </div>
            ),
          },
          {
            id: 'inputs',
            title: 'Chi Tiết Từng Nút Bấm & Cấu Hình Siêu Tham Số (Hyperparameters)',
            icon: Sliders,
            content: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', fontSize: '0.78rem' }}>
                <div style={{ backgroundColor: '#f8fafc', padding: '0.6rem', borderRadius: '0.375rem', border: '1px solid #e2e8f0' }}>
                  <strong style={{ color: '#6b21a8' }}>1. Khung Điều Khiển Huấn Luyện &amp; Các Nút Bấm:</strong>
                  <ul style={{ paddingLeft: '1.2rem', marginTop: '0.3rem', color: '#334155', lineHeight: 1.5 }}>
                    <li><strong>Nút "Huấn Luyện Lại (Train Network)":</strong> Bắt đầu quá trình huấn luyện mô hình mạng nơ-ron cho CQA hiện tại.</li>
                    <li><strong>Nút "Huấn Luyện Tất Cả CQAs":</strong> Huấn luyện đồng loạt tất cả các mạng nơ-ron độc lập cho toàn bộ các CQA.</li>
                    <li><strong>Nút "Sao Chép Cấu Hình Sang Tất Cả Y":</strong> Đồng bộ bộ siêu tham số hiện tại sang tất cả các CQA khác.</li>
                    <li><strong>Nút "Khôi Phục Mặc Định (Reset)":</strong> Đặt lại các siêu tham số về giá trị khuyến nghị chuẩn của dược phẩm.</li>
                    <li><strong>Nút "Tiếp Tục Với Mạng Nơ-ron (Bước 6, 7, 8)":</strong> Khóa mô hình Mạng Nơ-ron AI làm engine chính cho các bước tiếp theo.</li>
                  </ul>
                </div>

                <div style={{ backgroundColor: '#f8fafc', padding: '0.6rem', borderRadius: '0.375rem', border: '1px solid #e2e8f0' }}>
                  <strong style={{ color: '#0f766e' }}>2. Cấu Hình Siêu Tham Số (Hyperparameters):</strong>
                  <ul style={{ paddingLeft: '1.2rem', marginTop: '0.3rem', color: '#334155', lineHeight: 1.5 }}>
                    <li><strong>Số nơ-ron Lớp ẩn 1 (<InlineMath math="H_1" />) &amp; Lớp ẩn 2 (<InlineMath math="H_2" />):</strong> Tăng số nơ-ron làm tăng độ linh hoạt nhưng cũng tăng nguy cơ quá khớp. Bắt đầu từ kiến trúc Carpenter do app gợi ý, rồi đánh giá trên validation.</li>
                    <li><strong>Hàm Kích Hoạt (Activation):</strong> Tanh, Sigmoid, ReLU hoặc Linear. Không có hàm nào mặc định “tốt nhất cho dược phẩm”; chọn bằng hiệu năng validation và tính ổn định.</li>
                    <li><strong>Kiểm Định Chéo (Validation Method):</strong> K-Fold (K=5) hoặc Holdout Split (25%).</li>
                    <li><strong>L2 Weight Decay (<InlineMath math="\lambda" />):</strong> Phạt các trọng số quá lớn, giúp đường cong dự báo mượt mà.</li>
                    <li><strong>Số Lượt Huấn Luyện (Number of Tours):</strong> Thử nhiều khởi tạo có seed xác định và giữ nghiệm có loss lựa chọn thấp nhất; không bảo đảm tìm được cực tiểu toàn cục.</li>
                  </ul>
                </div>
              </div>
            ),
          },
          {
            id: 'algorithms',
            title: 'Kiến Trúc ANN, Regularization & Tầm Quan Trọng Biến',
            icon: Calculator,
            content: (
              <div style={{ fontSize: '0.78rem', color: '#334155', lineHeight: 1.6 }}>
                <p><strong>1. Số tham số và cảnh báo cỡ mẫu:</strong></p>
                <BlockMath math="\text{Weights} = (N_{\text{in}} + 1) H_1 + (H_1 + 1) H_2 + (H_2 + 1) N_{\text{out}}" />
                <p>Nếu <InlineMath math="\frac{N_{\text{train}}}{\text{Weights}} < 2.0" />, app cảnh báo nguy cơ quá khớp và gợi ý kiến trúc Carpenter/regularization. Đây là quy tắc thực hành nội bộ; kết luận phải dựa chủ yếu vào kết quả validation và run xác nhận độc lập.</p>

                <p style={{ marginTop: '0.5rem' }}><strong>2. Tầm quan trọng biến theo độ nhạy:</strong></p>
                <p>App lần lượt nhiễu mỗi biến trong miền khảo sát, đo mức thay đổi dự báo trung bình rồi chuẩn hóa để xếp hạng. Đây không phải phương pháp Garson dựa trên trọng số. Tầm quan trọng phản ánh mô hình đã huấn luyện, không chứng minh quan hệ nhân quả và không cho biết chiều tác động.</p>
              </div>
            ),
          },
          {
            id: 'tips',
            title: 'Mẹo Tối Ưu Huấn Luyện Mạng Nơ-ron AI',
            icon: Lightbulb,
            content: (
              <ul style={{ paddingLeft: '1.2rem', fontSize: '0.78rem', color: '#334155', lineHeight: 1.6 }}>
                <li><strong>Cảnh báo Overfitting màu vàng:</strong> Khi <InlineMath math="N/P < 2.0" />, giảm kiến trúc trước; sau đó cân nhắc weight decay và K-fold. Các biện pháp này giảm nguy cơ, không “đảm bảo” mô hình không quá khớp.</li>
                <li><strong>Cách diễn giải:</strong> Ưu tiên Validation R²/RMSE hơn Train R². Nếu Train tốt nhưng Validation kém, không dùng ANN để mở rộng Design Space; bổ sung run hoặc dùng mô hình đơn giản hơn.</li>
                <li><strong>Nút "Huấn Luyện Lại (Train Network)":</strong> Mạng Nơ-ron chỉ cập nhật khi bấm nút này, tránh tốn tài nguyên tính toán khi đang nhập dở dữ liệu.</li>
              </ul>
            ),
          },
        ];

      case 'rsm':
        return [
          {
            id: 'workflow',
            title: 'Quy Trình & Thứ Tự Các Bước Thực Hiện (Workflow)',
            icon: Compass,
            content: (
              <div>
                <p style={{ marginBottom: '0.6rem' }}>
                  Trực quan hóa giá trị <em>mô hình dự báo</em> trong không gian 3D/2D tại lát cắt đang chọn. Dùng đồ thị để nhận biết chiều tác động, tương tác và vùng gần giới hạn; không suy diễn ngoài miền DoE hoặc xem đồ thị là bằng chứng xác nhận.
                </p>
                <div style={{ backgroundColor: '#f0fdf4', padding: '0.6rem 0.8rem', borderRadius: '0.4rem', border: '1px solid #bbf7d0', fontSize: '0.78rem', color: '#166534', lineHeight: 1.6 }}>
                  <strong>Thứ tự thao tác chuẩn:</strong>
                  <br />1. Chọn <strong>Đáp ứng CQA</strong> và <strong>Dạng đồ thị</strong> (3D Surface, 2D Contour, hoặc Tam giác Ternary).
                  <br />2. Chọn 2 biến cho <strong>Trục hoành X</strong> và <strong>Trục tung Y</strong> (hoặc 3 đỉnh tam giác <InlineMath math="A, B, C" />).
                  <br />3. Điều chỉnh các biến phụ ở thanh bên phải: Bấm <strong>"🎯 Đặt theo Điểm Tối Ưu"</strong> hoặc <strong>"🔄 Đặt về Tâm (0)"</strong>.
                  <br />4. Quan sát các đường cắt giới hạn tiêu chuẩn <strong>LSL, USL, Target</strong> trên bề mặt cong.
                  <br />5. Bấm nút <strong>"Tiếp Tục Sang Vùng Thiết Kế"</strong> để chuyển sang Tab 7.
                </div>
              </div>
            ),
          },
          {
            id: 'inputs',
            title: 'Chi Tiết Từng Nút Bấm, Menu Thao Tác & Điều Khiển Đồ Thị',
            icon: Sliders,
            content: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', fontSize: '0.78rem' }}>
                <div style={{ backgroundColor: '#f8fafc', padding: '0.6rem', borderRadius: '0.375rem', border: '1px solid #e2e8f0' }}>
                  <strong style={{ color: '#1e3a8a' }}>1. Khung Điều Khiển Đầu Trang &amp; Dạng Đồ Thị:</strong>
                  <ul style={{ paddingLeft: '1.2rem', marginTop: '0.3rem', color: '#334155', lineHeight: 1.5 }}>
                    <li><strong>Nút "Bề Mặt 3D (3D Surface)":</strong> Đồ thị 3 chiều có thể xoay chuột, zoom, chiếu đường đồng mức xuống đáy.</li>
                    <li><strong>Nút "Đường Đồng Mức 2D (2D Contour)":</strong> Bản đồ đường đồng mức trên hệ tọa độ Descartes (X–Y) với con trỏ rà soát giá trị (Hover Probe).</li>
                    <li><strong>Nút "Tam Giác Hỗn Hợp (Ternary Contour)":</strong> Đồ thị tọa độ tam giác đều Barycentric chuyên biệt cho 3 thành phần hỗn hợp (<InlineMath math="X_A + X_B + X_C = 100\%" />).</li>
                    <li><strong>Nút "Tiếp Tục Sang Vùng Thiết Kế":</strong> Chuyển sang Tab 7 (Design Space).</li>
                  </ul>
                </div>

                <div style={{ backgroundColor: '#f8fafc', padding: '0.6rem', borderRadius: '0.375rem', border: '1px solid #e2e8f0' }}>
                  <strong style={{ color: '#0f766e' }}>2. Bảng Cố Định Biến Phụ (Fixed Factors Slicing Panel):</strong>
                  <ul style={{ paddingLeft: '1.2rem', marginTop: '0.3rem', color: '#334155', lineHeight: 1.5 }}>
                    <li><strong>Nút "🎯 Đặt theo Điểm Tối Ưu":</strong> Tự động gán tất cả các biến phụ về giá trị tối ưu Desirability.</li>
                    <li><strong>Nút "🔄 Đặt về Tâm (0)":</strong> Đặt lại tất cả các biến phụ về điểm tâm thực nghiệm.</li>
                    <li><strong>Thanh trượt &amp; Ô nhập số:</strong> Cho phép tùy biến giá trị cố định của từng biến phụ theo ý muốn.</li>
                  </ul>
                </div>
              </div>
            ),
          },
          {
            id: 'algorithms',
            title: 'Thuật Toán Cắt Lớp Đường Giới Hạn & Tam Giác Barycentric',
            icon: Calculator,
            content: (
              <div style={{ fontSize: '0.78rem', color: '#334155', lineHeight: 1.6 }}>
                <p><strong>1. Phép Biến Đổi Tọa Độ Tam Giác Barycentric:</strong></p>
                <BlockMath math="X_{\text{cartesian}} = X_B + 0.5 X_C, \quad Y_{\text{cartesian}} = \frac{\sqrt{3}}{2} X_C" />
                <p>Với ràng buộc bảo toàn nồng độ hỗn hợp: <InlineMath math="X_A + X_B + X_C = 1.0 \quad (100\%)" />.</p>
                <p style={{ marginTop: '0.4rem' }}><strong>2. Đường cắt LSL/USL/Target:</strong> Đường đồng mức được nội suy trên lưới dự báo để biểu diễn nơi CQA bằng một ngưỡng. Độ chính xác của đường phụ thuộc mô hình, độ phân giải lưới và các biến đang bị cố định.</p>
              </div>
            ),
          },
          {
            id: 'tips',
            title: 'Mẹo Quan Sát Bề Mặt Đáp Ứng RSM',
            icon: Lightbulb,
            content: (
              <ul style={{ paddingLeft: '1.2rem', fontSize: '0.78rem', color: '#334155', lineHeight: 1.6 }}>
                <li><strong>Đổi trục tọa độ X và Y:</strong> Hãy thử đổi vị trí giữa các biến để quan sát góc nhìn trực quan và dễ hiểu nhất của các điểm cực trị.</li>
                <li><strong>Đường LSL/USL:</strong> Cho biết biên đạt/không đạt <em>theo mô hình</em> trên lát cắt. Thay đổi biến cố định rồi kiểm tra lại, đặc biệt khi có tương tác giữa các factor.</li>
              </ul>
            ),
          },
        ];

      case 'design_space':
        return [
          {
            id: 'workflow',
            title: 'Quy Trình & Thứ Tự Các Bước Thực Hiện (Workflow)',
            icon: Boxes,
            content: (
              <div>
                <p style={{ marginBottom: '0.6rem' }}>
                  Khảo sát <strong>vùng chấp nhận dự báo</strong> từ mô hình, tối ưu hóa thỏa dụng (<strong>Desirability Profiler</strong>) và ước lượng rủi ro bằng Monte Carlo. Kết quả trong app là bằng chứng mô hình hóa/sàng lọc; Design Space hoặc PAR chính thức cần xác nhận đa biến, run xác nhận và phê duyệt theo hệ thống chất lượng.
                </p>
                <div style={{ backgroundColor: '#f0fdf4', padding: '0.6rem 0.8rem', borderRadius: '0.4rem', border: '1px solid #bbf7d0', fontSize: '0.78rem', color: '#166534', lineHeight: 1.6 }}>
                  <strong>Thứ tự thao tác chuẩn:</strong>
                  <br />1. Trong thanh công cụ <strong>Prediction Profiler</strong>: Bấm nút <strong>"✨ Tối Đa Hóa Thỏa Dụng (Max D)"</strong> để tự động tìm điểm cài đặt tối ưu toàn cục.
                  <br />2. (Tùy chọn) Bấm <strong>"💾 Lưu Kịch Bản (n)"</strong> để lưu lại các kịch bản cài đặt ứng viên cần so sánh, hoặc <strong>"🔄 Về Tâm (0)"</strong> để đặt lại điểm tâm, hoặc <strong>"⚙️ Mục Tiêu &amp; Trọng Số ∨"</strong> để sửa nhanh LSL/Target/USL/Trọng số.
                  <br />3. Xem bản đồ overlay: vùng xanh lá là các điểm <em>dự báo</em> đạt toàn bộ giới hạn CQA trên lát cắt đang chọn. Màu sắc không bao gồm toàn bộ bất định mô hình hay biến thiên sản xuất.
                  <br />4. Nhập <em>Số lô mô phỏng</em> (vd: 10.000) và <em>Độ biến thiên RSD%</em> (vd: &plusmn;2.0%) &rarr; Bấm <strong>"▶ Chạy Mô Phỏng Monte Carlo"</strong> để thẩm định độ bền vững.
                  <br />5. Đọc Reliability, PPM và Cpk như các ước lượng theo giả định mô phỏng. So sánh với tiêu chí chấp nhận của sản phẩm; app cảnh báo dưới Cpk 1.33 nhưng không đặt một tiêu chuẩn pháp lý/phổ quát.
                  <br />6. Bấm nút <strong>"Tiếp Tục Sang Báo Cáo Hồ Sơ"</strong> để chuyển sang Tab 8.
                </div>
              </div>
            ),
          },
          {
            id: 'inputs',
            title: 'Chi Tiết Từng Nút Bấm Khớp 100% Giao Diện Prediction Profiler & Monte Carlo',
            icon: Sliders,
            content: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', fontSize: '0.78rem' }}>
                <div style={{ backgroundColor: '#f8fafc', padding: '0.6rem', borderRadius: '0.375rem', border: '1px solid #e2e8f0' }}>
                  <strong style={{ color: '#1e3a8a' }}>1. Khung "Prediction Profiler &amp; Desirability Optimization" (Thanh màu xanh đậm):</strong>
                  <ul style={{ paddingLeft: '1.2rem', marginTop: '0.3rem', color: '#334155', lineHeight: 1.5 }}>
                    <li><strong>Đồng hồ OVERALL D:</strong> Trung bình nhân có trọng số của các desirability, từ 0 đến 1. D = 0 nếu một CQA có desirability bằng 0. Các mốc 0.5/0.8 chỉ dùng để trao đổi nội bộ, không phải tiêu chuẩn chất lượng.</li>
                    <li><strong>Nút "✨ Tối Đa Hóa Thỏa Dụng (Max D)":</strong> App quét lưới khả thi rồi tinh chỉnh bằng nhiều điểm khởi đầu ngẫu nhiên tái lập được; vẫn nên so sánh vài kịch bản và kiểm tra khả thi thực tế trước khi chọn setpoint.</li>
                    <li><strong>Nút "💾 Lưu Kịch Bản (n)":</strong> Lưu lại điểm cài đặt hiện tại vào danh sách kịch bản để dễ dàng đối chiếu và khôi phục.</li>
                    <li><strong>Nút "🔄 Về Tâm (0)":</strong> Đặt lại tất cả các yếu tố về mức tâm thực nghiệm.</li>
                    <li><strong>Nút "⚙️ Mục Tiêu &amp; Trọng Số ∨":</strong> Mở bảng accordion để chỉnh sửa nhanh mục tiêu (Target, Max, Min), giới hạn LSL–USL, hàm hình dạng lũy thừa (<InlineMath math="s, t" />) và trọng số (<InlineMath math="w_i" />).</li>
                    <li><strong>Nút "🔒 Khóa / 🔓 Mở khóa" (Trên từng cột Factor):</strong> Khóa cố định một biến không cho thay đổi trong quá trình tối ưu hóa.</li>
                  </ul>
                </div>

                <div style={{ backgroundColor: '#f8fafc', padding: '0.6rem', borderRadius: '0.375rem', border: '1px solid #e2e8f0' }}>
                  <strong style={{ color: '#0f766e' }}>2. Khung "Đồ Thị Vùng Thiết Kế (Design Space Overlay / Sweet Spot)":</strong>
                  <ul style={{ paddingLeft: '1.2rem', marginTop: '0.3rem', color: '#334155', lineHeight: 1.5 }}>
                    <li>🟩 <strong>Vùng Xanh Lá:</strong> trên lưới và lát cắt hiện tại, mọi CQA được <em>mô hình dự báo</em> nằm trong giới hạn (<InlineMath math="\text{Margin}_i \ge 0 \quad \forall i" />).</li>
                    <li>🟥 <strong>Vùng Đỏ:</strong> ít nhất một CQA được dự báo vượt giới hạn. Hãy rà soát biến cố định, miền ngoại suy và bất định trước khi ra quyết định.</li>
                    <li>★ <strong>Ngôi sao Xanh:</strong> Điểm vận hành mục tiêu tối ưu (Target Setpoint).</li>
                    <li><strong>Các nút tùy chỉnh:</strong> Dropdown chọn 2 trục khảo sát, thanh trượt cắt lớp các biến phụ, Độ phân giải lưới (Resolution), Độ mượt (Smoothness), và Checkbox *Hiển thị đường biên giới hạn*.</li>
                  </ul>
                </div>

                <div style={{ backgroundColor: '#f8fafc', padding: '0.6rem', borderRadius: '0.375rem', border: '1px solid #e2e8f0' }}>
                  <strong style={{ color: '#b45309' }}>3. Khung "Mô Phỏng Độ Bền Vững Monte Carlo (ICH Q9 / Q10)":</strong>
                  <ul style={{ paddingLeft: '1.2rem', marginTop: '0.3rem', color: '#334155', lineHeight: 1.5 }}>
                    <li><strong>Ô "Số lô mô phỏng ảo":</strong> Nhập số lượng lô ảo cần thử nghiệm (vd: 10.000 lô).</li>
                    <li><strong>Ô "Độ biến thiên thiết bị/môi trường (RSD %)":</strong> Mức dao động dự kiến quanh điểm cài đặt (vd: &plusmn;2.0%).</li>
                    <li><strong>Nút "▶ Chạy Mô Phỏng Monte Carlo":</strong> Lấy mẫu Gaussian cho biến liên tục; mẫu vượt miền khảo sát được ghi nhận là excursion và tính là thất bại. Biến rời rạc giữ đúng mức khai báo; thành phần hỗn hợp ngoài simplex khả thi cũng được ghi nhận trước khi chiếu để dự báo. Nhiễu phần dư CQA được mô phỏng có tương quan khi dữ liệu cho phép.</li>
                    <li><strong>Kết quả thu được:</strong> Reliability là tỷ lệ lô ảo đồng thời đạt tất cả CQA; PPM là số lô ảo không đạt trên một triệu; Cpk được tính riêng cho từng CQA từ phân bố mô phỏng. Đây là ước lượng có điều kiện theo RSD, mô hình và seed đã chọn.</li>
                    <li><strong>Nút "Tiếp Tục Sang Báo Cáo Hồ Sơ":</strong> Chuyển sang Tab 8.</li>
                  </ul>
                </div>
              </div>
            ),
          },
          {
            id: 'algorithms',
            title: 'Thuật Toán Derringer & Suich, Margin Đa Biến & Monte Carlo',
            icon: Calculator,
            content: (
              <div style={{ fontSize: '0.78rem', color: '#334155', lineHeight: 1.6 }}>
                <p><strong>1. Hàm Thỏa Dụng Tổng Thể Derringer &amp; Suich:</strong></p>
                <BlockMath math="D = \left[ \prod_{i=1}^m (d_i)^{w_i} \right]^{\frac{1}{\sum_{i=1}^m w_i}} \in [0, 1]" />
                <p>Nếu bất kỳ CQA nào có <InlineMath math="d_i = 0" /> (ngoài tiêu chuẩn) &rarr; <InlineMath math="D = 0" />.</p>

                <p style={{ marginTop: '0.5rem' }}><strong>2. Dải vận hành hiển thị trong app:</strong></p>
                <BlockMath math="\text{NOR} \subseteq \text{PAR} \subseteq \text{Knowledge Space}" />
                <ul style={{ paddingLeft: '1.2rem', marginTop: '0.3rem' }}>
                  <li><strong>Knowledge Space:</strong> Toàn bộ dải thông số đã được khảo sát <InlineMath math="[\text{Low}, \text{High}]" />.</li>
                  <li><strong>Proven Acceptable Range (PAR):</strong> về nguyên tắc là dải được chứng minh chấp nhận được. App hiện tạo <em>provisional screening range</em> bằng quét từng biến tại setpoint, do đó không phải PAR đa biến đã xác nhận.</li>
                  <li><strong>Normal Operating Range (NOR):</strong> dải vận hành thường quy hẹp hơn quanh setpoint. Dải này phải được chủ sở hữu quy trình thiết lập/phê duyệt; không nên suy ra chỉ từ một tối ưu mô hình.</li>
                </ul>

                <p style={{ marginTop: '0.5rem' }}><strong>3. Phân phối Ngẫu nhiên Monte Carlo &amp; Năng Lực Quy Trình:</strong></p>
                <BlockMath math="X_j \sim \mathcal{N}(\mu_{\text{setpoint}}, \, \sigma_j^2), \quad \sigma_j = \max\left(|\mu_j|, \frac{U_j-L_j}{2}\right) \times \text{RSD}\%" />
                <BlockMath math="C_{pk} = \min\left( \frac{\text{USL} - \mu}{3\sigma}, \, \frac{\mu - \text{LSL}}{3\sigma} \right)" />
              </div>
            ),
          },
          {
            id: 'tips',
            title: 'Mẹo Thiết Lập Điểm Vận Hành & Khắc Phục Sai Hỏng PPM',
            icon: Lightbulb,
            content: (
              <ul style={{ paddingLeft: '1.2rem', fontSize: '0.78rem', color: '#334155', lineHeight: 1.6 }}>
                <li><strong>Nếu tỷ lệ sai hỏng PPM còn cao:</strong> Xem CQA nào chi phối lỗi, độ nhạy với factor nào và giả định RSD. Có thể đặt setpoint xa biên hơn, giảm biến thiên hoặc thu hẹp dải vận hành—sau đó xác nhận bằng run thực nghiệm.</li>
                <li><strong>Chỉ số <InlineMath math="C_{pk}" />:</strong> đo khoảng cách trung bình tới giới hạn gần nhất theo đơn vị 3 độ lệch chuẩn của <em>phân bố mô phỏng</em>. Cpk ≥1.33 là quy ước năng lực thường dùng, không đồng nghĩa mặc định với “6 sigma” hay phê duyệt quy trình.</li>
              </ul>
            ),
          },
        ];

      case 'report':
        return [
          {
            id: 'workflow',
            title: 'Quy Trình & Thứ Tự Các Bước Thực Hiện (Workflow)',
            icon: FileCheck2,
            content: (
              <div>
                <p style={{ marginBottom: '0.6rem' }}>
                  Tổng hợp dữ liệu QTPP, FMEA, DoE, mô hình, tối ưu hóa và chiến lược kiểm soát thành <strong>bản thảo báo cáo phát triển</strong> có cấu trúc tham khảo CTD 3.2.P.2 và xuất Word. Nội dung cần được tác giả khoa học/QA rà soát, bổ sung tài liệu nguồn và phê duyệt trước khi dùng trong hồ sơ nộp cơ quan quản lý.
                </p>
                <div style={{ backgroundColor: '#f0fdf4', padding: '0.6rem 0.8rem', borderRadius: '0.4rem', border: '1px solid #bbf7d0', fontSize: '0.78rem', color: '#166534', lineHeight: 1.6 }}>
                  <strong>Thứ tự thao tác chuẩn:</strong>
                  <br />1. Kiểm tra thông báo tại <strong>Cổng Kiểm Tra Toàn Vẹn Khoa Học (Scientific Readiness Gate)</strong>.
                  <br />2. Chọn phương pháp mô hình hóa chính: Nút <strong>"Đa Thức (ANOVA)"</strong> hoặc <strong>"Mạng Nơ-ron AI"</strong>.
                  <br />3. Rà soát trực tiếp 10 chương mục tài liệu hiển thị trên màn hình.
                  <br />4. Bấm nút <strong>"In / Xuất PDF"</strong> để in trực tiếp, hoặc <strong>"Tải Bản Thảo Word (.docx)"</strong> để tạo tài liệu cho vòng rà soát khoa học/QA.
                  <br />5. Xem lịch sử phiên bản và audit trail trong bảng <strong>Project Governance</strong>.
                </div>
              </div>
            ),
          },
          {
            id: 'inputs',
            title: 'Chi Tiết Từng Nút Bấm & 10 Chương Mục Báo Cáo CTD 3.2.P.2',
            icon: Sliders,
            content: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', fontSize: '0.78rem' }}>
                <div style={{ backgroundColor: '#f8fafc', padding: '0.6rem', borderRadius: '0.375rem', border: '1px solid #e2e8f0' }}>
                  <strong style={{ color: '#1e3a8a' }}>1. Khung Thao Tác Đầu Trang:</strong>
                  <ul style={{ paddingLeft: '1.2rem', marginTop: '0.3rem', color: '#334155', lineHeight: 1.5 }}>
                    <li><strong>Nút "Đa Thức (ANOVA)":</strong> Chọn đưa kết quả phân tích ANOVA cổ điển vào báo cáo.</li>
                    <li><strong>Nút "Mạng Nơ-ron AI":</strong> Chọn đưa kết quả phân tích học sâu AI vào báo cáo.</li>
                    <li><strong>Nút "In / Xuất PDF":</strong> Mở hộp thoại in ấn của trình duyệt hoặc xuất sang file PDF.</li>
                    <li><strong>Nút "Tải Bản Thảo Word (.docx)":</strong> Xuất tài liệu làm việc có bảng biểu, công thức và dữ liệu để tiếp tục rà soát.</li>
                  </ul>
                </div>

                <div style={{ backgroundColor: '#f8fafc', padding: '0.6rem', borderRadius: '0.375rem', border: '1px solid #e2e8f0' }}>
                  <strong style={{ color: '#0f766e' }}>2. 10 Chương Mục Chuẩn Trong Hồ Sơ CTD Module 3.2.P.2:</strong>
                  <ol style={{ paddingLeft: '1.2rem', marginTop: '0.3rem', color: '#334155', lineHeight: 1.5 }}>
                    <li>Thông tin hành chính dự án &amp; Traceability sau chạy.</li>
                    <li>Hồ sơ chất lượng mục tiêu (QTPP - ICH Q8).</li>
                    <li>Thuộc tính chất lượng trọng yếu &amp; Cấu hình thỏa dụng (CQAs).</li>
                    <li>Đánh giá quản lý rủi ro ban đầu (FMEA - ICH Q9).</li>
                    <li>Thiết kế thí nghiệm &amp; Đánh giá hiệu suất ma trận (DoE &amp; D-Efficiency).</li>
                    <li>Mô hình hồi quy toán học &amp; Bảng ANOVA đầy đủ / Mạng Nơ-ron AI.</li>
                    <li>Đánh giá rủi ro cập nhật sau DoE (Updated Risk Assessment - chuẩn US FDA).</li>
                    <li>Chiến lược kiểm soát toàn diện (Comprehensive Control Strategy - ICH Q10) với phân loại CMA, CPP, IPC, Release Specs, dải NOR, dải PAR.</li>
                    <li>Ước lượng độ tin cậy bằng mô phỏng Monte Carlo với số lô, RSD và seed đã chọn; diễn giải cùng giả định mô hình, không thay thế xác nhận lô thực.</li>
                    <li>Khung ký duyệt và phê chuẩn hồ sơ (R&amp;D Lead, QA Director).</li>
                  </ol>
                </div>
              </div>
            ),
          },
          {
            id: 'algorithms',
            title: 'Cơ Chế Kiểm Tra Toàn Vẹn Khoa Học (Scientific Readiness Gate)',
            icon: Calculator,
            content: (
              <div style={{ fontSize: '0.78rem', color: '#334155', lineHeight: 1.6 }}>
                <p>Nút <strong>"Tải Báo Cáo Word (.docx)"</strong> được kiểm tra bằng các điều kiện dữ liệu/mô hình trong app. Đây là <em>readiness check</em> kỹ thuật, không phải phê duyệt khoa học, QA hay quy định. Báo cáo chỉ được phép xuất khi:</p>
                <ul style={{ paddingLeft: '1.2rem', marginTop: '0.3rem' }}>
                  <li>✓ Đã có đầy đủ số liệu thực nghiệm DoE hợp lệ cho tất cả các CQAs.</li>
                  <li>✓ Có mô hình cho các CQA và không có lỗi kỹ thuật mà app phát hiện (ví dụ mô hình OLS thiếu bậc tự do hoặc validation không hợp lệ).</li>
                  <li>✓ Đã tối ưu hóa và xác định điểm vận hành Desirability khả thi.</li>
                  <li>✓ Đã hoàn thành mô phỏng Monte Carlo dùng chung với báo cáo.</li>
                </ul>
              </div>
            ),
          },
          {
            id: 'tips',
            title: 'Quản Trị Dự Án & Nhật Ký Phiên Bản (Project Governance)',
            icon: Lightbulb,
            content: (
              <ul style={{ paddingLeft: '1.2rem', fontSize: '0.78rem', color: '#334155', lineHeight: 1.6 }}>
                <li><strong>Lưu trữ JSON &amp; Autosave:</strong> Dự án tự động lưu trên trình duyệt và cho phép tải file JSON về máy tính bất kỳ lúc nào qua nút <em>Lưu</em> trên thanh Navbar. Lưu JSON cùng dữ liệu thô, phiên bản code và căn cứ khoa học để bảo đảm truy xuất nguồn gốc.</li>
                <li><strong>Khôi phục Snapshot:</strong> Cho phép quay ngược lại các mốc lịch sử chỉnh sửa trước đó nếu cần so sánh các kịch bản tối ưu hóa khác nhau.</li>
              </ul>
            ),
          },
        ];

      default:
        return [];
    }
  };

  const sections = useMemo(() => getHelpContent(viewingTab), [viewingTab]);

  const filteredSections = useMemo(() => {
    if (!searchQuery.trim()) return sections;
    const q = searchQuery.toLowerCase();
    return sections.filter((sec) => {
      const titleMatch = sec.title.toLowerCase().includes(q);
      return titleMatch || sec.id.toLowerCase().includes(q);
    });
  }, [sections, searchQuery]);

  return (
    <>
      {/* Backdrop overlay (Only active when NOT pinned in floating mode) */}
      {!effectivePinned && (
        <div
          onClick={onClose}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.45)',
            backdropFilter: 'blur(2px)',
            zIndex: 100,
            opacity: isOpen ? 1 : 0,
            pointerEvents: isOpen ? 'auto' : 'none',
            transition: 'opacity 0.25s ease-in-out',
          }}
          aria-hidden="true"
        />
      )}

      {/* Right Drawer / Companion Side Panel */}
      <aside
        ref={drawerRef}
        role="dialog"
        aria-modal={!effectivePinned}
        aria-hidden={!isOpen}
        aria-label="Thanh trợ giúp theo ngữ cảnh"
        tabIndex={-1}
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          height: '100vh',
          maxHeight: '100vh',
          width: effectivePinned ? '500px' : '560px',
          maxWidth: effectivePinned ? '50vw' : '94vw',
          backgroundColor: '#ffffff',
          boxShadow: effectivePinned ? '-2px 0 12px rgba(0, 0, 0, 0.08)' : '-6px 0 28px rgba(0, 0, 0, 0.18)',
          zIndex: effectivePinned ? 40 : 101,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.28s cubic-bezier(0.16, 1, 0.3, 1), width 0.2s ease',
          borderLeft: '1px solid #cbd5e1',
        }}
      >
        {/* Drawer Header (Fixed) */}
        <div
          style={{
            padding: '0.85rem 1.15rem',
            backgroundColor: '#1e3a8a',
            color: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid #1e40af',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                backgroundColor: 'rgba(255, 255, 255, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <BookOpen size={18} color="#ffffff" />
            </div>
            <div>
              <div style={{ fontSize: '0.94rem', fontWeight: '700', letterSpacing: '-0.01em', lineHeight: 1.2 }}>
                Trợ Giúp Theo Ngữ Cảnh
              </div>
              <div style={{ fontSize: '0.7rem', color: '#93c5fd', marginTop: '0.1rem' }}>
                Hướng dẫn thao tác, nút bấm &amp; thuật toán tham chiếu ICH
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            {/* Toggle Pin / Side-by-Side Mode */}
            {onTogglePin && !isCompactViewport && (
              <button
                type="button"
                onClick={onTogglePin}
                style={{
                  background: isPinned ? 'rgba(255, 255, 255, 0.25)' : 'rgba(255, 255, 255, 0.1)',
                  border: isPinned ? '1px solid rgba(255, 255, 255, 0.4)' : '1px solid rgba(255, 255, 255, 0.2)',
                  color: '#ffffff',
                  cursor: 'pointer',
                  padding: '0.28rem 0.5rem',
                  borderRadius: '5px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.25rem',
                  fontSize: '0.68rem',
                  fontWeight: '600',
                  transition: 'all 0.15s',
                }}
                title={isPinned ? "Đang ở chế độ Ghim (chia đôi màn hình để vừa thao tác vừa tra cứu). Nhấn để chuyển sang cửa sổ nổi." : "Ghim thanh bên (Tự động co nhỏ nội dung App sang trái để vừa làm vừa xem không bị che)."}
              >
                {isPinned ? <PinOff size={13} /> : <Pin size={13} />}
                <span>{isPinned ? 'Bỏ Ghim' : 'Ghim'}</span>
              </button>
            )}

            <button
              onClick={onClose}
              aria-label="Đóng trợ giúp"
              style={{
                background: 'none',
                border: 'none',
                color: '#ffffff',
                cursor: 'pointer',
                padding: '0.35rem',
                borderRadius: '6px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.15)')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Live Context Banner (Fixed) */}
        <div
          style={{
            backgroundColor: '#eff6ff',
            borderBottom: '1px solid #bfdbfe',
            padding: '0.55rem 1.25rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '0.76rem',
            color: '#1e40af',
            flexWrap: 'wrap',
            gap: '0.4rem',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <Activity size={14} color="#2563eb" />
            <span>
              Đang làm: <strong>{tabsList.find((t) => t.key === activeTab)?.label}</strong>
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            {selectedCQA && (
              <span className="badge badge-teal" style={{ fontSize: '0.68rem', padding: '0.1rem 0.4rem' }}>
                CQA: {selectedCQA} ({currentCQAObj?.name})
              </span>
            )}
            <span
              className={`badge ${modelingEngine === 'neural' ? 'badge-primary' : 'badge-teal'}`}
              style={{ fontSize: '0.68rem', padding: '0.1rem 0.4rem' }}
            >
              {modelingEngine === 'neural' ? '🧠 Mạng Nơ-ron AI' : '📐 Đa Thức ANOVA'}
            </span>
          </div>
        </div>

        {/* Tab Quick Selector Pills (Fixed) */}
        <div
          style={{
            padding: '0.45rem 1.25rem',
            backgroundColor: '#f8fafc',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            gap: '0.3rem',
            overflowX: 'auto',
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          {tabsList.map((t) => {
            const Icon = t.icon;
            const isSelected = viewingTab === t.key;
            const isCurrentActive = activeTab === t.key;

            return (
              <button
                key={t.key}
                onClick={() => setViewingTab(t.key)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.25rem',
                  padding: '0.28rem 0.55rem',
                  fontSize: '0.72rem',
                  fontWeight: isSelected ? '700' : '600',
                  borderRadius: '6px',
                  border: isSelected ? '1px solid #1e3a8a' : '1px solid #cbd5e1',
                  backgroundColor: isSelected ? '#1e3a8a' : isCurrentActive ? '#dbeafe' : '#ffffff',
                  color: isSelected ? '#ffffff' : isCurrentActive ? '#1e40af' : '#475569',
                  cursor: 'pointer',
                  flexShrink: 0,
                  transition: 'all 0.15s ease',
                }}
                title={`${t.label} (${t.standard})`}
              >
                <Icon size={12} />
                <span>{t.short}</span>
                {isCurrentActive && !isSelected && (
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#2563eb', display: 'inline-block' }} />
                )}
              </button>
            );
          })}
        </div>

        {/* Search & Bulk Expand Controls (Fixed) */}
        <div
          style={{
            padding: '0.55rem 1.25rem',
            borderBottom: '1px solid #e2e8f0',
            backgroundColor: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            gap: '0.6rem',
            flexShrink: 0,
          }}
        >
          <div style={{ position: 'relative', flex: 1, display: 'flex', alignItems: 'center' }}>
            <Search size={15} color="#94a3b8" style={{ position: 'absolute', left: '0.65rem' }} />
            <input
              type="text"
              aria-label="Tìm kiếm nội dung trợ giúp"
              className="input-field"
              style={{
                width: '100%',
                paddingLeft: '2rem',
                fontSize: '0.78rem',
                paddingTop: '0.32rem',
                paddingBottom: '0.32rem',
                borderRadius: '6px',
              }}
              placeholder={`Tìm trong ${tabsList.find((t) => t.key === viewingTab)?.label}... (vd: Max D, D-Efficiency, RPN)`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                style={{
                  position: 'absolute',
                  right: '0.5rem',
                  background: 'none',
                  border: 'none',
                  color: '#94a3b8',
                  cursor: 'pointer',
                  fontSize: '0.75rem',
                  padding: '2px',
                }}
              >
                ✕
              </button>
            )}
          </div>

          <div style={{ display: 'flex', gap: '0.25rem' }}>
            <button
              onClick={expandAll}
              className="btn btn-secondary"
              style={{ fontSize: '0.7rem', padding: '0.3rem 0.45rem', gap: '0.2rem' }}
              title="Mở tất cả các mục"
            >
              <ChevronsUpDown size={12} />
              <span>Mở hết</span>
            </button>
            <button
              onClick={collapseAll}
              className="btn btn-secondary"
              style={{ fontSize: '0.7rem', padding: '0.3rem 0.45rem', gap: '0.2rem' }}
              title="Thu gọn tất cả các mục"
            >
              <ChevronsDownUp size={12} />
              <span>Thu gọn</span>
            </button>
          </div>
        </div>

        {/* Main Content Scrollable Area */}
        <div
          className="help-scroll-container"
          style={{
            flex: '1 1 0%',
            minHeight: 0,
            overflowY: 'auto',
            overflowX: 'hidden',
            padding: '1rem 1.25rem 2.5rem 1.25rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.85rem',
          }}
        >
          {/* Active Help Tab Header Card */}
          <div
            style={{
              padding: '0.75rem 1rem',
              backgroundColor: '#f1f5f9',
              borderRadius: '0.5rem',
              border: '1px solid #cbd5e1',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexShrink: 0,
            }}
          >
            <div>
              <div style={{ fontSize: '0.92rem', fontWeight: '800', color: '#0f172a' }}>
                {tabsList.find((t) => t.key === viewingTab)?.label}
              </div>
              <div style={{ fontSize: '0.74rem', color: '#0f766e', fontWeight: '600', marginTop: '0.1rem' }}>
                Tiêu chuẩn đối chiếu: {tabsList.find((t) => t.key === viewingTab)?.standard}
              </div>
            </div>

            {viewingTab !== activeTab && onNavigateToTab && (
              <button
                onClick={() => {
                  onNavigateToTab(viewingTab);
                }}
                className="btn btn-teal"
                style={{ fontSize: '0.72rem', padding: '0.3rem 0.6rem', gap: '0.25rem' }}
                title="Chuyển màn hình làm việc đến bước này"
              >
                <span>Mở Bước Này</span>
                <ArrowRight size={12} />
              </button>
            )}
          </div>

          {/* Render Sections Accordions */}
          {filteredSections.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8', fontSize: '0.82rem' }}>
              Không tìm thấy mục trợ giúp phù hợp với từ khóa "<strong>{searchQuery}</strong>".
            </div>
          ) : (
            filteredSections.map((section) => {
              const Icon = section.icon;
              const isExpanded = expandedSections[section.id] !== undefined ? expandedSections[section.id] : true;

              return (
                <div
                  key={section.id}
                  style={{
                    border: '1px solid #e2e8f0',
                    borderRadius: '0.5rem',
                    backgroundColor: '#ffffff',
                    overflow: 'hidden',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
                    flexShrink: 0,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => toggleSection(section.id)}
                    aria-expanded={isExpanded}
                    style={{
                      width: '100%',
                      padding: '0.65rem 0.85rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      backgroundColor: isExpanded ? '#f8fafc' : '#ffffff',
                      border: 'none',
                      borderBottom: isExpanded ? '1px solid #e2e8f0' : 'none',
                      cursor: 'pointer',
                      textAlign: 'left',
                      transition: 'background 0.15s',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                      <Icon size={16} color="#1e3a8a" />
                      <span style={{ fontSize: '0.82rem', fontWeight: '700', color: '#0f172a' }}>
                        {section.title}
                      </span>
                    </div>
                    {isExpanded ? <ChevronDown size={16} color="#64748b" /> : <ChevronRight size={16} color="#64748b" />}
                  </button>

                  {isExpanded && (
                    <div style={{ padding: '0.85rem', fontSize: '0.8rem', color: '#334155' }}>
                      {section.content}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Drawer Footer (Fixed) */}
        <div
          style={{
            padding: '0.7rem 1.25rem',
            backgroundColor: '#f8fafc',
            borderTop: '1px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '0.74rem',
            color: '#64748b',
            flexShrink: 0,
          }}
        >
          <div>
            <strong>QbD Studio™ Help Engine</strong> • ICH Guidelines
          </div>
          <button
            onClick={onClose}
            className="btn btn-secondary"
            style={{ fontSize: '0.75rem', padding: '0.25rem 0.65rem' }}
          >
            Đóng Trợ Giúp
          </button>
        </div>
      </aside>
    </>
  );
};
