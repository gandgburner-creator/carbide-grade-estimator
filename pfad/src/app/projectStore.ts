import type { Project } from '../geometry/History';
import { openDb } from './libraryIdb';

/** Persistence of flow-guided construction projects (IndexedDB, with an in-memory fallback). */
export interface ProjectStore {
  list(): Promise<{ id: string; name: string; createdAt: string; versions: number; head: string }[]>;
  get(id: string): Promise<Project | null>;
  put(p: Project): Promise<void>;
  remove(id: string): Promise<void>;
}

const brief = (p: Project) => ({ id: p.id, name: p.name, createdAt: p.createdAt, versions: p.versions.length, head: p.head });

export class MemoryProjects implements ProjectStore {
  private m = new Map<string, Project>();
  async list() {
    return [...this.m.values()].map(brief).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async get(id: string) {
    return this.m.get(id) ?? null;
  }
  async put(p: Project) {
    this.m.set(p.id, structuredClone(p));
  }
  async remove(id: string) {
    this.m.delete(id);
  }
}

export class IdbProjects implements ProjectStore {
  private db = openDb();
  private async tx<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.db;
    return new Promise((resolve, reject) => {
      const t = db.transaction('projects', mode);
      const req = f(t.objectStore('projects'));
      t.oncomplete = () => resolve(req.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error ?? new Error('transaction aborted (storage quota?)'));
    });
  }
  async list() {
    return ((await this.tx('readonly', (s) => s.getAll())) as Project[]).map(brief).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async get(id: string) {
    return ((await this.tx('readonly', (s) => s.get(id))) as Project | undefined) ?? null;
  }
  async put(p: Project) {
    await this.tx('readwrite', (s) => s.put(p));
  }
  async remove(id: string) {
    await this.tx('readwrite', (s) => s.delete(id));
  }
}

export async function openProjects(): Promise<{ store: ProjectStore; persistent: boolean }> {
  try {
    const s = new IdbProjects();
    await s.list();
    return { store: s, persistent: true };
  } catch {
    return { store: new MemoryProjects(), persistent: false };
  }
}
