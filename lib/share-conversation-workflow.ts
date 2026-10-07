import {
  renderShareConversationImage,
  type ShareConversationRenderMessage,
} from "./share-conversation-renderer";

export type ShareConversationPreview = {
  url: string;
  width: number;
  height: number;
  filename: string;
};

/** Render selected messages and preserve the existing preview metadata contract. */
export async function createShareConversationPreview(
  messages: ShareConversationRenderMessage[],
  now = new Date(),
): Promise<Omit<ShareConversationPreview, "url"> & { blob: Blob }> {
  const result = await renderShareConversationImage(messages);
  return {
    blob: result.blob,
    width: result.width,
    height: result.height,
    filename: `SANMAO-瀵硅瘽鍒嗕韩-${now.toISOString().slice(0, 10)}.png`,
  };
}
