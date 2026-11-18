export type BulkModelStateInput = {
  ids: string[];
  enabled: boolean;
};

export type BulkModelStateResult = {
  updatedCount: number;
};

export type ManualModelAudioTask = 'speech' | 'music-generate' | 'sound-effect' | 'transcription';

export type ManualProviderModelInput = {
  rawId: string;
  displayName?: string;
  kind?: 'auto' | 'chat' | 'image' | 'video' | 'audio' | '3d';
  audioTask?: ManualModelAudioTask;
};
