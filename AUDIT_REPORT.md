# Comprehensive Quality by Design (QbD) Web Application Audit Report
**Master Technical, Statistical, Architectural, Performance, Security & Test Evaluation**

- **Project:** QbD Studio™ — Quality by Design (Experimental Design) Pharmaceutical Web Application
- **Workspace:** `d:\Sync\GDrive\AG\Experimental Design`
- **Target Deliverable:** `AUDIT_REPORT.md`
- **Lead Auditor & Synthesizer:** Lead Technical Auditor (`worker_report_writer_1`)
- **Specialized Input Audits:**
  1. *Pillar 1: Statistical Algorithms* (`.agents/explorer_stat_1/report.md`)
  2. *Pillars 2 & 4: Architecture, TypeScript, Security & Data Integrity* (`.agents/explorer_arch_sec_1/report.md`)
  3. *Pillars 3 & 5: Performance, Bundle Optimization & Test Diagnostics* (`.agents/worker_perf_test_1/report.md`)
- **Regulatory & Technical Reference Standards:** ICH Q8(R2) (Pharmaceutical Development), ICH Q9 (Quality Risk Management), ICH Q10 (Pharmaceutical Quality System), ICH Q11, FDA Guidance for Industry on Process Validation, US FDA 21 CFR Part 11, GAMP 5, ISO 21747, Montgomery *Design and Analysis of Experiments* (10th Ed), Golub & Van Loan *Matrix Computations* (4th Ed).
- **Date of Audit:** September 11, 2026
- **Audit Execution Mode:** Strict Zero Code Modification (Read-Only Forensic Audit)

---

## 1. Executive Summary & Project Health Scorecard

### 1.1 Executive Overview
QbD Studio™ is a rich client-side web application built on modern web technologies (React 19, TypeScript, Vite, Vitest, Plotly.js, KaTeX, and docx) engineered to assist pharmaceutical scientists, formulation experts, and process engineers in executing Quality by Design (QbD) workflows. The software spans Quality Target Product Profile (QTPP) definition, Initial/Updated Risk Assessment (FMEA/ICH Q9), Design of Experiments (DoE screening, factorial, response surface methodology, and Scheffé mixture designs), dual-engine predictive modeling (Polynomial Ordinary Least Squares [OLS] and Multilayer Perceptron Artificial Neural Networks [ANN]), Monte Carlo design space verification, and automated regulatory Word report generation.

The mathematical core reflects sophisticated design choices:
- Implementation of **Householder QR Factorization** avoiding normal equations condition squaring ($\kappa(X)$ instead of $\kappa(X^T X)$);
- Sequential Type I ANOVA with block nuisance effect adjustments and Scheffé canonical polynomials;
- Full diagnostic suites including PRESS, $Q^2$, Adequate Precision, Cook's Distance, DFFITS, and Wilson score intervals;
- Rank-aware **Fedorov coordinate exchange** for D-optimal custom designs;
- Multivariate Monte Carlo error propagation with Cholesky residual covariance shrinkage and Mulberry32 deterministic seeding;
- Exemplary statistical reference testing benchmarked directly against NumPy 2.3.5 SVD reference datasets.

However, beneath these scientific algorithms lie **critical vulnerabilities, architectural flaws, client-side denial-of-service risks, and regulatory compliance gaps** that threaten browser stability, data integrity, and regulatory validity:
1. **Client Denial-of-Service ($5^k$ Candidate Grid):** Candidate pool generation in `doeGenerator.ts` scales exponentially with factor count ($5^k$), allocating nearly 10 million vectors for 10 factors and triggering immediate browser tab Out-Of-Memory (OOM) crashes.
2. **100% UI-Thread Blocking:** Zero Web Workers exist. 100,000 Monte Carlo runs and up to 180,000 forward/backward neural network training passes execute synchronously on the main JavaScript thread, completely freezing the user interface behind superficial `setTimeout` progress bars.
3. **Severe Desirability Inversion Bug:** A mathematical sign error in `calculateIndividualDesirability` causes lower and upper bounds to invert ($L > U$) whenever a target value is negative (e.g. Zeta potential), systematically destroying multi-criteria optimization by returning $d_i = 0$.
4. **Stored XSS via KaTeX Render Fallback:** The formula renderer in `MathView.tsx` catches KaTeX parse errors and returns unescaped raw formula strings directly into `dangerouslySetInnerHTML`.
5. **Silent Data Loss in LocalStorage:** Storing 25 full, unpruned project snapshots (including deep neural weight matrices) quickly exhausts the browser's 5 MB quota, causing silent version dropouts.
6. **21 CFR Part 11 Disconnect:** Client-side plaintext storage and decorative signature blocks lack cryptographic integrity, digital signing, and immutable audit trails, requiring an explicit exploratory R&D disclaimer.

### 1.2 Comprehensive Project Health Scorecard

| Dimension / Pillar | Score (1-10) | Rating | Status | Summary Diagnostic Finding |
| :--- | :---: | :---: | :---: | :--- |
| **Diagnostic Toolchain Health** | **9.0 / 10** | Strong | PASS | 87/87 Vitest pass (1.72s); Oxlint 0 errors (47 files); `tsc -b` compiles without errors. |
| **Pillar 1: Scientific & Statistical Algorithms** | **6.5 / 10** | Needs Attention | WARNING | Missing RSM Canonical Analysis ($x_0 = -\frac{1}{2}B^{-1}a$); negative target desirability bug ($d_i=0$); Gaussian-only Monte Carlo; $2^{k-1}$ screening limit; $P_{pk}/C_{pk}$ confusion. |
| **Pillar 2: Architecture & Code Quality** | **6.0 / 10** | Needs Improvement | CONCERN | Monolithic files (>3,000 lines); zero Context/Store; severe prop-drilling; only 1 global Error Boundary; loose `as any` in diagnostic bridges; `strict: true` omitted in tsconfig. |
| **Pillar 3: Performance & Bundle Optimization** | **3.5 / 10** | Deficient | CRITICAL | Massive Plotly chunk (1.69 MB); eager KaTeX fonts (685 kB index); phantom `mathjs` dependency; 100% main thread blocking; zero Web Workers; zero `React.memo`/`useCallback`. |
| **Pillar 4: Security & Data Integrity** | **5.2 / 10** | Inadequate | HIGH RISK | KaTeX error fallback XSS in `MathView.tsx`; CSV formula injection (DDE); unbounded `localStorage` quota drops; ad-hoc JSON validation without schema (Zod). |
| **Pillar 5: Test Coverage & Quality** | **5.5 / 10** | Inadequate | HIGH RISK | Zero tests for React UI components (0/18 files); zero tests for `reportGenerator.ts` (1,122 lines); silent catch on singular matrices; no tests for $SS_{tot}=0$ response variance. |
| **GxP & Regulatory Readiness (21 CFR Part 11)** | **4.0 / 10** | Non-Compliant | WARNING | Mutable plaintext storage; decorative signature blocks; lack of cryptographic audit ledger. Suitable strictly for exploratory R&D, not direct eCTD regulatory submission. |
| **OVERALL APPLICATION HEALTH SCORE** | **5.7 / 10** | **FAIR** | **CONDITIONAL** | **Mathematically capable exploratory tool; requires structural stabilization before production/GxP use.** |

---

## 2. Diagnostic Toolchain Verification

The diagnostic toolchain was executed directly against the clean workspace root (`d:\Sync\GDrive\AG\Experimental Design`) under strict read-only constraints.

```
+---------------------------------------------------------------------------------------------------------+
|                                    DIAGNOSTIC TOOLCHAIN VERIFICATION                                    |
+----------------------+--------------------+---------------------+---------------------------------------+
| Subsystem            | Command Executed   | Measured Output     | Operational Status                    |
+----------------------+--------------------+---------------------+---------------------------------------+
| Vitest Test Runner   | npm test           | 87 / 87 passed      | PASS (8 test files, 1.72s runtime)    |
| Oxlint Static Linter | npm run lint       | 0 errors, 0 warns   | PASS (47 files scanned, 104 rules)    |
| TypeScript Compiler  | npx tsc --noEmit   | Exit Code: 0        | PASS (Standard tsconfig compiles)     |
| Vite Production Build| npm run build      | 2318 modules, 1.09s | WARNING (Chunks exceed 500 kB limit)  |
+----------------------+--------------------+---------------------+---------------------------------------+
```

