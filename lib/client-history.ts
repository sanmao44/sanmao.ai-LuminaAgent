import type { ClientReferenceImage, ReferenceImageRecord, WebSearchDecisionMeta, WebSearchMeta } from './types';
import type { AngleCameraState } from './angle-control';
import { emitWorkspaceChange } from './workspace-events';

export type GallerySource = 'generate' | 'agent' | 'edit' | 'canvas';

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
  interrupted?: boolean;
  webSearch?: WebSearchMeta;
  webSearchDecision?: WebSearchDecisionMeta;
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
  interrupted?: boolean;
  versions?: ChatMessageVersion[];
  activeVersion?: number;
  followUp?: ChatFollowUp;
  webSearch?: WebSearchMeta;
  webSearchDecision?: WebSearchDecisionMeta;
};

export type ChatSession = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatHistoryMessage[];
};

export type AssetIndexItem = {
  id: string;
  kind: 'image' | 'video';
  url: string;
  name: string;
  source: 'canvas-upload' | 'canvas-output' | 'metadata';
  createdAt: number;
  favorite?: boolean;
  hidden?: boolean;
  prompt?: string;
  modelId?: string;
  modelName?: string;
  width?: number;
  height?: number;
  projectIds?: string[];
  /** Optional collection and tag metadata introduced by the canvas asset library. */
  collectionIds?: string[];
  tags?: string[];
};

export type AssetCollection = {
  id: string;
  name: string;
  color?: string;
  createdAt: number;
  updatedAt: number;
  builtin?: boolean;
};

const DB_NAME = 'sanmao-ai';
const DB_VERSION = 4;
const STORE = 'gallery';
const CHAT_STORE = 'chat-sessions';
const SETTINGS_STORE = 'app-settings';
const ASSET_STORE = 'asset-index';

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
      if (!db.objectStoreNames.contains(ASSET_STORE)) {
        const store = db.createObjectStore(ASSET_STORE, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
        store.createIndex('kind', 'kind');
        store.createIndex('source', 'source');
      }
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
  emitWorkspaceChange();
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
  emitWorkspaceChange();
}

export async function removeGalleryItem(id: string) {
  await withStore<undefined>('readwrite', (store) => store.delete(id) as IDBRequest<undefined>);
  emitWorkspaceChange();
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
  emitWorkspaceChange();
}

export async function patchGalleryItem(id: string, patch: Partial<GalleryItem>) {
  const current = await withStore<GalleryItem | undefined>('readonly', (store) => store.get(id));
  if (!current) return;
  await saveGalleryItem({ ...current, ...patch, id: current.id });
}

export async function clearGallery() {
  await withStore<undefined>('readwrite', (store) => store.clear() as IDBRequest<undefined>);
  emitWorkspaceChange();
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
  emitWorkspaceChange();
}

export async function listChatSessions(): Promise<ChatSession[]> {
  const sessions = await withNamedStore<ChatSession[]>(CHAT_STORE, 'readonly', (store) => store.getAll());
  return [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveChatSession(session: ChatSession) {
  await withNamedStore<IDBValidKey>(CHAT_STORE, 'readwrite', (store) => store.put(session));
  emitWorkspaceChange();
}

export async function removeChatSession(id: string) {
  await withNamedStore<undefined>(CHAT_STORE, 'readwrite', (store) => store.delete(id) as IDBRequest<undefined>);
  emitWorkspaceChange();
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
  emitWorkspaceChange();
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

export async function listAssetIndex(): Promise<AssetIndexItem[]> {
  const items = await withNamedStore<AssetIndexItem[]>(ASSET_STORE, 'readonly', (store) => store.getAll());
  return [...items].sort((left, right) => right.createdAt - left.createdAt);
}

export async function saveAssetIndexItem(item: AssetIndexItem) {
  await withNamedStore<IDBValidKey>(ASSET_STORE, 'readwrite', (store) => store.put(item));
  emitWorkspaceChange();
}

export async function saveAssetIndexItems(items: AssetIndexItem[]) {
  if (!items.length) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(ASSET_STORE, 'readwrite');
    const store = tx.objectStore(ASSET_STORE);
    items.forEach((item) => store.put(item));
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error || new Error('保存资产索引失败')); };
  });
  emitWorkspaceChange();
}

export async function removeAssetIndexItem(id: string) {
  await withNamedStore<undefined>(ASSET_STORE, 'readwrite', (store) => store.delete(id) as IDBRequest<undefined>);
  emitWorkspaceChange();
}

export async function replaceAssetIndexItems(items: AssetIndexItem[]) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(ASSET_STORE, 'readwrite');
    const store = tx.objectStore(ASSET_STORE);
    store.clear();
    for (const item of items) store.put(item);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error || new Error('恢复资产索引失败')); };
  });
  emitWorkspaceChange();
}

const ASSET_COLLECTIONS_KEY = 'canvas-asset-collections';

export const DEFAULT_ASSET_COLLECTIONS: AssetCollection[] = [
  { id: 'all', name: '全部', createdAt: 0, updatedAt: 0, builtin: true },
  { id: 'recent', name: '最近使用', createdAt: 0, updatedAt: 0, builtin: true },
  { id: 'favorite', name: '收藏', createdAt: 0, updatedAt: 0, builtin: true },
  { id: 'generated', name: '生成结果', createdAt: 0, updatedAt: 0, builtin: true },
  { id: 'reference', name: '参考素材', createdAt: 0, updatedAt: 0, builtin: true },
  { id: 'image', name: '图片', createdAt: 0, updatedAt: 0, builtin: true },
  { id: 'video', name: '视频', createdAt: 0, updatedAt: 0, builtin: true },
  { id: 'uncategorized', name: '未分类', createdAt: 0, updatedAt: 0, builtin: true },
];

export async function listAssetCollections(): Promise<AssetCollection[]> {
  const value = await withNamedStore<{ key: string; value?: AssetCollection[] } | undefined>(SETTINGS_STORE, 'readonly', (store) => store.get(ASSET_COLLECTIONS_KEY));
  const custom = Array.isArray(value?.value) ? value!.value : [];
  return [...DEFAULT_ASSET_COLLECTIONS, ...custom.filter((item) => !DEFAULT_ASSET_COLLECTIONS.some((builtin) => builtin.id === item.id))];
}

export async function saveAssetCollections(collections: AssetCollection[]) {
  const custom = collections.filter((item) => !item.builtin && !DEFAULT_ASSET_COLLECTIONS.some((builtin) => builtin.id === item.id));
  await withNamedStore<IDBValidKey>(SETTINGS_STORE, 'readwrite', (store) => store.put({ key: ASSET_COLLECTIONS_KEY, value: custom }));
  emitWorkspaceChange();
}

export async function patchAssetIndexMetadata(id: string, patch: Partial<Pick<AssetIndexItem, 'collectionIds' | 'tags' | 'favorite' | 'projectIds'>>) {
  const current = await withNamedStore<AssetIndexItem | undefined>(ASSET_STORE, 'readonly', (store) => store.get(id));
  if (!current) return;
  await saveAssetIndexItem({ ...current, ...patch, id: current.id });
}
