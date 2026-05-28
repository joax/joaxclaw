import { Loader2 } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'

interface BtnProps {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'ghost' | 'danger' | 'outline'
  size?: 'sm' | 'md'
  icon?: ReactNode
  loading?: boolean
  disabled?: boolean
  className?: string
  style?: CSSProperties
  type?: 'button' | 'submit'
}

export function Btn({ children, onClick, variant = 'primary', size = 'md', icon, loading, disabled, className = '', style, type = 'button' }: BtnProps) {
  const base: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 'var(--radius)',
    cursor: disabled || loading ? 'not-allowed' : 'pointer',
    fontWeight: 500,
    border: '1px solid transparent',
    transition: 'background 0.15s, border-color 0.15s, color 0.15s',
    opacity: disabled || loading ? 0.6 : 1,
    fontSize: size === 'sm' ? 12 : 14,
    padding: size === 'sm' ? '4px 10px' : '7px 14px'
  }

  const variants: Record<string, CSSProperties> = {
    primary: { background: 'var(--accent)', color: 'var(--accent-fg)', borderColor: 'var(--accent)' },
    ghost: { background: 'transparent', color: 'var(--text-secondary)', borderColor: 'transparent' },
    danger: { background: 'transparent', color: 'var(--danger)', borderColor: 'var(--danger)' },
    outline: { background: 'transparent', color: 'var(--text-primary)', borderColor: 'var(--border)' }
  }

  return (
    <button
      type={type}
      onClick={disabled || loading ? undefined : onClick}
      className={className}
      style={{ ...base, ...variants[variant], ...style }}
      onMouseEnter={e => {
        if (disabled || loading) return
        const el = e.currentTarget as HTMLButtonElement
        if (variant === 'primary') el.style.filter = 'brightness(1.1)'
        else if (variant === 'ghost') el.style.background = 'var(--bg-elevated)'
        else if (variant === 'outline') el.style.background = 'var(--bg-elevated)'
        else if (variant === 'danger') el.style.background = 'color-mix(in srgb, var(--danger) 15%, transparent)'
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLButtonElement
        el.style.filter = ''
        if (variant !== 'primary') el.style.background = variants[variant].background as string
      }}
    >
      {loading ? <Loader2 size={14} className="animate-spin" /> : icon}
      {children}
    </button>
  )
}
