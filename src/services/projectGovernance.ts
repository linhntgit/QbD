import type {
  DesirabilitySolution,
  Factor,
  MonteCarloResult,
  NeuralNetModelResult,
  QBDProject,
  StatisticalModelResult,
} from '../types/qbd';
import { getFactorDesignBounds } from './doeGenerator';

export interface ProjectAuditEntry {
  id: string;
  timestamp: string;
  action: string;
  versionLabel: string;
}

export interface ProjectVersionSnapshot extends ProjectAuditEntry {
  project: QBDProject;
}

export interface ProjectValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface ReportReadinessResult extends ProjectValidationResult {
  readyForScientificReport: boolean;
}

const storageAvailable = (): boolean => {
  try {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
  } catch {
    return false;
  }
};
const projectKey = (projectId: string) => `qbd.project.${projectId}`;
const historyKey = (projectId: string) => `qbd.project.history.${projectId}`;

const cloneProject = (project: QBDProject): QBDProject => JSON.parse(JSON.stringify(project)) as QBDProject;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

import { z } from 'zod';

export const factorSchema = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string(),
  type: z.string(),
  dataType: z.string(),
  controllability: z.string(),
  role: z.string().optional(),
  unit: z.string(),
  low: z.number(),
  high: z.number(),
  center: z.number().optional(),
  alpha: z.number().optional(),
  categories: z.array(z.string()).optional(),
  constantValue: z.union([z.number(), z.string()]).optional(),
  currentValue: z.number().optional(),
  distribution: z.enum(['Normal', 'Lognormal', 'Uniform', 'Triangular']).optional(),
  distParams: z.object({
    mean: z.number().optional(),
    sd: z.number().optional(),
    min: z.number().optional(),
    mode: z.number().optional(),
    max: z.number().optional(),
  }).optional(),
}).passthrough();

export const cqaSchema = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string(),
  dataType: z.string().optional(),
  unit: z.string(),
  target: z.number().optional(),
  lowerLimit: z.number().optional(),
  upperLimit: z.number().optional(),
  categories: z.array(z.string()).optional(),
  targetCategory: z.string().optional(),
  objective: z.string(),
  weight: z.number(),
  sShape: z.number().optional(),
  tShape: z.number().optional(),
}).passthrough();

export const qtppSchema = z.object({
  id: z.string(),
  element: z.string(),
  target: z.string(),
  justification: z.string(),
}).passthrough();

export const fmeaRiskSchema = z.object({
  id: z.string(),
  factorId: z.string(),
  cqaId: z.string(),
  failureMode: z.string().optional(),
  severity: z.number().optional(),
  probability: z.number().optional(),
  detectability: z.number().optional(),
  rpn: z.number().optional(),
  mitigation: z.string().optional(),
  revisedSeverity: z.number().optional(),
  revisedProbability: z.number().optional(),
  revisedDetectability: z.number().optional(),
  revisedRpn: z.number().optional(),
}).passthrough();

export const doeRunSchema = z.object({
  id: z.string(),
  runOrder: z.number().optional(),
  standardOrder: z.number().optional(),
  stdOrder: z.number().optional(),
  block: z.number().optional(),
  factorCoded: z.record(z.string(), z.union([z.number(), z.string()])),
  factorActual: z.record(z.string(), z.union([z.number(), z.string()])),
  responses: z.record(z.string(), z.union([z.number(), z.string()])),
  included: z.boolean().optional(),
  comment: z.string().optional(),
}).passthrough();

export const designSpaceRangesSchema = z.object({
  factorCode: z.string(),
  minCoded: z.number().optional(),
  maxCoded: z.number().optional(),
  minActual: z.number().optional(),
  maxActual: z.number().optional(),
  parMin: z.number().optional(),
  parMax: z.number().optional(),
  parMinActual: z.number().optional(),
  parMaxActual: z.number().optional(),
  norMin: z.number().optional(),
  norMax: z.number().optional(),
}).passthrough();