### 2.1 Vitest Automated Test Suite (`npm test`)
Vitest v4.1.11 executed 8 suites containing 87 tests in **1.72s** (transform: 2.46s, setup: 0ms, import: 3.50s, tests: 1.28s):
- `src/services/neuralValidation.test.ts`: 1 test (8ms) — K-fold split array math.
- `src/services/ternaryContour.test.ts`: 2 tests (6ms) — interval division helper.
- `src/services/factorLevels.test.ts`: 5 tests (12ms) — categorical level snaps.
- `src/services/projectGovernance.test.ts`: 11 tests (20ms) — storage errors, JSON imports.
- `src/services/mixtureRounding.test.ts`: 5 tests (26ms) — simplex closure ($\sum X_i = 100\%$).
- `src/services/scientificCore.test.ts`: 14 tests (39ms) — Taguchi balance, block correction, curvature.
- `src/services/statisticalReference.test.ts`: 43 tests (307ms) — OLS regression vs. NumPy 2.3.5 SVD.
- `src/services/discretePipeline.test.ts`: 6 tests (863ms) — 5-factor D-optimal rank-aware exchange.

### 2.2 Oxlint Static Code Analysis (`npm run lint`)
Oxlint v1.75.0 evaluated 47 files with 104 rules using 16 threads in 29ms:
- **0 errors, 0 warnings**.
- *Audit Note:* While Oxlint verifies basic syntax and React lint rules rapidly, it does not enforce custom architectural boundaries, complexity limits, or strict type-check rules.

### 2.3 TypeScript Compiler Configuration Analysis (`tsconfig.app.json`)
Running `npx tsc --noEmit` and `tsc -b` succeeds with exit code 0. However, inspection of `tsconfig.app.json` (lines 1–26) reveals that **strict mode is completely disabled**:
- Missing `"strict": true`
- Missing `"strictNullChecks": true`
- Missing `"noImplicitAny": true`
- Missing `"useUnknownInCatchVariables": true`

Running an ad-hoc strict verification via `npx tsc --noEmit --strict -p tsconfig.app.json` exits cleanly without errors, demonstrating excellent base type discipline; however, without compiler flags enabled in repository configuration, future regressions will go undetected.

### 2.4 Production Build & Asset Chunk Size Analysis
Vite v8.2.1 built the production client in 1.09s, emitting 2,318 transformed modules. Three chunks severely breach performance budgets:
1. `dist/assets/PlotlyChart-IIgUD-l0.js`: **1,689.29 kB** (gzip: **553.40 kB**).
2. `dist/assets/index-BRCvTn3Z.js`: **685.22 kB** (gzip: **203.09 kB**).
3. `dist/assets/ReportTab-DpF2Ea7K.js`: **432.92 kB** (gzip: **121.03 kB**).
4. KaTeX Font Assets: Over **30 font files** (.woff, .woff2, .ttf) totaling ~600 kB are bundled into the distribution directory and loaded eagerly due to static imports.

---

## 3. Master Findings Catalog & Severity Matrix

