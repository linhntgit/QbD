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
} from '../types/qbd';
import { calculateDesignEfficiency } from './doeGenerator';

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
 * Generate comprehensive ICH CTD Module 3.2.P.2 Pharmaceutical Development Report (.docx)
 */
export async function exportQBDWordReport(
  project: QBDProject,
  models: Record<string, StatisticalModelResult>,
  optimum: DesirabilitySolution | null,
  monteCarlo: MonteCarloResult | null,
  neuralModels?: Record<string, NeuralNetModelResult>
): Promise<void> {
  const sections: any[] = [];

  // Title & Header Information
  sections.push(
    new Paragraph({
      text: 'BÁO CÁO PHÁT TRIỂN DƯỢC PHẨM THEO QUALITY BY DESIGN (QbD)',
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 200, before: 100 },
      style: 'Title',
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: `Tuân thủ hướng dẫn ICH Q8 (R2), ICH Q9, ICH Q10, ICH Q11`,
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
        createHeaderCell('Hạng mục', 30),
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
        createDataCell('Hoạt chất / Phân tử (Drug Substance)', true, 30),
        createDataCell(project.moleculeName, true, 70),
      ],
    }),
    new TableRow({
      children: [
        createDataCell('Dạng bào chế (Dosage Form)', false, 30),
        createDataCell(project.dosageForm, false, 70),
      ],
    }),
    new TableRow({
      children: [
        createDataCell('Đơn vị / Tác giả thực hiện', true, 30),
        createDataCell(project.author, true, 70),
      ],
    }),
    new TableRow({
      children: [
        createDataCell('Ngày lập báo cáo', false, 30),
        createDataCell(new Date().toLocaleDateString('vi-VN'), false, 70),
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

  // SECTION 1: QTPP
  sections.push(
    new Paragraph({
      text: '1. Chỉ tiêu chất lượng sản phẩm mục tiêu (QTPP - ICH Q8)',
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 300, after: 150 },
    }),
    new Paragraph({
      text: 'QTPP là cơ sở định hướng toàn bộ quá trình nghiên cứu công thức và quy trình sản xuất, đảm bảo chất lượng, độ an toàn và hiệu quả điều trị của thuốc.',
      spacing: { after: 200 },
    })
  );

  const qtppRows = [
    new TableRow({
      children: [
        createHeaderCell('Yếu tố QTPP', 30),
        createHeaderCell('Tiêu chí mục tiêu', 35),
        createHeaderCell('Cơ sở lý giải khoa học', 35),
      ],
    }),
    ...project.qtpp.map(
      (item, idx) =>
        new TableRow({
          children: [
            createDataCell(item.element, idx % 2 === 1, 30),
            createDataCell(item.target, idx % 2 === 1, 35),
            createDataCell(item.justification, idx % 2 === 1, 35),
          ],
        })
    ),
  ];

  sections.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: qtppRows,
    }),
    new Paragraph({ text: '', spacing: { after: 300 } })
  );

  // SECTION 2: CQAs & Desirability Configuration
  sections.push(
    new Paragraph({
      text: '2. Các thuộc tính chất lượng trọng yếu (CQAs) & Cấu hình Hàm Thỏa Dụng (Desirability Goals)',
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 300, after: 150 },
    }),
    new Paragraph({
      text: 'CQAs là các đặc tính vật lý, hóa học, sinh học hoặc vi sinh cần nằm trong giới hạn thích hợp để đảm bảo chất lượng sản phẩm như mong muốn.',
      spacing: { after: 150 },
    })
  );

  const cqaRows = [
    new TableRow({
      children: [
        createHeaderCell('Mã', 7),
        createHeaderCell('Tên CQA', 22),
        createHeaderCell('Bản chất', 13),
        createHeaderCell('Đơn vị', 7),
        createHeaderCell('Mục tiêu (Goal)', 15),
        createHeaderCell('Giới hạn (LSL - Target - USL)', 20),
        createHeaderCell('Hình dạng (s, t)', 8),
        createHeaderCell('Trọng số (w)', 8),
      ],
    }),
    ...project.cqas.map(
      (cqa, idx) =>
        new TableRow({
          children: [
            createDataCell(cqa.code, idx % 2 === 1, 7),
            createDataCell(cqa.name, idx % 2 === 1, 22),
            createDataCell(cqa.dataType === 'qualitative_binary' ? 'Định tính (Pass/Fail)' : cqa.dataType === 'qualitative_ordinal' ? 'Định tính (Thứ bậc)' : 'Định lượng (Quantitative)', idx % 2 === 1, 13),
            createDataCell(cqa.unit, idx % 2 === 1, 7),
            createDataCell(
              cqa.objective === 'maximize' ? '📈 Lớn nhất (Max)' :
              cqa.objective === 'minimize' ? '📉 Nhỏ nhất (Min)' :
              cqa.objective === 'target' ? '🎯 Đạt đích (Target)' :
              cqa.objective === 'range' ? '📏 Trong khoảng' : 'None',
              idx % 2 === 1,
              15
            ),
            createDataCell(
              `${cqa.lowerLimit ?? '-'} / ${cqa.target ?? '-'} / ${cqa.upperLimit ?? '-'}`,
              idx % 2 === 1,
              20
            ),
            createDataCell(`s=${cqa.sShape ?? 1}, t=${cqa.tShape ?? 1}`, idx % 2 === 1, 8),
            createDataCell(`${cqa.weight}`, idx % 2 === 1, 8),
          ],
        })
    ),
  ];

  sections.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: cqaRows,
    }),
    new Paragraph({ text: '', spacing: { after: 300 } })
  );

  // SECTION 3: FMEA Risk Assessment (ICH Q9)
  sections.push(
    new Paragraph({
      text: '3. Đánh giá quản lý rủi ro ban đầu (Initial Risk Assessment - ICH Q9)',
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 300, after: 150 },
    }),
    new Paragraph({
      text: 'Áp dụng công cụ FMEA (Failure Mode and Effects Analysis) tính điểm chỉ số ưu tiên rủi ro RPN = Nghiêm trọng (S) x Xác suất (P) x Khả năng phát hiện (D) để sàng lọc các biến đầu vào trọng yếu (CMA/CPP) cần khảo sát bằng DoE.',
      spacing: { after: 200 },
    })
  );

  const fmeaRows = [
    new TableRow({
      children: [
        createHeaderCell('Nhân tố (Factor)', 20),
        createHeaderCell('CQA ảnh hưởng', 20),
        createHeaderCell('S', 8),
        createHeaderCell('P', 8),
        createHeaderCell('D', 8),
        createHeaderCell('RPN', 10),
        createHeaderCell('Mức rủi ro', 12),
        createHeaderCell('Khảo sát DoE', 14),
      ],
    }),
    ...project.fmeaRisks.map((item, idx) => {
      const factor = project.factors.find((f) => f.id === item.factorId);
      const cqa = project.cqas.find((c) => c.id === item.cqaId);
      return new TableRow({
        children: [
          createDataCell(factor ? `${factor.name} (${factor.code})` : '-', idx % 2 === 1, 20),
          createDataCell(cqa ? `${cqa.name} (${cqa.code})` : '-', idx % 2 === 1, 20),
          createDataCell(`${item.severity}`, idx % 2 === 1, 8),
          createDataCell(`${item.probability}`, idx % 2 === 1, 8),
          createDataCell(`${item.detectability}`, idx % 2 === 1, 8),
          createDataCell(`${item.rpn}`, idx % 2 === 1, 10),
          createDataCell(item.riskLevel, idx % 2 === 1, 12),
          createDataCell(item.recommendedDoE ? 'Có (DoE)' : 'Không', idx % 2 === 1, 14),
        ],
      });
    }),
  ];

  sections.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: fmeaRows,
    }),
    new Paragraph({ text: '', spacing: { after: 300 } })
  );

  // SECTION 4: DoE Design Matrix
  sections.push(
    new Paragraph({
      text: '4. Thiết kế thí nghiệm (Design of Experiments - DoE Matrix)',
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 300, after: 150 },
    }),
    new Paragraph({
      text: `Kiểu thiết kế: ${project.doeConfig.designType} (${project.doeConfig.category}) | Số điểm tâm: ${project.doeConfig.centerPoints} | Tổng số lần chạy: ${project.runs.length}`,
      spacing: { after: 200 },
    })
  );

  // Factors List
  const factorRows = [
    new TableRow({
      children: [
        createHeaderCell('Mã', 7),
        createHeaderCell('Tên biến đầu vào', 25),
        createHeaderCell('Phân loại', 12),
        createHeaderCell('Bản chất DL', 16),
        createHeaderCell('Khả năng kiểm soát', 18),
        createHeaderCell('Đơn vị', 7),
        createHeaderCell('Phạm vi / Hằng số', 15),
      ],
    }),
    ...project.factors.map(
      (f, idx) =>
        new TableRow({
          children: [
            createDataCell(f.code, idx % 2 === 1, 7),
            createDataCell(f.name, idx % 2 === 1, 25),
            createDataCell(f.type, idx % 2 === 1, 12),
            createDataCell(f.dataType === 'qualitative' ? 'Định tính' : f.dataType === 'quantitative_multilevel' ? 'ĐL nhiều mức' : 'ĐL liên tục', idx % 2 === 1, 16),
            createDataCell(f.controllability === 'constant' ? '🔒 Hằng số' : f.controllability === 'uncontrollable_noise' ? '🌪️ Nhiễu (Noise)' : '🎯 Kiểm soát được', idx % 2 === 1, 18),
            createDataCell(f.unit, idx % 2 === 1, 7),
            createDataCell(f.controllability === 'constant' ? `${f.constantValue ?? f.low}` : `${f.low} - ${f.high}`, idx % 2 === 1, 15),
          ],
        })
    ),
  ];

  sections.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: factorRows,
    }),
    new Paragraph({ text: '', spacing: { after: 200 } })
  );

  // Design Diagnostics & D-Efficiency Table
  const metrics = calculateDesignEfficiency(
    project.runs,
    project.factors,
    project.doeConfig.dOptimalModel || 'Quadratic'
  );

  if (metrics.numRuns > 0) {
    const diagRows = [
      new TableRow({
        children: [
          createHeaderCell('Chỉ số Hiệu quả Thiết kế', 40),
          createHeaderCell('Giá trị Tính toán', 30),
          createHeaderCell('Đánh giá & Ý nghĩa', 30),
        ],
      }),
      new TableRow({
        children: [
          createDataCell('D-Efficiency (Hiệu quả D)', false, 40),
          createDataCell(`${metrics.dEfficiency}%`, false, 30),
          createDataCell(metrics.rating, false, 30),
        ],
      }),
      new TableRow({
        children: [
          createDataCell('A-Efficiency (Hiệu quả A)', true, 40),
          createDataCell(`${metrics.aEfficiency}%`, true, 30),
          createDataCell('Giảm thiểu phương sai ước lượng hệ số', true, 30),
        ],
      }),
      new TableRow({
        children: [
          createDataCell('G-Efficiency (Hiệu quả G)', false, 40),
          createDataCell(`${metrics.gEfficiency}%`, false, 30),
          createDataCell('Kiểm soát phương sai dự đoán cực đại', false, 30),
        ],
      }),
      new TableRow({
        children: [
          createDataCell('Số hệ số mô hình (p) / Bậc tự do (df)', true, 40),
          createDataCell(`p = ${metrics.numParameters}, df = ${metrics.degreesOfFreedom}`, true, 30),
          createDataCell(`Số lần chạy N = ${metrics.numRuns}`, true, 30),
        ],
      }),
    ];

    sections.push(
      new Paragraph({
        text: 'Đánh giá Hiệu quả và Tính Tối ưu của Thiết kế (Design Optimality Diagnostics):',
        spacing: { before: 150, after: 100 },
      }),
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: diagRows,
      }),
      new Paragraph({ text: '', spacing: { after: 300 } })
    );
  }

  // Runs Table
  const runHeaders = [
    createHeaderCell('Std', 6),
    createHeaderCell('Run', 6),
    ...project.factors.map((f) => createHeaderCell(`${f.code} (${f.unit})`)),
    ...project.cqas.map((c) => createHeaderCell(`${c.code} (${c.unit})`)),
  ];

  const runRows = [
    new TableRow({ children: runHeaders }),
    ...project.runs.map((r, idx) => {
      const factorCells = project.factors.map((f) =>
        createDataCell(`${r.factorActual[f.code] ?? '-'}`, idx % 2 === 1)
      );
      const cqaCells = project.cqas.map((c) =>
        createDataCell(`${r.responses[c.code] ?? '-'}`, idx % 2 === 1)
      );
      return new TableRow({
        children: [
          createDataCell(`${r.stdOrder}`, idx % 2 === 1, 6),
          createDataCell(`${r.runOrder}`, idx % 2 === 1, 6),
          ...factorCells,
          ...cqaCells,
        ],
      });
    }),
  ];

  sections.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: runRows,
    }),
    new Paragraph({ text: '', spacing: { after: 300 } })
  );

  // SECTION 5: Statistical ANOVA & Mathematical Models
  sections.push(
    new Paragraph({
      text: '5. Phân tích Thống kê ANOVA & Mô hình Hóa Toán học',
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 300, after: 150 },
    })
  );

  Object.values(models).forEach((model) => {
    const cqa = project.cqas.find((c) => c.code === model.cqaCode);
    sections.push(
      new Paragraph({
        text: `Mô hình cho ${cqa ? cqa.name : model.cqaCode} (${model.cqaCode}) - Dạng mô hình: ${model.modelType}`,
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 200, after: 100 },
      }),
      new Paragraph({
        children: [
          new TextRun({ text: 'Phương trình hồi quy: ', bold: true }),
          new TextRun({ text: model.equationString, italics: true, color: PRIMARY_COLOR }),
        ],
        spacing: { after: 100 },
      }),
      new Paragraph({
        text: `Chỉ số đánh giá: R² = ${model.diagnostics.rSquared.toFixed(4)} | R² hiệu chỉnh = ${model.diagnostics.adjRSquared.toFixed(4)} | R² dự đoán = ${model.diagnostics.predRSquared.toFixed(4)} | Adequate Precision = ${model.diagnostics.adeqPrecision.toFixed(2)} | Độ lệch chuẩn (Std Dev) = ${model.diagnostics.stdDev.toFixed(3)}`,
        spacing: { after: 150 },
      })
    );

    // ANOVA Sub-table
    const anovaRows = [
      new TableRow({
        children: [
          createHeaderCell('Nguồn biến thiên (Source)', 35),
          createHeaderCell('Tổng bình phương (SS)', 20),
          createHeaderCell('Bậc tự do (df)', 15),
          createHeaderCell('Trung bình bình phương (MS)', 20),
          createHeaderCell('F-value', 10),
          createHeaderCell('p-value', 10),
        ],
      }),
      ...model.anova.map(
        (row, idx) =>
          new TableRow({
            children: [
              createDataCell(row.source, idx % 2 === 1, 35),
              createDataCell(row.ss.toFixed(3), idx % 2 === 1, 20),
              createDataCell(`${row.df}`, idx % 2 === 1, 15),
              createDataCell(row.ms.toFixed(3), idx % 2 === 1, 20),
              createDataCell(row.fValue !== undefined ? row.fValue.toFixed(2) : '-', idx % 2 === 1, 10),
              createDataCell(
                row.pValue !== undefined ? (row.pValue < 0.001 ? '< 0.001' : row.pValue.toFixed(4)) : '-',
                idx % 2 === 1,
                10
              ),
            ],
          })
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

  // SECTION 5b: Neural Network Platform (SAS JMP Style)
  if (neuralModels && Object.keys(neuralModels).length > 0) {
    sections.push(
      new Paragraph({
        text: '5b. Mô hình Hóa Phi Tuyến Bằng Mạng Nơ-ron AI (SAS JMP Neural Network Platform)',
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 300, after: 150 },
      }),
      new Paragraph({
        text: 'Áp dụng cấu trúc Multi-Layer Perceptron (MLP) với thuật toán học máy đa vòng lặp (Multi-Tour Optimization) và hàm kích hoạt TanH/Gaussian để mô phỏng các mối tương quan phi tuyến tính phức tạp.',
        spacing: { after: 200 },
      })
    );

    // Neural Comparison Table
    const nnRows = [
      new TableRow({
        children: [
          createHeaderCell('Chỉ tiêu CQA', 16),
          createHeaderCell('Kiến trúc Lớp ẩn', 16),
          createHeaderCell('Train R²', 12),
          createHeaderCell('Val R²', 12),
          createHeaderCell('Overall R²', 12),
          createHeaderCell('RMSE / Best Tour', 16),
          createHeaderCell('Độ quan trọng yếu tố (VIP Ranking)', 16),
        ],
      }),
      ...Object.values(neuralModels).map((nm, idx) => {
        const cqa = project.cqas.find((c) => c.code === nm.cqaCode);
        const vipStr = nm.diagnostics.variableImportance
          .slice(0, 3)
          .map((v) => `${v.factorCode}(${v.relativeImportance}%)`)
          .join(', ');
        return new TableRow({
          children: [
            createDataCell(cqa ? `${cqa.name} (${nm.cqaCode})` : nm.cqaCode, idx % 2 === 1, 16),
            createDataCell(`[${nm.config.hiddenNodes1}${nm.config.hiddenNodes2 > 0 ? `, ${nm.config.hiddenNodes2}` : ''}] ${nm.config.activation.toUpperCase()}`, idx % 2 === 1, 16),
            createDataCell(`${nm.diagnostics.rSquaredTrain}`, idx % 2 === 1, 12),
            createDataCell(`${nm.diagnostics.rSquaredVal}`, idx % 2 === 1, 12),
            createDataCell(`${nm.diagnostics.rSquaredOverall}`, idx % 2 === 1, 12),
            createDataCell(`${nm.diagnostics.rmseOverall} (#${nm.diagnostics.bestTourIndex})`, idx % 2 === 1, 16),
            createDataCell(vipStr || '-', idx % 2 === 1, 16),
          ],
        });
      }),
    ];

    sections.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: nnRows,
      }),
      new Paragraph({ text: '', spacing: { after: 250 } })
    );
  }

  // SECTION 6: Multi-response Desirability & SAS JMP Prediction Profiler
  if (optimum) {
    sections.push(
      new Paragraph({
        text: '6. Tối ưu hóa Đa Mục tiêu theo Hàm Thỏa Dụng (SAS JMP Desirability Profiler)',
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 300, after: 150 },
      }),
      new Paragraph({
        text: `Áp dụng phương pháp Derringer-Suich tổng hợp độ thỏa dụng toàn cục D = exp( ∑(w_i * ln(d_i)) / ∑ w_i ). Điểm vận hành tối ưu toàn cục đạt được Overall Desirability D = ${optimum.overallDesirability}:`,
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
              createDataCell(`${optimum.actualFactors[f.code]} ${f.unit}`, idx % 2 === 1, 40),
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

    // Predicted CQAs table with SE, 95% CI, and individual d_i
    const predCQARows = [
      new TableRow({
        children: [
          createHeaderCell('Chỉ tiêu CQA', 25),
          createHeaderCell('Mục tiêu (Goal)', 15),
          createHeaderCell('Giá trị dự đoán (Mean)', 20),
          createHeaderCell('Sai số SE', 12),
          createHeaderCell('Khoảng tin cậy 95% CI', 16),
          createHeaderCell('Thỏa dụng (d_i)', 12),
        ],
      }),
      ...project.cqas.map((cqa, idx) => {
        const pred = optimum.predictedResponses[cqa.code];
        return new TableRow({
          children: [
            createDataCell(`${cqa.name} (${cqa.code})`, idx % 2 === 1, 25),
            createDataCell(cqa.objective.toUpperCase(), idx % 2 === 1, 15),
            createDataCell(pred ? `${pred.value} ${cqa.unit}` : '-', idx % 2 === 1, 20),
            createDataCell(pred ? `±${pred.se}` : '-', idx % 2 === 1, 12),
            createDataCell(pred ? `[${pred.ciLow} - ${pred.ciHigh}]` : '-', idx % 2 === 1, 16),
            createDataCell(pred ? `${pred.desirability}` : '-', idx % 2 === 1, 12),
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

  // SECTION 7: Control Strategy & Proven Acceptable Range (ICH Q10)
  sections.push(
    new Paragraph({
      text: '7. Chiến lược kiểm soát & Vùng Thiết Kế Liên Tục (Design Space & Control Strategy - ICH Q8/Q10)',
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 300, after: 150 },
    }),
    new Paragraph({
      text: 'Vùng thiết kế được biểu diễn bằng trường biên độ an toàn liên tục Z(x, y) = min(Margin_cqa) ≥ 0, xác lập miền kết hợp đa chiều của các biến đầu vào đảm bảo sản phẩm luôn đạt tiêu chuẩn chất lượng (ICH Q8(R2)).',
      spacing: { after: 150 },
    })
  );

  const csRows = [
    new TableRow({
      children: [
        createHeaderCell('Thông số', 20),
        createHeaderCell('Miền khảo sát (Knowledge Space)', 25),
        createHeaderCell('Phạm vi chấp nhận (PAR)', 25),
        createHeaderCell('Phạm vi vận hành bình thường (NOR)', 30),
      ],
    }),
    ...project.designSpace.map((ds, idx) => {
      const factor = project.factors.find((f) => f.code === ds.factorCode);
      const unit = factor ? factor.unit : '';
      return new TableRow({
        children: [
          createDataCell(factor ? `${factor.name} (${factor.code})` : ds.factorCode, idx % 2 === 1, 20),
          createDataCell(`${ds.knowledgeLow} - ${ds.knowledgeHigh} ${unit}`, idx % 2 === 1, 25),
          createDataCell(`${ds.parLow} - ${ds.parHigh} ${unit}`, idx % 2 === 1, 25),
          createDataCell(`${ds.norLow} - ${ds.norHigh} ${unit} (Target: ${ds.target})`, idx % 2 === 1, 30),
        ],
      });
    }),
  ];

  sections.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: csRows,
    }),
    new Paragraph({ text: '', spacing: { after: 200 } })
  );

  // SECTION 8: Monte Carlo Simulation (ICH Q9)
  if (monteCarlo) {
    sections.push(
      new Paragraph({
        text: '8. Xác minh độ tin cậy Vùng Thiết kế bằng Mô phỏng Monte Carlo (ICH Q9)',
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 300, after: 150 },
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: `Kết quả mô phỏng ${monteCarlo.simulations.toLocaleString()} lô ảo: `,
            bold: true,
          }),
          new TextRun({
            text: `Tỷ lệ đạt chuẩn 100% CQAs = ${monteCarlo.reliabilityPercent}% | Tỷ lệ lỗi dự kiến (Defect Rate) = ${monteCarlo.defectRatePPM.toLocaleString()} PPM`,
            color: monteCarlo.reliabilityPercent >= 99 ? '15803D' : 'B91C1C',
            bold: true,
          }),
        ],
        spacing: { after: 250 },
      })
    );
  }

  // SECTION 9: Regulatory Sign-off & Quality Assurance Approval
  sections.push(
    new Paragraph({
      text: '9. Kết Luận & Phê Duyệt Hồ Sơ Phát Triển Dược Phẩm (Sign-off & Approval)',
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 300, after: 150 },
    }),
    new Paragraph({
      text: 'Báo cáo này xác nhận Vùng Thiết Kế và Chiến Lược Kiểm Soát đã được xây dựng trên nền tảng khoa học vững chắc và quản lý rủi ro chất lượng, đáp ứng đầy đủ yêu cầu đăng ký thuốc theo hướng dẫn ICH CTD Module 3.2.P.2.',
      spacing: { after: 250 },
    })
  );

  const signRows = [
    new TableRow({
      children: [
        createHeaderCell('NGƯỜI LẬP BÁO CÁO (Scientist)', 33),
        createHeaderCell('TRƯỞNG NHÓM R&D (Formulation Lead)', 34),
        createHeaderCell('ĐẢM BẢO CHẤT LƯỢNG (QA Director)', 33),
      ],
    }),
    new TableRow({
      children: [
        createDataCell('\n\n\n\nKý tên: .......................................\nHọ tên: ' + (project.author || 'Nghiên cứu viên'), false, 33),
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
  saveAs(blob, `QbD_DoE_Report_${project.moleculeName.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.docx`);
}
