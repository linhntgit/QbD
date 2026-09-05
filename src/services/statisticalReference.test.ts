import { describe, expect, it } from 'vitest';
import reference from './fixtures/statistical-reference.json';
import type { CQA, DoERun, Factor, ModelType, NeuralActivation, StatisticalModelResult } from '../types/qbd';
import { fitModel, projectToBoundedMixture, optimizeDesirability, runMonteCarloSimulation, isWithinSurveyBounds } from './statistics';
import { calculateCQAMargin, calculateInformationCriteria, calculateIndividualDesirability, fDistributionPValue, normalCDF, normalInverseCDF, tDistributionCritical, tDistributionPValue, wilsonInterval } from './mathUtils';
import { calculateDesignEfficiency, generateCCD, generatePlackettBurman, generateTaguchi, generateBoxBehnken, generateMixtureDesign } from './doeGenerator';
import { DEFAULT_NEURAL_CONFIG, fitNeuralNetModel, fitMultiOutputNeuralNet, getNeuralValidationSplits } from './neuralNetwork';
import { assessDesignSpaceRobustness } from './designSpaceRobustness';
import { processRawTableData } from './doeExcelService';

const cqa: CQA = { id: 'Y1', code: 'Y1', name: 'Response', unit: '', objective: 'target', weight: 1, lowerLimit: -10, upperLimit: 10, target: 0 };
const factor = (code: string): Factor => ({ id: code, code, name: code, type: 'Process', dataType: 'quantitative', controllability: 'controllable', unit: '', low: -1, high: 1 });
function runsFor(points: number[][], y: number[][], blocks?: number[]): DoERun[] {
  return points.map((row, i) => ({ id: String(i), runOrder: i + 1, stdOrder: i + 1, block: blocks?.[i] ?? 1,
    factorCoded: Object.fromEntries(row.map((v, j) => [`X${j+1}`, v])),
    factorActual: Object.fromEntries(row.map((v, j) => [`X${j+1}`, v])),
    responses: Object.fromEntries(y[i].map((v, j) => [`Y${j+1}`, v])),
  }));
}
const close = (actual: number, expected: number, tolerance = 1e-8) => {
  expect(Math.abs(actual - expected)).toBeLessThan(tolerance * Math.max(1, Math.abs(expected)));
};

describe(`independent NumPy ${reference.numpyVersion} SVD/lstsq reference`, () => {
  for (const data of reference.ols) it(data.name, () => {
    const model = fitModel(cqa, data.factors as Factor[], runsFor(data.points, data.y.map((v) => [v]), data.blocks), data.order as ModelType)!;
    expect(model).not.toBeNull();
    model.terms.forEach((term, i) => { close(term.coefficient, data.beta[i]); close(term.stdError, data.se[i]); });
    model.diagnostics.residuals.forEach((row, i) => {
      close(row.predicted, data.predicted[i]); close(row.residual, data.residual[i]);
      close(row.leverage, data.leverage[i]); close(row.studentizedResidual, data.studentized[i]); close(row.cooksDistance, data.cooks[i]);
    });
    const d = model.diagnostics;
    close(d.rSquared, data.r2); close(d.adjRSquared, data.adjusted); close(d.press, data.press); close(d.predRSquared, data.predictedR2);
    close(d.aicc!, data.aicc); close(d.bic!, data.bic); close(d.logLikelihood!, data.ll); close(d.adeqPrecision, data.adequate);
    close(d.ssPureError!, data.pureError); close(d.ssLOF!, data.lackOfFit);
    expect(d.dfPureError).toBe(data.pureErrorDF); expect(d.dfLOF).toBe(data.lackOfFitDF);
    expect(model.residualDegreesOfFreedom).toBe(data.residualDF);
    const anova = model.anova.find((row) => row.source.startsWith('Model'))!;
    expect(anova.df).toBe(data.modelDF); close(anova.fValue!, data.modelF);
    const point = Object.fromEntries(data.predictionPoint.map((v, i) => [`X${i+1}`, v]));
    close(model.predict(point), data.prediction); close(model.predictStandardError!(point), data.predictionSE);
  });
});