```
+---------------------------------------------------------------------------------------------------------+
|                                    MASTER SEVERITY & FINDINGS MATRIX                                    |
+---------+------------------+----------+-------------------------------------+---------------------------+
| ID      | Pillar & Domain  | Severity | File Path & Line Citation           | Short Description         |
+---------+------------------+----------+-------------------------------------+---------------------------+
| STAT-01 | Pillar 1: Stat   | CRITICAL | src/services/statistics.ts:1-1500   | Missing RSM Canonical     |
|         |                  |          | src/components/tabs/ResponseSurface | Analysis & Stationary Pt  |
| STAT-02 | Pillar 1: Stat   | CRITICAL | src/services/mathUtils.ts:404-429   | Negative target inverts   |
|         |                  |          |                                     | desirability (di = 0)     |
| STAT-03 | Pillar 1: Stat   | CRITICAL | src/services/statistics.ts:1224-1235| Monte Carlo sampler is    |
|         |                  |          |                                     | Gaussian-only (no Lognorm)|
| ARCH-01 | Pillar 2: Arch   | CRITICAL | src/services/doeGenerator.ts:1286   | 5^k candidate pool causes |
|         |                  |          | src/services/doeGenerator.ts:1535   | browser OOM crash (k>=8)  |
| PERF-01 | Pillar 3: Perf   | CRITICAL | src/services/statistics.ts:1100-1376| 100% UI-thread blocking;  |
|         |                  |          | src/App.tsx:142-156                 | zero Web Workers; fake bar|
| PERF-02 | Pillar 3: Perf   | CRITICAL | src/services/plotlyCustom.ts:1-12   | Enormous Plotly bundle    |
|         |                  |          | dist/assets/PlotlyChart: 1.69 MB    | chunk (1.69 MB unzipped)  |
| STAT-04 | Pillar 1: Stat   | HIGH     | src/services/doeGenerator.ts:184-188| 2^(k-1) single fraction   |
|         |                  |          |                                     | limit for k >= 6          |
| STAT-05 | Pillar 1: Stat   | HIGH     | src/services/doeGenerator.ts:150    | Missing Confounding &     |
|         |                  |          | src/components/tabs/DoEDesignerTab  | Alias Structure Matrix    |
| STAT-06 | Pillar 1: Stat   | HIGH     | src/services/mathUtils.ts:147-150   | QR diagonal ratio misses  |
|         |                  |          |                                     | severe ill-conditioning   |
| STAT-07 | Pillar 1: Stat   | HIGH     | src/services/neuralNetwork.ts:695   | Missing validation-based  |
|         |                  |          | src/services/neuralNetwork.ts:1337  | early stopping in ANN     |
| STAT-08 | Pillar 1: Stat   | HIGH     | src/services/statistics.ts:1328-1339| SPC misclassification:    |
|         |                  |          |                                     | Ppk labeled as Cpk        |
| ARCH-04 | Pillar 2: Arch   | HIGH     | src/main.tsx:9, AppErrorBoundary:11 | Single global error bound;|
|         |                  |          |                                     | zero tab/chart boundaries |
| PERF-03 | Pillar 3: Perf   | HIGH     | package.json:24                     | Phantom dependency mathjs |
|         |                  |          |                                     | (0 imports in src/)       |
| PERF-04 | Pillar 3: Perf   | HIGH     | src/App.tsx:22, HelpDrawer.tsx:27   | Eager KaTeX & 30+ fonts   |
|         |                  |          | src/components/MathView.tsx:2-3     | in index bundle (685 kB)  |
| PERF-05 | Pillar 3: Perf   | HIGH     | src/App.tsx:1-617, components/*     | Zero React.memo, zero     |
|         |                  |          |                                     | useCallback in App.tsx    |
| PERF-06 | Pillar 3: Perf   | HIGH     | src/services/projectGovernance.ts   | LocalStorage quota crash: |
|         |                  |          | line 117-134, App.tsx:110           | 25 unpruned snapshots      |
| SEC-01  | Pillar 4: Sec    | HIGH     | src/components/MathView.tsx:18, 32  | KaTeX error fallback XSS  |
|         |                  |          | src/components/MathView.tsx:45, 64  | via dangerouslySetInnerHTML|
| SEC-02  | Pillar 4: Sec    | HIGH     | src/services/projectGovernance.ts   | Silent drop of project     |
|         |                  |          | line 129, App.tsx:108-122           | history on quota error     |
| SEC-05  | Pillar 4: Sec    | HIGH     | src/components/tabs/ReportTab:1037  | 21 CFR Part 11 gap:        |
|         |                  |          | src/services/projectGovernance.ts:46| decorative signature cards |
| TEST-02 | Pillar 5: Test   | HIGH     | src/components/*, tabs/*            | Zero tests for UI (0/18    |
|         |                  |          | (18 files, ~10k lines of code)      | components, 0/8 tabs)      |
| TEST-03 | Pillar 5: Test   | HIGH     | src/services/reportGenerator.ts:1   | Zero tests for Word report |
|         |                  |          | (1,122 lines, 45.9 kB)              | generator engine           |
| TEST-04 | Pillar 5: Test   | HIGH     | src/services/statistics.ts:175-182  | Silent catch-all on        |
|         |                  |          | src/services/mathUtils.ts:125-135   | singular/collinear matrices|
| STAT-09 | Pillar 1: Stat   | MEDIUM   | src/services/doeGenerator.ts:309-335| Missing Inscribed Central  |
|         |                  |          |                                     | Composite (CCI) design     |
| STAT-10 | Pillar 1: Stat   | MEDIUM   | src/services/statistics.ts:293-296  | Internally studentized     |
|         |                  |          | src/services/statistics.ts:591      | residuals mask outliers    |
| STAT-11 | Pillar 1: Stat   | MEDIUM   | src/services/neuralNetwork.ts:444   | Overly strict Ntrain <= P  |
|         |                  |          |                                     | fails standard DoEs        |
| STAT-12 | Pillar 1: Stat   | MEDIUM   | src/services/statistics.ts:1100-1376| Missing sample convergence |
|         |                  |          |                                     | & Wilson CI for low PPM    |
| ARCH-08 | Pillar 2: Arch   | MEDIUM   | src/services/statistics.ts:1070     | (model.diagnostics as any) |
|         |                  |          | src/components/DesirabilityProfiler | bypasses union types       |
| ARCH-09 | Pillar 2: Arch   | MEDIUM   | tsconfig.app.json:2-24              | Missing "strict": true     |
|         |                  |          |                                     | in app compiler options    |
| ARCH-10 | Pillar 2: Arch   | MEDIUM   | src/App.tsx:58-84, 482-585          | Monolithic state & 4-level |
|         |                  |          |                                     | prop drilling across 8 tabs|
| ARCH-11 | Pillar 2: Arch   | MEDIUM   | src/App.tsx:61, 470, 481-482        | Missing React 19 concurrent|
|         |                  |          |                                     | startTransition on tabs    |
| ARCH-12 | Pillar 2: Arch   | MEDIUM   | src/components/tabs/DoEDesignerTab  | Extreme file bloat         |
|         |                  |          | src/components/tabs/NeuralNetworkTab| (>3,000 lines per file)    |
| ARCH-13 | Pillar 2: Arch   | MEDIUM   | src/components/Navbar.tsx, Help...  | Cascading re-render on     |
|         |                  |          |                                     | every single keystroke     |
| ARCH-14 | Pillar 2: Arch   | MEDIUM   | src/components/tabs/DoEDesigner:909 | Uncleaned setTimeout timers|
|         |                  |          | src/components/tabs/NeuralNetworkTab| cause state memory leaks   |
| ARCH-15 | Pillar 2: Arch   | MEDIUM   | src/components/tabs/DoEDesignerTab  | Unvirtualized run table    |
|         |                  |          | lines 880-920, 1100+                | lags on large designs      |
| ARCH-16 | Pillar 2: Arch   | MEDIUM   | src/services/mathUtils.ts:6-21      | matMul/matTranspose crash  |
|         |                  |          | src/services/mathUtils.ts:26-36     | on empty arrays            |
| ARCH-17 | Pillar 2: Arch   | MEDIUM   | src/components/tabs/StatisticalTab  | Math.min(...[]) evaluates  |
|         |                  |          | lines 214-216                       | to Infinity in Plotly shape|
| ARCH-18 | Pillar 2: Arch   | MEDIUM   | src/components/PlotlyChart.tsx:321  | Unhandled Plotly.react()   |
|         |                  |          |                                     | Promise rejections         |
| SEC-03  | Pillar 4: Sec    | MEDIUM   | src/services/doeExcelService.ts:388 | CSV Formula Injection      |
|         |                  |          |                                     | unescaped (=, +, -, @)     |
| SEC-04  | Pillar 4: Sec    | MEDIUM   | src/services/projectGovernance.ts:50| Ad-hoc JSON check without  |
|         |                  |          |                                     | formal Zod schema parser   |
| TEST-05 | Pillar 5: Test   | MEDIUM   | src/services/statistics.ts:315-330  | Zero response variance     |
|         |                  |          |                                     | (SStot=0) produces NaN     |
| ARCH-19 | Pillar 2: Arch   | LOW      | src/components/tabs/ReportTab:130   | Unthrottled scroll listener|
|         |                  |          |                                     | triggers layout re-renders |
+---------+------------------+----------+-------------------------------------+---------------------------+
```

---

## 4. Pillar 1: Scientific & Statistical Algorithms

### STAT-01: Absence of Response Surface Canonical Analysis & Hessian Stationary Point Decomposition
- **Severity:** **CRITICAL**
- **File & Line Citation:** `src/services/statistics.ts` (function omitted); `src/components/tabs/ResponseSurfaceTab.tsx` (only discrete grid evaluation).
- **Mathematical Mechanism:**  
  In Response Surface Methodology (RSM; Montgomery, *Design and Analysis of Experiments*, Chap. 11), a fitted second-order quadratic polynomial response model is expressed in matrix notation:
  $$\hat{y}(x) = b_0 + x^T a + x^T B x$$
  where $x = (x_1, x_2, \dots, x_k)^T$ is the vector of coded factor levels, $a = (\hat{\beta}_1, \dots, \hat{\beta}_k)^T$ is the linear coefficient vector, and $B$ is the $k \times k$ symmetric Hessian matrix defined by:
  $$B_{ii} = \hat{\beta}_{ii}, \quad B_{ij} = \frac{1}{2} \hat{\beta}_{ij} \quad (i \ne j)$$
  The stationary point $x_0$ is the location where all first partial derivatives vanish:
  $$\frac{\partial \hat{y}}{\partial x} = a + 2Bx = 0 \implies x_0 = -\frac{1}{2} B^{-1} a$$
  The predicted response at the stationary point is:
  $$\hat{y}_0 = b_0 + \frac{1}{2} x_0^T a$$
  Canonical analysis diagonalizes the symmetric matrix $B$ via spectral decomposition:
  $$B = M \Lambda M^T, \quad \Lambda = \text{diag}(\lambda_1, \lambda_2, \dots, \lambda_k)$$
  where $\lambda_i$ are eigenvalues and $M$ is the orthogonal matrix of eigenvectors. Transforming to canonical axes $w = M^T (x - x_0)$ yields:
  $$\hat{y} = \hat{y}_0 + \sum_{i=1}^k \lambda_i w_i^2$$
  The nature of the stationary point is determined by the signs of $\lambda_i$:
  - All $\lambda_i < 0$: Unique Local Maximum.
  - All $\lambda_i > 0$: Unique Local Minimum.
  - $\lambda_i$ have mixed signs: Saddle Point (Minimax).
  - At least one $\lambda_i \approx 0$: Stationary Ridge System.
- **QbD & Regulatory Impact:**  
  Under ICH Q8(R2) Section 2.4, establishing a design space and Normal Operating Range (NOR) requires understanding the curvature of the response surface. If the stationary point is a saddle point, an operator operating near $x_0$ risks unexpected quality crashes: moving along an eigenvector corresponding to a positive eigenvalue increases the response, while moving along an eigenvector of a negative eigenvalue causes a drop. Furthermore, missing ridge analysis prevents formulation scientists from exploiting flat directions ($\lambda_i \approx 0$) to widen Proven Acceptable Ranges (PAR) without affecting CQAs.
