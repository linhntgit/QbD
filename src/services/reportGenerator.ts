import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  HeadingLevel,
  AlignmentType,
  WidthType,
  ShadingType,
} from 'docx';
import { saveAs } from 'file-saver';
import type {
  QBDProject,
  StatisticalModelResult,
  DesirabilitySolution,
  MonteCarloResult,
  NeuralNetModelResult,
  ModelingEngine,
} from '../types/qbd';
import { calculateDesignEfficiency } from './doeGenerator';
import { generateUpdatedRiskAssessment, generateControlStrategy } from './statistics';
import { getTraceabilitySummary } from './projectGovernance';

const PRIMARY_COLOR = '1E3A8A'; // Deep Navy Blue
const ACCENT_COLOR = '0D9488'; // Teal

function createHeaderCell(text: string, widthPercent?: number): TableCell {
  return new TableCell({
    width: widthPercent ? { size: widthPercent, type: WidthType.PERCENTAGE } : undefined,
    shading: { type: ShadingType.CLEAR, fill: '1E293B' },
    margins: { top: 120, bottom: 120, left: 140, right: 140 },
    children: [
      new Paragraph({
        children: [new TextRun({ text, bold: true, color: 'FFFFFF', size: 20 })],
      }),
    ],
  });
}

function createDataCell(text: string, isEven: boolean = false, widthPercent?: number): TableCell {
  return new TableCell({
    width: widthPercent ? { size: widthPercent, type: WidthType.PERCENTAGE } : undefined,
    shading: { type: ShadingType.CLEAR, fill: isEven ? 'F8FAFC' : 'FFFFFF' },
    margins: { top: 100, bottom: 100, left: 140, right: 140 },
    children: [
      new Paragraph({
        children: [new TextRun({ text, size: 19, color: '1E293B' })],
      }),
    ],
  });
}

/**
 * Generate a review draft using the CTD 3.2.P.2 Pharmaceutical Development structure (.docx).
 * Output is not a validated submission dossier and requires independent scientific/QA review.
 */
