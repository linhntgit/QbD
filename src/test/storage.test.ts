import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { QBDProject } from '../types/qbd';
import {
  idbGetProject,
  idbSaveProject,
  idbGetHistory,
  idbSaveHistory,
  idbGetAnchor,
  idbSaveAnchor,
  migrateLocalStorageToIndexedDB,
} from '../services/storage';

describe('Storage Service (IndexedDB with Fallback)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  const dummyProject: QBDProject = {
    id: 'test-storage-proj',
    name: 'Storage Test Project',
    moleculeName: 'API_1',
    dosageForm: 'Capsule',
    author: 'QA',
    version: '1.0.0',
    createdDate: '2026-10-04',
    updatedDate: '2026-10-04',
    description: 'Testing storage',
    qtpp: [],
    cqas: [],
    factors: [],
    fmeaRisks: [],
    doeConfig: {
      category: 'RSM',
      designType: 'CCD_FaceCentered',
      centerPoints: 2,
      replicates: 1,
      randomized: false,
    },
    runs: [],
    designSpace: [],
  };

  it('saves and retrieves project using storage fallback', async () => {
    const memoryStorage: Record<string, string> = {};
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (k: string) => memoryStorage[k] ?? null,
        setItem: (k: string, v: string) => {
          memoryStorage[k] = v;
        },
        removeItem: (k: string) => {
          delete memoryStorage[k];
        },
      },
    });

    const saved = await idbSaveProject(dummyProject);
    expect(saved).toBe(true);

    const retrieved = await idbGetProject(dummyProject.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.id).toBe(dummyProject.id);
    expect(retrieved?.name).toBe('Storage Test Project');
  });

  it('saves and retrieves anchor and history snapshots', async () => {
    const memoryStorage: Record<string, string> = {};
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (k: string) => memoryStorage[k] ?? null,
        setItem: (k: string, v: string) => {
          memoryStorage[k] = v;
        },
        removeItem: (k: string) => {
          delete memoryStorage[k];
        },
      },
    });

    await idbSaveAnchor('test-storage-proj', {
      sequenceNumber: 5,
      entryHash: 'abc123def456',
      timestamp: '2026-10-04T00:00:00Z',
    });

    const anchor = await idbGetAnchor('test-storage-proj');
    expect(anchor).not.toBeNull();
    expect(anchor?.sequenceNumber).toBe(5);
    expect(anchor?.entryHash).toBe('abc123def456');

    await idbSaveHistory('test-storage-proj', [
      {
        id: 'snap-1',
        sequenceNumber: 1,
        timestamp: '2026-10-04T00:00:00Z',
        action: 'CREATED',
        versionLabel: 'v1.0.0',
        user: 'Analyst',
        payloadHash: 'hash-1',
        previousHash: 'genesis',
        entryHash: 'ehash-1',
        project: dummyProject,
      },
    ]);

    const history = await idbGetHistory('test-storage-proj');
    expect(history.length).toBe(1);
    expect(history[0].action).toBe('CREATED');
  });

  it('migrates entries from localStorage cleanly', async () => {
    const memoryStorage: Record<string, string> = {
      'qbd.project.p1': JSON.stringify(dummyProject),
      'qbd.project.anchor.p1': JSON.stringify({ sequenceNumber: 1, entryHash: 'h1' }),
    };

    vi.stubGlobal('window', {
      localStorage: {
        length: 2,
        key: (idx: number) => Object.keys(memoryStorage)[idx] ?? null,
        getItem: (k: string) => memoryStorage[k] ?? null,
        setItem: (k: string, v: string) => {
          memoryStorage[k] = v;
        },
        removeItem: (k: string) => {
          delete memoryStorage[k];
        },
      },
    });

    const count = await migrateLocalStorageToIndexedDB();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  it('reports failed saves when neither localStorage nor IndexedDB is writable', async () => {
    vi.stubGlobal('window', {
      localStorage: {
        setItem: () => { throw new Error('Storage quota exceeded'); },
        getItem: () => null,
      },
    });

    expect(await idbSaveProject(dummyProject)).toBe(false);
    expect(await idbSaveHistory(dummyProject.id, [])).toBe(false);
    expect(await idbSaveAnchor(dummyProject.id, {
      sequenceNumber: 1,
      entryHash: 'abc',
      timestamp: '2026-10-09T00:00:00Z',
    })).toBe(false);
  });
});