- **Remediation:**  
  Implement `calculateRSMCanonicalAnalysis` in `src/services/statistics.ts` using a cyclic Jacobi eigenvalue algorithm for symmetric matrices ($k \le 10$ factors converges in $<15$ sweeps):
  ```ts
  export interface CanonicalAnalysisResult {
    stationaryPointCoded: Record<string, number>;
    stationaryPointActual: Record<string, number | string>;
    predictedAtStationaryPoint: number;
    eigenvalues: number[];
    eigenvectors: number[][]; // Columns are eigenvectors
    surfaceNature: 'maximum' | 'minimum' | 'saddle' | 'ridge';
    isInsideDesignSpace: boolean; // ||x0||_2 <= 1.0 (or alpha)
    canonicalEquation: string;
  }
  ```

---

### STAT-02: Target Desirability Mathematical Inversion Bug with Negative Responses
- **Severity:** **CRITICAL**
- **File & Line Citation:** `src/services/mathUtils.ts:404-429`
- **Mathematical Mechanism:**  
  In Derringer-Suich desirability optimization for a response with target goal `'target'`:
  ```ts
  // mathUtils.ts:404-406
  const L = lowLimit !== undefined ? lowLimit : target !== undefined ? target * 0.9 : 0;
  const U = highLimit !== undefined ? highLimit : target !== undefined ? target * 1.1 : 100;
  const T = target !== undefined ? target : (L + U) / 2;
  if (y < L || y > U) return 0.0;
  ```
  1. **Negative Target Value ($T < 0$):** Consider an objective such as Zeta Potential target $T = -20\text{ mV}$ or Enthalpy change $\Delta H = -50\text{ kJ/mol}$. When limits are unspecified:
     $$L = (-20) \times 0.9 = -18.0$$
     $$U = (-20) \times 1.1 = -22.0$$
     This leads to $L = -18.0 > U = -22.0$. The boundary check `if (y < L || y > U)` evaluates to `y < -18.0 || y > -22.0`. For every real number $y \in \mathbb{R}$, this boolean condition is **always true**. Consequently, the function returns `0.0` for all predicted responses.
  2. **Zero Target Value ($T = 0$):** If $T = 0$, $L = 0$ and $U = 0$, causing any prediction $y \ne 0$ to receive an individual desirability of 0.
- **QbD & Regulatory Impact:**  
  In nanomedicine (liposomes, polymeric nanoparticles), Zeta potential ($\approx -25\text{ mV}$ to $-40\text{ mV}$) is a Critical Quality Attribute (CQA) governing colloidal physical stability and preventing aggregation. The software completely disables desirability optimization for negative CQAs, failing to find optimal formulations.
- **Remediation:**  
  Calculate symmetrical offsets based on absolute scale rather than scalar multiplication:
  ```ts
  const delta = Math.abs(target) > 1e-6 ? Math.abs(target) * 0.1 : 1.0;
  const L = lowLimit !== undefined ? lowLimit : (target !== undefined ? target - delta : 0);
  const U = highLimit !== undefined ? highLimit : (target !== undefined ? target + delta : 100);
  ```

---

### STAT-03: Probability Distribution Limitation in Monte Carlo Simulation Engine
- **Severity:** **CRITICAL**
- **File & Line Citation:** `src/services/statistics.ts:1224-1235`
- **Mathematical Mechanism:**  
  `runMonteCarloSimulation` generates stochastic factor variations via Box-Muller transformation:
  ```ts
  const rawActualVal = mean + standardNormal() * sd;
  ```
  The simulation engine exclusively samples from a Gaussian Normal distribution $X \sim \mathcal{N}(\mu, \sigma^2)$. It lacks support for non-normal distributions fundamental to pharmaceutical manufacturing:
  - **Lognormal:** $X = \exp(\mu + \sigma Z)$ ($Z \sim \mathcal{N}(0, 1)$). Essential for strictly positive, right-skewed parameters such as particle size distribution ($D_{10}, D_{50}, D_{90}$), impurity levels, and disintegration times.
  - **Uniform:** $X \sim \mathcal{U}(a, b)$. Essential for environmental fluctuations (cleanroom relative humidity 45%–65%, ambient temperature).
  - **Triangular:** $X \sim \text{Triangular}(a, c, b)$ (minimum, mode, maximum). Standard under ICH Q9 risk quantification when empirical data is limited to expert bounds and most probable values.
  - **Beta Distribution:** Necessary for bounded proportions $[0, 1]$ (yields, chemical purity).
- **QbD & Regulatory Impact:**  
  Under ICH Q9 and FDA Process Validation Guidance, assuming normality for skewed distributions severely miscalculates Out-of-Specification (OOS) probabilities. Normal generation for particle size creates impossible negative values or underestimates long-tail risks, creating a false sense of compliance.
- **Remediation:**  
  Extend the `Factor` interface with `distribution?: 'Normal' | 'Lognormal' | 'Uniform' | 'Triangular'` and implement sampling routines in `mathUtils.ts`:
  ```ts
  export function sampleDistribution(
    dist: 'Normal' | 'Lognormal' | 'Uniform' | 'Triangular',
    params: { mean?: number; sd?: number; min?: number; mode?: number; max?: number },
    rng: () => number
  ): number;
  ```

---

### STAT-04: Screening Fractional Factorial Limited to Single Half-Fraction for $k \ge 6$
- **Severity:** **HIGH**
- **File & Line Citation:** `src/services/doeGenerator.ts:184-188`
- **Mathematical Mechanism:**  
  In `generateFractionalFactorial(k)`:
  ```ts
  const base = generateFullFactorial(k - 1);
  return base.map((row) => [...row, row[0] * row[1] * row[2]]);
  ```
  For $k \ge 6$ factors:
  1. The generator only produces a one-half fraction $2^{k-1}$ ($N = 32$ for $k=6$, $N = 64$ for $k=7$, $N = 128$ for $k=8$).
  2. Only the last column is assigned a generator ($X_k = X_1 X_2 X_3$), leaving $X_4, \dots, X_{k-1}$ as base columns.
  3. Smaller fractional designs (e.g. $2^{6-2} = 16$ runs, $2^{7-3} = 16$ runs, $2^{8-4} = 16$ runs; Resolution IV) are unsupported.
- **QbD & Regulatory Impact:**  
  Screening in QbD aims to screen 6–8 formulation/process factors in 16 runs to preserve expensive API. Requiring 32 or 64 runs defeats the economic purpose of fractional factorials.
- **Remediation:**  
  Implement standard generators (Montgomery, Table 8.14) for $2^{k-p}$ Resolution IV designs:
  - $2^{6-2}$ ($N=16$): $X_5 = X_1 X_2 X_3, X_6 = X_1 X_4 X_5$.
  - $2^{7-3}$ ($N=16$): $X_5 = X_1 X_2 X_3, X_6 = X_1 X_2 X_4, X_7 = X_1 X_3 X_4$.
  - $2^{8-4}$ ($N=16$): $X_5 = X_1 X_2 X_3, X_6 = X_1 X_2 X_4, X_7 = X_1 X_3 X_4, X_8 = X_2 X_3 X_4$.

---

### STAT-05: Complete Omission of Confounding & Alias Structure Matrix
- **Severity:** **HIGH**
- **File & Line Citation:** `src/services/doeGenerator.ts:150`; `src/components/tabs/DoEDesignerTab.tsx`
- **Mathematical Mechanism:**  
  When fractional designs are fitted, estimated parameters $\hat{\beta}_1$ are biased by omitted higher-order terms $\beta_2$:
  $$E(\hat{\beta}_1) = \beta_1 + A \beta_2, \quad A = (X_1^T X_1)^{-1} X_1^T X_2$$
  where $A$ is the Alias Matrix, $X_1$ contains columns in the model, and $X_2$ contains excluded interactions (2FI, 3FI). The UI displays zero alias information to the scientist.
- **QbD & Regulatory Impact:**  
  Regulators (FDA/EMA eCTD Module 3.2.P.2) reject submissions if an applicant classifies a parameter as a Critical Process Parameter (CPP) without proving that its apparent effect is not an artifact of an aliased two-factor interaction.
