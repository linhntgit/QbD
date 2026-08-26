import React, { useState, useMemo } from 'react';
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
import { codedToActual, actualToCoded } from '../services/doeGenerator';
import { optimizeDesirability } from '../services/statistics';
import { calculateIndividualDesirability } from '../services/mathUtils';

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

  // Current interactive factor settings (coded values [-1, +1])
  const [currentCoded, setCurrentCoded] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    factors.forEach((f) => {
      init[f.code] = 0;
    });
    return init;
  });

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
      const se = (model.diagnostics as any)?.stdDev ?? (model.diagnostics as any)?.rmseTrain ?? 0.1;
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
        ciLow: Number((val - 1.96 * se).toFixed(3)),
        ciHigh: Number((val + 1.96 * se).toFixed(3)),
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
      const c = currentCoded[f.code] ?? 0;
      actualFactors[f.code] = codedToActual(c, f);
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

  // Reset all factors to Center (0)
  const handleResetToCenter = () => {
    const centerCoded: Record<string, number> = {};
    factors.forEach((f) => {
      centerCoded[f.code] = 0;
    });
    setCurrentCoded(centerCoded);
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
    setCurrentCoded({ ...saved.codedFactors });
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

  // Generate interactive 2D Trace curves for the Profiler Grid
  const profilerGridData = useMemo(() => {
    if (validCQAs.length === 0 || factors.length === 0) return null;

    const N_POINTS = 35;
    const xCodedRange: number[] = [];
    for (let i = 0; i < N_POINTS; i++) {
      xCodedRange.push(-1.0 + (2.0 * i) / (N_POINTS - 1));
    }

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
      const xActualArr: number[] = [];
      const dOverallArr: number[] = [];

      xCodedRange.forEach((xc) => {
        const xAct = codedToActual(xc, f);
        xActualArr.push(typeof xAct === 'number' ? xAct : Number(xAct) || xc);

        // Build point holding other factors at current settings
        const testPoint: Record<string, number> = { ...currentCoded, [f.code]: xc };

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

      const currXAct = codedToActual(currentCoded[f.code] ?? 0, f);
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
        const se = (model.diagnostics as any)?.stdDev ?? (model.diagnostics as any)?.rmseTrain ?? 0.1;
        const yPredArr: number[] = [];
        const ciUpArr: number[] = [];
        const ciLowArr: number[] = [];

        xCodedRange.forEach((xc) => {
          const testPoint: Record<string, number> = { ...currentCoded, [f.code]: xc };
          const yp = model.predict(testPoint);
          yPredArr.push(Number(yp.toFixed(3)));
          ciUpArr.push(Number((yp + 1.96 * se).toFixed(3)));
          ciLowArr.push(Number((yp - 1.96 * se).toFixed(3)));
        });

        const currY = model.predict(currentCoded);

        responseTraces[cqa.code][f.code] = {
          xActual: xActualArr,
          yPred: yPredArr,
          ciUpper: ciUpArr,
          ciLower: ciLowArr,
          currentXActual: typeof currXAct === 'number' ? currXAct : Number(currXAct) || 0,
          currentYPred: Number(currY.toFixed(3)),
        };
      });
    });

    return {
      responseTraces,
      dTraces,
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
                width: '64px',
                height: '64px',
                borderRadius: '50%',
                backgroundColor:
                  (currentEvaluation?.overallD || 0) >= 0.8
                    ? '#10b981'
                    : (currentEvaluation?.overallD || 0) >= 0.5
                    ? '#f59e0b'
                    : '#ef4444',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
                border: '3px solid rgba(255,255,255,0.4)',
              }}
            >
              <span style={{ fontSize: '0.65rem', textTransform: 'uppercase', fontWeight: '700', letterSpacing: '0.5px' }}>
                Overall D
              </span>
              <span style={{ fontSize: '1.15rem', fontWeight: '800', fontFamily: 'monospace' }}>
                {currentEvaluation?.overallD.toFixed(3) || '0.000'}
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
                Cấu Hình Hàm Thỏa Dụng Từng Chỉ Tiêu ($d_i$) & Tham Số Hình Dạng ($s, t$)
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
                alignItems: 'end',
              }}
            >
              <div style={{ fontSize: '0.78rem', fontWeight: '700', color: '#475569', paddingBottom: '0.5rem' }}>
                ĐÁP ỨNG / YẾU TỐ
              </div>

              {factors.map((f) => {
                const coded = currentCoded[f.code] ?? 0;
                const actual = codedToActual(coded, f);
                const isLocked = lockedFactors[f.code] || false;

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
                    }}
                  >
                    {/* Factor Header with Lock button */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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
                            const newCoded = actualToCoded(val, f);
                            setCurrentCoded((prev) => ({
                              ...prev,
                              [f.code]: Number(Math.max(-1.5, Math.min(1.5, newCoded)).toFixed(4)),
                            }));
                          }
                        }}
                      />
                      <span style={{ fontSize: '0.72rem', color: '#64748b', minWidth: '24px' }}>
                        {f.unit}
                      </span>
                    </div>

                    {/* Range Slider */}
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
                      95% CI: [{predInfo?.ciLow} - {predInfo?.ciHigh}]
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
                  {factors.map((f) => {
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
                            `${f.name} (${f.code}): ${x} ${f.unit || ''}<br>${cqa.name} (${cqa.code}): ${traceData.yPred[i]} ${cqa.unit || ''}`
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
                        name: `Hiện tại: ${traceData.currentXActual} ${f.unit || ''} → ${traceData.currentYPred} ${cqa.unit || ''}`,
                        showlegend: false,
                        hoverinfo: 'name',
                      },
                    ];

                    const layout: any = {
                      margin: { l: 32, r: 15, t: 10, b: 24 },
                      height: 125,
                      showlegend: false,
                      xaxis: {
                        showgrid: true,
                        gridcolor: '#f1f5f9',
                        zeroline: false,
                        tickfont: { size: 9 },
                      },
                      yaxis: {
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
                          height: '130px',
                          border: '1px solid #e2e8f0',
                          borderRadius: '0.375rem',
                          backgroundColor: '#fafafa',
                          overflow: 'hidden',
                        }}
                      >
                        <PlotlyChart data={plotData} layout={layout} style={{ width: '100%', height: '100%' }} />
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
              {factors.map((f) => {
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
                  margin: { l: 32, r: 15, t: 10, b: 24 },
                  height: 125,
                  showlegend: false,
                  xaxis: {
                    showgrid: true,
                    gridcolor: '#e2e8f0',
                    zeroline: false,
                    tickfont: { size: 9 },
                  },
                  yaxis: {
                    range: [0, 1.05],
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
                      height: '130px',
                      border: '1px solid #a7f3d0',
                      borderRadius: '0.375rem',
                      backgroundColor: '#ffffff',
                      overflow: 'hidden',
                    }}
                  >
                    <PlotlyChart data={plotData} layout={layout} style={{ width: '100%', height: '100%' }} />
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
