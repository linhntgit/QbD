import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AnalysisProvenance,
  QBDProject,
  ModelType,
  StatisticalModelResult,
  NeuralNetConfig,
  NeuralNetModelResult,
  NeuralTrainingMode,
  ModelingEngine,
  AnalysisSettings,
  DesirabilitySolution,
} from './types/qbd';
import { CASE_STUDIES } from './data/caseStudies';
import { fitModel, optimizeDesirability, runMonteCarloSimulation } from './services/statistics';
import { fitNeuralNetModel, fitMultiOutputNeuralNet, DEFAULT_NEURAL_CONFIG } from './services/neuralNetwork';
import { getReportReadiness, loadPersistedProject, persistProject, recordProjectVersion, validateProjectTemplate } from './services/projectGovernance';
import { stableSeedFromText } from './services/random';
import { Navbar } from './components/Navbar';
import { TabNavigation, type TabKey } from './components/TabNavigation';
import { trackTabChange, trackProjectAction, trackModelAction } from './services/analytics';

const QTPPTab = lazy(() => import('./components/tabs/QTPPTab').then((module) => ({ default: module.QTPPTab })));
const FMEATab = lazy(() => import('./components/tabs/FMEATab').then((module) => ({ default: module.FMEATab })));
const DoEDesignerTab = lazy(() => import('./components/tabs/DoEDesignerTab').then((module) => ({ default: module.DoEDesignerTab })));
const StatisticalANOVATab = lazy(() => import('./components/tabs/StatisticalANOVATab').then((module) => ({ default: module.StatisticalANOVATab })));
const NeuralNetworkTab = lazy(() => import('./components/tabs/NeuralNetworkTab').then((module) => ({ default: module.NeuralNetworkTab })));
const ResponseSurfaceTab = lazy(() => import('./components/tabs/ResponseSurfaceTab').then((module) => ({ default: module.ResponseSurfaceTab })));
const DesignSpaceTab = lazy(() => import('./components/tabs/DesignSpaceTab').then((module) => ({ default: module.DesignSpaceTab })));
const ReportTab = lazy(() => import('./components/tabs/ReportTab').then((module) => ({ default: module.ReportTab })));

const createAnalysisProvenance = (projectId: string): AnalysisProvenance => ({
  optimizerSeed: stableSeedFromText(projectId, 'optimizer'),
  monteCarloSeed: stableSeedFromText(projectId, 'monte-carlo'),
  demoDataSeed: stableSeedFromText(projectId, 'demo-data'),
  monteCarloVariabilityPercent: 2,
  monteCarloSimulations: 10_000,
});

const createAnalysisSettings = (project?: QBDProject): AnalysisSettings => ({
  modelingEngine: project?.analysisSettings?.modelingEngine ?? project?.modelingEngine ?? 'polynomial',
  modelTypes: project?.analysisSettings?.modelTypes ?? {},
  neuralTrainingMode: project?.analysisSettings?.neuralTrainingMode ?? 'independent',
  sharedNeuralConfig: project?.analysisSettings?.sharedNeuralConfig ?? { ...DEFAULT_NEURAL_CONFIG },
  neuralConfigs: project?.analysisSettings?.neuralConfigs ?? {},
  appliedOptimum: project?.analysisSettings?.appliedOptimum,
});

const normalizeProjectAnalysis = (source: QBDProject): QBDProject => ({
  ...source,
  analysisProvenance: source.analysisProvenance ?? createAnalysisProvenance(source.id),
  analysisSettings: createAnalysisSettings(source),
});