- **Remediation:**  
  Implement `calculateAliasMatrix(X1, X2)` and render alias chains in `DoEDesignerTab.tsx`.

---

### STAT-06: Householder QR Diagonal Ratio Underestimates Severe Design Ill-Conditioning
- **Severity:** **HIGH**
- **File & Line Citation:** `src/services/mathUtils.ts:147-150`
- **Mathematical Mechanism:**  
  `solveLeastSquaresQR` estimates condition number via:
  ```ts
  const conditionEstimate = Math.max(...diagonal) / Math.min(...diagonal);
  ```
  In numerical analysis (Golub & Van Loan, Sec 3.5.4), $\kappa_2(R) = \|R\|_2 \|R^{-1}\|_2$. The diagonal ratio $\frac{\max |R_{ii}|}{\min |R_{ii}|}$ is merely a lower bound ($\kappa(R) \ge \frac{\max |R_{ii}|}{\min |R_{ii}|}$). For Kahan-type upper triangular matrices, diagonal elements are equal ($\approx 1$) while the true condition number grows exponentially ($\mathcal{O}(2^n)$).
- **QbD & Regulatory Impact:**  
  Severe collinearity between interaction terms can slip past this check, causing variance inflation of regression coefficients ($SE(\hat{\beta}_j) \gg 0$) while reporting spurious statistical significance.
- **Remediation:**  
  Use the 1-norm matrix condition estimator $\|R\|_1 \|R^{-1}\|_1$, exactly as already implemented in `doeGenerator.ts:1546` for `calculateDesignEfficiency`.

---

### STAT-07: Omission of Validation-Loss Early Stopping in Neural Network Training
- **Severity:** **HIGH**
- **File & Line Citation:** `src/services/neuralNetwork.ts:695-722, 1337-1364`
- **Mathematical Mechanism:**  
  In the Adam training loop across 1,000 epochs, `tourBestSelectionLoss` tracks minimum **training loss**, not validation loss:
  ```ts
  // neuralNetwork.ts:720-721
  // Validation observations never select an epoch or restart.
  const validationSelectionLoss = tourBestSelectionLoss;
  ```
  The network trains for all 1,000 epochs unconditionally without patience or early stopping based on $\mathcal{L}_{\text{val}}$.
- **QbD & Regulatory Impact:**  
  Pharmaceutical DoEs have small sample sizes ($N = 15$–$30$). Training a Multi-Layer Perceptron for 1,000 epochs overfits to experimental noise, yielding distorted response surfaces that misdirect Monte Carlo and desirability optimization.
- **Remediation:**  
  Implement early stopping: monitor validation loss after each epoch, stop if $\mathcal{L}_{\text{val}}$ fails to improve for 40 consecutive epochs (`patience = 40`), and restore the checkpoint weights corresponding to minimum $\mathcal{L}_{\text{val}}$.

---

### STAT-08: Statistical Process Control (SPC) Terminology Misclassification ($P_{pk}$ vs $C_{pk}$)
- **Severity:** **HIGH**
- **File & Line Citation:** `src/services/statistics.ts:1328-1339`
- **Mathematical Mechanism:**  
  In `runMonteCarloSimulation`:
  ```ts
  const sd = Math.sqrt(vals.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / Math.max(1, vals.length - 1));
  ...
  cpk = Number(Math.min(cpl, cpu).toFixed(2));
  ```
  Under ISO 21747 and AIAG SPC standards:
  - **Process Capability Index ($C_{pk}$):** Measures short-term potential within statistical control using within-subgroup variation ($\hat{\sigma}_{\text{within}} = \sqrt{MS_{\text{PureError}}}$).
  - **Process Performance Index ($P_{pk}$):** Measures long-term actual performance using overall sample standard deviation ($s_{\text{overall}}$):
    $$P_{pk} = \min \left( \frac{\bar{y} - LSL}{3 s_{\text{overall}}}, \frac{USL - \bar{y}}{3 s_{\text{overall}}} \right)$$
  Because `sd` is calculated across all 10,000 simulated batches incorporating model error and factor drifts, this metric is **rigorously $P_{pk}$, not $C_{pk}$**.
- **QbD & Regulatory Impact:**  
  Confusing $C_{pk}$ and $P_{pk}$ in regulatory dossiers generates audit observations (FDA Form 483), as $C_{pk}$ is expected to reflect inherent machine/process precision.
- **Remediation:**  
  Display both indices explicitly: $P_{pk}$ derived from overall simulation dispersion, and $C_{pk}$ derived from model residual variance $\sqrt{MS_{\text{Residual}}}$.

---

### STAT-09 to STAT-12: Intermediate Statistical Findings
- **STAT-09 (Medium): Missing Central Composite Inscribed (CCI) Design (`doeGenerator.ts:309-335`):** Standard rotatable CCD uses $\alpha = (2^k)^{1/4}$ ($1.682$ for $k=3$). If factor limits represent physical limits (e.g. 0%–100%), axial points land at impossible values (e.g. $-34.1\%$). Inscribed CCD resolves this by placing axial points at $[-1, +1]$ and compressing the factorial core to $[\pm 1/\alpha]$.
- **STAT-10 (Medium): Internally Studentized Residuals Mask Outliers (`statistics.ts:293-296, 591`):** Calculating $r_i = e_i / \sqrt{MS_{\text{res}}(1-h_{ii})}$ includes $e_i$ in the denominator, capping $|r_i| \le \sqrt{df_{\text{res}}}$. For small DoEs ($df < 9$), $|r_i|$ cannot exceed 3, rendering outlier filters ineffective. R-Student (externally studentized) residuals $t_i = r_i \sqrt{(n-p-1)/(n-p-r_i^2)}$ must be used.
- **STAT-11 (Medium): Overly Restrictive Parameter Bounds in ANN (`neuralNetwork.ts:444`):** The check `if (trainIdx.length <= parameterCount) return null;` rejects standard Box-Behnken designs ($N=15$, $N_{\text{train}}=12 \le P=16$) instead of auto-reducing hidden nodes.
- **STAT-12 (Medium): Missing Monte Carlo Convergence & Wilson CIs for Low PPM (`statistics.ts:1100-1376`):** For rare defects (e.g. 50 PPM), 10,000 runs produce zero defects purely by random chance ($SE = \sqrt{p(1-p)/N}$). Wilson score 95% confidence intervals must accompany all defect PPM estimates.

---

## 5. Pillar 2: Architecture & Code Quality

### ARCH-01: Exponential Candidate Pool Complexity ($5^k$) Leading to Client DoS
- **Severity:** **CRITICAL**
- **File & Line Citation:** `src/services/doeGenerator.ts:1286-1304, 1535`
- **Failure Mechanism:**  
  `generateCandidatePool(factors)` creates a full factorial grid with 5 levels per continuous factor (`[-1, -0.5, 0, 0.5, 1]`):
  $$\text{Pool Size} = 5^k$$
  - $k=4$: $625$ vectors
  - $k=6$: $15,625$ vectors
  - $k=8$: $390,625$ vectors
  - $k=10$: $9,765,625$ vectors ($\approx 10$ million coordinate arrays)
  In `calculateDesignEfficiency()` (`doeGenerator.ts:1535`), G-efficiency unconditionally iterates over this entire pool.
- **Real-World Impact:**  
  In pharmaceutical screening (Plackett-Burman or Fractional designs), scientists regularly evaluate 8–12 factors. Entering 8+ factors causes immediate gigabyte-scale memory allocation, crashing the browser tab with an Out-Of-Memory error and losing all unsaved work.
- **Remediation:**  
  Dynamically throttle candidate grid density based on factor count:
  ```ts
  const levels = k <= 4 ? [-1, -0.5, 0, 0.5, 1] : (k <= 6 ? [-1, 0, 1] : [-1, 1]);
  ```

---