describe('analytic distribution and desirability references', () => {
  it('matches Python NormalDist inverse CDF and standard t tables', () => {
    for (const row of reference.normal) { close(normalInverseCDF(row.p), row.x, 1e-8); close(normalCDF(row.x), row.p, 1e-7); }
    close(tDistributionCritical(.05, 1), 12.7062047364321);
    close(tDistributionCritical(.05, 10), 2.22813885196494);
    close(tDistributionCritical(.05, 30), 2.04227245630124);
  });
  it('matches closed-form Cauchy t(1) and F(2,2) tails', () => {
    for (const x of [.001, .1, 1, 3, 10, 100]) {
      close(tDistributionPValue(x, 1), 1 - 2*Math.atan(x)/Math.PI);
      close(fDistributionPValue(x, 2, 2), 1/(1+x));
      close(fDistributionPValue(x*x, 1, 10), tDistributionPValue(x, 10));
    }
    expect(tDistributionPValue(1, 0)).toBeNaN(); expect(fDistributionPValue(NaN, 2, 2)).toBeNaN();
    expect(normalInverseCDF(0)).toBe(-Infinity); expect(normalInverseCDF(1)).toBe(Infinity);
  });
  it('does not rank undefined AICc or degenerate likelihood as zero', () => {
    expect(calculateInformationCriteria(5, 4, 1).aicc).toBe(Infinity);
    expect(calculateInformationCriteria(5, 5, 1).aicc).toBe(Infinity);
    expect(calculateInformationCriteria(5, 2, 0).aicc).toBeNaN();
    expect(calculateInformationCriteria(20, 2, 1e-20).logLikelihood).toBeGreaterThan(calculateInformationCriteria(20, 2, 1e-12).logLikelihood);
  });
  it('matches Derringer-Suich ramps and enforces all declared specification limits', () => {
    close(calculateIndividualDesirability(2, 'maximize', 0, 10, 4, 2), .25);
    close(calculateIndividualDesirability(7, 'minimize', 0, 10, 4, 1, 2), .25);
    close(calculateIndividualDesirability(3, 'target', 0, 10, 6, 2, 1), .25);
    close(calculateIndividualDesirability(8, 'target', 0, 10, 6, 2, 1), .5);
    for (const objective of ['maximize', 'minimize', 'target', 'range']) {
      expect(calculateCQAMargin(-1, objective, 0, 10, 5)).toBeLessThan(0);
      expect(calculateCQAMargin(11, objective, 0, 10, 5)).toBeLessThan(0);
      expect(calculateCQAMargin(5, objective, 0, 10, 5)).toBeGreaterThanOrEqual(0);
    }
  });
  it('uses a non-degenerate Wilson interval at zero and all failures', () => {
    close(wilsonInterval(0, 100).high, 0.0369934982069857);
    close(wilsonInterval(100, 100).low, 0.9630065017930143);
    close(wilsonInterval(50, 100).low, 0.4038315303659964);
    const mc = runMonteCarloSimulation({}, [], [cqa], { Y1: { predict: () => 0, diagnostics: { stdDev: 0 } } as unknown as StatisticalModelResult }, 2, 100);
    const result = assessDesignSpaceRobustness({}, [], [cqa], {}, mc);
    expect(result.probabilityInterval95!.high).toBeGreaterThan(3.6);
  });
});

