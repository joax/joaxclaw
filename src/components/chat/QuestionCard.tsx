import { useState } from 'react'
import { HelpCircle, Check, Send } from 'lucide-react'
import type { AskQuestion } from '../../lib/askQuestion'

// Renders a structured question a model asked via an <ask> block (see
// lib/askQuestion). Single-select sends the chosen label the moment it's clicked;
// multi-select collects checked options behind a Submit button. `active` gates
// interaction: a question is only answerable while it's the last message in the
// conversation and the turn has finished — otherwise it renders read-only (the
// user's own reply already sits below it in the thread).

interface Props {
  question: AskQuestion
  active: boolean
  onAnswer: (text: string) => void
}

export function QuestionCard({ question, active, onAnswer }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [answered, setAnswered] = useState<string[] | null>(null)

  const disabled = !active || answered !== null

  const submit = (labels: string[]) => {
    if (disabled || labels.length === 0) return
    setAnswered(labels)
    onAnswer(labels.join(', '))
  }

  const toggle = (label: string) => {
    if (disabled) return
    setSelected(prev => {
      const next = new Set(prev)
      next.has(label) ? next.delete(label) : next.add(label)
      return next
    })
  }

  return (
    <div
      className="mb-2"
      style={{
        border: '1px solid color-mix(in srgb, var(--accent) 30%, var(--border))',
        borderRadius: 'var(--radius)',
        overflow: 'hidden',
        background: 'color-mix(in srgb, var(--accent) 4%, var(--bg-surface))',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-2"
        style={{ borderBottom: '1px solid color-mix(in srgb, var(--accent) 15%, var(--border))' }}
      >
        <HelpCircle size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} />
        {question.header && (
          <span
            className="text-xs font-semibold px-1.5 py-0.5 rounded"
            style={{ background: 'color-mix(in srgb, var(--accent) 15%, transparent)', color: 'var(--accent)' }}
          >
            {question.header}
          </span>
        )}
        <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          {question.question}
        </span>
      </div>

      {/* Options */}
      <div className="flex flex-col gap-1.5 p-2.5">
        {question.options.map(opt => {
          const isSel = selected.has(opt.label)
          const wasAnswered = answered?.includes(opt.label) ?? false
          const highlight = question.multiSelect ? isSel : wasAnswered
          return (
            <button
              key={opt.label}
              type="button"
              disabled={disabled}
              onClick={() => (question.multiSelect ? toggle(opt.label) : submit([opt.label]))}
              className="flex items-start gap-2 text-left"
              style={{
                padding: '7px 10px',
                borderRadius: 'var(--radius)',
                border: `1px solid ${highlight ? 'var(--accent)' : 'var(--border)'}`,
                background: highlight ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'var(--bg-elevated)',
                cursor: disabled ? 'default' : 'pointer',
                opacity: disabled && !highlight ? 0.55 : 1,
                transition: 'background 0.12s, border-color 0.12s',
              }}
              onMouseEnter={e => { if (!disabled && !highlight) e.currentTarget.style.background = 'color-mix(in srgb, var(--accent) 7%, var(--bg-elevated))' }}
              onMouseLeave={e => { if (!disabled && !highlight) e.currentTarget.style.background = 'var(--bg-elevated)' }}
            >
              {question.multiSelect && (
                <span
                  className="flex items-center justify-center flex-shrink-0"
                  style={{
                    width: 15, height: 15, marginTop: 1, borderRadius: 4,
                    border: `1.5px solid ${isSel ? 'var(--accent)' : 'var(--border)'}`,
                    background: isSel ? 'var(--accent)' : 'transparent',
                  }}
                >
                  {isSel && <Check size={11} style={{ color: 'var(--bg-primary)' }} />}
                </span>
              )}
              <span className="min-w-0">
                <span className="text-sm block" style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{opt.label}</span>
                {opt.description && (
                  <span className="text-xs block" style={{ color: 'var(--text-secondary)', marginTop: 1 }}>{opt.description}</span>
                )}
              </span>
            </button>
          )
        })}

        {/* Multi-select needs an explicit submit */}
        {question.multiSelect && (
          <button
            type="button"
            disabled={disabled || selected.size === 0}
            onClick={() => submit([...selected])}
            className="flex items-center justify-center gap-1.5 mt-0.5"
            style={{
              padding: '7px 10px',
              borderRadius: 'var(--radius)',
              border: 'none',
              background: disabled || selected.size === 0 ? 'var(--bg-elevated)' : 'var(--accent)',
              color: disabled || selected.size === 0 ? 'var(--text-secondary)' : 'var(--bg-primary)',
              cursor: disabled || selected.size === 0 ? 'default' : 'pointer',
              fontWeight: 600, fontSize: 13,
              opacity: disabled && !answered ? 0.55 : 1,
            }}
          >
            <Send size={12} />
            {answered ? 'Answer sent' : `Send${selected.size ? ` (${selected.size})` : ''}`}
          </button>
        )}
      </div>
    </div>
  )
}

export function QuestionsBlock({ questions, active, onAnswer }: {
  questions: AskQuestion[]
  active: boolean
  onAnswer: (text: string) => void
}) {
  if (questions.length === 0) return null
  return (
    <div className="flex flex-col gap-1.5">
      {questions.map(q => (
        <QuestionCard key={q.id} question={q} active={active} onAnswer={onAnswer} />
      ))}
    </div>
  )
}
