import type { SaveData } from '../core/serialize';

const DB = 'evolvere';
const STORE = 'saves';

export interface SaveRecord {
  name: string;
  createdAt: number;
  tick: number;
  pop: number;
  species: number;
  data: SaveData;
}

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'name' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((res, rej) => {
        const t = db.transaction(STORE, mode);
        const rq = fn(t.objectStore(STORE));
        rq.onsuccess = () => res(rq.result);
        rq.onerror = () => rej(rq.error);
      }),
  );
}

export const storage = {
  put: (rec: SaveRecord) => tx('readwrite', (s) => s.put(rec)),
  get: (name: string) => tx<SaveRecord | undefined>('readonly', (s) => s.get(name) as IDBRequest<SaveRecord | undefined>),
  remove: (name: string) => tx('readwrite', (s) => s.delete(name)),
  list: () => tx<SaveRecord[]>('readonly', (s) => s.getAll() as IDBRequest<SaveRecord[]>),
};