describe('independent finite-difference backpropagation + Adam first-step reference', () => {
  for (const data of reference.neural) it(`${data.activation}, H2=${data.hidden2}, outputs=${data.outputs}`, () => {
    const config = { ...DEFAULT_NEURAL_CONFIG, hiddenNodes1: 2, hiddenNodes2: data.hidden2, activation: data.activation as NeuralActivation,
      maxEpochs: 1, numTours: 1, learningRate: .01, weightDecay: .03, validationMethod: 'none' as const, seed: 123 };
    const cqas = Array.from({length:data.outputs}, (_, i) => ({...cqa,id:`Y${i+1}`,code:`Y${i+1}`}));
    const runs = runsFor(data.points, data.y);
    const models = data.outputs === 1 ? { Y1: fitNeuralNetModel(cqa, [factor('X1'), factor('X2')], runs, config)! }
      : fitMultiOutputNeuralNet(cqas, [factor('X1'), factor('X2')], runs, config);
    cqas.forEach((response, output) => {
      const model = models[response.code]; expect(model).toBeTruthy();
      const w = model.weights;
      for (let i=0;i<2;i++) for(let j=0;j<2;j++) close(w.W1[i][j], data.expected.W1[i][j], 2e-7);
      w.b1.forEach((value,i)=>close(value,data.expected.b1[i],2e-7));
      if (data.hidden2) w.W2!.forEach((row,i)=>row.forEach((value,j)=>close(value,data.expected.W2![i][j],2e-7)));
      if (data.hidden2) w.b2!.forEach((value,i)=>close(value,data.expected.b2![i],2e-7));
      w.WOut.forEach((row,i)=>close(row[0],data.expected.WOut[i][output],2e-7));
      close(w.bOut,data.expected.bOut[output],2e-7);
      data.points.forEach((row,i)=>close(model.predict({X1:row[0],X2:row[1]}),data.predicted[i][output],2e-7));
      expect(model.diagnostics.aicc).toBeUndefined();
    });
  });
});

describe('validation isolation and OOF aggregation', () => {
  const points = Array.from({length:30},(_,i)=>[-1+2*i/29]);
  const runs = runsFor(points,points.map(([x],i)=>[x*x+.1*Math.sin(i),2*x+.2*Math.cos(i)]));
  const config = {...DEFAULT_NEURAL_CONFIG,hiddenNodes1:1,hiddenNodes2:0,maxEpochs:25,numTours:2,seed:42};
  for (const shared of [false,true]) {
    const fit = (data: DoERun[], cfg: typeof config) => shared
      ? fitMultiOutputNeuralNet([cqa,{...cqa,id:'Y2',code:'Y2'}],[factor('X1')],data,cfg).Y1
      : fitNeuralNetModel(cqa,[factor('X1')],data,cfg)!;
    it(`does not use holdout labels for training or restart selection (shared=${shared})`, () => {
      const cfg={...config,validationMethod:'holdout' as const};
      const original=fit(runs,cfg);
      const validation=new Set(getNeuralValidationSplits(runs.length,cfg)[0].valIdx);
      const changed=runs.map((run,i)=>validation.has(i)?{...run,responses:{Y1:100000+i,Y2:-100000-i}}:run);
      const modified=fit(changed,cfg);
      expect(modified.weights).toEqual(original.weights); expect(modified.normParams).toEqual(original.normParams);
      expect(modified.diagnostics.rSquaredVal).toBeLessThan(0);
    });
    it(`pools all K-fold predictions and refits final model (shared=${shared})`, () => {
      const result=fit(runs,{...config,validationMethod:'kfold',kFolds:3});
      expect(result.diagnostics.validationKind).toBe('out-of-fold');
      expect(result.diagnostics.validationSampleCount).toBe(30);
      expect(result.diagnostics.trainingSampleCount).toBe(20);
      expect(new Set(result.diagnostics.residuals.map(row=>row.runOrder)).size).toBe(30);
      expect(result.diagnostics.residuals.every(row=>row.isValidation)).toBe(true);
      const final=fit(runs,{...config,validationMethod:'none'});
      expect(result.weights).toEqual(final.weights);
      close(result.diagnostics.sseVal,result.diagnostics.residuals.reduce((sum,row)=>sum+row.residual**2,0));
    });
  }
});

