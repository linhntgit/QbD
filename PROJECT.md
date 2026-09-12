# Project: QbD & DoE Pharmaceutical Formulation Suite Comprehensive Upgrade

## Architecture
The QbD Studio™ is a high-reliability pharmaceutical formulation and Quality by Design suite built on React 19, TypeScript, Vite, Vitest, Mathjs, and Plotly.
The system consists of 4 core pillars:
1. **Pillar 1 — Advanced DoE & Metaheuristic Optimization**:
   - `src/services/doeGenerator.ts`: Generates experimental designs. Upgraded with Definitive Screening Design (DSD - Jones & Nachtsheim 2011) using foldover conference matrices $S = [C_k; -C_k]$.
   - `src/services/statistics.ts`: Upgraded from grid search to a hybrid continuous metaheuristic optimizer (Real-Coded Genetic Algorithm + Nelder-Mead simplex local search) for Derringer-Suich desirability maximization.
   - `src/services/mathUtils.ts`: Mixture polyhedral constraints (Piepel 1983 effective bounds $L_i^*, U_i^*$, consistency theorem, McLean-Anderson/XVERT extreme vertices, Euclidean projection).
2. **Pillar 2 — Explainable AI & Multi-Model Benchmarking**:
   - `src/services/neuralNetwork.ts`: ANN MLP with diagnostics (AICc, BIC, $R^2_{adj}$, log-likelihood) via Hurvich-Tsai small-sample correction.
   - `src/services/explainableAI.ts`: Feature importance engine (Garson's algorithm, Olden's connection weight method, Exact/Permutation SHAP values for $k \le 8$).
   - `src/services/modelBenchmarking.ts`: Multi-Model Benchmarking engine comparing Polynomial RSM (Linear, 2FI, Quadratic), ANN MLP, SVR (pure TypeScript SMO), and Ensemble Stacking (Akaike weights), calculating $R^2, R^2_{adj}, RMSE, AICc, BIC$.
3. **Pillar 3 — GxP Governance, Data Integrity & 21 CFR Part 11 / EU GMP Annex 11**:
   - `src/services/cryptoSha256.ts`: Deterministic pure TypeScript SHA-256 and canonical JSON stringifier (`canonicalJsonStringify`).
   - `src/services/projectGovernance.ts`: Cryptographic tamper-evident hash-chain audit trail, integrity verification engine (`verifyAuditTrailIntegrity`), and 3-tier electronic sign-off workflow (Analyst -> Reviewer -> Approver).
4. **Pillar 4 — Interactive 3D Design Space & Regulatory Archival Reporting**:
   - `src/components/tabs/DesignSpaceTab.tsx`: Interactive 3D sweet-spot surface view (Plotly) with $Z = \text{Margin}_{\min}$, $Z = 0$ boundary reference plane, dynamic slicing slider for 3rd factor ($X_3$) with PAR/NOR color-coded range bar and auto-scan animation player.
   - `src/services/pdfReportGenerator.ts`: Regulatory Archival PDF/A (ISO 19005) export embedding XMP metadata and SHA-256 audit root checksum.
   - `src/services/reportGenerator.ts`: Enhanced Word (.docx) export with 21 CFR Part 11 electronic signature block and cryptographic audit trail ledger.

---

## Feature Inventory
Every feature identified from the authoritative request (`ORIGINAL_REQUEST.md § 2026-09-12T01:35:03Z`) and survey reports is inventoried below with its assigned milestone.

| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Definitive Screening Design (DSD) | Jones & Nachtsheim (2011) 3-level standard runs ($2m+1$ / $2m+3$) and center runs with orthogonal main effects unconfounded with 2FIs and quadratic curvature | M1 | ORIGINAL_REQUEST R1 |
| 2 | Continuous Metaheuristic Desirability Optimizer | Hybrid Real-Coded Genetic Algorithm (RCGA) with SBX crossover, adaptive mutation, and Nelder-Mead simplex local search for global Derringer-Suich desirability maximization | M1 | ORIGINAL_REQUEST R1 |
| 3 | Mixture Polyhedral Bound Constraints | Piepel (1983) effective bound validation ($L_i^* \le U_i^*$), McLean-Anderson/XVERT extreme vertices, and fast Euclidean projection onto bounded simplex | M1 | ORIGINAL_REQUEST R1 |
| 4 | ANN Information Criteria & Diagnostics | Integration of Hurvich-Tsai AICc, BIC, logLikelihood, -2LL, and $R^2_{adj}$ calculation in `neuralNetwork.ts` | M2 | ORIGINAL_REQUEST R2 |
| 5 | Explainable AI (XAI) for ANN | Garson's algorithm, Olden's connection weight method, and Exact/Permutation SHAP values with contribution plots for CQA/CPP | M2 | ORIGINAL_REQUEST R2 |
| 6 | Multi-Model Benchmarking Table | Head-to-head comparison of Polynomial RSM, ANN MLP, SVR, and Ensemble Stacking with $R^2, R^2_{adj}, RMSE, AICc, BIC$ | M2 | ORIGINAL_REQUEST R2 |
| 7 | Cryptographic SHA-256 Tamper-Evident Audit Trail | Cryptographic hash chain tracking experiment changes, DoE settings, and model training parameters with canonical JSON serialization | M3 | ORIGINAL_REQUEST R3 |
| 8 | Integrity Verification Checksum Engine | Instant detection of unauthorized alterations, single-character tampering in audit history or state (`verifyAuditTrailIntegrity`) | M3 | ORIGINAL_REQUEST R3 |
| 9 | 21 CFR Part 11 / Annex 11 Electronic Sign-Off | 3-tier electronic sign-off workflow (Analyst / Reviewer / Approver) with cryptographic binding, reason for signing, and record locking | M3 | ORIGINAL_REQUEST R3 |
| 10 | Interactive 3D Design Space Surface | Plotly 3D sweet-spot surface view with $Z = \text{Margin}_{\min}$ and semi-transparent acceptance boundary plane at $Z = 0$ | M4 | ORIGINAL_REQUEST R4 |
| 11 | Dynamic Slicing Slider for 3rd Factor | Real-time slider for $X_3$ with PAR/NOR color-coded range indicator and auto-scan animation player | M4 | ORIGINAL_REQUEST R4 |
| 12 | Regulatory Archival PDF/A Export | Export compliant with ISO 19005 (PDF/A) embedding XMP metadata and SHA-256 audit root checksum | M4 | ORIGINAL_REQUEST R4 |
| 13 | Enhanced Regulatory Word (.docx) Export | Word export containing cryptographic audit ledger and 21 CFR Part 11 electronic signature manifestation | M4 | ORIGINAL_REQUEST R4 |
| 14 | Automated Scientific Test Suite & Quality Gates | Comprehensive Vitest suites (`definitiveScreening.test.ts`, `geneticOptimizer.test.ts`, `mixturePolytope.test.ts`, `explainableAI.test.ts`, `modelBenchmarking.test.ts`, `projectGovernance.test.ts`), zero TypeScript build errors, zero ESLint warnings | M5 | Acceptance Criteria |

---

## Milestones

| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Advanced DoE & Metaheuristic Optimization | DSD generator, Continuous GA + Nelder-Mead desirability optimizer, Piepel mixture polyhedral bounds | none | DONE (34 unit + 30 E2E tests passing) |
| M2 | Explainable AI & Multi-Model Benchmarking | ANN AICc/BIC/$R^2_{adj}$, Garson/Olden/SHAP XAI engine, SVR + Ensemble benchmarking table | none | DONE (20 unit + 13 E2E tests passing) |
| M3 | GxP Governance & 21 CFR Part 11 Audit Trail | Pure TypeScript SHA-256, canonical JSON, tamper-evident hash chain, integrity verification, 3-tier sign-off workflow | none | DONE (42 unit + 13 E2E tests passing) |
| M5 | Final E2E Integration & Verification Gates | 100% E2E test pass, adversarial test hardening, zero TypeScript build errors, zero lint warnings | M1, M2, M3, M4 | DONE (Reviewers, Challengers, and Forensic Auditor APPROVED — Gate Result: PASS) |

---

## Interface Contracts

