export type CreativeReference = {
  id: string;
  kind: 'image' | 'video' | 'text';
  name: string;
  url?: string;
  text?: string;
  mimeType?: string;
  nodeId?: string;
  pending?: boolean;
  error?: string;
};
