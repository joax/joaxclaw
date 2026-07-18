import type { ChatMessage } from '../../lib/types'
import { formatTimestamp } from '../../lib/dateUtils'
import { AudioPlayer } from './AudioPlayer'
import { AttachmentCard } from './AttachmentCard'
import { MessageReactions } from './MessageReactions'

// Build a usable src for an attachment: a remote url, or a data: URL from base64.
function attachmentSrc(a: { url?: string; data?: string; mediaType?: string }): string | undefined {
  if (a.url) return a.url
  if (a.data) return `data:${a.mediaType ?? 'application/octet-stream'};base64,${a.data}`
  return undefined
}

interface Props { message: ChatMessage }

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(`[^`\n]+`)/)
  if (parts.length === 1) return text
  return parts.map((part, i) =>
    part.startsWith('`') && part.endsWith('`') && part.length > 2
      ? (
        <code key={i} style={{
          fontFamily: 'monospace',
          fontSize: '0.88em',
          background: 'rgba(0,0,0,0.25)',
          borderRadius: 3,
          padding: '0.1em 0.35em',
        }}>
          {part.slice(1, -1)}
        </code>
      )
      : part
  )
}

const MEDIA_ONLY_PLACEHOLDER = '[User sent media without caption]'

export function UserMessage({ message }: Props) {
  const audioAttachments = message.attachments?.filter(a => a.type === 'audio') ?? []
  const imageAttachments = message.attachments?.filter(a => a.type === 'image') ?? []
  const videoAttachments = message.attachments?.filter(a => a.type === 'video') ?? []
  const fileAttachments = message.attachments?.filter(a => a.type === 'file') ?? []
  const isMediaOnly = !message.content || message.content === MEDIA_ONLY_PLACEHOLDER
  const lines = isMediaOnly ? [] : message.content.split('\n')

  return (
    <div className="flex justify-end animate-fade-in">
      <div className="max-w-[75%]">
        <div className="flex items-center justify-end gap-2 mb-1">
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            {formatTimestamp(message.createdAt)}
          </span>
          <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>You</span>
        </div>
        {imageAttachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-1.5 justify-end">
            {imageAttachments.map((a, i) => (
              <img
                key={i}
                src={a.url ?? `data:${a.mediaType ?? 'image/png'};base64,${a.data}`}
                alt={a.name ?? 'attachment'}
                style={{ maxHeight: 200, maxWidth: 300, borderRadius: 'var(--radius)', objectFit: 'cover', border: '1px solid var(--border)' }}
              />
            ))}
          </div>
        )}
        {videoAttachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-1.5 justify-end">
            {videoAttachments.map((a, i) => (
              <video
                key={i}
                src={attachmentSrc(a)}
                controls
                style={{ maxHeight: 240, maxWidth: 320, borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: '#000' }}
              />
            ))}
          </div>
        )}
        {fileAttachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-1.5 justify-end">
            {fileAttachments.map((a, i) => (
              <AttachmentCard key={i} name={a.name} mediaType={a.mediaType} size={a.size} src={attachmentSrc(a)} variant="message" />
            ))}
          </div>
        )}
        {(!isMediaOnly || audioAttachments.length > 0) && (
          <div
            className="px-4 py-3 text-sm user-bubble"
            style={{
              background: 'var(--accent)',
              color: 'var(--accent-fg)',
              borderRadius: 'var(--radius)',
              borderBottomRightRadius: 4,
              lineHeight: 1.6,
              wordBreak: 'break-word'
            }}
          >
            {lines.map((line, i) => (
              <span key={i}>
                {renderInline(line)}
                {i < lines.length - 1 && <br />}
              </span>
            ))}
            {audioAttachments.map((a, i) => (
              <AudioPlayer key={i} attachment={a} accentColor />
            ))}
          </div>
        )}
        <MessageReactions message={message} align="right" />
      </div>
    </div>
  )
}
