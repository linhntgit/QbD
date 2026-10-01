import type { QBDProject, DesirabilitySolution, StatisticalModelResult, NeuralNetModelResult, DoERun } from '../types/qbd';
import type { ConfirmationStudy, ConfirmationRun, FrozenResponse } from '../types/confirmation';
import { actualToCoded, getConfiguredFactorLevels, isDiscreteFactor } from './doeGenerator';
import { buildModelTerms } from './modelTerms';
import { hydrateNeuralModels, serializeNeuralModels } from './neuralNetwork';
import { tDistributionCritical } from './mathUtils';
import { canonicalJsonStringify, sha256 } from './cryptoSha256';

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
export const confirmationSourceHash = (project: QBDProject) => sha256(canonicalJsonStringify({
  factors: project.factors, cqas: project.cqas, runs: project.runs,
  engine: project.analysisSettings?.modelingEngine ?? project.modelingEngine,
  types: project.analysisSettings?.modelTypes, neural: project.analysisSettings?.neuralArtifacts,
}));

export function createConfirmationStudy(project: QBDProject, solution: DesirabilitySolution,
  models: Record<string, StatisticalModelResult | NeuralNetModelResult>): ConfirmationStudy {
  const responses: FrozenResponse[] = project.cqas.map(cqa => {
    const model = models[cqa.code];
    const predicted = model?.predict(solution.codedFactors);
    const result: FrozenResponse = { cqa: clone(cqa), predicted: Number.isFinite(predicted) ? predicted! : null, toleranceMode: 'absolute' };
    if (model && 'terms' in model) {
      const terms = buildModelTerms(project.factors.filter(f => f.controllability !== 'constant'), model.modelType);
      result.model = { kind: 'ols', modelType: model.modelType,
        coefficients: terms.map(t => model.terms.find(v => v.name === t.name)?.coefficient ?? NaN),
        covariance: model.predictionCovariance, residualSD: model.diagnostics.stdDev, df: model.residualDegreesOfFreedom ?? 0 };
    } else if (model) result.model = { kind: 'ann', artifact: serializeNeuralModels({ [cqa.code]: model })[cqa.code] };
    return result;
  });
  return clone({ id: crypto.randomUUID(), name: `Xác nhận #${(project.confirmationStudies?.length ?? 0) + 1}`,
    createdAt: new Date().toISOString(), sourceHash: confirmationSourceHash(project), sourceVersion: project.version,
    factors: project.factors, sourceBlocks: [...new Set(project.runs.map(r => Math.max(1, Math.floor(r.block ?? 1))))].sort((a,b) => a-b),
    solution, originalSolution: solution, responses, plannedReplicates: 3, confidence: 0.95, specificationBasis: 'individual', status: 'draft', runs: [],
    history: [{ at: new Date().toISOString(), action: 'Tạo kế hoạch từ phương án tối ưu; chưa nhập kết quả.' }] });
}

export function newConfirmationRun(study: ConfirmationStudy): ConfirmationRun {
  return { id: crypto.randomUUID(), batch: `Mẻ ${study.runs.length + 1}`, date: new Date().toISOString().slice(0,10), notes: '',
    actualFactors: clone(study.solution.actualFactors), responses: {} };
}

export function validateConfirmationFactors(study: ConfirmationStudy, actual: Record<string, number | string>): string[] {
  const errors: string[] = [];
  let mixtureTotal = 0, mixtureCount = 0;
  for (const f of study.factors) {
    const value = actual[f.code];
    if (value === undefined || String(value).trim() === '') { errors.push(`${f.code}: thiếu giá trị`); continue; }
    if (f.controllability === 'constant' && String(value) !== String(f.constantValue ?? f.low)) errors.push(`${f.code}: khác giá trị cố định`);
    if (isDiscreteFactor(f) && !getConfiguredFactorLevels(f).some(v => String(v) === String(value))) errors.push(`${f.code}: không thuộc mức đã thiết kế`);
    if (f.dataType !== 'qualitative') {
      if (!Number.isFinite(Number(value))) errors.push(`${f.code}: phải là số hữu hạn`);
      else if (Number(value) < f.low || Number(value) > f.high) errors.push(`${f.code}: ngoài miền low–high; cần đánh giá ngoại suy riêng`);
    }
    if (f.role === 'mixture_component' || f.type === 'Mixture') { mixtureCount++; mixtureTotal += actualToCoded(value, f); }
  }
  if (mixtureCount && Math.abs(mixtureTotal - 1) > 1e-6) errors.push('Tổng thành phần hỗn hợp phải bằng 100% (hoặc 1).');
  return errors;
}