describe('design and simulation identities', () => {
  it('imports CCD axial values only within the configured axial bounds', () => {
    const f = factor('X1');
    const config = { category: 'RSM' as const, designType: 'CCD_Rotatable' as const, centerPoints: 1, replicates: 1, randomized: false, alpha: Math.sqrt(2) };
    const inside = processRawTableData(['X1', 'Y1'], [[Math.sqrt(2), 1]], [f], [cqa], [], config);
    expect(inside.isValid).toBe(true);
    expect(processRawTableData(['X1', 'Y1'], [[1.5, 1]], [f], [cqa], [], config).isValid).toBe(false);
  });
  it('keeps a constant mixture proportion fixed during Monte Carlo closure', () => {
    const factors = [1, 2, 3].map(i => ({ ...factor(`X${i}`), type: 'Mixture' as const, low: 0, high: 1 }));
    factors[0] = { ...factors[0], controllability: 'constant', constantValue: .2 } as typeof factors[0];
    const model = { predict: (x: Record<string, number>) => {
      close(x.X1, .2); close(x.X1 + x.X2 + x.X3, 1); return x.X1;
    }, diagnostics: { stdDev: 0 } } as unknown as StatisticalModelResult;
    const result = runMonteCarloSimulation({X1: .2, X2: .3, X3: .5}, factors, [cqa], {Y1: model}, 10, 100, 42);
    close(result.cqaStats.Y1.mean, .2);
  });
  it('keeps Plackett-Burman columns balanced and orthogonal for each supported size', () => {
    for(const k of [7,11,15]) {
      const matrix=generatePlackettBurman(k);
      for(let i=0;i<k;i++) {
        expect(matrix.reduce((sum,row)=>sum+row[i],0)).toBe(0);
        for(let j=0;j<i;j++) expect(matrix.reduce((sum,row)=>sum+row[i]*row[j],0)).toBe(0);
      }
    }
    expect(generateTaguchi(3,'L12')).toHaveLength(12);
  });
  it('preserves exact CCD rotatability fourth moments and mixture counts', () => {
    for(const k of [2,3,4]) {
      const {matrix,alpha}=generateCCD(k,'Rotatable');
      close(alpha**4,2**k);
      close(matrix.reduce((sum,row)=>sum+row[0]**4,0),3*matrix.reduce((sum,row)=>sum+row[0]**2*row[1]**2,0));
    }
    expect(generateBoxBehnken(3)).toHaveLength(12);
    expect(generateMixtureDesign(3,'Lattice')).toHaveLength(6);
    expect(generateMixtureDesign(4,'Centroid')).toHaveLength(15);
  });
  it('does not call a clustered saturated design 100% G-efficient', () => {
    const runs=runsFor([[-.1],[.1]],[[0],[0]]);
    expect(calculateDesignEfficiency(runs,[factor('X1')],'Linear').gEfficiency).toBeLessThan(2);
    const singular=runsFor([[0],[0]],[[0],[0]]);
    expect(calculateDesignEfficiency(singular,[factor('X1')],'Linear').gEfficiency).toBe(0);
  });
  it('projects onto the nearest bounded simplex point and preserves locked mixtures', () => {
    const point=projectToBoundedMixture([2,.5,.5],[0,0,0],[1,1,1]);
    point.forEach((v,i)=>close(v,i===0?1:0));
    const factors=[1,2,3].map(i=>({...factor(`X${i}`),type:'Mixture' as const,low:0,high:1}));
    const model={predict:(x:Record<string,number>)=>x.X2,diagnostics:{stdDev:0}} as unknown as StatisticalModelResult;
    const result=optimizeDesirability(factors,[{...cqa,objective:'maximize',lowerLimit:0,upperLimit:1,target:1}],{Y1:model},{X1:.4},42)!;
    close(result.codedFactors.X1,.4); close(Object.values(result.codedFactors).reduce((a,b)=>a+b,0),1);
    expect(isWithinSurveyBounds({X1:NaN},[factor('X1')])).toBe(false);
    expect(isWithinSurveyBounds({X1:1.01},[factor('X1')])).toBe(false);
  });
  it('matches analytical Gaussian moments and failure probability with fixed inputs', () => {
    const response={...cqa,lowerLimit:-1.959963984540054,upperLimit:1.959963984540054};
    const model={predict:()=>0,diagnostics:{stdDev:1}} as unknown as StatisticalModelResult;
    const result=runMonteCarloSimulation({},[],[response],{Y1:model},2,100000,42);
    expect(Math.abs(result.failCount/100000-.05)).toBeLessThan(.003);
    expect(Math.abs(result.cqaStats.Y1.mean)).toBeLessThan(.015);
    expect(Math.abs(result.cqaStats.Y1.sd-1)).toBeLessThan(.015);
    expect(()=>runMonteCarloSimulation({},[],[cqa],{})).toThrow();
    expect(()=>runMonteCarloSimulation({},[],[cqa],{Y1:{...model,predict:()=>NaN}})).toThrow();
  });
});
