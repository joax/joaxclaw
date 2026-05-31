import { useState, useRef, useEffect } from 'react'
import { Send, Square, RotateCcw, Paperclip, X, Image } from 'lucide-react'
import { useChatStore } from '../../store/chat'
import { useSettingsStore } from '../../store/settings'
import type { MediaAttachment } from '../../lib/types'

interface PendingAttachment {
  id: string
  name: string
  mediaType: string
  dataUrl: string
  base64: string
  type: 'image' | 'video' | 'audio'
}

function mimeToMediaType(mime: string): 'image' | 'video' | 'audio' {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  return 'audio'
}

function fileToAttachment(file: File): Promise<PendingAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      resolve({
        id: Math.random().toString(36).slice(2),
        name: file.name,
        mediaType: file.type || 'application/octet-stream',
        dataUrl,
        base64: dataUrl.split(',')[1],
        type: mimeToMediaType(file.type),
      })
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

interface Props { convId: string }

export function MessageInput({ convId }: Props) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [isStalled, setIsStalled] = useState(false)
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([])
  const [isDragOver, setIsDragOver] = useState(false)
  const { sendMessage, abortStream, conversations } = useChatStore()
  const stallTimeoutMs = useSettingsStore(s => s.streamStallTimeout * 1000)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const conv = conversations.find(c => c.id === convId)
  const isStreaming = conv?.messages.some(m => m.streaming) ?? false

  const streamingMsg = conv?.messages.findLast(m => m.streaming)
  const activityKey = streamingMsg
    ? `${streamingMsg.content.length}:${streamingMsg.reasoning?.length ?? 0}:${streamingMsg.toolCalls?.length ?? 0}:${streamingMsg.toolCalls?.filter(t => t.status === 'running').length ?? 0}:${streamingMsg.waitingForSession ?? ''}`
    : null
  const prevActivityKey = useRef<string | null>(null)

  useEffect(() => {
    if (!isStreaming || !activityKey) { setIsStalled(false); return }
    if (activityKey !== prevActivityKey.current) {
      prevActivityKey.current = activityKey
      setIsStalled(false)
    }
    const t = setTimeout(() => setIsStalled(true), stallTimeoutMs)
    return () => clearTimeout(t)
  }, [isStreaming, activityKey, stallTimeoutMs])

  const isBlocked = isStreaming && !isStalled

  const prevBlocked = useRef(isBlocked)
  useEffect(() => {
    if (prevBlocked.current && !isBlocked) textareaRef.current?.focus()
    prevBlocked.current = isBlocked
  }, [isBlocked])

  const canSend = !isBlocked && (!!text.trim() || pendingAttachments.length > 0)

  const handleSend = async (overrideText?: string) => {
    const msg = (overrideText ?? text).trim()
    if ((!msg && pendingAttachments.length === 0) || sending || isBlocked) return
    setText('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    const atts: MediaAttachment[] = pendingAttachments.map(a => ({
      type: a.type, data: a.base64, mediaType: a.mediaType, name: a.name,
    }))
    setPendingAttachments([])
    setSending(true)
    try {
      if (isStreaming) await abortStream(convId)
      await sendMessage(convId, msg, atts.length ? atts : undefined)
    } finally { setSending(false) }
  }

  const handleStop = () => abortStream(convId)

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  }

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const fileItems = Array.from(e.clipboardData.items).filter(
      item => item.kind === 'file' && (item.type.startsWith('image/') || item.type.startsWith('video/') || item.type.startsWith('audio/'))
    )
    if (fileItems.length === 0) return
    e.preventDefault()
    const files = fileItems.map(i => i.getAsFile()).filter(Boolean) as File[]
    const newAtts = await Promise.all(files.map(fileToAttachment))
    setPendingAttachments(prev => [...prev, ...newAtts])
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (files.length === 0) return
    const newAtts = await Promise.all(files.map(fileToAttachment))
    setPendingAttachments(prev => [...prev, ...newAtts])
  }

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragOver(true) }
  const handleDragLeave = () => setIsDragOver(false)
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault(); setIsDragOver(false)
    const files = Array.from(e.dataTransfer.files).filter(f =>
      f.type.startsWith('image/') || f.type.startsWith('video/') || f.type.startsWith('audio/')
    )
    if (files.length === 0) return
    const newAtts = await Promise.all(files.map(fileToAttachment))
    setPendingAttachments(prev => [...prev, ...newAtts])
  }

  const removeAttachment = (id: string) => setPendingAttachments(prev => prev.filter(a => a.id !== id))

  return (
    <div
      className="shrink-0 px-4 py-3"
      style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-surface)' }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isStalled && (
        <div className="flex items-center gap-2 mb-2 px-1">
          <span className="text-xs" style={{ color: 'var(--danger)', opacity: 0.8 }}>Model stopped responding.</span>
          <button onClick={() => handleSend('continue')} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 'var(--radius)', border: '1px solid var(--danger)', background: 'transparent', color: 'var(--danger)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
            <RotateCcw size={10} /> Continue
          </button>
          <button onClick={handleStop} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer' }}>
            Abort
          </button>
        </div>
      )}

      <input ref={fileInputRef} type="file" accept="image/*,video/*,audio/*" multiple style={{ display: 'none' }} onChange={handleFileChange} />

      {/* Attachment previews */}
      {pendingAttachments.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {pendingAttachments.map(att => (
            <div key={att.id} style={{ position: 'relative', display: 'inline-block' }}>
              {att.type === 'image' ? (
                <img src={att.dataUrl} alt={att.name} style={{ height: 72, maxWidth: 120, borderRadius: 8, objectFit: 'cover', border: '1px solid var(--border)' }} />
              ) : (
                <div style={{ height: 72, width: 72, borderRadius: 8, background: 'var(--bg-elevated)', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                  <Image size={20} style={{ color: 'var(--text-secondary)' }} />
                  <span style={{ fontSize: 9, color: 'var(--text-secondary)', textAlign: 'center', padding: '0 4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 64 }}>{att.name}</span>
                </div>
              )}
              <button onClick={() => removeAttachment(att.id)} style={{ position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: '50%', background: 'var(--danger)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div
        className="flex items-end gap-2 p-2 rounded"
        style={{
          border: `1px solid ${isDragOver ? 'var(--accent)' : isStalled ? 'var(--danger)' : 'var(--border)'}`,
          background: isDragOver ? 'color-mix(in srgb, var(--accent) 5%, var(--bg-elevated))' : 'var(--bg-elevated)',
          borderRadius: 'var(--radius)', transition: 'border-color 0.2s, background 0.2s'
        }}
      >
        <button onClick={() => fileInputRef.current?.click()} title="Attach file" disabled={isBlocked} style={{ flexShrink: 0, width: 28, height: 28, border: 'none', background: 'none', cursor: isBlocked ? 'default' : 'pointer', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, opacity: isBlocked ? 0.4 : 1 }}
          onMouseEnter={e => { if (!isBlocked) (e.currentTarget as HTMLElement).style.background = 'var(--bg-primary)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none' }}
        >
          <Paperclip size={15} />
        </button>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleInput}
          onKeyDown={handleKey}
          onPaste={handlePaste}
          placeholder={isDragOver ? 'Drop files here…' : isStalled ? 'Type to continue or use the buttons above…' : 'Message…'}
          rows={1}
          disabled={isBlocked}
          style={{ flex: 1, resize: 'none', border: 'none', background: 'transparent', color: 'var(--text-primary)', fontSize: 14, outline: 'none', fontFamily: 'var(--font-family)', lineHeight: 1.5, padding: '4px 4px', minHeight: 28, maxHeight: 160, overflowY: 'auto' }}
        />
        <button
          onClick={isBlocked ? handleStop : () => handleSend()}
          disabled={!isBlocked && !canSend}
          title={isBlocked ? 'Stop' : 'Send (Enter)'}
          style={{ width: 32, height: 32, borderRadius: 'calc(var(--radius) / 1.5)', border: 'none', background: canSend || isBlocked ? 'var(--accent)' : 'var(--border)', color: 'var(--accent-fg)', cursor: canSend || isBlocked ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.15s', flexShrink: 0 }}
        >
          {isBlocked ? <Square size={13} /> : <Send size={13} />}
        </button>
      </div>
      <p className="text-center mt-1.5 text-xs" style={{ color: 'var(--text-secondary)', opacity: 0.5 }}>
        Enter to send · Shift+Enter for new line · Paste or drag images
      </p>
    </div>
  )
}
