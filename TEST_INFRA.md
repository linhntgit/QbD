# QbD Studio™ — Comprehensive Testing Infrastructure & Methodology (TEST_INFRA)

## 1. Executive Overview & Testing Philosophy

### 1.1. Core Mission
The **Quality by Design (QbD) & DoE Pharmaceutical Formulation Suite** is a mission-critical scientific software platform intended for pharmaceutical formulation design, critical process parameter (CPP) screening, critical quality attribute (CQA) optimization, and regulatory dossier submission (ICH Q8(R2), ICH Q9(R1), ICH Q10, FDA 21 CFR Part 11, EU GMP Annex 11, ISO 19005 PDF/A).

In regulated pharmaceutical environments, scientific calculations and audit records must be **strictly reproducible, mathematically provable, and tamper-evident**. This document defines the four-tier opaque-box, requirement-driven test infrastructure governing all validation across the platform.

### 1.2. Opaque-Box & Requirement-Driven Methodology
The testing framework operates strictly on **opaque-box principles**:
1. **Public Contracts & Behavioral Verification**: Tests exercise public APIs, mathematical invariants, domain workflows, and observable outputs (data structures, cryptographic digests, statistical summaries, exported files) without dependency on internal private implementation details.
2. **Authoritative Expected Output Derivation**:
   - For statistical algorithms (DSD, ANOVA, Information Criteria), expected values are derived from peer-reviewed literature (Jones & Nachtsheim 2011, Derringer & Suich 1980, Hurvich & Tsai 1989, Piepel 1983) and verified against standard analytical oracles.
   - For cryptographic security, expected digests are validated against NIST FIPS 180-4 standard vectors.
   - For metaheuristic optimization, convergence is evaluated against known global Pareto optima and tolerance envelopes ($\le 10^{-5}$).
3. **Zero Facade / High-Integrity Testing**:
   - No mock assertions that trivially return true.
   - Every test verifies genuine numerical computation, boundary invariance, and error handling.
   - Strict resistance to false positives and silent failures.

---

## 2. Four-Tier Testing Hierarchy

```
+-------------------------------------------------------------------------+
|                  TIER 4: Real-World Pharma Scenarios                    |
|   (Tablet Granulation DSD, Liposomal Nanoparticles, mAb Lyophilization) |
+-------------------------------------------------------------------------+
                                    |
+-------------------------------------------------------------------------+
|                TIER 3: Cross-Feature Combinations (Pairwise)            |
|   (DSD -> GA Opt, Mixture -> ANN, XAI -> Benchmarking, GxP -> Lock)    |
+-------------------------------------------------------------------------+
                                    |
+-------------------------------------------------------------------------+
|                TIER 2: Boundary & Corner Cases (Stress & Robustness)    |
|   (Degenerate Hulls, Collinearity, Single-Point, Tamper Injections)    |
+-------------------------------------------------------------------------+
                                    |
+-------------------------------------------------------------------------+
|                TIER 1: Feature Coverage (Core Functional Units)         |
|   (>=5 tests per feature: DSD, GA, Mixture, XAI, Benchmarking, GxP)    |
+-------------------------------------------------------------------------+
```