### ARCH-04: Single Global Error Boundary Leaves Individual Tabs and Charts Unprotected
- **Severity:** **HIGH**
- **File & Line Citation:** `src/main.tsx:9`, `src/components/AppErrorBoundary.tsx:11`
- **Failure Mechanism:**  
  `AppErrorBoundary` wraps only the root `<App />` component. No localized boundaries exist around individual tabs or chart widgets (`PlotlyChart`).
- **Real-World Impact:**  
  A WebGL context loss in Plotly, a KaTeX formatting exception, or a singular matrix calculation during tab render unmounts the entire web application to a blank error screen. The user cannot navigate away or export their project.
- **Remediation:**  
  Wrap each lazy-loaded tab and `PlotlyChart` in modular error boundaries with fallback reset actions.

---

### ARCH-10: Monolithic State Centralization & 4-Level Prop Drilling
- **Severity:** **MEDIUM**
- **File & Line Citation:** `src/App.tsx:58-84, 482-585`
- **Failure Mechanism:**  
  All state (`project`, `selectedCQA`, `modelTypes`, `neuralConfigs`, `monteCarlo`) is centralized in `App.tsx` without React Context or an external store (Zustand). Props are drilled 2 to 4 levels down into 8 major tabs (`NeuralNetworkTab` receives 22 individual props).
- **Real-World Impact:**  
  Extreme architectural rigidity and refactoring overhead. Any localized input change causes root re-evaluation.
- **Remediation:**  
  Introduce a lightweight domain Context (`QBDProjectContext`) splitting project state, model results, and UI navigation.

---

### ARCH-11: Missing React 19 Concurrent Transitions (`useTransition`)
- **Severity:** **MEDIUM**
- **File & Line Citation:** `src/App.tsx:61, 470, 481-482`
- **Failure Mechanism:**  
  Switching tabs via `setActiveTab(tab)` executes as an urgent synchronous update. React immediately unmounts the current tab and mounts the Suspense fallback card, causing jarring visual flickering.
- **Real-World Impact:**  
  Degrades perceived performance; fails to leverage React 19 concurrent rendering where existing tabs remain visible until the incoming tab completes rendering.
- **Remediation:**  
  Wrap tab navigation in `startTransition(() => setActiveTab(nextTab))`.

---

### ARCH-12: Extreme Monolithic Component Scale
- **Severity:** **MEDIUM**
- **File & Line Citation:** `src/components/tabs/DoEDesignerTab.tsx` (3,097 lines), `NeuralNetworkTab.tsx` (2,911 lines), `HelpDrawer.tsx` (2,150 lines).
- **Failure Mechanism:**  
  Single files combine data fetching, complex linear algebra, table cell editing, modal states, and charting.
- **Real-World Impact:**  
  Excessive cognitive load, high defect density, and inability to write modular unit tests.
- **Remediation:**  
  Decompose tabs into modular subcomponents (`RunTableSpreadsheet`, `DesignSummaryCard`, `NeuralHyperparametersCard`).

---

### ARCH-08, ARCH-09, ARCH-13 to ARCH-18: Code Quality & Stability Matrix
- **ARCH-08 (Medium): Undiscriminated Diagnostic Unions Bypassed via `as any` (`statistics.ts:1070`):** `(model.diagnostics as any).stdDev ?? (model.diagnostics as any).rmseVal` bypasses TypeScript between polynomial and neural models, masking field renames.
- **ARCH-09 (Medium): Missing Compiler Strict Flags (`tsconfig.app.json`):** Lacks `"strict": true`, allowing implicit any and unchecked null values.
- **ARCH-13 (Medium): Cascading Re-Renders (`Navbar.tsx`, `HelpDrawer.tsx`):** Zero components use `React.memo`. Editing a text field in QTPP forces all 2,150 lines of `HelpDrawer` to re-render.
- **ARCH-14 (Medium): Uncleaned Timers (`DoEDesignerTab:909`, `NeuralNetworkTab:834`):** `setTimeout` handlers lack timer cleanup on unmount, attempting to set state on dead components.
- **ARCH-15 (Medium): Unvirtualized Experimental Run Tables (`DoEDesignerTab:880`):** Tables with hundreds of runs render unvirtualized, causing noticeable typing latency.
- **ARCH-16 (Medium): Empty Matrix Exceptions in `matMul` (`mathUtils.ts:6-21`):** Accessing `A[0].length` on an empty array throws `TypeError: Cannot read properties of undefined`.
- **ARCH-17 (Medium): Empty Residuals Evaluate to `Infinity` in Plotly (`StatisticalANOVATab:214`):** `Math.min(...[])` produces `Infinity`, crashing Plotly axis line rendering.
- **ARCH-18 (Medium): Unhandled Promise Rejections in Plotly (`PlotlyChart.tsx:321`):** `Plotly.react(...)` returns a Promise without a `.catch()` block.

---

## 6. Pillar 3: Performance & Bundle Optimization

### PERF-01: 100% UI-Thread Blocking via Synchronous Monte Carlo & ANN Backpropagation
- **Severity:** **CRITICAL**
- **File & Line Citation:** `src/services/statistics.ts:1100-1376`, `src/App.tsx:142-156`, `src/components/tabs/DesignSpaceTab.tsx:180-220`
- **Failure Mechanism:**  
  1. **Monte Carlo Engine:** Runs up to 100,000 iterations synchronously on the main thread. In `DesignSpaceTab.tsx:185-191`, a fake progress bar is simulated using nested `setTimeout` calls (15% -> 50% -> 85%) before invoking blocking computation:
     ```ts
     simulationTimer.current = setTimeout(() => {
       const mc = runMonteCarloSimulation(...); // SYNCHRONOUS BLOCKING COMPUTATION
       setSimProgress(100);
     }, 120);
     ```
  2. **ANN Backpropagation:** In `App.tsx:142-156`, neural network training executes inside React's `useMemo`. Training 5 folds $\times$ 10 restarts $\times$ 1,000 epochs requires up to **180,000 forward/backward passes** for 3 CQAs, all running synchronously during component rendering.
- **Real-World Impact:**  
  Browser tabs freeze completely for 3 to 10 seconds. Browsers display "Page Unresponsive" warning dialogs, and real-time loss tracking is impossible.
- **Remediation:**  
  Offload simulations and backpropagation to dedicated Web Workers (`monteCarlo.worker.ts` and `neuralTraining.worker.ts`) and post genuine progress updates via `postMessage`.

---

### PERF-02: Massive Production Bundle Chunks (Plotly.js 1.69 MB)
- **Severity:** **CRITICAL**
- **File & Line Citation:** `src/services/plotlyCustom.ts:1-12`, `dist/assets/PlotlyChart-IIgUD-l0.js`
- **Failure Mechanism:**  
  Although `plotlyCustom.ts` registers a partial module set, 3D surface and contour plots pull in entire WebGL subsystems, 3D vector kernels, and camera engines. The minified chunk is **1,689.29 kB (gzip: 553.40 kB)**.
- **Real-World Impact:**  
  Navigating to any tab containing graphs forces a 1.69 MB script download and parse, causing significant network and memory lag.
- **Remediation:**  
  Evaluate `plotly.js-basic-dist` or load Plotly dynamically via `React.lazy` on demand.

---

### PERF-03: Phantom / Dead Dependency in `package.json` (`mathjs`)
- **Severity:** **HIGH**
- **File & Line Citation:** `package.json:24`, `package-lock.json:21`
- **Failure Mechanism:**  
  `"mathjs": "^15.2.0"` is declared in `package.json`. A global search across `src/` confirms **exactly zero imports**. All linear algebra was implemented natively in `mathUtils.ts`.
- **Real-World Impact:**  
  Bloats `node_modules` by tens of megabytes, slows CI/CD install times, and increases vulnerability scanning noise.
- **Remediation:**  
  Remove `"mathjs"` via `npm uninstall mathjs`.

---

