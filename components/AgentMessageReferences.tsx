import type { CreativeReference } from '@/lib/creative-references';

type AgentMessageReferencesProps = {
  references: CreativeReference[];
  resolveUrl: (reference: CreativeReference) => string;
  onPreview: (reference: CreativeReference) => void;
};

/** Read-only reference thumbnails attached to a message. */
export default function AgentMessageReferences({ references, resolveUrl, onPreview }: AgentMessageReferencesProps) {
  return (
    <div className="message-refs">
      {references.map((reference, index) => (
        <button
          type="button"
          className="message-ref-thumb"
          title={`点击放大查看 · ${reference.kind === 'text' ? '引用' : '参考图'} ${index + 1} · ${reference.name}`}
          aria-label={`放大查看${reference.kind === 'text' ? '引用' : '参考图'} ${index + 1}`}
          onClick={() => onPreview(reference)}
          key={reference.id}
        >
          {reference.kind === 'video'
            ? <video src={resolveUrl(reference)} muted playsInline />
            : reference.kind === 'text'
              ? <span className="message-ref-text"><small>{reference.name}</small></span>
              : <img src={resolveUrl(reference)} alt={reference.name} />}
          <span className="message-ref-index">{index + 1}</span>
        </button>
      ))}
    </div>
  );
}