### Tier 1: Feature Coverage ($\ge 5$ tests per feature)
Verifies nominal happy-path functionality for every feature identified in `ORIGINAL_REQUEST.md § 2026-09-12T01:35:03Z`:
- **Feature 1: Definitive Screening Design (DSD)**: Foldover conference matrix, run counts ($2m+1, 2m+3$), orthogonal main effects ($X_1^T X_1 = cI$), unconfounding with 2-factor interactions ($X_1^T X_2 = 0$), and unconfounding with quadratic curvature ($X_1^T X_i^2 = 0$).
- **Feature 2: Continuous Metaheuristic Desirability Optimizer**: Real-Coded Genetic Algorithm (RCGA) with Simulated Binary Crossover (SBX), adaptive polynomial mutation, Latin Hypercube initialization, and Nelder-Mead simplex local polishing for Derringer-Suich overall desirability $D = (\prod d_i^{w_i})^{1/\sum w_i}$.
- **Feature 3: Mixture Polyhedral Bound Constraints**: Piepel (1983) effective bounds calculation ($L_i^*, U_i^*$), consistency theorem check, McLean-Anderson/XVERT extreme vertices generation, and Euclidean projection onto the bounded simplex.
- **Feature 4: Explainable AI (XAI) for Neural Networks**: Garson's relative importance percentage algorithm, Olden's directional connection weights method, and Exact/Permutation Shapley values (SHAP) with additivity efficiency ($\sum \phi_i = \hat{y} - \phi_0$).
- **Feature 5: Multi-Model Benchmarking Table**: Head-to-head performance comparison of Polynomial RSM, ANN MLP, Support Vector Regression (SVR with SMO), and Ensemble Stacking (Akaike weights $w_i \propto \exp(-0.5 \Delta AICc_i)$) reporting $R^2, R^2_{adj}, RMSE, AICc, BIC$.
- **Feature 6: Cryptographic SHA-256 Tamper-Evident Audit Trail**: Pure TypeScript zero-dependency SHA-256 (FIPS 180-4), deterministic canonical JSON stringification, sequential hash-chain linkage $H(\text{prev} + \text{payload} + \text{action})$.
- **Feature 7: Integrity Verification Checksum Engine**: Sequential verification of chain continuity, instantaneous detection of 1-character modifications in historical entries or state snapshots.
- **Feature 8: 21 CFR Part 11 Electronic Sign-Off Workflow**: 3-tier sequential approval (Analyst $\to$ Reviewer $\to$ Approver), cryptographic signature binding, record locking, and tamper rejection.
- **Feature 9: Interactive 3D Design Space & Dynamic Slicing**: Sweet-spot surface mapping ($Z = \text{Margin}_{\min}$), zero-boundary reference plane ($Z = 0$), 3rd factor ($X_3$) dynamic slicing with PAR/NOR color range classification.
- **Feature 10: Regulatory Archival PDF/A & Word Exporter**: ISO 19005 compliant PDF/A container with embedded XMP metadata and SHA-256 audit root checksum, alongside Word .docx with 21 CFR Part 11 signature block.

### Tier 2: Boundary & Corner Cases ($\ge 5$ tests per feature)
Stresses the system at mathematical and operational extremes:
- Empty inputs, zero variances, degenerate hulls, and single-run configurations.
- Coincident bounds ($L_i = U_i$) and infeasible mixture spaces ($\sum L_i > 1$ or $\sum U_i < 1$).
- Perfectly collinear design matrices leading to near-singular $(X^T X)$.
- Single-character payload tampering across different keys and nested JSON fields.
- Neural networks with 0 hidden layers or negative degrees of freedom ($P \ge N$).
- Desirability functions with zero desirability on critical CQAs ($d_i = 0 \implies D = 0$).

### Tier 3: Cross-Feature Combinations (Pairwise & Pipeline Interactions)
Validates seamless data transfer and contract compliance between interconnected subsystems:
- **DSD $\to$ RSM / ANOVA**: Verifying that a DSD dataset with $2m+1$ runs correctly fits main effects and identifies active quadratic terms without matrix inversion breakdown.
- **Mixture Bounds $\to$ GA Optimizer**: Verifying that continuous metaheuristic search strictly respects polyhedral mixture constraints during SBX crossover and Nelder-Mead simplex steps without generating infeasible formulations.
- **ANN Training $\to$ XAI $\to$ Multi-Model Benchmarking**: Verifying that trained neural models feed exact weights into Garson/Olden/SHAP and produce consistent AICc/BIC metrics in the benchmarking table.
- **Project Snapshot $\to$ SHA-256 Hash Chain $\to$ 21 CFR Sign-Off $\to$ Lock Enforcement**: Verifying that signing a project updates the audit chain, locks subsequent modifications, and validates integrity.
- **3D Design Space $\to$ Proven Acceptable Range (PAR) $\to$ PDF/A & Word Reporting**: Verifying that PAR coordinates and sweet-spot boundaries are embedded faithfully into export reports.

### Tier 4: Real-World Pharmaceutical Formulation Scenarios
Executes end-to-end, multi-step industry workflows modeled after actual drug development programs:
- **Scenario 1: High-Shear Wet Granulation Tablet Development**:
  - 5 process parameters (Impeller Speed, Chopper Speed, Binder Addition Rate, Massing Time, Inlet Air Temp).
  - Definitive Screening Design (13 runs with 2 center runs) identifying critical parameters.
  - Multi-response desirability optimization for 3 CQAs: Tablet Hardness (Target 120 N), Friability (Minimization $<0.5\%$), Dissolution at 30 min (Target $85\%$).
  - Full GxP audit trail recording and 3-tier electronic sign-off.
