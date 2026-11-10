import type { VideoJob } from './types';

const DB_NAME = 'yt-bulk-uploader';
const STORE = 'state';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveValue<T>(key: string, value: T): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function getValue<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  const value = await new Promise<T | undefined>((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return value;
}

export async function saveJobs(jobs: VideoJob[]) {
  await saveValue('jobs', jobs);
}

export async function loadJobs() {
  return (await getValue<VideoJob[]>('jobs')) || [];
}

export async function saveDirectory(handle: FileSystemDirectoryHandle) {
  await saveValue('directory', handle);
}

export async function loadDirectory() {
  return getValue<FileSystemDirectoryHandle>('directory');
}