export function App() {
  // Default project: Case Study 1 (Metoprolol Tablet BBD)
  const [project, setProject] = useState<QBDProject>(() => normalizeProjectAnalysis(loadPersistedProject() || CASE_STUDIES[0]));
  const [activeTab, setActiveTab] = useState<TabKey>('qtpp');
  const [selectedCQA, setSelectedCQA] = useState<string>(() => project.cqas[0]?.code || 'Y1');
  const [modelTypes, setModelTypes] = useState<Record<string, ModelType>>(() => project.analysisSettings?.modelTypes ?? {});
  const [neuralTrainingMode, setNeuralTrainingMode] = useState<NeuralTrainingMode>(() => project.analysisSettings?.neuralTrainingMode ?? 'independent');
  const [sharedNeuralConfig, setSharedNeuralConfig] = useState<NeuralNetConfig>(() => project.analysisSettings?.sharedNeuralConfig ?? { ...DEFAULT_NEURAL_CONFIG });
  const [neuralConfigs, setNeuralConfigs] = useState<Record<string, NeuralNetConfig>>(() => project.analysisSettings?.neuralConfigs ?? {});
  // Neural fitting is computationally expensive.  It is intentionally
  // triggered only by an explicit Train action, never by editing/filling DoE
  // data in the normal UI flow.
  const [neuralTrainingVersion, setNeuralTrainingVersion] = useState(0);
  const [modelingEngine, setModelingEngine] = useState<ModelingEngine>(() => project.analysisSettings?.modelingEngine ?? 'polynomial');
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const hasPersistedInitialProject = useRef(false);
  const pendingAuditAction = useRef('Khởi tạo project');
  const lastSnapshot = useRef({ action: '', timestamp: 0 });

  const analysisProvenance = project.analysisProvenance ?? createAnalysisProvenance(project.id);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const persisted = persistProject(project);
      setStorageWarning(persisted ? null : 'Autosave trình duyệt đã thất bại hoặc hết dung lượng. Hãy dùng nút Lưu để xuất JSON ngay.');
      const now = Date.now();
      const action = pendingAuditAction.current;
      const shouldCheckpoint = hasPersistedInitialProject.current &&
        (action !== lastSnapshot.current.action || now - lastSnapshot.current.timestamp >= 30_000);
      if (shouldCheckpoint && recordProjectVersion(project, action)) {
        lastSnapshot.current = { action, timestamp: now };
      }
      hasPersistedInitialProject.current = true;
    }, 500);
    return () => window.clearTimeout(timer);
  }, [project]);

  useEffect(() => {
    trackTabChange(activeTab);
  }, [activeTab]);

  // Calculate ANOVA Models dynamically for all CQAs
  const models = useMemo<Record<string, StatisticalModelResult>>(() => {
    const result: Record<string, StatisticalModelResult> = {};
    project.cqas.forEach((cqa) => {
      const type = modelTypes[cqa.code] || 'Quadratic';
      const m = fitModel(cqa, project.factors, project.runs, type);
      if (m) {
        result[cqa.code] = m;
      }
    });
    return result;
  }, [project.cqas, project.factors, project.runs, modelTypes]);

  // Calculate Neural Network Models dynamically for all CQAs (Unified Multi-Output or Independent Per-CQA)
  const neuralModels = useMemo<Record<string, NeuralNetModelResult>>(() => {
    if (neuralTrainingVersion === 0) return {};
    if (neuralTrainingMode === 'shared') {
      return fitMultiOutputNeuralNet(project.cqas, project.factors, project.runs, sharedNeuralConfig);
    }
    const result: Record<string, NeuralNetModelResult> = {};
    project.cqas.forEach((cqa) => {
      const cfg = neuralConfigs[cqa.code] || DEFAULT_NEURAL_CONFIG;
      const nm = fitNeuralNetModel(cqa, project.factors, project.runs, cfg);
      if (nm) {
        result[cqa.code] = nm;
      }
    });
    return result;
  }, [neuralTrainingVersion, project.cqas, project.factors, project.runs, neuralTrainingMode, sharedNeuralConfig, neuralConfigs]);

  // Active Models based on selected Modeling Engine (Polynomial or Neural)
  const activeModels = useMemo<Record<string, StatisticalModelResult | NeuralNetModelResult>>(() => {
    return modelingEngine === 'neural' ? neuralModels : models;
  }, [modelingEngine, models, neuralModels]);

  // Handle Training Shared Neural Network model (fits all CQAs at once)
  const handleTrainSharedNeuralModel = (config: NeuralNetConfig) => {
    trackModelAction('neural', 'train_shared', {
      hidden_nodes_1: config.hiddenNodes1,
      hidden_nodes_2: config.hiddenNodes2,
      max_epochs: config.maxEpochs,
    });
    const next = { ...config, seed: config.seed };
    setSharedNeuralConfig(next);
    setNeuralTrainingVersion((version) => version + 1);
    persistAnalysisSettings({ sharedNeuralConfig: next, appliedOptimum: undefined });
  };

  // Handle Training specific Independent Neural Network model with custom hyperparameters
  const handleTrainIndependentNeuralModel = (cqaCode: string, config: NeuralNetConfig) => {
    trackModelAction('neural', 'train_independent', { cqa: cqaCode });
    const next = { ...neuralConfigs, [cqaCode]: { ...config, seed: config.seed } };
    setNeuralConfigs(next);
    setNeuralTrainingVersion((version) => version + 1);
    persistAnalysisSettings({ neuralConfigs: next, appliedOptimum: undefined });
  };

  // Handle Batch Training all Independent Neural Network models
  const handleTrainAllIndependentNeuralModels = () => {
    trackModelAction('neural', 'train_all_independent');
    const next: Record<string, NeuralNetConfig> = {};
    project.cqas.forEach((cqa) => {
      const existing = neuralConfigs[cqa.code] || DEFAULT_NEURAL_CONFIG;
      next[cqa.code] = { ...existing, seed: existing.seed };
    });
    setNeuralConfigs(next);
    setNeuralTrainingVersion((version) => version + 1);
    persistAnalysisSettings({ neuralConfigs: next, appliedOptimum: undefined });
  };

  // Handle Copying config to all CQAs
  const handleCopyNeuralConfigToAll = (sourceConfig: NeuralNetConfig) => {
    const next: Record<string, NeuralNetConfig> = {};
    project.cqas.forEach((cqa) => {
      next[cqa.code] = { ...sourceConfig, seed: sourceConfig.seed };
    });
    setNeuralConfigs(next);
    persistAnalysisSettings({ neuralConfigs: next, appliedOptimum: undefined });
  };

  // Calculate Desirability Optimum dynamically from active modeling engine
  const calculatedOptimum = useMemo(() => {
    return optimizeDesirability(project.factors, project.cqas, activeModels, undefined, analysisProvenance.optimizerSeed);
  }, [project.factors, project.cqas, activeModels, analysisProvenance.optimizerSeed]);
  const optimum = project.analysisSettings?.appliedOptimum ?? calculatedOptimum;

  // Calculate Monte Carlo Simulation from active modeling engine
  const monteCarlo = useMemo(() => {
    if (!optimum) return null;
    return runMonteCarloSimulation(
      optimum.actualFactors,
      project.factors,
      project.cqas,
      activeModels,
      analysisProvenance.monteCarloVariabilityPercent,
      analysisProvenance.monteCarloSimulations,
      analysisProvenance.monteCarloSeed,
    );
  }, [optimum, project.factors, project.cqas, activeModels, analysisProvenance]);
  const reportReadiness = useMemo(
    () => getReportReadiness(project, activeModels, optimum, monteCarlo),
    [project, activeModels, optimum, monteCarlo],
  );

  // Update Project Handler
  const handleUpdateProject = (updated: Partial<QBDProject>) => {
    pendingAuditAction.current = `Cập nhật: ${Object.keys(updated).join(', ')}`;
    const invalidatesModel = Boolean(updated.factors || updated.cqas || updated.runs);
    if (invalidatesModel) setNeuralTrainingVersion(0);
    setProject((prev) => {
      const analysisSettings = invalidatesModel
        ? { ...createAnalysisSettings(prev), appliedOptimum: undefined }
        : prev.analysisSettings;
      return {
        ...prev,
        ...updated,
        analysisSettings,
        updatedDate: new Date().toISOString().slice(0, 10),
      };
    });
  };

  function persistAnalysisSettings(updated: Partial<AnalysisSettings>) {
    pendingAuditAction.current = `Cập nhật cấu hình phân tích: ${Object.keys(updated).join(', ')}`;
    setProject((previous) => ({
      ...previous,
      modelingEngine: updated.modelingEngine ?? previous.modelingEngine,
      analysisSettings: { ...createAnalysisSettings(previous), ...updated },
      updatedDate: new Date().toISOString().slice(0, 10),
    }));
  }

  const handleModelingEngineChange = (engine: ModelingEngine) => {
    trackModelAction(engine, 'switch_engine');
    setModelingEngine(engine);
    persistAnalysisSettings({ modelingEngine: engine, appliedOptimum: undefined });
  };

  const handleModelTypeChange = (code: string, type: ModelType) => {
    const next = { ...modelTypes, [code]: type };
    setModelTypes(next);
    persistAnalysisSettings({ modelTypes: next, appliedOptimum: undefined });
  };

  const handleNeuralTrainingModeChange = (mode: NeuralTrainingMode) => {
    setNeuralTrainingMode(mode);
    persistAnalysisSettings({ neuralTrainingMode: mode, appliedOptimum: undefined });
  };

  const handleApplyOptimum = (solution: DesirabilitySolution) => {
    persistAnalysisSettings({ appliedOptimum: solution });
  };

  const handleMonteCarloConfigChange = (variabilityPercent: number, simulations: number) => {
    setProject((previous) => ({
      ...previous,
      analysisProvenance: {
        ...(previous.analysisProvenance ?? createAnalysisProvenance(previous.id)),
        monteCarloVariabilityPercent: variabilityPercent,
        monteCarloSimulations: simulations,
      },
      updatedDate: new Date().toISOString().slice(0, 10),
    }));
  };

  // Load Case Study / Project
  const handleLoadProject = (newProj: QBDProject) => {
    const validation = validateProjectTemplate(newProj);
    if (!validation.valid) {
      window.alert(`Không thể tải project vì template không hợp lệ:\n${validation.errors.join('\n')}`);
      return;
    }
    trackProjectAction('load', { project_name: newProj.name, molecule: newProj.moleculeName });
    pendingAuditAction.current = 'Tải project/case study';
    const normalized = normalizeProjectAnalysis(newProj);
    setProject(normalized);
    setModelTypes(normalized.analysisSettings?.modelTypes ?? {});
    setNeuralTrainingMode(normalized.analysisSettings?.neuralTrainingMode ?? 'independent');
    setSharedNeuralConfig(normalized.analysisSettings?.sharedNeuralConfig ?? { ...DEFAULT_NEURAL_CONFIG });
    setNeuralConfigs(normalized.analysisSettings?.neuralConfigs ?? {});
    setNeuralTrainingVersion(0);
    setModelingEngine(normalized.analysisSettings?.modelingEngine ?? 'polynomial');
    if (newProj.cqas.length > 0) {
      setSelectedCQA(newProj.cqas[0].code);
    }
  };

  // New Blank Project
  const handleNewProject = () => {
    const blankProject: QBDProject = {
      id: `project-${Date.now()}`,
      name: 'Dự án Phát triển Bào chế Mới (QbD Project)',
      moleculeName: 'Hoạt chất mới (New Chemical Entity)',
      dosageForm: 'Viên nén bao phim',
      author: 'Tran Linh Nguyen',
      version: '1.0.0',
      createdDate: new Date().toISOString().slice(0, 10),
      updatedDate: new Date().toISOString().slice(0, 10),
      description: 'Thiết kế thí nghiệm và tối ưu hóa quy trình bào chế theo ICH Q8.',
      qtpp: [
        {
          id: 'qtpp-new-1',
          element: 'Hàm lượng & Hoạt lực',
          target: '95.0% - 105.0%',
          justification: 'Yêu cầu dược điển USP/Ph. Eur.',
        },
      ],
      cqas: [
        {
          id: 'cqa-new-1',
          name: 'Độ hòa tan (%)',
          code: 'Y1',
          unit: '%',
          target: 85.0,
          lowerLimit: 75.0,
          upperLimit: 100.0,
          objective: 'target',
          weight: 5,
        },
      ],
      factors: [
        {
          id: 'fac-new-1',
          name: 'Nồng độ Tá dược (X1)',
          code: 'X1',
          type: 'CMA',
          dataType: 'quantitative',
          controllability: 'controllable',
          unit: '%',
          low: 10.0,
          high: 30.0,
          center: 20.0,
        },
        {
          id: 'fac-new-2',
          name: 'Lực dập viên (X2)',
          code: 'X2',
          type: 'CPP',
          dataType: 'quantitative',
          controllability: 'controllable',
          unit: 'kN',
          low: 5.0,
          high: 15.0,
          center: 10.0,
        },
      ],
      fmeaRisks: [],
      doeConfig: {
        category: 'RSM',
        designType: 'CCD_FaceCentered',
        centerPoints: 3,
        replicates: 1,
        randomized: true,
      },
      runs: [],
      designSpace: [],
    };

    trackProjectAction('new');
    pendingAuditAction.current = 'Tạo project mới';
    const normalized = normalizeProjectAnalysis(blankProject);
    setProject(normalized);
    setModelTypes({});
    setNeuralTrainingMode('independent');
    setSharedNeuralConfig({ ...DEFAULT_NEURAL_CONFIG });
    setNeuralConfigs({});
    setNeuralTrainingVersion(0);
    setModelingEngine('polynomial');
    setSelectedCQA('Y1');
    setActiveTab('qtpp');
  };

  const handleRestoreProject = (snapshot: QBDProject) => {
    pendingAuditAction.current = 'Khôi phục snapshot lịch sử';
    const normalized = normalizeProjectAnalysis(snapshot);
    setProject(normalized);
    setModelTypes(normalized.analysisSettings?.modelTypes ?? {});
    setNeuralTrainingMode(normalized.analysisSettings?.neuralTrainingMode ?? 'independent');
    setSharedNeuralConfig(normalized.analysisSettings?.sharedNeuralConfig ?? { ...DEFAULT_NEURAL_CONFIG });
    setNeuralConfigs(normalized.analysisSettings?.neuralConfigs ?? {});
    setNeuralTrainingVersion(0);
    setModelingEngine(normalized.analysisSettings?.modelingEngine ?? 'polynomial');
    setSelectedCQA(snapshot.cqas[0]?.code || 'Y1');
  };

  // Save Project JSON
  const handleSaveJSON = () => {
    trackProjectAction('save_json', { project_name: project.name, molecule: project.moleculeName });
    const jsonStr = JSON.stringify(project, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `QbD_Project_${project.moleculeName.replace(/\s+/g, '_')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Export Word Report
  const handleExportWord = async () => {
    if (!reportReadiness.readyForScientificReport) {
      window.alert(`Chưa thể xuất báo cáo khoa học cuối cùng.\n${[...reportReadiness.errors, ...reportReadiness.warnings].slice(0, 8).join('\n')}`);
      return;
    }
    trackProjectAction('export_word', { project_name: project.name, engine: modelingEngine });
    const { exportQBDWordReport } = await import('./services/reportGenerator');
    exportQBDWordReport(project, models, optimum, monteCarlo, neuralModels, modelingEngine);
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: '#f8fafc' }}>
      {/* Top Navbar */}
      <Navbar
        project={project}
        activeTab={activeTab}
        modelingEngine={modelingEngine}
        onToggleEngine={handleModelingEngineChange}
        onNavigateToTab={setActiveTab}
        onLoadProject={handleLoadProject}
        onExportWord={handleExportWord}
        onSaveJSON={handleSaveJSON}
        onNewProject={handleNewProject}
        canExportWord={reportReadiness.readyForScientificReport}
      />

      {/* QbD Workflow Step Navigation */}
      <TabNavigation activeTab={activeTab} onTabChange={setActiveTab} />

      {/* Main Tab Content */}
      <main style={{ flex: 1, maxWidth: '1440px', width: '100%', margin: '0 auto', padding: '1.5rem 1.25rem' }}>
        {storageWarning && <div className="qbd-card" role="alert" style={{ borderLeft: '4px solid #d97706', color: '#92400e', marginBottom: '1rem' }}>{storageWarning}</div>}
        <Suspense fallback={<div className="qbd-card" role="status" aria-live="polite">Đang tải mô-đun phân tích…</div>}>
        {activeTab === 'qtpp' && (
          <QTPPTab project={project} onUpdateProject={handleUpdateProject} />
        )}

        {activeTab === 'fmea' && (
          <FMEATab
            project={project}
            onUpdateProject={handleUpdateProject}
            onNavigateToDoE={() => setActiveTab('doe')}
          />
        )}

        {activeTab === 'doe' && (
          <DoEDesignerTab
            project={project}
            onUpdateProject={handleUpdateProject}
            onNavigateToANOVA={() => setActiveTab('anova')}
          />
        )}

        {activeTab === 'anova' && (
          <StatisticalANOVATab
            project={project}
            models={models}
            neuralModels={neuralModels}
            selectedCQA={selectedCQA}
            onSelectCQA={setSelectedCQA}
            modelTypes={modelTypes}
            onModelTypeChange={handleModelTypeChange}
            modelingEngine={modelingEngine}
            onSelectEngine={handleModelingEngineChange}
            onNavigateToRSM={() => setActiveTab('rsm')}
            onNavigateToNeural={() => setActiveTab('neural')}
          />
        )}

        {activeTab === 'neural' && (
          <NeuralNetworkTab
            project={project}
            models={models}
            neuralModels={neuralModels}
            neuralTrainingMode={neuralTrainingMode}
            onSetNeuralTrainingMode={handleNeuralTrainingModeChange}
            sharedNeuralConfig={sharedNeuralConfig}
            onTrainSharedModel={handleTrainSharedNeuralModel}
            neuralConfigs={neuralConfigs}
            onTrainIndependentModel={handleTrainIndependentNeuralModel}
            onTrainAllIndependentModels={handleTrainAllIndependentNeuralModels}
            onCopyConfigToAll={handleCopyNeuralConfigToAll}
            selectedCQA={selectedCQA}
            onSelectCQA={setSelectedCQA}
            modelingEngine={modelingEngine}
            onSelectEngine={handleModelingEngineChange}
            onNavigateToRSM={() => setActiveTab('rsm')}
            onNavigateToDesignSpace={() => setActiveTab('design_space')}
          />
        )}

        {activeTab === 'rsm' && (
          <ResponseSurfaceTab
            project={project}
            models={activeModels}
            selectedCQA={selectedCQA}
            onSelectCQA={setSelectedCQA}
            modelingEngine={modelingEngine}
            onToggleEngine={handleModelingEngineChange}
            onNavigateToDesignSpace={() => setActiveTab('design_space')}
          />
        )}

        {activeTab === 'design_space' && (
          <DesignSpaceTab
            project={project}
            models={activeModels}
            modelingEngine={modelingEngine}
            onToggleEngine={handleModelingEngineChange}
            optimum={optimum}
            monteCarlo={monteCarlo}
            monteCarloVariabilityPercent={analysisProvenance.monteCarloVariabilityPercent}
            monteCarloSimulations={analysisProvenance.monteCarloSimulations}
            monteCarloSeed={analysisProvenance.monteCarloSeed}
            optimizerSeed={analysisProvenance.optimizerSeed}
            onApplyOptimum={handleApplyOptimum}
            onMonteCarloConfigChange={handleMonteCarloConfigChange}
            onUpdateProject={handleUpdateProject}
            onNavigateToReport={() => setActiveTab('report')}
          />
        )}

        {activeTab === 'report' && (
          <ReportTab
            project={project}
            models={models}
            optimum={optimum}
            monteCarlo={monteCarlo}
            neuralModels={neuralModels}
            modelingEngine={modelingEngine}
            onToggleEngine={handleModelingEngineChange}
            onRestoreSnapshot={handleRestoreProject}
          />
        )}
        </Suspense>
      </main>

      {/* Scientific Footer */}
      <footer style={{ borderTop: '1px solid #e2e8f0', backgroundColor: '#ffffff', padding: '1rem', marginTop: 'auto', textAlign: 'center', fontSize: '0.78rem', color: '#64748b' }}>
        <div style={{ maxWidth: '1440px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div>
            <strong>QbD Studio™ Pharma DoE Suite</strong> — © 2026 <strong>Tran Linh Nguyen</strong>. All rights reserved.
          </div>
          <div>
            Tuân thủ chuẩn mực ICH Q8(R2), ICH Q9, ICH Q10, ICH Q11 • Nền tảng DoE & Prediction Profiler.
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
