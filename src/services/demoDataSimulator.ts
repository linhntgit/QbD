import type { CQA, DoERun, QBDProject } from '../types/qbd';

type RandomSource = () => number;

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

const coded = (run: DoERun, factorCode: string): number =>
  clamp(Number(run.factorCoded[factorCode] ?? 0), -1, 1);

const actualPercent = (run: DoERun, factorCode: string): number => {
  const value = Number(run.factorActual[factorCode]);
  return Number.isFinite(value) ? value / 100 : Number(run.factorCoded[factorCode] ?? 0);
};

const jitter = (random: RandomSource, amplitude: number): number =>
  (random() - 0.5) * amplitude;

/**
 * Returns hard physical/chemical bounds. Specifications are deliberately not
 * used as hard bounds: a simulated DoE should still be able to show plausible
 * out-of-specification experiments without producing impossible observations.
 */
export function getPhysicalResponseBounds(cqa: CQA): { low: number; high: number; decimals: number } {
  const name = cqa.name.toLocaleLowerCase();
  const unit = cqa.unit.toLocaleLowerCase();

  if (name.includes('pdi') || name.includes('đa phân tán')) return { low: 0.01, high: 0.8, decimals: 3 };
  if (name.includes('friability') || name.includes('mài mòn')) return { low: 0.01, high: 3, decimals: 2 };
  if (name.includes('hardness') || name.includes('độ cứng')) return { low: 1, high: 30, decimals: 2 };
  if (name.includes('droplet') || name.includes('kích thước') || unit === 'nm') {
    return { low: unit === 'nm' ? 10 : 0.5, high: unit === 'nm' ? 1_000 : 1_000, decimals: 2 };
  }
  if (name.includes('t50') || name.includes('t80') || unit === 'h') return { low: 0.1, high: 48, decimals: 2 };
  if (unit === 'score' || name.includes('f2')) return { low: 0, high: 100, decimals: 1 };
  if (unit === '%' || name.includes('yield') || name.includes('loading') || name.includes('hòa tan')) {
    return { low: 0, high: 100, decimals: 2 };
  }

  const target = cqa.target ?? 50;
  const span = Math.max(Math.abs((cqa.upperLimit ?? target) - (cqa.lowerLimit ?? target)), Math.abs(target) * 0.4, 1);
  return { low: Math.max(0, (cqa.lowerLimit ?? target) - span), high: (cqa.upperLimit ?? target) + span, decimals: 2 };
}

function finish(cqa: CQA, value: number): number {
  const { low, high, decimals } = getPhysicalResponseBounds(cqa);
  return Number(clamp(value, low, high).toFixed(decimals));
}

function simulateSampleCase(project: QBDProject, run: DoERun, cqa: CQA, random: RandomSource): number | null {
  const x1 = coded(run, 'X1');
  const x2 = coded(run, 'X2');
  const x3 = coded(run, 'X3');
  const x4 = coded(run, 'X4');

  switch (project.id) {
    case 'case-study-tablet-bbd':
      // HPMC and compression slow release; PVP and compression improve tablet strength.
      switch (cqa.code) {
        case 'Y1': return 32 - 8.2 * x1 - 2.1 * x2 - 1.4 * x3 + 1.0 * x1 * x2 + jitter(random, 1.2);
        case 'Y2': return 77.5 - 9.2 * x1 - 2.8 * x2 - 1.4 * x3 + 1.3 * x1 * x2 + jitter(random, 1.4);
        case 'Y3': return 11.8 - 0.5 * x1 + 2.7 * x2 + 1.3 * x3 - 0.35 * x2 * x2 + jitter(random, 0.5);
        case 'Y4': return 0.33 + 0.12 * x1 - 0.15 * x2 - 0.08 * x3 + 0.06 * x4 + jitter(random, 0.05);
        default: return null;
      }

    case 'case-study-api-ccd':
      // Yield has an interior optimum; excessive temperature/catalyst increases impurities.
      switch (cqa.code) {
        case 'Y1': return 92.4 + 3.7 * x1 + 2.8 * x2 + 2.1 * x3 - 3.0 * x1 * x1 - 2.0 * x2 * x2 - 1.8 * x3 * x3 + 0.8 * x1 * x2 + jitter(random, 0.7);
        case 'Y2': return 0.29 + 0.14 * x1 + 0.06 * x2 + 0.09 * x3 + 0.07 * x1 * x3 + jitter(random, 0.035);
        case 'Y3': return 35.8 - 4.2 * x1 - 2.0 * x2 - 3.5 * x3 + 1.2 * x1 * x3 + jitter(random, 1.1);
        default: return null;
      }

    case 'case-study-sedds-combined': {
      const oil = actualPercent(run, 'X1');
      const surfactant = actualPercent(run, 'X2');
      const cosurfactant = actualPercent(run, 'X3');
      // More oil coarsens droplets; surfactant and processing energy reduce size/PDI.
      switch (cqa.code) {
        case 'Y1': return 105 + 250 * (oil - 0.28) - 85 * (surfactant - 0.48) + 25 * (cosurfactant - 0.24) - 8 * x4 - 6 * x4 * x4 - 5 * x3 + jitter(random, 5);
        case 'Y2': return 0.17 + 0.45 * (oil - 0.28) - 0.20 * (surfactant - 0.48) + 0.07 * (cosurfactant - 0.24) - 0.025 * x4 - 0.012 * x3 + jitter(random, 0.018);
        case 'Y3': return 98.2 + 5 * (oil - 0.28) - 13 * Math.max(0, cosurfactant - 0.25) - 6 * Math.max(0, surfactant - 0.58) + 1.2 * x4 + jitter(random, 1.0);
        default: return null;
      }
    }

    case 'case-study-fda-mr-tablet':
      // Coating controls release; excessive compression increases hardness but can reduce MUPS integrity.
      switch (cqa.code) {
        case 'Y1': return 4.55 + 1.30 * x1 + 0.23 * x2 - 0.30 * x3 + 0.08 * x4 - 0.18 * x1 * x1 + jitter(random, 0.18);
        case 'Y2': return 8.55 + 2.30 * x1 + 0.45 * x2 - 0.50 * x3 + 0.12 * x4 - 0.30 * x1 * x1 + jitter(random, 0.35);
        case 'Y3': return 11.1 + 4.25 * x3 - 0.35 * x1 - 0.45 * x4 - 0.6 * x3 * x3 + jitter(random, 0.5);
        case 'Y4': return 0.22 - 0.06 * x1 - 0.08 * x2 - 0.24 * x3 + 0.08 * x4 + 0.08 * x3 * x3 + jitter(random, 0.045);
        case 'Y5': return 73 + 7 * x1 + 7 * x2 - 5 * x3 - 2 * x4 - 3 * x2 * x2 + jitter(random, 3.0);
        default: return null;
      }

    default:
      return null;
  }
}

