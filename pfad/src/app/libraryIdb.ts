import { MemoryLibrary, type LibraryEntry, type LibraryPayload, type LibraryStore } from './library';

/** Browser persistence of the library (IndexedDB: entries and payloads in two stores). */
const DB = 'pfad-lab';
const VERSION = 2;

export function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('entries')) db.createObjectStore('entries', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('payloads')) db.createObjectStore('payloads');
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB unavailable'));
  });
}

function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class IdbLibrary implements LibraryStore {
  private db: Promise<IDBDatabase>;
  constructor() {
    this.db = openDb();
  }
  async list() {
    const db = await this.db;
    const all = await done(db.transaction('entries').objectStore('entries').getAll() as IDBRequest<LibraryEntry[]>);
    return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async payload(id: string) {
    const db = await this.db;
    return ((await done(db.transaction('payloads').objectStore('payloads').get(id))) as LibraryPayload | undefined) ?? null;
  }
  async put(entry: LibraryEntry, payload?: LibraryPayload) {
    const db = await this.db;
    const tx = db.transaction(['entries', 'payloads'], 'readwrite');
    tx.objectStore('entries').put(entry);
    if (payload) tx.objectStore('payloads').put(payload, entry.id);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('transaction aborted (storage quota?)'));
    });
  }
  async remove(id: string) {
    const db = await this.db;
    const tx = db.transaction(['entries', 'payloads'], 'readwrite');
    tx.objectStore('entries').delete(id);
    tx.objectStore('payloads').delete(id);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}

/** IndexedDB when available (it is not in private windows of some browsers), else memory. */
export async function openLibrary(): Promise<{ store: LibraryStore; persistent: boolean }> {
  try {
    const lib = new IdbLibrary();
    await lib.list();
    return { store: lib, persistent: true };
  } catch {
    return { store: new MemoryLibrary(), persistent: false };
  }
}
