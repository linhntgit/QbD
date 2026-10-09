import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
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
  MonteCarloResult,
} from './types/qbd';
import { CASE_STUDIES } from './data/caseStudies';
import { fitModel, optimizeDesirability } from './services/statistics';
import { recodeRuns } from './services/doeGenerator';
import { fitNeuralNetModel, fitMultiOutputNeuralNet, DEFAULT_NEURAL_CONFIG, getNeuralArtifactFingerprint, hydrateNeuralModels, serializeNeuralModels } from './services/neuralNetwork';
import { loadPersistedProject, persistProject, recordProjectVersion, validateProjectTemplate } from './services/projectGovernance';
import { idbSaveProject, migrateLocalStorageToIndexedDB } from './services/storage';
import { stableSeedFromText } from './services/random';
import { projectFileName } from './services/projectFileName';
import { Navbar } from './components/Navbar';
import { TabNavigation, type TabKey } from './components/TabNavigation';
import { ComponentErrorBoundary } from './components/ComponentErrorBoundary';
import { trackTabChange, trackProjectAction, trackModelAction } from './services/analytics';
import { getAuditUserFromSession } from './services/sessionService';
import { ConsentBanner } from './components/ConsentBanner';

const HelpDrawer = lazy(() => import('./components/HelpDrawer').then((module) => ({ default: module.HelpDrawer })));

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
  neuralArtifacts: project?.analysisSettings?.neuralArtifacts,
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
  const [isTabPending, startTabTransition] = useTransition();

  const handleTabChange = useCallback((nextTab: TabKey) => {
    startTabTransition(() => {
      setActiveTab(nextTab);
    });
  }, []);
  const [selectedCQA, setSelectedCQA] = useState<string>(() => project.cqas[0]?.code || 'Y1');
  const [modelTypes, setModelTypes] = useState<Record<string, ModelType>>(() => project.analysisSettings?.modelTypes ?? {});
  const [neuralTrainingMode, setNeuralTrainingMode] = useState<NeuralTrainingMode>(() => project.analysisSettings?.neuralTrainingMode ?? 'independent');
  const [sharedNeuralConfig, setSharedNeuralConfig] = useState<NeuralNetConfig>(() => project.analysisSettings?.sharedNeuralConfig ?? { ...DEFAULT_NEURAL_CONFIG });
  const [neuralConfigs, setNeuralConfigs] = useState<Record<string, NeuralNetConfig>>(() => project.analysisSettings?.neuralConfigs ?? {});
  const [restoredNeuralModels, setRestoredNeuralModels] = useState<Record<string, NeuralNetModelResult>>(() => {
    const artifact = project.analysisSettings?.neuralArtifacts;
    return artifact?.version === 1 && artifact.fingerprint === getNeuralArtifactFingerprint(project.factors, project.cqas, project.runs)
      ? hydrateNeuralModels(artifact.models, project.factors, project.runs)
      : {};
  });
  // Neural fitting is computationally expensive.  It is intentionally
  // triggered only by an explicit Train action, never by editing/filling DoE
  // data in the normal UI flow.
  const [neuralTrainingVersion, setNeuralTrainingVersion] = useState(0);
  const [modelingEngine, setModelingEngine] = useState<ModelingEngine>(() => project.analysisSettings?.modelingEngine ?? 'polynomial');
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [isHelpPinned, setIsHelpPinned] = useState(true);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const hasPersistedInitialProject = useRef(false);
  const pendingAuditAction = useRef('Khởi tạo project');
  const lastSnapshot = useRef({ action: '', timestamp: 0 });

  const analysisProvenance = project.analysisProvenance ?? createAnalysisProvenance(project.id);

  useEffect(() => {
    if (!project.cqas.some((cqa) => cqa.code === selectedCQA)) {
      setSelectedCQA(project.cqas[0]?.code ?? '');
    }
  }, [project.cqas, selectedCQA]);

  // Global keyboard shortcut: Press ? or F1 to toggle Help Drawer
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        (e.key === '?' || e.key === 'F1') &&
        !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)
      ) {
        e.preventDefault();
        setIsHelpOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    migrateLocalStorageToIndexedDB().catch(() => {});
  }, []);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      const persisted = persistProject(project);
      idbSaveProject(project)
        .then((idbSaved) => {
          if (active) setStorageWarning(persisted || idbSaved ? null : 'Autosave trình duyệt đã thất bại hoặc hết dung lượng. Hãy dùng nút Lưu để xuất JSON ngay.');
        })
        .catch(() => {
          if (active && !persisted) setStorageWarning('Autosave trình duyệt đã thất bại hoặc hết dung lượng. Hãy dùng nút Lưu để xuất JSON ngay.');
        });
      const now = Date.now();
      const action = pendingAuditAction.current;
      const shouldCheckpoint = hasPersistedInitialProject.current &&
        (action !== lastSnapshot.current.action || now - lastSnapshot.current.timestamp >= 300_000);
      const auditUser = getAuditUserFromSession();
      if (shouldCheckpoint && recordProjectVersion(project, action, auditUser)) {
        lastSnapshot.current = { action, timestamp: now };
      }
      hasPersistedInitialProject.current = true;
    }, 500);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
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
    if (neuralTrainingVersion === 0) return restoredNeuralModels;
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
  }, [neuralTrainingVersion, project.cqas, project.factors, project.runs, neuralTrainingMode, sharedNeuralConfig, neuralConfigs, restoredNeuralModels]);

  useEffect(() => {
    if (neuralTrainingVersion === 0 || Object.keys(neuralModels).length === 0) return;
    const artifact = { version: 1 as const, fingerprint: getNeuralArtifactFingerprint(project.factors, project.cqas, project.runs), models: serializeNeuralModels(neuralModels) };
    setProject((previous) => ({ ...previous, analysisSettings: { ...createAnalysisSettings(previous), neuralArtifacts: artifact } }));
  }, [neuralTrainingVersion, neuralModels, project.factors, project.cqas, project.runs]);

  // Active Models based on selected Modeling Engine (Polynomial or Neural)
  const activeModels = useMemo<Record<string, StatisticalModelResult | NeuralNetModelResult>>(() => {
    return modelingEngine === 'neural' ? neuralModels : models;
  }, [modelingEngine, models, neuralModels]);

  const hasTrainedNeuralModels = useMemo(() => {
    return Object.values(neuralModels).some(
      (m) => Boolean(m?.diagnostics && Number.isFinite(m.diagnostics.rSquaredTrain))
    );
  }, [neuralModels]);

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
    setNeuralTrainingVersion(0);
    setRestoredNeuralModels({});
    const next: Record<string, NeuralNetConfig> = {};
    project.cqas.forEach((cqa) => {
      next[cqa.code] = { ...sourceConfig, seed: sourceConfig.seed };
    });
    setNeuralConfigs(next);
    persistAnalysisSettings({ neuralConfigs: next, appliedOptimum: undefined, neuralArtifacts: undefined });
  };

  const needsOptimum = activeTab === 'design_space' || activeTab === 'report';

  // Calculate Desirability Optimum lazily and debounced from active modeling engine
  const [calculatedOptimum, setCalculatedOptimum] = useState<DesirabilitySolution | null>(() => {
    return project.analysisSettings?.appliedOptimum ?? null;
  });

  useEffect(() => {
    if (project.analysisSettings?.appliedOptimum) {
      setCalculatedOptimum(project.analysisSettings.appliedOptimum);
      return;
    }
    if (!needsOptimum) return;

    const timer = window.setTimeout(() => {
      const opt = optimizeDesirability(
        project.factors,
        project.cqas,
        activeModels,
        undefined,
        analysisProvenance.optimizerSeed
      );
      setCalculatedOptimum(opt);
    }, 200);

    return () => window.clearTimeout(timer);
  }, [
    needsOptimum,
    project.analysisSettings?.appliedOptimum,
    project.factors,
    project.cqas,
    activeModels,
    analysisProvenance.optimizerSeed,
  ]);

  const optimum = project.analysisSettings?.appliedOptimum ?? calculatedOptimum;

  // Monte Carlo is intentionally explicit: changing project fields or models
  // invalidates the previous result instead of synchronously rerunning a large
  // simulation on every keystroke.
  const [monteCarlo, setMonteCarlo] = useState<MonteCarloResult | null>(null);
  useEffect(() => {
    setMonteCarlo(null);
  }, [optimum, project.factors, project.cqas, activeModels, analysisProvenance.monteCarloSeed,
    analysisProvenance.monteCarloVariabilityPercent, analysisProvenance.monteCarloSimulations]);
  // Update Project Handler
  const handleUpdateProject = (updated: Partial<QBDProject>) => {
    // Local approval lock: require a recorded unlock action before edits.
    if (project.isLocked && updated.isLocked !== false && !('isLocked' in updated)) {
      window.alert('Hồ sơ đã được phê duyệt nội bộ và đang khóa trong ứng dụng. Cần mở khóa và ghi nhận lý do trước khi chỉnh sửa; đây không phải cơ chế khóa đã thẩm định GxP.');
      return;
    }
    pendingAuditAction.current = `Cập nhật: ${Object.keys(updated).join(', ')}`;
    const invalidatesModel = Boolean(updated.factors || updated.cqas || updated.runs);
    if (invalidatesModel) {
      setNeuralTrainingVersion(0);
      setRestoredNeuralModels({});
    }
    setProject((prev) => {
      let nextRuns = updated.runs ?? prev.runs;
      if (updated.factors && !updated.runs && prev.runs.length > 0) {
        nextRuns = recodeRuns(updated.factors, prev.runs);
      }
      const analysisSettings = invalidatesModel
        ? { ...createAnalysisSettings(prev), appliedOptimum: undefined, neuralArtifacts: undefined }
        : prev.analysisSettings;
      return {
        ...prev,
        ...updated,
        runs: nextRuns,
        analysisSettings,
        updatedDate: new Date().toISOString().slice(0, 10),
      };
    });
  };

  function persistAnalysisSettings(updated: Partial<AnalysisSettings>) {
    if (project.isLocked) {
      return;
    }
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

  const handleApplyModelTypeToAll = (type: ModelType) => {
    const next = Object.fromEntries(project.cqas.map((cqa) => [cqa.code, type])) as Record<string, ModelType>;
    setModelTypes(next);
    persistAnalysisSettings({ modelTypes: next, appliedOptimum: undefined });
  };

  const handleNeuralTrainingModeChange = (mode: NeuralTrainingMode) => {
    setNeuralTrainingVersion(0);
    setRestoredNeuralModels({});
    setNeuralTrainingMode(mode);
    persistAnalysisSettings({ neuralTrainingMode: mode, appliedOptimum: undefined, neuralArtifacts: undefined });
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

  const hydrateProjectState = useCallback((targetProject: QBDProject, options?: { warnANN?: boolean; defaultTab?: TabKey }) => {
    const normalized = normalizeProjectAnalysis(targetProject);
    setProject(normalized);
    setModelTypes(normalized.analysisSettings?.modelTypes ?? {});
    setNeuralTrainingMode(normalized.analysisSettings?.neuralTrainingMode ?? 'independent');
    setSharedNeuralConfig(normalized.analysisSettings?.sharedNeuralConfig ?? { ...DEFAULT_NEURAL_CONFIG });
    setNeuralConfigs(normalized.analysisSettings?.neuralConfigs ?? {});
    const artifact = normalized.analysisSettings?.neuralArtifacts;
    const canRestoreANN = artifact?.version === 1 && artifact.fingerprint === getNeuralArtifactFingerprint(normalized.factors, normalized.cqas, normalized.runs);
    setRestoredNeuralModels(canRestoreANN && artifact ? hydrateNeuralModels(artifact.models, normalized.factors, normalized.runs) : {});
    if (options?.warnANN && artifact && !canRestoreANN) {
      window.alert('ANN đã bị vô hiệu vì dữ liệu hoặc cấu trúc project thay đổi. Hãy train lại ANN.');
    }
    setNeuralTrainingVersion(0);
    setModelingEngine(normalized.analysisSettings?.modelingEngine ?? 'polynomial');
    setSelectedCQA(targetProject.cqas[0]?.code || 'Y1');
    if (options?.defaultTab) {
      setActiveTab(options.defaultTab);
    }
  }, []);

  // Load Case Study / Project
  const handleLoadProject = (newProj: QBDProject) => {
    const validation = validateProjectTemplate(newProj);
    if (!validation.valid) {
      window.alert(`Không thể tải project vì template không hợp lệ:\n${validation.errors.join('\n')}`);
      return;
    }
    trackProjectAction('load');
    pendingAuditAction.current = 'Tải project/case study';
    hydrateProjectState(newProj, { warnANN: true });
  };

  // New Blank Project
  const handleNewProject = () => {
    const blankProject: QBDProject = {
      id: `project-${Date.now()}`,
      name: 'Untitled project',
      moleculeName: 'Hoạt chất mới (New Chemical Entity)',
      dosageForm: 'Viên nén bao phim',
      strength: '',
      author: project.author || 'Analyst',
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
    hydrateProjectState(blankProject, { defaultTab: 'qtpp' });
  };

  const handleRestoreProject = (snapshot: QBDProject) => {
    pendingAuditAction.current = 'Khôi phục snapshot lịch sử';
    hydrateProjectState(snapshot);
  };

  // Save Project JSON
  const handleSaveJSON = () => {
    trackProjectAction('save_json');
    const jsonStr = JSON.stringify(project, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = projectFileName(project.name);
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div
      className={`app-shell${isHelpOpen && isHelpPinned ? ' app-shell--help-pinned' : ''}`}
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: '#f8fafc',
      }}
    >
      {/* Top Navbar */}
      <Navbar
        project={project}
        modelingEngine={modelingEngine}
        onToggleEngine={handleModelingEngineChange}
        hasTrainedNeuralModels={hasTrainedNeuralModels}
        onLoadProject={handleLoadProject}
        onSaveJSON={handleSaveJSON}
        onNewProject={handleNewProject}
        onRenameProject={(name) => handleUpdateProject({ name })}
        onToggleHelp={() => setIsHelpOpen((prev) => !prev)}
        isHelpOpen={isHelpOpen}
      />

      {/* QbD Workflow Step Navigation */}
      <TabNavigation activeTab={activeTab} onTabChange={handleTabChange} />

      {/* Main Tab Content */}
      <main
        role="tabpanel"
        id={`panel-${activeTab}`}
        aria-labelledby={`tab-${activeTab}`}
        tabIndex={0}
        style={{
          flex: 1,
          maxWidth: '1440px',
          width: '100%',
          margin: '0 auto',
          padding: '1.5rem 1.25rem',
          opacity: isTabPending ? 0.75 : 1,
          transition: 'opacity 0.15s ease',
        }}
      >
        {project.isLocked && (
          <div
            className="qbd-card"
            role="status"
            style={{
              backgroundColor: '#fef2f2',
              border: '1.5px solid #f87171',
              color: '#991b1b',
              marginBottom: '1rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0.75rem 1rem',
              borderRadius: '0.5rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <span style={{ fontSize: '1.2rem' }}>🔒</span>
              <div>
                <strong>Hồ sơ đang khóa nội bộ (chưa thẩm định GxP)</strong>
                <span style={{ fontSize: '0.82rem', marginLeft: '0.5rem', color: '#7f1d1d' }}>
                  (Phê duyệt bởi: {project.lockDetails?.lockedBy || 'Approver'} lúc {project.lockDetails?.lockedAt ? new Date(project.lockDetails.lockedAt).toLocaleString('vi-VN') : ''} — {project.lockDetails?.reason || 'Đã ký duyệt'})
                </span>
              </div>
            </div>
            <span style={{ fontSize: '0.78rem', color: '#b91c1c', fontWeight: 600 }}>Chế độ chỉ đọc (Read-only)</span>
          </div>
        )}
        {storageWarning && <div className="qbd-card" role="alert" style={{ borderLeft: '4px solid #d97706', color: '#92400e', marginBottom: '1rem' }}>{storageWarning}</div>}
        <Suspense fallback={<div className="qbd-card" role="status" aria-live="polite">Đang tải mô-đun phân tích…</div>}>
          <ComponentErrorBoundary key={activeTab} fallbackTitle={`Sự cố khi tải tab ${activeTab.toUpperCase()}`}>
          {activeTab === 'qtpp' && (
          <QTPPTab
            project={project}
            onUpdateProject={handleUpdateProject}
            onNavigateToFMEA={() => handleTabChange('fmea')}
          />
        )}

        {activeTab === 'fmea' && (
          <FMEATab
            project={project}
            onUpdateProject={handleUpdateProject}
            onNavigateToDoE={() => handleTabChange('doe')}
          />
        )}

        {activeTab === 'doe' && (
          <DoEDesignerTab
            project={project}
            onUpdateProject={handleUpdateProject}
            onNavigateToANOVA={() => handleTabChange('anova')}
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
            onApplyModelTypeToAll={handleApplyModelTypeToAll}
            modelingEngine={modelingEngine}
            onSelectEngine={handleModelingEngineChange}
            onNavigateToRSM={() => handleTabChange('rsm')}
            onNavigateToNeural={() => handleTabChange('neural')}
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
            onNavigateToRSM={() => handleTabChange('rsm')}
            onNavigateToDesignSpace={() => handleTabChange('design_space')}
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
            onNavigateToDesignSpace={() => handleTabChange('design_space')}
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
            onMonteCarloResult={setMonteCarlo}
            onUpdateProject={handleUpdateProject}
            onNavigateToReport={() => handleTabChange('report')}
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
          </ComponentErrorBoundary>
        </Suspense>
      </main>

      {/* Contextual Help Drawer (Right Sidebar Companion) */}
      {(isHelpOpen || isHelpPinned) && (
        <Suspense fallback={null}>
          <HelpDrawer
            isOpen={isHelpOpen}
            onClose={() => setIsHelpOpen(false)}
            activeTab={activeTab}
            project={project}
            modelingEngine={modelingEngine}
            selectedCQA={selectedCQA}
            onNavigateToTab={handleTabChange}
            isPinned={isHelpPinned}
            onTogglePin={() => setIsHelpPinned((prev) => !prev)}
          />
        </Suspense>
      )}

      {/* R&D Data Privacy & Telemetry Consent Banner */}
      <ConsentBanner />

      {/* Scientific Footer */}
      <footer style={{ borderTop: '1px solid #e2e8f0', backgroundColor: '#ffffff', padding: '1rem', marginTop: 'auto', textAlign: 'center', fontSize: '0.78rem', color: '#64748b' }}>
        <div style={{ maxWidth: '1440px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div>
            <strong>QbD Studio™ Pharma DoE Suite</strong> — © 2026 <strong>Tran Linh Nguyen</strong>. All rights reserved.
          </div>
          <div>
            Hỗ trợ quy trình phát triển tham chiếu ICH Q8(R2), ICH Q9, ICH Q10, ICH Q11 • Nền tảng DoE & Prediction Profiler.
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
