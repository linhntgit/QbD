import type {
  DesirabilitySolution,
  Factor,
  MonteCarloResult,
  NeuralNetModelResult,
  QBDProject,
  StatisticalModelResult,
} from '../types/qbd';

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

const storageAvailable = (): boolean => typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
const projectKey = (projectId: string) => `qbd.project.${projectId}`;
const historyKey = (projectId: string) => `qbd.project.history.${projectId}`;

const cloneProject = (project: QBDProject): QBDProject => JSON.parse(JSON.stringify(project)) as QBDProject;

export function loadPersistedProject(): QBDProject | null {
  if (!storageAvailable()) return null;
  try {
    const value = window.localStorage.getItem('qbd.project.last');
    return value ? JSON.parse(value) as QBDProject : null;
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
    return value ? JSON.parse(value) as ProjectVersionSnapshot[] : [];
  } catch {
    return [];
  }
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
      project: cloneProject(project),
    };
    window.localStorage.setItem(historyKey(project.id), JSON.stringify([snapshot, ...history].slice(0, 25)));
    return true;
  } catch {
    return false;
  }
}

export function validateProjectTemplate(project: QBDProject): ProjectValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
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
    if (factor.dataType === 'qualitative' && (factor.categories?.length ?? 0) > 2) {
      errors.push(`${factor.code}: categorical nhiều hơn hai mức chưa có one-hot/effect coding; không thể dùng để tạo mô hình hoặc xuất báo cáo khoa học.`);
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
      else if (actual < factor.low - 1e-8 || actual > factor.high + 1e-8) errors.push(`${runLabel}: ${factor.code} nằm ngoài dải khảo sát.`);
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
      if ((model.parameterCount ?? 0) >= model.diagnostics.residuals.filter((item) => !item.isValidation).length) {
        errors.push(`${cqa.code}: số tham số NN không nhỏ hơn số mẫu training.`);
      }
    }
  });

  if (!optimum) errors.push('Chưa có nghiệm tối ưu đa đáp ứng có thể tái lập.');
  if (!monteCarlo) errors.push('Chưa có đánh giá Monte Carlo dùng chung với báo cáo.');
  else if (monteCarlo.reliabilityPercent < 99) warnings.push(`Monte Carlo reliability chỉ đạt ${monteCarlo.reliabilityPercent}%.`);
  if (project.designSpace.length === 0) warnings.push('Chưa lưu vùng vận hành provisional/PAR screening vào project.');
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