### PERF-04: Eager KaTeX Font Ingestion via Static HelpDrawer Import
- **Severity:** **HIGH**
- **File & Line Citation:** `src/App.tsx:22`, `src/components/HelpDrawer.tsx:27`, `src/components/MathView.tsx:2-3`
- **Failure Mechanism:**  
  `App.tsx` imports `HelpDrawer` statically. `HelpDrawer` imports `MathView`, which statically imports `katex` and `katex.min.css`. Consequently, the entire KaTeX library and **over 30 KaTeX web fonts** (.woff, .woff2, .ttf) are included in the entry chunk (`index-BRCvTn3Z.js`, **685.22 kB**), even though the drawer is closed on startup.
- **Real-World Impact:**  
  Delays initial page hydration (FCP and TTI) by loading ~250 kB of math rendering code unnecessarily.
- **Remediation:**  
  Lazy-load `HelpDrawer` via `React.lazy(() => import('./components/HelpDrawer'))` only when `isHelpOpen === true`.

---

### PERF-05 & PERF-06: State Memoization & Storage Exhaustion
- **PERF-05 (High): Zero `React.memo` and Zero `useCallback` in `App.tsx` (`App.tsx:1-617`):** All callbacks are recreated on every render cycle, triggering cascading re-renders across the entire virtual DOM tree on every keystroke.
- **PERF-06 (High): Unbounded LocalStorage Snapshots (`projectGovernance.ts:117-134`):** Deep-cloning 25 full project states containing serialized neural network weight matrices easily generates 5 MB+ of JSON, triggering browser `QuotaExceededError`.

---

## 7. Pillar 4: Security & Data Integrity

### SEC-01: KaTeX Error Fallback HTML Injection / Stored XSS
- **Severity:** **HIGH**
- **File & Line Citation:** `src/components/MathView.tsx:18-20, 32, 45-47, 64`
- **Failure Mechanism:**  
  `InlineMath` and `BlockMath` handle parsing errors as follows:
  ```ts
  try {
    return katex.renderToString(math, { displayMode: false, throwOnError: false });
  } catch {
    return math; // VULNERABILITY: Returns raw unescaped input string
  }
  ...
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
  ```
  If KaTeX fails to parse a formula, the raw input string is returned directly to `dangerouslySetInnerHTML`.
- **Real-World Impact:**  
  If a project JSON file containing malicious markup (e.g. `<img src=x onerror=alert(document.cookie)>`) in a factor or CQA formula field is imported, KaTeX throws a parse error and the malicious script executes immediately within the user's browser context (Cross-Site Scripting).
- **Remediation:**  
  Escape HTML entities before returning fallback content:
  ```ts
  const escapeHtml = (str: string) =>
    str.replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]!));
  } catch {
    return `<span class="katex-error">${escapeHtml(math)}</span>`;
  }
  ```

---

### SEC-02: Silent Drop of Project History upon LocalStorage Quota Failure
- **Severity:** **HIGH**
- **File & Line Citation:** `src/services/projectGovernance.ts:129`, `src/App.tsx:108-122`
- **Failure Mechanism:**  
  When `window.localStorage.setItem` throws `QuotaExceededError`, the catch block simply returns `false` without pruning old snapshots or evicting orphaned keys.
- **Real-World Impact:**  
  Users silently lose undo/redo and version history rollback capabilities without being prompted to prune data.
- **Remediation:**  
  Strip heavy model artifacts (`neuralArtifacts`) from historical snapshots, limit history depth to 10 versions, and migrate persistence to IndexedDB.

---

### SEC-03: CSV Formula Injection (DDE Execution) in Export Service
- **Severity:** **MEDIUM**
- **File & Line Citation:** `src/services/doeExcelService.ts:388-389`
- **Failure Mechanism:**  
  `downloadCSV` only escapes double quotes (`""`). Characters that trigger formula execution in spreadsheet software (`=`, `+`, `-`, `@`, `\t`, `\r`) are not sanitized.
- **Real-World Impact:**  
  Opening an exported CSV containing malicious factor or run names in Microsoft Excel or LibreOffice can trigger Dynamic Data Exchange (DDE) formula execution on the user's workstation.
