import { describe, expect, it } from 'vitest';
import { DEFAULT_NEURAL_CONFIG, getNeuralTrainingSampleCount, getNeuralValidationSplits } from './neuralNetwork';

describe('neural-network K-fold validation', () => {
  it('rotates every run through validation once and reserves the largest fold from Carpenter N', () => {
    const config = { ...DEFAULT_NEURAL_CONFIG, validationMethod: 'kfold' as const, kFolds: 5, seed: 42 };
    const splits = getNeuralValidationSplits(23, config);

    expect(splits).toHaveLength(5);
    expect(splits.flatMap((split) => split.valIdx).sort((a, b) => a - b)).toEqual(Array.from({ length: 23 }, (_, index) => index));
    expect(splits.every((split) => split.trainIdx.length + split.valIdx.length === 23)).toBe(true);
    expect(getNeuralTrainingSampleCount(23, config)).toBe(18);
  });
});
