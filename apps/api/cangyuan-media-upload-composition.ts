import type { CangyuanMediaUploadInput, CangyuanMediaUploadPort } from '@/packages/contracts/cangyuan-media-upload';
import { preparePublicMediaBytes, PublicMediaError } from '@/lib/signed-media';
import { CangyuanMediaUploadInputError, uploadCangyuanMedia } from './cangyuan-media-upload-application';

const cangyuanMediaUploadPort: CangyuanMediaUploadPort = {
  async publish(input: CangyuanMediaUploadInput) {
    const mediaKind = input.kind;
    try {
      return await preparePublicMediaBytes(Buffer.from(input.bytes), input.mimeType, mediaKind);
    } catch (error) {
      if (error instanceof PublicMediaError && error.code === 'AGNES_MEDIA_TYPE_NOT_ALLOWED') {
        throw new CangyuanMediaUploadInputError(error.message);
      }
      throw error;
    }
  },
};

export function publishCangyuanMediaUpload(input: CangyuanMediaUploadInput) {
  return uploadCangyuanMedia(input, cangyuanMediaUploadPort);
}
