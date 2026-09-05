import { describe, expect, it } from 'vitest';
import type { CQA, DoEDesignConfig, DoERun, Factor } from '../types/qbd';
import { CASE_STUDIES } from '../data/caseStudies';
import {
  generateDoERuns,
  generateFractionalFactorial,
  generateTaguchi,
  validateDesignSetup,
} from './doeGenerator';
import { getReportReadiness } from './projectGovernance';
import { fitModel, generateUpdatedRiskAssessment, runMonteCarloSimulation } from './statistics';

const factor = (code: string, controllability: Factor['controllability'] = 'controllable'): Factor => ({
  id: code,
  code,
  name: code,
  type: 'Process',
  dataType: 'quantitative',
  controllability,
  unit: '',
  low: 0,
  center: 5,
  high: 10,
  constantValue: controllability === 'constant' ? 5 : undefined,
});

const screeningConfig = (designType: DoEDesignConfig['designType']): DoEDesignConfig => ({
  category: 'Screening',
  designType,
  centerPoints: 0,
  replicates: 1,
  randomized: false,
  blocks: 1,
});

describe('screening design generators', () => {
  it('creates the requested supported Taguchi arrays', () => {
    expect(generateTaguchi(3, 'L4')).toHaveLength(4);
    expect(generateTaguchi(7, 'L8')).toHaveLength(8);
    expect(generateTaguchi(4, 'L9')).toHaveLength(9);
    expect(generateTaguchi(11, 'L12')).toHaveLength(12);
    expect(generateTaguchi(15, 'L16')).toHaveLength(16);
    expect(generateTaguchi(8, 'L8')).toEqual([]);
  });

  it('keeps every two-level Taguchi column balanced and orthogonal', () => {
    const matrix = generateTaguchi(15, 'L16');
    for (let column = 0; column < 15; column++) {
      expect(matrix.reduce((sum, row) => sum + row[column], 0)).toBe(0);
      for (let other = column + 1; other < 15; other++) {
        expect(matrix.reduce((sum, row) => sum + row[column] * row[other], 0)).toBe(0);
      }
    }
  });

  it('does not silently turn a six-factor half fraction into a full factorial', () => {
    const matrix = generateFractionalFactorial(6);
    expect(matrix).toHaveLength(32);
    expect(matrix.every((row) => row.length === 6)).toBe(true);
  });

  it('excludes constant factors from the design matrix and run count', () => {
    const factors = [factor('X1'), factor('X2'), factor('X3', 'constant')];
    const { runs } = generateDoERuns(factors, screeningConfig('FullFactorial2k'));
    expect(runs).toHaveLength(4);
    expect(new Set(runs.map((run) => run.factorActual.X3))).toEqual(new Set([5]));
    expect(new Set(runs.map((run) => run.factorCoded.X3))).toEqual(new Set([0]));
  });

  it('reproduces randomized run order from the persisted seed', () => {
    const config = { ...screeningConfig('FullFactorial2k'), randomized: true, randomizationSeed: 12345 };
    const factors = [factor('X1'), factor('X2'), factor('X3')];
    const first = generateDoERuns(factors, config).runs.map((run) => run.stdOrder);
    const second = generateDoERuns(factors, config).runs.map((run) => run.stdOrder);
    expect(second).toEqual(first);
  });

  it('rejects a Taguchi array with insufficient factor capacity', () => {
    const config = { ...screeningConfig('Taguchi'), taguchiArray: 'L4' as const };
    expect(validateDesignSetup([factor('X1'), factor('X2'), factor('X3'), factor('X4')], config).isValid).toBe(false);
  });
});

describe('fail-closed statistical inference', () => {
  const cqa: CQA = {
    id: 'Y1', code: 'Y1', name: 'Response', unit: '', objective: 'target', weight: 1,
    lowerLimit: 0, target: 5, upperLimit: 10,
  };

  const makeRuns = (blocks = 1): DoERun[] => {
    const points = [-1, 1, -1, 1, 0, 0];
    return points.map((coded, index) => ({
      id: `r${index}`,
      stdOrder: index + 1,
      runOrder: index + 1,
      block: blocks > 1 ? (index % blocks) + 1 : 1,
      factorCoded: { X1: coded },
      factorActual: { X1: 5 + 5 * coded },
      responses: { Y1: 5 + 2 * coded + (index % 2 ? 0.1 : -0.1) },
    }));
  };

  it('fits a fixed block-adjusted OLS model when execution uses multiple blocks', () => {
    const model = fitModel(cqa, [factor('X1')], makeRuns(2), 'Linear');
    expect(model).not.toBeNull();
    expect(model?.anova.some((row) => row.source === 'Block (fixed effect)')).toBe(true);
    expect(model?.anova.find((row) => row.source.startsWith('Model'))?.df).toBe(1);
    expect(model?.terms.some((term) => term.name.startsWith('Block 2'))).toBe(true);
  });

  it('only emits the classical curvature test for corner-plus-center designs', () => {
    const factorial = fitModel(cqa, [factor('X1')], makeRuns(), 'Linear');
    expect(factorial?.curvatureTest).toBeDefined();
    const axialLike = makeRuns().map((run, index) => index === 0
      ? { ...run, factorCoded: { X1: -1.414 }, factorActual: { X1: -2.07 } }
      : run);
    expect(fitModel(cqa, [factor('X1')], axialLike, 'Linear')?.curvatureTest).toBeUndefined();
  });
});

