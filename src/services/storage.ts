import type { QBDProject } from '../types/qbd';
import type { ProjectVersionSnapshot, ProjectAuditAnchor } from './projectGovernance';

const DB_NAME = 'qbd_studio_db';
const DB_VERSION = 1;
const STORE_PROJECTS = 'projects';
const STORE_HISTORY = 'history';
const STORE_ANCHORS = 'anchors';

let dbPromise: Promise<IDBDatabase | null> | null = null;

function mirrorToLocalStorage(key: string, value: unknown): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function isIndexedDBAvailable(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';
  } catch {
    return false;
  }
}

function getDB(): Promise<IDBDatabase | null> {
  if (!isIndexedDBAvailable()) {
    return Promise.resolve(null);
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    try {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
          db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_HISTORY)) {
          db.createObjectStore(STORE_HISTORY, { keyPath: 'projectId' });
        }
        if (!db.objectStoreNames.contains(STORE_ANCHORS)) {
          db.createObjectStore(STORE_ANCHORS, { keyPath: 'projectId' });
        }
      };

      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };

      request.onerror = () => {
        dbPromise = null;
        resolve(null);
      };
    } catch {
      dbPromise = null;
      resolve(null);
    }
  });

  return dbPromise;
}

export async function idbGetProject(id: string): Promise<QBDProject | null> {
  const db = await getDB();
  if (!db) {
    // Fallback to localStorage
    try {
      const val = window.localStorage.getItem(`qbd.project.${id}`);
      return val ? JSON.parse(val) : null;
    } catch {
      return null;
    }
  }

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_PROJECTS, 'readonly');
      const store = tx.objectStore(STORE_PROJECTS);
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function idbSaveProject(project: QBDProject): Promise<boolean> {
  // Always mirror in localStorage for synchronous fallback
  const localSaved = mirrorToLocalStorage(`qbd.project.${project.id}`, project);

  const db = await getDB();
  if (!db) return localSaved;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_PROJECTS, 'readwrite');
      const store = tx.objectStore(STORE_PROJECTS);
      store.put(project);
      tx.oncomplete = () => resolve(true);
      tx.onabort = () => resolve(localSaved);
      tx.onerror = () => resolve(localSaved);
    } catch {
      resolve(localSaved);
    }
  });
}

export async function idbGetHistory(projectId: string): Promise<ProjectVersionSnapshot[]> {
  const db = await getDB();
  if (!db) {
    try {
      const val = window.localStorage.getItem(`qbd.project.history.${projectId}`);
      return val ? JSON.parse(val) : [];
    } catch {
      return [];
    }
  }

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_HISTORY, 'readonly');
      const store = tx.objectStore(STORE_HISTORY);
      const req = store.get(projectId);
      req.onsuccess = () => {
        const res = req.result;
        resolve(res && Array.isArray(res.snapshots) ? res.snapshots : []);
      };
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

export async function idbSaveHistory(projectId: string, snapshots: ProjectVersionSnapshot[]): Promise<boolean> {
  const localSaved = mirrorToLocalStorage(`qbd.project.history.${projectId}`, snapshots.slice(0, 10));

  const db = await getDB();
  if (!db) return localSaved;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_HISTORY, 'readwrite');
      const store = tx.objectStore(STORE_HISTORY);
      store.put({ projectId, snapshots, updatedAt: new Date().toISOString() });
      tx.oncomplete = () => resolve(true);
      tx.onabort = () => resolve(localSaved);
      tx.onerror = () => resolve(localSaved);
    } catch {
      resolve(localSaved);
    }
  });
}

export async function idbGetAnchor(projectId: string): Promise<ProjectAuditAnchor | null> {
  const db = await getDB();
  if (!db) {
    try {
      const val = window.localStorage.getItem(`qbd.project.anchor.${projectId}`);
      return val ? JSON.parse(val) : null;
    } catch {
      return null;
    }
  }

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_ANCHORS, 'readonly');
      const store = tx.objectStore(STORE_ANCHORS);
      const req = store.get(projectId);
      req.onsuccess = () => {
        const res = req.result;
        resolve(res && typeof res.sequenceNumber === 'number' ? res : null);
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function idbSaveAnchor(projectId: string, anchor: ProjectAuditAnchor): Promise<boolean> {
  const localSaved = mirrorToLocalStorage(`qbd.project.anchor.${projectId}`, anchor);

  const db = await getDB();
  if (!db) return localSaved;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_ANCHORS, 'readwrite');
      const store = tx.objectStore(STORE_ANCHORS);
      store.put({ projectId, ...anchor });
      tx.oncomplete = () => resolve(true);
      tx.onabort = () => resolve(localSaved);
      tx.onerror = () => resolve(localSaved);
    } catch {
      resolve(localSaved);
    }
  });
}

/**
 * Automatically migrates projects, histories, and anchors from localStorage to IndexedDB.
 * Returns the count of migrated entities.
 */
export async function migrateLocalStorageToIndexedDB(): Promise<number> {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return 0;
  const db = await getDB();
  if (!db) return 0;

  let count = 0;
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key) continue;

      if (key.startsWith('qbd.project.') && !key.startsWith('qbd.project.history.') && !key.startsWith('qbd.project.anchor.')) {
        const val = window.localStorage.getItem(key);
        if (val) {
          try {
            const project = JSON.parse(val);
            // Migration is additive: the IndexedDB copy may be newer than
            // the old localStorage mirror after an interrupted write.
            if (project && typeof project.id === 'string' && !await idbGetProject(project.id) && await idbSaveProject(project)) {
              count++;
            }
          } catch {
            // skip malformed
          }
        }
      } else if (key.startsWith('qbd.project.history.')) {
        const projectId = key.replace('qbd.project.history.', '');
        const val = window.localStorage.getItem(key);
        if (val) {
          try {
            const history = JSON.parse(val);
            if (Array.isArray(history) && (await idbGetHistory(projectId)).length === 0 && await idbSaveHistory(projectId, history)) {
              count++;
            }
          } catch {
            // skip
          }
        }
      } else if (key.startsWith('qbd.project.anchor.')) {
        const projectId = key.replace('qbd.project.anchor.', '');
        const val = window.localStorage.getItem(key);
        if (val) {
          try {
            const anchor = JSON.parse(val);
            if (anchor && typeof anchor.sequenceNumber === 'number' && !await idbGetAnchor(projectId) && await idbSaveAnchor(projectId, anchor)) {
              count++;
            }
          } catch {
            // skip
          }
        }
      }
    }
  } catch {
    // ignore
  }

  return count;
}
