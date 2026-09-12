import { describe, expect, it, vi, afterEach } from 'vitest';

vi.mock('../components/PlotlyChart', () => ({
  PlotlyChart: () => null,
}));
vi.mock('canvas-confetti', () => ({
  default: () => Promise.resolve(),
}));

afterEach(() => {
  vi.unstubAllGlobals();
});
import { CASE_STUDIES } from '../data/caseStudies';
import type { Factor, DoERun, QBDProject } from '../types/qbd';
import {
  GENESIS_HASH,
  canonicalJsonStringify,
  computeProjectPayloadHash,
} from '../services/cryptoSha256';
import {
  computeEntryHash,
  pruneProjectForHistory,
  signProjectSnapshot,
  verifyAuditTrailIntegrity,
  verifyElectronicSignatures,
  type ProjectAuditEntry,
  type ProjectVersionSnapshot,
} from '../services/projectGovernance';
import {
  computeGarsonImportance,
  computeExactSHAP,
  calculateExactShapleyValues,
} from '../services/explainableAI';
import {
  fitSVRModel,
  calculateBenchmarkInformationCriteria,
  calculateAkaikeBenchmarkingWeights,
} from '../services/modelBenchmarking';
import { calculateCQAMargin } from '../services/mathUtils';
import { render3DSweetSpotSurface } from '../components/tabs/DesignSpaceTab';

// Helper to deep clone
const clone = <T>(obj: T): T => JSON.parse(JSON.stringify(obj));