export const qbdProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  moleculeName: z.string(),
  dosageForm: z.string(),
  author: z.string(),
  version: z.string(),
  createdDate: z.string(),
  updatedDate: z.string(),
  description: z.string(),
  qtpp: z.array(qtppSchema).max(100, 'Tối đa 100 mục QTPP'),
  cqas: z.array(cqaSchema).max(50, 'Tối đa 50 chỉ tiêu CQA'),
  factors: z.array(factorSchema).max(50, 'Tối đa 50 yếu tố thí nghiệm (SEC-04)'),
  fmeaRisks: z.array(fmeaRiskSchema).max(500, 'Tối đa 500 mục rủi ro FMEA'),
  fishbone: z.any().optional(),
  doeConfig: z.record(z.string(), z.any()),
  runs: z.array(doeRunSchema).max(5000, 'Tối đa 5.000 lần chạy (SEC-04)'),
  designSpace: z.array(designSpaceRangesSchema).max(50),
  modelingEngine: z.string().optional(),
  analysisProvenance: z.record(z.string(), z.any()).optional(),
  analysisSettings: z.record(z.string(), z.any()).optional(),
}).passthrough();

export interface SchemaValidationResult {
  success: boolean;
  data?: QBDProject;
  errors: string[];
}

export function validateProjectSchema(value: unknown): SchemaValidationResult {
  const result = qbdProjectSchema.safeParse(value);
  if (result.success) {
    return { success: true, data: result.data as unknown as QBDProject, errors: [] };
  }
  const errors = result.error.issues.map((issue) => {
    const path = issue.path.join('.');
    return `${path ? `[${path}] ` : ''}${issue.message}`;
  });
  return { success: false, errors };
}

/** Check persisted/JSON data before any component or model dereferences it.
 * Keep this separate from scientific validation: an unfinished draft is loadable.
 */
export function hasProjectStructure(value: unknown): value is QBDProject {
  return validateProjectSchema(value).success;
}