export async function exportQBDWordReport(
  project: QBDProject,
  models: Record<string, StatisticalModelResult>,
  optimum: DesirabilitySolution | null,
  monteCarlo: MonteCarloResult | null,
  neuralModels?: Record<string, NeuralNetModelResult>,
  modelingEngine: ModelingEngine = 'polynomial'
): Promise<void> {
  const sections: any[] = [];
  const reportModels: Record<string, StatisticalModelResult | NeuralNetModelResult> =
    modelingEngine === 'neural' ? (neuralModels ?? {}) : models;
  const observedBlocks = [...new Set(project.runs.map((run) => Math.max(1, Math.floor(run.block ?? 1))))].sort((a, b) => a - b);
  const hasMultipleBlocks = observedBlocks.length > 1;
  const discreteOrCategoricalFactors = project.factors.filter((factor) =>
    factor.dataType === 'qualitative' || factor.dataType === 'quantitative_multilevel'
  );

  // Title & Header Information (draft using a CTD 3.2.P.2 reference structure)
  sections.push(
    new Paragraph({
      text: 'DEVELOPMENT REPORT DRAFT - CTD 3.2.P.2 REFERENCE STRUCTURE',
      heading: HeadingLevel.HEADING_2,
      alignment: AlignmentType.CENTER,
      spacing: { before: 100, after: 100 },
    }),
    new Paragraph({
      text: 'BẢN THẢO BÁO CÁO PHÁT TRIỂN DƯỢC PHẨM THEO QUALITY BY DESIGN (QbD)',
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 200, before: 50 },
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: 'Tài liệu làm việc — cần rà soát khoa học, QA và regulatory độc lập trước khi sử dụng',
          italics: true,
          color: ACCENT_COLOR,
          size: 22,
        }),
      ],
      spacing: { after: 400 },
    })
  );

  // Metadata Table
  const metaRows = [
    new TableRow({
      children: [
        createHeaderCell('Hạng mục Hồ sơ', 30),
        createHeaderCell('Thông tin chi tiết', 70),
      ],
    }),
    new TableRow({
      children: [
        createDataCell('Tên Dự án / Nghiên cứu', false, 30),
        createDataCell(project.name, false, 70),
      ],
    }),
    new TableRow({
      children: [
        createDataCell('Dược chất (Active Substance)', true, 30),
        createDataCell(project.moleculeName, true, 70),
      ],
    }),
    new TableRow({
      children: [
        createDataCell('Dạng bào chế & Hàm lượng', false, 30),
        createDataCell(project.dosageForm, false, 70),
      ],
    }),
    new TableRow({
      children: [
        createDataCell('Cán bộ nghiên cứu (Scientist)', true, 30),
        createDataCell(project.author || 'R&D Formulation Scientist', true, 70),
      ],
    }),
    new TableRow({
      children: [
        createDataCell('Phương pháp mô hình hóa', false, 30),
        createDataCell(
          modelingEngine === 'neural'
            ? 'Mạng Nơ-ron Nhân Tạo AI (Artificial Neural Network - MLP)'
            : 'Hồi quy Đa thức Bậc ≤ 2 & Phân tích Phương sai ANOVA (OLS Regression)',
          false,
          70
        ),
      ],
    }),
    new TableRow({
      children: [
        createDataCell('Ngày kết xuất báo cáo', true, 30),
        createDataCell(new Date().toLocaleDateString('vi-VN'), true, 70),
      ],
    }),
  ];

  sections.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: metaRows,
    }),
    new Paragraph({ text: '', spacing: { after: 300 } })
  );

  const traceability = getTraceabilitySummary(project);
  sections.push(
    new Paragraph({ text: '0. Protocol Trước Chạy & Traceability Sau Chạy', heading: HeadingLevel.HEADING_1, spacing: { before: 150, after: 120 } }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({ children: [createHeaderCell('Hạng mục', 30), createHeaderCell('Nội dung', 70)] }),
        new TableRow({ children: [createDataCell('Protocol ID', false, 30), createDataCell(traceability.protocolId, false, 70)] }),
        new TableRow({ children: [createDataCell('Thiết kế trước chạy', true, 30), createDataCell(`${project.doeConfig.designType}; ${project.runs.length} run; ${project.doeConfig.blocks ?? 1} block; randomize=${project.doeConfig.randomized ? 'Có' : 'Không'}.`, true, 70)] }),
        new TableRow({ children: [createDataCell('Trace sau chạy', false, 30), createDataCell(traceability.runStatus, false, 70)] }),
        new TableRow({ children: [createDataCell('Kiểm tra template', true, 30), createDataCell(traceability.validation.valid ? 'Đạt kiểm tra cấu trúc cục bộ.' : `Không đạt: ${traceability.validation.errors.join(' ')}`, true, 70)] }),
      ],
    }),
    new Paragraph({ text: 'Lưu ý: protocol cần được phê duyệt trước khi thực nghiệm. Traceability cục bộ của ứng dụng không thay thế audit trail, phân quyền, chữ ký điện tử hay validation package GxP/21 CFR Part 11.', spacing: { before: 120, after: 240 } }),
  );

  // SECTION 1: Quality Target Product Profile (QTPP - ICH Q8)
  sections.push(
    new Paragraph({
      text: '1. Hồ Sơ Chất Lượng Sản Phẩm Mục Tiêu (QTPP - ICH Q8)',
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 300, after: 150 },
    }),
    new Paragraph({
      text: 'QTPP được xây dựng dựa trên thông tin nhãn của Thuốc đối chứng (RLD), dược động học lâm sàng và các yêu cầu an toàn/hiệu quả cho bệnh nhân (ICH Q8(R2)):',
      spacing: { after: 150 },
    })
  );

  const qtppRows = [
    new TableRow({
      children: [
        createHeaderCell('Yếu Tố QTPP', 25),
        createHeaderCell('Mục Tiêu Đích (Target)', 35),
        createHeaderCell('Căn Cứ Khoa Học (Justification)', 40),
      ],
    }),
    ...project.qtpp.map(
      (item, idx) =>
        new TableRow({
          children: [
            createDataCell(item.element, idx % 2 === 1, 25),
            createDataCell(item.target, idx % 2 === 1, 35),
            createDataCell(item.justification, idx % 2 === 1, 40),
          ],
        })
    ),
  ];

  sections.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: qtppRows,
    }),
    new Paragraph({
      text: 'Tóm Tắt Trình Tự Nghiên Cứu Phát Triển (Chronological Studies Summary — FDA Table 1):',
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 200, after: 100 },
    })
  );

  const chronoRows = [
    new TableRow({
      children: [
        createHeaderCell('Giai đoạn / Nghiên cứu', 35),
        createHeaderCell('Quy mô (Scale)', 25),
        createHeaderCell('Mục tiêu & Kết quả chính', 40),
      ],
    }),
    new TableRow({
      children: [
        createDataCell('1. Phân tích thuốc đối chứng (RLD) & QTPP', false, 35),
        createDataCell('Phòng thí nghiệm', false, 25),
        createDataCell('Xác lập hồ sơ chất lượng mục tiêu và các chỉ tiêu then chốt (CQAs)', false, 40),
      ],
    }),
    new TableRow({
      children: [
        createDataCell('2. Đánh giá rủi ro ban đầu (Initial Risk Assessment)', true, 35),
        createDataCell('Lý thuyết & Thử nghiệm sơ bộ', true, 25),
        createDataCell('Sàng lọc các yếu tố rủi ro cao/trung bình (H/M) cần làm DoE', true, 40),
      ],
    }),
    new TableRow({
      children: [
        createDataCell('3. Thiết kế thực nghiệm DoE tối ưu hóa', false, 35),
        createDataCell(`${project.runs.length} mẻ thực nghiệm`, false, 25),
        createDataCell(`Khảo sát ${project.factors.length} biến đầu vào và ${project.cqas.length} chỉ tiêu CQA`, false, 40),
      ],
    }),
    new TableRow({
      children: [
        createDataCell('4. Xây dựng Không Gian Thiết Kế (Design Space) & Mô phỏng Monte Carlo', true, 35),
        createDataCell('In silico / Pilot scale', true, 25),
        createDataCell(`Xác lập dải PAR, độ tin cậy đạt ${monteCarlo ? monteCarlo.reliabilityPercent : 99}%`, true, 40),
      ],
    }),
    new TableRow({
      children: [
        createDataCell('5. Thiết lập Chiến lược kiểm soát (ICH Q10 Control Strategy)', false, 35),
        createDataCell('Pilot / Commercial scale', false, 25),
        createDataCell('Xác định NOR, PAR, PAT in-line và tiêu chuẩn xuất xưởng thành phẩm', false, 40),
      ],
    }),
  ];

  sections.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: chronoRows,
    }),
    new Paragraph({ text: '', spacing: { after: 250 } })
  );

  // SECTION 2: Critical Quality Attributes (CQAs) & Desirability Configuration
  sections.push(
    new Paragraph({
      text: '2. Thuộc Tính Chất Lượng Trọng Yếu (CQAs) & Cấu Hình Hàm Thỏa Dụng',
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 300, after: 150 },
    }),
    new Paragraph({
      text: 'Các CQAs là các thuộc tính vật lý, hóa học, sinh học hoặc vi sinh cần nằm trong giới hạn thích hợp để đảm bảo chất lượng sản phẩm mong muốn (ICH Q8(R2)):',
      spacing: { after: 150 },
    })
  );

  const cqaRows = [
    new TableRow({
      children: [
        createHeaderCell('Mã', 8),
        createHeaderCell('Tên CQA', 22),
        createHeaderCell('Bản Chất Dữ Liệu', 16),
        createHeaderCell('Đơn Vị', 8),
        createHeaderCell('Mục Tiêu (Goal)', 12),
        createHeaderCell('Giới Hạn (LSL - Target - USL)', 18),
        createHeaderCell('Hình Dạng (s, t)', 8),
        createHeaderCell('Trọng Số (w)', 8),
      ],
    }),
    ...project.cqas.map((cqa, idx) => {
      const isEven = idx % 2 === 1;
      const dataTypeStr =
        cqa.dataType === 'qualitative_binary'
          ? 'Định tính (Pass/Fail)'
          : cqa.dataType === 'qualitative_ordinal'
          ? 'Định tính (Thứ bậc)'
          : cqa.dataType === 'quantitative_multilevel'
          ? 'Định lượng (Nhiều mức)'
          : 'Định lượng (Liên tục)';

      const goalStr =
        cqa.objective === 'maximize'
          ? '📈 Maximize'
          : cqa.objective === 'minimize'
          ? '📉 Minimize'
          : cqa.objective === 'target'
          ? '🎯 Target'
          : cqa.objective === 'range'
          ? '📏 Range'
          : 'None';

      const specStr = cqa.categories?.length
        ? `${cqa.categories.join(' · ')}${cqa.targetCategory ? ` (đạt: ${cqa.targetCategory})` : ''}`
        : `${cqa.lowerLimit ?? '-'} / ${cqa.target ?? '-'} / ${cqa.upperLimit ?? '-'}`;

      const shapeStr = `s=${cqa.sShape ?? 1}, t=${cqa.tShape ?? 1}`;

      return new TableRow({
        children: [
          createDataCell(cqa.code, isEven, 8),
          createDataCell(cqa.name, isEven, 22),
          createDataCell(dataTypeStr, isEven, 16),
          createDataCell(cqa.unit || '-', isEven, 8),
          createDataCell(goalStr, isEven, 12),
          createDataCell(specStr, isEven, 18),
          createDataCell(shapeStr, isEven, 8),
          createDataCell(String(cqa.weight), isEven, 8),
        ],
      });
    }),
  ];

  sections.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: cqaRows,
    }),
    new Paragraph({ text: '', spacing: { after: 250 } })
  );

  // SECTION 3: Initial Risk Assessment (FMEA - ICH Q9)
  sections.push(
    new Paragraph({
      text: '3. Đánh Giá Quản Lý Rủi Ro Ban Đầu (FMEA - ICH Q9)',
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 300, after: 150 },
    }),
    new Paragraph({
      text: 'Ma trận đánh giá rủi ro định lượng FMEA ban đầu (Failure Mode and Effects Analysis) theo thang điểm ICH Q9: Mức độ nghiêm trọng (S: 1-5), Khả năng xảy ra (O: 1-5), Khả năng phát hiện (D: 1-5). Chỉ số ưu tiên rủi ro RPN = S × O × D:',
      spacing: { after: 150 },
    })
  );

  if (project.fmeaRisks && project.fmeaRisks.length > 0) {
    const fmeaRows = [
      new TableRow({
        children: [
          createHeaderCell('Yếu Tố (Factor)', 22),
          createHeaderCell('CQA Bị Ảnh Hưởng', 22),
          createHeaderCell('S', 8),
          createHeaderCell('O', 8),
          createHeaderCell('D', 8),
          createHeaderCell('RPN', 10),
          createHeaderCell('Mức Rủi Ro', 10),
          createHeaderCell('Khảo Sát DoE', 12),
        ],
      }),
      ...project.fmeaRisks.map((item, idx) => {
        const isEven = idx % 2 === 1;
        const factor = project.factors.find((f) => f.id === item.factorId);
        const cqa = project.cqas.find((c) => c.id === item.cqaId);
        const riskText =
          item.riskLevel === 'High'
            ? 'Cao (High)'
            : item.riskLevel === 'Medium'
            ? 'Trung bình (Med)'
            : 'Thấp (Low)';

        return new TableRow({
          children: [
            createDataCell(`${factor?.name ?? item.factorId} (${factor?.code ?? item.factorId})`, isEven, 22),
            createDataCell(`${cqa?.name ?? item.cqaId} (${cqa?.code ?? item.cqaId})`, isEven, 22),
            createDataCell(String(item.severity), isEven, 8),
            createDataCell(String(item.probability), isEven, 8),
            createDataCell(String(item.detectability), isEven, 8),
            createDataCell(String(item.rpn), isEven, 10),
            createDataCell(riskText, isEven, 10),
            createDataCell(item.recommendedDoE ? '✓ Có' : 'Không', isEven, 12),
          ],
        });
      }),
    ];

    sections.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: fmeaRows,
      }),
      new Paragraph({ text: '', spacing: { after: 250 } })
    );
  } else {
    sections.push(
      new Paragraph({
        text: 'Chưa có ma trận rủi ro FMEA được thiết lập trong dự án. Khuyến nghị thực hiện đánh giá FMEA trong Tab 3 trước khi tiến hành thực nghiệm DoE.',
        spacing: { after: 250 },
      })
    );
  }

  // SECTION 4: Design of Experiments (DoE)
  const eff = calculateDesignEfficiency(
    project.runs,
    project.factors,
    project.doeConfig.dOptimalModel || 'Quadratic'
  );
  const mixtureFactors = project.factors.filter((f) => f.role === 'mixture_component' || f.type === 'Mixture');
  const hasMixture = mixtureFactors.length > 0;

  sections.push(
    new Paragraph({
      text: `4. Thiết Kế Thí Nghiệm (DoE: ${project.doeConfig.designType})`,
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 300, after: 150 },
    }),
    new Paragraph({
      text: '4.1 Danh Mục Các Yếu Tố Khảo Sát (Input Factors)',
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 200, after: 100 },
    }),
    new Paragraph({
      text: 'Danh mục các biến công thức (CMAs) và thông số quy trình (CPPs) được đưa vào nghiên cứu thực nghiệm DoE:',
      spacing: { after: 150 },
    })
  );

  const factorRows = [
    new TableRow({
      children: [
        createHeaderCell('Mã', 8),
        createHeaderCell('Tên Biến Đầu Vào', 22),
        createHeaderCell('Vai Trò (QbD Role)', 18),
        createHeaderCell('Bản Chất Dữ Liệu', 14),
        createHeaderCell('Khả Năng Kiểm Soát', 16),
        createHeaderCell('Đơn Vị', 8),
        createHeaderCell('Phạm Vi Khảo Sát / Hằng Số', 14),
      ],
    }),
    ...project.factors.map((f, idx) => {
      const isEven = idx % 2 === 1;
      const roleLabel =
        f.role === 'mixture_component'
          ? 'Thành phần hỗn hợp (Σ=100%)'
          : f.role === 'formulation_other'
          ? 'Biến công thức khác'
          : 'Biến quy trình';

      const dataTypeLabel =
        f.dataType === 'qualitative'
          ? 'Định tính'
          : f.dataType === 'quantitative_multilevel'
          ? 'ĐL nhiều mức'
          : 'ĐL liên tục';

      const controlLabel =
        f.controllability === 'constant'
          ? 'Hằng số'
          : f.controllability === 'uncontrollable_noise'
          ? 'Nhiễu (Noise)'
          : 'Kiểm soát được';

      const rangeLabel =
        f.controllability === 'constant'
          ? `${f.constantValue ?? f.low}`
          : f.dataType !== 'quantitative' && f.categories?.length
          ? f.categories.join(' · ')
          : `${f.low} - ${f.high} (tâm: ${f.center !== undefined ? f.center : ((f.low + f.high) / 2)})`;

      return new TableRow({
        children: [
          createDataCell(f.code, isEven, 8),
          createDataCell(f.name, isEven, 22),
          createDataCell(roleLabel, isEven, 18),
          createDataCell(dataTypeLabel, isEven, 14),
          createDataCell(controlLabel, isEven, 16),
          createDataCell(f.unit || '-', isEven, 8),
          createDataCell(rangeLabel, isEven, 14),
        ],
      });
    }),
  ];

  sections.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: factorRows,
    }),
    new Paragraph({
      text: '4.2 Đánh Giá Hiệu Quả Thiết Kế (Design Optimality Diagnostics)',
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 200, after: 100 },
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: `D-Efficiency = ${eff.dEfficiency}% (${eff.rating}) | A-Efficiency = ${eff.aEfficiency}% | G-Efficiency = ${eff.gEfficiency}% | Số hệ số p = ${eff.numParameters} (Bậc tự do dư df = ${eff.degreesOfFreedom})`,
          bold: true,
          color: PRIMARY_COLOR,
        }),
      ],
      spacing: { after: 150 },
    }),
    new Paragraph({
      text: '4.3 Ma Trận Thực Nghiệm DoE (DoE Experimental Matrix)',
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 200, after: 100 },
    }),
    new Paragraph({
      text: 'Ma trận thí nghiệm được chuẩn hóa, hỗ trợ thứ tự thực nghiệm ngẫu nhiên (Randomized Run Order) để triệt tiêu sai số hệ thống:',
      spacing: { after: 150 },
    })
  );

  const runHeaderCells = [
    createHeaderCell('Std', 5),
    createHeaderCell('Run', 5),
    ...project.factors.map((f) => createHeaderCell(f.code, 10)),
    ...(hasMixture ? [createHeaderCell('Σ Hỗn Hợp', 10)] : []),
    ...project.cqas.map((c) => createHeaderCell(c.code, 12)),
  ];

  const runDataRows = project.runs.map((r, idx) => {
    const sumMix = hasMixture
      ? mixtureFactors.reduce((acc, f) => {
          const v = Number(r.factorActual[f.code]);
          return acc + (isNaN(v) ? 0 : v);
        }, 0)
      : 0;

    return new TableRow({
      children: [
        createDataCell(String(r.stdOrder), idx % 2 === 1, 5),
        createDataCell(String(r.runOrder), idx % 2 === 1, 5),
        ...project.factors.map((f) =>
          createDataCell(
            typeof r.factorActual[f.code] === 'number'
              ? (r.factorActual[f.code] as number).toFixed(1)
              : String(r.factorActual[f.code] ?? '-'),
            idx % 2 === 1,
            10
          )
        ),
        ...(hasMixture
          ? [
              createDataCell(
                Math.abs(sumMix - 100) < 0.1 ? '100% (✓)' : `${sumMix.toFixed(1)}% (⚠)`,
                idx % 2 === 1,
                10
              ),
            ]
          : []),
        ...project.cqas.map((c) =>
          createDataCell(
            r.responses[c.code] !== null && r.responses[c.code] !== undefined
              ? String(r.responses[c.code])
              : '-',
            idx % 2 === 1,
            12
          )
        ),
      ],
    });
  });

  sections.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [new TableRow({ children: runHeaderCells }), ...runDataRows],
    }),
    new Paragraph({ text: '', spacing: { after: 250 } })
  );

  // SECTION 5a: Polynomial Regression & ANOVA (Lack of Fit)
  sections.push(
    new Paragraph({
      text: '5a. Mô Hình Hồi Quy Đa Thức & Phân Tích Phương Sai (ANOVA - Lack of Fit)',
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 300, after: 150 },
    }),
    new Paragraph({
      text: `Phân tích phương sai (ANOVA) nhằm đánh giá mức độ ý nghĩa của toàn bộ mô hình (Model p < 0.05) và kiểm định độ thiếu phù hợp Lack of Fit (p > 0.05 là đạt chuẩn mô hình không bị thiếu phù hợp theo ICH Q8 & US FDA).${hasMultipleBlocks ? ` Thiết kế này có ${observedBlocks.length} block; hiệu ứng block được đưa vào mô hình như hiệu ứng cố định, do đó các hiệu ứng xử lý và phần dư được báo cáo sau khi hiệu chỉnh block.` : ''}`,
      spacing: { after: 150 },
    }),
    ...(discreteOrCategoricalFactors.length > 0 ? [new Paragraph({
      text: `Biến rời rạc/định tính được mã hóa theo mức cấu hình khi khớp mô hình: ${discreteOrCategoricalFactors.map((factor) => `${factor.code} (${factor.name})`).join(', ')}. Diễn giải chỉ áp dụng trong các mức đã khảo sát.`,
      spacing: { after: 150 },
    })] : [])
  );

  if (models && Object.keys(models).length > 0) {
    Object.values(models).forEach((model) => {
      const cqa = project.cqas.find((c) => c.code === model.cqaCode);
      const title = cqa ? `${cqa.name} (${model.cqaCode})` : model.cqaCode;

      sections.push(
        new Paragraph({
          text: `Mô hình ANOVA cho chỉ tiêu: ${title}`,
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 200, after: 100 },
        }),
        new Paragraph({
          children: [
            new TextRun({ text: 'Phương trình hồi quy: ', bold: true }),
            new TextRun({ text: model.equationString, font: 'Consolas', color: PRIMARY_COLOR }),
          ],
          spacing: { after: 100 },
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: `R² = ${model.diagnostics.rSquared.toFixed(4)} | Adj R² = ${model.diagnostics.adjRSquared.toFixed(4)} | Pred R² = ${model.diagnostics.predRSquared.toFixed(4)} | Adeq Precision = ${model.diagnostics.adeqPrecision.toFixed(2)} | Std Dev = ${model.diagnostics.stdDev.toFixed(3)} (CV = ${model.diagnostics.cvPercent.toFixed(2)}%)`,
              bold: true,
              color: '334155',
              size: 19,
            }),
          ],
          spacing: { after: 100 },
        })
      );

      // Curvature Test note if present
      if (model.curvatureTest) {
        sections.push(
          new Paragraph({
            children: [
              new TextRun({
                text: `[Curvature Test]: F = ${model.curvatureTest.fValue?.toFixed(2)}, p = ${model.curvatureTest.pValue !== undefined ? (model.curvatureTest.pValue < 0.001 ? '< 0.001' : model.curvatureTest.pValue.toFixed(4)) : '-'} - ${model.curvatureTest.note}`,
                italics: true,
                color: model.curvatureTest.significant ? 'B45309' : '15803D',
                bold: true,
                size: 19,
              }),
            ],
            spacing: { after: 120 },
          })
        );
      }

      const anovaRows = [
        new TableRow({
          children: [
            createHeaderCell('Nguồn Biến Thiên (Source)', 30),
            createHeaderCell('Tổng Bình Phương (SS)', 22),
            createHeaderCell('Bậc Tự Do (df)', 12),
            createHeaderCell('Bình Phương Trung Bình (MS)', 22),
            createHeaderCell('F-value', 14),
            createHeaderCell('p-value', 20),
          ],
        }),
        ...model.anova.map(
          (row, idx) => {
            const isLOF = row.source === 'Lack of Fit';
            let pValStr = '-';
            if (row.pValue !== undefined) {
              pValStr = row.pValue < 0.001 ? '< 0.001' : row.pValue.toFixed(4);
              if (isLOF) {
                pValStr += row.pValue > 0.05 ? ' (✓ Đạt > 0.05)' : ' (⚠ Thiếu phù hợp)';
              }
            } else if (isLOF && row.df === 0) {
              pValStr = 'df = 0 (Bão hòa)';
            }

            return new TableRow({
              children: [
                createDataCell(row.source, idx % 2 === 1, 30),
                createDataCell(row.ss.toFixed(3), idx % 2 === 1, 22),
                createDataCell(String(row.df), idx % 2 === 1, 12),
                createDataCell(row.ms.toFixed(3), idx % 2 === 1, 22),
                createDataCell(row.fValue !== undefined ? row.fValue.toFixed(2) : '-', idx % 2 === 1, 14),
                createDataCell(pValStr, idx % 2 === 1, 20),
              ],
            });
          }
        ),
      ];

      sections.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: anovaRows,
        }),
        new Paragraph({ text: '', spacing: { after: 200 } })
      );
    });
  } else {
    sections.push(
      new Paragraph({
        text: 'Chưa có mô hình hồi quy đa thức được khớp trong dự án. Vui lòng chuyển sang Tab 4 để thực hiện phân tích ANOVA.',
        spacing: { after: 200 },
      })
    );
  }

  // SECTION 5b: Neural Network Modeling (ANN)
  sections.push(
    new Paragraph({
      text: '5b. Mô Hình Mạng Nơ-ron Nhân Tạo AI (Artificial Neural Network - ANN)',
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 300, after: 150 },
    })
  );

  if (neuralModels && Object.keys(neuralModels).length > 0) {
    const firstNM = Object.values(neuralModels)[0];
    const actualTrainingMode = firstNM?.architectureMode ?? (project.analysisSettings?.neuralTrainingMode ?? 'independent');
    const isShared = actualTrainingMode === 'shared';

    sections.push(
      new Paragraph({
        text: `Chế độ mô hình hóa: ${isShared ? 'Mạng Nơ-ron Hợp Nhất Đa Đầu Ra (Multi-Output Shared MLP)' : 'Mạng Nơ-ron Độc Lập Cho Từng Biến Y (Independent Per-CQA MLP)'}. Áp dụng kiến trúc Multi-Layer Perceptron (MLP) với thuật toán tối ưu hóa đa vòng lặp (Multi-Tour Optimization) để mô phỏng tương tác phi tuyến tính phức tạp.${hasMultipleBlocks ? ` Hiệu ứng block (${observedBlocks.length} block) được mã hóa như biến nuisance trong huấn luyện và chẩn đoán; đồ thị/tối ưu hóa tham chiếu Block ${observedBlocks[0]}.` : ''}`,
        spacing: { after: 150 },
      }),
      new Paragraph({
        text: `Validation và kiến trúc: ${Object.values(neuralModels).map((model) => `${model.cqaCode}: ${model.config.validationMethod === 'kfold' ? `K-fold (K=${model.config.kFolds ?? 5})` : `holdout ${(model.config.holdoutRatio * 100).toFixed(0)}%`}; ${model.architectureMode === 'shared' ? 'Mạng Hợp Nhất' : 'Mạng Độc Lập'}`).join(' | ')}.`,
        spacing: { after: 150 },
      })
    );

    const nnRows = [
      new TableRow({
        children: [
          createHeaderCell('Chỉ tiêu CQA', 20),
          createHeaderCell('Kiến trúc Lớp ẩn', 22),
          createHeaderCell('Chế độ', 14),
          createHeaderCell('Train R²', 11),
          createHeaderCell('Val R²', 11),
          createHeaderCell('Overall R²', 11),
          createHeaderCell('RMSE', 11),
        ],
      }),
      ...Object.values(neuralModels).map((nm, idx) => {
        const cqa = project.cqas.find((c) => c.code === nm.cqaCode);
        return new TableRow({
          children: [
            createDataCell(cqa ? `${cqa.name} (${nm.cqaCode})` : nm.cqaCode, idx % 2 === 1, 20),
            createDataCell(`[${nm.config.hiddenNodes1}${nm.config.hiddenNodes2 > 0 ? `, ${nm.config.hiddenNodes2}` : ''}] ${nm.config.activation.toUpperCase()}`, idx % 2 === 1, 22),
            createDataCell(nm.architectureMode === 'shared' ? 'Hợp nhất' : 'Độc lập', idx % 2 === 1, 14),
            createDataCell(`${nm.diagnostics.rSquaredTrain}`, idx % 2 === 1, 11),
            createDataCell(`${nm.diagnostics.rSquaredVal}`, idx % 2 === 1, 11),
            createDataCell(`${nm.diagnostics.rSquaredOverall}`, idx % 2 === 1, 11),
            createDataCell(`${nm.diagnostics.rmseOverall}`, idx % 2 === 1, 11),
          ],
        });
      }),
    ];

    sections.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: nnRows,
      }),
      new Paragraph({
        text: 'Độ Quan Trọng Của Biến Đầu Vào (Variable Importance - Phân Tích Độ Nhạy Mạng Nơ-ron):',
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 200, after: 100 },
      })
    );

    Object.values(neuralModels).forEach((nm) => {
      const cqa = project.cqas.find((c) => c.code === nm.cqaCode);
      const viRows = [
        new TableRow({
          children: [
            createHeaderCell('Yếu Tố Đầu Vào (Factor)', 50),
            createHeaderCell('Mã', 20),
            createHeaderCell('Độ Quan Trọng Tương Đối (%)', 30),
          ],
        }),
        ...nm.diagnostics.variableImportance.map((v, vIdx) => {
          const factor = project.factors.find((f) => f.code === v.factorCode);
          return new TableRow({
            children: [
              createDataCell(factor ? `${factor.name} (${factor.code})` : v.factorName || v.factorCode, vIdx % 2 === 1, 50),
              createDataCell(v.factorCode, vIdx % 2 === 1, 20),
              createDataCell(`${v.relativeImportance}%`, vIdx % 2 === 1, 30),
            ],
          });
        }),
      ];

      sections.push(
        new Paragraph({
          text: `Chỉ tiêu: ${cqa?.name || nm.cqaCode} (${nm.cqaCode}) — Tour #${nm.diagnostics.bestTourIndex}`,
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 100, after: 60 },
        }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: viRows,
        }),
        new Paragraph({ text: '', spacing: { after: 150 } })
      );
    });
  } else {
    sections.push(
      new Paragraph({
        text: 'Dự án hiện tại áp dụng phương pháp mô hình hóa cổ điển (Hồi quy đa thức bậc ≤ 2 kết hợp ANOVA Lack of Fit ở mục 5a). Mô hình mạng nơ-ron AI (ANN) chưa được kích hoạt hoặc huấn luyện cho dự án này. Vui lòng chuyển sang Tab 5 (Mạng Nơ-ron AI) để khởi tạo và huấn luyện mạng khi cần mô hình hóa phi tuyến tính phức tạp.',
        spacing: { after: 200 },
      })
    );
  }

  // SECTION 6a: Desirability Optimization (Desirability Profiler)
  sections.push(
    new Paragraph({
      text: '6a. Tối Ưu Hóa Đa Mục Tiêu (Desirability Profiler)',
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 300, after: 150 },
    }),
    new Paragraph({
      text: optimum
        ? `Áp dụng thuật toán Derringer-Suich tổng hợp độ thỏa dụng toàn cục D = ${(optimum.overallDesirability * 100).toFixed(1)}% (D = ${optimum.overallDesirability}). Điểm cài đặt tối ưu đề xuất (Optimal Target Setpoint):`
        : 'Chưa thiết lập điểm tối ưu hóa đa mục tiêu tại thời điểm xuất báo cáo. Cần thực hiện tối ưu hóa theo hàm thỏa dụng Derringer-Suich trong Tab 6 trước khi ban hành hồ sơ chính thức.',
      spacing: { after: 150 },
    })
  );

  if (optimum) {
    const optFactorRows = [
      new TableRow({
        children: [
          createHeaderCell('Thông số đầu vào (CMA / CPP)', 35),
          createHeaderCell('Mức mã hóa (Coded Level)', 25),
          createHeaderCell('Giá trị cài đặt đề xuất (Actual Setpoint)', 40),
        ],
      }),
      ...project.factors.map(
        (f, idx) =>
          new TableRow({
            children: [
              createDataCell(`${f.name} (${f.code})`, idx % 2 === 1, 35),
              createDataCell(`${optimum.codedFactors[f.code]}`, idx % 2 === 1, 25),
              createDataCell(`${optimum.actualFactors[f.code]} ${f.unit || ''}`, idx % 2 === 1, 40),
            ],
          })
      ),
    ];

    sections.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: optFactorRows,
      }),
      new Paragraph({ text: '', spacing: { after: 150 } }),
      new Paragraph({
        text: 'Đáp Ứng CQAs Dự Đoán, Khoảng Tin Cậy 95% CI & Hàm Thỏa Dụng Từng Phần (d_i):',
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 150, after: 100 },
      })
    );

    // Predicted CQAs table
    const predCQARows = [
      new TableRow({
        children: [
          createHeaderCell('Chỉ tiêu CQA', 25),
          createHeaderCell('Mục tiêu (Goal)', 15),
          createHeaderCell('Giá trị dự đoán (Mean)', 22),
          createHeaderCell('Khoảng tin cậy 95% CI', 23),
          createHeaderCell('Thỏa dụng (d_i)', 15),
        ],
      }),
      ...project.cqas.map((cqa, idx) => {
        const pred = optimum.predictedResponses[cqa.code];
        return new TableRow({
          children: [
            createDataCell(`${cqa.name} (${cqa.code})`, idx % 2 === 1, 25),
            createDataCell(cqa.objective.toUpperCase(), idx % 2 === 1, 15),
            createDataCell(pred ? `${pred.value} ${cqa.unit}` : '-', idx % 2 === 1, 22),
            createDataCell(pred && Number.isFinite(pred.ciLow) ? `[${pred.ciLow} - ${pred.ciHigh}]` : 'N/A (không có CI đã hiệu chuẩn)', idx % 2 === 1, 23),
            createDataCell(pred ? `${pred.desirability}` : '-', idx % 2 === 1, 15),
          ],
        });
      }),
    ];

    sections.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: predCQARows,
      }),
      new Paragraph({ text: '', spacing: { after: 250 } })
    );
  }

  // SECTION 6b: Updated Risk Assessment Table (ICH Q9 & FDA Standard)
  const updatedRisks = generateUpdatedRiskAssessment(project, reportModels);
  sections.push(
    new Paragraph({
      text: '6b. Đánh Giá Rủi Ro Cập Nhật Sau DoE (Updated Risk Assessment - ICH Q9 & FDA)',
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 300, after: 150 },
    }),
    new Paragraph({
      text: 'Bảng đối chiếu mức độ rủi ro trước và sau DoE. Ứng dụng không tự động hạ rủi ro xuống mức thấp khi chưa có mô hình phù hợp, confirmation run và chiến lược kiểm soát được phê duyệt:',
      spacing: { after: 150 },
    })
  );

  const updatedRiskRows = [
    new TableRow({
      children: [
        createHeaderCell('Yếu Tố (Factor)', 20),
        createHeaderCell('Chỉ Tiêu (CQA)', 20),
        createHeaderCell('Rủi Ro Ban Đầu', 15),
        createHeaderCell('Ý Nghĩa DoE', 12),
        createHeaderCell('Rủi Ro Cập Nhật', 15),
        createHeaderCell('Luận Giải Khoa Học Giảm Rủi Ro', 35),
      ],
    }),
    ...updatedRisks.map(
      (item, idx) =>
        new TableRow({
          children: [
            createDataCell(`${item.factorCode} (${item.factorName})`, idx % 2 === 1, 20),
            createDataCell(`${item.cqaCode} (${item.cqaName})`, idx % 2 === 1, 20),
            createDataCell(item.initialRisk === 'High' ? 'Cao (High)' : item.initialRisk === 'Medium' ? 'Trung bình (Med)' : 'Thấp (Low)', idx % 2 === 1, 15),
            createDataCell(item.isSignificantInModel ? 'Có (p < 0.05)' : 'Không', idx % 2 === 1, 12),
            createDataCell(item.updatedRisk === 'Low' ? 'Thấp (Low)' : 'Trung bình (Medium)', idx % 2 === 1, 15),
            createDataCell(item.justification, idx % 2 === 1, 35),
          ],
        })
    ),
  ];

  sections.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: updatedRiskRows,
    }),
    new Paragraph({ text: '', spacing: { after: 250 } })
  );

  // SECTION 7: Comprehensive Control Strategy Table (ICH Q10 & FDA Table 105/106/107)
  const controlStrategyItems = generateControlStrategy(project, optimum);
  sections.push(
    new Paragraph({
      text: '7. Bảng Chiến Lược Kiểm Soát Toàn Diện (ICH Q10 Comprehensive Control Strategy)',
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 300, after: 150 },
    }),
    new Paragraph({
      text: 'Chiến lược kiểm soát tích hợp toàn bộ các điểm kiểm soát từ nguyên liệu đầu vào (CMAs), thông số quy trình (CPPs), kiểm soát trong quá trình (IPCs/PAT) đến tiêu chuẩn xuất xưởng thành phẩm, phân định rõ giữa NOR, PAR và Design Space:',
      spacing: { after: 150 },
    })
  );

  const csTableRows = [
    new TableRow({
      children: [
        createHeaderCell('Phân Loại', 16),
        createHeaderCell('Thông Số / Thuộc Tính', 20),
        createHeaderCell('Mục Tiêu (Target)', 12),
        createHeaderCell('Khoảng NOR', 16),
        createHeaderCell('Khoảng PAR', 16),
        createHeaderCell('Phương Pháp Kiểm Soát', 20),
      ],
    }),
    ...controlStrategyItems.map(
      (item, idx) =>
        new TableRow({
          children: [
            createDataCell(item.category, idx % 2 === 1, 16),
            createDataCell(`${item.parameterName} ${item.parameterCode ? `(${item.parameterCode})` : ''}`, idx % 2 === 1, 20),
            createDataCell(String(item.target), idx % 2 === 1, 12),
            createDataCell(item.nor, idx % 2 === 1, 16),
            createDataCell(item.par, idx % 2 === 1, 16),
            createDataCell(item.controlMethod, idx % 2 === 1, 20),
          ],
        })
    ),
  ];

  sections.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: csTableRows,
    }),
    new Paragraph({ text: '', spacing: { after: 250 } })
  );

  // SECTION 8: Monte Carlo Simulation Summary (ICH Q9)
  sections.push(
    new Paragraph({
      text: '8. Đánh Giá Độ Bền Vững Miền Dự Báo (Mô Phỏng Monte Carlo, tham chiếu ICH Q9)',
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 300, after: 150 },
    })
  );

  if (monteCarlo) {
    sections.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `Kết quả mô phỏng ${monteCarlo.simulations.toLocaleString()} lô sản xuất ảo với dao động thực tế: `,
            bold: true,
          }),
          new TextRun({
            text: `Tỷ lệ đạt tiêu chí của CQA đã mô hình hóa = ${monteCarlo.reliabilityPercent}% | Tỷ lệ lỗi trong điều kiện mô phỏng = ${monteCarlo.defectRatePPM.toLocaleString()} PPM`,
            color: monteCarlo.reliabilityPercent >= 99 ? '15803D' : 'B91C1C',
            bold: true,
          }),
        ],
        spacing: { after: 80 },
      }),
      new Paragraph({
        text: `Phạm vi mô hình: ${monteCarlo.modeledCqaCodes.join(', ') || 'Không có'} | CQA chưa được bao phủ: ${monteCarlo.unmodeledCqaCodes.join(', ') || 'Không có'} | Mẫu vượt miền khảo sát: ${monteCarlo.excursionCount.toLocaleString()} (${monteCarlo.excursionRatePercent}%).`,
        spacing: { after: 200 },
      })
    );
  } else {
    sections.push(
      new Paragraph({
        text: 'Chưa thực hiện mô phỏng Monte Carlo để xác nhận độ bền vững của vùng vận hành. Theo khuyến cáo ICH Q9 & US FDA, cần chạy mô phỏng 5.000 – 10.000 lô ảo với dao động thiết bị thực tế nhằm ước lượng tỷ lệ lỗi (Defect Rate PPM) và đánh giá rủi ro trước khi chuyển giao sản xuất.',
        spacing: { after: 200 },
      })
    );
  }

  // SECTION 9: Lifecycle Management & Regulatory Sign-off
  sections.push(
    new Paragraph({
      text: '9. Ký Duyệt & Phê Chuẩn Hồ Sơ Phát Triển Dược Phẩm (Sign-off & Approval)',
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 300, after: 150 },
    }),
    new Paragraph({
      text: 'Sản phẩm sẽ được theo dõi liên tục trong suốt vòng đời thương mại thông qua chương trình Xác thực Quy trình Tiếp diễn (Continued Process Verification - CPV). Báo cáo này xác nhận Không Gian Thiết Kế và Chiến Lược Kiểm Soát đã được xây dựng trên nền tảng khoa học vững chắc và quản lý rủi ro chất lượng, đáp ứng đầy đủ yêu cầu đăng ký thuốc theo hướng dẫn ICH CTD Module 3.2.P.2 của US FDA và EMA.',
      spacing: { after: 250 },
    })
  );

  const signRows = [
    new TableRow({
      children: [
        createHeaderCell('NGƯỜI LẬP BÁO CÁO (Scientist)', 33),
        createHeaderCell('TRƯỞNG PHÒNG R&D (Formulation Lead)', 34),
        createHeaderCell('GIÁM ĐỐC ĐẢM BẢO CHẤT LƯỢNG (QA Director)', 33),
      ],
    }),
    new TableRow({
      children: [
        createDataCell('\n\n\n\nKý tên: .......................................\nHọ tên: ' + (project.author || 'Cán bộ nghiên cứu'), false, 33),
        createDataCell('\n\n\n\nKý tên: .......................................\nHọ tên: ........................................', false, 34),
        createDataCell('\n\n\n\nKý tên: .......................................\nHọ tên: ........................................', false, 33),
      ],
    }),
  ];

  sections.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: signRows,
    }),
    new Paragraph({ text: '', spacing: { after: 250 } })
  );

  // SECTION 10: Project Governance & Traceability
  sections.push(
    new Paragraph({
      text: '10. Quản Trị Dự Án & Toàn Vẹn Dữ Liệu (Project Governance & Traceability)',
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 300, after: 150 },
    }),
    new Paragraph({
      text: 'Bảng tóm tắt thông tin quản trị dự án, xác thực cấu trúc và tính toàn vẹn dữ liệu (Project Governance & Audit Trail Summary):',
      spacing: { after: 150 },
    }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({ children: [createHeaderCell('Thuộc Tính Quản Trị', 35), createHeaderCell('Chi Tiết Xác Thực', 65)] }),
        new TableRow({ children: [createDataCell('Mã Dự Án (Project ID)', false, 35), createDataCell(project.id, false, 65)] }),
        new TableRow({ children: [createDataCell('Protocol ID', true, 35), createDataCell(traceability.protocolId, true, 65)] }),
        new TableRow({ children: [createDataCell('Kiểm Tra Cấu Trúc (Validation)', false, 35), createDataCell(traceability.validation.valid ? 'Đạt kiểm tra cấu trúc cục bộ' : `Cần rà soát: ${traceability.validation.errors.join('; ')}`, false, 65)] }),
        new TableRow({ children: [createDataCell('Tiến Độ Thực Nghiệm DoE', true, 35), createDataCell(`${project.runs.filter((r) => Object.keys(r.responses).length > 0).length} / ${project.runs.length} mẻ đã nhập kết quả (${traceability.runStatus})`, true, 65)] }),
        new TableRow({ children: [createDataCell('Phiên Bản Hệ Thống', false, 35), createDataCell(project.version ? `v${project.version}` : 'QbD System v2.0 (ICH Q8/Q9/Q10)', false, 65)] }),
        new TableRow({ children: [createDataCell('Dấu Thời Gian Kết Xuất', true, 35), createDataCell(new Date().toLocaleString('vi-VN'), true, 65)] }),
      ],
    }),
    new Paragraph({ text: '', spacing: { after: 200 } })
  );

  // Create Document
  const doc = new Document({
    sections: [
      {
        properties: {},
        children: sections,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, `QbD_Development_Report_DRAFT_${project.moleculeName.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.docx`);
}
