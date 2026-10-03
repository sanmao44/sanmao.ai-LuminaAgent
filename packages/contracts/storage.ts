/**
 * Stable storage ports.
 *
 * These contracts describe persistence capabilities without naming IndexedDB,
 * localStorage, JSON files, a database client, or an HTTP API. Concrete DTOs
 * stay in the owning domain and are supplied to the ports as type parameters.
 */

export type StorageEntity = { id: string };

export interface ConversationRepository<TConversation extends StorageEntity = StorageEntity> {
  list(): Promise<readonly TConversation[]>;
  get(id: string): Promise<TConversation | null>;
  save(conversation: TConversation): Promise<void>;
  remove(id: string): Promise<void>;
  replaceAll(conversations: readonly TConversation[]): Promise<void>;
}

export interface WorkspaceRepository<TSnapshot = unknown> {
  bootstrap(): Promise<{ offline: boolean }>;
  collect(): Promise<TSnapshot>;
  restore(snapshot: TSnapshot): Promise<void>;
}

export interface AssetRepository<TAsset extends StorageEntity = StorageEntity, TGallery extends StorageEntity = TAsset, TIndex extends StorageEntity = TAsset> {
  list(extra?: TAsset[]): Promise<readonly TAsset[]>;
  listGallery(): Promise<TGallery[]>;
  saveGallery(items: readonly TGallery[]): Promise<void>;
  patchGallery(id: string, patch: Partial<TGallery>): Promise<void>;
  removeGallery(ids: readonly string[]): Promise<void>;
  replaceGallery(items: readonly TGallery[]): Promise<void>;
  listIndex(): Promise<TIndex[]>;
  saveIndex(item: TIndex): Promise<void>;
  replaceIndex(items: readonly TIndex[]): Promise<void>;
  listCollections(): Promise<{ id: string; name: string; color?: string; createdAt: number; updatedAt: number; builtin?: boolean }[]>;
  saveCollections(collections: readonly { id: string; name: string; color?: string; createdAt: number; updatedAt: number; builtin?: boolean }[]): Promise<void>;
}

export type TaskRecord = StorageEntity & {
  createdAt: string;
  idempotencyKey?: string;
};

export type TaskInsertResult<TTask extends TaskRecord> = {
  task: TTask;
  created: boolean;
};

export type TaskPage<TTask> = {
  tasks: readonly TTask[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export interface TaskRepository<TTask extends TaskRecord = TaskRecord> {
  /** Serialized read-modify-write for domain-specific atomic transitions. */
  mutate<R>(fn: (tasks: TTask[]) => R | Promise<R>): Promise<R>;
  find(id: string): Promise<TTask | null>;
  findByIdempotencyKey(key: string): Promise<TTask | null>;
  list(limit?: number): Promise<readonly TTask[]>;
  page(options?: {
    page?: number;
    pageSize?: number;
    defaultPageSize?: number;
    maxPageSize?: number;
    matches?: (task: TTask) => boolean;
  }): Promise<TaskPage<TTask>>;
  insert(task: TTask): Promise<TaskInsertResult<TTask>>;
  update(id: string, patch: Partial<TTask>): Promise<TTask | null>;
  remove(id: string): Promise<TTask | null>;
}

export interface ProviderConfigRepository<TPublicState = unknown> {
  getPublicState(): Promise<TPublicState>;
}

/** Synchronous configuration port for local MCP registration. */
export interface McpConfigRepository<TServer = unknown> {
  list(): TServer[];
  save(servers: readonly TServer[]): TServer[];
}