export function loadPersistedProject(): QBDProject | null {
  if (!storageAvailable()) return null;
  try {
    const value = window.localStorage.getItem('qbd.project.last');
    const parsed: unknown = value ? JSON.parse(value) : null;
    return hasProjectStructure(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function persistProject(project: QBDProject): boolean {
  if (!storageAvailable()) return false;
  try {
    const serialized = JSON.stringify(project);
    window.localStorage.setItem(projectKey(project.id), serialized);
    window.localStorage.setItem('qbd.project.last', serialized);
    return true;
  } catch {
    return false;
  }
}

export function getProjectHistory(projectId: string): ProjectVersionSnapshot[] {
  if (!storageAvailable()) return [];
  try {
    const value = window.localStorage.getItem(historyKey(projectId));
    const parsed: unknown = value ? JSON.parse(value) : [];
    return Array.isArray(parsed) ? parsed.filter((entry): entry is ProjectVersionSnapshot =>
      isRecord(entry) && typeof entry.id === 'string' && typeof entry.timestamp === 'string' &&
      typeof entry.action === 'string' && typeof entry.versionLabel === 'string' && hasProjectStructure(entry.project)) : [];
  } catch {
    return [];
  }
}

export function pruneProjectForHistory(project: QBDProject): QBDProject {
  const cloned = cloneProject(project);
  if (cloned.analysisSettings?.neuralArtifacts) {
    delete cloned.analysisSettings.neuralArtifacts;
  }
  return cloned;
}

export function recordProjectVersion(project: QBDProject, action: string): boolean {
  if (!storageAvailable()) return false;
  try {
    const history = getProjectHistory(project.id);
    const timestamp = new Date().toISOString();
    const snapshot: ProjectVersionSnapshot = {
      id: `${project.id}-${Date.now()}`,
      timestamp,
      action,
      versionLabel: project.version || 'working copy',
      project: pruneProjectForHistory(project),
    };
    let snapshots = [snapshot, ...history].slice(0, 10);
    while (snapshots.length > 0) {
      try {
        window.localStorage.setItem(historyKey(project.id), JSON.stringify(snapshots));
        return true;
      } catch {
        if (snapshots.length > 1) {
          snapshots = snapshots.slice(0, Math.ceil(snapshots.length / 2));
        } else {
          return false;
        }
      }
    }
    return false;
  } catch {
    return false;
  }
}

export function validateProjectTemplate(project: QBDProject): ProjectValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!hasProjectStructure(project)) return { valid: false, errors: ['Cấu trúc QbD Project không hợp lệ hoặc thiếu trường bắt buộc.'], warnings };
  if (!project.name.trim()) errors.push('Thiếu tên project.');
  if (project.cqas.length === 0) errors.push('Cần ít nhất một CQA.');
  if (project.factors.length === 0) errors.push('Cần ít nhất một factor.');
  const factorCodes = new Set<string>();
  project.factors.forEach((factor) => {
    if (factorCodes.has(factor.code)) errors.push(`Mã factor trùng: ${factor.code}.`);
    factorCodes.add(factor.code);
    if (factor.controllability !== 'constant' && factor.dataType !== 'qualitative' && factor.high <= factor.low) {
      errors.push(`${factor.code}: cận trên phải lớn hơn cận dưới.`);
    }
    if ((factor.dataType === 'qualitative' || factor.dataType === 'quantitative_multilevel')) {
      const levels = (factor.categories ?? []).map((level) => level.trim()).filter(Boolean);
      if (levels.length < 2 || levels.length > 10) errors.push(`${factor.code}: phải khai báo từ 2 đến 10 mức.`);
      if (factor.dataType === 'quantitative_multilevel' && levels.some((level) => !Number.isFinite(Number(level)))) {
        errors.push(`${factor.code}: các mức định lượng phải là số hữu hạn.`);
      }
      if (new Set(levels).size !== levels.length) errors.push(`${factor.code}: các mức không được trùng nhau.`);
      if (factor.dataType === 'quantitative_multilevel' && new Set(levels.map(Number)).size !== levels.length) {
        errors.push(`${factor.code}: các mức định lượng không được trùng nhau về giá trị.`);
      }
    }
  });
  const cqaCodes = new Set<string>();
  project.cqas.forEach((cqa) => {
    if (cqaCodes.has(cqa.code)) errors.push(`Mã CQA trùng: ${cqa.code}.`);
    cqaCodes.add(cqa.code);
    if (cqa.lowerLimit !== undefined && cqa.upperLimit !== undefined && cqa.upperLimit < cqa.lowerLimit) {
      errors.push(`${cqa.code}: USL phải lớn hơn hoặc bằng LSL.`);
    }
  });
  const mixture = project.factors.filter((factor) => factor.role === 'mixture_component' || factor.type === 'Mixture');
  if (mixture.length > 0) {
    const asProportion = (value: number, high: number, unit: string) => high <= 1 && unit !== '%' ? value : value / 100;
    const lower = mixture.reduce((sum, factor) => sum + asProportion(factor.low, factor.high, factor.unit), 0);
    const upper = mixture.reduce((sum, factor) => sum + asProportion(factor.high, factor.high, factor.unit), 0);
    if (lower > 1 + 1e-10 || upper < 1 - 1e-10) errors.push('Giới hạn mixture không khả thi (Σlower ≤ 100% ≤ Σupper).');
  }
  const seenRunOrders = new Set<number>();
  const seenStdOrders = new Set<number>();
  const asProportion = (value: number, factor: Factor) => factor.high <= 1 && factor.unit !== '%' ? value : value / 100;
  project.runs.forEach((run, index) => {
    const runLabel = `Run ${run.runOrder ?? index + 1}`;
    if (!Number.isInteger(run.runOrder) || run.runOrder <= 0) errors.push(`${runLabel}: RunOrder phải là số nguyên dương.`);
    else if (seenRunOrders.has(run.runOrder)) errors.push(`${runLabel}: RunOrder bị trùng.`);
    else seenRunOrders.add(run.runOrder);
    if (!Number.isInteger(run.stdOrder) || run.stdOrder <= 0) errors.push(`${runLabel}: StdOrder phải là số nguyên dương.`);
    else if (seenStdOrders.has(run.stdOrder)) errors.push(`${runLabel}: StdOrder bị trùng.`);
    else seenStdOrders.add(run.stdOrder);

    project.factors.forEach((factor) => {
      const designBounds = getFactorDesignBounds(factor, project.doeConfig);
      const coded = run.factorCoded[factor.code];
      const actual = run.factorActual[factor.code];
      if (factor.controllability === 'constant') return;
      if (factor.dataType === 'qualitative') {
        if (actual === undefined || actual === null || actual === '') errors.push(`${runLabel}: thiếu mức của ${factor.code}.`);
        else if (factor.categories?.length && !factor.categories.includes(String(actual))) errors.push(`${runLabel}: ${factor.code} có mức '${actual}' ngoài các category đã khai báo.`);
        return;
      }
      if (!Number.isFinite(coded)) errors.push(`${runLabel}: ${factor.code} thiếu/không hợp lệ ở coded scale.`);
      if (typeof actual !== 'number' || !Number.isFinite(actual)) errors.push(`${runLabel}: ${factor.code} thiếu/không hợp lệ ở actual scale.`);
      else if (factor.dataType === 'quantitative_multilevel' && factor.categories?.length && !factor.categories.some((level) => Number(level) === actual)) {
        errors.push(`${runLabel}: ${factor.code} có mức '${actual}' ngoài các mức định lượng đã khai báo.`);
      } else if (actual < designBounds.low - 1e-8 || actual > designBounds.high + 1e-8) errors.push(`${runLabel}: ${factor.code} nằm ngoài dải khảo sát.`);
    });

    if (mixture.length >= 2) {
      const total = mixture.reduce((sum, factor) => sum + (Number(run.factorCoded[factor.code]) || 0), 0);
      if (Math.abs(total - 1) > 1e-6) errors.push(`${runLabel}: coded mixture phải có tổng bằng 1.000000.`);
      const actualTotal = mixture.reduce((sum, factor) => sum + asProportion(Number(run.factorActual[factor.code]), factor), 0);
      if (!Number.isFinite(actualTotal) || Math.abs(actualTotal - 1) > 1e-6) errors.push(`${runLabel}: actual mixture phải có tổng bằng 100%.`);
    }

    project.cqas.forEach((cqa) => {
      const response = run.responses[cqa.code];
      if (response === undefined || response === null || response === '') return;
      if (!cqa.dataType?.startsWith('qualitative') && (typeof response !== 'number' || !Number.isFinite(response))) {
        errors.push(`${runLabel}: đáp ứng ${cqa.code} phải là số hữu hạn.`);
      }
    });
  });
  if (project.runs.length === 0) warnings.push('Chưa có run thực nghiệm; protocol trước chạy có thể xuất nhưng chưa có báo cáo sau chạy.');
  if (project.runs.some((run) => Object.keys(run.responses).length === 0)) warnings.push('Một số run chưa có kết quả; các kết luận mô hình có thể chưa hoàn chỉnh.');
  return { valid: errors.length === 0, errors, warnings };
}

/** A final scientific report requires a valid project and complete CQA data. */
export function getReportReadiness(
  project: QBDProject,
  models: Record<string, StatisticalModelResult | NeuralNetModelResult>,
  optimum: DesirabilitySolution | null,
  monteCarlo: MonteCarloResult | null,
): ReportReadinessResult {
  const validation = validateProjectTemplate(project);
  const errors = [...validation.errors];
  const warnings = [...validation.warnings];
  const incomplete = project.runs.flatMap((run) => project.cqas
    .filter((cqa) => run.responses[cqa.code] === undefined || run.responses[cqa.code] === null || run.responses[cqa.code] === '')
    .map((cqa) => `Run ${run.runOrder}: thiếu ${cqa.code}.`));
  warnings.push(...incomplete);

  project.cqas.forEach((cqa) => {
    if (cqa.dataType?.startsWith('qualitative') || cqa.objective === 'pass_category') {
      warnings.push(`${cqa.code}: chưa có mô hình logistic/ordinal; CQA định tính chỉ được báo cáo mô tả.`);
      return;
    }
    const model = models[cqa.code];
    if (!model) {
      errors.push(`${cqa.code}: không có mô hình khả định cho báo cáo khoa học.`);
      return;
    }
    if ('terms' in model) {
      const df = model.residualDegreesOfFreedom ?? 0;
      const q2 = model.diagnostics.qSquared ?? model.diagnostics.predRSquared;
      const pLof = model.diagnostics.pLOF;
      if (df <= 0) errors.push(`${cqa.code}: mô hình không còn bậc tự do dư.`);
      else if (df < 4) warnings.push(`${cqa.code}: chỉ có ${df} bậc tự do dư; độ chính xác suy luận thấp.`);
      if (!Number.isFinite(q2) || q2 < 0) errors.push(`${cqa.code}: Q²/predicted R² không hợp lệ hoặc âm.`);
      if (pLof !== undefined && pLof < 0.05) errors.push(`${cqa.code}: lack-of-fit có ý nghĩa (p < 0,05).`);
      if (pLof === undefined) warnings.push(`${cqa.code}: chưa ước lượng được lack-of-fit do thiếu pure-error replication.`);
    } else {
      if (model.config.validationMethod === 'none') errors.push(`${cqa.code}: NN chưa có validation holdout.`);
      if (!Number.isFinite(model.diagnostics.rSquaredVal)) errors.push(`${cqa.code}: NN không có chỉ số validation hợp lệ.`);
      if ((model.parameterCount ?? 0) >= (model.diagnostics.trainingSampleCount ?? model.diagnostics.residuals.filter((item) => !item.isValidation).length)) {
        errors.push(`${cqa.code}: số tham số NN không nhỏ hơn số mẫu training.`);
      }
    }
  });

  if (!optimum) errors.push('Chưa có nghiệm tối ưu đa đáp ứng có thể tái lập.');
  if (!monteCarlo) errors.push('Chưa có đánh giá Monte Carlo dùng chung với báo cáo.');
  else {
    if (monteCarlo.reliabilityPercent < 99) warnings.push(`Monte Carlo reliability chỉ đạt ${monteCarlo.reliabilityPercent}%.`);
    if (monteCarlo.unmodeledCqaCodes.length > 0) {
      warnings.push(`Monte Carlo chưa bao phủ CQA: ${monteCarlo.unmodeledCqaCodes.join(', ')}; chỉ được diễn giải cho CQA đã mô hình hóa.`);
    }
    if (monteCarlo.excursionCount > 0) {
      warnings.push(`${monteCarlo.excursionRatePercent}% lô ảo vượt ngoài vùng khảo sát và đã được tính là thất bại.`);
    }
  }
  if (project.designSpace.length === 0) errors.push('Chưa lưu vùng vận hành provisional screening vào project.');
  warnings.push('Confirmation run độc lập chưa được quản lý như một trạng thái phê duyệt; cần xác nhận ngoài app trước quyết định đăng ký.');

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    readyForScientificReport: errors.length === 0 && project.runs.length > 0 && incomplete.length === 0,
  };
}