- **Scenario 2: Long-Circulating Liposomal Nanoparticle Formulation**:
  - 3-component mixture (HSPC, Cholesterol, DSPE-mPEG2000) with restricted polyhedral bounds (Piepel bounds: $50-65\%$ HSPC, $30-40\%$ Chol, $5-10\%$ PEG-lipid).
  - Neural Network MLP training with small-sample Hurvich-Tsai AICc evaluation.
  - Explainable AI (Garson & SHAP) identifying dominant lipid interactions on Encapsulation Efficiency and Particle Size PDI.
  - Multi-model benchmarking comparing Quadratic Scheffé vs ANN MLP vs SVR vs Ensemble.
- **Scenario 3: Monoclonal Antibody (mAb) Lyophilization Cycle Optimization**:
  - Formulation excipients + Freeze-drying process parameters (Freezing Shelf Temp, Primary Drying Temp, Chamber Pressure).
  - 3D interactive design space sweet-spot surface generation with dynamic slicing across shelf temperature.
  - Regulatory archival PDF/A export embedding cryptographically verifiable audit root checksum.

---

## 3. Comprehensive Feature Inventory Matrix

| ID | Feature Name | Tier 1 (Coverage) | Tier 2 (Boundary) | Tier 3 (Cross-Feature) | Tier 4 (Pharma) | Primary Module |
|---|---|---|---|---|---|---|
| F01 | Definitive Screening Design (DSD) | $\ge 5$ tests | $\ge 5$ tests | DSD $\to$ ANOVA | Scenario 1 (Tablet) | `src/services/doeGenerator.ts` |
| F02 | Continuous GA Desirability Optimizer | $\ge 5$ tests | $\ge 5$ tests | GA $\to$ Mixture Bounds | Scenario 1 (Tablet) | `src/services/statistics.ts` |
| F03 | Mixture Polyhedral Bound Constraints | $\ge 5$ tests | $\ge 5$ tests | Mixture $\to$ ANN / GA | Scenario 2 (Liposome) | `src/services/mathUtils.ts` |
| F04 | Neural Network AICc/BIC Diagnostics | $\ge 5$ tests | $\ge 5$ tests | NN $\to$ Benchmarking | Scenario 2 (Liposome) | `src/services/neuralNetwork.ts` |
| F05 | Explainable AI (Garson, Olden, SHAP) | $\ge 5$ tests | $\ge 5$ tests | XAI $\to$ Feature Rank | Scenario 2 (Liposome) | `src/services/explainableAI.ts` |
| F06 | Multi-Model Benchmarking Table | $\ge 5$ tests | $\ge 5$ tests | Benchmarking $\to$ Ensemble | Scenario 2 (Liposome) | `src/services/modelBenchmarking.ts` |
| F07 | Cryptographic SHA-256 Audit Trail | $\ge 5$ tests | $\ge 5$ tests | Hash Chain $\to$ Snapshot | Scenario 1 & 3 | `src/services/cryptoSha256.ts` |
| F08 | Integrity Checksum Engine | $\ge 5$ tests | $\ge 5$ tests | Checksum $\to$ Tamper Alarm | Scenario 1 & 3 | `src/services/projectGovernance.ts` |
| F09 | 21 CFR Part 11 Electronic Sign-Off | $\ge 5$ tests | $\ge 5$ tests | Sign-Off $\to$ State Lock | Scenario 1 & 3 | `src/services/projectGovernance.ts` |
| F10 | 3D Design Space & Dynamic Slicing | $\ge 5$ tests | $\ge 5$ tests | 3D Space $\to$ PAR Bounds | Scenario 3 (Lyophilization) | `src/components/tabs/DesignSpaceTab.tsx` |
| F11 | Regulatory Archival PDF/A & Word | $\ge 5$ tests | $\ge 5$ tests | Report $\to$ Audit Digest | Scenario 3 (Lyophilization) | `src/services/pdfReportGenerator.ts` |

---

## 4. Test Suite Architecture & File Organization

All automated end-to-end and integration test suites reside under `src/test/e2e/` and are executed via Vitest:

```
src/test/
├── e2e/
│   ├── dsdScreeningWorkflow.test.ts      # E2E DSD factor definition, conference matrix & orthogonality
│   ├── optimizationWorkflow.test.ts      # E2E Continuous GA optimizer, Desirability & Mixture constraints
│   ├── gxpGovernanceWorkflow.test.ts     # E2E SHA-256 hash chain, tamper detection & 3-tier sign-off
│   └── xaiBenchmarkingWorkflow.test.ts   # E2E ANN diagnostics, Garson/Olden/SHAP & Multi-model arena
```