### M1 ↔ Core Types & UI (`src/types/qbd.ts`, `src/services/doeGenerator.ts`, `src/services/statistics.ts`)
- `DoEDesignType`: Add `'DefinitiveScreening'` to union.
- `generateDefinitiveScreeningDesign(factors: Factor[], centerPoints?: number, randomSeed?: number): DoEExperimentalDesign`
- `calculateEffectiveMixtureBounds(components: Factor[]): { isConsistent: boolean; effectiveBounds: { min: number; max: number }[]; reason?: string }`
- `optimizeDesirabilityGA(responses: ResponseGoal[], models: Record<string, StatisticalModelResult>, factors: Factor[], options?: GAOptions): DesirabilityOptimizationResult`

### M2 ↔ ANN & Modeling UI (`src/services/neuralNetwork.ts`, `src/services/explainableAI.ts`, `src/services/modelBenchmarking.ts`)
- `calculateANNInformationCriteria(n: number, p: number, sse: number): { aicc: number; bic: number; logLikelihood: number; twoLL: number; adjRSquared: number }`
- `computeXAIImportance(model: TrainedNeuralNetwork, data: DatasetRow[], factors: Factor[]): XAIResult { garson: Record<string, number>; olden: Record<string, number>; shap: SHAPResult }`
- `benchmarkAllModels(data: DatasetRow[], factors: Factor[], responses: ResponseGoal[]): BenchmarkComparisonResult`

### M3 ↔ Project State & Storage (`src/services/cryptoSha256.ts`, `src/services/projectGovernance.ts`)
- `sha256(input: string): string`
- `canonicalJsonStringify(data: any): string`
- `verifyAuditTrailIntegrity(history: ProjectAuditEntry[]): { isValid: boolean; tamperedIndex?: number; reason?: string }`
- `signProjectSnapshot(project: QBDProject, user: { name: string; role: 'Analyst' | 'Reviewer' | 'Approver'; reason: string }): QBDProject`

### M4 ↔ Design Space & Exporters (`src/components/tabs/DesignSpaceTab.tsx`, `src/services/pdfReportGenerator.ts`, `src/services/reportGenerator.ts`)
- `render3DSweetSpotSurface(factors: Factor[], responses: ResponseGoal[], activeModels: Record<string, any>, sliceFactorId: string, sliceValue: number): PlotlyTraces`
- `exportRegulatoryPDFA(project: QBDProject, options: ExportOptions): Promise<Blob>`
- `exportQBDWordReport(project: QBDProject, options: ExportOptions): Promise<void>`

---

## Code Layout & Write Boundaries

| Milestone | Worker Role | Allowed Write Files | Forbidden Files |
|-----------|-------------|---------------------|-----------------|
| M1 | Worker M1 | `src/types/qbd.ts`, `src/services/doeGenerator.ts`, `src/services/statistics.ts`, `src/services/mathUtils.ts`, `src/components/DesirabilityProfiler.tsx`, `src/components/tabs/DoEDesignerTab.tsx`, `src/test/definitiveScreening.test.ts`, `src/test/geneticOptimizer.test.ts`, `src/test/mixturePolytope.test.ts` | Governance, PDF, ANN files |
| M2 | Worker M2 | `src/services/neuralNetwork.ts`, `src/services/explainableAI.ts`, `src/services/modelBenchmarking.ts`, `src/components/tabs/NeuralNetworkTab.tsx`, `src/test/explainableAI.test.ts`, `src/test/modelBenchmarking.test.ts` | DoE generators, Governance files |
| M3 | Worker M3 | `src/services/cryptoSha256.ts`, `src/services/projectGovernance.ts`, `src/components/ProjectGovernancePanel.tsx`, `src/test/projectGovernance.test.ts` | Plotly, DoE generators |
| M4 | Worker M4 | `src/components/tabs/DesignSpaceTab.tsx`, `src/services/pdfReportGenerator.ts`, `src/services/reportGenerator.ts`, `src/components/tabs/ReportTab.tsx`, `src/test/regulatoryReport.test.ts` | Core mathematical engines |
| M5 | Worker M5 | Integration glue, final verification tests | Core logic rewrite |
| E2E Test | Test Writer | `src/test/e2e/**`, `TEST_READY.md`, `TEST_INFRA.md` | `src/services/**`, `src/components/**` |
