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
  keywords?: string[];
}

interface GlossaryTermItem {
  term: string;
  vietnamese: string;
  tag: string;
  tagColor?: 'teal' | 'primary' | 'warning' | 'danger' | 'purple' | 'slate';
  definition: React.ReactNode;
}

const GlossaryTermCard: React.FC<GlossaryTermItem> = ({
  term,
  vietnamese,
  tag,
  tagColor = 'teal',
  definition,
}) => {
  const getTagStyle = () => {
    switch (tagColor) {
      case 'primary':
        return { backgroundColor: '#dbeafe', color: '#1e40af', border: '1px solid #bfdbfe' };
      case 'warning':
        return { backgroundColor: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' };
      case 'danger':
        return { backgroundColor: '#fee2e2', color: '#991b1b', border: '1px solid #fecaca' };
      case 'purple':
        return { backgroundColor: '#f3e8ff', color: '#6b21a8', border: '1px solid #e9d5ff' };
      case 'slate':
        return { backgroundColor: '#f1f5f9', color: '#334155', border: '1px solid #cbd5e1' };
      case 'teal':
      default:
        return { backgroundColor: '#ccfbf1', color: '#0f766e', border: '1px solid #99f6e4' };
    }
  };

  return (
    <div
      style={{
        backgroundColor: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: '0.4rem',
        padding: '0.65rem 0.8rem',
        boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.35rem', flexWrap: 'wrap', gap: '0.3rem' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', flexWrap: 'wrap' }}>
          <strong style={{ color: '#0f172a', fontSize: '0.82rem' }}>{term}</strong>
          {vietnamese && (
            <span style={{ color: '#64748b', fontSize: '0.74rem', fontStyle: 'italic' }}>
              ({vietnamese})
            </span>
          )}
        </div>
        <span
          style={{
            fontSize: '0.66rem',
            fontWeight: '600',
            padding: '0.1rem 0.45rem',
            borderRadius: '9999px',
            ...getTagStyle(),
          }}
        >
          {tag}
        </span>
      </div>
      <div style={{ color: '#334155', fontSize: '0.78rem', lineHeight: 1.55 }}>
        {definition}
      </div>
    </div>
  );
};

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
    glossary: true,
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
      glossary: true,
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
      glossary: true,
    });
  };

  const collapseAll = () => {
    setExpandedSections({
      workflow: false,
      inputs: false,
      algorithms: false,
      diagnostics: false,
      tips: false,
      glossary: false,
    });
  };

  const tabsList: Array<{ key: TabKey; label: string; short: string; icon: any; standard: string }> = [
    { key: 'qtpp', label: '1. QTPP & CQAs', short: 'QTPP/CQA', icon: Target, standard: 'ICH Q8(R2)' },
    { key: 'fmea', label: '2. Rủi ro FMEA', short: 'FMEA/Ishikawa', icon: ShieldAlert, standard: 'ICH Q9(R1)' },
    { key: 'doe', label: '3. Thiết kế DoE', short: 'Ma trận DoE & DSD', icon: LayoutGrid, standard: 'DoE & DSD (Jones 2011)' },
    { key: 'anova', label: '4. Thống kê ANOVA', short: 'ANOVA Models', icon: Calculator, standard: 'MLR & Diagnostics' },
    { key: 'neural', label: '5. Mạng Nơ-ron', short: 'Neural & XAI', icon: BrainCircuit, standard: 'ANN & XAI (SHAP)' },
    { key: 'rsm', label: '6. Mặt đáp RSM', short: 'RSM & Contour', icon: Compass, standard: '3D/2D/Ternary' },
    { key: 'design_space', label: '7. Không gian Thiết kế', short: 'Design Space & 3D', icon: Boxes, standard: 'ICH Q8/Q9/Q10 & 3D' },
    { key: 'report', label: '8. Báo Cáo Hồ Sơ', short: 'CTD & PDF/A', icon: FileCheck2, standard: 'CTD & ISO 19005 PDF/A' },
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
                  <br />4. Bấm <strong>"+ Thêm Yếu Tố (X)"</strong> để khai báo các biến công thức/quy trình sẽ đưa vào nghiên cứu thực nghiệm.
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
                    <strong style={{ color: '#b45309' }}>4. Khung "3. Các Biến Đầu Vào Khảo Sát (CMA & CPP)":</strong>
                    <span className="badge badge-warning" style={{ fontSize: '0.68rem' }}>Nút: + Thêm Yếu Tố (X)</span>
                  </div>
                  <ul style={{ paddingLeft: '1.2rem', color: '#334155', lineHeight: 1.5 }}>
                    <li><strong>Nút "+ Thêm Yếu Tố (X)":</strong> Thêm một biến đầu vào mới (<InlineMath math="X_1, X_2\dots" />).</li>
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
          {
            id: 'glossary',
            title: 'Giải Thích Thuật Ngữ (Glossary & Terminology)',
            icon: BookOpen,
            keywords: ['QbD', 'QTPP', 'CQA', 'CMA', 'CPP', 'LSL', 'USL', 'Desirability', 'Simplex', 'Mixture'],
            content: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
                <GlossaryTermCard
                  term="QbD (Quality by Design)"
                  vietnamese="Thiết kế chất lượng"
                  tag="ICH Q8(R2)"
                  tagColor="teal"
                  definition="Cách tiếp cận có hệ thống trong nghiên cứu và phát triển dược phẩm bắt đầu từ các mục tiêu chất lượng định trước, dựa trên sự thấu hiểu sâu sắc về sản phẩm, quy trình sản xuất và quản lý rủi ro chất lượng (thay vì chỉ kiểm tra chất lượng ở khâu thành phẩm cuối cùng)."
                />
                <GlossaryTermCard
                  term="QTPP (Quality Target Product Profile)"
                  vietnamese="Hồ sơ chất lượng sản phẩm mục tiêu"
                  tag="ICH Q8"
                  tagColor="teal"
                  definition="Bản tóm lược có tính chất dự kiến về các đặc tính chất lượng của một sản phẩm thuốc cần đạt được một cách lý tưởng để bảo đảm hiệu quả điều trị và độ an toàn như công bố trên nhãn thuốc (bao gồm dạng bào chế, đường dùng, hàm lượng, độ hòa tan, độ tinh khiết và độ ổn định)."
                />
                <GlossaryTermCard
                  term="CQA (Critical Quality Attribute)"
                  vietnamese="Thuộc tính chất lượng trọng yếu"
                  tag="Biến Đầu Ra (Y)"
                  tagColor="primary"
                  definition="Đặc tính vật lý, hóa học, sinh học hoặc vi sinh vật của sản phẩm thuốc bắt buộc phải nằm trong giới hạn hoặc phân bố xác định (LSL–USL) để bảo đảm sản phẩm đạt chất lượng mong muốn (ví dụ: độ hòa tan sau 12h, độ cứng viên, độ đồng đều hàm lượng, hàm lượng tạp chất)."
                />
                <GlossaryTermCard
                  term="CMA (Critical Material Attribute)"
                  vietnamese="Thuộc tính nguyên vật liệu trọng yếu"
                  tag="Biến Đầu Vào (X)"
                  tagColor="warning"
                  definition="Thuộc tính vật lý, hóa học hoặc sinh học của nguyên vật liệu đầu vào (hoạt chất API hoặc tá dược) mà sự biến thiên của nó có tác động trực tiếp đến ít nhất một CQA (ví dụ: kích thước hạt D50 của API, độ nhớt của tá dược polymer kéo dài giải phóng, độ ẩm tá dược)."
                />
                <GlossaryTermCard
                  term="CPP (Critical Process Parameter)"
                  vietnamese="Thông số quy trình trọng yếu"
                  tag="Biến Đầu Vào (X)"
                  tagColor="warning"
                  definition="Thông số vận hành trong quá trình sản xuất (như lực dập chính, tốc độ cánh khuấy tạo hạt, nhiệt độ gió vào khi sấy tầng sôi) mà sự dao động của nó ảnh hưởng trực tiếp đến CQA, do đó cần được giám sát hoặc kiểm soát nghiêm ngặt."
                />
                <GlossaryTermCard
                  term="LSL & USL (Specification Limits)"
                  vietnamese="Giới hạn tiêu chuẩn dưới & trên"
                  tag="Dược Điển / Tiêu Chuẩn"
                  tagColor="slate"
                  definition={
                    <>
                      Giới hạn tiêu chuẩn dưới (<InlineMath math="\text{LSL}" />) và giới hạn tiêu chuẩn trên (<InlineMath math="\text{USL}" />) theo Dược điển (DĐVN, USP, Ph. Eur.) hoặc hồ sơ đăng ký thuốc; đáp ứng CQA bắt buộc phải nằm trong dải <InlineMath math="[\text{LSL}, \text{USL}]" /> để lô thuốc được đánh giá đạt tiêu chuẩn chất lượng.
                    </>
                  }
                />
                <GlossaryTermCard
                  term="Desirability Function"
                  vietnamese="Hàm thỏa dụng Derringer & Suich"
                  tag="Thống Kê Tối Ưu"
                  tagColor="primary"
                  definition={
                    <>
                      Phương pháp toán học chuyển đổi các đáp ứng CQA có đơn vị và thang đo khác nhau thành các giá trị không thứ nguyên <InlineMath math="d_i \in [0, 1]" /> (trong đó 0 = không chấp nhận được, 1 = đạt mục tiêu lý tưởng) để phục vụ bài toán tối ưu hóa đa mục tiêu đồng thời.
                    </>
                  }
                />
                <GlossaryTermCard
                  term="Simplex / Mixture Constraint"
                  vietnamese="Ràng buộc thành phần hỗn hợp"
                  tag="Ràng Buộc Công Thức"
                  tagColor="slate"
                  definition={
                    <>
                      Ràng buộc toán học trong công thức thuốc quy định tổng tỷ lệ phần trăm của các cấu tử hỗn hợp luôn bằng 100% (<InlineMath math="\sum X_i = 100\%" />). Khi đó các thành phần không thể biến thiên hoàn toàn độc lập mà phụ thuộc ràng buộc lẫn nhau.
                    </>
                  }
                />
              </div>
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
                  <br />3. Cho điểm từ 1–10 cho 3 chỉ số <strong>S</strong> (Mức nghiêm trọng), <strong>O</strong> (Khả năng xảy ra / Tần suất), <strong>D</strong> (Khả năng phát hiện).
                  <br />4. Quan sát hệ thống tự tính <strong>RPN</strong> và phân loại mức độ rủi ro (Cao / Trung bình / Thấp).
                  <br />5. Bấm nút <strong>"Chuyển sang DoE"</strong> ở góc phải để tiến hành thiết kế ma trận thí nghiệm.
                </div>
              </div>
            ),
          },
          {
            id: 'inputs',
            title: 'Chi Tiết Từng Nút Bấm, Bảng Điểm S-O-D & Phân Loại Rủi Ro',
            icon: Sliders,
            content: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', fontSize: '0.78rem' }}>
                <div style={{ backgroundColor: '#f8fafc', padding: '0.6rem', borderRadius: '0.375rem', border: '1px solid #e2e8f0' }}>
                  <strong style={{ color: '#1e3a8a' }}>1. Nút Chuyển Chế Độ &amp; Điều Hướng:</strong>
                  <ul style={{ paddingLeft: '1.2rem', marginTop: '0.3rem', color: '#334155', lineHeight: 1.5 }}>
                    <li><strong>Nút "Ma trận FMEA":</strong> Hiển thị bảng tính chấm điểm S, O, D và tính chỉ số RPN.</li>
                    <li><strong>Nút "Sơ đồ Xương cá (Ishikawa)":</strong> Trực quan hóa sơ đồ nguyên nhân - kết quả theo 6 nhóm: <em>Material, Machine, Method, Measurement, Environment, People</em>.</li>
                    <li><strong>Nút "Chuyển sang DoE":</strong> Chuyển nhanh sang Tab 3 (DoE Designer).</li>
                  </ul>
                </div>

                <div style={{ backgroundColor: '#f8fafc', padding: '0.6rem', borderRadius: '0.375rem', border: '1px solid #e2e8f0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                    <strong style={{ color: '#0f766e' }}>2. Bảng Phân Tích Dạng Sai Lỗi &amp; Tác Động (FMEA Matrix):</strong>
                    <span className="badge badge-teal" style={{ fontSize: '0.68rem' }}>Nút: + Thêm Hàng Đánh Giá Rủi Ro</span>
                  </div>
                  <ul style={{ paddingLeft: '1.2rem', color: '#334155', lineHeight: 1.5 }}>
                    <li><strong>Nút "+ Thêm Hàng Đánh Giá Rủi Ro":</strong> Thêm một dòng phân tích rủi ro mới.</li>
                    <li><strong>Biến Đầu Vào (Factor):</strong> Chọn yếu tố X cần đánh giá.</li>
                    <li><strong>CQA Bị Ảnh Hưởng:</strong> Chọn chỉ tiêu chất lượng tương ứng.</li>
                    <li><strong>Dạng sai lỗi / Cơ chế ảnh hưởng:</strong> Mô tả cơ chế lý hóa gây nguy cơ sai lệch.</li>
                    <li><strong>S (Severity - Mức nghiêm trọng, 1–10):</strong> 1–3 (Nhẹ), 4–6 (Vừa), 7–10 (Nghiêm trọng, vi phạm Dược điển/mất an toàn).</li>
                    <li><strong>O (Occurrence - Khả năng xảy ra / Tần suất, 1–10):</strong> 1–3 (Hiếm gặp), 4–6 (Thỉnh thoảng), 7–10 (Thường xuyên).</li>
                    <li><strong>D (Detection - Khả năng phát hiện, 1–10):</strong> 1–3 (Dễ phát hiện ngay qua IPC), 4–6 (Phát hiện qua QC), 7–10 (Rất khó phát hiện).</li>
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
                <BlockMath math="\text{RPN} = \text{Severity } (S) \times \text{Occurrence } (O) \times \text{Detection } (D) \in [1, 1000]" />
                
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
                <li><strong>Đánh giá cập nhật sau DoE:</strong> Báo cáo có thể tạo bảng đánh giá rủi ro cập nhật từ kết quả mô hình. Bảng FMEA ban đầu không tự sửa điểm S/O/D; hãy rà soát và phê duyệt thay đổi thủ công.</li>
              </ul>
            ),
          },
          {
            id: 'glossary',
            title: 'Giải Thích Thuật Ngữ (Glossary & Terminology)',
            icon: BookOpen,
            keywords: ['QRM', 'FMEA', 'RPN', 'Severity', 'Occurrence', 'Detection', 'Ishikawa', '6M', 'Mitigation'],
            content: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
                <GlossaryTermCard
                  term="QRM (Quality Risk Management)"
                  vietnamese="Quản lý rủi ro chất lượng"
                  tag="ICH Q9(R1)"
                  tagColor="teal"
                  definition="Quy trình có hệ thống để nhận diện, đánh giá, kiểm soát, trao đổi thông tin và định kỳ rà soát các nguy cơ đối với chất lượng của sản phẩm thuốc xuyên suốt vòng đời sản phẩm, bảo đảm quyền lợi và độ an toàn của người bệnh."
                />
                <GlossaryTermCard
                  term="FMEA (Failure Mode and Effects Analysis)"
                  vietnamese="Phân tích dạng sai lỗi và tác động"
                  tag="ICH Q9"
                  tagColor="teal"
                  definition="Phương pháp đánh giá rủi ro định lượng có cấu trúc nhằm phân tích các cơ chế sai lỗi tiềm ẩn của từng biến đầu vào (CMA/CPP), hậu quả của chúng đến các CQA và đánh giá tính hữu hiệu của các biện pháp kiểm soát hiện có."
                />
                <GlossaryTermCard
                  term="RPN (Risk Priority Number)"
                  vietnamese="Chỉ số ưu tiên rủi ro"
                  tag="QRM Sàng Lọc"
                  tagColor="danger"
                  definition={
                    <>
                      Tích số định lượng <InlineMath math="\text{RPN} = S \times O \times D \in [1, 1000]" /> dùng để lượng hóa và xếp hạng các rủi ro. Các yếu tố có RPN cao được ưu tiên đưa vào khảo sát thực nghiệm trong DoE để xác định biên kiểm soát an toàn.
                    </>
                  }
                />
                <GlossaryTermCard
                  term="Severity (S)"
                  vietnamese="Mức độ nghiêm trọng (1–10)"
                  tag="Chỉ Số FMEA"
                  tagColor="warning"
                  definition="Điểm số định lượng hậu quả của sai lỗi đối với sức khỏe bệnh nhân hoặc mức độ vi phạm tiêu chuẩn chất lượng Dược điển bắt buộc nếu sai lỗi xảy ra (1 = ảnh hưởng không đáng kể, 10 = gây hậu quả nguy hiểm, mất an toàn nghiêm trọng cho bệnh nhân)."
                />
                <GlossaryTermCard
                  term="Occurrence (O)"
                  vietnamese="Khả năng xuất hiện / Tần suất (1–10)"
                  tag="Chỉ Số FMEA"
                  tagColor="warning"
                  definition="Xác suất hoặc tần suất mà nguyên nhân gốc rễ gây ra sai lỗi có thể xảy ra trong điều kiện sản xuất thực tế dựa trên dữ liệu lịch sử hoặc kinh nghiệm chuyên gia (1 = cực kỳ hiếm gặp, 10 = gần như chắc chắn xảy ra thường xuyên)."
                />
                <GlossaryTermCard
                  term="Detection (D)"
                  vietnamese="Khả năng phát hiện (1–10)"
                  tag="Chỉ Số FMEA"
                  tagColor="warning"
                  definition="Mức độ khó khăn trong việc phát hiện sai lỗi trước khi sản phẩm xuất xưởng đến tay bệnh nhân (1 = phát hiện tức thời qua IPC tự động trên dây chuyền, 10 = hoàn toàn không thể phát hiện qua kiểm tra thông thường)."
                />
                <GlossaryTermCard
                  term="Ishikawa Diagram (Fishbone / 6M)"
                  vietnamese="Biểu đồ xương cá nhân-quả"
                  tag="Phân Tích Nguyên Nhân"
                  tagColor="slate"
                  definition="Công cụ trực quan hóa các nguồn biến thiên tiềm ẩn tác động đến CQA theo 6 nhóm: Material (Nguyên liệu), Machine (Máy móc/Thiết bị), Method (Phương pháp/Quy trình), Measurement (Đo lường/Kiểm nghiệm), Environment (Môi trường sản xuất) và Man (Con người/Thao tác)."
                />
                <GlossaryTermCard
                  term="Risk Mitigation"
                  vietnamese="Biện pháp giảm thiểu rủi ro"
                  tag="Kiểm Soát QRM"
                  tagColor="teal"
                  definition="Các biện pháp kỹ thuật, thiết kế DoE hoặc bổ sung điểm kiểm soát trong quá trình (IPC) nhằm hạ thấp điểm S, O, D và đưa chỉ số RPN về vùng an toàn chấp nhận được (Acceptable Risk)."
                />
              </div>
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
                  Thiết kế ma trận thực nghiệm tối ưu thống kê (<strong>DoE Matrix</strong>), bao gồm sàng lọc hiện đại <strong>Definitive Screening Design (DSD)</strong>, thiết kế hỗn hợp có ràng buộc <strong>Piepel Bounds</strong>, đánh giá độ hiệu quả ma trận (<strong>D-Efficiency</strong>) và nhập/đồng bộ số liệu thực nghiệm với <strong>MS Excel</strong>.
                </p>
                <div style={{ backgroundColor: '#f0fdf4', padding: '0.6rem 0.8rem', borderRadius: '0.4rem', border: '1px solid #bbf7d0', fontSize: '0.78rem', color: '#166534', lineHeight: 1.6 }}>
                  <strong>Thứ tự thao tác chuẩn:</strong>
                  <br />1. Chọn <em>Mục tiêu nghiên cứu</em> (Sàng lọc / Tối ưu hóa / Robustness) và <em>Ngân sách run</em> trong <strong>Design Wizard</strong> &rarr; Bấm <strong>"Chọn phương án"</strong> (hoặc tự chọn dạng thiết kế như <strong>Definitive Screening Design (DSD)</strong>, Box-Behnken, Central Composite, Simplex D-Optimal).
                  <br />2. Cấu hình điểm tâm (Center points), số mẻ lặp, hoặc giới hạn trên/dưới cho biến hỗn hợp (<InlineMath math="L_i \le x_i \le U_i" /> theo chuẩn Piepel).
                  <br />3. Bấm <strong>"Tạo Ma Trận Thí Nghiệm"</strong> để tạo bảng chạy thực nghiệm.
                  <br />4. (Tùy chọn) Bấm <strong>"+ Thêm run thông tin nhất"</strong> nếu cần bổ sung tuần tự (Sequential DoE).
                  <br />5. Xem chẩn đoán ma trận: tính khả định (rank/term), bậc tự do phần dư, đòn bẩy Leverage, Condition Number và D-efficiency.
                  <br />6. Nhập số liệu thực nghiệm vào các cột CQA màu xanh ngọc (hoặc bấm <strong>"Điền Mô Phỏng"</strong> / dán từ Excel bằng <strong>"📥 Dán Dữ Liệu (Ctrl+V)"</strong>).
                  <br />7. Bấm <strong>"Phân Tích ANOVA"</strong> để chuyển sang bước tính toán thống kê.
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
                  <strong style={{ color: '#1e3a8a' }}>1. Khung Điều Khiển Đầu Trang &amp; Kiểu Thiết Kế DoE:</strong>
                  <ul style={{ paddingLeft: '1.2rem', marginTop: '0.3rem', color: '#334155', lineHeight: 1.5 }}>
                    <li><strong>Nút "Tạo Ma Trận Thí Nghiệm":</strong> Khởi tạo toàn bộ ma trận thí nghiệm theo cấu hình đã chọn.</li>
                    <li><strong>Nút "Phân Tích ANOVA":</strong> Chuyển sang Tab 4 để phân tích mô hình.</li>
                    <li><strong>Definitive Screening Design (DSD - Jones &amp; Nachtsheim 2011):</strong> Thiết kế sàng lọc hiện đại 3 mức. Hiệu ứng chính trực giao tuyệt đối, hoàn toàn không bị nhiễu chập với tương tác 2 yếu tố (2FI) và độ cong bậc hai. Ước lượng độ cong với số mẻ tối thiểu (<InlineMath math="2k+1" /> hoặc <InlineMath math="2k+3" /> mẻ).</li>
                    <li><strong>Ràng buộc Hỗn hợp Đa giác (Piepel Bounds):</strong> Tự động kiểm tra tính nhất quán (<InlineMath math="\sum L_i \le 1 \le \sum U_i" />) và sinh các đỉnh cực trị (extreme vertices) bên trong miền khả thi.</li>
                    <li><strong>Design Wizard:</strong> Nhập <em>Mục tiêu nghiên cứu</em> và <em>Ngân sách tối đa (run)</em> &rarr; Bấm nút <strong>"Chọn phương án"</strong> tương ứng.</li>
                    <li><strong>Khung "Bổ sung tuần tự D-optimal (Sequential DoE)":</strong> Nhập <em>Số run bổ sung</em> &rarr; Bấm nút <strong>"+ Thêm run thông tin nhất"</strong> để bổ sung điểm thực nghiệm tối ưu thông tin Fisher.</li>
                  </ul>
                </div>

                <div style={{ backgroundColor: '#f8fafc', padding: '0.6rem', borderRadius: '0.375rem', border: '1px solid #e2e8f0' }}>
                  <strong style={{ color: '#0f766e' }}>2. Thanh Công Cụ Thao Tác Bảng Tính (Spreadsheet Action Toolbar):</strong>
                  <ul style={{ paddingLeft: '1.2rem', marginTop: '0.3rem', color: '#334155', lineHeight: 1.5 }}>
                    <li><strong>Nút "+ Thêm Dòng" (Menu xổ xuống):</strong> Thêm dòng ở cuối, chèn tại vị trí chọn, nhân bản dòng đang chọn, hoặc thêm hàng loạt 5/10 dòng.</li>
                    <li><strong>Nút "Xóa Hàng / Xóa n Dòng":</strong> Xóa các dòng thí nghiệm đang được chọn.</li>
                    <li><strong>Nút "📋 Copy Vùng (Ctrl+C)":</strong> Sao chép vùng ô đang chọn hoặc toàn bộ bảng sang Clipboard.</li>
                    <li><strong>Nút "📥 Dán Dữ Liệu (Ctrl+V)":</strong> Dán trực tiếp số liệu từ Excel vào bảng tính với cơ chế lọc công thức an toàn chống CSV Injection.</li>
                    <li><strong>Nút "Xóa Ô (Del)":</strong> Xóa trắng nội dung trong các ô đang bôi đen.</li>
                    <li><strong>Nút "📤 Tải Lên":</strong> Nạp file dữ liệu thực nghiệm định dạng `.csv`.</li>
                    <li><strong>Nút "🎲 Xáo Run":</strong> Xáo ngẫu nhiên thứ tự thực hiện thí nghiệm (Randomized Run Order).</li>
                    <li><strong>Nút "Sắp (Run)" / "Sắp (Std)":</strong> Sắp xếp bảng hiển thị theo Run Order hoặc Standard Order.</li>
                    <li><strong>Nút "Điền Mô Phỏng":</strong> Sinh dữ liệu minh họa để kiểm tra luồng giao diện/phân tích.</li>
                    <li><strong>Nút "Xuất File":</strong> Tải bảng số liệu về máy tính định dạng `.csv`.</li>
                  </ul>
                </div>
              </div>
            ),
          },
          {
            id: 'algorithms',
            title: 'Thuật Toán Đánh Giá Ma Trận (DSD, Piepel Bounds, D-Efficiency, Leverage)',
            icon: Calculator,
            content: (
              <div style={{ fontSize: '0.78rem', color: '#334155', lineHeight: 1.6 }}>
                <p><strong>1. Ma Trận Sàng Lọc Hiện Đại Definitive Screening Design (Jones &amp; Nachtsheim 2011):</strong></p>
                <BlockMath math="\mathbf{S} = \begin{bmatrix} \mathbf{C}_k \\ -\mathbf{C}_k \end{bmatrix}, \quad \mathbf{C}_k \in \{0, \pm 1\}^{k \times k}" />
                <p>Dựa trên ma trận hội nghị Paley đối xứng <InlineMath math="\mathbf{C}_k" /> với đường chéo chính bằng 0 và cấu trúc gập đôi đối xứng (foldover). Các tính chất toán học độc đáo của DSD bao gồm:</p>
                <ul style={{ paddingLeft: '1.2rem', marginTop: '0.2rem' }}>
                  <li>• <strong>Trực giao hiệu ứng chính:</strong> <InlineMath math="\mathbf{X}_1^T \mathbf{X}_1 = c \mathbf{I}" /> (các hiệu ứng chính hoàn toàn độc lập với nhau).</li>
                  <li>• <strong>Không nhiễu chập với tương tác bậc hai:</strong> <InlineMath math="\mathbf{X}_1^T \mathbf{X}_2 = \mathbf{0}" /> (hiệu ứng chính không bị làm sai lệch bởi bất kỳ tương tác <InlineMath math="X_i X_j" /> nào).</li>
                  <li>• <strong>Không nhiễu chập với độ cong bậc hai:</strong> <InlineMath math="\mathbf{X}_1^T \mathbf{X}_i^2 = \mathbf{0}" /> (cho phép sàng lọc phát hiện yếu tố phi tuyến mà không cần thêm mẻ RSM tốn kém).</li>
                </ul>

                <p style={{ marginTop: '0.5rem' }}><strong>2. Ràng Buộc Hỗn Hợp Đa Diện (Piepel 1983 Mixture Polytope Bounds):</strong></p>
                <BlockMath math="L_i^* = \max\left(L_i, \, 1 - \sum_{j \ne i} U_j\right), \quad U_i^* = \min\left(U_i, \, 1 - \sum_{j \ne i} L_j\right)" />
                <p>Khi các thành phần công thức có cận trên và cận dưới (<InlineMath math="L_i \le x_i \le U_i" /> với <InlineMath math="\sum x_i = 1" />), miền thực nghiệm không còn là tam giác/tứ diện đều mà trở thành đa diện lồi (polytope). Thuật toán kiểm tra tính nhất quán <InlineMath math="\sum L_i \le 1 \le \sum U_i" /> và áp dụng phương pháp McLean-Anderson / XVERT để sinh các đỉnh cực trị.</p>

                <p style={{ marginTop: '0.5rem' }}><strong>3. Chỉ số Hiệu Suất Định Thức D-Efficiency &amp; Leverage:</strong></p>
                <BlockMath math="\text{D-Efficiency} = 100 \times \left[ \frac{|\mathbf{X}^T \mathbf{X}|^{1/p}}{N} \right], \quad h_{ii} = \mathbf{x}_i (\mathbf{X}^T \mathbf{X})^{-1} \mathbf{x}_i^T" />
                <p>• <strong>D-Efficiency:</strong> Đo lường độ tập trung của thông tin Fisher để cực tiểu hóa thể tích elip sai số của các hệ số hồi quy.</p>
                <p>• <strong>Leverage (<InlineMath math="h_{ii}" />):</strong> Cảnh báo mức độ ảnh hưởng vị trí của một mẻ thử nghiệm lên mô hình.</p>
              </div>
            ),
          },
          {
            id: 'tips',
            title: 'Mẹo Thực Hành Khi Triển Khai DoE Tại Phòng Thí Nghiệm',
            icon: Lightbulb,
            content: (
              <ul style={{ paddingLeft: '1.2rem', fontSize: '0.78rem', color: '#334155', lineHeight: 1.6 }}>
                <li><strong>Khi nào nên chọn DSD thay cho Fractional Factorial:</strong> Khi bạn có từ 4 đến 12 yếu tố liên tục và nghi ngờ có hiện tượng phi tuyến (độ cong bậc 2), DSD là lựa chọn hàng đầu vì số mẻ chỉ bằng <InlineMath math="2k+1" /> hoặc <InlineMath math="2k+3" /> mà vẫn ước lượng được hiệu ứng phi tuyến độc lập.</li>
                <li><strong>Điểm tâm và run lặp:</strong> Luôn bổ sung điểm tâm lặp (Center Points) để ước lượng <em>pure error</em> (dao động độc lập với mô hình) và làm căn cứ kiểm định độ kém tương thích (Lack of Fit).</li>
                <li><strong>Thứ tự ngẫu nhiên hóa (Randomized Run Order):</strong> Thực hiện các mẻ thử theo thứ tự ngẫu nhiên của cột Run Order để triệt tiêu sai số hệ thống theo thời gian.</li>
              </ul>
            ),
          },
          {
            id: 'glossary',
            title: 'Giải Thích Thuật Ngữ (Glossary & Terminology)',
            icon: BookOpen,
            keywords: ['DoE', 'DSD', 'Definitive Screening', 'Conference Matrix', 'Piepel Bounds', 'D-Efficiency', 'A-Efficiency', 'G-Efficiency', 'Coded', 'Leverage', 'Condition Number', 'Randomization', 'Center Points', 'Pure Error', 'Sequential'],
            content: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
                <GlossaryTermCard
                  term="DSD (Definitive Screening Design)"
                  vietnamese="Thiết kế sàng lọc hiện đại 3 mức"
                  tag="DoE Thế Hệ Mới"
                  tagColor="teal"
                  definition={
                    <>
                      Thiết kế quy hoạch thực nghiệm 3 mức do Jones &amp; Nachtsheim (2011) phát minh dựa trên ma trận hội nghị, trong đó các hiệu ứng chính trực giao tuyệt đối với nhau, không bị nhiễu chập với tương tác 2 yếu tố và không bị nhiễu chập với độ cong bậc hai.
                    </>
                  }
                />
                <GlossaryTermCard
                  term="Conference Matrix & Foldover"
                  vietnamese="Ma trận hội nghị & Cấu trúc gập đối xứng"
                  tag="Đại Số Tuyến Tính DoE"
                  tagColor="primary"
                  definition={
                    <>
                      Ma trận vuông <InlineMath math="\mathbf{C}_k" /> kích thước <InlineMath math="k \times k" /> với đường chéo bằng 0 và các phần tử khác là <InlineMath math="\pm 1" />, thỏa mãn <InlineMath math="\mathbf{C}_k^T \mathbf{C}_k = (k-1)\mathbf{I}" />. Ghép cặp <InlineMath math="[\mathbf{C}_k; -\mathbf{C}_k]" /> tạo ra tính đối xứng triệt tiêu hoàn toàn tương tác bậc hai.
                    </>
                  }
                />
                <GlossaryTermCard
                  term="Mixture Polytope (Piepel Bounds)"
                  vietnamese="Đa diện hỗn hợp có ràng buộc biên"
                  tag="Công Thức Bào Chế"
                  tagColor="purple"
                  definition={
                    <>
                      Không gian hình học của công thức hỗn hợp khi các thành phần bị giới hạn bởi cận dưới và cận trên (<InlineMath math="L_i \le x_i \le U_i" />). Thuật toán Piepel (1983) giúp tính toán biên hiệu dụng khả thi và xác định các đỉnh cực trị (extreme vertices) để thiết lập ma trận thực nghiệm tối ưu.
                    </>
                  }
                />
                <GlossaryTermCard
                  term="DoE (Design of Experiments)"
                  vietnamese="Quy hoạch thực nghiệm"
                  tag="DoE / Thống Kê"
                  tagColor="primary"
                  definition="Phương pháp thống kê đa biến có cấu trúc, thay đổi đồng thời có chủ đích các biến đầu vào để xác định quy luật toán học, hiệu ứng chính và tương tác tác động lên CQA với số lần chạy tối thiểu."
                />
                <GlossaryTermCard
                  term="D-Efficiency (D-Optimality)"
                  vietnamese="Hiệu suất D"
                  tag="Tối Ưu Ma Trận"
                  tagColor="teal"
                  definition={
                    <>
                      Tiêu chuẩn tối ưu ma trận thực nghiệm dựa trên việc cực đại hóa định thức ma trận thông tin Fisher <InlineMath math="|\mathbf{X}^T\mathbf{X}|" />, giúp cực tiểu hóa thể tích elip sai số của các hệ số hồi quy ước lượng <InlineMath math="\hat{\boldsymbol{\beta}}" />.
                    </>
                  }
                />
                <GlossaryTermCard
                  term="A-Efficiency & G-Efficiency"
                  vietnamese="Hiệu suất A & Hiệu suất G"
                  tag="Tiêu Chí Tối Ưu"
                  tagColor="slate"
                  definition={
                    <>
                      Tiêu chuẩn A cực tiểu hóa vết ma trận nghịch đảo <InlineMath math="\text{Tr}((\mathbf{X}^T\mathbf{X})^{-1})" /> (tổng phương sai các hệ số hồi quy); tiêu chuẩn G cực tiểu hóa phương sai dự báo cực đại trên toàn bộ không gian thực nghiệm.
                    </>
                  }
                />
                <GlossaryTermCard
                  term="Leverage (hii)"
                  vietnamese="Độ đòn bẩy ma trận"
                  tag="Chẩn Đoán Vị Trí"
                  tagColor="warning"
                  definition={
                    <>
                      Phần tử trên đường chéo chính của ma trận hình chiếu Hat <InlineMath math="\mathbf{H} = \mathbf{X}(\mathbf{X}^T\mathbf{X})^{-1}\mathbf{X}^T" />, đo lường khoảng cách từ một điểm chạy thí nghiệm đến trọng tâm của ma trận thiết kế và mức độ ảnh hưởng vị trí của nó lên mô hình hồi quy.
                    </>
                  }
                />
                <GlossaryTermCard
                  term="Center Points & Pure Error"
                  vietnamese="Điểm tâm & Sai số thuần túy"
                  tag="Kiểm Định Lặp"
                  tagColor="slate"
                  definition={
                    <>
                      Các lần chạy lặp lại ở cùng điều kiện tâm <InlineMath math="[0, 0, \dots, 0]" /> để ước lượng độ biến thiên tự nhiên của phép đo độc lập với mô hình (pure error), làm cơ sở toán học để kiểm định độ kém tương thích (Lack of Fit).
                    </>
                  }
                />
                <GlossaryTermCard
                  term="Sequential DoE"
                  vietnamese="DoE tuần tự"
                  tag="Chiến Lược DoE"
                  tagColor="primary"
                  definition="Chiến lược phát triển bổ sung có mục tiêu (ví dụ bổ sung thêm các điểm D-optimal vào ma trận sàng lọc trước đó) nhằm nâng cao bậc tự do và chuyển đổi mô hình từ tuyến tính sang phi tuyến bậc 2 mà không lãng phí các mẻ thử nghiệm cũ."
                />
              </div>
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
                    <li><strong>Dropdown "Dạng mô hình":</strong> Chọn giữa <em>Đa thức Bậc 2 (Quadratic)</em>, <em>Tương tác 2 Yếu tố (2FI)</em>, <em>Tuyến tính (Linear)</em>.</li>
                    <li><strong>Nút "Thử Mạng Nơ-ron":</strong> Chuyển nhanh sang Tab 5 (Neural Network Tab) để so sánh với AI.</li>
                    <li><strong>Nút "Tiếp Tục Với Đa Thức (Bước 6, 7, 8)":</strong> Khóa mô hình Hồi quy Đa thức bậc &le; 2 làm phương pháp chính cho toàn bộ các bước tiếp theo.</li>
                  </ul>
                </div>

                <div style={{ backgroundColor: '#f8fafc', padding: '0.6rem', borderRadius: '0.375rem', border: '1px solid #e2e8f0' }}>
                  <strong style={{ color: '#0f766e' }}>2. Khung "Analysis Wizard — chọn mô hình và xác nhận":</strong>
                  <ul style={{ paddingLeft: '1.2rem', marginTop: '0.3rem', color: '#334155', lineHeight: 1.5 }}>
                    <li><strong>Nút "Áp dụng":</strong> Áp dụng cấu hình mô hình từ bảng so sánh ứng viên (AICc, <InlineMath math="Q^2" />, LOF p, df phần dư).</li>
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
                <p>• Tương tác 2 yếu tố (2FI):</p>
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
          {
            id: 'glossary',
            title: 'Giải Thích Thuật Ngữ (Glossary & Terminology)',
            icon: BookOpen,
            keywords: ['ANOVA', 'OLS', 'R2', 'R-squared', 'Adjusted R2', 'Q2', 'Predicted R2', 'Lack of Fit', 'LOF', 'p-value', 'VIF', 'Cook Distance', 'Degrees of Freedom', 'df'],
            content: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
                <GlossaryTermCard
                  term="ANOVA (Analysis of Variance)"
                  vietnamese="Phân tích phương sai"
                  tag="Thống Kê MLR"
                  tagColor="primary"
                  definition={
                    <>
                      Kỹ thuật thống kê chia tách tổng biến thiên quan sát được (<InlineMath math="SS_{\text{Total}}" />) thành phần biến thiên do mô hình giải thích (<InlineMath math="SS_{\text{Model}}" />) và biến thiên ngẫu nhiên phần dư (<InlineMath math="SS_{\text{Residual}}" />), kiểm định mức độ tin cậy của mô hình thông qua tỷ số Fisher <InlineMath math="F" />.
                    </>
                  }
                />
                <GlossaryTermCard
                  term="OLS (Ordinary Least Squares)"
                  vietnamese="Bình phương bé nhất cổ điển"
                  tag="Hồi Quy Tuyến Tính"
                  tagColor="slate"
                  definition={
                    <>
                      Kỹ thuật toán học giải tích tìm vector hệ số hồi quy <InlineMath math="\hat{\boldsymbol{\beta}} = (\mathbf{X}^T\mathbf{X})^{-1}\mathbf{X}^T\mathbf{Y}" /> sao cho tổng bình phương khoảng cách giữa các điểm thực nghiệm và mặt phẳng hồi quy đạt cực tiểu.
                    </>
                  }
                />
                <GlossaryTermCard
                  term="R² & Adjusted R² (R²adj)"
                  vietnamese="Hệ số xác định & Hệ số hiệu chỉnh"
                  tag="Độ Khớp Mô Hình"
                  tagColor="primary"
                  definition={
                    <>
                      <InlineMath math="R^2" /> đo tỷ lệ phần trăm biến thiên của CQA được mô hình giải thích trên tập dữ liệu hiện có; <InlineMath math="R^2_{\text{adj}}" /> trừ điểm phạt theo số lượng tham số thêm vào mô hình, giúp tránh việc thêm biến ảo làm tăng giả tạo <InlineMath math="R^2" />.
                    </>
                  }
                />
                <GlossaryTermCard
                  term="Predicted R² (Q²)"
                  vietnamese="Hệ số xác định dự báo"
                  tag="Năng Lực Dự Báo"
                  tagColor="teal"
                  definition={
                    <>
                      Thước đo độ chuẩn xác khi dự báo trên các mẫu mới thông qua kiểm định chéo loại từng quan sát (Leave-One-Out / PRESS); khoảng cách <InlineMath math="R^2_{\text{adj}} - Q^2 < 0.2" /> cho thấy mô hình ổn định và không bị hiện tượng quá khớp (overfitting).
                    </>
                  }
                />
                <GlossaryTermCard
                  term="Lack of Fit (LOF)"
                  vietnamese="Độ kém tương thích"
                  tag="Kiểm Định Dạng Mô Hình"
                  tagColor="warning"
                  definition={
                    <>
                      Kiểm định F so sánh sai số do mô hình sai dạng với sai số thuần túy (pure error) từ các mẻ lặp; giá trị <InlineMath math="p \ge 0.05" /> (không có ý nghĩa thống kê) là tín hiệu tốt, chứng tỏ dạng mô hình toán học đã đủ phù hợp để mô tả dữ liệu.
                    </>
                  }
                />
                <GlossaryTermCard
                  term="p-value"
                  vietnamese="Mức ý nghĩa thống kê p"
                  tag="Ý Nghĩa Thống Kê"
                  tagColor="teal"
                  definition={
                    <>
                      Xác suất quan sát thấy hiệu ứng chỉ do ngẫu nhiên nếu giả thiết không (<InlineMath math="H_0" />) là đúng; quy ước phổ biến <InlineMath math="p < 0.05" /> được xem là yếu tố có tác động ý nghĩa thống kê ở độ tin cậy 95%.
                    </>
                  }
                />
                <GlossaryTermCard
                  term="VIF (Variance Inflation Factor)"
                  vietnamese="Hệ số phóng đại phương sai"
                  tag="Đa Cộng Tuyến"
                  tagColor="danger"
                  definition={
                    <>
                      Thước đo mức độ tương quan đa cộng tuyến giữa các biến độc lập trong mô hình; <InlineMath math="\text{VIF} \approx 1" /> là lý tưởng (trực giao), <InlineMath math="\text{VIF} > 5 - 10" /> cảnh báo các biến phụ thuộc lẫn nhau làm sai lệch ước lượng hệ số.
                    </>
                  }
                />
                <GlossaryTermCard
                  term="Cook's Distance (Di)"
                  vietnamese="Khoảng cách Cook"
                  tag="Điểm Dị Biệt"
                  tagColor="danger"
                  definition={
                    <>
                      Thước đo mức độ thay đổi của toàn bộ các giá trị dự báo khi loại bỏ quan sát thứ <InlineMath math="i" />; giá trị <InlineMath math="D_i > 1" /> cảnh báo một điểm dữ liệu có sức ảnh hưởng bất thường (influential outlier) cần được kiểm tra nguyên nhân gốc rễ.
                    </>
                  }
                />
                <GlossaryTermCard
                  term="Degrees of Freedom (df)"
                  vietnamese="Bậc tự do"
                  tag="Thống Kê Cơ Bản"
                  tagColor="slate"
                  definition={
                    <>
                      Số lượng giá trị độc lập có thể biến thiên tự do trong một phép tính thống kê (<InlineMath math="df_{\text{Residual}} = N - p" />). Khi <InlineMath math="N = p" />, bậc tự do phần dư bằng 0 dẫn đến mô hình bão hòa và không thể tính được Lack of Fit.
                    </>
                  }
                />
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
                  Nền tảng <strong>Mạng Nơ-ron Nhân Tạo AI (ANN)</strong> kết hợp <strong>Explainable AI (XAI Studio)</strong> và <strong>Đấu Trường Đa Mô Hình (Multi-Model Benchmarking Arena)</strong>, giúp mô hình hóa phi tuyến tính phức tạp và giải mã minh bạch cơ chế tác động phục vụ hồ sơ pháp lý (FDA/EMA).
                </p>
                <div style={{ backgroundColor: '#faf5ff', padding: '0.6rem 0.8rem', borderRadius: '0.4rem', border: '1px solid #e9d5ff', fontSize: '0.78rem', color: '#6b21a8', lineHeight: 1.6 }}>
                  <strong>Thứ tự thao tác chuẩn:</strong>
                  <br />1. Chọn <strong>Chế độ Huấn luyện</strong> (Độc lập từng CQA hoặc Mạng chung đa đầu ra Shared).
                  <br />2. Điều chỉnh <strong>Số nơ-ron lớp ẩn 1 &amp; 2</strong>, <strong>Hàm kích hoạt</strong> (Tanh/Sigmoid/ReLU) và <strong>Weight Decay (<InlineMath math="\lambda" />)</strong>.
                  <br />3. Kiểm tra tỷ lệ <strong>N/P</strong> (số mẫu huấn luyện/số tham số). App dùng <InlineMath math="N/P \ge 2" /> như cảnh báo sàng lọc.
                  <br />4. Bấm nút <strong>"Huấn Luyện Lại (Train Network)"</strong> để tiến hành huấn luyện mạng nơ-ron với thanh tiến trình trực quan.
                  <br />5. Khám phá <strong>Explainable AI Studio</strong>: Chuyển đổi giữa <em>🐝 SHAP Beeswarm</em> (toàn cục), <em>📊 SHAP Waterfall</em> (từng mẻ thử nghiệm) và <em>⚖️ Đối Chiếu 3 Thuật Toán</em> (Garson - Olden - SHAP).
                  <br />6. Tham khảo bảng <strong>Đấu Trường Đa Mô Hình (Multi-Model Benchmarking)</strong>: So sánh đối đầu giữa Polynomial RSM, ANN MLP, SVR (SMO) và Akaike Ensemble Stacking với các chỉ số <InlineMath math="R^2, R^2_{\text{adj}}" />, RMSE, AICc, BIC.
                  <br />7. Bấm nút <strong>"Tiếp Tục Với Mạng Nơ-ron (Bước 6, 7, 8)"</strong> để khóa mô hình AI làm phương pháp chính cho Design Space.
                </div>
              </div>
            ),
          },
          {
            id: 'inputs',
            title: 'Chi Tiết Từng Nút Bấm, XAI Studio & Đấu Trường Đa Mô Hình',
            icon: Sliders,
            content: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', fontSize: '0.78rem' }}>
                <div style={{ backgroundColor: '#f8fafc', padding: '0.6rem', borderRadius: '0.375rem', border: '1px solid #e2e8f0' }}>
                  <strong style={{ color: '#6b21a8' }}>1. Khung Điều Khiển Huấn Luyện &amp; Các Nút Bấm:</strong>
                  <ul style={{ paddingLeft: '1.2rem', marginTop: '0.3rem', color: '#334155', lineHeight: 1.5 }}>
                    <li><strong>Nút "Huấn Luyện Lại (Train Network)":</strong> Bắt đầu huấn luyện mô hình mạng nơ-ron cho CQA hiện tại.</li>
                    <li><strong>Nút "Huấn Luyện Tất Cả CQAs":</strong> Huấn luyện đồng loạt tất cả các mạng nơ-ron độc lập cho toàn bộ các CQA.</li>
                    <li><strong>Nút "Sao Chép Cấu Hình Sang Tất Cả Y":</strong> Đồng bộ bộ siêu tham số hiện tại sang tất cả các CQA khác.</li>
                    <li><strong>Nút "Khôi Phục Mặc Định (Reset)":</strong> Đặt lại các siêu tham số về giá trị khuyến nghị chuẩn của dược phẩm.</li>
                    <li><strong>Nút "Tiếp Tục Với Mạng Nơ-ron (Bước 6, 7, 8)":</strong> Khóa mô hình Mạng Nơ-ron AI làm engine chính cho các bước tiếp theo.</li>
                  </ul>
                </div>

                <div style={{ backgroundColor: '#f8fafc', padding: '0.6rem', borderRadius: '0.375rem', border: '1px solid #e2e8f0' }}>
                  <strong style={{ color: '#0f766e' }}>2. XAI Studio (Giải Trình Mô Hình AI Minh Bạch):</strong>
                  <ul style={{ paddingLeft: '1.2rem', marginTop: '0.3rem', color: '#334155', lineHeight: 1.5 }}>
                    <li><strong>🐝 Tab "SHAP Beeswarm (Toàn Cục)":</strong> Biểu diễn phân bố giá trị Shapley của tất cả các lần chạy thực nghiệm. Trục X là mức độ làm tăng (+) hoặc giảm (-) đáp ứng dự báo; màu sắc thể hiện mức mã hóa từ thấp (xanh) đến cao (đỏ).</li>
                    <li><strong>📊 Tab "SHAP Waterfall (Cục Bộ)":</strong> Phân tích đóng góp chi tiết cho từng mẻ chạy đơn lẻ (<InlineMath math="\text{Run \#i}" />), giải thích cách các yếu tố đẩy giá trị dự báo từ mức kỳ vọng nền <InlineMath math="E[f(X)]" /> đến giá trị dự báo thực tế <InlineMath math="f(x)" />.</li>
                    <li><strong>⚖️ Tab "Đối Chiếu 3 Thuật Toán (Garson - Olden - SHAP)":</strong> So sánh song song: Garson (độ quan trọng cấu trúc trọng số), Olden (chiều hướng thúc đẩy hay ức chế), và SHAP (đóng góp biên theo lý thuyết trò chơi hợp tác).</li>
                  </ul>
                </div>

                <div style={{ backgroundColor: '#f8fafc', padding: '0.6rem', borderRadius: '0.375rem', border: '1px solid #e2e8f0' }}>
                  <strong style={{ color: '#1e40af' }}>3. Đấu Trường Đa Mô Hình (Multi-Model Benchmarking Arena):</strong>
                  <ul style={{ paddingLeft: '1.2rem', marginTop: '0.3rem', color: '#334155', lineHeight: 1.5 }}>
                    <li><strong>Bảng So Sánh Đối Đầu:</strong> Đặt cạnh nhau 4 họ mô hình: Hồi quy đa thức RSM (Linear, 2FI, Quadratic), Mạng Nơ-ron (ANN MLP), Máy Vector Hỗ Trợ (SVR - SMO), và Mô hình Xếp Chồng Trọng Số Akaike (Ensemble Stacking).</li>
                    <li><strong>Các Tiêu Chí Xếp Hạng:</strong> <InlineMath math="R^2, R^2_{\text{adj}}" />, RMSE, Hurvich-Tsai AICc, Schwarz BIC, và Trọng số Akaike (<InlineMath math="w_i" />).</li>
                    <li><strong>Gợi Ý Khuyến Nghị (Summary Recommendation):</strong> Tự động đánh giá mô hình nào đạt độ cân bằng tối ưu giữa năng lực dự báo và độ phức tạp theo chuẩn AICc/BIC.</li>
                  </ul>
                </div>
              </div>
            ),
          },
          {
            id: 'algorithms',
            title: 'Thuật Toán XAI (Garson, Olden, SHAP) & Đấu Trường Đa Mô Hình',
            icon: Calculator,
            content: (
              <div style={{ fontSize: '0.78rem', color: '#334155', lineHeight: 1.6 }}>
                <p><strong>1. Thuật Toán Explainable AI (XAI):</strong></p>
                <ul style={{ paddingLeft: '1.2rem', marginTop: '0.2rem' }}>
                  <li>
                    <strong>Phương pháp Olden (2004):</strong> Tính tích các trọng số liên kết xuyên suốt các lớp <InlineMath math="S_i = \sum_{j} w_{ij} \cdot v_{j}" />. Giữ nguyên dấu đại số giúp nhận diện yếu tố là chất kích thích làm tăng (+) hay ức chế làm giảm (-) chỉ tiêu chất lượng.
                  </li>
                  <li>
                    <strong>Thuật toán Garson (1991):</strong> Phân chia tỷ lệ phần trăm đóng góp của các trọng số tuyệt đối:
                    <BlockMath math="I_i = \frac{\sum_{j} \left( \frac{|w_{ij}|}{\sum_k |w_{kj}|} |v_j| \right)}{\sum_i \sum_j \left( \frac{|w_{ij}|}{\sum_k |w_{kj}|} |v_j| \right)} \times 100\%" />
                  </li>
                  <li>
                    <strong>Lý Thuyết Trò Chơi Hợp Tác Shapley (SHAP - Lundberg &amp; Lee 2017):</strong> Định lượng đóng góp biên của yếu tố <InlineMath math="i" /> trên toàn bộ các tập con yếu tố <InlineMath math="S" />:
                    <BlockMath math="\phi_i(x) = \sum_{S \subseteq F \setminus \{i\}} \frac{|S|!(|F|-|S|-1)!}{|F|!} \left[ f(S \cup \{i\}) - f(S) \right]" />
                    Thỏa mãn định lý bảo toàn hiệu suất (Efficiency Axiom): <InlineMath math="\sum_{i=1}^k \phi_i = f(x) - E[f(X)]" />.
                  </li>
                </ul>

                <p style={{ marginTop: '0.5rem' }}><strong>2. Hiệu Chỉnh Cỡ Mẫu Nhỏ Hurvich-Tsai AICc &amp; Schwarz BIC:</strong></p>
                <BlockMath math="\text{AICc} = \text{AIC} + \frac{2k(k+1)}{n - k - 1}, \quad \text{BIC} = k \ln(n) - 2\ln(\hat{L})" />
                <p>Với các bộ dữ liệu DoE dược phẩm có cỡ mẫu nhỏ (<InlineMath math="n < 40" />), công thức AICc của Hurvich &amp; Tsai (1989) áp dụng số hạng phạt bậc hai giúp ngăn ngừa hiện tượng chọn mô hình quá phức tạp dẫn đến quá khớp.</p>

                <p style={{ marginTop: '0.5rem' }}><strong>3. Mô Hình Xếp Chồng Akaike (Ensemble Stacking):</strong></p>
                <BlockMath math="w_i = \frac{\exp\left(-0.5 \Delta \text{AICc}_i\right)}{\sum_j \exp\left(-0.5 \Delta \text{AICc}_j\right)}, \quad \hat{y}_{\text{Ensemble}} = \sum_i w_i \hat{y}_i" />
                <p>Tổng hợp dự báo có trọng số của các mô hình ứng viên, giúp giảm phương sai dự báo và tăng độ vững chắc khi ngoại suy gần biên.</p>
              </div>
            ),
          },
          {
            id: 'diagnostics',
            title: 'Chẩn Đoán Mô Hình, Tiêu Chuẩn Thông Tin (AICc, BIC) & Xếp Hạng',
            icon: Activity,
            content: (
              <div style={{ fontSize: '0.78rem', color: '#334155', lineHeight: 1.6 }}>
                <div style={{ backgroundColor: '#eff6ff', padding: '0.6rem 0.75rem', borderRadius: '0.375rem', border: '1px solid #bfdbfe', marginBottom: '0.6rem', color: '#1e40af' }}>
                  <strong>Chuẩn mực thống kê khoa học:</strong> Phần mềm cung cấp cả đánh giá kiểm định chéo (Validation <InlineMath math="R^2" />, RMSE) lẫn các tiêu chuẩn phạt số lượng tham số tự do (Hurvich-Tsai AICc, Schwarz BIC) trên cùng một tập dữ liệu thực nghiệm.
                </div>

                <ul style={{ paddingLeft: '1.2rem', margin: '0.4rem 0', display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                  <li>
                    <strong>Hiệu chỉnh bậc tự do và kích thước mẫu DoE:</strong>
                    <br />
                    Khi số tham số hiệu dụng <InlineMath math="p" /> tiệm cận số mẫu <InlineMath math="N" />, app áp dụng số hạng hiệu chỉnh mẫu nhỏ của Hurvich-Tsai. Trường hợp số mẫu không đủ để xác định ma trận hiệp phương sai, hệ thống cảnh báo rõ ràng và khuyến nghị ưu tiên chỉ số <strong>Validation RMSE / K-Fold R²</strong>.
                  </li>
                  <li>
                    <strong>Ý nghĩa của trọng số Akaike (<InlineMath math="w_i" />):</strong>
                    <br />
                    Đo lường xác suất có điều kiện để mô hình <InlineMath math="i" /> là mô hình tốt nhất trong số các mô hình đang được so sánh. Mô hình có <InlineMath math="w_i > 0.7" /> được xem là vượt trội rõ rệt.
                  </li>
                  <li>
                    <strong>Kiểm chứng tính bảo toàn của SHAP:</strong>
                    <br />
                    Tại mỗi mẻ chạy, app kiểm tra tự động sai số hiệu suất <InlineMath math="|\sum \phi_i - (f(x) - \text{base})| < 10^{-5}" /> để bảo đảm các giá trị giải trình hoàn toàn chính xác theo định lý toán học Shapley.
                  </li>
                </ul>
              </div>
            ),
          },
          {
            id: 'tips',
            title: 'Mẹo Tối Ưu Huấn Luyện Mạng Nơ-ron AI & Diễn Giải XAI',
            icon: Lightbulb,
            content: (
              <ul style={{ paddingLeft: '1.2rem', fontSize: '0.78rem', color: '#334155', lineHeight: 1.6 }}>
                <li><strong>Khi nào nên chọn ANN thay vì Đa thức ANOVA:</strong> Khi Đa thức bậc 2 có Lack of Fit có ý nghĩa (<InlineMath math="p < 0.05" />) hoặc biểu đồ phân tán thặng dư (Residuals vs Predicted) uốn cong rõ rệt, chứng tỏ có phi tuyến tính bậc cao.</li>
                <li><strong>Sử dụng biểu đồ SHAP Beeswarm trong báo cáo:</strong> Rất thuyết phục các thanh tra viên dược phẩm vì nó vừa chỉ rõ yếu tố nào quan trọng nhất, vừa chỉ rõ tăng nồng độ tá dược đó sẽ làm tăng hay giảm độ hòa tan/độ rã của thuốc.</li>
                <li><strong>Tham khảo Đấu trường Đa mô hình:</strong> Luôn kiểm tra xem mô hình ANN có thực sự vượt trội hơn Đa thức hoặc SVR trên tập kiểm định độc lập hay không trước khi quyết định khóa mô hình.</li>
              </ul>
            ),
          },
          {
            id: 'glossary',
            title: 'Giải Thích Thuật Ngữ (Glossary & Terminology)',
            icon: BookOpen,
            keywords: ['ANN', 'MLP', 'XAI', 'SHAP', 'Shapley', 'Garson', 'Olden', 'Benchmarking', 'SVR', 'Ensemble', 'AICc', 'BIC', 'Activation Function', 'Weight Decay', 'Overfitting', 'Generalization'],
            content: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
                <GlossaryTermCard
                  term="XAI (Explainable Artificial Intelligence)"
                  vietnamese="Trí tuệ nhân tạo có thể giải trình được"
                  tag="Công Nghệ Dược Phẩm 4.0"
                  tagColor="teal"
                  definition="Tập hợp các phương pháp toán học và trực quan hóa giúp mở 'hộp đen' của các thuật toán học máy phức tạp (như ANN), làm sáng tỏ lý do vì sao mô hình đưa ra dự báo và mức độ đóng góp của từng thông số công thức/quy trình."
                />
                <GlossaryTermCard
                  term="SHAP (Shapley Additive exPlanations)"
                  vietnamese="Giá trị đóng góp cộng tính Shapley"
                  tag="Chuẩn Vàng XAI"
                  tagColor="purple"
                  definition={
                    <>
                      Phương pháp giải thích mô hình dựa trên Lý thuyết trò chơi hợp tác của giải Nobel Lloyd Shapley (1953). Phân bổ công bằng và duy nhất giá trị đóng góp biên (<InlineMath math="\phi_i" />) của từng biến đầu vào đối với độ lệch của dự báo so với mức trung bình nền.
                    </>
                  }
                />
                <GlossaryTermCard
                  term="Olden's Method"
                  vietnamese="Phương pháp trọng số liên kết Olden"
                  tag="XAI Mạng Nơ-ron"
                  tagColor="teal"
                  definition="Thuật toán tính tổng tích số các trọng số từ nơ-ron đầu vào xuyên qua các lớp ẩn tới đầu ra, cho phép xác định chính xác cả độ lớn lẫn chiều hướng tác động (thúc đẩy (+) hoặc ức chế (-)) của từng biến lên đáp ứng."
                />
                <GlossaryTermCard
                  term="Garson's Algorithm"
                  vietnamese="Thuật toán phân rã trọng số Garson"
                  tag="XAI Mạng Nơ-ron"
                  tagColor="slate"
                  definition="Phương pháp cổ điển phân bổ tỷ lệ phần trăm đóng góp của các biến đầu vào dựa trên ma trận giá trị tuyệt đối của các trọng số liên kết trong mạng nơ-ron truyền thẳng đa tầng (MLP)."
                />
                <GlossaryTermCard
                  term="Multi-Model Benchmarking Arena"
                  vietnamese="Đấu trường đối soát đa mô hình"
                  tag="Thẩm Định Đối Đầu"
                  tagColor="primary"
                  definition="Khung so sánh đối đầu khách quan giữa các lớp mô hình khác nhau (Đa thức RSM, Mạng nơ-ron ANN, Máy vector hỗ trợ SVR, Mô hình xếp chồng Ensemble) trên cùng bộ dữ liệu DoE để chọn ra mô hình tối ưu nhất cho hồ sơ kỹ thuật."
                />
                <GlossaryTermCard
                  term="Hurvich-Tsai AICc & BIC"
                  vietnamese="Tiêu chuẩn thông tin hiệu chỉnh mẫu nhỏ"
                  tag="Độ Phức Tạp & Quá Khớp"
                  tagColor="warning"
                  definition={
                    <>
                      Chỉ số đánh giá độ cân bằng giữa độ khớp dữ liệu và số lượng tham số tự do của mô hình. <InlineMath math="\text{AICc}" /> có số hạng phạt đặc biệt cho cỡ mẫu nhỏ (<InlineMath math="n < 40" />), giúp nhà nghiên cứu tránh bẫy quá khớp (overfitting) trong quy hoạch thực nghiệm.
                    </>
                  }
                />
                <GlossaryTermCard
                  term="Akaike Weights (wi)"
                  vietnamese="Trọng số xác suất Akaike"
                  tag="Xác Suất Mô Hình"
                  tagColor="teal"
                  definition={
                    <>
                      Trọng số chuẩn hóa dựa trên <InlineMath math="\Delta \text{AICc}" />, đại diện cho xác suất tương đối để một mô hình cụ thể là mô hình xấp xỉ tốt nhất thực tế khách quan trong tập hợp các mô hình ứng viên.
                    </>
                  }
                />
                <GlossaryTermCard
                  term="ANN (Artificial Neural Network)"
                  vietnamese="Mạng nơ-ron nhân tạo"
                  tag="ANN / Học Máy"
                  tagColor="purple"
                  definition="Mô hình toán học học máy lấy cảm hứng từ cấu trúc mạng lưới nơ-ron thần kinh sinh học, có khả năng xấp xỉ vạn năng (Universal Approximation) các hàm số phi tuyến đa chiều phức tạp trong dược phẩm mà hồi quy đa thức bậc 2 khó biểu diễn được."
                />
                <GlossaryTermCard
                  term="Weight Decay (L2 Regularization / λ)"
                  vietnamese="Hệ số suy giảm trọng số L2"
                  tag="Điều Chuẩn Ngăn Quá Khớp"
                  tagColor="teal"
                  definition={
                    <>
                      Kỹ thuật điều chuẩn bằng cách cộng thêm số hạng phạt bình phương các trọng số <InlineMath math="\frac{\lambda}{2} \sum w_i^2" /> vào hàm mất mát khi huấn luyện, giúp ngăn ngừa mạng uốn lượn bất thường theo nhiễu và làm mịn mặt đáp.
                    </>
                  }
                />
                <GlossaryTermCard
                  term="Overfitting vs. Generalization"
                  vietnamese="Quá khớp đối lập Khái quát hóa"
                  tag="Đánh Giá Mô Hình"
                  tagColor="warning"
                  definition={
                    <>
                      Quá khớp (Overfitting / Học vẹt) là tình trạng mạng nơ-ron nhớ máy móc cả dữ liệu nhiễu (Train <InlineMath math="R^2 \approx 1" /> nhưng Validation <InlineMath math="R^2" /> rất thấp), làm mất đi khả năng khái quát hóa (Generalization) để dự báo chính xác trên các lô thực tế mới.
                    </>
                  }
                />
                <GlossaryTermCard
                  term="K-Fold Cross-Validation"
                  vietnamese="Kiểm định chéo K phần"
                  tag="Thẩm Định Dữ Liệu"
                  tagColor="teal"
                  definition="Phương pháp kiểm định chéo chia ngẫu nhiên dữ liệu DoE thành K phần bằng nhau, luân phiên huấn luyện trên K-1 phần và kiểm tra trên phần còn lại, giúp đánh giá khách quan năng lực dự báo khi cỡ mẫu nhỏ."
                />
              </div>
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
                  <br />4. Quan sát các đường cắt giới hạn tiêu chuẩn <strong>LSL, USL, Target</strong> trên mặt đáp cong.
                  <br />5. Bấm nút <strong>"Tiếp Tục Sang Không Gian Thiết Kế"</strong> để chuyển sang Tab 7.
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
                    <li><strong>Nút "Mặt Đáp 3D (3D Surface)":</strong> Đồ thị 3 chiều có thể xoay chuột, zoom, chiếu đường đồng mức xuống đáy.</li>
                    <li><strong>Nút "Đường Đồng Mức 2D (2D Contour)":</strong> Bản đồ đường đồng mức trên hệ tọa độ Descartes (X–Y) với con trỏ rà soát giá trị (Hover Probe).</li>
                    <li><strong>Nút "Tam Giác Hỗn Hợp (Ternary Contour)":</strong> Đồ thị tọa độ tam giác đều Barycentric chuyên biệt cho 3 thành phần hỗn hợp (<InlineMath math="X_A + X_B + X_C = 100\%" />).</li>
                    <li><strong>Nút "Tiếp Tục Sang Không Gian Thiết Kế":</strong> Chuyển sang Tab 7 (Design Space).</li>
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
            title: 'Mẹo Quan Sát Mặt Đáp RSM',
            icon: Lightbulb,
            content: (
              <ul style={{ paddingLeft: '1.2rem', fontSize: '0.78rem', color: '#334155', lineHeight: 1.6 }}>
                <li><strong>Đổi trục tọa độ X và Y:</strong> Hãy thử đổi vị trí giữa các biến để quan sát góc nhìn trực quan và dễ hiểu nhất của các điểm cực trị.</li>
                <li><strong>Đường LSL/USL:</strong> Cho biết biên đạt/không đạt <em>theo mô hình</em> trên lát cắt. Thay đổi biến cố định rồi kiểm tra lại, đặc biệt khi có tương tác giữa các factor.</li>
              </ul>
            ),
          },
          {
            id: 'glossary',
            title: 'Giải Thích Thuật Ngữ (Glossary & Terminology)',
            icon: BookOpen,
            keywords: ['RSM', 'Surface', 'Contour', 'Ternary', 'Simplex', 'Slicing', 'Fixed Factors', 'Curvature', 'Barycentric'],
            content: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
                <GlossaryTermCard
                  term="RSM (Response Surface Methodology)"
                  vietnamese="Phương pháp mặt đáp"
                  tag="RSM / Đồ Thị"
                  tagColor="teal"
                  definition="Tập hợp các công cụ toán học và đồ họa dùng để nghiên cứu mối tương quan thực nghiệm giữa các biến độc lập và đáp ứng CQA, nhằm tìm kiếm điều kiện vận hành tối ưu trong không gian đa chiều."
                />
                <GlossaryTermCard
                  term="3D Surface Plot"
                  vietnamese="Mặt đáp 3 chiều"
                  tag="Trực Quan Hóa 3D"
                  tagColor="primary"
                  definition="Đồ thị không gian 3 chiều biểu diễn mối quan hệ hàm số giữa hai biến đầu vào trên trục X, Y và đáp ứng CQA trên trục Z, giúp nhận diện trực quan điểm cực đại (Peak), cực tiểu (Valley) hoặc điểm yên ngựa (Saddle point)."
                />
                <GlossaryTermCard
                  term="2D Contour Plot"
                  vietnamese="Đường đồng mức 2 chiều"
                  tag="Bản Đồ Đồng Mức"
                  tagColor="teal"
                  definition="Bản đồ chiếu phẳng liên kết các điểm có cùng giá trị dự báo CQA bằng các đường đẳng trị. Mật độ đường đồng mức càng dày thể hiện độ dốc (độ nhạy) của đáp ứng theo biến đầu vào càng lớn."
                />
                <GlossaryTermCard
                  term="Ternary Plot / Simplex"
                  vietnamese="Đồ thị tọa độ tam giác"
                  tag="Hỗn Hợp 3 Cấu Tử"
                  tagColor="warning"
                  definition="Đồ thị chuyên biệt cho các nghiên cứu công thức 3 thành phần hỗn hợp (ví dụ: dầu - diện hoạt - đồng diện hoạt trong hệ tự vi nhũ hóa SEDDS) với ràng buộc tổng tỷ lệ luôn bằng 100%, sử dụng hệ tọa độ tam giác Barycentric."
                />
                <GlossaryTermCard
                  term="Fixed Factors / Slicing"
                  vietnamese="Cố định biến phụ / Cắt lát không gian"
                  tag="Kỹ Thuật Khảo Sát"
                  tagColor="slate"
                  definition="Thao tác gán giá trị cố định cho các yếu tố không hiển thị trên trục đồ thị (đặt về điểm tâm hoặc điểm tối ưu) để xem một lát cắt 2D hoặc 3D cụ thể của không gian nghiên cứu nhiều chiều."
                />
                <GlossaryTermCard
                  term="Curvature"
                  vietnamese="Độ cong mặt đáp"
                  tag="Phi Tuyến Bậc 2"
                  tagColor="slate"
                  definition={
                    <>
                      Mức độ uốn cong của bề mặt đáp ứng do các hiệu ứng bậc hai (<InlineMath math="\beta_{ii} X_i^2" />) hoặc tương tác (<InlineMath math="\beta_{ij} X_i X_j" />), chứng minh sự cần thiết phải dùng mô hình bậc 2 (Quadratic) hoặc mạng nơ-ron thay cho mô hình tuyến tính đơn giản.
                    </>
                  }
                />
                <GlossaryTermCard
                  term="Specification Contour Lines"
                  vietnamese="Đường biên giới hạn tiêu chuẩn"
                  tag="Biên Tiêu Chuẩn"
                  tagColor="danger"
                  definition="Các đường đồng mức đặc biệt tương ứng đúng với giá trị ngưỡng LSL, USL hoặc Target của CQA, giúp phân định rõ ranh giới giữa miền đạt tiêu chuẩn và miền không đạt trên lát cắt khảo sát."
                />
              </div>
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
                  Khảo sát <strong>vùng chấp nhận dự báo</strong> từ mô hình (2D Contour &amp; <strong>3D Surface Sweet-spot</strong>), tối ưu hóa thỏa dụng bằng giải thuật di truyền liên tục (<strong>RCGA + Nelder-Mead</strong>), điều chỉnh lát cắt động đa biến và ước lượng rủi ro bằng Monte Carlo.
                </p>
                <div style={{ backgroundColor: '#f0fdf4', padding: '0.6rem 0.8rem', borderRadius: '0.4rem', border: '1px solid #bbf7d0', fontSize: '0.78rem', color: '#166534', lineHeight: 1.6 }}>
                  <strong>Thứ tự thao tác chuẩn:</strong>
                  <br />1. Trong thanh công cụ <strong>Prediction Profiler</strong>: Bấm nút <strong>"✨ Tối Đa Hóa Thỏa Dụng (Max D)"</strong> để kích hoạt giải thuật di truyền <strong>RCGA + Nelder-Mead</strong> tự động tìm điểm tối ưu toàn cục Derringer-Suich.
                  <br />2. (Tùy chọn) Bấm <strong>"💾 Lưu Kịch Bản (n)"</strong> để lưu lại các kịch bản cài đặt ứng viên cần so sánh, hoặc <strong>"🔄 Về Tâm (0)"</strong> để đặt lại điểm tâm, hoặc <strong>"⚙️ Mục Tiêu &amp; Trọng Số ∨"</strong> để sửa nhanh LSL/Target/USL/Trọng số.
                  <br />3. Chọn chế độ xem: <strong>"2D Contour"</strong> hoặc bấm <strong>"3D Surface"</strong> để quan sát bề mặt biên an toàn chất lượng (<InlineMath math="Z = \text{Margin}_{\min}" />) và mặt phẳng chuẩn <InlineMath math="Z = 0" />.
                  <br />4. Tương tác với <strong>Thanh Trượt Lát Cắt Động Yếu Tố Thứ 3 (Dynamic Slicing X3)</strong>: Di chuyển thanh trượt để quét liên tục các lát cắt, quan sát dải màu <strong>PAR / NOR Range Bar</strong> và huy hiệu trạng thái khả thi của lát cắt.
                  <br />5. Nhập <em>Số lô mô phỏng</em> (vd: 10.000) và <em>Độ biến thiên RSD%</em> (vd: &plusmn;2.0%) &rarr; Bấm <strong>"▶ Chạy Mô Phỏng Monte Carlo"</strong> để thẩm định độ bền vững (Reliability %, PPM, Cpk).
                  <br />6. Bấm nút <strong>"Tiếp Tục Sang Báo Cáo Hồ Sơ"</strong> để chuyển sang Tab 8.
                </div>
              </div>
            ),
          },
          {
            id: 'inputs',
            title: 'Chi Tiết Prediction Profiler, Chế Độ 3D Surface & Thanh Trượt Lát Cắt X3',
            icon: Sliders,
            content: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', fontSize: '0.78rem' }}>
                <div style={{ backgroundColor: '#f8fafc', padding: '0.6rem', borderRadius: '0.375rem', border: '1px solid #e2e8f0' }}>
                  <strong style={{ color: '#1e3a8a' }}>1. Khung "Prediction Profiler &amp; Desirability Optimization" (Thanh màu xanh đậm):</strong>
                  <ul style={{ paddingLeft: '1.2rem', marginTop: '0.3rem', color: '#334155', lineHeight: 1.5 }}>
                    <li><strong>Đồng hồ OVERALL D:</strong> Trung bình nhân có trọng số của các desirability (<InlineMath math="D \in [0, 1]" />). Tự động bằng 0 nếu bất kỳ CQA nào bị vi phạm giới hạn.</li>
                    <li><strong>Nút "✨ Tối Đa Hóa Thỏa Dụng (Max D)":</strong> Chạy bộ giải thuật di truyền số thực liên tục <strong>RCGA</strong> đa khởi tạo, sau đó tinh chỉnh cục bộ bằng thuật toán <strong>Nelder-Mead simplex</strong> để tìm ra điểm cực đại toàn cục mượt mà và chính xác.</li>
                    <li><strong>Nút "💾 Lưu Kịch Bản (n)":</strong> Lưu lại điểm cài đặt hiện tại vào danh sách kịch bản để dễ dàng đối chiếu và khôi phục.</li>
                    <li><strong>Nút "🔄 Về Tâm (0)":</strong> Đặt lại tất cả các yếu tố về mức tâm thực nghiệm.</li>
                    <li><strong>Nút "⚙️ Mục Tiêu &amp; Trọng Số ∨":</strong> Mở bảng accordion để chỉnh sửa nhanh mục tiêu (Target, Max, Min), giới hạn LSL–USL, hàm hình dạng lũy thừa (<InlineMath math="s, t" />) và trọng số (<InlineMath math="w_i" />).</li>
                    <li><strong>Nút "🔒 Khóa / 🔓 Mở khóa" (Trên từng cột Factor):</strong> Khóa cố định một biến không cho thay đổi trong quá trình tối ưu hóa.</li>
                  </ul>
                </div>

                <div style={{ backgroundColor: '#f8fafc', padding: '0.6rem', borderRadius: '0.375rem', border: '1px solid #e2e8f0' }}>
                  <strong style={{ color: '#0f766e' }}>2. Đồ Thị Không Gian Thiết Kế &amp; Chế Độ 3D Surface:</strong>
                  <ul style={{ paddingLeft: '1.2rem', marginTop: '0.3rem', color: '#334155', lineHeight: 1.5 }}>
                    <li><strong>Nút "3D Surface":</strong> Chuyển sang bề mặt 3D tương tác biểu diễn biên an toàn chất lượng <InlineMath math="Z = \text{Margin}_{\min}" />. Bề mặt nằm trên mặt phẳng <InlineMath math="Z = 0" /> tương ứng với vùng đạt chuẩn toàn diện (Sweet Spot).</li>
                    <li><strong>Nút "2D Contour":</strong> Bản đồ chiếu phẳng 2 chiều với vùng xanh lá (<InlineMath math="\text{Margin}_i \ge 0 \quad \forall i" />) và vùng đỏ (vượt giới hạn CQA).</li>
                    <li>★ <strong>Ngôi sao Xanh:</strong> Điểm vận hành mục tiêu tối ưu (Target Setpoint).</li>
                  </ul>
                </div>

                <div style={{ backgroundColor: '#f8fafc', padding: '0.6rem', borderRadius: '0.375rem', border: '1px solid #e2e8f0' }}>
                  <strong style={{ color: '#6b21a8' }}>3. Thanh Trượt Lát Cắt Động Yếu Tố Thứ 3 (Dynamic Slicing X3):</strong>
                  <ul style={{ paddingLeft: '1.2rem', marginTop: '0.3rem', color: '#334155', lineHeight: 1.5 }}>
                    <li><strong>Dropdown Chọn Biến Lát Cắt:</strong> Chọn một yếu tố thứ ba (<InlineMath math="X_3" />) ngoài 2 trục đang hiển thị để thực hiện cắt lớp không gian.</li>
                    <li><strong>Thanh Trượt Liên Tục:</strong> Kéo trượt để thay đổi giá trị của <InlineMath math="X_3" /> trong miền khảo sát thực tế và mã hóa; mặt đáp 2D/3D sẽ tự động cập nhật theo thời gian thực.</li>
                    <li><strong>Dải Màu PAR / NOR Range Bar:</strong> Thanh hiển thị trực quan ranh giới vùng vận hành tin cậy (PAR - màu xanh nhạt) và vùng vận hành thường quy (NOR - màu xanh đậm), kèm vạch chỉ báo vị trí lát cắt hiện tại.</li>
                    <li><strong>Huy Hiệu Khả Thi Của Lát Cắt:</strong> Hiển thị <em>✓ Lát Cắt Khả Thi (+X% Max Margin)</em> nếu lát cắt có tồn tại điểm đạt chuẩn, hoặc cảnh báo nếu lát cắt nằm ngoài vùng an toàn.</li>
                    <li><strong>Trình Chiếu Tự Động (Auto-scan Player):</strong> Bấm nút Play (▶) để tự động quét qua các lát cắt từ cận dưới đến cận trên của yếu tố.</li>
                  </ul>
                </div>

                <div style={{ backgroundColor: '#f8fafc', padding: '0.6rem', borderRadius: '0.375rem', border: '1px solid #e2e8f0' }}>
                  <strong style={{ color: '#b45309' }}>4. Khung "Mô Phỏng Độ Bền Vững Monte Carlo (ICH Q9 / Q10)":</strong>
                  <ul style={{ paddingLeft: '1.2rem', marginTop: '0.3rem', color: '#334155', lineHeight: 1.5 }}>
                    <li><strong>Ô "Số lô mô phỏng ảo":</strong> Nhập số lượng lô ảo cần thử nghiệm (vd: 10.000 lô).</li>
                    <li><strong>Ô "Độ biến thiên thiết bị/môi trường (RSD %)":</strong> Mức dao động dự kiến quanh điểm cài đặt (vd: &plusmn;2.0%).</li>
                    <li><strong>Nút "▶ Chạy Mô Phỏng Monte Carlo":</strong> Lấy mẫu Gaussian cho biến liên tục; mẫu vượt miền khảo sát được ghi nhận là excursion và tính là thất bại.</li>
                    <li><strong>Kết quả thu được:</strong> Reliability (%) là tỷ lệ lô ảo đạt tất cả CQA; PPM là số lô lỗi trên một triệu; Cpk phản ánh năng lực quy trình.</li>
                  </ul>
                </div>
              </div>
            ),
          },
          {
            id: 'algorithms',
            title: 'Thuật Toán Tối Ưu Hóa Lai RCGA + Nelder-Mead, Bề Mặt 3D & Monte Carlo',
            icon: Calculator,
            content: (
              <div style={{ fontSize: '0.78rem', color: '#334155', lineHeight: 1.6 }}>
                <p><strong>1. Bộ Tối Ưu Hóa Lai Ghép RCGA + Nelder-Mead Simplex:</strong></p>
                <p>Thay vì quét lưới tĩnh rời rạc (grid search) dễ bỏ sót cực đại cục bộ, app sử dụng giải thuật di truyền số thực liên tục:</p>
                <ul style={{ paddingLeft: '1.2rem', marginTop: '0.2rem' }}>
                  <li>• <strong>Khởi tạo &amp; Lai ghép SBX (Simulated Binary Crossover):</strong> Tạo thế hệ con cái liên tục trên không gian lồi với tham số phân bố <InlineMath math="\eta_c = 2" />.</li>
                  <li>• <strong>Đột biến Đa thức (Polynomial Mutation):</strong> Tạo đột biến cục bộ thích ứng với <InlineMath math="\eta_m = 20" /> để thoát khỏi các bẫy cực trị địa phương.</li>
                  <li>• <strong>Nelder-Mead Simplex Polishing:</strong> Sử dụng điểm tốt nhất từ quần thể di truyền làm mầm khởi đầu cho thuật toán đơn hình Nelder-Mead (phản xạ, mở rộng, co cụm) để hội tụ chính xác tuyệt đối tới điểm cực đại toàn cục của hàm Derringer-Suich.</li>
                </ul>

                <p style={{ marginTop: '0.5rem' }}><strong>2. Bề Mặt Biên An Toàn 3D Sweet-Spot:</strong></p>
                <BlockMath math="Z(x_1, x_2 \mid x_3 = c) = \text{Margin}_{\min}(x_1, x_2, c) = \min_{i=1}^m \left[ \text{NormMargin}_i(x_1, x_2, c) \right]" />
                <p>Bề mặt 3D trực quan hóa biên an toàn chất lượng xấu nhất giữa các CQA. Vùng không gian thiết kế khả thi là phần bề mặt nằm phía trên mặt phẳng tham chiếu <InlineMath math="Z = 0" />.</p>

                <p style={{ marginTop: '0.5rem' }}><strong>3. Hàm Thỏa Dụng Tổng Thể Derringer &amp; Suich:</strong></p>
                <BlockMath math="D = \left[ \prod_{i=1}^m (d_i)^{w_i} \right]^{\frac{1}{\sum_{i=1}^m w_i}} \in [0, 1]" />
                <p>Nếu bất kỳ CQA nào có <InlineMath math="d_i = 0" /> (ngoài tiêu chuẩn) &rarr; <InlineMath math="D = 0" />.</p>

                <p style={{ marginTop: '0.5rem' }}><strong>4. Mô Phỏng Monte Carlo &amp; Năng Lực Quy Trình Cpk:</strong></p>
                <BlockMath math="X_j \sim \mathcal{N}(\mu_{\text{setpoint}}, \, \sigma_j^2), \quad C_{pk} = \min\left( \frac{\text{USL} - \mu}{3\sigma}, \, \frac{\mu - \text{LSL}}{3\sigma} \right)" />
              </div>
            ),
          },
          {
            id: 'tips',
            title: 'Mẹo Khảo Sát Không Gian 3D & Khắc Phục Sai Hỏng PPM',
            icon: Lightbulb,
            content: (
              <ul style={{ paddingLeft: '1.2rem', fontSize: '0.78rem', color: '#334155', lineHeight: 1.6 }}>
                <li><strong>Cách dùng thanh trượt lát cắt X3 hiệu quả:</strong> Khi tối ưu hóa công thức có từ 3 yếu tố trở lên, hãy kéo thanh trượt lát cắt để tìm vị trí mà dải xanh lá đạt diện tích rộng nhất; điểm đó tương ứng với điều kiện vận hành có độ bền vững cao nhất đối với biến thứ 3.</li>
                <li><strong>Đọc dải PAR / NOR Range Bar:</strong> Vùng NOR luôn phải nằm trọn vẹn bên trong dải PAR. Khoảng cách giữa biên NOR và biên PAR chính là biên độ đệm an toàn (Safety Margin) chống lại các sai lệch bất thường trong xưởng sản xuất.</li>
                <li><strong>Khắc phục PPM cao:</strong> Xem CQA nào chi phối lỗi nhiều nhất, sử dụng bộ giải Max D để đưa setpoint lùi sâu hơn vào tâm vùng xanh, cách xa các đường biên tiêu chuẩn.</li>
              </ul>
            ),
          },
          {
            id: 'glossary',
            title: 'Giải Thích Thuật Ngữ (Glossary & Terminology)',
            icon: BookOpen,
            keywords: ['Design Space', '3D Surface', 'Dynamic Slicing', 'RCGA', 'Nelder-Mead', 'PAR', 'NOR', 'Desirability', 'Monte Carlo', 'Cpk', 'PPM', 'Sweet Spot'],
            content: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
                <GlossaryTermCard
                  term="3D Design Space Surface"
                  vietnamese="Bề mặt không gian thiết kế 3D"
                  tag="Trực Quan Hóa 3D"
                  tagColor="teal"
                  definition={
                    <>
                      Bề mặt không gian 3 chiều tương tác trên Plotly biểu diễn độ an toàn chất lượng đa biến <InlineMath math="Z = \text{Margin}_{\min}" />. Vùng bề mặt nằm trên mặt phẳng chuẩn <InlineMath math="Z = 0" /> chính là vùng giao thoa đạt chuẩn (Sweet Spot).
                    </>
                  }
                />
                <GlossaryTermCard
                  term="Dynamic Slicing (X3)"
                  vietnamese="Cắt lát động yếu tố thứ 3"
                  tag="Khảo Sát Đa Chiều"
                  tagColor="primary"
                  definition="Tính năng thanh trượt tương tác thời gian thực cho phép quan sát các mặt cắt không gian thiết kế 2D và 3D ứng với từng mức cụ thể của yếu tố thứ 3, kèm dải màu biểu diễn ranh giới vùng PAR và NOR."
                />
                <GlossaryTermCard
                  term="RCGA (Real-Coded Genetic Algorithm)"
                  vietnamese="Giải thuật di truyền số thực"
                  tag="Tối Ưu Hóa Toàn Cục"
                  tagColor="purple"
                  definition="Thuật toán tối ưu hóa mô phỏng quá trình tiến hóa sinh học trên các biến số thực liên tục (không qua mã hóa nhị phân), sử dụng toán tử lai ghép SBX và đột biến đa thức để tìm kiếm điểm cực đại toàn cục trên toàn bộ không gian khả thi."
                />
                <GlossaryTermCard
                  term="Nelder-Mead Simplex Polishing"
                  vietnamese="Bộ tinh chỉnh đơn hình Nelder-Mead"
                  tag="Tối Ưu Cục Bộ"
                  tagColor="slate"
                  definition="Phương pháp tối ưu hóa hình học đơn hình (Simplex search) không cần tính đạo hàm, dùng để tinh chỉnh bước cuối sau giải thuật di truyền nhằm hội tụ với độ chính xác cao vào điểm tối ưu toàn cục của hàm Derringer-Suich."
                />
                <GlossaryTermCard
                  term="Design Space"
                  vietnamese="Không gian thiết kế"
                  tag="ICH Q8(R2)"
                  tagColor="teal"
                  definition="Sự kết hợp và tương tác đa chiều giữa các biến nguyên vật liệu đầu vào (CMA) và các thông số quy trình (CPP) đã được chứng minh là đảm bảo chất lượng sản phẩm thuốc luôn đạt yêu cầu. Làm việc trong Design Space không bị coi là thay đổi đăng ký thuốc (regulatory change)."
                />
                <GlossaryTermCard
                  term="PAR (Proven Acceptable Range)"
                  vietnamese="Dải thông số được chứng minh chấp nhận được"
                  tag="Dải Vận Hành"
                  tagColor="primary"
                  definition="Dải thông số quy trình mà khi vận hành trong đó (các thông số khác giữ nguyên) vẫn đảm bảo CQA thỏa mãn tiêu chuẩn. Trong ứng dụng, dải ban đầu tạo ra là provisional screening range cần được khẳng định lại bằng kiểm tra đa biến và mẻ xác nhận."
                />
                <GlossaryTermCard
                  term="NOR (Normal Operating Range)"
                  vietnamese="Dải vận hành thường quy"
                  tag="Dải Sản Xuất"
                  tagColor="teal"
                  definition="Dải thông số kiểm soát chặt chẽ quanh điểm cài đặt mục tiêu (Target Setpoint) được áp dụng trong sản xuất thường quy hàng ngày, có biên độ hẹp hơn PAR nhằm dự phòng cho các dao động tự nhiên của thiết bị."
                />
                <GlossaryTermCard
                  term="Overall Desirability (D)"
                  vietnamese="Độ thỏa dụng tổng thể"
                  tag="Tối Ưu Đa Mục Tiêu"
                  tagColor="primary"
                  definition={
                    <>
                      Trung bình nhân hình học có trọng số của toàn bộ các hàm thỏa dụng thành phần <InlineMath math="D = [\prod (d_i)^{w_i}]^{1/\sum w_i}" /> (thang từ 0 đến 1). Nếu có bất kỳ CQA nào vi phạm tiêu chuẩn kỹ thuật (<InlineMath math="d_i = 0" />) thì <InlineMath math="D = 0" /> ngay lập tức.
                    </>
                  }
                />
                <GlossaryTermCard
                  term="Monte Carlo Simulation"
                  vietnamese="Mô phỏng Monte Carlo"
                  tag="Mô Phỏng Độ Bền"
                  tagColor="purple"
                  definition="Kỹ thuật mô phỏng số ngẫu nhiên lặp lại hàng nghìn lần (ví dụ: 10.000 lô ảo) có tính đến độ trôi dạt ngẫu nhiên thực tế của thiết bị và môi trường (RSD%) để ước lượng xác suất rủi ro lỗi lô và kiểm tra độ bền vững (robustness) của quy trình."
                />
                <GlossaryTermCard
                  term="Process Capability (Cpk)"
                  vietnamese="Chỉ số năng lực quy trình"
                  tag="Năng Lực Quy Trình"
                  tagColor="teal"
                  definition={
                    <>
                      Thước đo khoảng cách giữa giá trị trung bình quy trình và biên tiêu chuẩn kỹ thuật gần nhất theo đơn vị 3 độ lệch chuẩn: <InlineMath math="C_{pk} = \min\left(\frac{\text{USL}-\mu}{3\sigma}, \frac{\mu-\text{LSL}}{3\sigma}\right)" />. Chỉ số <InlineMath math="C_{pk} \ge 1.33" /> tương đương quy trình đạt mức kiểm soát 4-sigma ổn định.
                    </>
                  }
                />
                <GlossaryTermCard
                  term="PPM (Parts Per Million)"
                  vietnamese="Tỷ lệ lỗi phần triệu"
                  tag="Chỉ Số Khuyết Tật"
                  tagColor="danger"
                  definition="Số lượng lô hoặc sản phẩm dự báo vượt ngoài giới hạn tiêu chuẩn chất lượng trên một triệu đơn vị sản xuất, ước tính từ kết quả mô phỏng ngẫu nhiên Monte Carlo."
                />
              </div>
            ),
          },
        ];

      case 'report':
        return [
          {
            id: 'workflow',
            title: 'Quy Trình Xuất Báo Cáo & Phê Duyệt GxP (Workflow)',
            icon: FileCheck2,
            content: (
              <div>
                <p style={{ marginBottom: '0.6rem' }}>
                  Tổng hợp toàn diện dữ liệu từ QTPP, FMEA, thiết kế DoE (bao gồm DSD/Mixture), mô hình hóa (Đa thức OLS/Mạng Nơ-ron AI), tối ưu hóa Desirability đa mục tiêu, Không gian Thiết kế 3D và mô phỏng độ bền Monte Carlo thành <strong>Hồ Sơ Phát Triển Dược Phẩm</strong> chuẩn hóa tham khảo theo cấu trúc ICH M4Q / CTD Module 3.2.P.2.
                </p>
                <div style={{ backgroundColor: '#f0fdf4', padding: '0.65rem 0.85rem', borderRadius: '0.4rem', border: '1px solid #bbf7d0', fontSize: '0.78rem', color: '#166534', lineHeight: 1.6 }}>
                  <strong>Thứ tự thao tác chuẩn (Standard Operating Procedure):</strong>
                  <br />1. <strong>Kiểm tra Cổng Sẵn Sàng Khoa Học (Scientific Readiness Gate):</strong> Xác nhận hệ thống đã thỏa mãn 4 điều kiện cốt lõi (dữ liệu thực nghiệm đầy đủ, mô hình hợp lệ, điểm tối ưu Desirability &gt; 0, và hoàn thành mô phỏng Monte Carlo).
                  <br />2. <strong>Chọn công cụ mô hình hóa nguồn:</strong> Bấm nút <em>"Đa Thức (ANOVA)"</em> hoặc <em>"Mạng Nơ-ron AI"</em> để chỉ định tập mô hình sẽ đưa vào bảng biểu và kết luận của báo cáo.
                  <br />3. <strong>Rà soát trực quan 10 chương mục tài liệu:</strong> Sử dụng Mục lục thông minh bên trái để đối chiếu dữ liệu QTPP, CQAs, DoE, phân tích ANOVA/ANN, PAR/NOR và Chiến lược kiểm soát ICH Q10.
                  <br />4. <strong>Thực hiện Ký Duyệt Điện Tử 3 Cấp (21 CFR Part 11 Sign-off):</strong> Ký theo phân quyền nghiêm ngặt <em>Analyst (Tác giả)</em> &rarr; <em>Reviewer (Thẩm định kỹ thuật)</em> &rarr; <em>Approver (Phê duyệt pháp lý)</em>. Sau khi Approver ký, hồ sơ được khóa mật mã học (Cryptographic Record Lock).
                  <br />5. <strong>Xuất báo cáo lưu trữ pháp lý:</strong>
                  <ul style={{ paddingLeft: '1.2rem', margin: '0.2rem 0' }}>
                    <li>Bấm nút <strong>"Xuất PDF/A Pháp Lý (ISO 19005)"</strong> để tạo file PDF/A-1b đạt chuẩn nộp hồ sơ eCTD cho US FDA/EMA với mã băm SHA-256 nhúng trong siêu dữ liệu XMP.</li>
                    <li>Bấm nút <strong>"Tải Bản Thảo Word (.docx)"</strong> để xuất tài liệu Word giàu định dạng phục vụ trao đổi và rà soát nội bộ.</li>
                    <li>Bấm nút <strong>"In / Xuất PDF"</strong> để in trực tiếp qua hộp thoại in của trình duyệt.</li>
                  </ul>
                </div>
              </div>
            ),
          },
          {
            id: 'inputs',
            title: 'Chi Tiết Bảng Thao Tác, Banner Kiểm Toán & 10 Chương Mục CTD',
            icon: Sliders,
            content: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', fontSize: '0.78rem' }}>
                <div style={{ backgroundColor: '#f8fafc', padding: '0.6rem', borderRadius: '0.375rem', border: '1px solid #e2e8f0' }}>
                  <strong style={{ color: '#1e3a8a' }}>1. Khung Nút Thao Tác Đầu Trang (Action Toolbar):</strong>
                  <ul style={{ paddingLeft: '1.2rem', marginTop: '0.3rem', color: '#334155', lineHeight: 1.5 }}>
                    <li><strong>Đa Thức (ANOVA):</strong> Chuyển nguồn dữ liệu báo cáo sang mô hình hồi quy OLS bậc hai cổ điển, bảng phân tích ANOVA, hệ số hồi quy và đồ thị tương tác.</li>
                    <li><strong>Mạng Nơ-ron AI:</strong> Chuyển nguồn dữ liệu báo cáo sang mô hình học sâu nhân tạo (ANN MLP), kiến trúc topo nơ-ron, ma trận trọng số và phân tích tầm quan trọng biến XAI.</li>
                    <li><strong>Xuất PDF/A Pháp Lý (ISO 19005):</strong> Tạo tệp tài liệu số theo tiêu chuẩn quốc tế ISO 19005-1:2005 (PDF/A-1b), tự động nhúng toàn bộ bảng chữ ký điện tử 21 CFR Part 11, chuỗi kiểm toán bất biến và mã băm SHA-256 Root Checksum.</li>
                    <li><strong>Tải Bản Thảo Word (.docx):</strong> Xuất tài liệu Microsoft Word hoàn chỉnh chứa đầy đủ các bảng chỉ tiêu, công thức toán học KaTeX, cấu trúc QTPP, FMEA và chiến lược kiểm soát.</li>
                    <li><strong>In / Xuất PDF:</strong> Mở hộp thoại in ấn tiêu chuẩn của trình duyệt để in ra giấy hoặc lưu bản in nhanh.</li>
                  </ul>
                </div>

                <div style={{ backgroundColor: '#f0fdf4', padding: '0.6rem', borderRadius: '0.375rem', border: '1px solid #bbf7d0' }}>
                  <strong style={{ color: '#166534' }}>2. Banner Mã Băm Kiểm Toán Mật Mã Học (21 CFR Part 11 Root Checksum):</strong>
                  <p style={{ marginTop: '0.3rem', color: '#14532d', lineHeight: 1.5 }}>
                    Hiển thị mã băm SHA-256 (64 ký tự hex) được tính toán tự động theo thời gian thực từ toàn bộ cấu trúc dự án sau khi đã chuẩn hóa qua lược đồ RFC 8785 JCS. Kèm huy hiệu xác thực:
                  </p>
                  <ul style={{ paddingLeft: '1.2rem', marginTop: '0.2rem', color: '#14532d', lineHeight: 1.5 }}>
                    <li><strong>✓ Chuỗi Hash Bất Biến Hợp Lệ (Xanh lá):</strong> Xác nhận mọi mắt xích trong chuỗi khối lịch sử đều bảo toàn vẹn toàn bộ dữ liệu, không có bất kỳ thao tác sửa đổi ngầm nào ngoài hệ thống.</li>
                    <li><strong>⚠ Dữ Liệu Bị Can Thiệp (Đỏ):</strong> Cảnh báo cấu trúc dự án đã bị thay đổi hoặc sai lệch so với chuỗi kiểm toán, chỉ rõ mắt xích vi phạm để QA thanh tra.</li>
                  </ul>
                </div>

                <div style={{ backgroundColor: '#f8fafc', padding: '0.6rem', borderRadius: '0.375rem', border: '1px solid #e2e8f0' }}>
                  <strong style={{ color: '#0f766e' }}>3. 10 Chương Mục Chuẩn Trong Báo Cáo CTD Module 3.2.P.2:</strong>
                  <ol style={{ paddingLeft: '1.2rem', marginTop: '0.3rem', color: '#334155', lineHeight: 1.5 }}>
                    <li><strong>Thông tin Dự Án:</strong> Mã dự án, phiên bản, đơn vị nghiên cứu, tác giả, ngày tạo và tóm tắt phương pháp luận.</li>
                    <li><strong>0. Protocol &amp; Traceability:</strong> Lịch sử truy xuất nguồn gốc, mã băm payload và thông tin kiểm toán khởi thủy.</li>
                    <li><strong>1. Hồ Sơ QTPP (ICH Q8):</strong> Bảng tiêu chuẩn mục tiêu chất lượng sản phẩm thuốc (dạng bào chế, hàm lượng, độ hòa tan, độ tinh khiết...).</li>
                    <li><strong>2. Thuộc Tính CQAs &amp; Desirability:</strong> Tiêu chuẩn kỹ thuật chấp nhận, hàm thỏa dụng Derringer-Suich và trọng số ưu tiên.</li>
                    <li><strong>3. Rủi Ro Ban Đầu (FMEA - ICH Q9):</strong> Bảng ma trận rủi ro ban đầu (Severity, Occurrence, Detectability) và phân loại biến số CMA/CPP.</li>
                    <li><strong>4. Thiết Kế DoE &amp; Hiệu Suất Ma Trận:</strong> Chi tiết loại thiết kế (DSD, CCD, Box-Behnken, Mixture), số lượng runs, độ trực giao và chỉ số D-Efficiency.</li>
                    <li><strong>5. Phân Tích Mô Hình Hóa:</strong> Bảng ANOVA đa thức đầy đủ kèm kiểm định Lack-of-Fit / Kiến trúc mạng Nơ-ron AI kèm siêu tham số và chỉ số MSE, R².</li>
                    <li><strong>6. Tối Ưu Hóa &amp; Rủi Ro Cập Nhật:</strong> Điểm vận hành tối ưu toàn cục (Overall Desirability), Không gian Thiết kế 3D và đánh giá cập nhật rủi ro FMEA sau DoE.</li>
                    <li><strong>7. Chiến Lược Kiểm Soát Toàn Diện (ICH Q10):</strong> Phân loại CMA, CPP, IPC, tiêu chuẩn xuất xưởng thành phẩm, dải vận hành thường quy (NOR) và dải chứng minh chấp nhận được (PAR).</li>
                    <li><strong>8. Độ Bền Vững Quy Trình (Monte Carlo):</strong> Kết quả mô phỏng 10.000 lô ảo, độ tin cậy phần trăm (Reliability %), chỉ số năng lực quy trình Cpk và tỷ lệ lỗi PPM.</li>
                    <li><strong>9. Ký Duyệt Điện Tử &amp; Audit Trail:</strong> Bảng biểu chữ ký điện tử 3 cấp độ (Analyst, Reviewer, Approver) tuân thủ 21 CFR Part 11 và sổ cái chuỗi khối bất biến.</li>
                  </ol>
                </div>
              </div>
            ),
          },
          {
            id: 'algorithms',
            title: 'Nền Tảng Mật Mã Học, Chuỗi Hash & Chuẩn Lưu Trữ Pháp Lý',
            icon: Calculator,
            content: (
              <div style={{ fontSize: '0.78rem', color: '#334155', lineHeight: 1.6 }}>
                <p>
                  Hệ thống báo cáo tích hợp kiến trúc bảo mật cấp doanh nghiệp dược phẩm, đáp ứng nghiêm ngặt hướng dẫn US FDA 21 CFR Part 11, EU GMP Annex 11 và tiêu chuẩn lưu trữ số ISO 19005-1:
                </p>

                <div style={{ backgroundColor: '#f1f5f9', padding: '0.6rem', borderRadius: '0.375rem', marginTop: '0.5rem', border: '1px solid #cbd5e1' }}>
                  <strong style={{ color: '#1e3a8a' }}>1. Thuật Toán Băm Mật Mã Học FIPS 180-4 SHA-256:</strong>
                  <p style={{ marginTop: '0.2rem' }}>
                    Sử dụng hàm băm mật mã học tiêu chuẩn liên bang Hoa Kỳ (Federal Information Processing Standard) <strong>SHA-256</strong> với độ dài khóa 256-bit, tạo ra chuỗi định danh 64 ký tự thập lục phân (hexadecimal). Thuật toán có tính chất một chiều (one-way function) và khả năng chống va chạm (collision resistance) tuyệt đối, đảm bảo không thể tái lập hay giả mạo dữ liệu.
                  </p>
                </div>

                <div style={{ backgroundColor: '#f1f5f9', padding: '0.6rem', borderRadius: '0.375rem', marginTop: '0.5rem', border: '1px solid #cbd5e1' }}>
                  <strong style={{ color: '#0f766e' }}>2. Lược Đồ Chuẩn Hóa Dữ Liệu RFC 8785 (JSON Canonicalization Scheme - JCS):</strong>
                  <p style={{ marginTop: '0.2rem' }}>
                    Để tính mã băm nhất quán trên các môi trường máy tính khác nhau (trình duyệt, web worker, máy chủ), dữ liệu JSON trước khi băm bắt buộc phải qua bước Canonicalization theo tiêu chuẩn <strong>RFC 8785</strong>:
                  </p>
                  <ul style={{ paddingLeft: '1.2rem', marginTop: '0.2rem' }}>
                    <li>Sắp xếp toàn bộ các khóa (keys) theo thứ tự bảng mã Unicode từ điển (lexicographical sorting).</li>
                    <li>Chuẩn hóa định dạng số thực theo IEEE 754, loại bỏ các khoảng trắng và thụt dòng dư thừa.</li>
                    <li>Loại trừ các thuộc tính biến động tạm thời (như trạng thái khóa, trọng số nơ-ron tạm thời) để triệt tiêu hiện tượng phụ thuộc vòng (circular dependency).</li>
                  </ul>
                </div>

                <div style={{ backgroundColor: '#f1f5f9', padding: '0.6rem', borderRadius: '0.375rem', marginTop: '0.5rem', border: '1px solid #cbd5e1' }}>
                  <strong style={{ color: '#15803d' }}>3. Mô Hình Chuỗi Khối Kiểm Toán Bất Biến (Tamper-Evident Hash Chain):</strong>
                  <p style={{ marginTop: '0.2rem' }}>
                    Mỗi hành động thay đổi dữ liệu hoặc lưu snapshot được ghi lại thành một mắt xích (block) liên kết chặt chẽ với mắt xích trước đó qua công thức:
                  </p>
                  <div style={{ margin: '0.4rem 0' }}>
                    <BlockMath math="\text{EntryHash}_n = \text{SHA256}\Big(\text{JCS}\big(\text{Block}_n \,||\, \text{EntryHash}_{n-1}\big)\Big)" />
                    <BlockMath math="\text{PayloadHash}_n = \text{SHA256}\Big(\text{JCS}\big(\text{ProjectPayload}_n\big)\Big)" />
                  </div>
                  <p>
                    Mắt xích đầu tiên (Genesis Block) có <InlineMath math="\text{EntryHash}_0 = 00000000\dots0000" /> (64 số 0). Khi kiểm toán viên hoặc hệ thống kiểm tra tính toàn vẹn (Integrity Check), thuật toán sẽ duyệt từ mắt xích 1 đến mắt xích <InlineMath math="N" />. Nếu bất kỳ byte dữ liệu nào trong quá khứ bị chỉnh sửa trái phép, mã băm tại mắt xích đó sẽ sai khác ngay lập tức, làm đứt gãy chuỗi và chỉ đích danh chỉ số vi phạm (<InlineMath math="\text{tamperedIndex}" />).
                  </p>
                </div>

                <div style={{ backgroundColor: '#f1f5f9', padding: '0.6rem', borderRadius: '0.375rem', marginTop: '0.5rem', border: '1px solid #cbd5e1' }}>
                  <strong style={{ color: '#7c3aed' }}>4. Quy Chuẩn Ký Duyệt Điện Tử 3 Cấp &amp; Khóa Bản Ghi (21 CFR Part 11):</strong>
                  <p style={{ marginTop: '0.2rem' }}>
                    Mỗi chữ ký điện tử tạo ra một bản ghi mật mã học không thể phủ nhận (non-repudiation) với mã băm chữ ký:
                  </p>
                  <div style={{ margin: '0.4rem 0' }}>
                    <BlockMath math="\text{SignatureChecksum} = \text{SHA256}\Big(\text{JCS}\big(\{\text{Signer}, \text{Role}, \text{Timestamp}, \text{Reason}, \text{PayloadHash}\}\big)\Big)" />
                  </div>
                  <ul style={{ paddingLeft: '1.2rem', marginTop: '0.2rem' }}>
                    <li><strong>Cấp 1 - Analyst (Authorship):</strong> Xác nhận thiết kế DoE, số liệu thực nghiệm và xây dựng mô hình.</li>
                    <li><strong>Cấp 2 - Reviewer (Technical Review):</strong> Thẩm định phương pháp thống kê ANOVA/ANN, dư sai và tính phù hợp.</li>
                    <li><strong>Cấp 3 - Approver (Regulatory Approval):</strong> Phê chuẩn chính thức Design Space, PAR/NOR và Chiến lược kiểm soát. Khi hoàn thành cấp 3, dự án được chuyển sang chế độ <strong>Khóa Bản Ghi Bất Biến (Cryptographic Record Lock)</strong>. Mọi chỉnh sửa tiếp theo bắt buộc phải qua quy trình mở khóa có giải trình (QA Justification).</li>
                  </ul>
                </div>

                <div style={{ backgroundColor: '#f1f5f9', padding: '0.6rem', borderRadius: '0.375rem', marginTop: '0.5rem', border: '1px solid #cbd5e1' }}>
                  <strong style={{ color: '#b45309' }}>5. Tiêu Chuẩn Lưu Trữ Tài Liệu Pháp Lý ISO 19005-1 (PDF/A-1b):</strong>
                  <p style={{ marginTop: '0.2rem' }}>
                    Định dạng PDF/A-1b là chuẩn bắt buộc cho lưu trữ điện tử dài hạn và nộp hồ sơ eCTD cho US FDA và EMA:
                  </p>
                  <ul style={{ paddingLeft: '1.2rem', marginTop: '0.2rem' }}>
                    <li>Tự chứa hoàn toàn (Self-contained): Nhúng trực tiếp font chữ và từ điển màu chuẩn DeviceRGB Color Intent.</li>
                    <li>Nhúng luồng siêu dữ liệu XMP Metadata (Extensible Metadata Platform) chuẩn hóa với lược đồ PDF/A Extension Schema, lưu trữ vĩnh viễn mã băm gốc <code style={{ fontSize: '0.72rem' }}>urn:sha256:rootChecksum</code>.</li>
                    <li>Nghiêm cấm các đoạn mã JavaScript động, tập tin âm thanh/video hoặc mã thực thi không an toàn nhằm đảm bảo tài liệu hiển thị đồng nhất qua hàng thập kỷ.</li>
                  </ul>
                </div>

                <div style={{ backgroundColor: '#f1f5f9', padding: '0.6rem', borderRadius: '0.375rem', marginTop: '0.5rem', border: '1px solid #cbd5e1' }}>
                  <strong style={{ color: '#1e3a8a' }}>6. Cổng Sẵn Sàng Khoa Học (Scientific Readiness Gate):</strong>
                  <p style={{ marginTop: '0.2rem' }}>
                    Nút xuất báo cáo PDF/A và Word được kiểm soát nghiêm ngặt bởi 4 điều kiện kỹ thuật tự động:
                  </p>
                  <ul style={{ paddingLeft: '1.2rem', marginTop: '0.2rem' }}>
                    <li>✓ Có đủ số liệu thực nghiệm cho tất cả các CQA trong bảng DoE Runs.</li>
                    <li>✓ Tất cả CQA đều đã được xây dựng mô hình toán học hợp lệ (đầy đủ bậc tự do, không bị lỗi tính toán).</li>
                    <li>✓ Đã thực hiện tối ưu hóa Desirability và tìm ra nghiệm thỏa dụng toàn cục khả thi (<InlineMath math="D &gt; 0" />).</li>
                    <li>✓ Đã hoàn thành phân tích mô phỏng Monte Carlo đánh giá độ bền vững và chỉ số Cpk quy trình.</li>
                  </ul>
                </div>
              </div>
            ),
          },
          {
            id: 'tips',
            title: 'Thực Hành Tốt Quản Trị GxP, Mở Khóa & Audit Trail (Tips & Best Practices)',
            icon: Lightbulb,
            content: (
              <ul style={{ paddingLeft: '1.2rem', fontSize: '0.78rem', color: '#334155', lineHeight: 1.6 }}>
                <li><strong>Trình tự ký duyệt chuẩn mực:</strong> Luôn tuân thủ tuần tự ký từ Analyst &rarr; Reviewer &rarr; Approver. Việc ký đúng phân quyền bảo đảm hồ sơ sẵn sàng cho mọi cuộc thanh tra từ Cục Quản lý Dược (DAV), US FDA hoặc EMA.</li>
                <li><strong>Cơ chế mở khóa có giải trình (QA Unlock Justification):</strong> Sau khi Approver đã ký phê duyệt và khóa bản ghi, nếu phát sinh nhu cầu sửa đổi tham số nghiên cứu, hệ thống yêu cầu chuyên gia QA nhập lý do giải trình. Thao tác mở khóa này sẽ tự động ghi một mắt xích mới vào Audit Trail và hủy bỏ trạng thái phê chuẩn trước đó, yêu cầu quy trình ký duyệt lại từ đầu.</li>
                <li><strong>Lưu giữ &amp; Đối chiếu Root Checksum:</strong> Hãy ghi lại chuỗi 64 ký tự SHA-256 Root Checksum vào sổ tay lô hoặc biên bản thẩm định. Bất kỳ sự thay đổi nào đối với file JSON dự án đều có thể phát hiện ngay lập tức bằng cách so sánh mã băm này.</li>
                <li><strong>Phối hợp PDF/A và Word (.docx):</strong> Sử dụng tệp PDF/A-1b làm tài liệu pháp lý lưu trữ vĩnh viễn và đính kèm hồ sơ kỹ thuật; sử dụng tệp Word (.docx) làm tài liệu làm việc linh hoạt trong các buổi bảo vệ hội đồng hoặc bổ sung phụ lục thực nghiệm.</li>
                <li><strong>Sao lưu định kỳ (JSON Snapshots):</strong> Luôn bấm nút <em>"Lưu"</em> trên thanh điều hướng để tải file JSON về máy tính và lưu trữ vào hệ thống quản lý tài liệu điện tử (EDMS) có phân quyền của viện nghiên cứu / nhà máy.</li>
              </ul>
            ),
          },
          {
            id: 'glossary',
            title: 'Giải Thích Thuật Ngữ (Glossary & Terminology)',
            icon: BookOpen,
            keywords: [
              'PDF/A',
              'ISO 19005',
              '21 CFR Part 11',
              'Electronic Signature',
              'SHA-256',
              'Hash Chain',
              'RFC 8785',
              'JCS',
              'CTD',
              '3.2.P.2',
              'Control Strategy',
              'Readiness Gate',
              'ALCOA',
              'Data Integrity',
              'Audit Trail',
              'Governance',
              'Record Lock',
            ],
            content: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
                <GlossaryTermCard
                  term="PDF/A (ISO 19005-1:2005 PDF/A-1b)"
                  vietnamese="Định dạng tài liệu lưu trữ điện tử pháp lý"
                  tag="Chuẩn Lưu Trữ Quốc Tế"
                  tagColor="primary"
                  definition="Tiêu chuẩn ISO chuyên biệt dành cho việc bảo tồn và lưu trữ hồ sơ điện tử dài hạn độc lập với thiết bị. PDF/A-1b bắt buộc nhúng font chữ, từ điển màu sắc DeviceRGB và siêu dữ liệu XMP, đồng thời loại trừ triệt để mã lệnh động nhằm đảm bảo tài liệu giữ nguyên vẹn hình thức và nội dung khi mở lại sau hàng chục năm trong hồ sơ eCTD của US FDA và EMA."
                />
                <GlossaryTermCard
                  term="21 CFR Part 11 Electronic Sign-off"
                  vietnamese="Quy chuẩn chữ ký điện tử US FDA"
                  tag="Tuân Thủ Pháp Lý GxP"
                  tagColor="teal"
                  definition="Quy định của Cục Quản lý Thực phẩm và Dược phẩm Hoa Kỳ về hồ sơ điện tử và chữ ký điện tử. Quy định rằng chữ ký số có giá trị pháp lý tương đương chữ ký tay khi đáp ứng đủ các yếu tố: danh tính người ký, vai trò (Analyst, Reviewer, Approver), tem thời gian chính xác, lý do ký và liên kết mật mã học không thể tách rời với nội dung dự án."
                />
                <GlossaryTermCard
                  term="Tamper-Evident SHA-256 Hash Chain"
                  vietnamese="Chuỗi khối băm kiểm toán bất biến"
                  tag="Mật Mã Học FIPS 180-4"
                  tagColor="purple"
                  definition="Cấu trúc dữ liệu chuỗi khối an toàn mật mã học, trong đó mỗi thao tác hoặc snapshot kế thừa mã băm của mắt xích liền trước. Mọi nỗ lực can thiệp hoặc sửa đổi dữ liệu dù chỉ 1 ký tự sẽ làm thay đổi toàn bộ chuỗi hash từ mắt xích đó trở về sau, cho phép hệ thống lập tức phát hiện sự xâm phạm và định vị chính xác vị trí bị can thiệp."
                />
                <GlossaryTermCard
                  term="RFC 8785 JSON Canonicalization (JCS)"
                  vietnamese="Lược đồ chuẩn hóa JSON tất định"
                  tag="Chuẩn Hóa Dữ Liệu"
                  tagColor="slate"
                  definition="Tiêu chuẩn quốc tế chuẩn hóa cấu trúc JSON (sắp xếp khóa từ điển, biểu diễn số học thống nhất) trước khi đưa vào hàm băm mật mã học. JCS bảo đảm cùng một đối tượng dự án sẽ luôn tạo ra một chuỗi byte duy nhất và mã băm SHA-256 đồng nhất 100% trên mọi trình duyệt, hệ điều hành và nền tảng runtime."
                />
                <GlossaryTermCard
                  term="Cryptographic Record Lock"
                  vietnamese="Khóa bản ghi mật mã học"
                  tag="Bảo Mật Hồ Sơ"
                  tagColor="danger"
                  definition="Cơ chế bảo vệ dữ liệu tự động kích hoạt ngay sau khi hồ sơ nhận đủ chữ ký phê duyệt cấp cao nhất (Approver). Khi đã khóa, mọi thuộc tính của dự án không thể bị chỉnh sửa trực tiếp. Để tái mở quy trình nghiên cứu, bắt buộc phải có thẩm quyền QA mở khóa kèm lý do giải trình lưu vết vĩnh viễn."
                />
                <GlossaryTermCard
                  term="CTD Module 3.2.P.2"
                  vietnamese="Phát triển dược phẩm"
                  tag="Hồ Sơ Đăng Ký ICH"
                  tagColor="teal"
                  definition="Chương mục cốt lõi trong Hồ sơ kỹ thuật chung (CTD) theo chuẩn quốc tế ICH để đăng ký thuốc mới hoặc thuốc generic, mô tả toàn bộ hành trình khoa học từ định nghĩa QTPP, nhận diện CQA, đánh giá rủi ro FMEA, thiết kế DoE đến Không gian thiết kế và Chiến lược kiểm soát."
                />
                <GlossaryTermCard
                  term="Control Strategy"
                  vietnamese="Chiến lược kiểm soát toàn diện"
                  tag="ICH Q10"
                  tagColor="teal"
                  definition="Tập hợp có kế hoạch các biện pháp kiểm soát bắt nguồn từ hiểu biết toàn diện về sản phẩm và quy trình, bao gồm kiểm soát chỉ tiêu nguyên liệu (CMA), kiểm soát thông số vận hành (CPP), kiểm tra trong quá trình (IPC), dải NOR/PAR và tiêu chuẩn xuất xưởng thành phẩm."
                />
                <GlossaryTermCard
                  term="Scientific Readiness Gate"
                  vietnamese="Cổng kiểm tra tính sẵn sàng khoa học"
                  tag="Toàn Vẹn Dữ Liệu"
                  tagColor="primary"
                  definition="Cơ chế xác thực logic tích hợp trong phần mềm nhằm rà soát tự động tính đầy đủ và tính hợp lệ của dữ liệu thực nghiệm, trạng thái mô hình hóa, tối ưu hóa thỏa dụng và kết quả mô phỏng độ bền trước khi cho phép xuất bản thảo báo cáo hoàn chỉnh."
                />
                <GlossaryTermCard
                  term="ALCOA+ / Data Integrity"
                  vietnamese="Tính toàn vẹn dữ liệu dược phẩm"
                  tag="Chuẩn GxP"
                  tagColor="warning"
                  definition="Nguyên tắc quốc tế bảo đảm chất lượng dữ liệu: Attributable (Quy kết rõ ràng người thực hiện), Legible (Dễ đọc, lưu trữ bền vững), Contemporaneous (Ghi nhận đúng thời điểm), Original (Bản gốc nguyên vẹn), Accurate (Chính xác) cùng với Complete (Đầy đủ), Consistent (Nhất quán), Enduring (Bền vững) và Available (Sẵn sàng truy xuất)."
                />
                <GlossaryTermCard
                  term="Audit Trail"
                  vietnamese="Nhật ký kiểm toán / Lưu vết dữ liệu"
                  tag="Tuân Thủ GMP"
                  tagColor="slate"
                  definition="Bản ghi tự động, không thể chỉnh sửa, ghi lại có tem thời gian về mọi thao tác tạo mới, sửa đổi tham số, huấn luyện mô hình hay xuất báo cáo nhằm phục vụ công tác thanh tra, thẩm định GMP và bảo vệ tính pháp lý của hồ sơ."
                />
                <GlossaryTermCard
                  term="Project Governance"
                  vietnamese="Quản trị dự án & Snapshot"
                  tag="Quản Trị Vòng Đời"
                  tagColor="slate"
                  definition="Cơ chế quản lý vòng đời dự án cho phép lưu trữ dự án dưới dạng tệp JSON, tự động lưu (autosave) trên trình duyệt và tạo các bản chụp trạng thái (snapshots) để dễ dàng đối chiếu, phục hồi các kịch bản nghiên cứu khác nhau."
                />
              </div>
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
      const idMatch = sec.id.toLowerCase().includes(q);
      const keywordMatch = sec.keywords?.some((k) => k.toLowerCase().includes(q));
      return titleMatch || idMatch || Boolean(keywordMatch);
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