function frozenPrediction(study: ConfirmationStudy, response: FrozenResponse, actual: Record<string, number | string>) {
  const coded = Object.fromEntries(study.factors.map(f => [f.code, actualToCoded(actual[f.code], f)]));
  const model = response.model;
  if (!model) return { predicted: null, features: [] as number[] };
  if (model.kind === 'ols') {
    const features = buildModelTerms(study.factors.filter(f => f.controllability !== 'constant'), model.modelType).map(t => t.evaluator(coded));
    const value = features.reduce((sum, x, i) => sum + x * model.coefficients[i], 0);
    return { predicted: Number.isFinite(value) ? value : null, features };
  }
  const runs = study.sourceBlocks.map(block => ({ block })) as DoERun[];
  const hydrated = hydrateNeuralModels({ [response.cqa.code]: model.artifact }, study.factors, runs);
  const value = hydrated[response.cqa.code]?.predict(coded);
  return { predicted: Number.isFinite(value) ? value : null, features: [] as number[] };
}

export function reviseConfirmationSetpoint(study: ConfirmationStudy, actual: Record<string, number | string>): Partial<ConfirmationStudy> {
  if (study.status !== 'draft') throw new Error('Điều kiện kế hoạch đã chốt.');
  const errors = validateConfirmationFactors(study, actual);
  if (errors.length) throw new Error(errors.join('; '));
  const coded = Object.fromEntries(study.factors.map(f=>[f.code,actualToCoded(actual[f.code],f)]));
  // Overall desirability stays as provenance for the selected optimum; the
  // revised point is assessed through fresh per-response predictions below.
  return { originalSolution: study.originalSolution ?? clone(study.solution),
    solution: { ...study.solution, actualFactors: clone(actual), codedFactors: coded, predictedResponses: {} },
    responses: study.responses.map(r=>({...r,predicted:frozenPrediction(study,r,actual).predicted})) };
}

export type Verdict = 'pass' | 'fail' | 'unavailable';
export const verdictLabel = (value: Verdict) => value === 'pass' ? 'Đạt' : value === 'fail' ? 'Không đạt' : 'Chưa đủ cơ sở';
const average = (xs: number[]) => xs.reduce((s,x) => s+x,0)/xs.length;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const varianceAt = (x: number[], cov: number[][]) => x.reduce((s,a,i) => s+a*x.reduce((t,b,j) => t+b*(cov[i]?.[j] ?? NaN),0),0);
export const formatConfirmationNumber = (value: number | string | null | undefined) => finite(value) ? Number(value.toPrecision(6)).toString() : typeof value==='string' && value.trim() ? value : '—';

