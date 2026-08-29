import { describe, expect, it } from 'vitest';
import { getEvenContourSettings } from './ternaryContour';

describe('contour level spacing', () => {
  it('uses an explicit equal response-value interval', () => {
    expect(getEvenContourSettings(10, 30, 6)).toEqual({ start: 10, end: 30, size: 4 });
  });

  it('does not request contours for a flat or invalid response surface', () => {
    expect(getEvenContourSettings(12, 12, 8)).toBeUndefined();
    expect(getEvenContourSettings(Number.NaN, 12, 8)).toBeUndefined();
  });
});
