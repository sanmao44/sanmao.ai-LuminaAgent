import type {
  AssetRepository as AssetRepositoryPort,
  ConversationRepository as ConversationRepositoryPort,
  ProviderConfigRepository as ProviderConfigRepositoryPort,
  TaskRepository as TaskRepositoryPort,
  WorkspaceRepository as WorkspaceRepositoryPort,
} from '@/packages/contracts';
import type { PublicState } from '../types';
import type { AssetRecord } from '../asset-catalog';
import type { AssetIndexItem, ChatSession, GalleryItem } from '../client-history';
import type { WorkspaceSnapshot } from '../workspace-types';
import type { TaskRecord } from '../task-store';

/**
 * TEMPORARY MIGRATION ADAPTER type aliases.
 *
 * The domain-specific DTOs remain in lib during migration, while the stable
 * ports themselves live in packages/contracts and do not depend on lib.
 */
export type WorkspaceRepository = WorkspaceRepositoryPort<WorkspaceSnapshot>;
export type ProviderConfigRepository = ProviderConfigRepositoryPort<PublicState>;
export type AssetRepository = AssetRepositoryPort<AssetRecord, GalleryItem, AssetIndexItem>;
export type ConversationRepository = ConversationRepositoryPort<ChatSession>;
export type TaskRepository<TTask extends TaskRecord = TaskRecord> = TaskRepositoryPort<TTask>;
