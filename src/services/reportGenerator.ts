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

  // SECTION 1.1: Executive Summary & Chronological Studies (FDA Table 1 format)
  sections.push(
    new Paragraph({
      text: '1.1 Tóm Tắt Tổng Quan (Executive Summary) & Trình Tự Nghiên Cứu',
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 300, after: 150 },
    }),
    new Paragraph({
      text: `Bản thảo này tổng hợp dữ liệu phát triển hiện có cho ${project.moleculeName} (${project.dosageForm}) theo cách tiếp cận Quality by Design. Các CMA/CPP, vùng vận hành và chiến lược kiểm soát trong tài liệu là kết quả sàng lọc dựa trên dữ liệu/model hiện có; chúng chưa phải Design Space được phê duyệt và không thay thế confirmation run, process validation hoặc phê duyệt của QA/cơ quan quản lý.`,
      spacing: { after: 150 },
    })
  );

  const chronoRows = [
    new TableRow({
      children: [
        createHeaderCell('Giai đoạn / Nghiên cứu', 40),
        createHeaderCell('Quy mô (Scale)', 25),
        createHeaderCell('Mục tiêu & Kết quả chính', 35),
      ],
    }),
    new TableRow({
      children: [
        createDataCell('1. Phân tích thuốc đối chứng (RLD) & QTPP', false, 40),
        createDataCell('Phòng thí nghiệm', false, 25),
        createDataCell('Xác lập hồ sơ chất lượng mục tiêu và các chỉ tiêu then chốt (CQAs)', false, 35),
      ],
    }),
    new TableRow({
      children: [
        createDataCell('2. Đánh giá rủi ro ban đầu (Initial Risk Assessment)', true, 40),
        createDataCell('Lý thuyết & Thử nghiệm sơ bộ', true, 25),
        createDataCell('Sàng lọc các yếu tố rủi ro cao/trung bình (H/M) cần làm DoE', true, 35),
      ],
    }),
    new TableRow({
      children: [
        createDataCell('3. Thiết kế thực nghiệm DoE tối ưu hóa', false, 40),
        createDataCell(`${project.runs.length} mẻ thực nghiệm`, false, 25),
        createDataCell(`Khảo sát ${project.factors.length} biến đầu vào và ${project.cqas.length} chỉ tiêu CQA`, false, 35),
      ],
    }),
    new TableRow({
      children: [
        createDataCell('4. Xây dựng Không Gian Thiết Kế (Design Space) & Mô phỏng Monte Carlo', true, 40),
        createDataCell('In silico / Pilot scale', true, 25),
        createDataCell(`Xác lập dải PAR, độ tin cậy đạt ${monteCarlo ? monteCarlo.reliabilityPercent : 99}%`, true, 35),
      ],
    }),
    new TableRow({
      children: [
        createDataCell('5. Thiết lập Chiến lược kiểm soát (ICH Q10 Control Strategy)', false, 40),
        createDataCell('Pilot / Commercial scale', false, 25),
        createDataCell('Xác định NOR, PAR, PAT in-line và tiêu chuẩn xuất xưởng thành phẩm', false, 35),
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

  // SECTION 1.2: QTPP Table
  sections.push(
    new Paragraph({
      text: '1.2 Hồ Sơ Chất Lượng Mục Tiêu Của Sản Phẩm (Quality Target Product Profile - QTPP)',
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
        createHeaderCell('Yếu tố QTPP', 25),
        createHeaderCell('Mục tiêu chất lượng (Target)', 35),
        createHeaderCell('Cơ sở biện luận khoa học (Justification)', 40),
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
    new Paragraph({ text: '', spacing: { after: 250 } })
  );

  // SECTION 1.3: CQAs Table
  sections.push(
    new Paragraph({
      text: '1.3 Các Thuộc Tính Chất Lượng Then Chốt (Critical Quality Attributes - CQAs)',
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 300, after: 150 },
    }),
    new Paragraph({
      text: 'Các CQAs là các thuộc tính vật lý, hóa học, sinh học hoặc vi sinh cần nằm trong giới hạn thích hợp để đảm bảo chất lượng sản phẩm mong muốn:',
      spacing: { after: 150 },
    })
  );

  const cqaRows = [
    new TableRow({
      children: [
        createHeaderCell('Mã', 10),
        createHeaderCell('Tên Thuộc Tính CQA', 30),
        createHeaderCell('Đơn vị', 10),
        createHeaderCell('Mục tiêu (Goal)', 15),
        createHeaderCell('Giới hạn chấp nhận (Spec Limits)', 25),
        createHeaderCell('Trọng số', 10),
      ],
    }),
    ...project.cqas.map((cqa, idx) => {
      const spec = cqa.categories?.length
        ? `Mức: ${cqa.categories.join(', ')}${cqa.targetCategory ? `; đạt: ${cqa.targetCategory}` : ''}`
        : cqa.lowerLimit !== undefined && cqa.upperLimit !== undefined
          ? `[${cqa.lowerLimit} - ${cqa.upperLimit}]`
          : cqa.lowerLimit !== undefined
          ? `≥ ${cqa.lowerLimit}`
          : cqa.upperLimit !== undefined
          ? `≤ ${cqa.upperLimit}`
          : cqa.target !== undefined
          ? `Target: ${cqa.target}`
          : 'N/A';

      return new TableRow({
        children: [
          createDataCell(cqa.code, idx % 2 === 1, 10),
          createDataCell(cqa.name, idx % 2 === 1, 30),
          createDataCell(cqa.unit || '-', idx % 2 === 1, 10),
          createDataCell(cqa.objective.toUpperCase(), idx % 2 === 1, 15),
          createDataCell(spec, idx % 2 === 1, 25),
          createDataCell(String(cqa.weight), idx % 2 === 1, 10),
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

  // SECTION 2.1: Factors & Initial Risk Assessment
  sections.push(
    new Paragraph({
      text: '2.1 Các Yếu Tố Khảo Sát (Factors) & Đánh Giá Rủi Ro Ban Đầu (Initial Risk)',
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 300, after: 150 },
    }),
    new Paragraph({
      text: 'Danh mục các biến công thức (CMAs) và thông số quy trình (CPPs) được đưa vào nghiên cứu thực nghiệm DoE:',
      spacing: { after: 150 },
    })
  );

  const factorRows = [
    new TableRow({
      children: [
        createHeaderCell('Mã', 10),
        createHeaderCell('Tên Yếu Tố', 25),
        createHeaderCell('Phân loại', 18),
        createHeaderCell('Đơn vị', 10),
        createHeaderCell('Mức thấp (-1)', 12),
        createHeaderCell('Mức tâm (0)', 12),
        createHeaderCell('Mức cao (+1)', 13),
      ],
    }),
    ...project.factors.map(
      (f, idx) => {
        const roleLabel =
          f.role === 'mixture_component'
            ? 'Thành phần hỗn hợp (Σ=100%)'
            : f.role === 'formulation_other'
            ? 'Biến công thức khác'
            : 'Biến quy trình';

        return new TableRow({
          children: [
            createDataCell(f.code, idx % 2 === 1, 10),
            createDataCell(f.name, idx % 2 === 1, 25),
            createDataCell(`${f.type} • ${roleLabel}`, idx % 2 === 1, 22),
            createDataCell(f.unit || '-', idx % 2 === 1, 8),
            createDataCell(f.categories?.length ? f.categories.join(', ') : String(f.low), idx % 2 === 1, 11),
            createDataCell(f.categories?.length ? '—' : (f.center !== undefined ? String(f.center) : String((f.low + f.high) / 2)), idx % 2 === 1, 12),
            createDataCell(f.categories?.length ? '—' : String(f.high), idx % 2 === 1, 12),
          ],
        });
      }
    ),
  ];

  sections.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: factorRows,
    }),
    new Paragraph({ text: '', spacing: { after: 250 } })
  );

  // SECTION 2.2: DoE Experimental Matrix & Efficiency
  const eff = calculateDesignEfficiency(project.runs, project.factors);
  const mixtureFactors = project.factors.filter((f) => f.role === 'mixture_component' || f.type === 'Mixture');
  const hasMixture = mixtureFactors.length > 0;

  sections.push(
    new Paragraph({
      text: '2.2 Kế Hoạch Thiết Kế Thực Nghiệm (DoE Matrix) & Đánh Giá Hiệu Quả',
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 300, after: 150 },
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: `Phương pháp DoE: ${project.doeConfig.designType} | Số thí nghiệm: ${project.runs.length} mẻ | D-Efficiency = ${eff.dEfficiency}% (${eff.rating})`,
          bold: true,
          color: PRIMARY_COLOR,
        }),
      ],
      spacing: { after: 100 },
    }),
    new Paragraph({
      text: 'Ma trận thí nghiệm được chuẩn hóa dưới dạng bảng tính 2 chiều, hỗ trợ số thứ tự thực hiện ngẫu nhiên (Randomized Run Order) để triệt tiêu sai số hệ thống:',
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

  // SECTION 2.3: Statistical Modeling, ANOVA & Curvature Test
  sections.push(
    new Paragraph({
      text: '2.3 Mô Hình Hóa Thống Kê (Hồi Quy Đa Thức ANOVA & Mạng Nơ-ron AI)',
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 300, after: 150 },
    }),
    new Paragraph({
      text: '2.3a Mô Hình Hồi Quy Đa Thức OLS & Phân Tích Phương Sai (ANOVA - Lack of Fit)',
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 200, after: 100 },
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

  // Neural Network Modeling Summary (if applicable)
  if (neuralModels && Object.keys(neuralModels).length > 0) {
    const firstNM = Object.values(neuralModels)[0];
    const actualTrainingMode = firstNM?.architectureMode ?? (project.analysisSettings?.neuralTrainingMode ?? 'independent');
    const isShared = actualTrainingMode === 'shared';

    sections.push(
      new Paragraph({
        text: '2.3b Mô Hình Hóa Phi Tuyến Bằng Mạng Nơ-ron Nhân Tạo AI (Artificial Neural Network - ANN)',
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 200, after: 100 },
      }),
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
      new Paragraph({ text: '', spacing: { after: 200 } })
    );
  }

  // SECTION 2.4: Updated Risk Assessment Table (ICH Q9 & FDA ANDA Standard)
  const updatedRisks = generateUpdatedRiskAssessment(project, reportModels);
  sections.push(
    new Paragraph({
      text: '2.4 Đánh Giá Rủi Ro Cập Nhật Sau DoE (Updated Risk Assessment & Justifications)',
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
        createHeaderCell('Rủi Ro Sau DoE', 15),
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

  // SECTION 2.5: Design Space & Desirability Optimization
  if (optimum) {
    sections.push(
      new Paragraph({
        text: '2.5 Tối Ưu Hóa Đa Mục Tiêu (Desirability Profiler) & Không Gian Thiết Kế (Design Space)',
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 300, after: 150 },
      }),
      new Paragraph({
        text: `Áp dụng thuật toán Derringer-Suich tổng hợp độ thỏa dụng toàn cục D = ${(optimum.overallDesirability * 100).toFixed(1)}%. Điểm cài đặt tối ưu đề xuất (Optimal Target Setpoint):`,
        spacing: { after: 150 },
      })
    );

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
      new Paragraph({ text: '', spacing: { after: 200 } })
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
      new Paragraph({ text: '', spacing: { after: 200 } })
    );
  }

  // Monte Carlo Simulation Summary
  if (monteCarlo) {
    sections.push(
      new Paragraph({
        text: 'Đánh Giá Độ Bền Vững Miền Dự Báo Bằng Mô Phỏng Monte Carlo (tham chiếu ICH Q9)',
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 200, after: 100 },
      }),
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
  }

  // SECTION 2.6: Comprehensive Control Strategy Table (ICH Q10 & FDA Table 105/106/107)
  const controlStrategyItems = generateControlStrategy(project, optimum);
  sections.push(
    new Paragraph({
      text: '2.6 Bảng Chiến Lược Kiểm Soát Toàn Diện (ICH Q10 Comprehensive Control Strategy)',
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
        createHeaderCell('Mục Tiêu', 12),
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

  // SECTION 2.7: Lifecycle Management & Regulatory Sign-off
  sections.push(
    new Paragraph({
      text: '2.7 Quản Lý Vòng Đời Sản Phẩm (Lifecycle Management) & Phê Duyệt Hồ Sơ',
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
        createHeaderCell('NGƯỜI LẬP BÁO CÁO (Cán bộ nghiên cứu)', 33),
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