### 4.1. Suite 1: `dsdScreeningWorkflow.test.ts`
- **Scope**: End-to-end factor configuration, 3-level conference matrix generation, foldover pairing, center point insertion, mathematical orthogonality verification, and export compliance.
- **Key Invariants Tested**:
  1. $N = 2m + 1$ (even $m$) or $N = 2m + 3$ (odd $m$) base runs + $n_0$ center runs.
  2. $X_1^T X_1 = c \cdot I$ (all main effects are completely uncorrelated).
  3. $X_1^T X_2 = 0$ (all main effects are orthogonal to all 2-factor interactions).
  4. $X_1^T (X_i^2) = 0$ (all main effects are orthogonal to pure quadratic terms).
  5. Deterministic generation with seeded pseudo-random number generators.

### 4.2. Suite 2: `optimizationWorkflow.test.ts`
- **Scope**: Multi-response goal setup, Derringer-Suich individual and global desirability calculation, hybrid real-coded genetic algorithm (RCGA) search, Nelder-Mead simplex local tuning, and Piepel mixture polytope constraints.
- **Key Invariants Tested**:
  1. Global desirability $D = (\prod d_i^{w_i})^{1/\sum w_i} \in [0, 1]$.
  2. Zero-tolerance propagation: if any $d_i = 0$, then $D = 0$.
  3. Continuous optimizer convergence within $\le 10^{-5}$ of known analytical optima.
  4. Piepel effective bounds $L_i^* = \max(L_i, 1 - \sum_{j \ne i} U_j)$, $U_i^* = \min(U_i, 1 - \sum_{j \ne i} L_j)$ consistency ($L_i^* \le U_i^*$).
  5. Exact preservation of mixture sum-to-one constraint ($\sum x_i = 1.0$) across all GA iterations.

### 4.3. Suite 3: `gxpGovernanceWorkflow.test.ts`
- **Scope**: Project initialization, canonical JSON stringification, sequential SHA-256 hash-chain ledger, single-character tamper detection, and 21 CFR Part 11 / EU GMP Annex 11 electronic sign-off workflow.
- **Key Invariants Tested**:
  1. SHA-256 implementation conforms strictly to NIST FIPS 180-4 test vectors.
  2. Canonical JSON stringification produces identical hashes regardless of object key order.
  3. Audit trail chain linkage: Entry $i$ cryptographically binds to Entry $i-1$ via `previousHash`.
  4. 1-character modification in any payload or history field triggers immediate invalidation (`isValid: false`) and pinpoints the tampered index.
  5. Electronic sign-off sequence enforces role order (Analyst $\to$ Reviewer $\to$ Approver) and successfully locks the project against subsequent writes.

### 4.4. Suite 4: `xaiBenchmarkingWorkflow.test.ts`
- **Scope**: Training dataset ingestion, multi-layer perceptron neural network training, Hurvich-Tsai small-sample corrected AICc, BIC, adjusted $R^2$, Garson's algorithm, Olden's connection weight method, Exact SHAP values, and multi-model benchmarking against Polynomial RSM and SVR.
- **Key Invariants Tested**:
  1. Hurvich-Tsai correction: $\text{AICc} = 2p + \frac{2p(p+1)}{n - p - 1} - 2\ln(L)$ penalizes high parameter counts.
  2. Garson's feature importance sums to exactly $100\%$ ($\sum I_i = 1.0$).
  3. Olden's directional weights correctly reflect positive/negative connection paths.
  4. SHAP efficiency property holds exactly: $\sum_{i=1}^k \phi_i = \hat{y}(x) - E[Y]$.
  5. Multi-model benchmarking table correctly computes and ranks models by Akaike weights $w_i \propto \exp(-0.5 \Delta \text{AICc}_i)$.

---

## 5. Verification Commands & Quality Gates

| Check | Tool / Command | Pass Criteria |
|---|---|---|
| E2E Test Suite | `cmd /c "npm test"` | 100% test files pass, 0 failed tests |
| TypeScript Compiler | `cmd /c "npm run build"` | Zero type errors (`tsc -b` exits with 0) |
| Static Analysis / Linter | `cmd /c "npm run lint"` | 0 warnings, 0 errors (`oxlint` clean) |

---

## 6. Document Metadata & Approval
- **Document Version**: 1.0.0
- **Release Date**: 2026-09-12
- **Author**: E2E Test Suite Creator (Teamwork QA Agent)
- **Status**: ACTIVE & RATIFIED
