import type { QBDProject } from '../types/qbd';

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

export function persistProject(project: QBDProject): void {
  if (!storageAvailable()) return;
  try {
    const serialized = JSON.stringify(project);
    window.localStorage.setItem(projectKey(project.id), serialized);
    window.localStorage.setItem('qbd.project.last', serialized);
  } catch {
    // Browser storage is an optional convenience layer; the user can still use JSON export.
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

export function recordProjectVersion(project: QBDProject, action: string): void {
  if (!storageAvailable()) return;
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
  } catch {
    // Do not block scientific work because local browser storage is unavailable.
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
  if (project.runs.length === 0) warnings.push('Chưa có run thực nghiệm; protocol trước chạy có thể xuất nhưng chưa có báo cáo sau chạy.');
  if (project.runs.some((run) => Object.keys(run.responses).length === 0)) warnings.push('Một số run chưa có kết quả; các kết luận mô hình có thể chưa hoàn chỉnh.');
  return { valid: errors.length === 0, errors, warnings };
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
