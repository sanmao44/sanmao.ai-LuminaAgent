import { artifactStore } from '@/lib/artifacts';
import { uploadAudioAttachment, type AudioAttachmentUpload } from './audio-attachment-application';

export function runAudioAttachmentUpload(input: AudioAttachmentUpload) {
  return uploadAudioAttachment(input, {
    save: async ({ name, mimeType, data }) => {
      const artifact = await artifactStore.save({
        kind: 'file',
        name,
        mimeType,
        data: Buffer.from(data),
      });
      return {
        id: artifact.id,
        name: artifact.name,
        mimeType: artifact.mimeType,
        size: artifact.size,
        downloadUrl: artifact.downloadUrl,
      };
    },
  });
}
