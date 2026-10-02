import { describe, expect, it } from 'vitest';
import { projectFileName } from './projectFileName';

describe('project download filename', () => {
  it('uses the entered project title without duplicating the extension', () => {
    expect(projectFileName('Nghiên cứu viên nén 2026')).toBe('Nghiên cứu viên nén 2026.json');
    expect(projectFileName('Study.json')).toBe('Study.json');
  });

  it('falls back for an empty title and removes invalid filename characters', () => {
    expect(projectFileName('  ')).toBe('Untitled project.json');
    expect(projectFileName('Lô A/B: lần 1')).toBe('Lô A_B_ lần 1.json');
  });
});
