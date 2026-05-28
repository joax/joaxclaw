import type { CSSProperties } from 'react'

interface InputProps {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
  className?: string
  style?: CSSProperties
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
  autoFocus?: boolean
  disabled?: boolean
}

export function Input({ value, onChange, placeholder, type = 'text', style, onKeyDown, autoFocus, disabled }: InputProps) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      autoFocus={autoFocus}
      disabled={disabled}
      style={{
        display: 'block',
        width: '100%',
        padding: '7px 12px',
        borderRadius: 'var(--radius)',
        border: '1px solid var(--border)',
        background: 'var(--bg-elevated)',
        color: 'var(--text-primary)',
        fontSize: 14,
        outline: 'none',
        transition: 'border-color 0.15s',
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? 'not-allowed' : undefined,
        ...style
      }}
      onFocus={e => { if (!disabled) (e.currentTarget as HTMLInputElement).style.borderColor = 'var(--accent)' }}
      onBlur={e => { (e.currentTarget as HTMLInputElement).style.borderColor = 'var(--border)' }}
    />
  )
}

interface TextareaProps {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  rows?: number
  style?: CSSProperties
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  autoFocus?: boolean
}

export function Textarea({ value, onChange, placeholder, rows = 4, style, onKeyDown, autoFocus }: TextareaProps) {
  return (
    <textarea
      value={value}
      onChange={e => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      rows={rows}
      autoFocus={autoFocus}
      style={{
        display: 'block',
        width: '100%',
        padding: '8px 12px',
        borderRadius: 'var(--radius)',
        border: '1px solid var(--border)',
        background: 'var(--bg-elevated)',
        color: 'var(--text-primary)',
        fontSize: 13,
        outline: 'none',
        resize: 'vertical',
        fontFamily: 'var(--font-family)',
        transition: 'border-color 0.15s',
        ...style
      }}
      onFocus={e => { (e.currentTarget as HTMLTextAreaElement).style.borderColor = 'var(--accent)' }}
      onBlur={e => { (e.currentTarget as HTMLTextAreaElement).style.borderColor = 'var(--border)' }}
    />
  )
}
