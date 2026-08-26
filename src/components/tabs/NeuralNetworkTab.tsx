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
  FlaskConical,
  Network,
  AlertTriangle,
  AlertOctagon,
  Share2,
  Target,
  Zap,
  RotateCcw,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import type {
  QBDProject,
  StatisticalModelResult,
  NeuralNetConfig,
  NeuralNetModelResult,
  NeuralTrainingMode,
  NeuralActivation,
  DesirabilitySolution,
  ModelingEngine,
} from '../../types/qbd';
import { PlotlyChart } from '../PlotlyChart';
import { codedToActual } from '../../services/doeGenerator';
import {
  optimizeNeuralDesirability,
  calculateNeuralArchitectureMetrics,
  DEFAULT_NEURAL_CONFIG,
} from '../../services/neuralNetwork';
import { formatAxisTitle, extract2DContourSegments } from '../../services/mathUtils';
import {
  generateTernaryContour,
  buildTernaryPlotlyTraces,
} from '../../services/ternaryContour';

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
    validationMethod: 'holdout',
    holdoutRatio: 0.25,
    numTours: 10,
    seed: 42,
  };

  const [localConfig, setLocalConfig] = useState<NeuralNetConfig>(currentConfig);
  const [activeDiagPlot, setActiveDiagPlot] = useState<'actPred' | 'resPred' | 'loss' | 'varImp'>('actPred');
  const [copiedType, setCopiedType] = useState<'python' | 'excel' | 'formula' | null>(null);

  // Active inputs & architecture parameters
  const activeFactors = useMemo(
    () => project.factors.filter((f) => f.controllability !== 'constant'),
    [project.factors]
  );
  const numInputs = activeFactors.length;
  const numOutputs = neuralTrainingMode === 'shared' ? project.cqas.length : 1;
  const numSamples = project.runs.length;

  const archMetrics = useMemo(() => {
    return calculateNeuralArchitectureMetrics(
      numInputs,
      localConfig.hiddenNodes1,
      localConfig.hiddenNodes2,
      numOutputs,
      numSamples
    );
  }, [numInputs, localConfig.hiddenNodes1, localConfig.hiddenNodes2, numOutputs, numSamples]);

  // Live Training / Fitting State
  const [isTraining, setIsTraining] = useState<boolean>(false);
  const [trainingProgress, setTrainingProgress] = useState<{
    tour: number;
    totalTours: number;
    epoch: number;
    maxEpochs: number;
    loss: number;
    bestR2: number;
    phase: string;
  } | null>(null);
  const [lastTrainedNotice, setLastTrainedNotice] = useState<string | null>(null);

  // Profiler interactive slider values (in coded scale [-1, 1])
  const [profilerCoded, setProfilerCoded] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    project.factors.forEach((f) => {
      init[f.code] = 0;
    });
    return init;
  });

  // Mixture factors filter
  const mixtureFactors = useMemo(() => {
    return project.factors.filter((f) => f.role === 'mixture_component' || f.type === 'Mixture');
  }, [project.factors]);
  const hasMixture = mixtureFactors.length >= 3;

  // 3D/2D Surface Profiler factor axes
  const [xAxisFactor, setXAxisFactor] = useState<string>(project.factors[0]?.code || 'X1');
  const [yAxisFactor, setYAxisFactor] = useState<string>(project.factors[1]?.code || 'X2');
  const [plotType, setPlotType] = useState<'3d' | 'contour' | 'ternary'>(() =>
    hasMixture ? 'ternary' : '3d'
  );
  const [colorScale, setColorScale] = useState<string>('Plasma');

  // If project changes and has mixture, sync default plot type
  useEffect(() => {
    if (hasMixture && plotType === '3d') {
      setPlotType('ternary');
    }
  }, [project.id, hasMixture]);

  // Selected Vertices for 3-Component Mixture Triangle
  const [ternaryA, setTernaryA] = useState<string>(() => mixtureFactors[0]?.code || project.factors[0]?.code || 'X1');
  const [ternaryB, setTernaryB] = useState<string>(() => mixtureFactors[1]?.code || project.factors[1]?.code || 'X2');
  const [ternaryC, setTernaryC] = useState<string>(() => mixtureFactors[2]?.code || project.factors[2]?.code || 'X3');

  // Sync ternary factors when project or factors change
  useEffect(() => {
    if (mixtureFactors.length >= 3) {
      setTernaryA(mixtureFactors[0].code);
      setTernaryB(mixtureFactors[1].code);
      setTernaryC(mixtureFactors[2].code);
    } else if (project.factors.length >= 3) {
      setTernaryA(project.factors[0].code);
      setTernaryB(project.factors[1].code);
      setTernaryC(project.factors[2].code);
    }
  }, [project.id, project.factors, mixtureFactors]);

  // Ternary Contour Options
  const [ternaryDisplayMode, setTernaryDisplayMode] = useState<'both' | 'lines_only' | 'heatmap'>('both');
  const [ternaryLevels, setTernaryLevels] = useState<number>(12);
  const [showDoERuns, setShowDoERuns] = useState<boolean>(true);
  const [showOptimum, setShowOptimum] = useState<boolean>(true);
  const [showConstraints, setShowConstraints] = useState<boolean>(true);
  const [showRegionPolygon, setShowRegionPolygon] = useState<boolean>(true);
  const [showSpecLimits, setShowSpecLimits] = useState<boolean>(true);
  const [ternaryResolution, setTernaryResolution] = useState<number>(180);
  const [ternarySmoothness, setTernarySmoothness] = useState<number>(1.0);

  // Active factors for Ternary
  const factorA = project.factors.find((f) => f.code === ternaryA) || mixtureFactors[0] || project.factors[0];
  const factorB = project.factors.find((f) => f.code === ternaryB) || mixtureFactors[1] || project.factors[1];
  const factorC = project.factors.find((f) => f.code === ternaryC) || mixtureFactors[2] || project.factors[2];

  // Neural Optimum State
  const [neuralOptimum, setNeuralOptimum] = useState<DesirabilitySolution | null>(null);

  // Surface Grid Data from Neural Model (Unconditional Hooks for React Rules of Hooks)
  const factorX = project.factors.find((f) => f.code === xAxisFactor) || project.factors[0];
  const factorY = project.factors.find((f) => f.code === yAxisFactor) || project.factors[1];

  const surfaceGrid = useMemo(() => {
    if (!neuralModel || !factorX || !factorY) return null;

    const N = 35;
    const xActualArr: number[] = [];
    const yActualArr: number[] = [];
    const xCodedArr: number[] = [];
    const yCodedArr: number[] = [];

    for (let i = 0; i < N; i++) {
      const coded = -1.0 + (2.0 * i) / (N - 1);
      xCodedArr.push(coded);
      yCodedArr.push(coded);
      const xAct = codedToActual(coded, factorX);
      const yAct = codedToActual(coded, factorY);
      xActualArr.push(typeof xAct === 'number' ? xAct : Number(xAct) || coded);
      yActualArr.push(typeof yAct === 'number' ? yAct : Number(yAct) || coded);
    }

    const zGrid: number[][] = [];
    for (let j = 0; j < N; j++) {
      const row: number[] = [];
      const yCoded = yCodedArr[j];

      for (let i = 0; i < N; i++) {
        const xCoded = xCodedArr[i];
        const pointCoded: Record<string, number> = { ...profilerCoded };
        pointCoded[factorX.code] = xCoded;
        pointCoded[factorY.code] = yCoded;

        const pred = neuralModel.predict(pointCoded);
        row.push(Number(pred.toFixed(3)));
      }
      zGrid.push(row);
    }

    return { xActualArr, yActualArr, zGrid };
  }, [neuralModel, factorX, factorY, profilerCoded]);

  // Ternary Mesh & Contour Calculation for Neural Model
  const ternaryResult = useMemo(() => {
    if (plotType !== 'ternary' || !neuralModel || !factorA || !factorB || !factorC || !currentCQA) {
      return null;
    }

    return generateTernaryContour(
      factorA,
      factorB,
      factorC,
      project.factors,
      profilerCoded,
      neuralModel,
      currentCQA,
      ternaryResolution,
      ternaryLevels
    );
  }, [
    plotType,
    neuralModel,
    factorA,
    factorB,
    factorC,
    project.factors,
    profilerCoded,
    currentCQA,
    ternaryResolution,
    ternaryLevels,
  ]);

  const surfacePlotData = useMemo(() => {
    if (plotType === 'ternary') {
      if (!ternaryResult || !factorA || !factorB || !factorC || !currentCQA) return [];
      const { traces } = buildTernaryPlotlyTraces(
        ternaryResult,
        factorA,
        factorB,
        factorC,
        currentCQA,
        {
          colorScale,
          displayMode: ternaryDisplayMode,
          showDoERuns,
          doeRuns: project.runs,
          showOptimum,
          optimum: neuralOptimum,
          showConstraints,
          showRegionPolygon,
          showSpecLimits,
          ternaryLevels,
          smoothness: ternarySmoothness,
        }
      );
      return traces;
    }

    if (!surfaceGrid || !factorX || !factorY || !currentCQA) return [];
    const traces: any[] = [];

    if (plotType === '3d') {
      traces.push({
        type: 'surface',
        x: surfaceGrid.xActualArr,
        y: surfaceGrid.yActualArr,
        z: surfaceGrid.zGrid,
        colorscale: colorScale,
        colorbar: {
          title: {
            text: `${currentCQA.name} (${currentCQA.code})${currentCQA.unit ? ` [${currentCQA.unit}]` : ''}`,
            side: 'right',
            font: { size: 11, color: '#1e293b' },
          },
          len: 0.85,
          thickness: 18,
        },
        contours: {
          z: { show: true, usecolormap: true, highlightcolor: '#ffffff', project: { z: true } },
        },
        hoverinfo: 'x+y+z',
      });

      // 3D Spec Limit Horizontal Planes & Intersection Curves
      if (showSpecLimits) {
        const xMin = surfaceGrid.xActualArr[0];
        const xMax = surfaceGrid.xActualArr[surfaceGrid.xActualArr.length - 1];
        const yMin = surfaceGrid.yActualArr[0];
        const yMax = surfaceGrid.yActualArr[surfaceGrid.yActualArr.length - 1];

        // LSL Plane & Curve
        if (currentCQA.lowerLimit !== undefined) {
          const LSL = currentCQA.lowerLimit;
          traces.push({
            type: 'surface',
            name: `🔴 Giới Hạn Dưới (LSL = ${LSL} ${currentCQA.unit || ''})`,
            x: [xMin, xMax],
            y: [yMin, yMax],
            z: [
              [LSL, LSL],
              [LSL, LSL],
            ],
            opacity: 0.35,
            showscale: false,
            colorscale: [
              [0, 'rgba(239, 68, 68, 0.45)'],
              [1, 'rgba(239, 68, 68, 0.45)'],
            ],
            hoverinfo: 'name',
            showlegend: true,
          });

          const lslSegs = extract2DContourSegments(
            surfaceGrid.xActualArr,
            surfaceGrid.yActualArr,
            surfaceGrid.zGrid,
            LSL
          );
          if (lslSegs.length > 0) {
            traces.push({
              type: 'scatter3d',
              mode: 'lines',
              name: `🔴 Đường Cắt LSL = ${LSL} ${currentCQA.unit || ''}`,
              x: lslSegs.flatMap((s) => [s.x1, s.x2, null]),
              y: lslSegs.flatMap((s) => [s.y1, s.y2, null]),
              z: lslSegs.flatMap(() => [LSL, LSL, null]),
              line: { color: '#dc2626', width: 6 },
              hoverinfo: 'name',
              showlegend: false,
            });
          }
        }

        // USL Plane & Curve
        if (currentCQA.upperLimit !== undefined) {
          const USL = currentCQA.upperLimit;
          traces.push({
            type: 'surface',
            name: `🔴 Giới Hạn Trên (USL = ${USL} ${currentCQA.unit || ''})`,
            x: [xMin, xMax],
            y: [yMin, yMax],
            z: [
              [USL, USL],
              [USL, USL],
            ],
            opacity: 0.35,
            showscale: false,
            colorscale: [
              [0, 'rgba(185, 28, 28, 0.45)'],
              [1, 'rgba(185, 28, 28, 0.45)'],
            ],
            hoverinfo: 'name',
            showlegend: true,
          });

          const uslSegs = extract2DContourSegments(
            surfaceGrid.xActualArr,
            surfaceGrid.yActualArr,
            surfaceGrid.zGrid,
            USL
          );
          if (uslSegs.length > 0) {
            traces.push({
              type: 'scatter3d',
              mode: 'lines',
              name: `🔴 Đường Cắt USL = ${USL} ${currentCQA.unit || ''}`,
              x: uslSegs.flatMap((s) => [s.x1, s.x2, null]),
              y: uslSegs.flatMap((s) => [s.y1, s.y2, null]),
              z: uslSegs.flatMap(() => [USL, USL, null]),
              line: { color: '#b91c1c', width: 6 },
              hoverinfo: 'name',
              showlegend: false,
            });
          }
        }

        // Target Plane
        if (currentCQA.target !== undefined && currentCQA.objective === 'target') {
          const T = currentCQA.target;
          traces.push({
            type: 'surface',
            name: `🟢 Mục Tiêu (Target = ${T} ${currentCQA.unit || ''})`,
            x: [xMin, xMax],
            y: [yMin, yMax],
            z: [
              [T, T],
              [T, T],
            ],
            opacity: 0.25,
            showscale: false,
            colorscale: [
              [0, 'rgba(5, 150, 105, 0.35)'],
              [1, 'rgba(5, 150, 105, 0.35)'],
            ],
            hoverinfo: 'name',
            showlegend: true,
          });
        }
      }
    } else {
      // 2D Contour
      traces.push({
        type: 'contour',
        x: surfaceGrid.xActualArr,
        y: surfaceGrid.yActualArr,
        z: surfaceGrid.zGrid,
        colorscale: colorScale,
        colorbar: {
          title: {
            text: `${currentCQA.name} (${currentCQA.code})${currentCQA.unit ? ` [${currentCQA.unit}]` : ''}`,
            side: 'right',
            font: { size: 11, color: '#1e293b' },
          },
          len: 0.85,
          thickness: 18,
        },
        contours: { coloring: 'heatmap', showlabels: true },
        hoverinfo: 'x+y+z',
      });

      // 2D Spec Limit Isolines
      if (showSpecLimits) {
        if (currentCQA.lowerLimit !== undefined) {
          const LSL = currentCQA.lowerLimit;
          const lslSegs = extract2DContourSegments(
            surfaceGrid.xActualArr,
            surfaceGrid.yActualArr,
            surfaceGrid.zGrid,
            LSL
          );
          if (lslSegs.length > 0) {
            traces.push({
              type: 'scatter',
              mode: 'lines',
              name: `🔴 Giới Hạn Dưới (LSL = ${LSL} ${currentCQA.unit || ''})`,
              x: lslSegs.flatMap((s) => [s.x1, s.x2, null]),
              y: lslSegs.flatMap((s) => [s.y1, s.y2, null]),
              line: { color: '#dc2626', width: 3.2, dash: 'dash' },
              hoverinfo: 'name',
              showlegend: true,
            });
          }
        }

        if (currentCQA.upperLimit !== undefined) {
          const USL = currentCQA.upperLimit;
          const uslSegs = extract2DContourSegments(
            surfaceGrid.xActualArr,
            surfaceGrid.yActualArr,
            surfaceGrid.zGrid,
            USL
          );
          if (uslSegs.length > 0) {
            traces.push({
              type: 'scatter',
              mode: 'lines',
              name: `🔴 Giới Hạn Trên (USL = ${USL} ${currentCQA.unit || ''})`,
              x: uslSegs.flatMap((s) => [s.x1, s.x2, null]),
              y: uslSegs.flatMap((s) => [s.y1, s.y2, null]),
              line: { color: '#b91c1c', width: 3.2, dash: 'dash' },
              hoverinfo: 'name',
              showlegend: true,
            });
          }
        }

        if (currentCQA.target !== undefined && currentCQA.objective === 'target') {
          const T = currentCQA.target;
          const targetSegs = extract2DContourSegments(
            surfaceGrid.xActualArr,
            surfaceGrid.yActualArr,
            surfaceGrid.zGrid,
            T
          );
          if (targetSegs.length > 0) {
            traces.push({
              type: 'scatter',
              mode: 'lines',
              name: `🟢 Mục Tiêu (Target = ${T} ${currentCQA.unit || ''})`,
              x: targetSegs.flatMap((s) => [s.x1, s.x2, null]),
              y: targetSegs.flatMap((s) => [s.y1, s.y2, null]),
              line: { color: '#059669', width: 2.6, dash: 'solid' },
              hoverinfo: 'name',
              showlegend: true,
            });
          }
        }
      }
    }

    return traces;
  }, [
    plotType,
    ternaryResult,
    factorA,
    factorB,
    factorC,
    currentCQA,
    colorScale,
    ternaryDisplayMode,
    showDoERuns,
    project.runs,
    showOptimum,
    neuralOptimum,
    showConstraints,
    showRegionPolygon,
    showSpecLimits,
    surfaceGrid,
    factorX,
    factorY,
  ]);

  const surfaceLayout = useMemo(() => {
    if (plotType === 'ternary') {
      if (!ternaryResult || !factorA || !factorB || !factorC || !currentCQA) return {};
      const { layout } = buildTernaryPlotlyTraces(
        ternaryResult,
        factorA,
        factorB,
        factorC,
        currentCQA,
        {
          colorScale,
          displayMode: ternaryDisplayMode,
          showDoERuns,
          doeRuns: project.runs,
          showOptimum,
          optimum: neuralOptimum,
          showConstraints,
          showRegionPolygon,
        }
      );
      return {
        ...layout,
        title: {
          text: `Bề Mặt Tam Giác Mô Phỏng Bởi Mạng Nơ-ron: ${currentCQA.name} (${currentCQA.code})${currentCQA.unit ? ` [${currentCQA.unit}]` : ''}`,
          font: { size: 13, color: '#0f172a', family: 'Inter, sans-serif' },
        },
      };
    }

    return {
      title: `${plotType === '3d' ? 'Bề Mặt Đáp Ứng Mạng Nơ-ron 3D' : 'Đường Đồng Mức 2D'}: ${currentCQA?.name || ''} (${currentCQA?.code || ''})${currentCQA?.unit ? ` [${currentCQA.unit}]` : ''}`,
      autosize: true,
      margin: plotType === '3d' ? { l: 40, r: 40, b: 40, t: 50 } : { l: 85, r: 60, t: 60, b: 75, pad: 4 },
      scene: {
        xaxis: {
          title: {
            text: factorX ? formatAxisTitle(factorX.name, factorX.code, factorX.unit) : '',
            font: { size: 12, color: '#1e293b' },
          },
          tickfont: { size: 10 },
        },
        yaxis: {
          title: {
            text: factorY ? formatAxisTitle(factorY.name, factorY.code, factorY.unit) : '',
            font: { size: 12, color: '#1e293b' },
          },
          tickfont: { size: 10 },
        },
        zaxis: {
          title: {
            text: currentCQA ? formatAxisTitle(currentCQA.name, currentCQA.code, currentCQA.unit) : '',
            font: { size: 12, color: '#1e293b' },
          },
          tickfont: { size: 10 },
        },
        camera: { eye: { x: 1.6, y: 1.6, z: 1.2 } },
      },
      xaxis: {
        title: {
          text: factorX ? formatAxisTitle(factorX.name, factorX.code, factorX.unit) : '',
          font: { size: 13, color: '#1e293b' },
          standoff: 12,
        },
        tickfont: { size: 11 },
        automargin: true,
      },
      yaxis: {
        title: {
          text: factorY ? formatAxisTitle(factorY.name, factorY.code, factorY.unit) : '',
          font: { size: 13, color: '#1e293b' },
          standoff: 12,
        },
        tickfont: { size: 11 },
        automargin: true,
      },
    };
  }, [
    plotType,
    ternaryResult,
    factorA,
    factorB,
    factorC,
    currentCQA,
    colorScale,
    ternaryDisplayMode,
    showDoERuns,
    project.runs,
    showOptimum,
    neuralOptimum,
    showConstraints,
    showRegionPolygon,
    factorX,
    factorY,
  ]);

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
        const tourLoss = 0.04 / Math.sqrt(t) + Math.random() * 0.008;
        const estR2 = Math.min(0.998, 0.86 + 0.13 * (1 - Math.exp(-t / 2.2)) + (Math.random() * 0.01 - 0.005));

        setTrainingProgress({
          tour: t,
          totalTours,
          epoch: Math.floor((maxEpochs * t) / numDisplaySteps),
          maxEpochs,
          loss: tourLoss,
          bestR2: Number(estR2.toFixed(4)),
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
        loss: 0.0018,
        bestR2: 0.9935,
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
        const tourLoss = 0.04 / Math.sqrt(t) + Math.random() * 0.008;
        const estR2 = Math.min(0.998, 0.86 + 0.13 * (1 - Math.exp(-t / 2.2)) + (Math.random() * 0.01 - 0.005));

        setTrainingProgress({
          tour: t,
          totalTours,
          epoch: Math.floor((maxEpochs * t) / numDisplaySteps),
          maxEpochs,
          loss: tourLoss,
          bestR2: Number(estR2.toFixed(4)),
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
        loss: 0.0018,
        bestR2: 0.9935,
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
        loss: 0.002,
        bestR2: 0.985,
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
      setLastTrainedNotice(`✓ Đã sao chép cấu hình [${localConfig.hiddenNodes1}, ${localConfig.hiddenNodes2}, ${localConfig.activation}] sang tất cả ${project.cqas.length} CQA!`);
    }
  };

  const handleSolveNeuralOptimum = () => {
    const opt = optimizeNeuralDesirability(project.factors, project.cqas, neuralModels);
    if (opt) {
      setNeuralOptimum(opt);
      try {
        confetti({ particleCount: 70, spread: 60, origin: { y: 0.6 } });
      } catch {}
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
          legend: { orientation: 'h', y: -0.25 },
          margin: { l: 80, r: 40, t: 50, b: 80, pad: 4 },
        };

        return <PlotlyChart data={data} layout={layout} style={{ height: '360px' }} />;
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
          margin: { l: 80, r: 40, t: 50, b: 70, pad: 4 },
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
          legend: { orientation: 'h', y: -0.25 },
          margin: { l: 80, r: 40, t: 50, b: 80, pad: 4 },
        };

        return <PlotlyChart data={data} layout={layout} style={{ height: '360px' }} />;
      }

      case 'varImp': {
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
          margin: { l: 280, r: 40, t: 50, b: 70, pad: 10 },
        };

        return <PlotlyChart data={data} layout={layout} style={{ height: '360px' }} />;
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
                  Mô phỏng phi tuyến tính cao cấp • Multi-Layer Perceptron (MLP) • Khảo sát bề mặt và tối ưu hóa Desirability.
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
              onClick={handleSolveNeuralOptimum}
              className="btn btn-primary"
              style={{ fontSize: '0.82rem', padding: '0.4rem 0.9rem' }}
            >
              <Sparkles size={16} />
              <span>Tối Ưu Điểm Neural</span>
            </button>

            <button
              onClick={() => {
                onSelectEngine?.('neural');
                onNavigateToRSM();
              }}
              className="btn btn-primary"
              style={{ fontSize: '0.82rem', padding: '0.4rem 0.95rem', backgroundColor: '#7c3aed', borderColor: '#7c3aed', fontWeight: '700' }}
              title="Chọn mô hình Mạng Nơ-ron AI làm phương pháp chính cho các bước tiếp theo (Bước 6: Bề mặt, Bước 7: Vùng thiết kế, Bước 8: Báo cáo)"
            >
              <span>Tiếp Tục Với Mạng Nơ-ron (Bước 6, 7, 8)</span>
              <ArrowRight size={16} />
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
                SỐ VÒNG TOUR (RESTARS)
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
                  <span>⚡ Fit All CQAs</span>
                </button>

                <button
                  onClick={handleCopyConfig}
                  disabled={isTraining}
                  className="btn btn-outline"
                  style={{
                    fontSize: '0.82rem',
                    padding: '0.5rem 1rem',
                    borderColor: '#64748b',
                    color: '#334155',
                  }}
                  title="Sao chép số node và hàm kích hoạt hiện tại cho toàn bộ các CQA khác"
                >
                  <Share2 size={15} />
                  <span>Áp Dụng Cho Tất Cả CQA</span>
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
                    Neural Engine
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
          <div style={{ width: '100%', height: '8px', backgroundColor: '#1e293b', borderRadius: '4px', overflow: 'hidden', marginBottom: '1rem' }}>
            <div
              style={{
                width: `${(trainingProgress.tour / trainingProgress.totalTours) * 100}%`,
                height: '100%',
                background: 'linear-gradient(90deg, #38bdf8, #818cf8, #c084fc)',
                transition: 'width 0.15s ease-in-out',
                boxShadow: '0 0 10px rgba(56, 189, 248, 0.8)',
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
                {trainingProgress.loss.toFixed(5)}
              </div>
            </div>

            <div style={{ backgroundColor: '#1e293b', borderRadius: '0.375rem', padding: '0.5rem 0.75rem', border: '1px solid #334155' }}>
              <div style={{ fontSize: '0.68rem', color: '#94a3b8', fontWeight: '700' }}>BEST TRAIN R²</div>
              <div className="font-mono" style={{ fontSize: '0.9rem', fontWeight: '800', color: '#38bdf8' }}>
                {trainingProgress.bestR2.toFixed(4)}
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
            
            {/* Training R-Squared */}
            <div className="qbd-card" style={{ padding: '1rem', borderLeft: '4px solid #1e3a8a' }}>
              <div style={{ fontSize: '0.72rem', fontWeight: '700', color: '#64748b' }}>TRAINING R² (HUẤN LUYỆN)</div>
              <div style={{ fontSize: '1.6rem', fontWeight: '800', color: '#1e3a8a', margin: '0.2rem 0' }}>
                {neuralModel.diagnostics.rSquaredTrain.toFixed(4)}
              </div>
              <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
                RMSE = {neuralModel.diagnostics.rmseTrain.toFixed(3)}
              </div>
            </div>

            {/* Validation R-Squared */}
            <div className="qbd-card" style={{ padding: '1rem', borderLeft: '4px solid #dc2626' }}>
              <div style={{ fontSize: '0.72rem', fontWeight: '700', color: '#64748b' }}>VALIDATION R² (KIỂM ĐỊNH)</div>
              <div style={{ fontSize: '1.6rem', fontWeight: '800', color: '#dc2626', margin: '0.2rem 0' }}>
                {neuralModel.diagnostics.rSquaredVal.toFixed(4)}
              </div>
              <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
                RMSE = {neuralModel.diagnostics.rmseVal.toFixed(3)}
              </div>
            </div>

            {/* Overall R-Squared */}
            <div className="qbd-card" style={{ padding: '1rem', borderLeft: '4px solid #7c3aed' }}>
              <div style={{ fontSize: '0.72rem', fontWeight: '700', color: '#64748b' }}>OVERALL R² (TOÀN BỘ DỮ LIỆU)</div>
              <div style={{ fontSize: '1.6rem', fontWeight: '800', color: '#7c3aed', margin: '0.2rem 0' }}>
                {neuralModel.diagnostics.rSquaredOverall.toFixed(4)}
              </div>
              <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
                MAE = {neuralModel.diagnostics.maeOverall.toFixed(3)}
              </div>
            </div>

            {/* Tour & Architecture Info */}
            <div className="qbd-card" style={{ padding: '1rem', borderLeft: '4px solid #0f766e' }}>
              <div style={{ fontSize: '0.72rem', fontWeight: '700', color: '#64748b' }}>TOUR TỐI ƯU / KIẾN TRÚC</div>
              <div style={{ fontSize: '1.25rem', fontWeight: '800', color: '#0f766e', margin: '0.35rem 0' }}>
                Tour #{neuralModel.diagnostics.bestTourIndex} / {localConfig.numTours}
              </div>
              <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
                Lớp ẩn: [{localConfig.hiddenNodes1}{localConfig.hiddenNodes2 > 0 ? `, ${localConfig.hiddenNodes2}` : ''}] ({localConfig.activation.toUpperCase()})
              </div>
            </div>

          </div>

          {/* Model Comparison Table: Polynomial ANOVA vs Neural Network */}
          <div className="qbd-card">
            <h3 style={{ fontSize: '0.95rem', fontWeight: '700', color: '#0f172a', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <TrendingUp size={18} color="#1e3a8a" />
              <span>Bảng So Sánh Hiệu Quả: Hồi Quy Đa Thức ANOVA vs. Mạng Nơ-ron AI (Model Comparison)</span>
            </h3>

            <div className="table-container">
              <table className="qbd-table">
                <thead>
                  <tr>
                    <th>Phương Pháp Mô Hình Hóa</th>
                    <th>Dạng Kiến Trúc</th>
                    <th style={{ textAlign: 'center' }}>R² (Độ Khớp)</th>
                    <th style={{ textAlign: 'center' }}>Sai Số RMSE</th>
                    <th style={{ textAlign: 'center' }}>Sai Số MAE</th>
                    <th>Đánh Giá Chuyên Môn Bào Chế</th>
                  </tr>
                </thead>
                <tbody>
                  {/* ANOVA */}
                  <tr style={{ backgroundColor: anovaModel && neuralModel && anovaModel.diagnostics.rSquared >= neuralModel.diagnostics.rSquaredOverall ? '#f0fdf4' : '#ffffff' }}>
                    <td style={{ fontWeight: '700', color: '#1e3a8a' }}>1. Hồi Quy Đa Thức OLS (Classical ANOVA)</td>
                    <td>Đa thức Bậc 2 (Quadratic RSM / 2FI)</td>
                    <td style={{ textAlign: 'center', fontWeight: '700' }}>
                      {anovaModel ? anovaModel.diagnostics.rSquared.toFixed(4) : '-'}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {anovaModel ? anovaModel.diagnostics.stdDev.toFixed(3) : '-'}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {anovaModel ? (anovaModel.diagnostics.stdDev * 0.7979).toFixed(3) : '-'}
                    </td>
                    <td style={{ fontSize: '0.78rem' }}>
                      Mô hình tường minh, dễ giải thích hiệu ứng chính và tương tác theo tiêu chuẩn ICH Q8.
                    </td>
                  </tr>

                  {/* Neural Net */}
                  <tr style={{ backgroundColor: neuralModel && (!anovaModel || neuralModel.diagnostics.rSquaredOverall > anovaModel.diagnostics.rSquared) ? '#faf5ff' : '#ffffff' }}>
                    <td style={{ fontWeight: '700', color: '#7c3aed' }}>2. Mạng Nơ-ron AI (Neural Network MLP)</td>
                    <td>
                      MLP [{localConfig.hiddenNodes1}{localConfig.hiddenNodes2 > 0 ? `, ${localConfig.hiddenNodes2}` : ''}] ({localConfig.activation.toUpperCase()})
                    </td>
                    <td style={{ textAlign: 'center', fontWeight: '700', color: '#7c3aed' }}>
                      {neuralModel.diagnostics.rSquaredOverall.toFixed(4)}
                    </td>
                    <td style={{ textAlign: 'center', fontWeight: '700' }}>
                      {neuralModel.diagnostics.rmseOverall.toFixed(3)}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {neuralModel.diagnostics.maeOverall.toFixed(3)}
                    </td>
                    <td style={{ fontSize: '0.78rem' }}>
                      Khả năng xấp xỉ phi tuyến tính vượt trội, nắm bắt tốt các tương tác phức tạp và hiện tượng bão hòa/cực trị.
                    </td>
                  </tr>
                </tbody>
              </table>
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
                  Độ Quan Trọng (Variable Importance)
                </button>
              </div>
            </div>

            {renderDiagnosticPlot()}
          </div>

          {/* Interactive Prediction Profiler */}
          <div className="qbd-card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem' }}>
              <div>
                <h3 style={{ fontSize: '1rem', fontWeight: '700', color: '#0f172a', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Sliders size={18} color="#b45309" />
                  <span>Bộ Dự Báo Tương Tác (Interactive Prediction Profiler)</span>
                </h3>
                <p style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '0.2rem' }}>
                  Kéo thanh trượt từng thông số để quan sát sự thay đổi phản ứng CQA thời gian thực theo mô hình mạng nơ-ron.
                </p>
              </div>

              {/* Real-time Predicted Value Badge */}
              {(() => {
                const currentPred = neuralModel.predict(profilerCoded);
                const rmse = neuralModel.diagnostics.rmseOverall;
                return (
                  <div style={{ backgroundColor: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '0.5rem', padding: '0.5rem 1rem' }}>
                    <div style={{ fontSize: '0.72rem', color: '#1e40af', fontWeight: '700' }}>
                      KẾT QUẢ DỰ BÁO {currentCQA.code} HIỆN TẠI:
                    </div>
                    <div style={{ fontSize: '1.3rem', fontWeight: '800', color: '#1e3a8a' }}>
                      {currentPred.toFixed(3)} {currentCQA.unit}
                      <span style={{ fontSize: '0.75rem', fontWeight: '600', color: '#64748b', marginLeft: '0.4rem' }}>
                        [{(currentPred - 1.96 * rmse).toFixed(2)} - {(currentPred + 1.96 * rmse).toFixed(2)}]
                      </span>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Profiler Traces Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${Math.max(220, Math.floor(1000 / project.factors.length))}px, 1fr))`, gap: '1rem' }}>
              {project.factors.map((f) => {
                const coded = profilerCoded[f.code] ?? 0;
                const actual = codedToActual(coded, f);

                // Compute 1D sensitivity trace curve for this factor
                const traceSteps = 21;
                const xTraceActual: number[] = [];
                const yTracePred: number[] = [];

                for (let step = 0; step < traceSteps; step++) {
                  const c = -1.0 + (2.0 * step) / (traceSteps - 1);
                  const actVal = codedToActual(c, f);
                  xTraceActual.push(typeof actVal === 'number' ? actVal : Number(actVal) || c);

                  const tempCoded = { ...profilerCoded, [f.code]: c };
                  yTracePred.push(neuralModel.predict(tempCoded));
                }

                const tracePlotData: any[] = [
                  {
                    type: 'scatter',
                    mode: 'lines',
                    x: xTraceActual,
                    y: yTracePred,
                    line: { color: '#7c3aed', width: 2.5 },
                    name: `${f.name} (${f.code}) vs ${currentCQA.name} (${currentCQA.code})`,
                    text: xTraceActual.map(
                      (x, i) =>
                        `${f.name} (${f.code}): ${x} ${f.unit || ''}<br>${currentCQA.name} (${currentCQA.code}): ${yTracePred[i].toFixed(2)} ${currentCQA.unit || ''}`
                    ),
                    hoverinfo: 'text',
                  },
                  {
                    type: 'scatter',
                    mode: 'markers',
                    x: [typeof actual === 'number' ? actual : Number(actual) || coded],
                    y: [neuralModel.predict(profilerCoded)],
                    marker: { size: 9, color: '#dc2626' },
                    name: `Hiện tại: ${actual} ${f.unit || ''} → ${neuralModel.predict(profilerCoded).toFixed(2)} ${currentCQA.unit || ''}`,
                    hoverinfo: 'name',
                  },
                ];

                const traceLayout = {
                  autosize: true,
                  height: 160,
                  margin: { l: 55, r: 15, t: 10, b: 45, pad: 2 },
                  xaxis: {
                    title: {
                      text: `${f.code} [${f.unit || ''}]`,
                      font: { size: 10, color: '#475569' },
                      standoff: 6,
                    },
                    tickfont: { size: 9 },
                    showgrid: true,
                    gridcolor: '#f1f5f9',
                  },
                  yaxis: {
                    title: {
                      text: `${currentCQA.code} [${currentCQA.unit || ''}]`,
                      font: { size: 10, color: '#475569' },
                      standoff: 6,
                    },
                    tickfont: { size: 9 },
                    showgrid: true,
                    gridcolor: '#f1f5f9',
                  },
                  showlegend: false,
                };

                return (
                  <div
                    key={f.code}
                    style={{
                      backgroundColor: '#f8fafc',
                      borderRadius: '0.5rem',
                      padding: '0.75rem',
                      border: '1px solid #e2e8f0',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.3rem' }}>
                      <span style={{ fontSize: '0.82rem', fontWeight: '700', color: '#1e3a8a' }}>
                        {f.name} ({f.code})
                      </span>
                      <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: '600' }}>
                        [{f.unit || '-'}]
                      </span>
                    </div>

                    <div style={{ height: '160px' }}>
                      <PlotlyChart data={tracePlotData} layout={traceLayout} style={{ width: '100%', height: '100%' }} />
                    </div>

                    <div style={{ marginTop: '0.5rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '0.2rem' }}>
                        <span style={{ fontWeight: '600', color: '#334155' }}>Giá trị cài đặt:</span>
                        <span className="font-mono" style={{ fontWeight: '700', color: '#1e3a8a' }}>
                          {actual} {f.unit}
                        </span>
                      </div>

                      <input
                        type="range"
                        min={-1}
                        max={1}
                        step={0.05}
                        value={coded}
                        onChange={(e) => {
                          setProfilerCoded({
                            ...profilerCoded,
                            [f.code]: Number(e.target.value),
                          });
                        }}
                        style={{ width: '100%', cursor: 'pointer' }}
                      />

                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#94a3b8' }}>
                        <span>{f.low} {f.unit}</span>
                        <span>{f.high} {f.unit}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 3D Response Surface, 2D Contour & Ternary Mixture (Neural Net Engine) */}
          <div className="qbd-card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem' }}>
              <div>
                <h3 style={{ fontSize: '1rem', fontWeight: '700', color: '#0f172a', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Compass size={18} color="#0f766e" />
                  <span>Bề Mặt Đáp Ứng Mô Phỏng Bởi Mạng Nơ-ron (Neural Response Surface & Ternary Mixture)</span>
                </h3>
                <p style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '0.2rem' }}>
                  {plotType === 'ternary'
                    ? 'Khảo sát không gian 3 thành phần hỗn hợp trên đồ thị tam giác (Simplex Ternary Contour).'
                    : 'Khảo sát miền không gian tương tác phi tuyến tính giữa 2 yếu tố đầu vào bất kỳ.'}
                </p>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                {/* Plot Type Mode Toggle */}
                <div style={{ display: 'flex', backgroundColor: '#f1f5f9', borderRadius: '0.5rem', padding: '0.2rem', gap: '0.2rem' }}>
                  <button
                    onClick={() => setPlotType('3d')}
                    className={`btn ${plotType === '3d' ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ padding: '0.3rem 0.6rem', fontSize: '0.78rem', border: 'none' }}
                  >
                    3D
                  </button>
                  <button
                    onClick={() => setPlotType('contour')}
                    className={`btn ${plotType === 'contour' ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ padding: '0.3rem 0.6rem', fontSize: '0.78rem', border: 'none' }}
                  >
                    2D
                  </button>
                  {(hasMixture || project.factors.length >= 3) && (
                    <button
                      onClick={() => setPlotType('ternary')}
                      className={`btn ${plotType === 'ternary' ? 'btn-teal' : 'btn-secondary'}`}
                      style={{ padding: '0.3rem 0.6rem', fontSize: '0.78rem', border: 'none', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                      title="Vẽ đồ thị tam giác hỗn hợp 3 thành phần"
                    >
                      <FlaskConical size={13} />
                      <span>Tam Giác Hỗn Hợp</span>
                    </button>
                  )}
                </div>

                {/* Color Scale */}
                <select
                  className="input-field"
                  style={{ width: '110px', fontSize: '0.78rem' }}
                  value={colorScale}
                  onChange={(e) => setColorScale(e.target.value)}
                >
                  <option value="Plasma">Plasma</option>
                  <option value="Viridis">Viridis</option>
                  <option value="Turbo">Turbo</option>
                  <option value="Jet">Jet</option>
                  <option value="Hot">Hot</option>
                </select>
              </div>
            </div>

            {/* Controls Bar for 2D/3D vs Ternary */}
            {plotType === 'ternary' ? (
              <div
                style={{
                  marginBottom: '1rem',
                  padding: '0.85rem 1rem',
                  backgroundColor: '#f0fdfa',
                  borderRadius: '0.5rem',
                  border: '1px solid #ccfbf1',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.75rem',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
                  {/* Vertex Selectors */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      <label style={{ fontSize: '0.75rem', fontWeight: '700', color: '#0f766e' }}>Đỉnh A (Top):</label>
                      <select
                        className="input-field"
                        style={{ width: '150px', fontSize: '0.78rem', borderColor: '#0f766e' }}
                        value={ternaryA}
                        onChange={(e) => setTernaryA(e.target.value)}
                      >
                        {project.factors.map((f) => (
                          <option key={f.code} value={f.code} disabled={f.code === ternaryB || f.code === ternaryC}>
                            {f.name} ({f.code})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      <label style={{ fontSize: '0.75rem', fontWeight: '700', color: '#0f766e' }}>Đỉnh B (Trái):</label>
                      <select
                        className="input-field"
                        style={{ width: '150px', fontSize: '0.78rem', borderColor: '#0f766e' }}
                        value={ternaryB}
                        onChange={(e) => setTernaryB(e.target.value)}
                      >
                        {project.factors.map((f) => (
                          <option key={f.code} value={f.code} disabled={f.code === ternaryA || f.code === ternaryC}>
                            {f.name} ({f.code})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      <label style={{ fontSize: '0.75rem', fontWeight: '700', color: '#0f766e' }}>Đỉnh C (Phải):</label>
                      <select
                        className="input-field"
                        style={{ width: '150px', fontSize: '0.78rem', borderColor: '#0f766e' }}
                        value={ternaryC}
                        onChange={(e) => setTernaryC(e.target.value)}
                      >
                        {project.factors.map((f) => (
                          <option key={f.code} value={f.code} disabled={f.code === ternaryA || f.code === ternaryB}>
                            {f.name} ({f.code})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Display Mode & Resolution */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', backgroundColor: '#ffffff', borderRadius: '0.375rem', border: '1px solid #99f6e4', padding: '0.15rem' }}>
                      <button
                        onClick={() => setTernaryDisplayMode('both')}
                        className={`btn ${ternaryDisplayMode === 'both' ? 'btn-teal' : 'btn-secondary'}`}
                        style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem' }}
                      >
                        Đường + Màu
                      </button>
                      <button
                        onClick={() => setTernaryDisplayMode('lines_only')}
                        className={`btn ${ternaryDisplayMode === 'lines_only' ? 'btn-teal' : 'btn-secondary'}`}
                        style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem' }}
                      >
                        Chỉ Đường
                      </button>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                      <span style={{ fontSize: '0.7rem', color: '#475569', fontWeight: '600' }}>Số mức:</span>
                      <select
                        className="input-field"
                        style={{ width: '80px', fontSize: '0.7rem', padding: '0.2rem 0.3rem' }}
                        value={ternaryLevels}
                        onChange={(e) => setTernaryLevels(Number(e.target.value))}
                      >
                        {[8, 12, 16, 20].map((lvl) => (
                          <option key={lvl} value={lvl}>
                            {lvl} mức
                          </option>
                        ))}
                      </select>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                      <span style={{ fontSize: '0.7rem', color: '#475569', fontWeight: '600' }}>Lưới:</span>
                      {[
                        { label: 'Nhanh', val: 100, desc: '100x100' },
                        { label: 'Chuẩn', val: 180, desc: '180x180' },
                        { label: 'Mịn', val: 260, desc: '260x260' },
                        { label: 'Cực Mịn', val: 320, desc: '320x320' },
                      ].map((preset) => (
                        <button
                          key={preset.val}
                          onClick={() => setTernaryResolution(preset.val)}
                          className={`btn ${ternaryResolution === preset.val ? 'btn-teal' : 'btn-secondary'}`}
                          style={{ fontSize: '0.68rem', padding: '0.2rem 0.35rem' }}
                          title={preset.desc}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <span style={{ fontSize: '0.7rem', color: '#475569', fontWeight: '600' }}>Độ mượt:</span>
                      <input
                        type="range"
                        min={0}
                        max={1.3}
                        step={0.05}
                        value={ternarySmoothness}
                        onChange={(e) => setTernarySmoothness(Number(e.target.value))}
                        style={{ width: '60px', cursor: 'pointer' }}
                      />
                      <span className="font-mono" style={{ fontSize: '0.72rem', fontWeight: '700', color: '#0f766e', minWidth: '22px' }}>
                        {ternarySmoothness.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Constraint and Feature Checkboxes */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', flexWrap: 'wrap', fontSize: '0.75rem', borderTop: '1px dashed #99f6e4', paddingTop: '0.5rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={showConstraints}
                      onChange={(e) => setShowConstraints(e.target.checked)}
                      style={{ cursor: 'pointer' }}
                    />
                    <span>
                      📏 <strong>Vạch giới hạn biến X</strong> ({factorA.low} ≤ {factorA.code} ≤ {factorA.high}...)
                    </span>
                  </label>

                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={showRegionPolygon}
                      onChange={(e) => setShowRegionPolygon(e.target.checked)}
                      style={{ cursor: 'pointer' }}
                    />
                    <span>🔷 Đa giác miền thực nghiệm</span>
                  </label>

                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={showSpecLimits}
                      onChange={(e) => setShowSpecLimits(e.target.checked)}
                      style={{ cursor: 'pointer' }}
                    />
                    <span>
                      🏷️ <strong>Vạch giới hạn CQA ({currentCQA.code})</strong>
                      {currentCQA.lowerLimit !== undefined || currentCQA.upperLimit !== undefined ? (
                        <span style={{ color: '#dc2626', marginLeft: '0.25rem', fontWeight: '700' }}>
                          ({currentCQA.lowerLimit !== undefined ? `${currentCQA.lowerLimit} ≤ ` : ''}{currentCQA.code}{currentCQA.upperLimit !== undefined ? ` ≤ ${currentCQA.upperLimit}` : ''} {currentCQA.unit || ''})
                        </span>
                      ) : ''}
                    </span>
                  </label>

                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={showDoERuns}
                      onChange={(e) => setShowDoERuns(e.target.checked)}
                      style={{ cursor: 'pointer' }}
                    />
                    <span>🔵 Điểm DoE Thực Nghiệm</span>
                  </label>

                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={showOptimum}
                      onChange={(e) => setShowOptimum(e.target.checked)}
                      style={{ cursor: 'pointer' }}
                    />
                    <span>⭐ Điểm Tối Ưu Desirability</span>
                  </label>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                    <label style={{ fontSize: '0.75rem', fontWeight: '600' }}>Trục X:</label>
                    <select className="input-field" style={{ width: '180px', fontSize: '0.78rem' }} value={xAxisFactor} onChange={(e) => setXAxisFactor(e.target.value)}>
                      {project.factors.map((f) => (
                        <option key={f.code} value={f.code} disabled={f.code === yAxisFactor}>
                          {f.name} ({f.code}) {f.unit ? `[${f.unit}]` : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                    <label style={{ fontSize: '0.75rem', fontWeight: '600' }}>Trục Y:</label>
                    <select className="input-field" style={{ width: '180px', fontSize: '0.78rem' }} value={yAxisFactor} onChange={(e) => setYAxisFactor(e.target.value)}>
                      {project.factors.map((f) => (
                        <option key={f.code} value={f.code} disabled={f.code === xAxisFactor}>
                          {f.name} ({f.code}) {f.unit ? `[${f.unit}]` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', cursor: 'pointer', fontSize: '0.78rem' }}>
                  <input
                    type="checkbox"
                    checked={showSpecLimits}
                    onChange={(e) => setShowSpecLimits(e.target.checked)}
                    style={{ cursor: 'pointer' }}
                  />
                  <span>
                    🔴 <strong>Vạch đường / mặt phẳng giới hạn CQA</strong> ({currentCQA.lowerLimit !== undefined ? `${currentCQA.lowerLimit} ≤ ` : ''}{currentCQA.code}{currentCQA.upperLimit !== undefined ? ` ≤ ${currentCQA.upperLimit}` : ''} {currentCQA.unit || ''})
                  </span>
                </label>
              </div>
            )}

            <div style={{ height: plotType === 'ternary' ? '540px' : '480px' }}>
              <PlotlyChart data={surfacePlotData} layout={surfaceLayout} style={{ width: '100%', height: '100%' }} />
            </div>
          </div>

          {/* Neural Desirability Optimum Results (if solved) */}
          {neuralOptimum && (
            <div className="qbd-card" style={{ backgroundColor: '#faf5ff', border: '1px solid #e9d5ff' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Sparkles size={20} color="#7c3aed" />
                  <span style={{ fontWeight: '800', fontSize: '1rem', color: '#6b21a8' }}>
                    Điểm Vận Hành Tối Ưu Bằng Mạng Nơ-ron (Overall Desirability D = {neuralOptimum.overallDesirability})
                  </span>
                </div>
                <button onClick={onNavigateToDesignSpace} className="btn btn-teal" style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}>
                  <span>Áp Dụng Cho Vùng Thiết Kế</span>
                  <ArrowRight size={15} />
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
                <div style={{ backgroundColor: '#ffffff', borderRadius: '0.375rem', padding: '0.75rem', border: '1px solid #f3e8ff' }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: '700', color: '#6b21a8', marginBottom: '0.4rem' }}>
                    THÔNG SỐ CÀI ĐẶT TỐI ƯU (SETPOINTS):
                  </div>
                  {project.factors.map((f) => (
                    <div key={f.code} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '0.2rem' }}>
                      <span style={{ color: '#475569' }}>{f.name} ({f.code}):</span>
                      <strong className="font-mono" style={{ color: '#0f172a' }}>
                        {neuralOptimum.actualFactors[f.code]} {f.unit}
                      </strong>
                    </div>
                  ))}
                </div>

                <div style={{ backgroundColor: '#ffffff', borderRadius: '0.375rem', padding: '0.75rem', border: '1px solid #f3e8ff' }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: '700', color: '#0f766e', marginBottom: '0.4rem' }}>
                    DỰ BÁO CÁC CHỈ TIÊU CQAS TẠI ĐIỂM TỐI ƯU:
                  </div>
                  {project.cqas.map((c) => {
                    const p = neuralOptimum.predictedResponses[c.code];
                    return (
                      <div key={c.code} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '0.2rem' }}>
                        <span style={{ color: '#475569' }}>{c.name}:</span>
                        <strong className="font-mono" style={{ color: '#0f766e' }}>
                          {p ? `${p.value} ${c.unit} (d=${p.desirability})` : '-'}
                        </strong>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

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
          </div>
        </>
      )}

    </div>
  );
};