function simulateGenericCase(project: QBDProject, run: DoERun, cqa: CQA, random: RandomSource): number {
  const target = cqa.target ?? ((cqa.lowerLimit ?? 0) + (cqa.upperLimit ?? 100)) / 2;
  const specificationSpan = Math.max(Math.abs((cqa.upperLimit ?? target) - (cqa.lowerLimit ?? target)), Math.abs(target) * 0.2, 1);
  const activeFactors = project.factors.filter((factor) => factor.controllability !== 'constant');
  const linear = activeFactors.reduce((sum, factor, index) => {
    const direction = index % 2 === 0 ? 1 : -1;
    const x = coded(run, factor.code);
    return sum + direction * (0.08 + (index % 3) * 0.025) * x - 0.035 * x * x;
  }, 0);
  const first = activeFactors[0] ? coded(run, activeFactors[0].code) : 0;
  const second = activeFactors[1] ? coded(run, activeFactors[1].code) : 0;
  return target + specificationSpan * (linear + 0.07 * first * second) + jitter(random, specificationSpan * 0.06);
}

/** Generates plausible demonstration measurements while preserving physical bounds. */
export function simulateDemoResponses(
  project: QBDProject,
  run: DoERun,
  random: RandomSource = Math.random,
): Record<string, number | string> {
  const responses: Record<string, number | string> = {};

  project.cqas.forEach((cqa) => {
    if (cqa.dataType === 'qualitative_binary') {
      const categories = cqa.categories?.filter(Boolean) ?? ['Không đạt', 'Đạt'];
      responses[cqa.code] = random() > 0.12 ? (categories[1] ?? categories[0]) : categories[0];
      return;
    }

    if (cqa.dataType === 'qualitative_ordinal') {
      const categories = cqa.categories?.filter(Boolean) ?? ['Mức 1', 'Mức 2', 'Mức 3'];
      responses[cqa.code] = categories[Math.min(categories.length - 1, Math.floor(random() * categories.length))];
      return;
    }

    const sampleValue = simulateSampleCase(project, run, cqa, random);
    const simulated = finish(cqa, sampleValue ?? simulateGenericCase(project, run, cqa, random));
    if (cqa.dataType === 'quantitative_multilevel' && cqa.categories?.length) {
      const levels = cqa.categories.map(Number).filter(Number.isFinite);
      responses[cqa.code] = levels.length > 0
        ? levels.reduce((nearest, level) =>
            Math.abs(level - Number(simulated)) < Math.abs(nearest - Number(simulated)) ? level : nearest,
          levels[0])
        : simulated;
    } else {
      responses[cqa.code] = simulated;
    }
  });

  return responses;
}
