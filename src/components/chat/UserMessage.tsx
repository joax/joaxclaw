import type { ChatMessage } from '../../lib/types'
import { formatTimestamp } from '../../lib/dateUtils'
import { AudioPlayer } from './AudioPlayer'

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

export function UserMessage({ message }: Props) {
  const lines = message.content.split('\n')

  return (
    <div className="flex justify-end animate-fade-in">
      <div className="max-w-[75%]">
        <div className="flex items-center justify-end gap-2 mb-1">
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            {formatTimestamp(message.createdAt)}
          </span>
          <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>You</span>
        </div>
        <div
          className="px-4 py-3 text-sm"
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
          {message.attachments?.filter(a => a.type === 'audio').map((a, i) => (
            <AudioPlayer key={i} attachment={a} accentColor />
          ))}
        </div>
      </div>
    </div>
  )
}
