import { useState, useEffect, useRef, useCallback } from 'react'
import { X, Plus, Trash2, FileText, Pencil, Loader2, AlertCircle, Check, Save } from 'lucide-react'
import Editor from '@monaco-editor/react'
import type { Agent, AgentFile } from '../../lib/types'
import { useAgentsStore } from '../../store/agents'
import { Btn } from '../ui/Btn'
import { Input } from '../ui/Input'
import { ModelPicker } from '../ui/ModelPicker'

interface Props { agent: Agent; onClose: () => void }

type Tab = 'model' | 'subagents' | 'files'

export function AgentEditor({ agent, onClose }: Props) {
  const { agents, update, listFiles, readFile, writeFile, deleteFile } = useAgentsStore()
  const [tab, setTab] = useState<Tab>('model')

  // Model tab state
  const [primaryModel, setPrimaryModel] = useState(agent.model?.primary ?? '')
  const [fallbacks, setFallbacks] = useState<string[]>(agent.model?.fallbacks ?? [])
  const [savingModel, setSavingModel] = useState(false)
  const [modelSaved, setModelSaved] = useState(false)
  const [modelError, setModelError] = useState<string | null>(null)

  // Subagents tab state
  const [allowedSubAgents, setAllowedSubAgents] = useState<string[]>(agent.allowedSubAgents ?? [])
  const [savingSubagents, setSavingSubagents] = useState(false)
  const [subagentsSaved, setSubagentsSaved] = useState(false)
  const [subagentsError, setSubagentsError] = useState<string | null>(null)

  // Files tab state
  const [files, setFiles] = useState<AgentFile[]>([])
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [filesError, setFilesError] = useState<string | null>(null)
  const [newFilename, setNewFilename] = useState('')
  const [showNewFile, setShowNewFile] = useState(false)
  const [confirmDeleteFile, setConfirmDeleteFile] = useState<string | null>(null)

  // Full-screen file editor state
  const [fileEditorOpen, setFileEditorOpen] = useState(false)
  const [editingFilename, setEditingFilename] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState('')
  const [originalContent, setOriginalContent] = useState('')
  const [loadingContent, setLoadingContent] = useState(false)
  const [fileLoadError, setFileLoadError] = useState<string | null>(null)
  const [savingFile, setSavingFile] = useState(false)
  const [fileSaved, setFileSaved] = useState(false)

  const otherAgents = agents.filter(a => a.id !== agent.id)
  const isDirty = fileContent !== originalContent

  useEffect(() => {
    if (tab === 'files') loadFiles()
  }, [tab])

  async function loadFiles() {
    setLoadingFiles(true)
    setFilesError(null)
    try {
      setFiles(await listFiles(agent.id))
    } catch (e) {
      setFilesError(String(e))
    } finally {
      setLoadingFiles(false)
    }
  }

  async function handleSaveModel() {
    setSavingModel(true); setModelError(null); setModelSaved(false)
    try {
      await update(agent.id, { model: { primary: primaryModel.trim(), fallbacks: fallbacks.filter(Boolean) } })
      setModelSaved(true); setTimeout(() => setModelSaved(false), 2000)
    } catch (e) { setModelError(String(e)) }
    finally { setSavingModel(false) }
  }

  async function handleSaveSubagents() {
    setSavingSubagents(true); setSubagentsError(null); setSubagentsSaved(false)
    try {
      await update(agent.id, { allowedSubAgents })
      setSubagentsSaved(true); setTimeout(() => setSubagentsSaved(false), 2000)
    } catch (e) { setSubagentsError(String(e)) }
    finally { setSavingSubagents(false) }
  }

  async function handleOpenFile(filename: string) {
    setEditingFilename(filename)
    setFileLoadError(null)
    setFileContent('')
    setOriginalContent('')
    setFileSaved(false)
    setLoadingContent(true)
    setFileEditorOpen(true)
    try {
      const content = await readFile(agent.id, filename)
      setFileContent(content)
      setOriginalContent(content)
    } catch (e) {
      setFileLoadError(String(e))
    } finally {
      setLoadingContent(false)
    }
  }

  const handleSaveFile = useCallback(async () => {
    if (!editingFilename || savingFile) return
    setSavingFile(true); setFileSaved(false)
    try {
      await writeFile(agent.id, editingFilename, fileContent)
      setOriginalContent(fileContent)
      setFileSaved(true); setTimeout(() => setFileSaved(false), 2000)
    } finally {
      setSavingFile(false)
    }
  }, [editingFilename, fileContent, savingFile, agent.id, writeFile])

  async function handleDeleteFile(filename: string) {
    if (confirmDeleteFile !== filename) { setConfirmDeleteFile(filename); return }
    try {
      await deleteFile(agent.id, filename)
      setFiles(f => f.filter(x => x.filename !== filename))
    } catch { /* ignore */ }
    setConfirmDeleteFile(null)
  }

  async function handleCreateFile() {
    const name = newFilename.trim()
    if (!name) return
    const filename = name.endsWith('.md') ? name : name + '.md'
    try {
      await writeFile(agent.id, filename, '')
      setFiles(f => [...f, { filename }])
      setNewFilename(''); setShowNewFile(false)
      handleOpenFile(filename)
    } catch { /* ignore */ }
  }

  const agentDisplayName = (a: Agent) => a.identity?.name ?? a.name ?? a.id

  return (
    <>
      {/* Agent editor backdrop + panel */}
      <div className="fixed inset-0 z-40" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={onClose} />
      <div
        className="fixed right-0 bottom-0 z-50 flex flex-col"
        style={{ top: 36, width: 480, background: 'var(--bg-surface)', borderLeft: '1px solid var(--border)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
          <div>
            <h2 className="font-semibold text-base" style={{ color: 'var(--text-primary)' }}>
              {agent.identity?.name ?? agent.name ?? agent.id}
            </h2>
            <p className="text-xs font-mono mt-0.5" style={{ color: 'var(--text-secondary)' }}>{agent.id}</p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 4 }}>
            <X size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex shrink-0 px-5 pt-3 gap-1" style={{ borderBottom: '1px solid var(--border)' }}>
          {(['model', 'subagents', 'files'] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              padding: '6px 12px', fontSize: 13, fontWeight: 500,
              color: tab === t ? 'var(--accent)' : 'var(--text-secondary)',
              borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent',
              marginBottom: -1, textTransform: 'capitalize'
            }}>
              {t === 'subagents' ? 'Subagents' : t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto">

          {/* ── Model ── */}
          {tab === 'model' && (
            <div className="p-5 space-y-5">
              <Field label="Primary model">
                <ModelPicker value={primaryModel} onChange={setPrimaryModel} placeholder="e.g. ollama/llama3.1:70b" />
                <p className="text-xs mt-1.5" style={{ color: 'var(--text-secondary)' }}>
                  Model identifier as configured in your Ollama or provider setup.
                </p>
              </Field>
              <Field label="Fallback models">
                {fallbacks.map((fb, i) => (
                  <div key={i} className="flex items-center gap-2 mb-2">
                    <div className="flex-1">
                      <ModelPicker value={fb} onChange={v => setFallbacks(f => f.map((x, j) => j === i ? v : x))} placeholder="fallback model" />
                    </div>
                    <button onClick={() => setFallbacks(f => f.filter((_, j) => j !== i))}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', padding: 4, flexShrink: 0 }}>
                      <X size={14} />
                    </button>
                  </div>
                ))}
                <Btn size="sm" variant="outline" icon={<Plus size={12} />} onClick={() => setFallbacks(f => [...f, ''])}>
                  Add fallback
                </Btn>
              </Field>
              {modelError && <ErrorBox message={modelError} />}
              <Btn onClick={handleSaveModel} loading={savingModel} icon={modelSaved ? <Check size={13} /> : undefined}>
                {modelSaved ? 'Saved' : 'Save model'}
              </Btn>
            </div>
          )}

          {/* ── Subagents ── */}
          {tab === 'subagents' && (
            <div className="p-5 space-y-4">
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                Choose which agents this agent is allowed to delegate tasks to.
              </p>
              {otherAgents.length === 0 ? (
                <div className="text-sm py-4 text-center" style={{ color: 'var(--text-secondary)' }}>No other agents available</div>
              ) : (
                <div className="space-y-2">
                  {otherAgents.map(a => {
                    const enabled = allowedSubAgents.includes(a.id)
                    return (
                      <label key={a.id} className="flex items-center gap-3 p-3 rounded cursor-pointer" style={{
                        background: enabled ? 'color-mix(in srgb, var(--accent) 10%, var(--bg-elevated))' : 'var(--bg-elevated)',
                        border: `1px solid ${enabled ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 'var(--radius)'
                      }}>
                        <input type="checkbox" checked={enabled}
                          onChange={e => setAllowedSubAgents(prev => e.target.checked ? [...prev, a.id] : prev.filter(id => id !== a.id))}
                          style={{ accentColor: 'var(--accent)', width: 14, height: 14 }} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{agentDisplayName(a)}</p>
                          <p className="text-xs font-mono truncate" style={{ color: 'var(--text-secondary)' }}>{a.id}</p>
                        </div>
                      </label>
                    )
                  })}
                </div>
              )}
              {subagentsError && <ErrorBox message={subagentsError} />}
              <Btn onClick={handleSaveSubagents} loading={savingSubagents} icon={subagentsSaved ? <Check size={13} /> : undefined}>
                {subagentsSaved ? 'Saved' : 'Save subagents'}
              </Btn>
            </div>
          )}

          {/* ── Files ── */}
          {tab === 'files' && (
            <div className="p-5">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>MD FILES</p>
                <Btn size="sm" variant="outline" icon={<Plus size={12} />} onClick={() => setShowNewFile(s => !s)}>
                  New file
                </Btn>
              </div>

              {showNewFile && (
                <div className="flex items-center gap-2 mb-3">
                  <Input value={newFilename} onChange={setNewFilename} placeholder="filename.md" autoFocus
                    onKeyDown={e => { if (e.key === 'Enter') handleCreateFile(); if (e.key === 'Escape') setShowNewFile(false) }}
                    style={{ fontSize: 13 }} />
                  <Btn size="sm" onClick={handleCreateFile}>Create</Btn>
                  <button onClick={() => setShowNewFile(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}>
                    <X size={14} />
                  </button>
                </div>
              )}

              {loadingFiles && (
                <div className="flex items-center gap-2 py-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
                  <Loader2 size={13} className="animate-spin" /> Loading…
                </div>
              )}
              {filesError && <ErrorBox message={filesError} />}
              {!loadingFiles && !filesError && files.length === 0 && (
                <p className="text-sm py-3" style={{ color: 'var(--text-secondary)' }}>No files found for this agent.</p>
              )}

              <div className="space-y-1">
                {files.map(f => (
                  <div key={f.filename} className="flex items-center gap-2 px-2 py-2 rounded" style={{
                    borderRadius: 'var(--radius)',
                    background: editingFilename === f.filename && fileEditorOpen
                      ? 'color-mix(in srgb, var(--accent) 10%, var(--bg-elevated))'
                      : 'transparent'
                  }}>
                    <FileText size={13} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
                    <span className="flex-1 text-sm font-mono truncate" style={{ color: 'var(--text-primary)' }}>{f.filename}</span>
                    {f.size !== undefined && (
                      <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                        {f.size < 1024 ? `${f.size}B` : `${(f.size / 1024).toFixed(1)}KB`}
                      </span>
                    )}
                    {confirmDeleteFile === f.filename ? (
                      <>
                        <Btn size="sm" variant="danger" onClick={() => handleDeleteFile(f.filename)}>Delete</Btn>
                        <Btn size="sm" variant="outline" onClick={() => setConfirmDeleteFile(null)}>Cancel</Btn>
                      </>
                    ) : (
                      <>
                        <Btn size="sm" variant="outline" icon={<Pencil size={11} />} onClick={() => handleOpenFile(f.filename)}>
                          Edit
                        </Btn>
                        <button onClick={() => handleDeleteFile(f.filename)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', padding: 4 }}>
                          <Trash2 size={12} />
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Full-screen file editor ── */}
      {fileEditorOpen && editingFilename && (
        <FileEditorModal
          filename={editingFilename}
          content={fileContent}
          originalContent={originalContent}
          loading={loadingContent}
          error={fileLoadError}
          saving={savingFile}
          saved={fileSaved}
          isDirty={isDirty}
          onChange={setFileContent}
          onSave={handleSaveFile}
          onClose={() => setFileEditorOpen(false)}
        />
      )}
    </>
  )
}

// ── Full-screen Monaco editor modal ──────────────────────────────────────────

interface FileEditorModalProps {
  filename: string
  content: string
  originalContent: string
  loading: boolean
  error: string | null
  saving: boolean
  saved: boolean
  isDirty: boolean
  onChange: (v: string) => void
  onSave: () => void
  onClose: () => void
}

function FileEditorModal({ filename, content, loading, error, saving, saved, isDirty, onChange, onSave, onClose }: FileEditorModalProps) {
  // Ctrl+S / Cmd+S to save
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        onSave()
      }
      if (e.key === 'Escape' && !isDirty) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onSave, onClose, isDirty])

  return (
    <div className="fixed inset-x-0 bottom-0 z-[60] flex flex-col" style={{ top: 36, background: 'var(--bg-primary)' }}>
      {/* Toolbar */}
      <div
        className="flex items-center gap-3 px-4 shrink-0"
        style={{ height: 48, borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)' }}
      >
        {/* Filename + dirty indicator */}
        <span className="font-mono text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          {filename}
        </span>
        {isDirty && (
          <span className="w-2 h-2 rounded-full" style={{ background: 'var(--accent)', flexShrink: 0 }} title="Unsaved changes" />
        )}

        <div style={{ flex: 1 }} />

        {/* Hint */}
        <span className="text-xs" style={{ color: 'var(--text-secondary)', opacity: 0.6 }}>
          Ctrl+S to save
        </span>

        {/* Save button */}
        <Btn
          size="sm"
          onClick={onSave}
          loading={saving}
          disabled={!isDirty && !saving}
          icon={saved ? <Check size={13} /> : <Save size={13} />}
        >
          {saved ? 'Saved' : 'Save'}
        </Btn>

        {/* Close */}
        <button
          onClick={onClose}
          title={isDirty ? 'Close (unsaved changes)' : 'Close'}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 6, display: 'flex', alignItems: 'center' }}
        >
          <X size={18} />
        </button>
      </div>

      {/* Editor area */}
      <div className="flex-1 min-h-0">
        {loading && (
          <div className="flex items-center justify-center h-full gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
            <Loader2 size={16} className="animate-spin" /> Loading…
          </div>
        )}
        {error && !loading && (
          <div className="p-6">
            <ErrorBox message={error} />
          </div>
        )}
        {!loading && !error && (
          <Editor
            height="100%"
            language="markdown"
            value={content}
            onChange={v => onChange(v ?? '')}
            theme="vs-dark"
            options={{
              minimap: { enabled: false },
              fontSize: 14,
              lineHeight: 1.65,
              wordWrap: 'on',
              scrollBeyondLastLine: false,
              padding: { top: 16, bottom: 16 },
              renderWhitespace: 'boundary',
              smoothScrolling: true,
              cursorBlinking: 'smooth',
              lineNumbers: 'on',
              folding: true,
              bracketPairColorization: { enabled: false }
            }}
          />
        )}
      </div>

      {/* Status bar */}
      <div
        className="flex items-center gap-4 px-4 text-xs shrink-0"
        style={{ height: 26, borderTop: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--text-secondary)' }}
      >
        <span>Markdown</span>
        <span style={{ opacity: 0.5 }}>·</span>
        <span>{content.length.toLocaleString()} chars</span>
        <span style={{ opacity: 0.5 }}>·</span>
        <span>{content.split('\n').length} lines</span>
        {isDirty && <span style={{ color: 'var(--warning)', marginLeft: 'auto' }}>Unsaved changes</span>}
      </div>
    </div>
  )
}


// ── Helpers ───────────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
        {label.toUpperCase()}
      </label>
      {children}
    </div>
  )
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 px-3 py-2 rounded text-xs" style={{
      background: 'color-mix(in srgb, var(--danger) 10%, transparent)',
      border: '1px solid var(--danger)', color: 'var(--danger)'
    }}>
      <AlertCircle size={13} style={{ marginTop: 1, flexShrink: 0 }} />
      {message}
    </div>
  )
}
