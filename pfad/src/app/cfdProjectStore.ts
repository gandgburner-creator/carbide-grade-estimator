import type { CfdProject } from '../cfd/CfdProject';
import { openDb } from './libraryIdb';

/** Persistence of CFD construction projects (IndexedDB store `cfdProjects`, with an in-memory fallback). */
export interface CfdProjectStore {
  list(): Promise<{ id: string; name: string; createdAt: string; versions: number; head: string }[]>;
  get(id: string): Promise<CfdProject | null>;
  put(p: CfdProject): Promise<void>;
  remove(id: string): Promise<void>;
}

const brief = (p: CfdProject) => ({ id: p.id, name: p.name, createdAt: p.createdAt, versions: p.versions.length, head: p.head });

class MemoryCfdProjects implements CfdProjectStore {
  private m = new Map<string, CfdProject>();
  async list() {
    return [...this.m.values()].map(brief).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async get(id: string) {
    return this.m.get(id) ?? null;
  }
  async put(p: CfdProject) {
    this.m.set(p.id, structuredClone(p));
  }
  async remove(id: string) {
    this.m.delete(id);
  }
}

class IdbCfdProjects implements CfdProjectStore {
  private db = openDb();
  private async tx<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.db;
    return new Promise((resolve, reject) => {
      const t = db.transaction('cfdProjects', mode);
      const req = f(t.objectStore('cfdProjects'));
      t.oncomplete = () => resolve(req.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error ?? new Error('transaction aborted (storage quota?)'));
    });
  }
  async list() {
    return ((await this.tx('readonly', (s) => s.getAll())) as CfdProject[]).map(brief).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async get(id: string) {
    return ((await this.tx('readonly', (s) => s.get(id))) as CfdProject | undefined) ?? null;
  }
  async put(p: CfdProject) {
    await this.tx('readwrite', (s) => s.put(p));
  }
  async remove(id: string) {
    await this.tx('readwrite', (s) => s.delete(id));
  }
}

export async function openCfdProjects(): Promise<{ store: CfdProjectStore; persistent: boolean }> {
  try {
    const s = new IdbCfdProjects();
    await s.list();
    return { store: s, persistent: true };
  } catch {
    return { store: new MemoryCfdProjects(), persistent: false };
  }
}