- **Remediation:**  
  Prepend a single quote `'` to any cell value beginning with formula trigger characters:
  ```ts
  const sanitizeCell = (val: string) => (/^[=+@-|\t\r]/.test(val) ? `'${val}` : val);
  ```

---

### SEC-04 & SEC-05: Schema Validation & 21 CFR Part 11 Compliance
- **SEC-04 (Medium): Ad-hoc JSON Validation (`projectGovernance.ts:50-79`):** Project import relies on superficial property checks (`hasProjectStructure`) without a formal schema validator (e.g. Zod), leaving the application vulnerable to malformed payloads.
- **SEC-05 (High): 21 CFR Part 11 & GAMP 5 Compliance Disconnect (`ReportTab.tsx:1037-1061`, `ProjectGovernancePanel.tsx:46`):** The regulatory sign-off section in `ReportTab` contains static placeholder cards ("NGƯỜI LẬP BÁO CÁO", "TRƯỞNG PHÒNG R&D", "GIÁM ĐỐC QA") with decorative dotted lines. The application lacks cryptographic signatures, user authentication, and immutable audit trails. It must carry an explicit disclaimer: **Suitable solely for exploratory formulation R&D, not a 21 CFR Part 11 compliant electronic records system.**

---

## 8. Pillar 5: Test Coverage & Quality

### TEST-01: Rigorous OLS Regression Benchmarking Against NumPy SVD (Project Strength)
- **Status:** **EXEMPLARY SCIENTIFIC RIGOR**
- **File & Line Citation:** `src/services/statisticalReference.test.ts:1-120`, `fixtures/statistical-reference.json`
- **Verification Analysis:**  
  43 automated tests benchmark the OLS engine against independent reference datasets generated via NumPy 2.3.5 Singular Value Decomposition (SVD). The test suite verifies Householder QR coefficients, standard errors, $t$-values, $p$-values, ANOVA partition sums ($SS_{reg}, SS_{res}$), $R^2$, Adjusted $R^2$, Lack of Fit, Pure Error, PRESS, $Q^2$, Adequate Precision, Cook's Distance, and DFFITS within tight numerical tolerances ($10^{-5}$ to $10^{-7}$).

---

### TEST-02: Zero Test Coverage for React UI Components and Tabs
- **Severity:** **HIGH**
- **File & Line Citation:** `src/components/*`, `src/components/tabs/*` (18 source files, ~10,000 lines)
- **Verification Analysis:**  
  There are **zero UI test files** (`*.test.tsx`). No component testing library (`@testing-library/react`) is configured. Critical user interactions—factor clamping, run editing, ANOVA model switching, desirability sliders, and export gates—have zero automated regression protection.

---

### TEST-03: Zero Test Coverage for Word Report Generator (`reportGenerator.ts`)
- **Severity:** **HIGH**
- **File & Line Citation:** `src/services/reportGenerator.ts:1-1122` (1,122 lines, 45.9 kB)
- **Verification Analysis:**  
  `reportGenerator.ts` contains over 1,100 lines assembling complex regulatory Word reports (QTPP, Risk matrices, ANOVA regression tables, Control Strategies, PAR ranges). Despite its size, **not a single unit test exists for this file**.

---

### TEST-04: Silent Catch-All Block on Singular Design Matrices
- **Severity:** **HIGH**
- **File & Line Citation:** `src/services/statistics.ts:175-182`, `src/services/mathUtils.ts:125-135`
- **Verification Analysis:**  
  In `mathUtils.ts:128`, `solveLeastSquaresQR` detects rank deficiency and throws a descriptive error. However, `statistics.ts:175` wraps this call in a silent `catch { return null; }`. The function returns `null` without diagnostic details, and no unit test exercises this failure path.

---

### TEST-05: Missing Tests for Zero Response Variance Edge Cases ($SS_{tot} = 0$)
- **Severity:** **MEDIUM**
- **File & Line Citation:** `src/services/statistics.ts:190-205, 315-330`
- **Verification Analysis:**  
  When all response values are identical ($Y_i = c$), $SS_{\text{tot}} = 0$. In `statistics.ts:318`:
  ```ts
  const adjRSquared = 1 - (ssResidual / dfResidual) / (ssTotal / dfTotal); // Division by 0 yields NaN!
  ```
  `NaN` values propagate into ANOVA UI tables and Word exports. No unit tests assert zero variance behavior.

---

## 9. Prioritized Action Plan & Remediation Roadmap

```
+---------------------------------------------------------------------------------------------------------+
|                                    REMEDIATION IMPLEMENTATION ROADMAP                                   |
+----------+--------------------+-------------------------------------------+-----------------------------+
| Phase    | Target Window      | Core Objectives                           | Specific Action Items       |
+----------+--------------------+-------------------------------------------+-----------------------------+
| Phase 1  | Immediate Hotfixes | Eliminate client crashes, math inversion, | - Fix 5^k candidate pool    |
| (P0)     | (Sprint 0: 48h-1w) | and security injection vectors            | - Fix negative desirability |
|          |                    |                                           | - Sanitize KaTeX fallback   |
|          |                    |                                           | - Sanitize CSV export (DDE) |
|          |                    |                                           | - Guard empty matrix ops    |
+----------+--------------------+-------------------------------------------+-----------------------------+
| Phase 2  | Robustness & Arch  | Offload UI thread blocking, localize      | - Move MC & ANN to Workers  |
| (P1)     | (Sprint 1: 2-3w)   | error boundaries, prune storage           | - Localize Error Boundaries |
|          |                    |                                           | - Prune LocalStorage models |
|          |                    |                                           | - Add Canonical Analysis    |
|          |                    |                                           | - Add Early Stopping in ANN |
|          |                    |                                           | - Clarify Ppk vs Cpk SPC    |
+----------+--------------------+-------------------------------------------+-----------------------------+
| Phase 3  | Performance & Test | Bundle slimming, TypeScript strictness,   | - Lazy-load HelpDrawer/KaTeX|
| (P2)     | (Sprint 2: 3-4w)   | and test suite expansion                  | - Dynamic import for docx   |
|          |                    |                                           | - Remove mathjs dependency  |
|          |                    |                                           | - Enable "strict": true     |
|          |                    |                                           | - React.memo / useCallback  |
|          |                    |                                           | - Tests for reportGenerator |
+----------+--------------------+-------------------------------------------+-----------------------------+
| Phase 4  | GxP & Modernization| Enterprise data governance, formal schema,| - Zod schema validation     |
| (P3)     | (Roadmap: 2-3m)    | and non-normal Monte Carlo distributions  | - Non-normal MC samplers    |
|          |                    |                                           | - Component decomposition   |
|          |                    |                                           | - Full 2^(k-p) screening    |
|          |                    |                                           | - Regulatory R&D disclaimer |
+----------+--------------------+-------------------------------------------+-----------------------------+
```

### Phase 1: P0 Immediate Hotfixes (Sprint 0 — 48 Hours to 1 Week)
1. **Fix Candidate Pool Denial-of-Service (`ARCH-01`):** Cap factor candidate levels in `src/services/doeGenerator.ts` to prevent $5^k$ exponential memory allocation when $k \ge 5$.
2. **Fix Desirability Inversion Bug (`STAT-02`):** Correct boundary calculation in `src/services/mathUtils.ts:404-429` using symmetric absolute offsets (`target \pm delta`) to ensure $L < U$ for negative targets.
3. **Eliminate KaTeX Stored XSS (`SEC-01`):** Replace raw unescaped return in `src/components/MathView.tsx` with HTML-escaped output.
4. **Prevent CSV Formula Injection (`SEC-03`):** Prepend a single quote `'` to all cell values starting with `=`, `+`, `-`, `@` in `src/services/doeExcelService.ts`.
5. **Guard Matrix & Chart Boundary Exceptions (`ARCH-16`, `ARCH-17`):** Add empty-array checks to `matMul`, `matTranspose`, and `Math.min(...xPred)`.

### Phase 2: P1 Architectural Robustness & Mathematical Completeness (Sprint 1 — 2 to 3 Weeks)
1. **Offload Heavy Computation to Web Workers (`PERF-01`):** Move Monte Carlo simulation and multi-epoch ANN backpropagation off the main thread into Web Workers (`monteCarlo.worker.ts`, `neuralTraining.worker.ts`). Replace artificial `setTimeout` progress bars with authentic batch progress streams.
2. **Implement Granular Error Boundaries (`ARCH-04`):** Wrap each lazy-loaded tab and `PlotlyChart` in dedicated error boundaries to isolate component crashes.
3. **Prevent LocalStorage Quota Crashes (`PERF-06`, `SEC-02`):** Exclude serialized neural weight matrices (`neuralArtifacts`) from historical snapshots and limit history depth to 10 versions.
4. **Implement RSM Canonical Analysis (`STAT-01`):** Add Jacobi eigenvalue decomposition for the symmetric Hessian matrix $B$ to classify response surface stationary points (Maximum, Minimum, Saddle, Ridge).
5. **Add Validation-Loss Early Stopping to ANN (`STAT-07`):** Monitor validation loss and restore optimal checkpoint weights when validation loss ceases to improve.
6. **Correct SPC Metric Naming (`STAT-08`):** Accurately distinguish overall process performance ($P_{pk}$) from within-subgroup capability ($C_{pk}$).

### Phase 3: P2 Performance Modernization & Test Expansion (Sprint 2 — 3 to 4 Weeks)
1. **Lazy-Load HelpDrawer and KaTeX Fonts (`PERF-04`):** Dynamically load `HelpDrawer` via `React.lazy` on demand, saving ~250 kB of script and font assets from the initial bundle.
2. **Dynamic Import for `docx` Library (`PERF-02`):** Dynamically import `docx` in `src/services/reportGenerator.ts`, shaving ~400 kB from `ReportTab.js`.
3. **Remove Dead `mathjs` Dependency (`PERF-03`):** Run `npm uninstall mathjs` to eliminate unused dependencies.
4. **Enable TypeScript Strict Mode (`ARCH-09`):** Enable `"strict": true` in `tsconfig.app.json` and replace loose `as any` casts with discriminated unions.
5. **Stabilize Render Cascades (`PERF-05`, `ARCH-13`):** Wrap leaf components (`PlotlyChart`, `Navbar`, `TabNavigation`) in `React.memo` and memoize callbacks in `App.tsx` with `useCallback`.
6. **Expand Automated Test Coverage (`TEST-02`, `TEST-03`, `TEST-04`, `TEST-05`):**
   - Implement unit tests for `src/services/reportGenerator.ts` verifying document building;
   - Implement tests for singular matrix rejection diagnostics and zero response variance ($SS_{tot}=0$);
   - Add unit tests for `src/services/ternaryContour.ts` mesh and contour generation.

### Phase 4: P3 GxP Governance & Long-Term Roadmap (Strategic Roadmap — 2 to 3 Months)
1. **Formal Schema Validation (`SEC-04`):** Integrate Zod schema validation for all imported project JSON files with factor and run count limits.
2. **Expand Monte Carlo Distributions (`STAT-03`):** Implement Lognormal, Uniform, and Triangular random variate generators.
3. **Implement Full $2^{k-p}$ Fractional Generators & Alias Matrix (`STAT-04`, `STAT-05`):** Provide complete Resolution IV screening generators for $k=6, 7, 8$ along with full alias chain visualization.
4. **Component Modularization (`ARCH-10`, `ARCH-12`):** Decompose monolithic tabs (>3,000 lines) into modular subcomponents and introduce a central React Context.
5. **Regulatory Disclaimer & GxP Compliance Path (`SEC-05`):** Maintain prominent in-app disclaimers clarifying that the client-side tool is intended for exploratory R&D; outline server-side cryptographic audit ledger architecture for future 21 CFR Part 11 enterprise editions.

---
*Report synthesized and verified by Lead Technical Auditor (`worker_report_writer_1`). All diagnostics and line citations verified against the active workspace repository.*