export function evaluateConfirmation(study: ConfirmationStudy, response: FrozenResponse) {
  const warnings: string[] = [];
  if (response.cqa.dataType?.startsWith('qualitative')) {
    const code = response.cqa.code;
    const target = response.cqa.targetCategory;
    const categories = response.cqa.categories ?? [];
    const rows = study.runs.map(run => {
      const errors = validateConfirmationFactors(study,run.actualFactors);
      const actual = run.responses[code];
      if (actual !== null && actual !== undefined && !categories.includes(String(actual))) errors.push(`${code}: không thuộc danh mục đã định nghĩa`);
      return { run, actual: actual === null || actual === undefined ? null : String(actual), predicted: null, features: [] as number[], error: null,
        halfWidth: null, errors, pi: 'unavailable' as Verdict };
    });
    const batches=study.runs.map(r=>r.batch.trim());
    const duplicate=batches.some((b,i)=>!b||batches.indexOf(b)!==i);
    const valid=rows.filter(r=>r.actual!==null&&r.errors.length===0);
    const complete=valid.length>=study.plannedReplicates&&valid.length===rows.length&&!duplicate;
    const failure=target && valid.some(r=>r.actual!==target);
    const specification: Verdict=!target||!valid.length?'unavailable':failure?'fail':complete?'pass':'unavailable';
    if (!target) warnings.push('Chưa định nghĩa mức chất lượng đích cho đáp ứng phân loại.');
    if (!complete) warnings.push(`Chưa đủ dữ liệu hợp lệ: ${valid.length}/${study.plannedReplicates} thí nghiệm dự kiến.`);
    if (duplicate) warnings.push('Mã mẻ thiếu hoặc trùng: chưa đủ cơ sở coi các dòng là thí nghiệm độc lập.');
    warnings.push('Đáp ứng phân loại: đánh giá từng mẻ theo mức đích; không tính bias, RMSE hoặc PI số học.');
    return { n:valid.length, mean:null, sd:null, predictedMean:null, bias:null, plannedBias:null, absoluteBias:null, relative:null, rmse:null,
      meanPI:null, rows, specification, practical:'unavailable' as Verdict,predictive:'unavailable' as Verdict,equivalence:'unavailable' as Verdict,
      eqHalf:null,warnings,complete };
  }
  const model = response.model;
  const covariance = model?.kind === 'ols' ? model.covariance : undefined;
  const uncertainty = model?.kind === 'ols' && model.df > 0 && finite(model.residualSD) && model.residualSD >= 0 && covariance && study.sourceBlocks.length <= 1;
  const critical = uncertainty ? tDistributionCritical(1-study.confidence, model.df) : null;
  if (!uncertainty) warnings.push(study.sourceBlocks.length > 1 ? 'Mô hình nhiều block: dự đoán ở block tham chiếu; chưa có PI cho mẻ/block mới.' : 'Chưa có khoảng dự đoán hợp lệ.');
  const batches = study.runs.map(r => r.batch.trim());
  const duplicateBatch = batches.some((b,i) => !b || batches.indexOf(b) !== i);
  if (duplicateBatch) warnings.push('Mã mẻ thiếu hoặc trùng: chưa đủ cơ sở coi các dòng là thí nghiệm độc lập.');
  const rows = study.runs.map(run => {
    const errors = validateConfirmationFactors(study, run.actualFactors);
    const prediction = errors.length ? { predicted: null, features: [] as number[] } : frozenPrediction(study, response, run.actualFactors);
    const actual = run.responses[response.cqa.code];
    const error = finite(actual) && finite(prediction.predicted) ? actual-prediction.predicted : null;
    const variance = uncertainty && prediction.features.length ? varianceAt(prediction.features, covariance) : NaN;
    const halfWidth = critical !== null && model?.kind === 'ols' && finite(variance) && variance >= -1e-10 ? critical * Math.sqrt(Math.max(0,variance)+model.residualSD**2) : null;
    return { run, actual: finite(actual) ? actual : null, ...prediction, error, halfWidth, errors,
      pi: error !== null && halfWidth !== null ? (Math.abs(error) <= halfWidth ? 'pass' : 'fail') as Verdict : 'unavailable' as Verdict };
  });
  const observed = rows.filter(r => r.actual !== null);
  const usable = rows.filter(r => r.actual !== null && r.error !== null);
  const n = observed.length;
  const complete = n >= study.plannedReplicates && n === study.runs.length && rows.every(r=>r.errors.length===0)
    && (!model || usable.length === n) && !duplicateBatch;
  const mean = n ? average(observed.map(r => r.actual!)) : null;
  const sd = n > 1 ? Math.sqrt(observed.reduce((s,r) => s+(r.actual!-mean!)**2,0)/(n-1)) : null;
  const predictedMean = usable.length ? average(usable.map(r => r.predicted!)) : null;
  const bias = usable.length ? average(usable.map(r => r.error!)) : null;
  const rmse = usable.length ? Math.sqrt(average(usable.map(r => r.error!**2))) : null;
  const relative = bias !== null && predictedMean !== null && Math.abs(predictedMean) > 1e-8 ? 100*bias/Math.abs(predictedMean) : null;
  const plannedBias = mean !== null && response.predicted !== null ? mean-response.predicted : null;
  // Shared fitted coefficients correlate the predictions: average design vectors first.
  const meanFeatures = usable.length && usable[0].features.length ? usable[0].features.map((_,i) => average(usable.map(r => r.features[i]))) : [];
  const vMean = uncertainty && meanFeatures.length ? varianceAt(meanFeatures,covariance) : NaN;
  const seDifference = uncertainty && finite(vMean) && vMean >= -1e-10 && usable.length && !duplicateBatch ? Math.sqrt(Math.max(0,vMean)+model.residualSD**2/usable.length) : null;
  const meanPI = predictedMean !== null && seDifference !== null && critical !== null ? { low: predictedMean-critical*seDifference, high: predictedMean+critical*seDifference } : null;
  const cqa = response.cqa;
  const inSpec = (y: number) => (cqa.lowerLimit === undefined || y >= cqa.lowerLimit) && (cqa.upperLimit === undefined || y <= cqa.upperLimit);
  const hasSpec = cqa.lowerLimit !== undefined || cqa.upperLimit !== undefined;
  const specValues = study.specificationBasis === 'mean' ? (mean === null ? [] : [mean]) : observed.map(r => r.actual!);
  const specification: Verdict = !hasSpec || !specValues.length ? 'unavailable' : specValues.some(v => !inSpec(v)) ? 'fail' : complete ? 'pass' : 'unavailable';
  const toleranceValue = response.toleranceMode === 'relative' ? relative : bias;
  const practical: Verdict = response.tolerance === undefined || toleranceValue === null ? 'unavailable' : Math.abs(toleranceValue) > response.tolerance ? 'fail' : complete ? 'pass' : 'unavailable';
  const predictive: Verdict = !meanPI || mean === null ? 'unavailable' : mean < meanPI.low || mean > meanPI.high ? 'fail' : complete ? 'pass' : 'unavailable';
  // TOST-equivalent 90% interval for bias, including uncertainty in the frozen OLS prediction.
  const equivalenceMargin = response.tolerance === undefined ? null : response.toleranceMode === 'absolute' ? response.tolerance : predictedMean !== null && Math.abs(predictedMean)>1e-8 ? response.tolerance*Math.abs(predictedMean)/100 : null;
  const eqHalf = seDifference !== null && model?.kind === 'ols' ? tDistributionCritical(0.1,model.df)*seDifference : null;
  const equivalence: Verdict = complete && bias !== null && eqHalf !== null && equivalenceMargin !== null && equivalenceMargin > 0 && study.sourceBlocks.length <= 1 ? (Math.abs(bias)+eqHalf < equivalenceMargin ? 'pass' : 'unavailable') : 'unavailable';
  if (!complete) warnings.push(`Chưa đủ dữ liệu hợp lệ: ${n}/${study.plannedReplicates} thí nghiệm dự kiến.`);
  if (rows.some(r => r.errors.length)) warnings.push('Có điều kiện thực hiện không hợp lệ; xem chi tiết từng mẻ.');
  return { n, mean, sd, predictedMean, bias, plannedBias, absoluteBias: bias === null ? null : Math.abs(bias), relative, rmse, meanPI, rows,
    specification, practical, predictive, equivalence, eqHalf, warnings, complete };
}