describe('reproducible analysis and report release gate', () => {
  it('locks the scientific report when required CQA models are absent', () => {
    const readiness = getReportReadiness(CASE_STUDIES[0], {}, null, null);
    expect(readiness.readyForScientificReport).toBe(false);
    expect(readiness.errors.some((message) => message.includes('Y1') && message.includes('không có mô hình'))).toBe(true);
    expect(readiness.errors).toContain('Chưa có nghiệm tối ưu đa đáp ứng có thể tái lập.');
    expect(readiness.errors).toContain('Chưa có đánh giá Monte Carlo dùng chung với báo cáo.');
  });

  it('does not release a report before a provisional operating region is saved', () => {
    const projectWithoutRegion = { ...CASE_STUDIES[0], designSpace: [] };
    const readiness = getReportReadiness(projectWithoutRegion, {}, null, null);
    expect(readiness.readyForScientificReport).toBe(false);
    expect(readiness.errors).toContain('Chưa lưu vùng vận hành provisional screening vào project.');
  });

  it('does not silently downgrade risk when model or confirmation evidence is absent', () => {
    const updated = generateUpdatedRiskAssessment(CASE_STUDIES[2], {});
    expect(updated.length).toBeGreaterThan(0);
    expect(updated.every((item) => item.updatedRisk === item.initialRisk)).toBe(true);
  });

  it('reproduces Monte Carlo results exactly from the persisted seed', () => {
    const cqa: CQA = {
      id: 'Y1', code: 'Y1', name: 'Response', unit: '', objective: 'target', weight: 1,
      lowerLimit: 3, target: 5, upperLimit: 7,
    };
    const model = {
      predict: (coded: Record<string, number>) => 5 + coded.X1,
      diagnostics: { stdDev: 0.25, residuals: [] },
    } as any;
    const factors = [factor('X1')];
    const models = { Y1: model };
    const first = runMonteCarloSimulation({ X1: 5 }, factors, [cqa], models, 2, 500, 8675309);
    const second = runMonteCarloSimulation({ X1: 5 }, factors, [cqa], models, 2, 500, 8675309);
    const { executionTimeMs: _firstTime, ...firstScientificResult } = first;
    const { executionTimeMs: _secondTime, ...secondScientificResult } = second;
    expect(secondScientificResult).toEqual(firstScientificResult);
  });

  it('reports CQA coverage and counts process excursions as failed batches', () => {
    const modeled: CQA = {
      id: 'Y1', code: 'Y1', name: 'Modeled', unit: '', objective: 'range', weight: 1,
      lowerLimit: -100, target: 0, upperLimit: 100,
    };
    const descriptive: CQA = {
      id: 'Y2', code: 'Y2', name: 'Descriptive', unit: '', objective: 'pass_category', weight: 1,
      dataType: 'qualitative_binary', categories: ['Không đạt', 'Đạt'],
    };
    const model = {
      predict: () => 0,
      diagnostics: { stdDev: 0, residuals: [] },
    } as any;
    const result = runMonteCarloSimulation({ X1: 10 }, [factor('X1')], [modeled, descriptive], { Y1: model }, 15, 500, 123);
    expect(result.modeledCqaCodes).toEqual(['Y1']);
    expect(result.unmodeledCqaCodes).toEqual(['Y2']);
    expect(result.excursionCount).toBeGreaterThan(0);
    expect(result.failCount).toBeGreaterThanOrEqual(result.excursionCount);
    expect(result.reliabilityPercent).toBeLessThan(100);
  });

  it('clamps unsafe Monte Carlo configuration at the service boundary', () => {
    const cqa: CQA = {
      id: 'Y1', code: 'Y1', name: 'Response', unit: '', objective: 'range', weight: 1,
      lowerLimit: 0, target: 5, upperLimit: 10,
    };
    const model = { predict: () => 5, diagnostics: { stdDev: 0, residuals: [] } } as any;
    const result = runMonteCarloSimulation({ X1: 5 }, [factor('X1')], [cqa], { Y1: model }, -2, 10, 99);
    expect(result.simulations).toBe(100);
    expect(result.variabilityPercent).toBe(0.1);
  });
});
