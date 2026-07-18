import { useState, useRef, useEffect } from 'react'
import { Send, Square, RotateCcw, Paperclip, X, Mic, MicOff, AudioWaveform, UserRound } from 'lucide-react'
import { useChatStore } from '../../store/chat'
import { useSettingsStore } from '../../store/settings'
import { profileIsEmpty } from '../../lib/userProfile'
import { useStreamStatus } from './useStreamStatus'
import { useDraftsStore } from '../../store/drafts'
import type { PendingAttachment } from '../../store/drafts'
import type { MediaAttachment } from '../../lib/types'
import { classifyKind } from '../../lib/attachments'
import { AttachmentCard } from './AttachmentCard'
import { searchEmoji, activeEmojiToken, completedEmojiAt, type EmojiHit } from '../../lib/emoji'

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
        size: file.size,
        type: classifyKind(file.type, file.name),
      })
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function pickMimeType(): string {
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']) {
    if (MediaRecorder.isTypeSupported(t)) return t
  }
  return ''
}

function formatRecTime(ms: number): string {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`
}

// Stable empty draft — module-level so Object.is returns true on every render
// when there is no draft for a conversation, preventing infinite Zustand loops.
const EMPTY_DRAFT = { text: '', attachments: [] as PendingAttachment[] }

interface Props { convId: string }

export function MessageInput({ convId }: Props) {
  const { setText: storSetText, setAttachments: storeSetAtts, clear: storeClear, get: storeGet } = useDraftsStore()
  const draft = useDraftsStore(s => s.drafts[convId] ?? EMPTY_DRAFT)
  const text = draft.text
  const pendingAttachments = draft.attachments

  const setText = (t: string) => storSetText(convId, t)
  const setPendingAttachments = (fn: PendingAttachment[] | ((prev: PendingAttachment[]) => PendingAttachment[])) => {
    const current = storeGet(convId).attachments
    const next = typeof fn === 'function' ? fn(current) : fn
    storeSetAtts(convId, next)
  }

  const [sending, setSending] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const [recording, setRecording] = useState(false)
  const [recordingMs, setRecordingMs] = useState(0)
  // `:shortcode` emoji autocomplete popup (null = closed).
  const [emojiMenu, setEmojiMenu] = useState<{ start: number; query: string; items: EmojiHit[]; active: number } | null>(null)
  const { sendMessage, abortStream, compact, conversations, setShareProfileOverride } = useChatStore()
  const { userProfile, shareProfile } = useSettingsStore()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // Caret position to restore after a programmatic text edit (emoji insertion),
  // since the controlled textarea would otherwise reset the caret to the end.
  const pendingCaretRef = useRef<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recChunksRef = useRef<Blob[]>([])
  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const conv = conversations.find(c => c.id === convId)
  // Profile is injected on the first turn only, so the per-chat share control is only
  // meaningful (and shown) on a brand-new chat with a filled-in profile.
  const isNewChat = (conv?.messages.length ?? 0) === 0
  const effectiveShare = conv?.shareProfileOverride ?? shareProfile
  const showProfileChip = isNewChat && !profileIsEmpty(userProfile)
  const isStreaming = conv?.messages.some(m => m.streaming) ?? false
  const streamingMsg = conv?.messages.findLast(m => m.streaming)

  // Phase-aware liveness: distinguishes model-load / first-token latency, healthy
  // streaming, a real stall, and a dropped connection (see lib/streamStatus.ts).
  const { status: streamStatus, elapsedSeconds } = useStreamStatus(streamingMsg, isStreaming)
  const isStalled = streamStatus === 'stalled'
  // Only a genuine stall re-opens the input (so the user can type "continue").
  const isBlocked = isStreaming && !isStalled

  // Focus and restore textarea height when the conversation opens or switches
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.focus()
    // Re-measure height for any restored draft text
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  }, [convId])

  const prevBlocked = useRef(isBlocked)
  useEffect(() => {
    if (prevBlocked.current && !isBlocked) textareaRef.current?.focus()
    prevBlocked.current = isBlocked
  }, [isBlocked])

  // After a programmatic edit (emoji insertion), restore the caret and re-measure
  // the textarea height once the controlled value has been applied.
  useEffect(() => {
    const el = textareaRef.current
    if (!el || pendingCaretRef.current == null) return
    const pos = pendingCaretRef.current
    pendingCaretRef.current = null
    el.selectionStart = el.selectionEnd = pos
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  }, [text])

  // Stop recording on unmount
  useEffect(() => () => {
    mediaRecorderRef.current?.state !== 'inactive' && mediaRecorderRef.current?.stop()
    recTimerRef.current && clearInterval(recTimerRef.current)
  }, [])

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = pickMimeType()
      const mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      mediaRecorderRef.current = mr
      recChunksRef.current = []

      mr.ondataavailable = e => { if (e.data.size > 0) recChunksRef.current.push(e.data) }
      mr.onstop = () => {
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(recChunksRef.current, { type: mr.mimeType })
        const ext = mr.mimeType.includes('ogg') ? 'ogg' : mr.mimeType.includes('mp4') ? 'mp4' : 'webm'
        const file = new File([blob], `voice-${Date.now()}.${ext}`, { type: mr.mimeType })
        fileToAttachment(file).then(att => setPendingAttachments(prev => [...prev, att]))
        setRecording(false)
        setRecordingMs(0)
        if (recTimerRef.current) { clearInterval(recTimerRef.current); recTimerRef.current = null }
      }

      mr.start(100)
      setRecording(true)
      setRecordingMs(0)
      recTimerRef.current = setInterval(() => setRecordingMs(ms => ms + 100), 100)
    } catch {
      // Permission denied or no mic — silently ignore
    }
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
  }

  const canSend = !isBlocked && (!!text.trim() || pendingAttachments.length > 0)

  const handleSend = async (overrideText?: string) => {
    const msg = (overrideText ?? text).trim()
    if ((!msg && pendingAttachments.length === 0) || sending || isBlocked) return

    // ── Slash commands ────────────────────────────────────────────────────────
    if (msg.startsWith('/') && !overrideText) {
      const cmd = msg.slice(1).trim().toLowerCase()
      if (cmd === 'compact') {
        storeClear(convId)
        if (textareaRef.current) textareaRef.current.style.height = 'auto'
        await compact(convId)
        return
      }
      // Unknown slash command — let it through as a regular message
    }

    const atts: MediaAttachment[] = pendingAttachments.map(a => ({
      type: a.type, data: a.base64, mediaType: a.mediaType, name: a.name, size: a.size,
    }))
    storeClear(convId)
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    setSending(true)
    try {
      if (isStreaming) await abortStream(convId)
      await sendMessage(convId, msg, atts.length ? atts : undefined)
    } finally { setSending(false) }
  }

  const handleStop = () => abortStream(convId)

  // ── Emoji `:shortcode` autocomplete ─────────────────────────────────────────
  // Recompute the popup from the textarea's current value + caret.
  const refreshEmojiMenu = (el: HTMLTextAreaElement) => {
    const tok = activeEmojiToken(el.value, el.selectionStart ?? 0)
    if (!tok) { setEmojiMenu(null); return }
    const items = searchEmoji(tok.query)
    if (!items.length) { setEmojiMenu(null); return }
    setEmojiMenu(prev => ({
      start: tok.start, query: tok.query, items,
      active: prev && prev.query === tok.query ? Math.min(prev.active, items.length - 1) : 0,
    }))
  }

  // Replace the active `:token` at the caret with the chosen emoji + a space.
  const insertEmoji = (hit: EmojiHit) => {
    const el = textareaRef.current
    if (!el) return
    const caret = el.selectionStart ?? el.value.length
    const tok = activeEmojiToken(el.value, caret)
    const start = tok ? tok.start : caret
    const insert = hit.char + ' '
    setText(el.value.slice(0, start) + insert + el.value.slice(caret))
    pendingCaretRef.current = start + insert.length
    setEmojiMenu(null)
  }

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (emojiMenu && emojiMenu.items.length) {
      const n = emojiMenu.items.length
      if (e.key === 'ArrowDown') { e.preventDefault(); setEmojiMenu(m => m && { ...m, active: (m.active + 1) % n }); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setEmojiMenu(m => m && { ...m, active: (m.active - 1 + n) % n }); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertEmoji(emojiMenu.items[emojiMenu.active]); return }
      if (e.key === 'Escape') { e.preventDefault(); setEmojiMenu(null); return }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  // Recompute the popup after caret-only moves (arrows / Home / End) with no edit.
  const handleKeyUp = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) refreshEmojiMenu(e.currentTarget)
  }

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const el = e.target
    const caret = el.selectionStart ?? el.value.length
    // Auto-convert a fully-typed `:shortcode:` (closing colon just entered).
    const done = completedEmojiAt(el.value, caret)
    if (done) {
      const insert = done.char + ' '
      setText(el.value.slice(0, done.start) + insert + el.value.slice(done.end))
      pendingCaretRef.current = done.start + insert.length
      setEmojiMenu(null)
      return
    }
    setText(el.value)
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
    refreshEmojiMenu(el)
  }

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const fileItems = Array.from(e.clipboardData.items).filter(item => item.kind === 'file')
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
    const files = Array.from(e.dataTransfer.files)
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
      {showProfileChip && (
        <div className="flex items-center gap-2 mb-2 px-1">
          <button
            onClick={() => setShareProfileOverride(convId, !effectiveShare)}
            title={effectiveShare
              ? 'Your profile (Settings → You) will be shared as context with this chat — click to keep it private here'
              : 'Your profile won’t be shared with this chat — click to share it'}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '3px 9px',
              borderRadius: 999, cursor: 'pointer',
              border: `1px solid ${effectiveShare ? 'color-mix(in srgb, var(--accent) 35%, var(--border))' : 'var(--border)'}`,
              background: effectiveShare ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'transparent',
              color: effectiveShare ? 'var(--accent)' : 'var(--text-secondary)',
            }}
          >
            <UserRound size={11} />
            {effectiveShare ? 'Sharing your profile' : 'Profile not shared'}
          </button>
        </div>
      )}

      {isStalled && (
        <div className="flex items-center gap-2 mb-2 px-1">
          <span className="text-xs" style={{ color: 'var(--danger)', opacity: 0.8 }}>
            Model may have stopped responding{elapsedSeconds ? ` (${elapsedSeconds}s)` : ''}.
          </span>
          <button onClick={() => handleSend('continue')} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 'var(--radius)', border: '1px solid var(--danger)', background: 'transparent', color: 'var(--danger)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
            <RotateCcw size={10} /> Continue
          </button>
          <button onClick={handleStop} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer' }}>
            Abort
          </button>
        </div>
      )}

      {/* First-token latency (model loading / encoding a long prompt): patient, not alarming. */}
      {streamStatus === 'warming' && elapsedSeconds >= 8 && (
        <div className="flex items-center gap-2 mb-2 px-1">
          <span className="text-xs" style={{ color: 'var(--text-secondary)', opacity: 0.75 }}>
            Waiting for the model to respond… ({elapsedSeconds}s)
          </span>
          <button onClick={handleStop} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer' }}>
            Stop
          </button>
        </div>
      )}

      {/* The gateway went quiet — a connection problem, not a model stall. */}
      {streamStatus === 'disconnected' && (
        <div className="flex items-center gap-2 mb-2 px-1">
          <span className="text-xs" style={{ color: 'var(--warning)', opacity: 0.85 }}>
            Connection lost — reconnecting…
          </span>
          <button onClick={handleStop} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer' }}>
            Stop
          </button>
        </div>
      )}

      <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }} onChange={handleFileChange} />

      {/* Attachment previews */}
      {pendingAttachments.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {pendingAttachments.map(att => (
            <div key={att.id} style={{ position: 'relative', display: 'inline-block' }}>
              {att.type === 'image' ? (
                <img src={att.dataUrl} alt={att.name} style={{ height: 72, maxWidth: 120, borderRadius: 8, objectFit: 'cover', border: '1px solid var(--border)' }} />
              ) : att.type === 'video' ? (
                <video src={att.dataUrl} muted style={{ height: 72, maxWidth: 120, borderRadius: 8, objectFit: 'cover', border: '1px solid var(--border)', background: '#000' }} />
              ) : att.type === 'audio' ? (
                <div style={{ height: 56, minWidth: 120, maxWidth: 180, borderRadius: 8, background: 'color-mix(in srgb, var(--accent) 10%, var(--bg-elevated))', border: '1px solid color-mix(in srgb, var(--accent) 25%, var(--border))', display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px' }}>
                  <AudioWaveform size={18} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                  <span style={{ fontSize: 10, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {att.name.startsWith('voice-') ? 'Voice note' : att.name}
                  </span>
                </div>
              ) : (
                <AttachmentCard name={att.name} mediaType={att.mediaType} size={att.size} variant="input" />
              )}
              <button onClick={() => removeAttachment(att.id)} style={{ position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: '50%', background: 'var(--danger)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ position: 'relative' }}>
      {/* Emoji autocomplete popup */}
      {emojiMenu && emojiMenu.items.length > 0 && (
        <div style={{ position: 'absolute', bottom: 'calc(100% + 6px)', left: 0, zIndex: 50, minWidth: 220, maxWidth: 320, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: '0 8px 24px rgba(0,0,0,0.35)', overflow: 'hidden', padding: 4 }}>
          {emojiMenu.items.map((hit, i) => (
            <button
              key={hit.code}
              onMouseDown={e => { e.preventDefault(); insertEmoji(hit) }}
              onMouseEnter={() => setEmojiMenu(m => m && { ...m, active: i })}
              style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '5px 8px', border: 'none', borderRadius: 'calc(var(--radius) / 1.5)', cursor: 'pointer', background: i === emojiMenu.active ? 'color-mix(in srgb, var(--accent) 15%, transparent)' : 'transparent', color: 'var(--text-primary)' }}
            >
              <span style={{ fontSize: 18, lineHeight: 1, width: 22, textAlign: 'center' }}>{hit.char}</span>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>:{hit.code}:</span>
            </button>
          ))}
        </div>
      )}
      <div
        className="flex items-end gap-2 p-2 rounded"
        style={{
          border: `1px solid ${recording ? 'var(--danger)' : isDragOver ? 'var(--accent)' : isStalled ? 'var(--danger)' : 'var(--border)'}`,
          background: recording ? 'color-mix(in srgb, var(--danger) 4%, var(--bg-elevated))' : isDragOver ? 'color-mix(in srgb, var(--accent) 5%, var(--bg-elevated))' : 'var(--bg-elevated)',
          borderRadius: 'var(--radius)', transition: 'border-color 0.2s, background 0.2s'
        }}
      >
        {/* Paperclip — hidden while recording */}
        {!recording && (
          <button onClick={() => fileInputRef.current?.click()} title="Attach file" disabled={isBlocked} style={{ flexShrink: 0, width: 28, height: 28, border: 'none', background: 'none', cursor: isBlocked ? 'default' : 'pointer', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, opacity: isBlocked ? 0.4 : 1 }}
            onMouseEnter={e => { if (!isBlocked) (e.currentTarget as HTMLElement).style.background = 'var(--bg-primary)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none' }}
          >
            <Paperclip size={15} />
          </button>
        )}

        {/* Recording indicator — replaces textarea while recording */}
        {recording ? (
          <>
            <div className="flex items-center gap-2 flex-1 px-1">
              <span className="animate-pulse-dot" style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--danger)', flexShrink: 0 }} />
              <span className="font-mono text-sm" style={{ color: 'var(--danger)' }}>{formatRecTime(recordingMs)}</span>
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Recording…</span>
            </div>
            <button
              onClick={stopRecording}
              title="Stop recording"
              style={{ flexShrink: 0, width: 32, height: 32, border: 'none', background: 'var(--danger)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 'calc(var(--radius) / 1.5)' }}
            >
              <MicOff size={14} />
            </button>
          </>
        ) : (
          <>
            <textarea
              ref={textareaRef}
              value={text}
              onChange={handleInput}
              onKeyDown={handleKey}
              onKeyUp={handleKeyUp}
              onClick={e => refreshEmojiMenu(e.currentTarget)}
              onBlur={() => setTimeout(() => setEmojiMenu(null), 120)}
              onPaste={handlePaste}
              placeholder={isDragOver ? 'Drop files here…' : isStalled ? 'Type to continue or use the buttons above…' : 'Message…'}
              rows={1}
              disabled={isBlocked}
              style={{ flex: 1, resize: 'none', border: 'none', background: 'transparent', color: 'var(--text-primary)', fontSize: 14, outline: 'none', fontFamily: 'var(--font-family)', lineHeight: 1.5, padding: '4px 4px', minHeight: 28, maxHeight: 160, overflowY: 'auto' }}
            />
            {/* Mic button */}
            <button
              onClick={startRecording}
              title="Record voice note"
              disabled={isBlocked}
              style={{ flexShrink: 0, width: 28, height: 28, border: 'none', background: 'none', cursor: isBlocked ? 'default' : 'pointer', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, opacity: isBlocked ? 0.4 : 1 }}
              onMouseEnter={e => { if (!isBlocked) { (e.currentTarget as HTMLElement).style.background = 'var(--bg-primary)'; (e.currentTarget as HTMLElement).style.color = 'var(--accent)' } }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)' }}
            >
              <Mic size={15} />
            </button>
            <button
              onClick={isBlocked ? handleStop : () => handleSend()}
              disabled={!isBlocked && !canSend}
              title={isBlocked ? 'Stop' : 'Send (Enter)'}
              style={{ width: 32, height: 32, borderRadius: 'calc(var(--radius) / 1.5)', border: 'none', background: canSend || isBlocked ? 'var(--accent)' : 'var(--border)', color: 'var(--accent-fg)', cursor: canSend || isBlocked ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.15s', flexShrink: 0 }}
            >
              {isBlocked ? <Square size={13} /> : <Send size={13} />}
            </button>
          </>
        )}
      </div>
      </div>
      <p className="text-center mt-1.5 text-xs" style={{ color: 'var(--text-secondary)', opacity: 0.5 }}>
        Enter to send · Shift+Enter for new line · Paste or drag images · <code>:</code> for emoji
      </p>
    </div>
  )
}