/** Precision planning under frozen OLS variance assumptions; this is not a power calculation. */
export function planConfirmationPrecision(study: ConfirmationStudy, response: FrozenResponse, desiredHalfWidth: number): number | null {
  const model = response.model;
  if (!(desiredHalfWidth>0) || model?.kind !== 'ols' || !model.covariance || model.df<=0 || study.sourceBlocks.length>1) return null;
  const x = frozenPrediction(study,response,study.solution.actualFactors).features;
  const v = varianceAt(x,model.covariance);
  const t = tDistributionCritical(1-study.confidence,model.df);
  const remaining = (desiredHalfWidth/t)**2-v;
  return remaining>0 ? Math.max(1,Math.ceil(model.residualSD**2/remaining)) : null;
}

/** Paste contract is explicit TSV, never silently drop malformed or incomplete columns. */
export function parseConfirmationPaste(study: ConfirmationStudy, text: string): ConfirmationRun[] {
  const lines = text.replace(/^\uFEFF/, '').replace(/[\r\n]+$/, '').split(/\r?\n/);
  const header = ['batch', ...study.factors.map(f => f.code), ...study.responses.map(r => r.cqa.code)];
  if (lines.shift()?.split('\t').join('|') !== header.join('|')) throw new Error(`Dòng tiêu đề phải là: ${header.join(' → ')}`);
  if (!lines.length || lines.length > 500) throw new Error('Nhập từ 1 đến 500 dòng.');
  const seen = new Set(study.runs.map(r => r.batch.trim()));
  return lines.map((line,i) => {
    const cells = line.split('\t');
    if (cells.length !== header.length) throw new Error(`Dòng ${i+2}: số cột không đúng.`);
    const run = newConfirmationRun(study); run.batch = cells[0].trim();
    if (!run.batch || seen.has(run.batch)) throw new Error(`Dòng ${i+2}: mã mẻ trống hoặc trùng.`);
    seen.add(run.batch);
    study.factors.forEach((f,j) => { run.actualFactors[f.code] = cells[j+1].trim(); });
    const errors = validateConfirmationFactors(study,run.actualFactors);
    if (errors.length) throw new Error(`Dòng ${i+2}: ${errors.join('; ')}`);
    study.responses.forEach((r,j) => {
      const raw = cells[1+study.factors.length+j].trim();
      if (r.cqa.dataType?.startsWith('qualitative')) {
        if (raw && !r.cqa.categories?.includes(raw)) throw new Error(`Dòng ${i+2}: ${r.cqa.code} không thuộc mức phân loại.`);
        run.responses[r.cqa.code]=raw||null;
        return;
      }
      const value = Number(raw.replace(',','.'));
      if (raw && !Number.isFinite(value)) throw new Error(`Dòng ${i+2}: ${r.cqa.code} không phải số.`);
      run.responses[r.cqa.code] = raw ? value : null;
    });
    return run;
  });
}

