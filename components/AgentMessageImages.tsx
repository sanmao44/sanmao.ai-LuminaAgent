import type { ReactNode } from 'react';

type AgentMessageImagesProps<T> = {
  images: T[];
  renderImage: (item: T) => ReactNode;
};

/** Agent image result grid; image state and card actions remain page-owned. */
export default function AgentMessageImages<T>({ images, renderImage }: AgentMessageImagesProps<T>) {
  if (!images.length) return null;
  return <div className="message-images">{images.map(renderImage)}</div>;
}
