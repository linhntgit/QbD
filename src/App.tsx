import { useState, useMemo } from 'react';
import type {
  QBDProject,
  ModelType,
  StatisticalModelResult,
  NeuralNetConfig,
  NeuralNetModelResult,
  ModelingEngine,
} from './types/qbd';
import { CASE_STUDIES } from './data/caseStudies';
import { fitModel, optimizeDesirability, runMonteCarloSimulation } from './services/statistics';
import { fitNeuralNetModel } from './services/neuralNetwork';
import { exportQBDWordReport } from './services/reportGenerator';
import { Navbar } from './components/Navbar';
import { TabNavigation, type TabKey } from './components/TabNavigation';
import { QTPPTab } from './components/tabs/QTPPTab';
import { FMEATab } from './components/tabs/FMEATab';
import { DoEDesignerTab } from './components/tabs/DoEDesignerTab';
import { StatisticalANOVATab } from './components/tabs/StatisticalANOVATab';
import { NeuralNetworkTab } from './components/tabs/NeuralNetworkTab';
import { ResponseSurfaceTab } from './components/tabs/ResponseSurfaceTab';
import { DesignSpaceTab } from './components/tabs/DesignSpaceTab';
import { ReportTab } from './components/tabs/ReportTab';

export function App() {
  // Default project: Case Study 1 (Metoprolol Tablet BBD)
  const [project, setProject] = useState<QBDProject>(CASE_STUDIES[0]);
  const [activeTab, setActiveTab] = useState<TabKey>('qtpp');
  const [selectedCQA, setSelectedCQA] = useState<string>(CASE_STUDIES[0].cqas[0]?.code || 'Y1');
  const [modelTypes, setModelTypes] = useState<Record<string, ModelType>>({});
  const [neuralConfigs, setNeuralConfigs] = useState<Record<string, NeuralNetConfig>>({});
  const [modelingEngine, setModelingEngine] = useState<ModelingEngine>('polynomial');

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

  // Calculate Neural Network Models dynamically for all CQAs (SAS JMP Neural MLP)
  const neuralModels = useMemo<Record<string, NeuralNetModelResult>>(() => {
    const result: Record<string, NeuralNetModelResult> = {};
    project.cqas.forEach((cqa) => {
      const cfg = neuralConfigs[cqa.code];
      const nm = fitNeuralNetModel(cqa, project.factors, project.runs, cfg);
      if (nm) {
        result[cqa.code] = nm;
      }
    });
    return result;
  }, [project.cqas, project.factors, project.runs, neuralConfigs]);

  // Active Models based on selected Modeling Engine (Polynomial or Neural)
  const activeModels = useMemo<Record<string, StatisticalModelResult | NeuralNetModelResult>>(() => {
    if (modelingEngine === 'neural' && Object.keys(neuralModels).length > 0) {
      return neuralModels;
    }
    return models;
  }, [modelingEngine, models, neuralModels]);

  // Handle Training specific Neural Network model with custom hyperparameters
  const handleTrainNeuralModel = (cqaCode: string, config: NeuralNetConfig) => {
    setNeuralConfigs((prev) => ({
      ...prev,
      [cqaCode]: { ...config, seed: Math.floor(Math.random() * 100000) }, // new seed triggers retrain with fresh tours
    }));
  };

  // Calculate Desirability Optimum dynamically from active modeling engine
  const optimum = useMemo(() => {
    return optimizeDesirability(project.factors, project.cqas, activeModels);
  }, [project.factors, project.cqas, activeModels]);

  // Calculate Monte Carlo Simulation from active modeling engine
  const monteCarlo = useMemo(() => {
    if (!optimum) return null;
    return runMonteCarloSimulation(
      optimum.actualFactors,
      project.factors,
      project.cqas,
      activeModels,
      2.0,
      10000
    );
  }, [optimum, project.factors, project.cqas, activeModels]);

  // Update Project Handler
  const handleUpdateProject = (updated: Partial<QBDProject>) => {
    setProject((prev) => ({
      ...prev,
      ...updated,
      updatedDate: new Date().toISOString().slice(0, 10),
    }));
  };

  // Load Case Study / Project
  const handleLoadProject = (newProj: QBDProject) => {
    setProject(newProj);
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

    setProject(blankProject);
    setSelectedCQA('Y1');
    setActiveTab('qtpp');
  };

  // Save Project JSON
  const handleSaveJSON = () => {
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
  const handleExportWord = () => {
    exportQBDWordReport(project, models, optimum, monteCarlo, neuralModels, modelingEngine);
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: '#f8fafc' }}>
      {/* Top Navbar */}
      <Navbar
        project={project}
        activeTab={activeTab}
        modelingEngine={modelingEngine}
        onToggleEngine={setModelingEngine}
        onNavigateToTab={setActiveTab}
        onLoadProject={handleLoadProject}
        onExportWord={handleExportWord}
        onSaveJSON={handleSaveJSON}
        onNewProject={handleNewProject}
      />

      {/* QbD Workflow Step Navigation */}
      <TabNavigation activeTab={activeTab} onTabChange={setActiveTab} />

      {/* Main Tab Content */}
      <main style={{ flex: 1, maxWidth: '1440px', width: '100%', margin: '0 auto', padding: '1.5rem 1.25rem' }}>
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
            selectedCQA={selectedCQA}
            onSelectCQA={setSelectedCQA}
            modelTypes={modelTypes}
            onModelTypeChange={(code, type) => setModelTypes({ ...modelTypes, [code]: type })}
            modelingEngine={modelingEngine}
            onSelectEngine={setModelingEngine}
            onNavigateToRSM={() => setActiveTab('rsm')}
            onNavigateToNeural={() => setActiveTab('neural')}
          />
        )}

        {activeTab === 'neural' && (
          <NeuralNetworkTab
            project={project}
            models={models}
            neuralModels={neuralModels}
            neuralConfigs={neuralConfigs}
            onTrainModel={handleTrainNeuralModel}
            selectedCQA={selectedCQA}
            onSelectCQA={setSelectedCQA}
            modelingEngine={modelingEngine}
            onSelectEngine={setModelingEngine}
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
            onToggleEngine={setModelingEngine}
            onNavigateToDesignSpace={() => setActiveTab('design_space')}
          />
        )}

        {activeTab === 'design_space' && (
          <DesignSpaceTab
            project={project}
            models={activeModels}
            modelingEngine={modelingEngine}
            onToggleEngine={setModelingEngine}
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
            onToggleEngine={setModelingEngine}
          />
        )}
      </main>

      {/* Scientific Footer */}
      <footer style={{ borderTop: '1px solid #e2e8f0', backgroundColor: '#ffffff', padding: '1rem', marginTop: 'auto', textAlign: 'center', fontSize: '0.78rem', color: '#64748b' }}>
        <div style={{ maxWidth: '1440px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div>
            <strong>QbD Studio™ Pharma DoE Suite</strong> — © 2026 <strong>Tran Linh Nguyen</strong>. All rights reserved.
          </div>
          <div>
            Tuân thủ chuẩn mực ICH Q8(R2), ICH Q9, ICH Q10, ICH Q11 • Nền tảng DoE & SAS JMP Profiler.
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
