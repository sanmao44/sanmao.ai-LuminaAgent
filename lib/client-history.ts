import type { ClientReferenceImage, ReferenceImageRecord } from './types';
import type { AngleCameraState } from './angle-control';

export type GallerySource = 'generate' | 'agent' | 'edit';

export type GalleryItem = {
  id: string;
  url: string;
  prompt: string;
  revisedPrompt?: string;
  modelId?: string;
  modelName?: string;
  providerName?: string;
  aspectRatio?: string;
  outputSize?: string;
  outputFormat?: 'png' | 'jpeg' | 'webp';
  generationMs?: number;
  source: GallerySource;
  createdAt: number;
  favorite: boolean;
  parentId?: string;
  references?: ReferenceImageRecord[];
  compareReferenceUrl?: string;
  compareReferenceName?: string;
  angle?: AngleCameraState;
};

export type ChatFile = {
  id: string;
  name: string;
  mimeType: string;
  content: string;
  encoding?: 'utf8' | 'base64';
  size?: number;
};

export type ChatMessageVersion = {
  id: string;
  content: string;
  images?: GalleryItem[];
  files?: ChatFile[];
  createdAt: number;
};

export type ChatFollowUp = {
  messageId: string;
  role: 'user' | 'assistant';
  content: string;
};

export type ChatHistoryMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  images?: GalleryItem[];
  files?: ChatFile[];
  references?: ClientReferenceImage[];
  versions?: ChatMessageVersion[];
  activeVersion?: number;
  followUp?: ChatFollowUp;
  webSearch?: { provider?: string; query: string; resultCount: number; searchedAt?: string };
};

export type ChatSession = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatHistoryMessage[];
};

const DB_NAME = 'sanmao-ai';
const DB_VERSION = 3;
const STORE = 'gallery';
const CHAT_STORE = 'chat-sessions';
const SETTINGS_STORE = 'app-settings';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
        store.createIndex('favorite', 'favorite');
      }
      if (!db.objectStoreNames.contains(CHAT_STORE)) {
        const store = db.createObjectStore(CHAT_STORE, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt');
      }
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) db.createObjectStore(SETTINGS_STORE, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('本地历史数据库打开失败'));
  });
}

function withNamedStore<T>(storeName: string, mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then((db) => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const request = fn(tx.objectStore(storeName));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('本地历史数据库操作失败'));
    tx.oncomplete = () => db.close();
    tx.onerror = () => { db.close(); reject(tx.error || new Error('本地历史数据库事务失败')); };
  }));
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = fn(tx.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('本地历史数据库操作失败'));
    tx.oncomplete = () => db.close();
    tx.onerror = () => { db.close(); reject(tx.error || new Error('本地历史数据库事务失败')); };
  });
}

export async function listGallery(): Promise<GalleryItem[]> {
  const items = await withStore<GalleryItem[]>('readonly', (store) => store.getAll());
  return [...items].sort((a, b) => b.createdAt - a.createdAt);
}

export async function saveGalleryItem(item: GalleryItem) {
  await withStore<IDBValidKey>('readwrite', (store) => store.put(item));
}

export async function saveGalleryItems(items: GalleryItem[]) {
  if (!items.length) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    for (const item of items) store.put(item);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error || new Error('保存历史失败')); };
  });
}

export async function removeGalleryItem(id: string) {
  await withStore<undefined>('readwrite', (store) => store.delete(id) as IDBRequest<undefined>);
}

export async function removeGalleryItems(ids: string[]) {
  if (!ids.length) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    for (const id of ids) store.delete(id);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error || new Error('删除历史失败')); };
  });
}

export async function patchGalleryItem(id: string, patch: Partial<GalleryItem>) {
  const current = await withStore<GalleryItem | undefined>('readonly', (store) => store.get(id));
  if (!current) return;
  await saveGalleryItem({ ...current, ...patch, id: current.id });
}

export async function clearGallery() {
  await withStore<undefined>('readwrite', (store) => store.clear() as IDBRequest<undefined>);
}

export async function replaceGalleryItems(items: GalleryItem[]) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    store.clear();
    for (const item of items) store.put(item);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error || new Error('恢复生成历史失败')); };
  });
}

export async function listChatSessions(): Promise<ChatSession[]> {
  const sessions = await withNamedStore<ChatSession[]>(CHAT_STORE, 'readonly', (store) => store.getAll());
  return [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveChatSession(session: ChatSession) {
  await withNamedStore<IDBValidKey>(CHAT_STORE, 'readwrite', (store) => store.put(session));
}

export async function removeChatSession(id: string) {
  await withNamedStore<undefined>(CHAT_STORE, 'readwrite', (store) => store.delete(id) as IDBRequest<undefined>);
}

export async function replaceChatSessions(sessions: ChatSession[]) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(CHAT_STORE, 'readwrite');
    const store = tx.objectStore(CHAT_STORE);
    store.clear();
    for (const session of sessions) store.put(session);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error || new Error('恢复助手历史失败')); };
  });
}

export async function saveImageDirectoryHandle(handle: FileSystemDirectoryHandle) {
  await withNamedStore<IDBValidKey>(SETTINGS_STORE, 'readwrite', (store) => store.put({ key: 'image-directory', handle }));
}

export async function loadImageDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  const value = await withNamedStore<{ key: string; handle?: FileSystemDirectoryHandle } | undefined>(SETTINGS_STORE, 'readonly', (store) => store.get('image-directory'));
  return value?.handle || null;
}

export async function clearImageDirectoryHandle() {
  await withNamedStore<undefined>(SETTINGS_STORE, 'readwrite', (store) => store.delete('image-directory') as IDBRequest<undefined>);
}
