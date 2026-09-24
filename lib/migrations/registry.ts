import type { MigrationStep } from './framework';

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function arrayOrEmpty(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function settingsOrDefault(value: unknown) {
  return isRecord(value) ? value : {
    agentModelId: null,
    defaultImageModelId: null,
    defaultVideoModelId: null,
    defaultProviderId: null,
    imageStoragePath: '',
    videoStoragePath: '',
  };
}

function normalizeProviderState(value: RecordValue, schemaVersion: number, includeUpscaleConnections: boolean) {
  return {
    ...value,
    schemaVersion,
    providers: arrayOrEmpty(value.providers),
    models: arrayOrEmpty(value.models),
    settings: settingsOrDefault(value.settings),
    ...(includeUpscaleConnections ? { upscaleConnections: arrayOrEmpty(value.upscaleConnections) } : {}),
  };
}

/**
 * These migrations normalize metadata only. Existing media is never copied or
 * moved; its current storage root and legacy URL fallback remain valid.
 */
export const LOCAL_DATA_MIGRATIONS: readonly MigrationStep[] = [
  {
    id: 'workspace-legacy-to-1',
    component: 'workspace',
    from: 0,
    to: 1,
    run: async (context) => {
      const value = await context.readLiveJson('workspace.json');
      if (!isRecord(value)) throw new Error('Legacy workspace is not a valid JSON object');
      await context.writeJson('workspace.json', {
        ...value,
        schemaVersion: 1,
        updatedAt: Number(value.updatedAt) || Date.now(),
        clientId: typeof value.clientId === 'string' && value.clientId.trim() ? value.clientId : 'legacy-client',
        canvas: isRecord(value.canvas) ? {
          projects: arrayOrEmpty(value.canvas.projects),
          documents: isRecord(value.canvas.documents) ? value.canvas.documents : {},
          ui: isRecord(value.canvas.ui) ? value.canvas.ui : {},
          ...(Array.isArray(value.canvas.creativeProjects) ? { creativeProjects: value.canvas.creativeProjects } : {}),
        } : { projects: [], documents: {}, ui: {} },
        gallery: arrayOrEmpty(value.gallery),
        chatSessions: arrayOrEmpty(value.chatSessions),
        assetIndex: arrayOrEmpty(value.assetIndex),
        assetCollections: arrayOrEmpty(value.assetCollections),
        preferences: isRecord(value.preferences) ? value.preferences : {},
      });
    },
    verify: async (context) => {
      const value = await context.readJson('workspace.json');
      if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.canvas)) {
        throw new Error('Workspace migration verification failed');
      }
    },
  },
  {
    id: 'provider-state-0-to-1',
    component: 'providerConfig',
    from: 0,
    to: 1,
    run: async (context) => {
      const value = await context.readLiveJson('state.json');
      if (!isRecord(value)) throw new Error('Legacy provider state is not a valid JSON object');
      await context.writeJson('state.json', normalizeProviderState(value, 1, false));
    },
    verify: async (context) => {
      const value = await context.readJson('state.json');
      if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.providers) || !Array.isArray(value.models)) {
        throw new Error('Provider state 0 to 1 migration verification failed');
      }
    },
  },
  {
    id: 'provider-state-1-to-2',
    component: 'providerConfig',
    from: 1,
    to: 2,
    run: async (context) => {
      const value = await context.readJson('state.json') || await context.readLiveJson('state.json');
      if (!isRecord(value)) throw new Error('Provider state is not a valid JSON object');
      await context.writeJson('state.json', normalizeProviderState(value, 2, false));
    },
    verify: async (context) => {
      const value = await context.readJson('state.json');
      if (!isRecord(value) || value.schemaVersion !== 2 || !isRecord(value.settings)) {
        throw new Error('Provider state 1 to 2 migration verification failed');
      }
    },
  },
  {
    id: 'provider-state-2-to-3',
    component: 'providerConfig',
    from: 2,
    to: 3,
    run: async (context) => {
      const value = await context.readJson('state.json') || await context.readLiveJson('state.json');
      if (!isRecord(value)) throw new Error('Provider state is not a valid JSON object');
      await context.writeJson('state.json', normalizeProviderState(value, 3, true));
    },
    verify: async (context) => {
      const value = await context.readJson('state.json');
      if (!isRecord(value) || value.schemaVersion !== 3 || !Array.isArray(value.upscaleConnections)) {
        throw new Error('Provider state 2 to 3 migration verification failed');
      }
    },
  },
];