export function compareProjectVersions(current: QBDProject, previous: QBDProject): string[] {
  const changes: string[] = [];
  if (current.name !== previous.name) changes.push('Thông tin định danh project đã thay đổi.');
  if (current.factors.length !== previous.factors.length) changes.push(`Số factor: ${previous.factors.length} → ${current.factors.length}.`);
  if (current.cqas.length !== previous.cqas.length) changes.push(`Số CQA: ${previous.cqas.length} → ${current.cqas.length}.`);
  if (current.runs.length !== previous.runs.length) changes.push(`Số run: ${previous.runs.length} → ${current.runs.length}.`);
  if (JSON.stringify(current.doeConfig) !== JSON.stringify(previous.doeConfig)) changes.push('Cấu hình DoE đã thay đổi.');
  if (JSON.stringify(current.designSpace) !== JSON.stringify(previous.designSpace)) changes.push('Design Space/PAR đã thay đổi.');
  return changes.length > 0 ? changes : ['Không phát hiện thay đổi cấu trúc ở các trường trọng yếu.'];
}

export function getTraceabilitySummary(project: QBDProject): { protocolId: string; runStatus: string; validation: ProjectValidationResult } {
  const validation = validateProjectTemplate(project);
  const completedRuns = project.runs.filter((run) => Object.values(run.responses).some((value) => value !== null && value !== undefined && value !== '')).length;
  return {
    protocolId: `QBD-${project.id.slice(-8).toUpperCase()}-v${project.version || 'working'}`,
    runStatus: `${completedRuns}/${project.runs.length} run có dữ liệu đáp ứng`,
    validation,
  };
}
