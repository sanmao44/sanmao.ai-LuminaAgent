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

export interface AssetRepository<TAsset extends StorageEntity = StorageEntity> {
  list(extra?: TAsset[]): Promise<readonly TAsset[]>;
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
