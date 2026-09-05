import { afterEach, describe, expect, it, vi } from 'vitest';
import { CASE_STUDIES } from '../data/caseStudies';
import type { QBDProject } from '../types/qbd';
import { getProjectHistory, hasProjectStructure, loadPersistedProject, persistProject, recordProjectVersion, validateProjectTemplate } from './projectGovernance';

afterEach(() => vi.unstubAllGlobals());

function mockStorage(values: Record<string, string> = {}) {
  const storage = {
    getItem: (key: string) => values[key] ?? null,
    setItem: (key: string, value: string) => { values[key] = value; },
  };
  vi.stubGlobal('window', { localStorage: storage });
  return storage;
}

describe('project persistence boundaries', () => {
  it('round trips every bundled case study and retains unfinished drafts', () => {
    mockStorage();
    for (const project of CASE_STUDIES) {
      expect(hasProjectStructure(project)).toBe(true);
      expect(persistProject(project)).toBe(true);
      expect(loadPersistedProject()).toEqual(project);
    }
    const draft = { ...CASE_STUDIES[0], name: '', cqas: [], runs: [] };
    expect(persistProject(draft)).toBe(true);
    expect(loadPersistedProject()).toEqual(draft);
  });

  it.each(['null', '{}', '[]', '{broken', '{"cqas":true,"factors":[]}'])('ignores corrupt autosave %s', (raw) => {
    mockStorage({ 'qbd.project.last': raw });
    expect(loadPersistedProject()).toBeNull();
  });

  it('handles denied access to the localStorage getter', () => {
    vi.stubGlobal('window', Object.defineProperty({}, 'localStorage', {
      get() { throw new Error('SecurityError'); },
    }));
    expect(loadPersistedProject()).toBeNull();
    expect(getProjectHistory('x')).toEqual([]);
    expect(persistProject(CASE_STUDIES[0])).toBe(false);
    expect(recordProjectVersion(CASE_STUDIES[0], 'test')).toBe(false);
  });

  it('reports quota failures without throwing', () => {
    const storage = mockStorage();
    storage.setItem = () => { throw new Error('QuotaExceededError'); };
    expect(persistProject(CASE_STUDIES[0])).toBe(false);
    expect(recordProjectVersion(CASE_STUDIES[0], 'test')).toBe(false);
  });

  it('filters invalid history entries and can append a new snapshot', () => {
    const project = CASE_STUDIES[0];
    const key = `qbd.project.history.${project.id}`;
    const storage = mockStorage({ [key]: '[null,{},42]' });
    expect(getProjectHistory(project.id)).toEqual([]);
    expect(recordProjectVersion(project, 'saved')).toBe(true);
    expect(getProjectHistory(project.id)[0].project).toEqual(project);
    storage.setItem(key, '{}');
    expect(getProjectHistory(project.id)).toEqual([]);
  });

  it('returns validation errors for malformed imports instead of throwing', () => {
    for (const value of [null, {}, { ...CASE_STUDIES[0], factors: [null] },
      { ...CASE_STUDIES[0], runs: [{ id: 'bad' }] },
      { ...CASE_STUDIES[0], factors: [{ ...CASE_STUDIES[0].factors[0], categories: [2] }] }]) {
      expect(validateProjectTemplate(value as QBDProject).valid).toBe(false);
    }
  });

  it('rejects nonnumeric quantitative levels', () => {
    const project = structuredClone(CASE_STUDIES[0]);
    project.runs = [];
    project.factors[0].dataType = 'quantitative_multilevel';
    project.factors[0].categories = ['10', 'not-a-number'];
    expect(validateProjectTemplate(project).errors.some((error) => error.includes('số hữu hạn'))).toBe(true);
  });
});