/** Apply an Excel-style rectangular paste at a matrix cell without mutating the study. */
export function pasteConfirmationMatrix(study: ConfirmationStudy, text: string, rowIndex: number, columnIndex: number): ConfirmationRun[] {
  const columns = ['batch', 'date', ...study.factors.map(f => f.code), ...study.responses.map(r => r.cqa.code), 'notes'];
  const lines = text.replace(/^\uFEFF/, '').replace(/\r?\n$/, '').split(/\r?\n/);
  if (!lines.length || rowIndex < 0 || columnIndex < 0 || columnIndex >= columns.length) throw new Error('Vị trí dán không hợp lệ.');
  const cells = lines.map(line => line.split('\t'));
  if (cells[0].join('\t') === columns.join('\t')) cells.shift();
  if (!cells.length || rowIndex + cells.length > 500 || cells.some(row => columnIndex + row.length > columns.length)) throw new Error('Dữ liệu dán vượt giới hạn 500 mẻ hoặc số cột của bảng.');
  const runs = study.runs.map(run => ({ ...run, actualFactors: { ...run.actualFactors }, responses: { ...run.responses } }));
  while (runs.length < rowIndex + cells.length) {
    const run = newConfirmationRun(study);
    run.batch = `Mẻ ${runs.length + 1}`;
    runs.push(run);
  }
  cells.forEach((row, rowOffset) => row.forEach((raw, colOffset) => {
    const run = runs[rowIndex + rowOffset];
    const column = columns[columnIndex + colOffset];
    const value = raw.trim();
    if (column === 'batch') run.batch = value;
    else if (column === 'date') {
      if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Dòng ${rowOffset + 1}: ngày phải theo định dạng YYYY-MM-DD.`);
      run.date = value;
    } else if (column === 'notes') run.notes = value;
    else if (study.factors.some(f => f.code === column)) run.actualFactors[column] = value;
    else {
      const response = study.responses.find(r => r.cqa.code === column)!;
      if (response.cqa.dataType?.startsWith('qualitative')) {
        if (value && !response.cqa.categories?.includes(value)) throw new Error(`Dòng ${rowOffset + 1}: ${column} không thuộc mức phân loại.`);
        run.responses[column] = value || null;
      } else {
        const number = Number(value.replace(',', '.'));
        if (value && !Number.isFinite(number)) throw new Error(`Dòng ${rowOffset + 1}: ${column} không phải số.`);
        run.responses[column] = value ? number : null;
      }
    }
  }));
  const batches = runs.map(run => run.batch.trim());
  if (batches.some((batch, index) => !batch || batches.indexOf(batch) !== index)) throw new Error('Mã mẻ trống hoặc trùng sau khi dán.');
  return runs;
}

export function confirmationTrainingRuns(project: QBDProject, study: ConfirmationStudy): DoERun[] {
  if (study.status !== 'complete' || study.addedToTrainingAt) throw new Error('Chỉ bổ sung một lần từ hồ sơ đã hoàn tất.');
  if (canonicalJsonStringify(project.factors)!==canonicalJsonStringify(study.factors) || canonicalJsonStringify(project.cqas)!==canonicalJsonStringify(study.responses.map(r=>r.cqa))) throw new Error('Định nghĩa yếu tố/CQA đã thay đổi; cần đối chiếu trước khi bổ sung.');
  if (study.responses.some(r => !evaluateConfirmation(study,r).complete)) throw new Error('Chưa đủ kết quả hợp lệ cho tất cả đáp ứng.');
  const newBlock = Math.max(1,...project.runs.map(r=>r.block??1))+1;
  const lastOrder = Math.max(0,...project.runs.map(r=>r.runOrder));
  return study.runs.map((r,i) => ({ id: `confirmation-${r.id}`, runOrder: lastOrder+i+1, standardOrder: lastOrder+i+1,
    stdOrder: lastOrder+i+1, block: newBlock, factorActual: clone(r.actualFactors), factorCoded: Object.fromEntries(study.factors.map(f=>[f.code,actualToCoded(r.actualFactors[f.code],f)])),
    responses: Object.fromEntries(Object.entries(r.responses).filter((entry): entry is [string,number|string]=>finite(entry[1])||(typeof entry[1]==='string'&&entry[1].trim()!==''))),
    isCenterPoint: false, notes: `Confirmation ${study.id}; ${r.batch}. Dữ liệu xác nhận được bổ sung sau đánh giá.` }));
}

export function confirmationReportLines(study: ConfirmationStudy): string[] {
  const f = formatConfirmationNumber;
  return [
    `${study.name} — ${study.status}; tạo ${study.createdAt}; phiên bản ${study.sourceVersion}; SHA-256 ${study.sourceHash}`,
    `Điều kiện kế hoạch: ${study.factors.map(x=>`${x.code}=${study.solution.actualFactors[x.code]} ${x.unit}`).join('; ')}`,
    `Phương án tối ưu gốc: ${JSON.stringify((study.originalSolution??study.solution).actualFactors)}`,
    `Dự kiến ${study.plannedReplicates} thí nghiệm độc lập; PI ${study.confidence*100}% cho từng đáp ứng; specification theo ${study.specificationBasis==='mean'?'trung bình':'từng mẻ'}.`,
    ...study.responses.flatMap(r=>{ const e=evaluateConfirmation(study,r);
      if (r.cqa.dataType?.startsWith('qualitative')) return [
        `${r.cqa.code} (${r.cqa.name}): mức đích ${r.cqa.targetCategory??'chưa xác định'}; ${e.n}/${study.plannedReplicates} mẻ hợp lệ; chất lượng: ${verdictLabel(e.specification)}. Bias, RMSE và PI số học không áp dụng.`,
        ...e.rows.map(row=>`${row.run.batch}: ${formatConfirmationNumber(row.actual)}; ${row.errors.join('; ')}`),
        ...e.warnings ];
      return [
      `${r.cqa.code} (${r.cqa.name}, ${r.cqa.unit}): dự đoán kế hoạch ${f(r.predicted)}; dự đoán TB tại điều kiện thực tế ${f(e.predictedMean)}; n=${e.n}; TB±SD=${f(e.mean)} ± ${f(e.sd)}; lệch so với kế hoạch=${f(e.plannedBias)}; bias=${f(e.bias)}; |bias|=${f(e.absoluteBias)}; lệch tương đối=${f(e.relative)}%; RMSE=${f(e.rmse)}.`,
      `Specification [${r.cqa.lowerLimit??'-∞'}, ${r.cqa.upperLimit??'+∞'}]: ${verdictLabel(e.specification)}; ngưỡng lệch ${r.tolerance??'chưa đặt'} ${r.toleranceMode==='relative'?'% tương đối':r.cqa.unit}: ${verdictLabel(e.practical)}; PI trung bình ${e.meanPI?`[${f(e.meanPI.low)}, ${f(e.meanPI.high)}]`:'chưa có'}: ${verdictLabel(e.predictive)}; tương đương (CI bias 90%, OLS): ${e.equivalence==='pass'?'đủ bằng chứng theo giả định':'chưa chứng minh'}.`,
      ...e.rows.map(row=>`${row.run.batch} (${row.run.date}): thực tế=${f(row.actual)}; dự đoán=${f(row.predicted)}; sai lệch=${f(row.error)}; PI cá thể=${row.halfWidth!==null&&row.predicted!==null?`[${f(row.predicted-row.halfWidth)}, ${f(row.predicted+row.halfWidth)}]`:'chưa có'}; ${verdictLabel(row.pi)}; ${row.errors.join('; ')}`),
      ...e.warnings ]; }),
    ...study.runs.map(r=>`${r.batch}: ${JSON.stringify(r.actualFactors)}; ${r.notes}`),
    ...study.history.map(h=>`${h.at}: ${h.action}`),
    'Kết quả chỉ xác nhận tại các điều kiện đã thực hiện; không xác nhận toàn bộ Design Space/PAR. PI giả định sai số độc lập, chuẩn và cùng phương sai với dữ liệu xây dựng mô hình.',
  ];
}
