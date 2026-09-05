import React, { useEffect, useState, useMemo } from 'react';
import {
  Sparkles,
  Lock,
  Unlock,
  RotateCcw,
  BookmarkPlus,
  Trash2,
  TrendingUp,
  Target,
  ChevronDown,
  ChevronUp,
  Settings,
  Layers,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import type {
  Factor,
  CQA,
  StatisticalModelResult,
  NeuralNetModelResult,
  DesirabilitySolution,
  SavedDesirabilitySetting,
  CQAObjective,
} from '../types/qbd';
import { PlotlyChart } from './PlotlyChart';
import { codedToActual, actualToCoded, getConfiguredFactorCodes, getConfiguredFactorLevels, getFactorGridCodes, isDiscreteFactor } from '../services/doeGenerator';
import {
  getFeasibleMixtureComponentRange,
  normalizeMixtureCoded,
  optimizeDesirability,
  setBoundedMixtureComponent,
} from '../services/statistics';
import { calculateIndividualDesirability, tDistributionCritical } from '../services/mathUtils';

/**
 * Display-only scientific formatting for plot labels and hover text.  Plot data
 * must retain its full floating-point precision so small CQA effects remain
 * continuous (notably PDI values around 0.2).
 */
const formatPlotValue = (value: number, significantDigits = 5): string => {
  if (!Number.isFinite(value)) return '—';
  if (value === 0) return '0';
  return Number(value.toPrecision(significantDigits)).toString();
};

const createInitialCoded = (factors: Factor[]): Record<string, number> => {
  const initial: Record<string, number> = {};
  factors.forEach((factor) => {
    if (factor.role === 'mixture_component' || factor.type === 'Mixture') {
      const low = factor.high <= 1 && factor.unit !== '%' ? factor.low : factor.low / 100;
      const high = factor.high <= 1 && factor.unit !== '%' ? factor.high : factor.high / 100;
      initial[factor.code] = (low + high) / 2;
    } else {
      initial[factor.code] = 0;
    }
  });
  return normalizeMixtureCoded(initial, factors);
};

interface DesirabilityProfilerProps {
  factors: Factor[];
  cqas: CQA[];
  models: Record<string, StatisticalModelResult | NeuralNetModelResult>;
  onUpdateCQAs?: (updatedCQAs: CQA[]) => void;
  onApplyOptimum?: (solution: DesirabilitySolution) => void;
}

export const DesirabilityProfiler: React.FC<DesirabilityProfilerProps> = ({
  factors,
  cqas,
  models,
  onUpdateCQAs,
  onApplyOptimum,
}) => {
  const validCQAs = useMemo(() => cqas.filter((c) => models[c.code]), [cqas, models]);

  // Current interactive factor settings (coded values [-1, +1] or proportions [0, 1])
  const [currentCoded, setCurrentCoded] = useState<Record<string, number>>(() => createInitialCoded(factors));

  // Project settings back onto the simplex after changing project/factor bounds.
  useEffect(() => {
    setCurrentCoded((previous) => normalizeMixtureCoded({ ...createInitialCoded(factors), ...previous }, factors));
  }, [factors]);

  // Locked factors state (factors held constant during optimization)
  const [lockedFactors, setLockedFactors] = useState<Record<string, boolean>>({});

  // Saved candidate solutions (Remember Settings)
  const [savedSettings, setSavedSettings] = useState<SavedDesirabilitySetting[]>([]);

  // Desirability Goal / Shape parameters editor open state
  const [showGoalEditor, setShowGoalEditor] = useState<boolean>(false);

  // Toggle factor lock
  const handleToggleLock = (code: string) => {
    setLockedFactors((prev) => ({
      ...prev,
      [code]: !prev[code],
    }));
  };

  // Evaluate current point predictions, individual d_i, and overall D
  const currentEvaluation = useMemo(() => {
    if (validCQAs.length === 0) return null;

    const totalWeight = validCQAs.reduce((sum, c) => sum + (c.weight || 1), 0);
    let logSum = 0;
    const individualD: Record<string, number> = {};
    const predictions: Record<
      string,
      { value: number; se: number; ciLow: number; ciHigh: number; desirability: number }
    > = {};

    let zeroHit = false;

    validCQAs.forEach((cqa) => {
      const model = models[cqa.code];
      const val = model.predict(currentCoded);
      const statisticalModel = 'predictStandardError' in model ? model : undefined;
      const se = statisticalModel?.predictStandardError?.(currentCoded) ?? (model.diagnostics as any)?.rmseOverall ?? (model.diagnostics as any)?.rmseVal ?? 0;
      const df = statisticalModel?.residualDegreesOfFreedom;
      const critical = df ? tDistributionCritical(0.05, df) : Number.NaN;
      const halfWidth = statisticalModel && Number.isFinite(critical) ? critical * se : Number.NaN;
      const di = calculateIndividualDesirability(
        val,
        cqa.objective,
        cqa.lowerLimit,
        cqa.upperLimit,
        cqa.target,
        cqa.sShape || 1.0,
        cqa.tShape || 1.0
      );
      individualD[cqa.code] = Number(di.toFixed(4));
      predictions[cqa.code] = {
        value: Number(val.toFixed(3)),
        se: Number(se.toFixed(3)),
        ciLow: Number.isFinite(halfWidth) ? Number((val - halfWidth).toFixed(3)) : Number.NaN,
        ciHigh: Number.isFinite(halfWidth) ? Number((val + halfWidth).toFixed(3)) : Number.NaN,
        desirability: Number(di.toFixed(4)),
      };

      if (di <= 0) {
        zeroHit = true;
      } else {
        logSum += (cqa.weight || 1) * Math.log(di);
      }
    });

    const overallD = zeroHit ? 0 : Number(Math.exp(logSum / totalWeight).toFixed(4));

    // Convert coded factors to actual values
    const actualFactors: Record<string, number | string> = {};
    factors.forEach((f) => {
      if (f.role === 'mixture_component' || f.type === 'Mixture') {
        const frac = currentCoded[f.code] ?? 0;
        actualFactors[f.code] = Number((frac * 100).toFixed(2));
      } else {
        const c = currentCoded[f.code] ?? 0;
        actualFactors[f.code] = codedToActual(c, f);
      }
    });

    return {
      overallD,
      individualD,
      predictions,
      actualFactors,
    };
  }, [currentCoded, validCQAs, models, factors]);

  // Maximize Desirability (Global Optimizer)
  const handleMaximizeDesirability = () => {
    // Build locked factor dictionary
    const lockedDict: Record<string, number> = {};
    factors.forEach((f) => {
      if (lockedFactors[f.code]) {
        lockedDict[f.code] = currentCoded[f.code] ?? 0;
      }
    });

    const solution = optimizeDesirability(factors, cqas, models, lockedDict);
    if (solution) {
      setCurrentCoded({ ...solution.codedFactors });
      if (onApplyOptimum) {
        onApplyOptimum(solution);
      }

      try {
        confetti({
          particleCount: 80,
          spread: 70,
          origin: { y: 0.6 },
        });
      } catch {}
    }
  };

  // Reset all factors to Center (0 for process, mid-proportion for mixture)
  const handleResetToCenter = () => {
    setCurrentCoded(createInitialCoded(factors));
  };

  // Remember current setting (Saved Candidate)
  const handleRememberSetting = () => {
    if (!currentEvaluation) return;
    const newSaved: SavedDesirabilitySetting = {
      id: `setting-${Date.now()}`,
      name: `Kịch bản #${savedSettings.length + 1} (D = ${currentEvaluation.overallD})`,
      createdAt: new Date().toLocaleTimeString('vi-VN'),
      codedFactors: { ...currentCoded },
      actualFactors: { ...currentEvaluation.actualFactors },
      predictedResponses: { ...currentEvaluation.predictions },
      overallDesirability: currentEvaluation.overallD,
    };
    setSavedSettings((prev) => [newSaved, ...prev]);
  };

  // Restore saved setting
  const handleRestoreSetting = (saved: SavedDesirabilitySetting) => {
    setCurrentCoded(normalizeMixtureCoded(saved.codedFactors, factors));
  };

  // Delete saved setting
  const handleDeleteSetting = (id: string) => {
    setSavedSettings((prev) => prev.filter((s) => s.id !== id));
  };

  // Update CQA parameters in Goal Editor
  const handleCQAFieldChange = (cqaId: string, field: keyof CQA, value: any) => {
    if (!onUpdateCQAs) return;
    const updated = cqas.map((c) => (c.id === cqaId ? { ...c, [field]: value } : c));
    onUpdateCQAs(updated);
  };

  // Helper to generate Plotly trace and layout for a single CQA Desirability curve d_i(Y)
  const getDesirabilityCurveData = (cqa: CQA) => {
    const L = cqa.lowerLimit;
    const U = cqa.upperLimit;
    const T = cqa.target;
    const s = cqa.sShape || 1.0;
    const t = cqa.tShape || 1.0;

    const currentY = currentEvaluation?.predictions[cqa.code]?.value ?? NaN;
    const currentDi = currentEvaluation?.individualD[cqa.code] ?? 0;

    let minVal = 0;
    let maxVal = 100;

    if (cqa.objective === 'maximize') {
      const low = L !== undefined ? L : T !== undefined ? T * 0.8 : 0;
      const target = T !== undefined ? T : U !== undefined ? U : low + 10;
      const span = Math.max(1, target - low);
      minVal = low - 0.25 * span;
      maxVal = target + 0.35 * span;
    } else if (cqa.objective === 'minimize') {
      const target = T !== undefined ? T : L !== undefined ? L : 0;
      const up = U !== undefined ? U : target + 10;
      const span = Math.max(1, up - target);
      minVal = Math.max(0, target - 0.35 * span);
      maxVal = up + 0.25 * span;
    } else if (cqa.objective === 'target') {
      const low = L !== undefined ? L : T !== undefined ? T * 0.8 : 0;
      const up = U !== undefined ? U : T !== undefined ? T * 1.2 : low + 20;
      const span = Math.max(1, up - low);
      minVal = low - 0.2 * span;
      maxVal = up + 0.2 * span;
    } else {
      const low = L !== undefined ? L : 0;
      const up = U !== undefined ? U : 100;
      const span = Math.max(1, up - low);
      minVal = low - 0.2 * span;
      maxVal = up + 0.2 * span;
    }

    if (!isNaN(currentY)) {
      minVal = Math.min(minVal, currentY - 0.05 * Math.abs(currentY || 1));
      maxVal = Math.max(maxVal, currentY + 0.05 * Math.abs(currentY || 1));
    }

    const N = 100;
    const xVals: number[] = [];
    const yVals: number[] = [];

    for (let i = 0; i < N; i++) {
      const yVal = minVal + (i / (N - 1)) * (maxVal - minVal);
      const dVal = calculateIndividualDesirability(yVal, cqa.objective, L, U, T, s, t);
      // Keep the numerical grid unrounded.  Rounding a low-range response such
      // as PDI before Plotly receives it turns a continuous desirability curve
      // into visible plateaus.
      xVals.push(yVal);
      yVals.push(dVal);
    }

    const traces: any[] = [
      // Baseline 1.0 (100% Satisfaction)
      {
        type: 'scatter',
        mode: 'lines',
        name: 'Thỏa mãn 100% (d = 1.0)',
        x: [minVal, maxVal],
        y: [1.0, 1.0],
        line: { color: 'rgba(22, 163, 74, 0.45)', width: 1.5, dash: 'dash' },
        hoverinfo: 'name',
      },
      // Baseline 0.0 (0% Satisfaction)
      {
        type: 'scatter',
        mode: 'lines',
        name: 'Không thỏa mãn (d = 0.0)',
        x: [minVal, maxVal],
        y: [0.0, 0.0],
        line: { color: 'rgba(220, 38, 38, 0.45)', width: 1.5, dash: 'dash' },
        hoverinfo: 'name',
      },
      // Main Curve d_i(Y)
      {
        type: 'scatter',
        mode: 'lines',
        name: `Hàm thỏa dụng d_${cqa.code}(Y)`,
        x: xVals,
        y: yVals,
        line: { color: '#2563eb', width: 2.8 },
        fill: 'tozeroy',
        fillcolor: 'rgba(37, 99, 235, 0.08)',
        hoverinfo: 'x+y',
      },
    ];

    // Current point marker
    if (!isNaN(currentY)) {
      traces.push({
        type: 'scatter',
        mode: 'markers+text',
        name: `Hiện tại (${currentY})`,
        x: [currentY],
        y: [currentDi],
        marker: {
          size: 11,
          color: currentDi >= 0.8 ? '#16a34a' : currentDi > 0 ? '#d97706' : '#dc2626',
          line: { color: '#ffffff', width: 2 },
        },
        text: [`d=${currentDi.toFixed(3)}`],
        textposition: 'top center',
        textfont: { size: 10, color: '#0f172a', weight: 700 },
        hoverinfo: 'text',
        hovertext: [
          `<b>${cqa.name} (${cqa.code})</b><br>` +
          `Dự đoán hiện tại: <b>${currentY} ${cqa.unit || ''}</b><br>` +
          `Độ thỏa dụng: <b>d = ${currentDi.toFixed(4)} (${(currentDi * 100).toFixed(1)}%)</b>`
        ],
      });
    }

    const shapes: any[] = [];
    const annotations: any[] = [];

    if (L !== undefined) {
      shapes.push({
        type: 'line',
        x0: L,
        x1: L,
        y0: 0,
        y1: 1.05,
        line: { color: '#dc2626', width: 1.8, dash: 'dot' },
      });
      annotations.push({
        x: L,
        y: 0.12,
        text: `L=${L}`,
        showarrow: false,
        font: { size: 9.5, color: '#dc2626', weight: 700 },
        bgcolor: '#ffffff',
        borderpad: 2,
      });
    }

    if (T !== undefined) {
      shapes.push({
        type: 'line',
        x0: T,
        x1: T,
        y0: 0,
        y1: 1.05,
        line: { color: '#16a34a', width: 1.8, dash: 'dot' },
      });
      annotations.push({
        x: T,
        y: 0.88,
        text: `Target=${T}`,
        showarrow: false,
        font: { size: 9.5, color: '#16a34a', weight: 700 },
        bgcolor: '#ffffff',
        borderpad: 2,
      });
    }

    if (U !== undefined && (cqa.objective !== 'target' || U !== T)) {
      shapes.push({
        type: 'line',
        x0: U,
        x1: U,
        y0: 0,
        y1: 1.05,
        line: { color: '#dc2626', width: 1.8, dash: 'dot' },
      });
      annotations.push({
        x: U,
        y: 0.12,
        text: `U=${U}`,
        showarrow: false,
        font: { size: 9.5, color: '#dc2626', weight: 700 },
        bgcolor: '#ffffff',
        borderpad: 2,
      });
    }

    const layout = {
      title: {
        text: `<b>${cqa.code}: ${cqa.name}</b> (${cqa.objective === 'maximize' ? '📈 Maximize (Lớn nhất)' : cqa.objective === 'minimize' ? '📉 Minimize (Nhỏ nhất)' : cqa.objective === 'target' ? '🎯 Match Target (Đạt đích)' : '📏 In Range (Trong khoảng)'})`,
        font: { size: 11, color: '#1e3a8a', family: 'Inter, sans-serif' },
      },
      xaxis: {
        title: { text: `${cqa.name}${cqa.unit ? ` [${cqa.unit}]` : ''}`, font: { size: 10, color: '#334155' } },
        range: [minVal, maxVal],
        tickfont: { size: 9 },
        zeroline: false,
      },
      yaxis: {
        title: { text: `d_${cqa.code}`, font: { size: 10, color: '#334155' } },
        range: [-0.05, 1.15],
        tickvals: [0, 0.25, 0.5, 0.75, 1.0],
        ticktext: ['0 (0%)', '0.25', '0.5', '0.75', '1.0 (100%)'],
        tickfont: { size: 9 },
        zeroline: true,
      },
      margin: { l: 45, r: 20, t: 35, b: 40, pad: 2 },
      shapes,
      annotations,
      showlegend: false,
      height: 220,
    };

    return { traces, layout };
  };

  // Generate interactive 2D Trace curves for the Profiler Grid
  const profilerGridData = useMemo(() => {
    if (validCQAs.length === 0 || factors.length === 0) return null;

    const N_POINTS = 35;

    // Grid data structure: traces[cqaCode][factorCode]
    const responseTraces: Record<
      string,
      Record<
        string,
        {
          xActual: number[];
          yPred: number[];
          ciUpper: number[];
          ciLower: number[];
          currentXActual: number;
          currentYPred: number;
        }
      >
    > = {};

    // Desirability traces: dTraces[factorCode] for overall D
    const dTraces: Record<
      string,
      {
        xActual: number[];
        dOverall: number[];
        currentXActual: number;
        currentD: number;
      }
    > = {};

    const totalWeight = validCQAs.reduce((sum, c) => sum + (c.weight || 1), 0);

    // Compute for each factor column
    factors.forEach((f) => {
      const isMix = f.role === 'mixture_component' || f.type === 'Mixture';
      const feasibleMixtureRange = isMix ? getFeasibleMixtureComponentRange(factors, f.code) : null;
      const lowVal = isMix
        ? (feasibleMixtureRange?.low ?? (f.high <= 1.0 && f.unit !== '%' ? f.low : f.low / 100))
        : -1.0;
      const highVal = isMix
        ? (feasibleMixtureRange?.high ?? (f.high <= 1.0 && f.unit !== '%' ? f.high : f.high / 100))
        : 1.0;

      const xRange: number[] = isDiscreteFactor(f)
        ? getFactorGridCodes(f, N_POINTS)
        : Array.from({ length: N_POINTS }, (_, i) => lowVal + (i / (N_POINTS - 1)) * (highVal - lowVal));

      const xActualArr: number[] = [];
      const dOverallArr: number[] = [];

      xRange.forEach((xc) => {
        // Chart coordinates remain raw; number formatting belongs to labels and
        // hover text, never to the data passed into a trace.
        const xAct = isMix ? xc * 100 : codedToActual(xc, f);
        xActualArr.push(typeof xAct === 'number' ? xAct : Number(xAct) || xc);

        // Build point holding other factors at current settings
        const testPoint = isMix
          ? setBoundedMixtureComponent(currentCoded, factors, f.code, xc)
          : { ...currentCoded, [f.code]: xc };

        // Evaluate overall D at this test point
        let logSum = 0;
        let zero = false;
        validCQAs.forEach((cqa) => {
          const model = models[cqa.code];
          const yp = model.predict(testPoint);
          const di = calculateIndividualDesirability(
            yp,
            cqa.objective,
            cqa.lowerLimit,
            cqa.upperLimit,
            cqa.target,
            cqa.sShape || 1.0,
            cqa.tShape || 1.0
          );
          if (di <= 0) zero = true;
          else logSum += (cqa.weight || 1) * Math.log(di);
        });

        dOverallArr.push(zero ? 0 : Math.exp(logSum / totalWeight));
      });

      const currXAct = isMix ? (currentCoded[f.code] ?? 0) * 100 : codedToActual(currentCoded[f.code] ?? 0, f);
      dTraces[f.code] = {
        xActual: xActualArr,
        dOverall: dOverallArr,
        currentXActual: typeof currXAct === 'number' ? currXAct : Number(currXAct) || 0,
        currentD: currentEvaluation?.overallD || 0,
      };

      // Now compute for each CQA row
      validCQAs.forEach((cqa) => {
        if (!responseTraces[cqa.code]) {
          responseTraces[cqa.code] = {};
        }

        const model = models[cqa.code];
        const statisticalModel = 'predictStandardError' in model ? model : undefined;
        const df = statisticalModel?.residualDegreesOfFreedom;
        const critical = df ? tDistributionCritical(0.05, df) : Number.NaN;
        const yPredArr: number[] = [];
        const ciUpArr: number[] = [];
        const ciLowArr: number[] = [];

        xRange.forEach((xc) => {
          const testPoint = isMix
            ? setBoundedMixtureComponent(currentCoded, factors, f.code, xc)
            : { ...currentCoded, [f.code]: xc };
          const yp = model.predict(testPoint);
          const se = statisticalModel?.predictStandardError?.(testPoint) ?? 0;
          const halfWidth = statisticalModel && Number.isFinite(critical) ? critical * se : Number.NaN;
          // Do not quantise predictions or confidence limits before plotting.
          // PDI commonly changes by less than 0.001 across adjacent grid points.
          yPredArr.push(yp);
          ciUpArr.push(Number.isFinite(halfWidth) ? yp + halfWidth : Number.NaN);
          ciLowArr.push(Number.isFinite(halfWidth) ? yp - halfWidth : Number.NaN);
        });

        const currY = model.predict(currentCoded);

        responseTraces[cqa.code][f.code] = {
          xActual: xActualArr,
          yPred: yPredArr,
          ciUpper: ciUpArr,
          ciLower: ciLowArr,
          currentXActual: typeof currXAct === 'number' ? currXAct : Number(currXAct) || 0,
          currentYPred: currY,
        };
      });
    });

    // Tính toán dải trục tung đồng bộ (Uniform Y-Range) cho từng hàng CQA để mọi yếu tố dùng chung tỷ lệ scale trực quan
    const cqaRowRanges: Record<string, [number, number]> = {};
    validCQAs.forEach((cqa) => {
      const allVals: number[] = [];
      factors.forEach((f) => {
        const t = responseTraces[cqa.code]?.[f.code];
        if (t) {
          t.yPred.forEach((v) => { if (Number.isFinite(v)) allVals.push(v); });
          t.ciUpper.forEach((v) => { if (Number.isFinite(v)) allVals.push(v); });
          t.ciLower.forEach((v) => { if (Number.isFinite(v)) allVals.push(v); });
          if (Number.isFinite(t.currentYPred)) allVals.push(t.currentYPred);
        }
      });
      if (allVals.length > 0) {
        const minY = Math.min(...allVals);
        const maxY = Math.max(...allVals);
        const spanY = maxY - minY;
        const padY = spanY > 1e-6 ? spanY * 0.12 : Math.max(0.1, Math.abs(maxY) * 0.1);
        cqaRowRanges[cqa.code] = [minY - padY, maxY + padY];
      } else {
        cqaRowRanges[cqa.code] = [0, 100];
      }
    });

    // Tính toán dải trục tung cho hàng Overall Desirability (D)
    const allDVals: number[] = [];
    factors.forEach((f) => {
      const d = dTraces[f.code];
      if (d) {
        d.dOverall.forEach((v) => { if (Number.isFinite(v)) allDVals.push(v); });
        if (Number.isFinite(d.currentD)) allDVals.push(d.currentD);
      }
    });
    let dRowRange: [number, number] = [0, 1.05];
    if (allDVals.length > 0) {
      const minD = Math.min(...allDVals);
      const maxD = Math.max(...allDVals);
      const spanD = maxD - minD;
      const padD = Math.max(0.04, spanD * 0.15);
      const dLow = Math.max(0, minD - padD);
      const dHigh = Math.min(1.05, maxD + padD);
      dRowRange = dHigh - dLow >= 0.15 ? [dLow, dHigh] : [Math.max(0, dLow - 0.1), Math.min(1.05, dHigh + 0.1)];
    }

    return {
      responseTraces,
      dTraces,
      cqaRowRanges,
      dRowRange,
    };
  }, [factors, validCQAs, models, currentCoded, currentEvaluation]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      
      {/* Top Banner: Overall Desirability Score & Action Bar */}
      <div
        style={{
          background: 'linear-gradient(135deg, #1e3a8a 0%, #1e40af 100%)',
          borderRadius: '0.75rem',
          padding: '1.25rem 1.5rem',
          color: '#ffffff',
          boxShadow: '0 4px 12px rgba(30, 58, 138, 0.15)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '1rem',
          }}
        >
          {/* Title & Desirability Gauge */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div
              style={{
                width: '78px',
                height: '78px',
                minWidth: '78px',
                borderRadius: '50%',
                background:
                  (currentEvaluation?.overallD || 0) >= 0.8
                    ? 'linear-gradient(135deg, #10b981, #059669)'
                    : (currentEvaluation?.overallD || 0) >= 0.5
                    ? 'linear-gradient(135deg, #f59e0b, #d97706)'
                    : 'linear-gradient(135deg, #ef4444, #dc2626)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 4px 14px rgba(0, 0, 0, 0.25)',
                border: '3px solid rgba(255, 255, 255, 0.7)',
                flexShrink: 0,
                textAlign: 'center',
              }}
            >
              <span
                style={{
                  fontSize: '0.62rem',
                  textTransform: 'uppercase',
                  fontWeight: '800',
                  letterSpacing: '0.04em',
                  color: 'rgba(255, 255, 255, 0.95)',
                  lineHeight: 1,
                  marginBottom: '0.2rem',
                }}
              >
                OVERALL D
              </span>
              <span
                style={{
                  fontSize: '1.25rem',
                  fontWeight: '900',
                  fontFamily: 'monospace',
                  lineHeight: 1,
                  color: '#ffffff',
                  textShadow: '0 1px 3px rgba(0,0,0,0.3)',
                }}
              >
                {currentEvaluation?.overallD.toFixed(3) || '0.000'}
              </span>
              <span
                style={{
                  fontSize: '0.55rem',
                  fontWeight: '700',
                  color: 'rgba(255, 255, 255, 0.9)',
                  lineHeight: 1,
                  marginTop: '0.2rem',
                  textTransform: 'uppercase',
                }}
              >
                {(currentEvaluation?.overallD || 0) >= 0.8
                  ? 'TỐI ƯU'
                  : (currentEvaluation?.overallD || 0) >= 0.5
                  ? 'ĐẠT'
                  : 'CHƯA ĐẠT'}
              </span>
            </div>

            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <h3 style={{ fontSize: '1.15rem', fontWeight: '700', margin: 0 }}>
                  Prediction Profiler & Desirability Optimization
                </h3>
                <span
                  style={{
                    fontSize: '0.7rem',
                    padding: '0.15rem 0.5rem',
                    borderRadius: '1rem',
                    backgroundColor: 'rgba(255,255,255,0.2)',
                    fontWeight: '600',
                  }}
                >
                  Derringer-Suich Multi-Response
                </span>
              </div>
              <p style={{ fontSize: '0.8rem', color: '#bfdbfe', margin: '0.25rem 0 0 0' }}>
                Khảo sát tương tác độ nhạy, khóa thông số quy trình và tối đa hóa đồng thời tất cả các chỉ tiêu chất lượng.
              </p>
            </div>
          </div>

          {/* Action Buttons Toolbar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
            <button
              onClick={handleMaximizeDesirability}
              className="btn"
              style={{
                backgroundColor: '#10b981',
                color: '#ffffff',
                fontWeight: '700',
                fontSize: '0.85rem',
                padding: '0.45rem 1rem',
                borderRadius: '0.5rem',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                boxShadow: '0 2px 6px rgba(16, 185, 129, 0.3)',
              }}
              title="Tìm nghiệm tối ưu toàn cục Derringer-Suich D (tôn trọng các biến đã khóa)"
            >
              <Sparkles size={16} />
              <span>Tối Đa Hóa Thỏa Dụng (Max D)</span>
            </button>

            <button
              onClick={handleRememberSetting}
              className="btn"
              style={{
                backgroundColor: 'rgba(255, 255, 255, 0.15)',
                color: '#ffffff',
                fontWeight: '600',
                fontSize: '0.8rem',
        padding: '0.45rem 0.85rem',
                borderRadius: '0.5rem',
                border: '1px solid rgba(255,255,255,0.3)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
              }}
              title="Lưu lại điểm cài đặt hiện tại để so sánh kịch bản (Remember Settings)"
            >
              <BookmarkPlus size={15} />
              <span>Lưu Kịch Bản ({savedSettings.length})</span>
            </button>

            <button
              onClick={handleResetToCenter}
              className="btn"
              style={{
                backgroundColor: 'rgba(255, 255, 255, 0.15)',
                color: '#ffffff',
                fontWeight: '600',
                fontSize: '0.8rem',
                padding: '0.45rem 0.85rem',
                borderRadius: '0.5rem',
                border: '1px solid rgba(255,255,255,0.3)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
              }}
              title="Đặt lại tất cả các yếu tố về mức tâm (0)"
            >
              <RotateCcw size={14} />
              <span>Về Tâm (0)</span>
            </button>

            <button
              onClick={() => setShowGoalEditor(!showGoalEditor)}
              className="btn"
              style={{
                backgroundColor: showGoalEditor ? '#ffffff' : 'rgba(255, 255, 255, 0.15)',
                color: showGoalEditor ? '#1e3a8a' : '#ffffff',
                fontWeight: '600',
                fontSize: '0.8rem',
                padding: '0.45rem 0.85rem',
                borderRadius: '0.5rem',
                border: '1px solid rgba(255,255,255,0.3)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
              }}
              title="Mở bảng cấu hình mục tiêu và hàm hình dạng (s/t shapes)"
            >
              <Settings size={14} />
              <span>Mục Tiêu & Trọng Số</span>
              {showGoalEditor ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          </div>
        </div>
      </div>

      {/* Accordion: Desirability Goals & Shapes Editor */}
      {showGoalEditor && (
        <div
          className="qbd-card animate-fade-in"
          style={{
            border: '2px solid #3b82f6',
            backgroundColor: '#ffffff',
            padding: '1rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Target size={18} color="#1e40af" />
              <h4 style={{ fontSize: '0.95rem', fontWeight: '700', color: '#0f172a', margin: 0 }}>
                Cấu Hình Hàm Hài Lòng Từng Phần (dᵢ) & Tham Số Hình Dạng (s, t)
              </h4>
            </div>
            <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
              s &gt; 1: Khắt khe gần mục tiêu | s &lt; 1: Khoan dung | s = 1: Tuyến tính
            </span>
          </div>

          <div className="table-container">
            <table className="qbd-table">
              <thead>
                <tr>
                  <th style={{ width: '6%' }}>Mã</th>
                  <th style={{ width: '18%' }}>Tên CQA</th>
                  <th style={{ width: '15%' }}>Mục Tiêu (Goal)</th>
                  <th style={{ width: '10%' }}>Giới Hạn Dưới (L)</th>
                  <th style={{ width: '10%' }}>Đích (Target T)</th>
                  <th style={{ width: '10%' }}>Giới Hạn Trên (U)</th>
                  <th style={{ width: '9%' }}>Shape $s$</th>
                  <th style={{ width: '9%' }}>Shape $t$</th>
                  <th style={{ width: '8%' }}>Trọng Số $w_i$</th>
                  <th style={{ width: '5%', textAlign: 'center' }}>$d_i$ Hiện Tại</th>
                </tr>
              </thead>
              <tbody>
                {validCQAs.map((cqa) => {
                  const currentDi = currentEvaluation?.individualD[cqa.code] ?? 0;
                  return (
                    <tr key={cqa.id}>
                      <td className="font-mono font-bold" style={{ color: '#1e3a8a' }}>
                        {cqa.code}
                      </td>
                      <td style={{ fontWeight: '600' }}>{cqa.name}</td>
                      <td>
                        <select
                          className="input-field"
                          style={{ fontSize: '0.78rem' }}
                          value={cqa.objective}
                          onChange={(e) => handleCQAFieldChange(cqa.id, 'objective', e.target.value as CQAObjective)}
                        >
                          <option value="maximize">📈 Maximize (Lớn nhất)</option>
                          <option value="minimize">📉 Minimize (Nhỏ nhất)</option>
                          <option value="target">🎯 Match Target (Đạt đích)</option>
                          <option value="range">📏 In Range (Trong khoảng)</option>
                        </select>
                      </td>
                      <td>
                        <input
                          type="number"
                          step="any"
                          className="input-field font-mono"
                          value={cqa.lowerLimit ?? ''}
                          placeholder="L"
                          onChange={(e) =>
                            handleCQAFieldChange(
                              cqa.id,
                              'lowerLimit',
                              e.target.value === '' ? undefined : Number(e.target.value)
                            )
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          step="any"
                          className="input-field font-mono"
                          value={cqa.target ?? ''}
                          placeholder="Target"
                          onChange={(e) =>
                            handleCQAFieldChange(
                              cqa.id,
                              'target',
                              e.target.value === '' ? undefined : Number(e.target.value)
                            )
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          step="any"
                          className="input-field font-mono"
                          value={cqa.upperLimit ?? ''}
                          placeholder="U"
                          onChange={(e) =>
                            handleCQAFieldChange(
                              cqa.id,
                              'upperLimit',
                              e.target.value === '' ? undefined : Number(e.target.value)
                            )
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          step="0.1"
                          min="0.1"
                          max="10"
                          className="input-field font-mono"
                          value={cqa.sShape ?? 1.0}
                          title="Hệ số mũ s (dưới target)"
                          onChange={(e) =>
                            handleCQAFieldChange(
                              cqa.id,
                              'sShape',
                              e.target.value === '' ? 1.0 : Number(e.target.value)
                            )
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          step="0.1"
                          min="0.1"
                          max="10"
                          className="input-field font-mono"
                          value={cqa.tShape ?? 1.0}
                          title="Hệ số mũ t (trên target)"
                          onChange={(e) =>
                            handleCQAFieldChange(
                              cqa.id,
                              'tShape',
                              e.target.value === '' ? 1.0 : Number(e.target.value)
                            )
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          step="any"
                          min="0.1"
                          className="input-field font-mono"
                          style={{ textAlign: 'center', fontWeight: '700' }}
                          value={cqa.weight}
                          placeholder="1.0"
                          onChange={(e) =>
                            handleCQAFieldChange(
                              cqa.id,
                              'weight',
                              e.target.value === '' ? 1.0 : Number(e.target.value)
                            )
                          }
                        />
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <span
                          className={`badge ${
                            currentDi >= 0.8
                              ? 'badge-success'
                              : currentDi > 0
                              ? 'badge-warning'
                              : 'badge-danger'
                          }`}
                          style={{ fontFamily: 'monospace', fontWeight: '700' }}
                        >
                          {currentDi.toFixed(3)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Desirability Curves Visualization Grid (Slide 25–27) */}
          <div style={{ marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid #e2e8f0' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.85rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                <TrendingUp size={17} color="#2563eb" />
                <h5 style={{ fontSize: '0.9rem', fontWeight: '700', color: '#1e3a8a', margin: 0 }}>
                  Đồ Thị Minh Họa Hàm Hài Lòng Từng Phần (dᵢ(Y) theo Y)
                </h5>
              </div>
              <span className="badge badge-primary" style={{ fontSize: '0.72rem', backgroundColor: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe' }}>
                Derringer &amp; Suich (1980) Standard
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '1rem' }}>
              {validCQAs.map((cqa) => {
                const curve = getDesirabilityCurveData(cqa);
                const currentY = currentEvaluation?.predictions[cqa.code]?.value ?? NaN;
                const currentDi = currentEvaluation?.individualD[cqa.code] ?? 0;
                const L = cqa.lowerLimit;
                const U = cqa.upperLimit;
                const T = cqa.target;
                const s = cqa.sShape || 1.0;
                const t = cqa.tShape || 1.0;

                return (
                  <div
                    key={cqa.id}
                    style={{
                      border: '1px solid #cbd5e1',
                      borderRadius: '0.5rem',
                      backgroundColor: '#f8fafc',
                      padding: '0.75rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.5rem',
                    }}
                  >
                    {/* Plotly Chart of d_i(Y) */}
                    <div style={{ height: '220px', width: '100%' }}>
                      <PlotlyChart
                        data={curve.traces}
                        layout={curve.layout}
                        config={{ responsive: true, displayModeBar: false }}
                        style={{ width: '100%', height: '100%' }}
                      />
                    </div>

                    {/* Explanatory Spec Breakdown */}
                    <div
                      style={{
                        backgroundColor: '#ffffff',
                        border: '1px solid #e2e8f0',
                        borderRadius: '0.375rem',
                        padding: '0.6rem 0.75rem',
                        fontSize: '0.75rem',
                        lineHeight: '1.45',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.3rem',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: '700' }}>
                        <span style={{ color: '#1e3a8a' }}>{cqa.code}: {cqa.name}</span>
                        <span className={`badge ${currentDi >= 0.8 ? 'badge-success' : currentDi > 0 ? 'badge-warning' : 'badge-danger'}`} style={{ fontSize: '0.7rem' }}>
                          Hiện tại: Y={isNaN(currentY) ? '-' : currentY} (d={currentDi.toFixed(3)})
                        </span>
                      </div>

                      {/* 100% Satisfaction Region */}
                      <div style={{ color: '#15803d' }}>
                        <strong>🟢 Thỏa mãn 100% ($d_{cqa.code} = 1.0$): </strong>
                        {cqa.objective === 'maximize' && `Khi ${cqa.code} ≥ ${T ?? U ?? 0} ${cqa.unit || ''} (Càng lớn càng tốt)`}
                        {cqa.objective === 'minimize' && `Khi ${cqa.code} ≤ ${T ?? L ?? 0} ${cqa.unit || ''} (Càng nhỏ càng tốt)`}
                        {cqa.objective === 'target' && `Khi ${cqa.code} = ${T ?? ((L ?? 0) + (U ?? 100)) / 2} ${cqa.unit || ''} (Đạt chính xác Đích)`}
                        {cqa.objective === 'range' && `Khi ${L ?? 0} ≤ ${cqa.code} ≤ ${U ?? 100} ${cqa.unit || ''}`}
                      </div>

                      {/* 0% Satisfaction (Unacceptable) Region */}
                      <div style={{ color: '#b91c1c' }}>
                        <strong>🔴 Thỏa mãn 0% ($d_{cqa.code} = 0.0$): </strong>
                        {cqa.objective === 'maximize' && `Khi ${cqa.code} ≤ ${L ?? 0} ${cqa.unit || ''} (Dưới ngưỡng chấp nhận)`}
                        {cqa.objective === 'minimize' && `Khi ${cqa.code} ≥ ${U ?? 100} ${cqa.unit || ''} (Vượt ngưỡng chấp nhận)`}
                        {cqa.objective === 'target' && `Khi ${cqa.code} ≤ ${L ?? 0} hoặc ${cqa.code} ≥ ${U ?? 100} ${cqa.unit || ''} (Ngoài dải [L, U])`}
                        {cqa.objective === 'range' && `Khi ${cqa.code} < ${L ?? 0} hoặc ${cqa.code} > ${U ?? 100} ${cqa.unit || ''}`}
                      </div>

                      {/* Shape Parameter Formula */}
                      <div style={{ color: '#475569', fontSize: '0.72rem', backgroundColor: '#f1f5f9', padding: '0.3rem 0.5rem', borderRadius: '0.25rem' }}>
                        <strong>Hệ số hình dạng: </strong>
                        {cqa.objective === 'maximize' && `s = ${s} (${s === 1 ? 'Tuyến tính' : s > 1 ? 'Khắt khe dốc' : 'Khoan dung lồi'})`}
                        {cqa.objective === 'minimize' && `t = ${t} (${t === 1 ? 'Tuyến tính' : t > 1 ? 'Khắt khe dốc' : 'Khoan dung lồi'})`}
                        {cqa.objective === 'target' && `s = ${s} (nhánh dưới), t = ${t} (nhánh trên)`}
                        {cqa.objective === 'range' && `Hàm bước (Step function)`}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Main Prediction Profiler Matrix */}
      <div className="qbd-card" style={{ padding: '1rem', overflowX: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <TrendingUp size={20} color="#1e3a8a" />
            <h3 style={{ fontSize: '1.05rem', fontWeight: '700', color: '#0f172a', margin: 0 }}>
              Ma Trận Đồ Thị Dự Báo (Prediction Profiler Matrix)
            </h3>
          </div>
          <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
            Kéo trượt đường màu đỏ để tương tác trực tiếp với các biến $X$
          </span>
        </div>

        {/* Profiler Grid Table: Rows = CQAs + Overall D, Columns = Factors */}
        {profilerGridData && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {/* Header: Factors Column Labels & Slider Controls */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: `180px repeat(${factors.length}, minmax(220px, 1fr))`,
                gap: '0.5rem',
                // Every factor uses the same card height so a short discrete
                // selector never drops below the numeric input/slider cards.
                alignItems: 'stretch',
              }}
            >
              <div style={{ fontSize: '0.78rem', fontWeight: '700', color: '#475569', paddingBottom: '0.5rem', alignSelf: 'end' }}>
                ĐÁP ỨNG / YẾU TỐ
              </div>

              {factors.map((f) => {
                const coded = currentCoded[f.code] ?? 0;
                const actual = codedToActual(coded, f);
                const isLocked = lockedFactors[f.code] || false;

                if (isDiscreteFactor(f)) {
                  const levels = getConfiguredFactorLevels(f);
                  const codes = getConfiguredFactorCodes(f);
                  return (
                    <div key={f.code} style={{ backgroundColor: isLocked ? '#fef2f2' : '#f8fafc', borderRadius: '0.5rem', padding: '0.6rem', border: isLocked ? '1px solid #fecaca' : '1px solid #e2e8f0', minHeight: '178px', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', minHeight: '2.5rem' }}>
                        <span style={{ fontSize: '0.8rem', fontWeight: '700', color: '#1e293b' }}>{f.name} ({f.code})</span>
                        <button onClick={() => handleToggleLock(f.code)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: isLocked ? '#ef4444' : '#94a3b8' }}>{isLocked ? <Lock size={15} /> : <Unlock size={15} />}</button>
                      </div>
                      <select className="input-field" style={{ width: '100%', minHeight: '2.35rem' }} value={String(actual)} disabled={f.controllability === 'constant'} onChange={(event) => {
                        const index = levels.findIndex((level) => String(level) === event.target.value);
                        setCurrentCoded((prev) => ({ ...prev, [f.code]: codes[index] ?? codes[0] ?? 0 }));
                      }}>
                        {levels.map((level) => <option key={String(level)} value={String(level)}>{String(level)} {f.unit}</option>)}
                      </select>
                      <div style={{ marginTop: 'auto', minHeight: '2.65rem', display: 'flex', justifyContent: 'space-between', alignItems: 'end', fontSize: '0.65rem', color: '#94a3b8' }}>
                        <span>{String(levels[0] ?? '')} {f.unit}</span>
                        <span>{String(levels[levels.length - 1] ?? '')} {f.unit}</span>
                      </div>
                    </div>
                  );
                }

                return (
                  <div
                    key={f.code}
                    style={{
                      backgroundColor: isLocked ? '#fef2f2' : '#f8fafc',
                      borderRadius: '0.5rem',
                      padding: '0.6rem',
                      border: isLocked ? '1px solid #fecaca' : '1px solid #e2e8f0',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.35rem',
                      minHeight: '178px',
                    }}
                  >
                    {/* Factor Header with Lock button */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', minHeight: '2.5rem' }}>
                      <span style={{ fontSize: '0.8rem', fontWeight: '700', color: '#1e293b' }}>
                        {f.name} ({f.code})
                      </span>
                      <button
                        onClick={() => handleToggleLock(f.code)}
                        style={{
                          border: 'none',
                          background: 'none',
                          cursor: 'pointer',
                          padding: '2px',
                          color: isLocked ? '#ef4444' : '#94a3b8',
                        }}
                        title={isLocked ? 'Đang khóa (Click để mở khóa)' : 'Mở khóa (Click để khóa khi tối ưu hóa)'}
                      >
                        {isLocked ? <Lock size={15} /> : <Unlock size={15} />}
                      </button>
                    </div>

                    {/* Numeric Input & Unit */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      <input
                        type="number"
                        step="any"
                        disabled={f.controllability === 'constant'}
                        className="input-field font-mono"
                        style={{
                          flex: 1,
                          minHeight: '2.35rem',
                          padding: '0.2rem 0.4rem',
                          fontSize: '0.8rem',
                          fontWeight: '700',
                          color: '#b45309',
                          textAlign: 'center',
                        }}
                        value={typeof actual === 'number' ? actual : Number(actual) || 0}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          if (!isNaN(val)) {
                            const isMix = f.role === 'mixture_component' || f.type === 'Mixture';
                            const newCoded = isMix ? val / 100 : actualToCoded(val, f);
                            setCurrentCoded((prev) => isMix
                              ? setBoundedMixtureComponent(prev, factors, f.code, newCoded)
                              : { ...prev, [f.code]: Number(newCoded.toFixed(4)) });
                          }
                        }}
                      />
                      <span style={{ fontSize: '0.72rem', color: '#64748b', minWidth: '24px' }}>
                        {f.unit || (f.role === 'mixture_component' || f.type === 'Mixture' ? '%' : '')}
                      </span>
                    </div>

                    {/* Range Slider */}
                    {f.role === 'mixture_component' || f.type === 'Mixture' ? (
                      <>
                        <input
                          type="range"
                          min={f.low}
                          max={f.high}
                          step={0.1}
                          disabled={f.controllability === 'constant'}
                          value={typeof actual === 'number' ? actual : Number(actual) || 0}
                          onChange={(e) => {
                            const valPct = Number(e.target.value);
                            setCurrentCoded((prev) => setBoundedMixtureComponent(prev, factors, f.code, valPct / 100));
                          }}
                          style={{ width: '100%', cursor: 'pointer' }}
                        />
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', color: '#94a3b8' }}>
                          <span>{f.low}%</span>
                          <span className="font-mono font-bold" style={{ color: '#0f766e' }}>
                            {typeof actual === 'number' ? `${actual}%` : `${actual}`}
                          </span>
                          <span>{f.high}%</span>
                        </div>
                      </>
                    ) : (
                      <>
                        <input
                          type="range"
                          min={-1}
                          max={1}
                          step={0.01}
                          disabled={f.controllability === 'constant'}
                          value={coded}
                          onChange={(e) => {
                            setCurrentCoded((prev) => ({
                              ...prev,
                              [f.code]: Number(e.target.value),
                            }));
                          }}
                          style={{ width: '100%', cursor: 'pointer' }}
                        />
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', color: '#94a3b8' }}>
                          <span>{f.low}</span>
                          <span className="font-mono" style={{ color: '#0284c7' }}>
                            {coded >= 0 ? `+${coded.toFixed(2)}` : coded.toFixed(2)}
                          </span>
                          <span>{f.high}</span>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Rows: Each CQA Trace */}
            {validCQAs.map((cqa) => {
              const predInfo = currentEvaluation?.predictions[cqa.code];
              const di = currentEvaluation?.individualD[cqa.code] ?? 0;

              return (
                <div
                  key={cqa.code}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: `180px repeat(${factors.length}, minmax(220px, 1fr))`,
                    gap: '0.5rem',
                    alignItems: 'center',
                    backgroundColor: '#ffffff',
                    padding: '0.35rem 0',
                    borderBottom: '1px solid #f1f5f9',
                  }}
                >
                  {/* Left Label: CQA Name, Predicted Value & di */}
                  <div style={{ padding: '0.4rem', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                    <span style={{ fontSize: '0.82rem', fontWeight: '700', color: '#0f172a' }}>
                      {cqa.name} ({cqa.code})
                    </span>
                    <div style={{ fontSize: '0.85rem', fontWeight: '800', color: '#1e40af', fontFamily: 'monospace' }}>
                      {predInfo?.value ?? '-'} {cqa.unit}
                    </div>
                    <div style={{ fontSize: '0.68rem', color: '#64748b' }}>
                      {Number.isFinite(predInfo?.ciLow) ? `95% CI: [${predInfo?.ciLow} - ${predInfo?.ciHigh}]` : '95% CI: chưa khả dụng cho ANN'}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', marginTop: '0.1rem' }}>
                      <span style={{ fontSize: '0.68rem', color: '#64748b' }}>d:</span>
                      <span
                        className={`badge ${
                          di >= 0.8 ? 'badge-success' : di > 0 ? 'badge-warning' : 'badge-danger'
                        }`}
                        style={{ fontSize: '0.65rem', padding: '0.1rem 0.35rem' }}
                      >
                        {di.toFixed(3)}
                      </span>
                    </div>
                  </div>

                  {/* Factor Columns: Plotly mini trace */}
                  {factors.map((f, factorIndex) => {
                    const traceData = profilerGridData.responseTraces[cqa.code]?.[f.code];
                    if (!traceData) return <div key={f.code} />;

                    const plotData: any[] = [
                      // 95% Confidence Interval Upper
                      {
                        x: traceData.xActual,
                        y: traceData.ciUpper,
                        type: 'scatter',
                        mode: 'lines',
                        line: { width: 0 },
                        showlegend: false,
                        hoverinfo: 'skip',
                      },
                      // 95% Confidence Interval Lower with fill
                      {
                        x: traceData.xActual,
                        y: traceData.ciLower,
                        type: 'scatter',
                        mode: 'lines',
                        fill: 'tonexty',
                        fillcolor: 'rgba(59, 130, 246, 0.12)',
                        line: { width: 0 },
                        showlegend: false,
                        hoverinfo: 'skip',
                      },
                      // Prediction Line
                      {
                        x: traceData.xActual,
                        y: traceData.yPred,
                        type: 'scatter',
                        mode: 'lines',
                        line: { color: '#2563eb', width: 2.2 },
                        name: `${cqa.name} (${cqa.code}) vs ${f.name} (${f.code})`,
                        text: traceData.xActual.map(
                          (x, i) =>
                            `${f.name} (${f.code}): ${formatPlotValue(x)} ${f.unit || ''}<br>` +
                            `${cqa.name} (${cqa.code}): ${formatPlotValue(traceData.yPred[i])} ${cqa.unit || ''}`
                        ),
                        hoverinfo: 'text',
                        showlegend: false,
                      },
                      // Current Setpoint Marker
                      {
                        x: [traceData.currentXActual],
                        y: [traceData.currentYPred],
                        type: 'scatter',
                        mode: 'markers',
                        marker: { size: 7, color: '#dc2626' },
                        name: `Hiện tại: ${formatPlotValue(traceData.currentXActual)} ${f.unit || ''} → ${formatPlotValue(traceData.currentYPred)} ${cqa.unit || ''}`,
                        showlegend: false,
                        hoverinfo: 'name',
                      },
                    ];

                    const layout: any = {
                      // A matrix uses shared outer axes: the left column carries Y,
                      // and the bottom row carries X. This preserves names/units
                      // without repeating them in every cell.
                      margin: { l: factorIndex === 0 ? 54 : 10, r: 8, t: 6, b: 20, pad: 1 },
                      height: 145,
                      showlegend: false,
                      xaxis: {
                        showticklabels: false,
                        showgrid: true,
                        gridcolor: '#f1f5f9',
                        zeroline: false,
                        tickfont: { size: 9 },
                      },
                      yaxis: {
                        title: factorIndex === 0 ? { text: `${cqa.code} [${cqa.unit || '—'}]`, font: { size: 10, color: '#334155' }, standoff: 4 } : undefined,
                        showticklabels: factorIndex === 0,
                        range: profilerGridData.cqaRowRanges[cqa.code],
                        nticks: 4,
                        tickformat: '~g',
                        showgrid: true,
                        gridcolor: '#f1f5f9',
                        zeroline: false,
                        tickfont: { size: 9 },
                      },
                      // Vertical Red Line for Current Setting
                      shapes: [
                        {
                          type: 'line',
                          x0: traceData.currentXActual,
                          x1: traceData.currentXActual,
                          y0: 0,
                          y1: 1,
                          yref: 'paper',
                          line: { color: '#dc2626', width: 1.5, dash: 'dot' },
                        },
                      ],
                    };

                    return (
                      <div
                        key={f.code}
                        style={{
                          height: '145px',
                          border: '1px solid #e2e8f0',
                          borderRadius: '0.375rem',
                          backgroundColor: '#fafafa',
                          overflow: 'hidden',
                        }}
                      >
                        <PlotlyChart
                          data={plotData}
                          layout={layout}
                          config={{ responsive: true, displayModeBar: false, compact: true }}
                          style={{ width: '100%', height: '100%' }}
                        />
                      </div>
                    );
                  })}
                </div>
              );
            })}

            {/* Bottom Row: Overall Desirability (D) Trace */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: `180px repeat(${factors.length}, minmax(220px, 1fr))`,
                gap: '0.5rem',
                alignItems: 'center',
                backgroundColor: '#eff6ff',
                padding: '0.5rem',
                borderRadius: '0.5rem',
                border: '1px solid #bfdbfe',
              }}
            >
              {/* Left Label: Overall Desirability Header */}
              <div style={{ padding: '0.4rem', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: '800', color: '#1e3a8a' }}>
                  OVERALL DESIRABILITY (D)
                </span>
                <div style={{ fontSize: '1.1rem', fontWeight: '800', color: '#059669', fontFamily: 'monospace' }}>
                  D = {currentEvaluation?.overallD.toFixed(4)}
                </div>
                <span style={{ fontSize: '0.7rem', color: '#64748b' }}>
                  Hàm Thỏa Dụng Tổng Thể
                </span>
              </div>

              {/* Factor Columns: Plotly Overall D Traces */}
              {factors.map((f, factorIndex) => {
                const dData = profilerGridData.dTraces[f.code];
                if (!dData) return <div key={f.code} />;

                const plotData: any[] = [
                  {
                    x: dData.xActual,
                    y: dData.dOverall,
                    type: 'scatter',
                    mode: 'lines',
                    line: { color: '#059669', width: 2.5 },
                    name: `Overall D vs ${f.name} (${f.code})`,
                    text: dData.xActual.map(
                      (x, i) =>
                        `${f.name} (${f.code}): ${x} ${f.unit || ''}<br>Overall D: ${dData.dOverall[i].toFixed(4)}`
                    ),
                    hoverinfo: 'text',
                    showlegend: false,
                  },
                  {
                    x: [dData.currentXActual],
                    y: [dData.currentD],
                    type: 'scatter',
                    mode: 'markers',
                    marker: { size: 8, color: '#dc2626' },
                    name: `Hiện tại: ${dData.currentXActual} ${f.unit || ''} → D = ${dData.currentD.toFixed(4)}`,
                    showlegend: false,
                    hoverinfo: 'name',
                  },
                ];

                const layout: any = {
                  margin: { l: factorIndex === 0 ? 54 : 10, r: 8, t: 6, b: 36, pad: 1 },
                  height: 145,
                  showlegend: false,
                  xaxis: {
                    title: { text: `${f.code} [${f.unit || '—'}]`, font: { size: 10, color: '#334155' }, standoff: 4 },
                    showgrid: true,
                    gridcolor: '#e2e8f0',
                    zeroline: false,
                    tickfont: { size: 9 },
                  },
                  yaxis: {
                    title: factorIndex === 0 ? { text: 'D [—]', font: { size: 10, color: '#334155' }, standoff: 4 } : undefined,
                    showticklabels: factorIndex === 0,
                    range: profilerGridData.dRowRange,
                    nticks: 4,
                    tickformat: '.2f',
                    showgrid: true,
                    gridcolor: '#e2e8f0',
                    zeroline: false,
                    tickfont: { size: 9 },
                  },
                  shapes: [
                    {
                      type: 'line',
                      x0: dData.currentXActual,
                      x1: dData.currentXActual,
                      y0: 0,
                      y1: 1,
                      yref: 'paper',
                      line: { color: '#dc2626', width: 1.5, dash: 'dot' },
                    },
                  ],
                };

                return (
                  <div
                    key={f.code}
                    style={{
                      height: '145px',
                      border: '1px solid #a7f3d0',
                      borderRadius: '0.375rem',
                      backgroundColor: '#ffffff',
                      overflow: 'hidden',
                    }}
                  >
                    <PlotlyChart
                      data={plotData}
                      layout={layout}
                      config={{ responsive: true, displayModeBar: false, compact: true }}
                      style={{ width: '100%', height: '100%' }}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Saved Solutions Comparison Table (Candidate Table) */}
      {savedSettings.length > 0 && (
        <div className="qbd-card animate-fade-in" style={{ padding: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Layers size={18} color="#0f766e" />
              <h4 style={{ fontSize: '0.95rem', fontWeight: '700', color: '#0f172a', margin: 0 }}>
                Bảng So Sánh Các Phương Án Tối Ưu Đã Lưu (Saved Optimization Candidates)
              </h4>
            </div>
            <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
              {savedSettings.length} kịch bản đã lưu
            </span>
          </div>

          <div className="table-container">
            <table className="qbd-table">
              <thead>
                <tr>
                  <th style={{ width: '18%' }}>Tên Kịch Bản</th>
                  <th style={{ width: '12%' }}>Thời Gian</th>
                  <th style={{ width: '12%' }}>Thỏa Dụng (D)</th>
                  <th style={{ width: '30%' }}>Thông Số Cài Đặt (X)</th>
                  <th style={{ width: '20%' }}>Đáp Ứng Dự Đoán (Y)</th>
                  <th style={{ width: '8%', textAlign: 'center' }}>Thao Tác</th>
                </tr>
              </thead>
              <tbody>
                {savedSettings.map((s) => (
                  <tr key={s.id}>
                    <td style={{ fontWeight: '700', color: '#1e3a8a' }}>{s.name}</td>
                    <td style={{ fontSize: '0.75rem', color: '#64748b' }}>{s.createdAt}</td>
                    <td>
                      <span
                        className={`badge ${
                          s.overallDesirability >= 0.8
                            ? 'badge-success'
                            : s.overallDesirability > 0
                            ? 'badge-warning'
                            : 'badge-danger'
                        }`}
                        style={{ fontFamily: 'monospace', fontWeight: '700' }}
                      >
                        {s.overallDesirability.toFixed(4)}
                      </span>
                    </td>
                    <td>
                      <div style={{ fontSize: '0.75rem', display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                        {factors.map((f) => (
                          <span
                            key={f.code}
                            style={{
                              backgroundColor: '#f1f5f9',
                              padding: '0.15rem 0.35rem',
                              borderRadius: '0.25rem',
                            }}
                          >
                            <strong>{f.code}:</strong> {s.actualFactors[f.code]} {f.unit}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>
                      <div style={{ fontSize: '0.75rem', display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                        {validCQAs.map((c) => (
                          <span
                            key={c.code}
                            style={{
                              backgroundColor: '#f0fdf4',
                              padding: '0.15rem 0.35rem',
                              borderRadius: '0.25rem',
                              color: '#166534',
                            }}
                          >
                            <strong>{c.code}:</strong> {s.predictedResponses[c.code]?.value} {c.unit}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}>
                        <button
                          onClick={() => handleRestoreSetting(s)}
                          className="btn btn-secondary"
                          style={{ fontSize: '0.72rem', padding: '0.2rem 0.45rem' }}
                          title="Tải lại kịch bản này vào Profiler"
                        >
                          Tải Lại
                        </button>
                        <button
                          onClick={() => handleDeleteSetting(s.id)}
                          style={{
                            border: 'none',
                            background: 'none',
                            color: '#ef4444',
                            cursor: 'pointer',
                            padding: '3px',
                          }}
                          title="Xóa kịch bản"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

    </div>
  );
};