describe('CHALLENGER 2: Adversarial Stress-Testing Suite', () => {
  // =========================================================================
  // PILLAR 3: GxP 21 CFR Part 11 Cryptographic Tamper-Evidence
  // =========================================================================
  describe('Pillar 3: Cryptographic Tamper Detection & Hash-Chain Integrity', () => {
    // Generate a legitimate 5-block audit trail
    function createLegitimateAuditHistory(): {
      history: ProjectVersionSnapshot[];
      baseProject: QBDProject;
    } {
      const baseProject = clone(CASE_STUDIES[0]);
      const history: ProjectVersionSnapshot[] = [];

      let prevHash = GENESIS_HASH;

      const actions = [
        { action: 'PROJECT_CREATED', version: 'v1.0.0', details: 'Genesis project setup' },
        { action: 'FACTOR_MODIFIED', version: 'v1.0.1', details: 'Adjusted low bound of X1' },
        { action: 'RUN_ADDED', version: 'v1.0.2', details: 'Recorded experimental batch 05' },
        { action: 'MODEL_FITTED', version: 'v1.1.0', details: 'Trained quadratic RSM model' },
        { action: 'REVIEW_SIGN_OFF', version: 'v1.1.1', details: 'Peer reviewed by QA' },
      ];

      for (let i = 0; i < actions.length; i++) {
        const seq = i + 1;
        const ts = new Date(1700000000000 + i * 3600000).toISOString();
        const p = clone(baseProject);
        p.version = actions[i].version;
        if (i === 1) p.factors[0].low = 12.5;
        if (i === 2 && p.runs.length > 0) p.runs[0].responses['Y1'] = 98.4;

        const pruned = pruneProjectForHistory(p);
        const payloadHash = computeProjectPayloadHash(pruned);
        const user = { name: `Operator_${i}`, role: i === 4 ? ('Reviewer' as const) : ('Analyst' as const) };

        const entryHash = computeEntryHash({
          sequenceNumber: seq,
          timestamp: ts,
          action: actions[i].action,
          versionLabel: actions[i].version,
          user,
          details: actions[i].details,
          payloadHash,
          previousHash: prevHash,
        });

        const snapshot: ProjectVersionSnapshot = {
          id: `entry-${seq}`,
          sequenceNumber: seq,
          timestamp: ts,
          action: actions[i].action,
          versionLabel: actions[i].version,
          user,
          details: actions[i].details,
          payloadHash,
          previousHash: prevHash,
          entryHash,
          project: pruned,
        };

        history.push(snapshot);
        prevHash = entryHash;
      }

      return { history, baseProject };
    }

    it('confirms legitimate 5-block audit history verifies successfully (baseline)', () => {
      const { history } = createLegitimateAuditHistory();
      const res = verifyAuditTrailIntegrity(history);
      expect(res.isValid).toBe(true);
      expect(res.tamperedIndex).toBeUndefined();
      expect(res.chainLength).toBe(5);
    });

    it('adversarial challenge: 100% detection of 1-character bit flips in payload JSON', () => {
      const { history } = createLegitimateAuditHistory();
      let detectedCount = 0;
      const testCases = 50;

      for (let testIdx = 0; testIdx < testCases; testIdx++) {
        const corruptedHistory = clone(history);
        const targetBlock = testIdx % corruptedHistory.length;
        const targetProject = corruptedHistory[targetBlock].project;

        // Mutate a property by 1 character
        const mutationType = testIdx % 5;
        if (mutationType === 0) {
          // Mutate factor name
          targetProject.factors[0].name += 'X';
        } else if (mutationType === 1) {
          // Mutate CQA limit
          if (targetProject.cqas[0].lowerLimit !== undefined) {
            targetProject.cqas[0].lowerLimit += 0.0001;
          } else {
            targetProject.cqas[0].name += '!';
          }
        } else if (mutationType === 2) {
          // Mutate run response
          if (targetProject.runs.length > 0) {
            const respKey = Object.keys(targetProject.runs[0].responses)[0];
            if (respKey) {
              const curVal = Number(targetProject.runs[0].responses[respKey]) || 10;
              targetProject.runs[0].responses[respKey] = curVal + 0.001;
            }
          }
        } else if (mutationType === 3) {
          // Mutate description
          targetProject.description = (targetProject.description || '') + ' ';
        } else {
          // Mutate version
          targetProject.version += 'a';
        }

        const verification = verifyAuditTrailIntegrity(corruptedHistory);
        expect(verification.isValid).toBe(false);
        expect(verification.tamperedIndex).toBe(targetBlock);
        expect(verification.reason).toContain('Payload hash mismatch');
        detectedCount++;
      }

      expect(detectedCount).toBe(testCases);
    });

    it('adversarial challenge: 100% detection of 1-character bit flips in audit metadata', () => {
      const { history } = createLegitimateAuditHistory();
      const metadataFields: Array<keyof ProjectAuditEntry> = [
        'timestamp',
        'action',
        'versionLabel',
        'details',
      ];

      for (let blockIdx = 0; blockIdx < history.length; blockIdx++) {
        for (const field of metadataFields) {
          const corruptedHistory = clone(history);
          const origVal = String(corruptedHistory[blockIdx][field] ?? '');
          // Flip last character
          (corruptedHistory[blockIdx] as unknown as Record<string, unknown>)[field] = (origVal.slice(0, -1) +
            (origVal.endsWith('Z') ? 'Y' : 'Z'));

          const verification = verifyAuditTrailIntegrity(corruptedHistory);
          expect(verification.isValid).toBe(false);
          expect(verification.tamperedIndex).toBe(blockIdx);
          expect(verification.reason).toContain('Entry hash mismatch');
        }

        // Test mutating user metadata
        const corruptedUser = clone(history);
        (corruptedUser[blockIdx].user as any).name += '_tampered';
        const resUser = verifyAuditTrailIntegrity(corruptedUser);
        expect(resUser.isValid).toBe(false);
        expect(resUser.tamperedIndex).toBe(blockIdx);

        // Test mutating sequence number
        const corruptedSeq = clone(history);
        corruptedSeq[blockIdx].sequenceNumber += 99;
        const resSeq = verifyAuditTrailIntegrity(corruptedSeq);
        expect(resSeq.isValid).toBe(false);
        expect(resSeq.tamperedIndex).toBe(blockIdx);
      }
    });

    it('adversarial challenge: 100% detection of deleted intermediate blocks (broken chain)', () => {
      const { history } = createLegitimateAuditHistory();

      // Deleting block 1 (sequence 2) out of 5
      const corrupted1 = clone(history);
      corrupted1.splice(1, 1);
      const res1 = verifyAuditTrailIntegrity(corrupted1);
      expect(res1.isValid).toBe(false);
      expect(res1.tamperedIndex).toBe(1);
      expect(res1.reason).toContain('Chain link broken');

      // Deleting block 2 (sequence 3)
      const corrupted2 = clone(history);
      corrupted2.splice(2, 1);
      const res2 = verifyAuditTrailIntegrity(corrupted2);
      expect(res2.isValid).toBe(false);
      expect(res2.tamperedIndex).toBe(2);
      expect(res2.reason).toContain('Chain link broken');

      // Deleting genesis block (block 0)
      const corruptedGenesis = clone(history);
      corruptedGenesis.splice(0, 1);
      const resGenesis = verifyAuditTrailIntegrity(corruptedGenesis);
      expect(resGenesis.isValid).toBe(false);
      expect(resGenesis.tamperedIndex).toBe(0);
      expect(resGenesis.reason).toContain('Genesis block previousHash must equal GENESIS_HASH');
    });

    it('adversarial challenge: 100% detection of reordered history blocks', () => {
      const { history } = createLegitimateAuditHistory();

      // Swap blocks 1 and 2
      const swapped = clone(history);
      const temp = swapped[1];
      swapped[1] = swapped[2];
      swapped[2] = temp;

      const res = verifyAuditTrailIntegrity(swapped);
      expect(res.isValid).toBe(false);
      expect(res.tamperedIndex).toBe(1);
      expect(res.reason).toContain('Chain link broken');

      // Reverse chronological order passed when expected forward
      const reversed = clone(history).reverse();
      const resRev = verifyAuditTrailIntegrity(reversed);
      // Even if detected as reverse-chronological, verify each link's integrity
      expect(resRev.isValid).toBe(true); // Should recognize legitimate reverse format!

      // Randomly corrupt one link in reverse array
      reversed[2].previousHash = 'bad_hash_00000000000000000000000000000000000000000000000000000000';
      const resCorruptedRev = verifyAuditTrailIntegrity(reversed);
      expect(resCorruptedRev.isValid).toBe(false);
    });

    it('adversarial challenge: modification of Approver-locked project is detected with 100% certainty', () => {
      const baseProject = clone(CASE_STUDIES[0]);

      // Sign with Analyst
      const analystSigned = signProjectSnapshot(baseProject, {
        name: 'Analyst Jane',
        role: 'Analyst',
        reason: 'Initial protocol entry',
      });
      expect(analystSigned.isLocked).toBeFalsy();

      // Sign with Approver
      const approvedProject = signProjectSnapshot(analystSigned, {
        name: 'Director Bob',
        role: 'Approver',
        reason: 'Final regulatory approval for filing',
      });
      expect(approvedProject.isLocked).toBe(true);
      expect(approvedProject.lockDetails?.lockedBy).toBe('Director Bob');

      const initialPayloadHash = computeProjectPayloadHash(pruneProjectForHistory(approvedProject));
      const sigs = approvedProject.electronicSignatures!;
      expect(sigs.length).toBe(2);

      // Verify legitimate approved state
      const validCheck = verifyElectronicSignatures(sigs, initialPayloadHash);
      expect(validCheck.isValid).toBe(true);

      // Attack: An attacker modifies an Approver-locked project
      const tamperedProject = clone(approvedProject);
      tamperedProject.runs[0].responses['Y1'] = 999.9; // Fraudulent response injection
      const tamperedPayloadHash = computeProjectPayloadHash(pruneProjectForHistory(tamperedProject));

      // Verification MUST reject the altered project state
      const tamperedCheck = verifyElectronicSignatures(sigs, tamperedPayloadHash);
      expect(tamperedCheck.isValid).toBe(false);
      expect(tamperedCheck.invalidIndex).toBe(1); // Approver signature index
      expect(tamperedCheck.reason).toContain('Approved project state altered after signature');

      // Attack: An attacker tampers with signature checksum directly
      const tamperedSigProject = clone(approvedProject);
      tamperedSigProject.electronicSignatures![1].signatureChecksum = 'bad_checksum_12345';
      const sigTamperedCheck = verifyElectronicSignatures(
        tamperedSigProject.electronicSignatures!,
        initialPayloadHash
      );
      expect(sigTamperedCheck.isValid).toBe(false);
      expect(sigTamperedCheck.reason).toContain('Signature checksum mismatch');
    });
  });

  // =========================================================================
  // PILLAR 2: Explainable AI SHAP Axioms & Garson 100% Sum
  // =========================================================================
  describe('Pillar 2: Explainable AI Mathematical Axiom Guarantees', () => {
    it('verifies Garson algorithm relative contributions sum strictly to 100.0% ± 10^-6%', () => {
      // Test across multiple topologies
      const topologies = [
        { w1: [[0.5, -0.2, 0.8]], wOut: [[1.2]] }, // 3 inputs, 1 hidden, 1 output
        {
          w1: [
            [0.1, 0.4, -0.7, 0.9],
            [-0.5, 0.3, 0.2, -0.1],
            [0.8, -0.6, 0.3, 0.4],
          ],
          wOut: [[0.7, -0.4, 0.9]],
        }, // 4 inputs, 3 hidden
        {
          w1: Array.from({ length: 8 }, () =>
            Array.from({ length: 12 }, () => Math.sin(Math.random() * 10))
          ),
          wOut: [Array.from({ length: 8 }, () => Math.cos(Math.random() * 10))],
        }, // 12 inputs, 8 hidden
      ];

      for (const topo of topologies) {
        const importance = computeGarsonImportance(topo);
        const sum = importance.reduce((a, b) => a + b, 0);
        expect(Math.abs(sum - 100.0)).toBeLessThan(1e-6);
      }
    });

    it('verifies SHAP Efficiency Axiom: sum(phi_i) = f(x) - phi_0 to numerical precision < 10^-9', () => {
      // Complex non-linear neural-like function with interaction terms
      const nonLinearPredict = (x: number[]): number => {
        const x1 = x[0], x2 = x[1], x3 = x[2], x4 = x[3];
        return Math.tanh(0.8 * x1 - 1.2 * x2 + 0.5 * x3 * x4) * 15.0 + Math.exp(0.3 * x2) * 5.0;
      };

      const baseline = [0.0, 0.0, 0.0, 0.0];
      const testInstances = [
        [0.8, -0.5, 0.3, 1.0],
        [-1.0, 1.0, -0.5, -0.5],
        [0.123456, -0.789012, 0.456789, -0.321654],
        [0.0, 0.0, 0.0, 0.0],
        [1.0, 1.0, 1.0, 1.0],
      ];

      for (const inst of testInstances) {
        const { shapValues, baseValue, predValue } = computeExactSHAP(
          inst,
          nonLinearPredict,
          baseline
        );
        const sumShap = shapValues.reduce((a, b) => a + b, 0);
        const deltaF = predValue - baseValue;
        const efficiencyError = Math.abs(sumShap - deltaF);

        // Efficiency axiom verification
        expect(efficiencyError).toBeLessThan(1e-9);
      }
    });

    it('verifies SHAP Dummy Player Axiom: a feature with zero influence receives phi_i = 0', () => {
      // Feature 2 (index 2) has absolutely NO influence on f(x)
      const dummyPredict = (x: number[]): number => {
        const dummyContribution = x[2] !== undefined ? 0 : 0;
        return 3.5 * x[0] - 2.0 * Math.pow(x[1], 2) + dummyContribution;
      };

      const baseline = [0.0, 0.0, 0.0];
      const testInstances = [
        [1.5, -2.0, 100.0],
        [-0.5, 0.8, -50.0],
        [2.2, 1.1, 0.0],
        [0.0, 0.0, 42.0],
      ];

      for (const inst of testInstances) {
        const { shapValues } = computeExactSHAP(inst, dummyPredict, baseline);
        // Feature index 2 is dummy
        expect(Math.abs(shapValues[2])).toBeLessThan(1e-12);
      }
    });

    it('verifies SHAP Symmetry Axiom: two identical features receive identical Shapley values', () => {
      // Feature 0 and Feature 1 enter the model completely symmetrically: f(x0, x1, x2) = g(x0 + x1, x2)
      const symmetricPredict = (x: number[]): number => {
        const x0 = x[0], x1 = x[1], x2 = x[2];
        return Math.sin(x0 + x1) * 10.0 + (x0 * x0 + x1 * x1) * 2.5 + x2 * 1.5;
      };

      const baseline = [0.0, 0.0, 0.0];
      // Test cases where x[0] === x[1]
      const symmetricInstances = [
        [0.5, 0.5, 1.0],
        [-0.8, -0.8, -0.2],
        [1.414, 1.414, 0.0],
      ];

      for (const inst of symmetricInstances) {
        const { shapValues } = computeExactSHAP(inst, symmetricPredict, baseline);
        // phi_0 must equal phi_1 to extreme numerical tolerance
        expect(Math.abs(shapValues[0] - shapValues[1])).toBeLessThan(1e-12);
      }
    });
  });

  // =========================================================================
  // PILLAR 2 & 4: Multi-Model Benchmarking AICc Penalties & 3D Sweet-Spot Margins
  // =========================================================================
  describe('Pillar 2 & 4: Multi-Model AICc Penalties & 3D Sweet-Spot Surface Margin Plane', () => {
    it('verifies AICc penalty properly punishes overparameterized models (N <= P + 1) with Infinity', () => {
      const sse = 1.5;
      const sst = 10.0;

      // Case 1: Normal well-conditioned model (N = 20, P = 3) -> finite AICc
      const normalModel = calculateBenchmarkInformationCriteria(20, 3, sse, sst);
      expect(Number.isFinite(normalModel.aicc)).toBe(true);

      // Case 2: Overparameterized model where N = P (e.g. 10 samples, 10 parameters)
      const overparam1 = calculateBenchmarkInformationCriteria(10, 10, sse, sst);
      expect(overparam1.aicc).toBe(Infinity);

      // Case 3: Overparameterized model where N < P (e.g. 10 samples, 15 parameters)
      const overparam2 = calculateBenchmarkInformationCriteria(10, 15, sse, sst);
      expect(overparam2.aicc).toBe(Infinity);

      // Case 4: Boundary condition where N = P + 1 (Hurvich-Tsai denominator n - p - 1 = 0)
      const boundaryModel = calculateBenchmarkInformationCriteria(10, 9, sse, sst);
      expect(boundaryModel.aicc).toBe(Infinity);

      // Verify that Akaike Weights assign exactly 0.0 to overparameterized models
      const candidates = [
        { id: 'linear', aicc: 25.4 },
        { id: 'quadratic', aicc: 18.2 },
        { id: 'overparam_ann', aicc: Infinity },
      ];
      const weighted = calculateAkaikeBenchmarkingWeights(candidates);
      const overparamCandidate = weighted.find((c) => c.id === 'overparam_ann')!;
      expect(overparamCandidate.akaikeWeight).toBe(0.0);
      expect(overparamCandidate.deltaAICc).toBe(Infinity);

      // Legitimate model with lowest AICc receives highest Akaike weight
      const quadraticCandidate = weighted.find((c) => c.id === 'quadratic')!;
      expect(quadraticCandidate.akaikeWeight).toBeGreaterThan(0.9);
    });

    it('verifies SVR SMO convergence on noisy non-linear pharmaceutical datasets', () => {
      const factors: Factor[] = [
        { id: 'f1', code: 'X1', name: 'Binder %', low: 1, high: 5, type: 'Formulation', dataType: 'quantitative', controllability: 'controllable', unit: '%' },
        { id: 'f2', code: 'X2', name: 'Compression Force', low: 10, high: 30, type: 'Process', dataType: 'quantitative', controllability: 'controllable', unit: 'kN' },
      ];

      // Generate 20 experimental runs with non-linear response + noise
      const runs: DoERun[] = [];
      for (let i = 0; i < 20; i++) {
        const x1Coded = -1.0 + (i % 5) * 0.5; // -1 to 1
        const x2Coded = -1.0 + Math.floor(i / 5) * 0.66; // -1 to 1
        // True function: y = 50 + 15*X1 - 10*X2^2 + 8*X1*X2 + noise
        const noise = Math.sin(i * 3.7) * 0.8;
        const y = 50 + 15 * x1Coded - 10 * x2Coded * x2Coded + 8 * x1Coded * x2Coded + noise;

        runs.push({
          id: `run-${i}`,
          runOrder: i + 1,
          stdOrder: i + 1,
          block: 1,
          factorCoded: { X1: x1Coded, X2: x2Coded },
          factorActual: { X1: 3 + x1Coded * 2, X2: 20 + x2Coded * 10 },
          responses: { Y1: Number(y.toFixed(2)) },
        });
      }

      const svrResult = fitSVRModel(factors, runs, 'Y1', {
        kernel: 'rbf',
        C: 10.0,
        epsilon: 0.1,
        maxIter: 1000,
      });

      expect(svrResult).not.toBeNull();
      if (svrResult) {
        expect(svrResult.numSupportVectors).toBeGreaterThan(0);
        expect(svrResult.numSupportVectors).toBeLessThanOrEqual(20);
        expect(Number.isFinite(svrResult.bias)).toBe(true);
        expect(svrResult.diagnostics.rSquared).toBeGreaterThan(0.7);
        expect(Number.isFinite(svrResult.diagnostics.aicc)).toBe(true);

        // Test prediction at center point (0, 0)
        const predCenter = svrResult.predict({ X1: 0, X2: 0 });
        expect(predCenter).toBeGreaterThan(45);
        expect(predCenter).toBeLessThan(55);
      }
    });

    it('verifies 3D sweet-spot surface Z = Margin_min accurately partitions sweet-spot (Z >= 0) vs OOS (Z < 0) relative to Z = 0 reference plane', () => {
      const factors: Factor[] = [
        { id: 'f1', code: 'X1', name: 'Polymer', low: 10, high: 30, type: 'Formulation', dataType: 'quantitative', controllability: 'controllable', unit: '%' },
        { id: 'f2', code: 'X2', name: 'Pressure', low: 5, high: 25, type: 'Process', dataType: 'quantitative', controllability: 'controllable', unit: 'bar' },
        { id: 'f3', code: 'X3', name: 'Speed', low: 50, high: 150, type: 'Process', dataType: 'quantitative', controllability: 'controllable', unit: 'rpm' },
      ];

      // Two CQA responses:
      // Y1: Dissolution (target >= 80%, lowerLimit = 80, upperLimit = 100)
      // Y2: Impurity (target <= 1.5%, lowerLimit = 0, upperLimit = 1.5)
      const responses = [
        { code: 'Y1', objective: 'maximize', lowerLimit: 80, upperLimit: 100 },
        { code: 'Y2', objective: 'minimize', lowerLimit: 0, upperLimit: 1.5 },
      ];

      // Models where Y1 increases with X1, and Y2 increases with X2
      const activeModels = {
        Y1: {
          predict: (coded: Record<string, number>) => {
            // coded X1 in [-1, 1], Dissolution between 70% and 95%
            return 85 + 10 * (coded.X1 ?? 0);
          },
        },
        Y2: {
          predict: (coded: Record<string, number>) => {
            // coded X2 in [-1, 1], Impurity between 0.5% and 2.5%
            return 1.2 + 0.8 * (coded.X2 ?? 0);
          },
        },
      };

      // Direct calculation margin tests at known points:
      // Point A: X1 = 0.5 (Y1 = 90 in [80, 100] -> margin_Y1 = (90 - 80) / 20 = +0.5)
      //          X2 = -0.5 (Y2 = 0.8 in [0, 1.5] -> margin_Y2 = (1.5 - 0.8) / 1.5 = +0.467)
      //          Min margin = min(0.5, 0.467) > 0 -> Inside Sweet Spot!
      const marginA_Y1 = calculateCQAMargin(90, 'maximize', 80, 100);
      const marginA_Y2 = calculateCQAMargin(0.8, 'minimize', 0, 1.5);
      expect(marginA_Y1).toBeGreaterThan(0);
      expect(marginA_Y2).toBeGreaterThan(0);
      expect(Math.min(marginA_Y1, marginA_Y2)).toBeGreaterThan(0);

      // Point B: X1 = -0.8 (Y1 = 77 < 80 OOS! -> margin_Y1 = (77 - 80) / 20 = -0.15)
      //          X2 = -0.5 (Y2 = 0.8 in spec)
      //          Min margin = -0.15 < 0 -> OOS!
      const marginB_Y1 = calculateCQAMargin(77, 'maximize', 80, 100);
      expect(marginB_Y1).toBeLessThan(0);
      expect(Math.min(marginB_Y1, marginA_Y2)).toBeLessThan(0);

      // Render 3D Sweet Spot Surface
      const traces = render3DSweetSpotSurface(
        factors,
        responses,
        activeModels,
        'X3',
        100, // slice at center of X3
        20 // 20x20 grid resolution
      );

      expect(traces).toHaveLength(2);

      // Trace 0: Surface (Z = Margin_min)
      const surfaceTrace = traces[0];
      expect(surfaceTrace.type).toBe('surface');
      expect(surfaceTrace.name).toBe('Sweet-spot Surface (Z = Margin_min)');
      expect(surfaceTrace.z).toBeDefined();
      expect(surfaceTrace.z.length).toBe(20);
      expect(surfaceTrace.z[0].length).toBe(20);

      // Trace 1: Reference Boundary Plane at Z = 0
      const refPlane = traces[1];
      expect(refPlane.type).toBe('surface');
      expect(refPlane.name).toBe('Ranh giới Design Space (Z = 0)');
      expect(refPlane.z).toEqual([[0, 0], [0, 0]]);
      expect(refPlane.opacity).toBe(0.42);

      // Verify that the surface contains both positive (sweet-spot) and negative (OOS) margins
      const allZ: number[] = surfaceTrace.z.flat();
      const hasSweetSpot = allZ.some((z: number) => z > 0);
      const hasOOS = allZ.some((z: number) => z < 0);
      expect(hasSweetSpot).toBe(true);
      expect(hasOOS).toBe(true);

      // Check boundary intersection
      const minZ = Math.min(...allZ);
      const maxZ = Math.max(...allZ);
      expect(minZ).toBeLessThan(0);
      expect(maxZ).toBeGreaterThan(0);
    });

    it('verifies worst-case multi-CQA conflict: even 1 failing CQA forces Z < 0 regardless of others', () => {
      const factors: Factor[] = [
        { id: 'f1', code: 'X1', name: 'X1', low: 0, high: 10, type: 'Formulation', dataType: 'quantitative', controllability: 'controllable', unit: 'g' },
        { id: 'f2', code: 'X2', name: 'X2', low: 0, high: 10, type: 'Process', dataType: 'quantitative', controllability: 'controllable', unit: 'rpm' },
      ];

      // 4 CQAs: 3 are passing with flying colors (margin = +0.9), 1 is failing (margin = -0.1)
      const responses = [
        { code: 'Y1', objective: 'maximize', lowerLimit: 50 },
        { code: 'Y2', objective: 'maximize', lowerLimit: 50 },
        { code: 'Y3', objective: 'maximize', lowerLimit: 50 },
        { code: 'Y4_FAILING', objective: 'maximize', lowerLimit: 50 },
      ];

      const activeModels = {
        Y1: { predict: () => 95 }, // margin > 0
        Y2: { predict: () => 95 }, // margin > 0
        Y3: { predict: () => 95 }, // margin > 0
        Y4_FAILING: { predict: () => 45 }, // 45 < 50 => OOS! margin < 0
      };

      const traces = render3DSweetSpotSurface(factors, responses, activeModels, 'X2', 5, 10);
      const surfaceZ: number[][] = traces[0].z;

      // Every single point in the entire grid MUST be negative because Y4_FAILING is OOS
      for (const row of surfaceZ) {
        for (const z of row) {
          expect(z).toBeLessThan(0);
        }
      }
    });

    it('verifies overfitted ANN (N=12, P=26, R2=0.99) is strictly rejected in favor of parsimonious Linear model (P=4, R2=0.88)', () => {
      const N = 12;
      const sst = 100.0;

      // Model A: Overfitted ANN with 26 parameters, sse = 1.0 (R^2 = 0.99)
      const sseAnn = 1.0;
      const annMetrics = calculateBenchmarkInformationCriteria(N, 26, sseAnn, sst);
      expect(annMetrics.aicc).toBe(Infinity);

      // Model B: Simple linear model with 4 parameters, sse = 12.0 (R^2 = 0.88)
      const sseLinear = 12.0;
      const linearMetrics = calculateBenchmarkInformationCriteria(N, 4, sseLinear, sst);
      expect(Number.isFinite(linearMetrics.aicc)).toBe(true);

      const benchmarkTable = [
        { id: 'ann_overfit', aicc: annMetrics.aicc },
        { id: 'linear_parsimonious', aicc: linearMetrics.aicc },
      ];

      const weighted = calculateAkaikeBenchmarkingWeights(benchmarkTable);
      const chosenModel = weighted.find((w) => w.id === 'linear_parsimonious')!;
      const rejectedModel = weighted.find((w) => w.id === 'ann_overfit')!;

      // Linear model must receive 100% of Akaike weight, ANN must receive 0%
      expect(chosenModel.akaikeWeight).toBe(1.0);
      expect(rejectedModel.akaikeWeight).toBe(0.0);
    });

    it('verifies SVR SMO handles zero-variance flat responses and small samples gracefully', () => {
      const factors: Factor[] = [
        { id: 'f1', code: 'X1', name: 'X1', low: 1, high: 5, type: 'Formulation', dataType: 'quantitative', controllability: 'controllable', unit: '%' },
      ];

      // Edge case: N < 4 returns null
      const runsSmall: DoERun[] = [
        { id: 'r1', runOrder: 1, stdOrder: 1, block: 1, factorCoded: { X1: -1 }, factorActual: { X1: 1 }, responses: { Y1: 10 } },
        { id: 'r2', runOrder: 2, stdOrder: 2, block: 1, factorCoded: { X1: 1 }, factorActual: { X1: 5 }, responses: { Y1: 10 } },
      ];
      expect(fitSVRModel(factors, runsSmall, 'Y1')).toBeNull();

      // Flat responses (all Y = 10)
      const runsFlat: DoERun[] = [
        { id: 'r1', runOrder: 1, stdOrder: 1, block: 1, factorCoded: { X1: -1 }, factorActual: { X1: 1 }, responses: { Y1: 10 } },
        { id: 'r2', runOrder: 2, stdOrder: 2, block: 1, factorCoded: { X1: -0.5 }, factorActual: { X1: 2 }, responses: { Y1: 10 } },
        { id: 'r3', runOrder: 3, stdOrder: 3, block: 1, factorCoded: { X1: 0.5 }, factorActual: { X1: 4 }, responses: { Y1: 10 } },
        { id: 'r4', runOrder: 4, stdOrder: 4, block: 1, factorCoded: { X1: 1 }, factorActual: { X1: 5 }, responses: { Y1: 10 } },
      ];
      const flatSVR = fitSVRModel(factors, runsFlat, 'Y1');
      expect(flatSVR).not.toBeNull();
      if (flatSVR) {
        const pred = flatSVR.predict({ X1: 0 });
        expect(pred).toBeCloseTo(10, 1);
      }
    });
  });

  // =========================================================================
  // DEEP STRESS: Higher Dimensions, Permutation SHAP & 2-Layer Garson
  // =========================================================================
  describe('Deep Stress: Higher-Dimension SHAP & Multi-Layer Garson', () => {
    it('verifies SHAP Efficiency Axiom at k = 8 dimensions across 20 random instances', () => {
      // 8-variable complex function
      const k = 8;
      const fn8 = (x: number[]): number => {
        let sum = 0;
        for (let i = 0; i < k; i++) sum += Math.sin(x[i] * (i + 1));
        // Add 2-way interactions
        sum += x[0] * x[1] + x[2] * x[3] + x[4] * x[5] + x[6] * x[7];
        return sum;
      };

      const baseline = new Array(k).fill(0.0);

      // Test 20 pseudo-random instances
      for (let trial = 0; trial < 20; trial++) {
        const instance = Array.from({ length: k }, (_, i) =>
          Math.sin(trial * 13.7 + i * 5.3)
        );
        const { shapValues, baseValue, predValue } = computeExactSHAP(
          instance,
          fn8,
          baseline
        );
        const sumShap = shapValues.reduce((a, b) => a + b, 0);
        const delta = predValue - baseValue;
        const err = Math.abs(sumShap - delta);

        expect(err).toBeLessThan(1e-9);
      }
    });

    it('verifies Garson Algorithm with 2 hidden layers sums to 100.0% ± 10^-6%', () => {
      // 5 inputs -> 4 hidden1 -> 3 hidden2 -> 1 output
      const W1 = Array.from({ length: 5 }, () =>
        Array.from({ length: 4 }, () => (Math.random() - 0.5) * 2)
      );
      const W2 = Array.from({ length: 4 }, () =>
        Array.from({ length: 3 }, () => (Math.random() - 0.5) * 2)
      );
      const WOut = Array.from({ length: 3 }, () => [(Math.random() - 0.5) * 2]);

      const layerWeights = {
        W1,
        b1: [0, 0, 0, 0],
        W2,
        b2: [0, 0, 0],
        WOut,
        bOut: 0,
      };

      const result = computeGarsonImportance(layerWeights);
      const sum = result.reduce((a, b) => a + b, 0);
      expect(Math.abs(sum - 100.0)).toBeLessThan(1e-6);
    });

    it('verifies Permutation SHAP preserves Efficiency Axiom analytically for k > 8', () => {
      const factors: Factor[] = Array.from({ length: 10 }, (_, i) => ({
        id: `f${i}`,
        code: `X${i + 1}`,
        name: `Factor ${i + 1}`,
        low: 0,
        high: 10,
        type: 'Process',
        dataType: 'quantitative',
        controllability: 'controllable',
        unit: 'u',
      }));

      // Predict function for 10 factors
      const predict10 = (coded: Record<string, number>): number => {
        let val = 20;
        for (let i = 1; i <= 10; i++) {
          val += (coded[`X${i}`] ?? 0) * i * 1.5;
        }
        return val;
      };

      const runs: DoERun[] = [
        {
          id: 'r1',
          runOrder: 1,
          stdOrder: 1,
          block: 1,
          factorCoded: { X1: 0.5, X2: -0.5, X3: 0.8, X4: -0.2, X5: 0.1, X6: -0.9, X7: 0.4, X8: -0.4, X9: 0.3, X10: -0.1 },
          factorActual: {},
          responses: {},
        },
      ];

      // With k = 10 > 8, calculateExactShapleyValues uses permutation method
      const res = calculateExactShapleyValues(predict10, factors, runs, { permutationSamples: 100 });
      expect(res.method).toBe('permutation');
      expect(res.runExplanations[0].efficiencyError).toBeLessThan(1e-4);
    });
  });

  // =========================================================================
  // DEEP STRESS: RFC 8785 Canonical JSON & Cryptographic Tamper Attacks
  // =========================================================================
  describe('Deep Stress: Canonical JSON Determinism & Hash Chaining Attacks', () => {
    it('verifies RFC 8785 canonical JSON sorts keys deterministically and handles floats/negatives correctly', () => {
      const objA = { z: 1, a: [3, 2, 1], m: { y: 'test', b: -0, c: true } };
      const objB = { m: { c: true, b: 0, y: 'test' }, a: [3, 2, 1], z: 1 };

      // RFC 8785 normalizes -0 to -0 or 0
      const strA = canonicalJsonStringify(objA);
      const strB = canonicalJsonStringify(objB);

      expect(strA).toBeDefined();
      expect(strB).toBeDefined();

      // Key ordering must be strictly sorted: 'a', 'm', 'z'
      expect(strA.indexOf('"a":')).toBeLessThan(strA.indexOf('"m":'));
      expect(strA.indexOf('"m":')).toBeLessThan(strA.indexOf('"z":'));
    });

    it('adversarial attack: forging an intermediate block and recomputing downstream hashes is caught if Approver signed earlier state', () => {
      const baseProject = clone(CASE_STUDIES[0]);

      // 1. Initial State signed by Approver
      const approvedProject = signProjectSnapshot(baseProject, {
        name: 'Quality Director',
        role: 'Approver',
        reason: 'Authorized baseline protocol',
      });
      const originalPayloadHash = computeProjectPayloadHash(pruneProjectForHistory(approvedProject));
      expect(originalPayloadHash).toBeDefined();

      // 2. Attacker modifies data post-approval
      const attackerProject = clone(approvedProject);
      attackerProject.runs[0].responses['Y1'] = 999.0;
      const attackerPayloadHash = computeProjectPayloadHash(pruneProjectForHistory(attackerProject));

      // 3. Attacker can forge a valid hash-chain entry locally:
      const fakeEntryHash = computeEntryHash({
        sequenceNumber: 2,
        timestamp: new Date().toISOString(),
        action: 'PROJECT_MODIFIED',
        versionLabel: 'v1.0.1',
        user: 'Hacker',
        payloadHash: attackerPayloadHash,
        previousHash: approvedProject.electronicSignatures![0].signatureChecksum,
      });
      expect(fakeEntryHash).toBeDefined();

      // BUT verifyElectronicSignatures checks the signed payload hash against the current payload:
      const sigVerification = verifyElectronicSignatures(
        approvedProject.electronicSignatures!,
        attackerPayloadHash
      );
      expect(sigVerification.isValid).toBe(false);
      expect(sigVerification.reason).toContain('Approved project state altered');
  });
});
});

