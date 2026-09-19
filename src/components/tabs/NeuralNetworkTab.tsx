import React, { useState, useMemo, useEffect } from 'react';
import {
  BrainCircuit,
  Sliders,
  RefreshCw,
  Copy,
  Check,
  TrendingUp,
  Layers,
  Sparkles,
  Compass,
  ArrowRight,
  Code2,
  Loader2,
  Cpu,
  CheckCircle2,
  Network,
  AlertTriangle,
  AlertOctagon,
  Share2,
  Target,
  Zap,
  RotateCcw,
  Info,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import type {
  QBDProject,
  StatisticalModelResult,
  NeuralNetConfig,
  NeuralNetModelResult,
  NeuralTrainingMode,
  NeuralActivation,
  ModelingEngine,
} from '../../types/qbd';
import { PlotlyChart } from '../PlotlyChart';
import { NeuralNetworkTopologyDiagram } from '../NeuralNetworkTopologyDiagram';
import {
  calculateNeuralArchitectureMetrics,
  DEFAULT_NEURAL_CONFIG,
  getNeuralTrainingSampleCount,
} from '../../services/neuralNetwork';
import { buildFactorFeatures } from '../../services/modelTerms';
import { formatAxisTitle } from '../../services/mathUtils';
import {
  computeXAIImportance,
  generateCQAImpactMatrix,
  type XAIComprehensiveResult,
  type CQAImpactMatrixItem,
} from '../../services/explainableAI';
import {
  benchmarkCQAModels,
  type CQAMultiModelBenchmark,
} from '../../services/modelBenchmarking';

interface NeuralNetworkTabProps {
  project: QBDProject;
  models: Record<string, StatisticalModelResult>;
  neuralModels: Record<string, NeuralNetModelResult>;
  neuralTrainingMode?: NeuralTrainingMode;
  onSetNeuralTrainingMode?: (mode: NeuralTrainingMode) => void;
  sharedNeuralConfig?: NeuralNetConfig;
  onTrainSharedModel?: (config: NeuralNetConfig) => void;
  neuralConfigs: Record<string, NeuralNetConfig>;
  onTrainModel?: (cqaCode: string, config: NeuralNetConfig) => void;
  onTrainIndependentModel?: (cqaCode: string, config: NeuralNetConfig) => void;
  onTrainAllIndependentModels?: () => void;
  onCopyConfigToAll?: (sourceConfig: NeuralNetConfig) => void;
  selectedCQA: string;
  onSelectCQA: (cqaCode: string) => void;
  modelingEngine?: ModelingEngine;
  onSelectEngine?: (engine: ModelingEngine) => void;
  onNavigateToRSM: () => void;
  onNavigateToDesignSpace: () => void;
}

export const NeuralNetworkTab: React.FC<NeuralNetworkTabProps> = ({
  project,
  models,
  neuralModels,
  neuralTrainingMode = 'independent',
  onSetNeuralTrainingMode,
  sharedNeuralConfig,
  onTrainSharedModel,
  neuralConfigs,
  onTrainModel,
  onTrainIndependentModel,
  onTrainAllIndependentModels,
  onCopyConfigToAll,
  selectedCQA,
  onSelectCQA,
  modelingEngine,
  onSelectEngine,
  onNavigateToRSM,
  onNavigateToDesignSpace,
}) => {
  const currentCQA = project.cqas.find((c) => c.code === selectedCQA) || project.cqas[0];
  const neuralModel = currentCQA ? neuralModels[currentCQA.code] : null;
  const anovaModel = currentCQA ? models[currentCQA.code] : null;

  // Hyperparameters State
  const currentConfig: NeuralNetConfig = neuralConfigs[selectedCQA] || {
    hiddenNodes1: 3,
    hiddenNodes2: 0,
    activation: 'tanh',
    weightDecay: 0.01,
    learningRate: 0.03,
    maxEpochs: 1000,
    validationMethod: 'kfold',
    holdoutRatio: 0.25,
    kFolds: 5,
    numTours: 10,
    seed: 42,
  };

  const [localConfig, setLocalConfig] = useState<NeuralNetConfig>(currentConfig);
  const [activeDiagPlot, setActiveDiagPlot] = useState<'actPred' | 'resPred' | 'loss' | 'varImp'>('actPred');
  const [xaiSubTab, setXaiSubTab] = useState<'beeswarm' | 'waterfall' | 'comparison' | 'matrix'>('beeswarm');
  const [waterfallRunOrder, setWaterfallRunOrder] = useState<number>(1);
  const [copiedType, setCopiedType] = useState<'python' | 'excel' | 'formula' | null>(null);

  // Active inputs & architecture parameters
  const activeFactors = useMemo(
    () => project.factors.filter((f) => f.controllability !== 'constant'),
    [project.factors]
  );
  const numInputs = useMemo(() => {
    const treatmentInputs = buildFactorFeatures(activeFactors).length;
    const blockCount = new Set(project.runs.map((run) => Math.max(1, Math.floor(run.block ?? 1)))).size;
    return treatmentInputs + Math.max(0, blockCount - 1);
  }, [activeFactors, project.runs]);
  const numOutputs = neuralTrainingMode === 'shared' ? project.cqas.length : 1;
  const numSamples = project.runs.length;

  const archMetrics = useMemo(() => {
    const trainingSamples = getNeuralTrainingSampleCount(numSamples, localConfig);
    return calculateNeuralArchitectureMetrics(
      numInputs,
      localConfig.hiddenNodes1,
      localConfig.hiddenNodes2,
      numOutputs,
      trainingSamples
    );
  }, [numInputs, localConfig, numOutputs, numSamples]);

  // Live Training / Fitting State
  const [isTraining, setIsTraining] = useState<boolean>(false);
  const [trainingProgress, setTrainingProgress] = useState<{
    tour: number;
    totalTours: number;
    epoch: number;
    maxEpochs: number;
    loss?: number;
    bestR2?: number;
    phase: string;
  } | null>(null);
  const [lastTrainedNotice, setLastTrainedNotice] = useState<string | null>(null);
  const [configActionNotice, setConfigActionNotice] = useState<string | null>(null);

  // Explainable AI (XAI) and Multi-Model Benchmarking Memos
  const xaiResult = useMemo<XAIComprehensiveResult | null>(() => {
    if (!neuralModel || !currentCQA) return null;
    return computeXAIImportance(neuralModel, project.runs, project.factors, currentCQA);
  }, [neuralModel, project.runs, project.factors, currentCQA]);

  const allXaiResults = useMemo<Record<string, XAIComprehensiveResult>>(() => {
    const map: Record<string, XAIComprehensiveResult> = {};
    project.cqas.forEach((c) => {
      const nm = neuralModels[c.code];
      if (nm) {
        map[c.code] = computeXAIImportance(nm, project.runs, project.factors, c);
      }
    });
    return map;
  }, [neuralModels, project.runs, project.factors, project.cqas]);

  const cqaImpactMatrix = useMemo<CQAImpactMatrixItem[]>(() => {
    if (Object.keys(allXaiResults).length === 0) return [];
    return generateCQAImpactMatrix(project.cqas, project.factors, allXaiResults);
  }, [project.cqas, project.factors, allXaiResults]);

  const cqaBenchmark = useMemo<CQAMultiModelBenchmark | null>(() => {
    if (!currentCQA) return null;
    return benchmarkCQAModels(
      currentCQA,
      project.factors,
      project.runs,
      anovaModel,
      neuralModel,
    );
  }, [currentCQA, project.factors, project.runs, anovaModel, neuralModel]);

  // Keep local config in sync when switching CQA or training mode
  useEffect(() => {
    if (neuralTrainingMode === 'shared') {
      if (sharedNeuralConfig) {
        setLocalConfig(sharedNeuralConfig);
      } else {
        setLocalConfig(DEFAULT_NEURAL_CONFIG);
      }
    } else {
      if (neuralConfigs[selectedCQA]) {
        setLocalConfig(neuralConfigs[selectedCQA]);
      } else {
        setLocalConfig(DEFAULT_NEURAL_CONFIG);
      }
    }
  }, [neuralTrainingMode, selectedCQA, sharedNeuralConfig, neuralConfigs]);

  const handleTrain = async () => {
    if (neuralTrainingMode === 'shared') {
      setIsTraining(true);
      setLastTrainedNotice(null);
      const totalTours = localConfig.numTours || 10;
      const maxEpochs = localConfig.maxEpochs || 1000;
      const numDisplaySteps = Math.min(totalTours, 8);

      for (let t = 1; t <= numDisplaySteps; t++) {
        setTrainingProgress({
          tour: t,
          totalTours,
          epoch: Math.floor((maxEpochs * t) / numDisplaySteps),
          maxEpochs,
          phase: `Đang huấn luyện mạng Multi-Output Tour #${t}/${totalTours} • Fit đồng thời ${project.cqas.length} biến Y (${localConfig.activation.toUpperCase()} [${localConfig.hiddenNodes1}${localConfig.hiddenNodes2 > 0 ? `, ${localConfig.hiddenNodes2}` : ''}])...`,
        });

        await new Promise((resolve) => setTimeout(resolve, 80));
      }

      if (onTrainSharedModel) {
        onTrainSharedModel(localConfig);
      } else if (onTrainModel && currentCQA) {
        onTrainModel(currentCQA.code, localConfig);
      }

      setTrainingProgress({
        tour: totalTours,
        totalTours,
        epoch: maxEpochs,
        maxEpochs,
        phase: `✓ Hoàn tất huấn luyện mạng nơ-ron hợp nhất cho toàn bộ ${project.cqas.length} biến Y!`,
      });

      setTimeout(() => {
        setIsTraining(false);
        setTrainingProgress(null);
        setLastTrainedNotice(`✓ Huấn luyện thành công mạng nơ-ron hợp nhất (Multi-Output MLP) cho toàn bộ ${project.cqas.length} biến Y!`);
        try {
          confetti({ particleCount: 75, spread: 60, origin: { y: 0.6 } });
        } catch {}
      }, 350);
    } else {
      if (!currentCQA) return;

      setIsTraining(true);
      setLastTrainedNotice(null);
      const totalTours = localConfig.numTours || 10;
      const maxEpochs = localConfig.maxEpochs || 1000;
      const numDisplaySteps = Math.min(totalTours, 8);

      for (let t = 1; t <= numDisplaySteps; t++) {
        setTrainingProgress({
          tour: t,
          totalTours,
          epoch: Math.floor((maxEpochs * t) / numDisplaySteps),
          maxEpochs,
          phase: `Đang tối ưu hóa Tour #${t}/${totalTours} cho ${currentCQA.code} • Hàm kích hoạt ${localConfig.activation.toUpperCase()} (Lớp ẩn: [${localConfig.hiddenNodes1}${localConfig.hiddenNodes2 > 0 ? `, ${localConfig.hiddenNodes2}` : ''}])...`,
        });

        await new Promise((resolve) => setTimeout(resolve, 80));
      }

      if (onTrainIndependentModel) {
        onTrainIndependentModel(currentCQA.code, localConfig);
      } else if (onTrainModel) {
        onTrainModel(currentCQA.code, localConfig);
      }

      setTrainingProgress({
        tour: totalTours,
        totalTours,
        epoch: maxEpochs,
        maxEpochs,
        phase: `✓ Hoàn tất huấn luyện mạng nơ-ron cho ${currentCQA.name}!`,
      });

      setTimeout(() => {
        setIsTraining(false);
        setTrainingProgress(null);
        setLastTrainedNotice(`✓ Huấn luyện thành công ${totalTours} Tours cho ${currentCQA.name} (${currentCQA.code})!`);
        try {
          confetti({ particleCount: 65, spread: 55, origin: { y: 0.6 } });
        } catch {}
      }, 350);
    }
  };

  const handleTrainAllIndependent = async () => {
    setIsTraining(true);
    setLastTrainedNotice(null);
    const totalCQAs = project.cqas.length;

    for (let i = 0; i < totalCQAs; i++) {
      const cqa = project.cqas[i];
      setTrainingProgress({
        tour: i + 1,
        totalTours: totalCQAs,
        epoch: 1000,
        maxEpochs: 1000,
        phase: `Đang huấn luyện mạng độc lập cho CQA #${i + 1}/${totalCQAs}: ${cqa.name} (${cqa.code})...`,
      });
      await new Promise((resolve) => setTimeout(resolve, 120));
    }

    if (onTrainAllIndependentModels) {
      onTrainAllIndependentModels();
    }

    setTimeout(() => {
      setIsTraining(false);
      setTrainingProgress(null);
      setLastTrainedNotice(`✓ Đã huấn luyện đồng loạt tất cả ${totalCQAs} biến Y với các mạng nơ-ron độc lập!`);
      try {
        confetti({ particleCount: 80, spread: 65, origin: { y: 0.6 } });
      } catch {}
    }, 300);
  };

  const handleCopyConfig = () => {
    if (onCopyConfigToAll) {
      onCopyConfigToAll(localConfig);
      setConfigActionNotice(`Đã sao chép cấu hình [${localConfig.hiddenNodes1}, ${localConfig.hiddenNodes2}, ${localConfig.activation}] sang tất cả ${project.cqas.length} CQA.`);
    }
  };

  const handleCopyCode = (text: string, type: 'python' | 'excel' | 'formula') => {
    navigator.clipboard.writeText(text);
    setCopiedType(type);
    setTimeout(() => setCopiedType(null), 2000);
  };

  if (!currentCQA) {
    return (
      <div className="qbd-card" style={{ textAlign: 'center', padding: '3rem' }}>
        <p>Vui lòng thêm ít nhất một chỉ tiêu CQA trong Tab 1.</p>
      </div>
    );
  }

  // Diagnostic Plots Data Preparation
  const renderDiagnosticPlot = () => {
    if (!neuralModel) return null;
    const diag = neuralModel.diagnostics;

    switch (activeDiagPlot) {
      case 'actPred': {
        const trainPts = diag.residuals.filter((r) => !r.isValidation);
        const valPts = diag.residuals.filter((r) => r.isValidation);

        const data: any[] = [
          {
            type: 'scatter',
            mode: 'markers',
            name: `Tập Huấn Luyện (Train, R²=${diag.rSquaredTrain.toFixed(4)})`,
            x: trainPts.map((r) => r.predicted),
            y: trainPts.map((r) => r.actual),
            marker: { size: 9, color: '#1e3a8a' },
            text: trainPts.map(
              (r) => `Run #${r.runOrder}: Thực tế=${r.actual} ${currentCQA.unit || ''}, Dự đoán=${r.predicted} ${currentCQA.unit || ''}`
            ),
          },
        ];

        if (valPts.length > 0) {
          data.push({
            type: 'scatter',
            mode: 'markers',
            name: `Tập Kiểm Định (Validation, R²=${diag.rSquaredVal.toFixed(4)})`,
            x: valPts.map((r) => r.predicted),
            y: valPts.map((r) => r.actual),
            marker: { size: 9, color: '#dc2626', symbol: 'triangle-up' },
            text: valPts.map(
              (r) => `[Validation] Run #${r.runOrder}: Thực tế=${r.actual} ${currentCQA.unit || ''}, Dự đoán=${r.predicted} ${currentCQA.unit || ''}`
            ),
          });
        }

        // 45-degree reference line (Ideal Y = Y_pred)
        const allVals = [...diag.residuals.map((r) => r.actual), ...diag.residuals.map((r) => r.predicted)];
        const minVal = Math.min(...allVals) * 0.95;
        const maxVal = Math.max(...allVals) * 1.05;

        data.push({
          type: 'line',
          name: 'Đường Chuẩn Y = Ý (Ideal 45°)',
          x: [minVal, maxVal],
          y: [minVal, maxVal],
          line: { color: '#64748b', width: 1.5, dash: 'dash' },
        });

        const layout = {
          title: `Đồ Thị Thực Tế vs. Dự Đoán - ${currentCQA.name} (${currentCQA.code})${currentCQA.unit ? ` [${currentCQA.unit}]` : ''}`,
          xaxis: {
            title: {
              text: formatAxisTitle('Giá Trị Dự Đoán Ý', currentCQA.code, currentCQA.unit),
              font: { size: 12, color: '#1e293b' },
              standoff: 10,
            },
            tickfont: { size: 10 },
            automargin: true,
          },
          yaxis: {
            title: {
              text: formatAxisTitle('Giá Trị Thực Tế Y', currentCQA.code, currentCQA.unit),
              font: { size: 12, color: '#1e293b' },
              standoff: 10,
            },
            tickfont: { size: 10 },
            automargin: true,
          },
          legend: { orientation: 'h', y: -0.35, yanchor: 'top', x: 0.5, xanchor: 'center' },
          margin: { l: 80, r: 40, t: 65, b: 115, pad: 4 },
        };

        return <PlotlyChart data={data} layout={layout} style={{ height: '400px' }} />;
      }

      case 'resPred': {
        const xPred = diag.residuals.map((r) => r.predicted);
        const yRes = diag.residuals.map((r) => r.residual);
        const isVal = diag.residuals.map((r) => r.isValidation);

        const data = [
          {
            type: 'scatter',
            mode: 'markers',
            x: xPred,
            y: yRes,
            marker: {
              size: 9,
              color: isVal.map((v) => (v ? '#dc2626' : '#0f766e')),
              symbol: isVal.map((v) => (v ? 'triangle-up' : 'circle')),
            },
            text: diag.residuals.map(
              (r) => `${r.isValidation ? '[Kiểm định Val] ' : ''}Run #${r.runOrder}: Thực tế=${r.actual} ${currentCQA.unit || ''}, Dự đoán=${r.predicted} ${currentCQA.unit || ''}, Phần dư=${r.residual} ${currentCQA.unit || ''}`
            ),
          },
        ];

        const rmse = diag.rmseOverall;
        const minX = Math.min(...xPred) * 0.95;
        const maxX = Math.max(...xPred) * 1.05;

        const layout = {
          title: `Phần Dư vs. Giá Trị Dự Đoán - ${currentCQA.name} (${currentCQA.code})`,
          xaxis: {
            title: {
              text: formatAxisTitle('Giá Trị Dự Đoán Ý', currentCQA.code, currentCQA.unit),
              font: { size: 12, color: '#1e293b' },
              standoff: 10,
            },
            tickfont: { size: 10 },
            automargin: true,
          },
          yaxis: {
            title: {
              text: formatAxisTitle('Phần Dư Y - Ý', currentCQA.code, currentCQA.unit),
              font: { size: 12, color: '#1e293b' },
              standoff: 10,
            },
            tickfont: { size: 10 },
            automargin: true,
          },
          shapes: [
            { type: 'line', x0: minX, x1: maxX, y0: 0, y1: 0, line: { color: '#64748b', width: 1.5 } },
            { type: 'line', x0: minX, x1: maxX, y0: 2 * rmse, y1: 2 * rmse, line: { color: '#dc2626', width: 1, dash: 'dot' } },
            { type: 'line', x0: minX, x1: maxX, y0: -2 * rmse, y1: -2 * rmse, line: { color: '#dc2626', width: 1, dash: 'dot' } },
          ],
          margin: { l: 80, r: 40, t: 65, b: 70, pad: 4 },
        };

        return <PlotlyChart data={data} layout={layout} style={{ height: '360px' }} />;
      }

      case 'loss': {
        const epochs = diag.lossHistory.map((h) => h.epoch);
        const trainLoss = diag.lossHistory.map((h) => h.trainLoss);
        const valLoss = diag.lossHistory.map((h) => h.valLoss);

        const data: any[] = [
          {
            type: 'scatter',
            mode: 'lines+markers',
            name: 'Training Loss (MSE)',
            x: epochs,
            y: trainLoss,
            line: { color: '#1e3a8a', width: 2 },
            marker: { size: 4 },
          },
        ];

        if (valLoss[0] !== undefined) {
          data.push({
            type: 'scatter',
            mode: 'lines+markers',
            name: 'Validation Loss (MSE)',
            x: epochs,
            y: valLoss,
            line: { color: '#dc2626', width: 2, dash: 'dot' },
            marker: { size: 4 },
          });
        }

        const layout = {
          title: `Đường Cong Hội Tụ Huấn Luyện (Loss History) - ${currentCQA.name} (${currentCQA.code}) [Tour #${diag.bestTourIndex}]`,
          xaxis: {
            title: {
              text: 'Số Vòng Lặp Huấn Luyện (Epochs)',
              font: { size: 12, color: '#1e293b' },
              standoff: 10,
            },
            tickfont: { size: 10 },
            automargin: true,
          },
          yaxis: {
            title: {
              text: 'Mean Squared Error (MSE Loss Chuẩn Hóa)',
              font: { size: 12, color: '#1e293b' },
              standoff: 10,
            },
            type: 'log',
            tickfont: { size: 10 },
            automargin: true,
          },
          legend: { orientation: 'h', y: -0.30, yanchor: 'top', x: 0.5, xanchor: 'center' },
          margin: { l: 80, r: 40, t: 65, b: 100, pad: 4 },
        };

        return <PlotlyChart data={data} layout={layout} style={{ height: '390px' }} />;
      }

      case 'varImp': {
        if (!xaiResult) {
          const sortedImp = [...diag.variableImportance];
          const names = sortedImp.map((v) => {
            const factor = project.factors.find((f) => f.code === v.factorCode);
            return `${v.factorCode}: ${v.factorName}${factor?.unit ? ` [${factor.unit}]` : ''}`;
          });
          const rels = sortedImp.map((v) => v.relativeImportance);

          const data = [
            {
              type: 'bar',
              x: rels,
              y: names,
              orientation: 'h',
              marker: { color: '#7c3aed' },
              text: rels.map((r) => `${r.toFixed(1)}%`),
              textposition: 'auto',
            },
          ];

          const layout = {
            title: `Mức Độ Quan Trọng Của Biến Đầu Vào (Independent Variable Importance)`,
            xaxis: {
              title: {
                text: 'Tỷ Lệ Đóng Góp Ảnh Hưởng Tương Đối (Relative Importance %)',
                font: { size: 12, color: '#1e293b' },
                standoff: 10,
              },
              tickfont: { size: 10 },
              automargin: true,
            },
            yaxis: {
              autorange: 'reversed',
              tickfont: { size: 11 },
              automargin: true,
            },
            margin: { l: 280, r: 40, t: 65, b: 70, pad: 10 },
          };

          return <PlotlyChart data={data} layout={layout} style={{ height: '360px' }} />;
        }

        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {/* Sub-navigation bar for Explainable AI Studio */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '0.5rem',
                backgroundColor: '#f8fafc',
                padding: '0.5rem 0.75rem',
                borderRadius: '0.5rem',
                border: '1px solid #e2e8f0',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <Sparkles size={16} color="#7c3aed" />
                <span style={{ fontSize: '0.82rem', fontWeight: '700', color: '#1e293b' }}>
                  XAI Studio (Hộp Kính AI Bào Chế):
                </span>
              </div>

              <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => setXaiSubTab('beeswarm')}
                  className={`btn ${xaiSubTab === 'beeswarm' ? 'btn-primary' : 'btn-outline'}`}
                  style={{
                    padding: '0.25rem 0.6rem',
                    fontSize: '0.74rem',
                    backgroundColor: xaiSubTab === 'beeswarm' ? '#7c3aed' : '#ffffff',
                    borderColor: '#7c3aed',
                    color: xaiSubTab === 'beeswarm' ? '#ffffff' : '#7c3aed',
                    fontWeight: '600',
                  }}
                >
                  🐝 SHAP Beeswarm (Toàn Cục)
                </button>
                <button
                  type="button"
                  onClick={() => setXaiSubTab('waterfall')}
                  className={`btn ${xaiSubTab === 'waterfall' ? 'btn-primary' : 'btn-outline'}`}
                  style={{
                    padding: '0.25rem 0.6rem',
                    fontSize: '0.74rem',
                    backgroundColor: xaiSubTab === 'waterfall' ? '#7c3aed' : '#ffffff',
                    borderColor: '#7c3aed',
                    color: xaiSubTab === 'waterfall' ? '#ffffff' : '#7c3aed',
                    fontWeight: '600',
                  }}
                >
                  💧 SHAP Waterfall (Cục Bộ)
                </button>
                <button
                  type="button"
                  onClick={() => setXaiSubTab('comparison')}
                  className={`btn ${xaiSubTab === 'comparison' ? 'btn-primary' : 'btn-outline'}`}
                  style={{
                    padding: '0.25rem 0.6rem',
                    fontSize: '0.74rem',
                    backgroundColor: xaiSubTab === 'comparison' ? '#7c3aed' : '#ffffff',
                    borderColor: '#7c3aed',
                    color: xaiSubTab === 'comparison' ? '#ffffff' : '#7c3aed',
                    fontWeight: '600',
                  }}
                >
                  ⚖️ Đối Chiếu 3 Thuật Toán (Garson - Olden - SHAP)
                </button>
                <button
                  type="button"
                  onClick={() => setXaiSubTab('matrix')}
                  className={`btn ${xaiSubTab === 'matrix' ? 'btn-primary' : 'btn-outline'}`}
                  style={{
                    padding: '0.25rem 0.6rem',
                    fontSize: '0.74rem',
                    backgroundColor: xaiSubTab === 'matrix' ? '#7c3aed' : '#ffffff',
                    borderColor: '#7c3aed',
                    color: xaiSubTab === 'matrix' ? '#ffffff' : '#7c3aed',
                    fontWeight: '600',
                  }}
                >
                  🎯 Ma Trận Ảnh Hưởng CPP - CQA
                </button>
              </div>
            </div>

            {/* View 1: SHAP Beeswarm Summary */}
            {xaiSubTab === 'beeswarm' && (() => {
              const globalShap = xaiResult.shap.globalImportance;
              const factorCodes = globalShap.map((g) => g.factorCode);
              const factorLabels = globalShap.map((g) => {
                const f = project.factors.find((fac) => fac.code === g.factorCode);
                return `${g.factorCode}: ${g.factorName}${f?.unit ? ` [${f.unit}]` : ''}`;
              });

              const xVals: number[] = [];
              const yVals: string[] = [];
              const colors: number[] = [];
              const hoverTexts: string[] = [];

              xaiResult.shap.runExplanations.forEach((run) => {
                run.values.forEach((v) => {
                  const labelIndex = factorCodes.indexOf(v.factorCode);
                  if (labelIndex >= 0) {
                    xVals.push(v.shapValue);
                    yVals.push(factorLabels[labelIndex]);
                    colors.push(v.codedValue);
                    hoverTexts.push(
                      `Run #${run.runOrder}<br>Yếu tố: ${v.factorName} (${v.factorCode})<br>Mức mã hóa: ${v.codedValue.toFixed(2)}<br>Giá trị thực: ${v.actualValue}<br>Giá trị SHAP: ${v.shapValue > 0 ? '+' : ''}${v.shapValue.toFixed(4)}`
                    );
                  }
                });
              });

              const beeswarmData = [
                {
                  type: 'scatter',
                  mode: 'markers',
                  x: xVals,
                  y: yVals,
                  text: hoverTexts,
                  hoverinfo: 'text',
                  marker: {
                    size: 11,
                    color: colors,
                    colorscale: [
                      [0, '#2563eb'],
                      [0.5, '#94a3b8'],
                      [1, '#ef4444'],
                    ],
                    cmin: -1,
                    cmax: 1,
                    colorbar: {
                      title: { text: 'Mức Yếu Tố<br>(Coded Level)', font: { size: 10 } },
                      tickvals: [-1, 0, 1],
                      ticktext: ['-1 (Thấp)', '0 (TB)', '+1 (Cao)'],
                      len: 0.75,
                      thickness: 14,
                    },
                    opacity: 0.82,
                    line: { color: '#ffffff', width: 0.8 },
                  },
                },
              ];

              const beeswarmLayout = {
                title: `SHAP Beeswarm Summary Plot - Tác Động Biên Của Yếu Tố Lên ${currentCQA.name}`,
                xaxis: {
                  title: {
                    text: 'Giá Trị SHAP (Shapley Value φ) — Mức độ làm tăng (+) hoặc giảm (-) đáp ứng dự báo',
                    font: { size: 11, color: '#1e293b' },
                    standoff: 10,
                  },
                  zeroline: true,
                  zerolinecolor: '#64748b',
                  zerolinewidth: 2,
                  automargin: true,
                },
                yaxis: {
                  autorange: 'reversed',
                  tickfont: { size: 11 },
                  automargin: true,
                },
                margin: { l: 260, r: 50, t: 55, b: 65, pad: 8 },
              };

              return (
                <div>
                  <PlotlyChart data={beeswarmData} layout={beeswarmLayout} style={{ height: '370px' }} />
                  <div
                    style={{
                      marginTop: '0.5rem',
                      padding: '0.6rem 0.8rem',
                      backgroundColor: '#f1f5f9',
                      borderRadius: '0.375rem',
                      fontSize: '0.74rem',
                      color: '#475569',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: '0.5rem',
                    }}
                  >
                    <span>
                      💡 <strong>Hướng dẫn đọc đồ thị Beeswarm:</strong> Mỗi điểm biểu thị một công thức thực nghiệm. Điểm màu đỏ (mức yếu tố cao) nằm bên phải trục số 0 chứng minh yếu tố đó có tương quan thuận (+), làm tăng chỉ tiêu {currentCQA.name}. Điểm đỏ bên trái biểu thị tương quan nghịch (-).
                    </span>
                    <span className="badge" style={{ backgroundColor: '#7c3aed', color: '#ffffff' }}>
                      Phương pháp: {xaiResult.shap.method === 'exact' ? 'Exact SHAP (2^k tập con)' : 'Permutation SHAP'}
                    </span>
                  </div>
                </div>
              );
            })()}

            {/* View 2: Local SHAP Waterfall */}
            {xaiSubTab === 'waterfall' && (() => {
              const runExps = xaiResult.shap.runExplanations;
              const currentRunExp = runExps.find((r) => r.runOrder === waterfallRunOrder) || runExps[0];
              if (!currentRunExp) return <div>Chưa có dữ liệu run</div>;

              const sortedLocalValues = [...currentRunExp.values].sort((a, b) => Math.abs(b.shapValue) - Math.abs(a.shapValue));
              const labels = ['E[f(X)] Cơ Sở', ...sortedLocalValues.map((v) => `${v.factorCode}: ${v.factorName}`), 'f(x) Dự Báo'];
              const measures = ['absolute', ...sortedLocalValues.map(() => 'relative'), 'total'];
              const values = [currentRunExp.baseValue, ...sortedLocalValues.map((v) => v.shapValue), currentRunExp.prediction];
              const textLabels = [
                currentRunExp.baseValue.toFixed(2),
                ...sortedLocalValues.map((v) => `${v.shapValue > 0 ? '+' : ''}${v.shapValue.toFixed(2)}`),
                currentRunExp.prediction.toFixed(2),
              ];

              const waterfallData = [
                {
                  type: 'waterfall',
                  orientation: 'v',
                  measure: measures,
                  x: labels,
                  y: values,
                  text: textLabels,
                  textposition: 'outside',
                  connector: { line: { color: '#94a3b8', width: 1.5 } },
                  decreasing: { marker: { color: '#ef4444' } },
                  increasing: { marker: { color: '#10b981' } },
                  totals: { marker: { color: '#7c3aed' } },
                },
              ];

              const waterfallLayout = {
                title: `Đồ Thị Waterfall Phân Rã Đóng Góp — Run #${currentRunExp.runOrder} (${currentCQA.name})`,
                xaxis: { tickfont: { size: 10 }, automargin: true },
                yaxis: {
                  title: { text: `Giá trị đáp ứng ${currentCQA.name}${currentCQA.unit ? ` (${currentCQA.unit})` : ''}`, font: { size: 11 } },
                  automargin: true,
                },
                margin: { l: 70, r: 40, t: 55, b: 85, pad: 8 },
              };

              return (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.6rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ fontSize: '0.8rem', fontWeight: '700', color: '#1e293b' }}>Chọn Run Phân Tích:</span>
                      <select
                        value={currentRunExp.runOrder}
                        onChange={(e) => setWaterfallRunOrder(Number(e.target.value))}
                        className="form-select"
                        style={{ fontSize: '0.78rem', padding: '0.25rem 0.6rem', borderRadius: '0.375rem', borderColor: '#cbd5e1' }}
                      >
                        {runExps.map((r) => (
                          <option key={r.runOrder} value={r.runOrder}>
                            Run #{r.runOrder} (Dự báo: {r.prediction.toFixed(2)}{r.actual !== undefined && r.actual !== null ? `, Thực tế: ${r.actual}` : ''})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span className="badge" style={{ backgroundColor: '#f0fdf4', color: '#15803d', border: '1px solid #86efac', fontSize: '0.72rem' }}>
                        ✓ Bảo toàn hiệu suất Shapley: Sai số = {currentRunExp.efficiencyError.toExponential(2)}
                      </span>
                    </div>
                  </div>

                  <PlotlyChart data={waterfallData} layout={waterfallLayout} style={{ height: '370px' }} />

                  <div style={{ marginTop: '0.5rem', padding: '0.5rem 0.8rem', backgroundColor: '#f8fafc', borderRadius: '0.375rem', fontSize: '0.74rem', color: '#64748b' }}>
                    Định lý Lloyd Shapley (1953): Giá trị kỳ vọng nền E[f(X)] = <strong>{currentRunExp.baseValue.toFixed(3)}</strong>. Tổng đóng góp biên của các biến thực nghiệm = <strong>{currentRunExp.sumShap > 0 ? '+' : ''}{currentRunExp.sumShap.toFixed(3)}</strong>, dẫn tới giá trị dự báo cuối cùng f(x) = <strong>{currentRunExp.prediction.toFixed(3)}</strong>.
                  </div>
                </div>
              );
            })()}

            {/* View 3: Multi-Method Comparison (Garson vs Olden vs SHAP) */}
            {xaiSubTab === 'comparison' && (() => {
              const comp = xaiResult.comparisonTable;
              const names = comp.map((c) => {
                const f = project.factors.find((fac) => fac.code === c.factorCode);
                return `${c.factorCode}: ${c.factorName}${f?.unit ? ` [${f.unit}]` : ''}`;
              });

              const garsonX = comp.map((c) => c.garsonImportance);
              const oldenX = comp.map((c) => c.oldenImportance);
              const shapX = comp.map((c) => c.shapImportance);

              const comparisonPlotData = [
                {
                  type: 'bar',
                  orientation: 'h',
                  name: "Garson's Algorithm (%)",
                  y: names,
                  x: garsonX,
                  marker: { color: '#7c3aed' },
                  text: garsonX.map((v) => `${v.toFixed(1)}%`),
                  textposition: 'auto',
                },
                {
                  type: 'bar',
                  orientation: 'h',
                  name: "Olden's Connection (%)",
                  y: names,
                  x: oldenX,
                  marker: { color: '#2563eb' },
                  text: oldenX.map((v) => `${v.toFixed(1)}%`),
                  textposition: 'auto',
                },
                {
                  type: 'bar',
                  orientation: 'h',
                  name: 'Exact SHAP Global (%)',
                  y: names,
                  x: shapX,
                  marker: { color: '#f59e0b' },
                  text: shapX.map((v) => `${v.toFixed(1)}%`),
                  textposition: 'auto',
                },
              ];

              const comparisonPlotLayout = {
                title: `Đối Chiếu 3 Thuật Toán XAI — Garson vs Olden vs SHAP (${currentCQA.name})`,
                barmode: 'group',
                xaxis: {
                  title: { text: 'Tỷ Lệ Đóng Góp Ảnh Hưởng Tương Đối (%)', font: { size: 11 } },
                  automargin: true,
                },
                yaxis: { autorange: 'reversed', tickfont: { size: 11 }, automargin: true },
                legend: { orientation: 'h', y: -0.22, yanchor: 'top', x: 0.5, xanchor: 'center' },
                margin: { l: 260, r: 40, t: 55, b: 70, pad: 8 },
              };

              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <PlotlyChart data={comparisonPlotData} layout={comparisonPlotLayout} style={{ height: '360px' }} />

                  <div className="table-container">
                    <table className="qbd-table">
                      <thead>
                        <tr>
                          <th>Yếu Tố Đầu Vào</th>
                          <th style={{ textAlign: 'center' }}>Garson (Cấu Trúc)</th>
                          <th style={{ textAlign: 'center' }}>Olden (Trọng Số & Chiều)</th>
                          <th style={{ textAlign: 'center' }}>SHAP (Biên & Chiều)</th>
                          <th style={{ textAlign: 'center' }}>Đồng Thuận (Consensus)</th>
                          <th style={{ textAlign: 'center' }}>Mức Rủi Ro ICH Q8</th>
                        </tr>
                      </thead>
                      <tbody>
                        {comp.map((row) => {
                          const badgeBg =
                            row.riskCategory === 'High' ? '#fee2e2' : row.riskCategory === 'Medium' ? '#fef9c3' : '#f0fdf4';
                          const badgeColor =
                            row.riskCategory === 'High' ? '#b91c1c' : row.riskCategory === 'Medium' ? '#854d0e' : '#15803d';

                          return (
                            <tr key={row.factorCode}>
                              <td style={{ fontWeight: '700' }}>
                                {row.factorCode}: {row.factorName}
                              </td>
                              <td style={{ textAlign: 'center' }}>
                                {row.garsonImportance.toFixed(1)}% <span style={{ color: '#64748b', fontSize: '0.72rem' }}>(#{row.garsonRank})</span>
                              </td>
                              <td style={{ textAlign: 'center' }}>
                                {row.oldenImportance.toFixed(1)}% {row.oldenDirection === 'positive' ? '▲ (+)' : row.oldenDirection === 'negative' ? '▼ (-)' : '—'}{' '}
                                <span style={{ color: '#64748b', fontSize: '0.72rem' }}>(#{row.oldenRank})</span>
                              </td>
                              <td style={{ textAlign: 'center', fontWeight: '700', color: '#7c3aed' }}>
                                {row.shapImportance.toFixed(1)}% {row.shapDirection === 'positive' ? '▲ (+)' : row.shapDirection === 'negative' ? '▼ (-)' : '—'}{' '}
                                <span style={{ color: '#64748b', fontSize: '0.72rem' }}>(#{row.shapRank})</span>
                              </td>
                              <td style={{ textAlign: 'center', fontWeight: '800' }}>
                                #{row.consensusRank} ({row.consensusImportance.toFixed(1)}%)
                              </td>
                              <td style={{ textAlign: 'center' }}>
                                <span className="badge" style={{ backgroundColor: badgeBg, color: badgeColor, fontSize: '0.72rem', fontWeight: '700' }}>
                                  {row.riskCategory === 'High' ? '🔴 Cao (Critical)' : row.riskCategory === 'Medium' ? '🟡 Trung Bình' : '🟢 Thấp'}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })()}

            {/* View 4: CQA vs CPP Impact Matrix */}
            {xaiSubTab === 'matrix' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div style={{ fontSize: '0.8rem', color: '#475569' }}>
                  Ma trận đánh giá tổng hợp mức độ ảnh hưởng của các Thông Số Quy Trình (CPP/KPP) lên tất cả các Chỉ Tiêu Chất Lượng (CQA) theo hướng dẫn ICH Q8(R2):
                </div>

                <div className="table-container">
                  <table className="qbd-table">
                    <thead>
                      <tr>
                        <th>Thông Số Quy Trình (Factor)</th>
                        {project.cqas.map((c) => (
                          <th key={c.code} style={{ textAlign: 'center' }}>
                            {c.code}: {c.name}
                          </th>
                        ))}
                        <th style={{ textAlign: 'center' }}>Ảnh Hưởng Lớn Nhất</th>
                        <th style={{ textAlign: 'center' }}>Phân Loại ICH Q8</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cqaImpactMatrix.map((item) => {
                        const critBadge =
                          item.criticality === 'Critical'
                            ? { text: '🔴 CPP (Critical)', bg: '#fee2e2', color: '#b91c1c' }
                            : item.criticality === 'Key'
                            ? { text: '🟡 KPP (Key)', bg: '#fef9c3', color: '#854d0e' }
                            : { text: '🟢 Non-Critical', bg: '#f0fdf4', color: '#15803d' };

                        return (
                          <tr key={item.factorCode}>
                            <td style={{ fontWeight: '700', color: '#1e293b' }}>
                              {item.factorCode}: {item.factorName}
                            </td>
                            {project.cqas.map((c) => {
                              const imp = item.cqaImpacts[c.code];
                              if (!imp) return <td key={c.code} style={{ textAlign: 'center', color: '#94a3b8' }}>-</td>;
                              const dirIcon = imp.direction === 'positive' ? '▲' : imp.direction === 'negative' ? '▼' : '●';
                              const color = imp.riskCategory === 'High' ? '#b91c1c' : imp.riskCategory === 'Medium' ? '#d97706' : '#15803d';

                              return (
                                <td key={c.code} style={{ textAlign: 'center', color, fontWeight: imp.riskCategory === 'High' ? '700' : '500' }}>
                                  {dirIcon} {imp.importance.toFixed(1)}%
                                </td>
                              );
                            })}
                            <td style={{ textAlign: 'center', fontWeight: '800' }}>
                              {item.overallMaxImpact.toFixed(1)}%
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              <span className="badge" style={{ backgroundColor: critBadge.bg, color: critBadge.color, fontSize: '0.72rem', fontWeight: '700' }}>
                                {critBadge.text}
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
          </div>
        );
      }
    }
  };

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      
      {/* Top Header Card with Neural Platform Branding */}
      <div className="qbd-card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <BrainCircuit size={24} color="#7c3aed" />
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <h2 style={{ fontSize: '1.2rem', fontWeight: '800', color: '#0f172a', margin: 0 }}>
                    Phân Tích Dữ Liệu Thực Nghiệm Bằng Mạng Nơ-ron (Neural Network Platform)
                  </h2>
                  {modelingEngine === 'neural' && (
                    <span className="badge" style={{ backgroundColor: '#7c3aed', color: '#ffffff', fontSize: '0.72rem' }}>
                      ✓ Đang Chọn Làm Mô Hình Chính (Bước 6, 7, 8)
                    </span>
                  )}
                </div>
                <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '0.2rem' }}>
                  Mô phỏng phi tuyến tính cao cấp • Multi-Layer Perceptron (MLP) • Khảo sát mô hình phi tuyến &amp; XAI Studio.
                </div>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            {/* CQA Selector */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <label style={{ fontSize: '0.8rem', fontWeight: '600', color: '#475569' }}>Đáp ứng CQA:</label>
              <select
                className="input-field"
                style={{ width: '180px', fontWeight: '600', color: '#7c3aed' }}
                value={selectedCQA}
                onChange={(e) => onSelectCQA(e.target.value)}
              >
                {project.cqas.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code}: {c.name}
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={() => {
                onSelectEngine?.('neural');
                onNavigateToRSM();
              }}
              className="btn btn-primary"
              style={{ fontSize: '0.82rem', padding: '0.4rem 0.95rem', backgroundColor: '#7c3aed', borderColor: '#7c3aed', fontWeight: '700' }}
              title="Khóa mô hình Mạng Nơ-ron AI và chuyển tuần tự sang Bước 6: Mặt đáp"
            >
              <span>Tiếp Tục Với Mạng Nơ-ron (Bước 6: Mặt Đáp)</span>
              <ArrowRight size={16} />
            </button>

            <button
              onClick={() => {
                onSelectEngine?.('neural');
                onNavigateToDesignSpace();
              }}
              className="btn btn-secondary"
              style={{ fontSize: '0.78rem', padding: '0.35rem 0.75rem', color: '#6d28d9', borderColor: '#e9d5ff', fontWeight: '500' }}
              title="Bỏ qua khảo sát mặt đáp để sang thẳng Bước 7: Không gian thiết kế & Tối ưu hóa Desirability"
            >
              <span>Bỏ qua mặt đáp, sang thẳng Bước 7</span>
              <ArrowRight size={14} />
            </button>
          </div>
        </div>

        {/* 1. Architecture Mode Selector (1 Shared Network vs Independent Per-CQA Networks) */}
        <div style={{ marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: '0.82rem', fontWeight: '700', color: '#1e293b', marginBottom: '0.6rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <Layers size={16} color="#7c3aed" />
            <span>LỰA CHỌN CHẾ ĐỘ CẤU HÌNH & HUẤN LUYỆN KIẾN TRÚC MẠNG NƠ-RON:</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '0.85rem' }}>
            {/* Option A: Shared Multi-Output Network */}
            <div
              onClick={() => onSetNeuralTrainingMode?.('shared')}
              style={{
                padding: '0.85rem 1rem',
                borderRadius: '0.5rem',
                border: neuralTrainingMode === 'shared' ? '2px solid #7c3aed' : '1px solid #cbd5e1',
                backgroundColor: neuralTrainingMode === 'shared' ? '#f5f3ff' : '#ffffff',
                cursor: 'pointer',
                transition: 'all 0.15s ease-in-out',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.75rem',
              }}
            >
              <div
                style={{
                  width: '20px',
                  height: '20px',
                  borderRadius: '50%',
                  border: neuralTrainingMode === 'shared' ? '6px solid #7c3aed' : '2px solid #94a3b8',
                  marginTop: '0.15rem',
                  flexShrink: 0,
                  backgroundColor: '#ffffff',
                }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: '700', fontSize: '0.9rem', color: neuralTrainingMode === 'shared' ? '#6d28d9' : '#1e293b' }}>
                  <Network size={16} color={neuralTrainingMode === 'shared' ? '#7c3aed' : '#64748b'} />
                  <span>1 Mạng Nơ-ron Hợp Nhất (Multi-Output MLP)</span>
                </div>
                <div style={{ fontSize: '0.76rem', color: '#64748b', marginTop: '0.25rem', lineHeight: '1.4' }}>
                  Fit đồng thời toàn bộ <strong>{project.cqas.length} biến Y</strong> trong 1 mạng duy nhất. Học chung các biểu diễn ẩn và bắt trọn tương quan chéo giữa các chỉ tiêu chất lượng.
                </div>
              </div>
            </div>

            {/* Option B: Independent Per-CQA Networks */}
            <div
              onClick={() => onSetNeuralTrainingMode?.('independent')}
              style={{
                padding: '0.85rem 1rem',
                borderRadius: '0.5rem',
                border: neuralTrainingMode === 'independent' ? '2px solid #7c3aed' : '1px solid #cbd5e1',
                backgroundColor: neuralTrainingMode === 'independent' ? '#f5f3ff' : '#ffffff',
                cursor: 'pointer',
                transition: 'all 0.15s ease-in-out',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.75rem',
              }}
            >
              <div
                style={{
                  width: '20px',
                  height: '20px',
                  borderRadius: '50%',
                  border: neuralTrainingMode === 'independent' ? '6px solid #7c3aed' : '2px solid #94a3b8',
                  marginTop: '0.15rem',
                  flexShrink: 0,
                  backgroundColor: '#ffffff',
                }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: '700', fontSize: '0.9rem', color: neuralTrainingMode === 'independent' ? '#6d28d9' : '#1e293b' }}>
                  <Target size={16} color={neuralTrainingMode === 'independent' ? '#7c3aed' : '#64748b'} />
                  <span>Mạng Nơ-ron Độc Lập Cho Từng Biến Y</span>
                </div>
                <div style={{ fontSize: '0.76rem', color: '#64748b', marginTop: '0.25rem', lineHeight: '1.4' }}>
                  Mỗi biến Y ({project.cqas.map((c) => c.code).join(', ')}) có 1 mạng nơ-ron riêng. Cho phép tùy chỉnh số neuron, hàm kích hoạt và tốc độ học khác nhau cho từng biến.
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 2. Hyperparameter Settings (Phần Cài Đặt Mạng Nơ-ron) */}
        <div
          style={{
            marginTop: '1rem',
            padding: '1rem 1.1rem',
            backgroundColor: '#ffffff',
            borderRadius: '0.5rem',
            border: '1px solid #cbd5e1',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.82rem', fontWeight: '700', color: '#1e293b' }}>
              <Sliders size={16} color="#7c3aed" />
              <span>CÀI ĐẶT THAM SỐ HUẤN LUYỆN (HYPERPARAMETERS):</span>
            </div>
            <button
              onClick={() => setLocalConfig(DEFAULT_NEURAL_CONFIG)}
              className="btn btn-secondary"
              style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem', gap: '0.25rem' }}
              title="Khôi phục cấu hình về mặc định"
            >
              <RotateCcw size={12} />
              <span>Mặc Định</span>
            </button>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
              gap: '0.75rem',
              alignItems: 'end',
            }}
          >
            <div>
              <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: '700', color: '#475569', marginBottom: '0.25rem' }}>
                NÚT ẨN LỚP 1 (H1)
              </label>
              <input
                type="number"
                min={1}
                max={15}
                className="input-field"
                value={localConfig.hiddenNodes1}
                onChange={(e) => setLocalConfig({ ...localConfig, hiddenNodes1: Math.max(1, Number(e.target.value)) })}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: '700', color: '#475569', marginBottom: '0.25rem' }}>
                NÚT ẨN LỚP 2 (H2)
              </label>
              <input
                type="number"
                min={0}
                max={10}
                className="input-field"
                value={localConfig.hiddenNodes2}
                onChange={(e) => setLocalConfig({ ...localConfig, hiddenNodes2: Math.max(0, Number(e.target.value)) })}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: '700', color: '#475569', marginBottom: '0.25rem' }}>
                HÀM KÍCH HOẠT
              </label>
              <select
                className="input-field"
                value={localConfig.activation}
                onChange={(e) => setLocalConfig({ ...localConfig, activation: e.target.value as NeuralActivation })}
              >
                <option value="tanh">TanH (Chuẩn)</option>
                <option value="gaussian">Gaussian (RBF)</option>
                <option value="linear">Linear</option>
                <option value="sigmoid">Sigmoid</option>
                <option value="relu">ReLU</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: '700', color: '#475569', marginBottom: '0.25rem' }}>
                PHẠT WEIGHT DECAY (λ)
              </label>
              <select
                className="input-field"
                value={localConfig.weightDecay}
                onChange={(e) => setLocalConfig({ ...localConfig, weightDecay: Number(e.target.value) })}
              >
                <option value={0.0}>0.0 (Không phạt)</option>
                <option value={0.001}>0.001 (Nhẹ)</option>
                <option value={0.01}>0.01 (Vừa)</option>
                <option value={0.05}>0.05 (Chống Overfit)</option>
                <option value={0.1}>0.1 (Cao)</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: '700', color: '#475569', marginBottom: '0.25rem' }}>
                SỐ VÒNG TOUR (RESTARTS)
              </label>
              <input
                type="number"
                min="1"
                max="50"
                className="input-field"
                value={localConfig.numTours}
                onChange={(e) => setLocalConfig({ ...localConfig, numTours: Math.max(1, parseInt(e.target.value) || 10) })}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: '700', color: '#475569', marginBottom: '0.25rem' }}>
                SỐ VÒNG LẶP EPOCHS
              </label>
              <input
                type="number"
                min="50"
                max="2000"
                step="50"
                className="input-field"
                value={localConfig.maxEpochs}
                onChange={(e) => setLocalConfig({ ...localConfig, maxEpochs: Math.max(50, parseInt(e.target.value) || 500) })}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: '700', color: '#475569', marginBottom: '0.25rem' }}>
                PHƯƠNG PHÁP VALIDATION
              </label>
              <select
                className="input-field"
                value={localConfig.validationMethod}
                onChange={(e) => setLocalConfig({ ...localConfig, validationMethod: e.target.value as NeuralNetConfig['validationMethod'] })}
              >
                <option value="kfold">K-fold cross validation</option>
                <option value="holdout">Hold-out</option>
                <option value="none">Không chia validation</option>
              </select>
            </div>

            {localConfig.validationMethod === 'kfold' && (
              <div>
                <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: '700', color: '#475569', marginBottom: '0.25rem' }}>
                  SỐ NHÓM K-FOLD
                </label>
                <input
                  type="number"
                  min={2}
                  max={Math.max(2, Math.min(10, numSamples))}
                  className="input-field"
                  value={localConfig.kFolds}
                  onChange={(e) => setLocalConfig({ ...localConfig, kFolds: Math.max(2, Math.min(Math.max(2, Math.min(10, numSamples)), parseInt(e.target.value) || 5)) })}
                />
              </div>
            )}

            {localConfig.validationMethod === 'holdout' && (
              <div>
                <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: '700', color: '#475569', marginBottom: '0.25rem' }}>
                  TỶ LỆ VALIDATION
                </label>
                <input
                  type="number"
                  min={0.1}
                  max={0.4}
                  step={0.05}
                  className="input-field"
                  value={localConfig.holdoutRatio}
                  onChange={(e) => setLocalConfig({ ...localConfig, holdoutRatio: Math.max(0.1, Math.min(0.4, Number(e.target.value) || 0.25)) })}
                />
              </div>
            )}

            {localConfig.validationMethod !== 'none' && (
              <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.75rem', fontWeight: '700', color: '#475569', marginTop: '0.6rem' }}>
                  <input
                    type="checkbox"
                    checked={Boolean(localConfig.earlyStopping)}
                    onChange={(e) => setLocalConfig({ ...localConfig, earlyStopping: e.target.checked, patience: localConfig.patience ?? 40 })}
                    style={{ cursor: 'pointer' }}
                  />
                  <span>Dừng sớm (Early Stopping)</span>
                </label>
                <span style={{ fontSize: '0.68rem', color: '#64748b', marginLeft: '1.2rem' }}>
                  Tránh overfit (patience = {localConfig.patience ?? 40})
                </span>
              </div>
            )}
          </div>
        </div>

        {/* 3. Topology Visualizer, Parameter Counter & Overfitting Risk Evaluator (Hiển Thị Kiến Trúc & Cảnh Báo) */}
        <div
          style={{
            marginTop: '1rem',
            padding: '0.9rem 1.1rem',
            backgroundColor: '#f8fafc',
            borderRadius: '0.5rem',
            border: '1px solid #e2e8f0',
          }}
        >
          {/* Topology diagram */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Cpu size={18} color="#7c3aed" />
              <span style={{ fontSize: '0.82rem', fontWeight: '700', color: '#0f172a' }}>
                KIẾN TRÚC MẠNG HIỆN TẠI:
              </span>
              <span className="font-mono" style={{ fontSize: '0.82rem', fontWeight: '700', color: '#7c3aed', backgroundColor: '#ede9fe', padding: '0.15rem 0.5rem', borderRadius: '4px' }}>
                [{numInputs} Inputs] ➔ [H1: {localConfig.hiddenNodes1}] {localConfig.hiddenNodes2 > 0 ? `➔ [H2: ${localConfig.hiddenNodes2}] ` : ''}➔ [{numOutputs} Output{numOutputs > 1 ? 's' : ''}] ({localConfig.activation.toUpperCase()})
              </span>
            </div>

            <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
              {neuralTrainingMode === 'shared' ? (
                <span className="badge" style={{ backgroundColor: '#0284c7', color: '#ffffff' }}>🌐 Chế độ Hợp Nhất (Fit All Y)</span>
              ) : (
                <span className="badge" style={{ backgroundColor: '#0f766e', color: '#ffffff' }}>🎯 Chế độ Độc Lập ({currentCQA.code}: {currentCQA.name})</span>
              )}
            </div>
          </div>

          {/* Parameter Metrics Chips Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.6rem', marginBottom: '0.75rem' }}>
            <div style={{ backgroundColor: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '0.375rem', padding: '0.5rem 0.75rem' }}>
              <div style={{ fontSize: '0.68rem', fontWeight: '700', color: '#64748b' }}>BIẾN ĐẦU VÀO (dX)</div>
              <div style={{ fontSize: '1.1rem', fontWeight: '800', color: '#0f172a' }}>{archMetrics.numInputs} yếu tố</div>
            </div>

            <div style={{ backgroundColor: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '0.375rem', padding: '0.5rem 0.75rem' }}>
              <div style={{ fontSize: '0.68rem', fontWeight: '700', color: '#64748b' }}>TỔNG THAM SỐ (P)</div>
              <div style={{ fontSize: '1.1rem', fontWeight: '800', color: '#7c3aed' }}>
                {archMetrics.totalParameters} <span style={{ fontSize: '0.7rem', fontWeight: '500', color: '#64748b' }}>(Weights + Biases)</span>
              </div>
            </div>

            <div style={{ backgroundColor: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '0.375rem', padding: '0.5rem 0.75rem' }}>
              <div style={{ fontSize: '0.68rem', fontWeight: '700', color: '#64748b' }}>SỐ THÍ NGHIỆM (N)</div>
              <div style={{ fontSize: '1.1rem', fontWeight: '800', color: '#0284c7' }}>{archMetrics.numSamples} runs</div>
            </div>

            <div
              style={{
                backgroundColor: archMetrics.overfittingRisk === 'safe' ? '#f0fdf4' : archMetrics.overfittingRisk === 'warning' ? '#fefce8' : '#fef2f2',
                border: `1px solid ${archMetrics.overfittingRisk === 'safe' ? '#86efac' : archMetrics.overfittingRisk === 'warning' ? '#fde047' : '#fca5a5'}`,
                borderRadius: '0.375rem',
                padding: '0.5rem 0.75rem',
              }}
            >
              <div style={{ fontSize: '0.68rem', fontWeight: '700', color: archMetrics.overfittingRisk === 'safe' ? '#15803d' : archMetrics.overfittingRisk === 'warning' ? '#a16207' : '#b91c1c' }}>
                TỶ LỆ MẪU / THAM SỐ (N/P)
              </div>
              <div style={{ fontSize: '1.1rem', fontWeight: '800', color: archMetrics.overfittingRisk === 'safe' ? '#16a34a' : archMetrics.overfittingRisk === 'warning' ? '#ca8a04' : '#dc2626' }}>
                {archMetrics.sampleToParamRatio}x
              </div>
            </div>
          </div>

          {/* Overfitting Warning / Safety Alert Banner */}
          <div
            style={{
              padding: '0.65rem 0.85rem',
              borderRadius: '0.375rem',
              fontSize: '0.78rem',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '0.5rem',
              backgroundColor: archMetrics.overfittingRisk === 'safe' ? '#f0fdf4' : archMetrics.overfittingRisk === 'warning' ? '#fffbeb' : '#fef2f2',
              border: `1px solid ${archMetrics.overfittingRisk === 'safe' ? '#bbf7d0' : archMetrics.overfittingRisk === 'warning' ? '#fde68a' : '#fecaca'}`,
              color: archMetrics.overfittingRisk === 'safe' ? '#166534' : archMetrics.overfittingRisk === 'warning' ? '#92400e' : '#991b1b',
            }}
          >
            {archMetrics.overfittingRisk === 'safe' && <CheckCircle2 size={18} color="#16a34a" style={{ flexShrink: 0, marginTop: '0.05rem' }} />}
            {archMetrics.overfittingRisk === 'warning' && <AlertTriangle size={18} color="#d97706" style={{ flexShrink: 0, marginTop: '0.05rem' }} />}
            {archMetrics.overfittingRisk === 'danger' && <AlertOctagon size={18} color="#dc2626" style={{ flexShrink: 0, marginTop: '0.05rem' }} />}
            <div style={{ lineHeight: '1.45' }}>
              <strong>
                {archMetrics.overfittingRisk === 'safe' && '🟢 TRẠNG THÁI TỐI ƯU (SAFE): '}
                {archMetrics.overfittingRisk === 'warning' && '🟡 CẢNH BÁO QUÁ KHỚP VỪA PHẢI (MODERATE OVERFITTING RISK): '}
                {archMetrics.overfittingRisk === 'danger' && '🔴 BÁO ĐỘNG QUÁ KHỚP (HIGH OVERFITTING ALERT - P > N): '}
              </strong>
              <span>{archMetrics.recommendation}</span>
            </div>
          </div>

          {/* Carpenter Architecture Advisor Badge & Quick Apply (Slide 31-32) */}
          {archMetrics.carpenterRecommended !== undefined && (
            <div
              style={{
                marginTop: '0.65rem',
                padding: '0.65rem 0.85rem',
                borderRadius: '0.375rem',
                backgroundColor: '#eff6ff',
                border: '1px solid #bfdbfe',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.4rem',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: '0.65rem',
                  width: '100%',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.78rem', color: '#1e40af', flex: '1 1 auto', minWidth: '260px' }}>
                  <Sparkles size={16} color="#2563eb" style={{ flexShrink: 0 }} />
                  <span>
                    <strong>Gợi ý ngân sách tham số:</strong> Số nơ-ron lớp ẩn khởi đầu là <strong>h = {archMetrics.carpenterRecommended}</strong> (dùng N huấn luyện = {archMetrics.numSamples}; đã trừ {numSamples - archMetrics.numSamples} run validation).
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap', flexShrink: 0, marginLeft: 'auto' }}>
                  <button
                    type="button"
                    onClick={() => {
                      setLocalConfig((prev) => ({
                        ...prev,
                        hiddenNodes1: archMetrics.carpenterRecommended || 3,
                        hiddenNodes2: 0,
                      }));
                      const target = neuralTrainingMode === 'shared'
                        ? `mạng chung cho tất cả ${project.cqas.length} CQA`
                        : `CQA ${currentCQA.code} (${currentCQA.name})`;
                      setConfigActionNotice(`Đã áp dụng kiến trúc theo ngân sách tham số: ${archMetrics.carpenterRecommended} nơ-ron ở Tầng 1, tắt Tầng 2 cho ${target}.`);
                    }}
                    className="btn btn-outline"
                    style={{
                      fontSize: '0.75rem',
                      padding: '0.25rem 0.6rem',
                      backgroundColor: '#ffffff',
                      borderColor: '#2563eb',
                      color: '#2563eb',
                      fontWeight: '700',
                    }}
                    title="Tự động đặt số nơ-ron ẩn Tầng 1 = h theo ngân sách tham số và tắt Tầng 2"
                  >
                    💡 Áp Dụng Gợi Ý Kiến Trúc (h = {archMetrics.carpenterRecommended})
                  </button>
                  {neuralTrainingMode === 'independent' && (
                    <button
                      onClick={handleCopyConfig}
                      disabled={isTraining}
                      className="btn btn-outline"
                      style={{
                        fontSize: '0.75rem',
                        padding: '0.25rem 0.6rem',
                        backgroundColor: '#ffffff',
                        borderColor: '#64748b',
                        color: '#334155',
                        fontWeight: '700',
                      }}
                      title="Sao chép cấu hình hiện tại sang toàn bộ các CQA khác"
                    >
                      <Share2 size={15} />
                      <span>Áp Dụng Cho Tất Cả CQA</span>
                    </button>
                  )}
                </div>
              </div>

              {configActionNotice && (
                <div
                  role="status"
                  className="animate-fade-in"
                  style={{
                    padding: '0.35rem 0.6rem',
                    borderRadius: '0.35rem',
                    backgroundColor: '#f0fdf4',
                    border: '1px solid #86efac',
                    color: '#15803d',
                    fontSize: '0.72rem',
                    fontWeight: '600',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '0.5rem',
                    width: '100%',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', minWidth: 0 }}>
                    <CheckCircle2 size={14} style={{ flexShrink: 0 }} />
                    <span style={{ wordBreak: 'break-word' }}>{configActionNotice}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setConfigActionNotice(null)}
                    aria-label="Đóng thông báo"
                    style={{
                      color: '#15803d',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      padding: '0 0.2rem',
                      fontSize: '0.8rem',
                      lineHeight: 1,
                      flexShrink: 0,
                    }}
                  >
                    ✕
                  </button>
                </div>
              )}
            </div>
          )}

          {new Set(project.runs.map((run) => Math.max(1, Math.floor(run.block ?? 1)))).size > 1 && (
            <div style={{ marginTop: '0.65rem', padding: '0.6rem 0.8rem', borderRadius: '0.45rem', background: '#f0fdfa', border: '1px solid #99f6e4', color: '#115e59', fontSize: '0.76rem' }}>
              Mô hình đã thêm biến giả cho block khi huấn luyện và đánh giá phần dư. Block không được xem là biến vận hành; đồ thị và tối ưu hóa dùng Block 1 làm mốc tham chiếu.
            </div>
          )}

          {/* SVG Neural Network Topology Diagram (Lớp vào, Lớp ẩn 1, Lớp ẩn 2, Lớp ra Hợp nhất / Độc lập) */}
          <div style={{ marginTop: '0.85rem' }}>
            <NeuralNetworkTopologyDiagram
              factors={project.factors}
              cqas={project.cqas}
              selectedCQA={selectedCQA}
              config={localConfig}
              trainingMode={neuralTrainingMode}
              archMetrics={archMetrics}
              isTraining={isTraining}
              trainingProgress={trainingProgress}
            />
          </div>
        </div>


        {/* 4. Action Buttons Toolbar (Các Nút Fit, Áp Dụng...) */}
        <div
          style={{
            marginTop: '1rem',
            padding: '0.85rem 1rem',
            backgroundColor: '#ffffff',
            borderRadius: '0.5rem',
            border: '1px solid #cbd5e1',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '0.75rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', flex: 1 }}>
            <button
              onClick={handleTrain}
              disabled={isTraining}
              className="btn btn-primary"
              style={{
                backgroundColor: isTraining ? '#9333ea' : '#7c3aed',
                borderColor: '#7c3aed',
                fontSize: '0.85rem',
                padding: '0.5rem 1.3rem',
                cursor: isTraining ? 'wait' : 'pointer',
                fontWeight: '700',
                boxShadow: '0 2px 8px rgba(124, 58, 237, 0.25)',
              }}
            >
              {isTraining ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  <span>Đang Huấn Luyện ({trainingProgress ? `Tour ${trainingProgress.tour}/${trainingProgress.totalTours}` : '...'})</span>
                </>
              ) : (
                <>
                  <RefreshCw size={16} />
                  <span>{neuralTrainingMode === 'shared' ? '⚡ Huấn Luyện Mạng Chung (All Y)' : `⚡ Huấn Luyện ${currentCQA.code}`}</span>
                </>
              )}
            </button>

            {neuralTrainingMode === 'independent' && (
              <>
                <button
                  onClick={handleTrainAllIndependent}
                  disabled={isTraining}
                  className="btn btn-outline"
                  style={{
                    fontSize: '0.82rem',
                    padding: '0.5rem 1rem',
                    borderColor: '#7c3aed',
                    color: '#7c3aed',
                    fontWeight: '600',
                  }}
                  title="Huấn luyện đồng loạt tất cả các CQA với cấu hình độc lập của từng CQA"
                >
                  <Zap size={15} />
                  <span>Huấn luyện tất cả CQAs</span>
                </button>
              </>
            )}
          </div>

          <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
            {neuralTrainingMode === 'shared'
              ? `* Kiến trúc chung áp dụng cho tất cả ${project.cqas.length} biến Y.`
              : `* Cấu hình đang chọn riêng cho chỉ tiêu ${currentCQA.code} (${currentCQA.name}).`}
          </div>
        </div>
      </div>

      {/* Live Training Progress Indicator */}
      {isTraining && trainingProgress && (
        <div
          className="qbd-card animate-fade-in"
          style={{
            backgroundColor: '#0f172a',
            color: '#f8fafc',
            border: '1px solid #334155',
            padding: '1.25rem',
            boxShadow: '0 8px 24px rgba(15, 23, 42, 0.45)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.85rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <Cpu size={24} className="animate-spin" color="#38bdf8" />
              <div>
                <div style={{ fontWeight: '800', fontSize: '0.98rem', color: '#38bdf8', letterSpacing: '0.02em', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <span>ĐANG HUẤN LUYỆN MẠNG NƠ-RON (RUNNING...)</span>
                  <span className="badge badge-primary" style={{ backgroundColor: '#0284c7', color: '#ffffff', fontSize: '0.7rem' }}>
                    Mô Hình Nơ-ron AI
                  </span>
                </div>
                <div style={{ fontSize: '0.76rem', color: '#94a3b8', marginTop: '0.15rem' }}>
                  Chỉ tiêu: <strong style={{ color: '#ffffff' }}>{currentCQA.name} ({currentCQA.code})</strong> • Thuật toán: <span style={{ color: '#c084fc' }}>Multi-Tour SGD Optimizer</span>
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span className="badge" style={{ backgroundColor: '#1e293b', color: '#38bdf8', border: '1px solid #0284c7', fontSize: '0.75rem' }}>
                Tour #{trainingProgress.tour} / {trainingProgress.totalTours}
              </span>
              <span className="badge" style={{ backgroundColor: '#1e293b', color: '#4ade80', border: '1px solid #16a34a', fontSize: '0.75rem' }}>
                Epoch {trainingProgress.epoch} / {trainingProgress.maxEpochs}
              </span>
            </div>
          </div>

          {/* Animated Progress Bar */}
          <div style={{ width: '100%', height: '10px', backgroundColor: '#1e293b', borderRadius: '5px', overflow: 'hidden', marginBottom: '1rem', border: '1px solid #334155' }}>
            <div
              className="hud-shimmer-bar"
              style={{
                width: `${(trainingProgress.tour / trainingProgress.totalTours) * 100}%`,
                height: '100%',
                transition: 'width 0.2s ease-in-out',
                boxShadow: '0 0 12px rgba(168, 85, 247, 0.9)',
                borderRadius: '5px',
              }}
            />
          </div>

          {/* Live Metrics Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem' }}>
            <div style={{ backgroundColor: '#1e293b', borderRadius: '0.375rem', padding: '0.5rem 0.75rem', border: '1px solid #334155' }}>
              <div style={{ fontSize: '0.68rem', color: '#94a3b8', fontWeight: '700' }}>KIẾN TRÚC LỚP ẨN</div>
              <div style={{ fontSize: '0.9rem', fontWeight: '800', color: '#f8fafc' }}>
                [{localConfig.hiddenNodes1}{localConfig.hiddenNodes2 > 0 ? `, ${localConfig.hiddenNodes2}` : ''}] {localConfig.activation.toUpperCase()}
              </div>
            </div>

            <div style={{ backgroundColor: '#1e293b', borderRadius: '0.375rem', padding: '0.5rem 0.75rem', border: '1px solid #334155' }}>
              <div style={{ fontSize: '0.68rem', color: '#94a3b8', fontWeight: '700' }}>HÀM MẤT MÁT (MSE LOSS)</div>
              <div className="font-mono" style={{ fontSize: '0.9rem', fontWeight: '800', color: '#f43f5e' }}>
                {trainingProgress.loss === undefined ? 'Sẽ hiển thị sau khi fit' : trainingProgress.loss.toFixed(5)}
              </div>
            </div>

            <div style={{ backgroundColor: '#1e293b', borderRadius: '0.375rem', padding: '0.5rem 0.75rem', border: '1px solid #334155' }}>
              <div style={{ fontSize: '0.68rem', color: '#94a3b8', fontWeight: '700' }}>BEST TRAIN R²</div>
              <div className="font-mono" style={{ fontSize: '0.9rem', fontWeight: '800', color: '#38bdf8' }}>
                {trainingProgress.bestR2 === undefined ? 'Sẽ hiển thị sau khi fit' : trainingProgress.bestR2.toFixed(4)}
              </div>
            </div>

            <div style={{ backgroundColor: '#1e293b', borderRadius: '0.375rem', padding: '0.5rem 0.75rem', border: '1px solid #334155' }}>
              <div style={{ fontSize: '0.68rem', color: '#94a3b8', fontWeight: '700' }}>TRẠNG THÁI HỘI TỤ</div>
              <div style={{ fontSize: '0.8rem', fontWeight: '600', color: '#4ade80', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <span className="animate-pulse">●</span> Đang hội tụ
              </div>
            </div>
          </div>

          {/* Phase Info */}
          <div style={{ marginTop: '0.75rem', fontSize: '0.78rem', color: '#cbd5e1', fontStyle: 'italic', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span style={{ color: '#38bdf8' }}>▶</span> {trainingProgress.phase}
          </div>
        </div>
      )}

      {/* Success Notice Banner */}
      {lastTrainedNotice && !isTraining && (
        <div
          className="qbd-card animate-fade-in"
          style={{
            backgroundColor: '#f0fdf4',
            border: '1px solid #86efac',
            padding: '0.75rem 1rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            color: '#15803d',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: '700', fontSize: '0.85rem' }}>
            <CheckCircle2 size={18} color="#16a34a" />
            <span>{lastTrainedNotice}</span>
          </div>
          <button
            onClick={() => setLastTrainedNotice(null)}
            style={{ fontSize: '0.75rem', color: '#15803d', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            ✕ Đóng
          </button>
        </div>
      )}

      {!neuralModel ? (
        <div className="qbd-card" style={{ textAlign: 'center', padding: '3rem', color: '#64748b' }}>
          <BrainCircuit size={44} color="#7c3aed" style={{ margin: '0 auto 0.75rem' }} />
          <p style={{ fontWeight: '700', fontSize: '1rem', color: '#0f172a' }}>
            Chưa có mô hình mạng nơ-ron cho chỉ tiêu {currentCQA.name}
          </p>
          <p style={{ fontSize: '0.82rem', marginTop: '0.35rem' }}>
            Bấm nút "Huấn Luyện (Fit)" ở trên để tự động chạy thuật toán học máy đa vòng lặp.
          </p>
        </div>
      ) : (
        <>
          {/* Neural Fit Summary Gauges */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '0.85rem' }}>
            
            {/* Training R-Squared */}
            <div className="qbd-card" style={{ padding: '0.85rem', borderLeft: '4px solid #1e3a8a' }}>
              <div style={{ fontSize: '0.7rem', fontWeight: '700', color: '#64748b' }}>TRAIN R² (HUẤN LUYỆN)</div>
              <div style={{ fontSize: '1.45rem', fontWeight: '800', color: '#1e3a8a', margin: '0.15rem 0' }}>
                {neuralModel.diagnostics.rSquaredTrain.toFixed(4)}
              </div>
              <div style={{ fontSize: '0.7rem', color: '#64748b' }}>
                RMSE = {neuralModel.diagnostics.rmseTrain.toFixed(3)}
              </div>
            </div>

            {/* Validation R²; it is not comparable to OLS PRESS Q². */}
            <div className="qbd-card" style={{ padding: '0.85rem', borderLeft: '4px solid #dc2626' }}>
              <div style={{ fontSize: '0.7rem', fontWeight: '700', color: '#64748b' }}>
                VALIDATION R² ({neuralModel.config.validationMethod === 'kfold' ? `${neuralModel.config.kFolds}-FOLD` : neuralModel.config.validationMethod === 'holdout' ? 'HOLD-OUT' : 'TRAINING'})
              </div>
              <div style={{ fontSize: '1.45rem', fontWeight: '800', color: '#dc2626', margin: '0.15rem 0' }}>
                {neuralModel.diagnostics.rSquaredVal.toFixed(4)}
              </div>
              <div style={{ fontSize: '0.7rem', color: neuralModel.diagnostics.rSquaredVal > 0.7 ? '#15803d' : '#64748b' }}>
                {neuralModel.diagnostics.rSquaredVal > 0.7 ? '✓ Validation tốt (> 0.7)' : `RMSE validation = ${neuralModel.diagnostics.rmseVal.toFixed(3)}`}
              </div>
            </div>

            {/* Overall R-Squared */}
            <div className="qbd-card" style={{ padding: '0.85rem', borderLeft: '4px solid #7c3aed' }}>
              <div style={{ fontSize: '0.7rem', fontWeight: '700', color: '#64748b' }}>OVERALL R² (TOÀN BỘ)</div>
              <div style={{ fontSize: '1.45rem', fontWeight: '800', color: '#7c3aed', margin: '0.15rem 0' }}>
                {neuralModel.diagnostics.rSquaredOverall.toFixed(4)}
              </div>
              <div style={{ fontSize: '0.7rem', color: '#64748b' }}>
                R²adj = {neuralModel.diagnostics.adjRSquared?.toFixed(4) ?? '-'}
              </div>
            </div>

            {/* Information Criteria AICc / BIC / -2LL */}
            <div className="qbd-card" style={{ padding: '0.85rem', borderLeft: '4px solid #0284c7' }}>
              <div style={{ fontSize: '0.7rem', fontWeight: '700', color: '#64748b' }}>AICc / BIC / -2LL</div>
              <div style={{ fontSize: '1.15rem', fontWeight: '800', color: '#0284c7', margin: '0.2rem 0' }}>
                AICc = {neuralModel.diagnostics.aicc?.toFixed(1) ?? '-'}
              </div>
              <div style={{ fontSize: '0.7rem', color: '#475569' }}>
                BIC: {neuralModel.diagnostics.bic?.toFixed(1) ?? '-'} | -2LL: {neuralModel.diagnostics.twoLL?.toFixed(1) ?? '-'}
              </div>
            </div>

            {/* Tour & Architecture Info */}
            <div className="qbd-card" style={{ padding: '0.85rem', borderLeft: '4px solid #0f766e' }}>
              <div style={{ fontSize: '0.7rem', fontWeight: '700', color: '#64748b' }}>TOUR TỐI ƯU / KIẾN TRÚC</div>
              <div style={{ fontSize: '1.15rem', fontWeight: '800', color: '#0f766e', margin: '0.2rem 0' }}>
                Tour #{neuralModel.diagnostics.bestTourIndex} / {localConfig.numTours}
              </div>
              <div style={{ fontSize: '0.7rem', color: '#64748b' }}>
                [{localConfig.hiddenNodes1}{localConfig.hiddenNodes2 > 0 ? `, ${localConfig.hiddenNodes2}` : ''}] ({localConfig.activation.toUpperCase()})
              </div>
            </div>

          </div>

          {/* Multi-Model Benchmarking Arena (Polynomial RSM vs Neural Network vs SVR vs Ensemble Stacking) */}
          <div className="qbd-card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <TrendingUp size={18} color="#1e3a8a" />
                <h3 style={{ fontSize: '0.95rem', fontWeight: '700', color: '#0f172a', margin: 0 }}>
                  Đấu Trường Đa Mô Hình (Multi-Model Benchmarking Arena) — {currentCQA.name} ({currentCQA.code})
                </h3>
              </div>
              <div style={{ fontSize: '0.74rem', color: '#475569' }}>
                Tiêu chuẩn tối ưu: <strong>AICc nhỏ nhất & Trọng số Akaike w_i cao nhất (Occam's Razor)</strong>
              </div>
            </div>

            {cqaBenchmark?.summaryRecommendation && (
              <div
                style={{
                  padding: '0.65rem 0.9rem',
                  backgroundColor: '#f8fafc',
                  borderLeft: '4px solid #7c3aed',
                  borderRadius: '0.375rem',
                  marginBottom: '1rem',
                  fontSize: '0.76rem',
                  color: '#334155',
                  lineHeight: '1.45',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: '700', color: '#7c3aed', marginBottom: '0.2rem' }}>
                  <Sparkles size={15} />
                  <span>Khuyến Nghị Lựa Chọn Mô Hình Theo Thuyết Thông Tin Akaike & Hướng Dẫn ICH Q8:</span>
                </div>
                <div>{cqaBenchmark.summaryRecommendation}</div>
              </div>
            )}

            <div className="table-container">
              <table className="qbd-table">
                <thead>
                  <tr>
                    <th>Phương Pháp Mô Hình Hóa</th>
                    <th>Kiến Trúc / Tham Số</th>
                    <th style={{ textAlign: 'center' }}>Tham Số (p) / df</th>
                    <th style={{ textAlign: 'center' }}>R² Train</th>
                    <th style={{ textAlign: 'center' }}>R²adj</th>
                    <th style={{ textAlign: 'center' }}>Dự Báo (Q² / Val R²)</th>
                    <th style={{ textAlign: 'center' }}>RMSE</th>
                    <th style={{ textAlign: 'center' }}>AICc</th>
                    <th style={{ textAlign: 'center' }}>ΔAICc</th>
                    <th style={{ textAlign: 'center' }}>Trọng Số Akaike (w_i)</th>
                    <th style={{ textAlign: 'center' }}>Rủi Ro Overfit</th>
                    <th style={{ textAlign: 'center' }}>Khuyến Nghị ICH Q8</th>
                  </tr>
                </thead>
                <tbody>
                  {cqaBenchmark && cqaBenchmark.candidates.length > 0 ? (
                    cqaBenchmark.candidates.map((cand) => {
                      const isRec = cand.isRecommended;
                      const rowBg = isRec
                        ? '#f5f3ff'
                        : cand.family === 'polynomial'
                        ? '#f8fafc'
                        : '#ffffff';

                      const suitBadge =
                        cand.ichQ8Suitability === 'Recommended'
                          ? { text: '⭐ Khuyến Nghị', bg: '#dcfce7', color: '#15803d' }
                          : cand.ichQ8Suitability === 'Acceptable'
                          ? { text: '✓ Chấp Nhận', bg: '#e0f2fe', color: '#0369a1' }
                          : cand.ichQ8Suitability === 'Caution'
                          ? { text: '⚠️ Thận Trọng', bg: '#fef9c3', color: '#854d0e' }
                          : { text: '✕ Không Đạt', bg: '#fee2e2', color: '#b91c1c' };

                      const overfitBadge =
                        cand.overfittingRisk === 'Low'
                          ? { text: 'Thấp', color: '#15803d' }
                          : cand.overfittingRisk === 'Moderate'
                          ? { text: 'Trung Bình', color: '#d97706' }
                          : { text: 'Cao', color: '#dc2626' };

                      return (
                        <tr
                          key={cand.modelId}
                          style={{
                            backgroundColor: rowBg,
                            fontWeight: isRec ? '600' : 'normal',
                          }}
                        >
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                              {isRec && <CheckCircle2 size={15} color="#7c3aed" />}
                              <strong style={{ color: isRec ? '#7c3aed' : '#1e293b' }}>{cand.name}</strong>
                            </div>
                          </td>
                          <td style={{ fontSize: '0.75rem', color: '#475569' }}>
                            {cand.architectureDescription}
                          </td>
                          <td style={{ textAlign: 'center', fontSize: '0.75rem', color: '#64748b' }}>
                            p = {cand.parameterCount} (df = {cand.degreesOfFreedom})
                          </td>
                          <td style={{ textAlign: 'center', fontWeight: '700' }}>
                            {cand.rSquared.toFixed(4)}
                          </td>
                          <td style={{ textAlign: 'center', fontWeight: isRec ? '700' : 'normal', color: isRec ? '#7c3aed' : 'inherit' }}>
                            {cand.adjRSquared.toFixed(4)}
                          </td>
                          <td style={{ textAlign: 'center', fontWeight: '700', color: (cand.qSquared ?? 0) > 0.7 ? '#15803d' : '#64748b' }}>
                            {cand.qSquared !== undefined ? cand.qSquared.toFixed(4) : '-'}
                          </td>
                          <td style={{ textAlign: 'center', fontWeight: '700' }}>
                            {cand.rmse.toFixed(3)}
                          </td>
                          <td style={{ textAlign: 'center', fontFamily: 'monospace', fontWeight: '700' }}>
                            {Number.isFinite(cand.aicc) ? cand.aicc.toFixed(1) : '∞'}
                          </td>
                          <td style={{ textAlign: 'center', fontFamily: 'monospace', color: cand.deltaAICc === 0 ? '#15803d' : '#64748b', fontWeight: cand.deltaAICc === 0 ? '700' : 'normal' }}>
                            {cand.deltaAICc === 0 ? '0.0 (Best)' : `+${cand.deltaAICc.toFixed(1)}`}
                          </td>
                          <td style={{ textAlign: 'center', fontWeight: '800', color: cand.akaikeWeight > 0.5 ? '#15803d' : '#475569' }}>
                            {(cand.akaikeWeight * 100).toFixed(1)}%
                          </td>
                          <td style={{ textAlign: 'center', fontSize: '0.75rem', color: overfitBadge.color, fontWeight: '600' }}>
                            {overfitBadge.text}
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <span className="badge" style={{ backgroundColor: suitBadge.bg, color: suitBadge.color, fontSize: '0.72rem', fontWeight: '700' }}>
                              {suitBadge.text}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={12} style={{ textAlign: 'center', padding: '1rem', color: '#64748b' }}>
                        Đang nạp dữ liệu so sánh mô hình...
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Explanatory Note on SVR & Ensemble Stacking Roles */}
            <div
              style={{
                marginTop: '0.85rem',
                padding: '0.65rem 0.85rem',
                backgroundColor: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderLeft: '4px solid #0284c7',
                borderRadius: '0.375rem',
                fontSize: '0.76rem',
                color: '#334155',
                lineHeight: '1.5',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.55rem',
              }}
            >
              <Info size={16} color="#0284c7" style={{ flexShrink: 0, marginTop: '0.15rem' }} />
              <div>
                <strong style={{ color: '#0369a1' }}>Vai trò của SVR và Ensemble Stacking:</strong>{' '}
                Đóng vai trò là <em>Mô hình Thẩm định &amp; Đối chuẩn Độc lập (Challenger / Benchmarking Models)</em>. Mục đích là cung cấp cơ sở khoa học khách quan để chứng minh mô hình người dùng chọn (Đa thức hoặc Mạng nơ-ron) không bị thiên lệch bởi một thuật toán đơn lẻ trước khi chuyển sang Bước 6 (Mặt đáp) và Bước 7 (Không gian thiết kế).
              </div>
            </div>
          </div>

          {/* Multi-CQA Neural Performance Summary Table */}
          {project.cqas.length > 1 && (
            <div className="qbd-card">
              <h3 style={{ fontSize: '0.95rem', fontWeight: '700', color: '#0f172a', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Network size={18} color="#7c3aed" />
                  <span>Bảng Tổng Hợp Chỉ Số Khớp Của Toàn Bộ {project.cqas.length} Biến Y (Multi-CQA Performance Overview)</span>
                </div>
                <span className="badge" style={{ backgroundColor: neuralTrainingMode === 'shared' ? '#0284c7' : '#0f766e', color: '#ffffff', fontSize: '0.72rem' }}>
                  {neuralTrainingMode === 'shared' ? '🌐 1 Mạng Nơ-ron Hợp Nhất (Shared)' : '🎯 Mạng Độc Lập (Per-CQA)'}
                </span>
              </h3>

              <div className="table-container">
                <table className="qbd-table">
                  <thead>
                    <tr>
                      <th>Mã CQA</th>
                      <th>Tên Chỉ Tiêu Chất Lượng</th>
                      <th style={{ textAlign: 'center' }}>Kiến Trúc</th>
                      <th style={{ textAlign: 'center' }}>Tham Số (P)</th>
                      <th style={{ textAlign: 'center' }}>Train R²</th>
                      <th style={{ textAlign: 'center' }}>Val R²</th>
                      <th style={{ textAlign: 'center' }}>Overall R²</th>
                      <th style={{ textAlign: 'center' }}>RMSE</th>
                      <th style={{ textAlign: 'center' }}>Đánh Giá</th>
                      <th style={{ textAlign: 'center' }}>Thao Tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {project.cqas.map((cqa) => {
                      const m = neuralModels[cqa.code];
                      const isSelected = cqa.code === selectedCQA;
                      const r2 = m ? m.diagnostics.rSquaredOverall : 0;
                      const rating =
                        r2 >= 0.95
                          ? { text: 'Xuất sắc (≥95%)', bg: '#dcfce7', color: '#15803d' }
                          : r2 >= 0.85
                          ? { text: 'Tốt (85-95%)', bg: '#e0f2fe', color: '#0369a1' }
                          : r2 >= 0.7
                          ? { text: 'Đạt (70-85%)', bg: '#fef9c3', color: '#854d0e' }
                          : { text: 'Kém (<70%)', bg: '#fee2e2', color: '#b91c1c' };

                      return (
                        <tr
                          key={cqa.code}
                          style={{
                            backgroundColor: isSelected ? '#f5f3ff' : '#ffffff',
                            fontWeight: isSelected ? '600' : 'normal',
                          }}
                        >
                          <td style={{ fontWeight: '700', color: '#7c3aed' }}>{cqa.code}</td>
                          <td>
                            <strong>{cqa.name}</strong> {cqa.unit ? `(${cqa.unit})` : ''}
                          </td>
                          <td style={{ textAlign: 'center', fontSize: '0.78rem' }}>
                            {m ? `[${m.config.hiddenNodes1}${m.config.hiddenNodes2 > 0 ? `, ${m.config.hiddenNodes2}` : ''}] ${m.config.activation.toUpperCase()}` : '-'}
                          </td>
                          <td style={{ textAlign: 'center', fontSize: '0.78rem', color: '#64748b' }}>
                            {m?.parameterCount ?? '-'}
                          </td>
                          <td style={{ textAlign: 'center', color: '#1e3a8a' }}>
                            {m ? m.diagnostics.rSquaredTrain.toFixed(4) : '-'}
                          </td>
                          <td style={{ textAlign: 'center', color: '#dc2626' }}>
                            {m ? m.diagnostics.rSquaredVal.toFixed(4) : '-'}
                          </td>
                          <td style={{ textAlign: 'center', fontWeight: '700', color: '#7c3aed' }}>
                            {m ? m.diagnostics.rSquaredOverall.toFixed(4) : '-'}
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            {m ? m.diagnostics.rmseOverall.toFixed(3) : '-'}
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            {m ? (
                              <span className="badge" style={{ backgroundColor: rating.bg, color: rating.color, fontSize: '0.7rem' }}>
                                {rating.text}
                              </span>
                            ) : (
                              <span className="badge badge-secondary" style={{ fontSize: '0.7rem' }}>Chưa fit</span>
                            )}
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <button
                              onClick={() => onSelectCQA(cqa.code)}
                              className={`btn ${isSelected ? 'btn-primary' : 'btn-outline'}`}
                              style={{
                                fontSize: '0.72rem',
                                padding: '0.2rem 0.6rem',
                                backgroundColor: isSelected ? '#7c3aed' : 'transparent',
                                borderColor: '#7c3aed',
                                color: isSelected ? '#ffffff' : '#7c3aed',
                              }}
                            >
                              {isSelected ? '✓ Đang xem' : 'Khảo sát ▶'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Diagnostic Plots & Variable Importance Section */}
          <div className="qbd-card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Layers size={18} color="#7c3aed" />
                <h3 style={{ fontSize: '1rem', fontWeight: '700', color: '#0f172a' }}>
                  Đồ Thị Chẩn Đoán Mô Hình Nơ-ron (Neural Diagnostics)
                </h3>
              </div>

              <div style={{ display: 'flex', backgroundColor: '#f1f5f9', borderRadius: '0.5rem', padding: '0.25rem', gap: '0.2rem' }}>
                <button
                  onClick={() => setActiveDiagPlot('actPred')}
                  className={`btn ${activeDiagPlot === 'actPred' ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ padding: '0.3rem 0.65rem', fontSize: '0.78rem', border: 'none' }}
                >
                  Thực Tế vs Dự Đoán
                </button>
                <button
                  onClick={() => setActiveDiagPlot('resPred')}
                  className={`btn ${activeDiagPlot === 'resPred' ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ padding: '0.3rem 0.65rem', fontSize: '0.78rem', border: 'none' }}
                >
                  Phần Dư vs Dự Đoán
                </button>
                <button
                  onClick={() => setActiveDiagPlot('loss')}
                  className={`btn ${activeDiagPlot === 'loss' ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ padding: '0.3rem 0.65rem', fontSize: '0.78rem', border: 'none' }}
                >
                  Đường Cong Hội Tụ Loss
                </button>
                <button
                  onClick={() => setActiveDiagPlot('varImp')}
                  className={`btn ${activeDiagPlot === 'varImp' ? 'btn-teal' : 'btn-secondary'}`}
                  style={{ padding: '0.3rem 0.65rem', fontSize: '0.78rem', border: 'none' }}
                >
                  Độ Quan Trọng & XAI (Explainable AI)
                </button>
              </div>
            </div>

            {renderDiagnosticPlot()}
          </div>

          {/* Transition Card 1: Response Surface at Step 6 */}
          <div className="qbd-card" style={{ borderLeft: '4px solid #0f766e', background: 'linear-gradient(to right, #f0fdfa, #ffffff)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
              <div style={{ maxWidth: '800px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
                  <Compass size={20} color="#0f766e" />
                  <h3 style={{ fontSize: '1.02rem', fontWeight: '700', color: '#0f172a', margin: 0 }}>
                    Khảo Sát Mặt Đáp Mô Phỏng Bằng Mạng Nơ-ron (Bước 6)
                  </h3>
                  <span className="badge badge-teal" style={{ fontSize: '0.72rem' }}>3D Surface &amp; Contour</span>
                </div>
                <p style={{ fontSize: '0.82rem', color: '#334155', margin: 0, lineHeight: 1.5 }}>
                  Mô hình mạng nơ-ron cho <strong>{currentCQA.name} ({currentCQA.code})</strong> đã sẵn sàng. Toàn bộ không gian tương tác phi tuyến tính 3D, đường đồng mức 2D và biểu đồ tam giác hỗn hợp (Ternary Mixture) được hiển thị chuyên sâu tại <strong>Bước 6: Mặt Đáp</strong>.
                </p>
              </div>

              <button
                onClick={() => {
                  onSelectEngine?.('neural');
                  onNavigateToRSM();
                }}
                className="btn btn-teal"
                style={{ fontSize: '0.85rem', padding: '0.55rem 1.25rem', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '0.45rem' }}
                title="Chuyển sang Bước 6 để xem mặt đáp 3D và 2D Contour của Mạng Nơ-ron"
              >
                <span>Mở Mặt Đáp Mạng Nơ-ron Tại Bước 6</span>
                <ArrowRight size={16} />
              </button>
            </div>
          </div>

          {/* Transition Card 2: Design Space & Profiler at Step 7 */}
          <div className="qbd-card" style={{ borderLeft: '4px solid #7c3aed', background: 'linear-gradient(to right, #faf5ff, #ffffff)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
              <div style={{ maxWidth: '800px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
                  <Sliders size={20} color="#7c3aed" />
                  <h3 style={{ fontSize: '1.02rem', fontWeight: '700', color: '#0f172a', margin: 0 }}>
                    Tối Ưu Hóa Đa Mục Tiêu &amp; Không Gian Thiết Kế (Bước 7)
                  </h3>
                  <span className="badge" style={{ backgroundColor: '#f3e8ff', color: '#6b21a8', border: '1px solid #e9d5ff', fontSize: '0.72rem' }}>
                    Desirability Profiler &amp; Design Space
                  </span>
                </div>
                <p style={{ fontSize: '0.82rem', color: '#334155', margin: 0, lineHeight: 1.5 }}>
                  Để tìm điểm vận hành tối ưu đồng thời cho tất cả {project.cqas.length} chỉ tiêu chất lượng CQA theo hàm thỏa dụng Derringer-Suich và xây dựng không gian thiết kế (Design Space / NOR / PAR) dựa trên Mạng Nơ-ron, vui lòng chuyển sang <strong>Bước 7</strong>.
                </p>
              </div>

              <button
                onClick={() => {
                  onSelectEngine?.('neural');
                  onNavigateToDesignSpace();
                }}
                className="btn btn-primary"
                style={{ fontSize: '0.85rem', padding: '0.55rem 1.25rem', backgroundColor: '#7c3aed', borderColor: '#7c3aed', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '0.45rem' }}
                title="Chuyển sang Bước 7 để tối ưu hóa và xây dựng Design Space bằng Mạng Nơ-ron"
              >
                <span>Mở Không Gian Thiết Kế Tại Bước 7</span>
                <ArrowRight size={16} />
              </button>
            </div>
          </div>

          {/* Model Formula & Code Export Box */}
          <div className="qbd-card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Code2 size={18} color="#1e3a8a" />
                <h3 style={{ fontSize: '0.95rem', fontWeight: '700', color: '#0f172a' }}>
                  Xuất Công Thức & Mã Nguồn Suy Luận (Model Deployment & Formula Export)
                </h3>
              </div>

              <div style={{ display: 'flex', gap: '0.4rem' }}>
                <button
                  onClick={() => handleCopyCode(neuralModel.pythonCode, 'python')}
                  className="btn btn-secondary"
                  style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }}
                >
                  {copiedType === 'python' ? <Check size={14} color="#15803d" /> : <Copy size={14} />}
                  <span>{copiedType === 'python' ? 'Đã sao chép Python!' : 'Copy Python'}</span>
                </button>

                <button
                  onClick={() => handleCopyCode(neuralModel.excelFormula, 'excel')}
                  className="btn btn-secondary"
                  style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }}
                >
                  {copiedType === 'excel' ? <Check size={14} color="#15803d" /> : <Copy size={14} />}
                  <span>{copiedType === 'excel' ? 'Đã sao chép Excel!' : 'Copy Excel Formula'}</span>
                </button>
              </div>
            </div>

            <div
              style={{
                backgroundColor: '#1e293b',
                color: '#e2e8f0',
                padding: '1rem',
                borderRadius: '0.5rem',
                fontFamily: 'monospace',
                fontSize: '0.8rem',
                maxHeight: '220px',
                overflowY: 'auto',
                whiteSpace: 'pre-wrap',
              }}
            >
              {neuralModel.pythonCode}
            </div>

            {/* Bottom Navigation Actions */}
            <div style={{ marginTop: '1.25rem', display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', flexWrap: 'wrap' }}>
              <button
                onClick={() => {
                  onSelectEngine?.('neural');
                  onNavigateToRSM();
                }}
                className="btn btn-primary"
                style={{ fontSize: '0.85rem', padding: '0.5rem 1.25rem', backgroundColor: '#7c3aed', borderColor: '#7c3aed', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '0.45rem' }}
                title="Khóa mô hình Mạng Nơ-ron AI và chuyển sang Bước 6: Mặt đáp"
              >
                <span>Tiếp Tục Với Mạng Nơ-ron (Bước 6: Mặt Đáp)</span>
                <ArrowRight size={16} />
              </button>

              <button
                onClick={() => {
                  onSelectEngine?.('neural');
                  onNavigateToDesignSpace();
                }}
                className="btn btn-secondary"
                style={{ fontSize: '0.85rem', padding: '0.5rem 1.1rem', color: '#6d28d9', borderColor: '#e9d5ff', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                title="Bỏ qua khảo sát mặt đáp để sang thẳng Bước 7: Không gian thiết kế & Tối ưu hóa Desirability"
              >
                <span>Sang Bước 7: Không Gian Thiết Kế</span>
                <ArrowRight size={14} />
              </button>
            </div>
          </div>
        </>
      )}

    </div>
  );
};
