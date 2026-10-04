/**
 * Stepwise Backward Elimination for Polynomial Response Surface Models (RSM).
 * Adheres strictly to the Polynomial Hierarchy Principle:
 * - Linear terms X_i are preserved if any interaction X_i*X_j or quadratic X_i² remains.
 * - Supports p-value threshold (default alpha = 0.10) or AICc minimization.
 */

import type { CQA, Factor, DoERun, StatisticalModelResult, ModelType } from '../types/qbd';
import { canRemoveTermUnderHierarchy } from './modelTerms';
import { fitModel } from './statistics';

export interface BackwardEliminationStep {
  step: number;
  removedTerm: string;
  pValueAtRemoval?: number;
  aiccAfterRemoval?: number;
  rSquaredAfterRemoval: number;
  adjRSquaredAfterRemoval: number;
  remainingTermsCount: number;
}

export interface ModelReductionOptions {
  alphaToRemove?: number; // default: 0.10
  criterion?: 'p-value' | 'AICc';
  startModelType?: ModelType;
}

export interface ModelReductionResult {
  initialTerms: string[];
  finalTerms: string[];
  steps: BackwardEliminationStep[];
  reducedModel: StatisticalModelResult;
  stoppedReason: string;
}

/**
 * Executes automated stepwise backward elimination to reduce non-significant terms
 * while preserving polynomial hierarchy.
 */
export function runBackwardElimination(
  cqa: CQA,
  factors: Factor[],
  runs: DoERun[],
  options: ModelReductionOptions = {}
): ModelReductionResult | null {
  const alpha = options.alphaToRemove ?? 0.10;
  const criterion = options.criterion ?? 'p-value';
  const startType = options.startModelType ?? 'Quadratic';

  // 1. Initial fit
  let currentModel = fitModel(cqa, factors, runs, startType);
  if (!currentModel) return null;

  const initialTerms = currentModel.terms.map((t) => t.name);
  let currentTermNames = [...initialTerms];
  const steps: BackwardEliminationStep[] = [];
  let stoppedReason = '';

  const maxSteps = initialTerms.length;

  for (let s = 1; s <= maxSteps; s++) {
    // Identify removable candidate terms under hierarchy
    const removableTerms = currentTermNames.filter((name) =>
      canRemoveTermUnderHierarchy(name, currentTermNames)
    );

    if (removableTerms.length === 0) {
      stoppedReason = 'Không còn số hạng nào có thể loại bỏ mà không vi phạm cấu trúc thứ bậc (hierarchy).';
      break;
    }

    if (criterion === 'p-value') {
      // Find term with highest p-value among removable terms
      let worstTerm: string | null = null;
      let worstPValue = -1;

      for (const termName of removableTerms) {
        const found = currentModel.terms.find((t) => t.name === termName);
        if (found && found.pValue !== undefined && found.pValue > worstPValue) {
          worstPValue = found.pValue;
          worstTerm = termName;
        }
      }

      if (!worstTerm || worstPValue <= alpha) {
        stoppedReason = `Tất cả các số hạng ứng viên còn lại đều có ý nghĩa thống kê (p ≤ ${alpha}).`;
        break;
      }

      // Tentatively remove worstTerm and refit
      const nextTermNames = currentTermNames.filter((name) => name !== worstTerm);
      const nextModel = fitModel(cqa, factors, runs, 'Reduced', nextTermNames);

      if (!nextModel) {
        stoppedReason = 'Không thể tiếp tục rút gọn do bậc tự do không hợp lệ.';
        break;
      }

      steps.push({
        step: s,
        removedTerm: worstTerm,
        pValueAtRemoval: worstPValue,
        aiccAfterRemoval: nextModel.diagnostics.aicc,
        rSquaredAfterRemoval: nextModel.diagnostics.rSquared,
        adjRSquaredAfterRemoval: nextModel.diagnostics.adjRSquared,
        remainingTermsCount: nextTermNames.length,
      });

      currentTermNames = nextTermNames;
      currentModel = nextModel;
    } else {
      // AICc criterion: find term whose removal causes largest decrease in AICc
      const currentAICc = currentModel.diagnostics.aicc ?? Infinity;
      let bestCandidateTerm: string | null = null;
      let lowestAICc = currentAICc;
      let bestCandidateModel: StatisticalModelResult | null = null;

      for (const termName of removableTerms) {
        const candidateTerms = currentTermNames.filter((name) => name !== termName);
        const candidateModel = fitModel(cqa, factors, runs, 'Reduced', candidateTerms);
        if (!candidateModel) continue;

        const candAICc = candidateModel.diagnostics.aicc ?? Infinity;
        if (candAICc < lowestAICc) {
          lowestAICc = candAICc;
          bestCandidateTerm = termName;
          bestCandidateModel = candidateModel;
        }
      }

      if (!bestCandidateTerm || !bestCandidateModel || lowestAICc >= currentAICc) {
        stoppedReason = 'Chỉ số thông tin AICc không giảm thêm khi loại bỏ các số hạng còn lại.';
        break;
      }

      steps.push({
        step: s,
        removedTerm: bestCandidateTerm,
        aiccAfterRemoval: lowestAICc,
        rSquaredAfterRemoval: bestCandidateModel.diagnostics.rSquared,
        adjRSquaredAfterRemoval: bestCandidateModel.diagnostics.adjRSquared,
        remainingTermsCount: currentTermNames.length - 1,
      });

      currentTermNames = currentTermNames.filter((name) => name !== bestCandidateTerm);
      currentModel = bestCandidateModel;
    }
  }

  const finalModel =
    currentModel.modelType === 'Reduced'
      ? currentModel
      : (fitModel(cqa, factors, runs, 'Reduced', currentTermNames) ?? {
          ...currentModel,
          modelType: 'Reduced' as ModelType,
        });

  return {
    initialTerms,
    finalTerms: currentTermNames,
    steps,
    reducedModel: finalModel,
    stoppedReason: stoppedReason || 'Quá trình rút gọn mô hình hoàn tất.',
  };
}
