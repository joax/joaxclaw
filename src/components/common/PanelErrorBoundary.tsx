import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'

// A render error anywhere in the tree unmounts the whole app — React's default — and
// the app has no boundary, so a bug in one panel shows up as a blank window with the
// reason only visible in DevTools. This catches a panel's failure, keeps the rest of
// the app alive, and puts the error where the user (and whoever they paste it to) can
// actually read it.

interface Props { label: string; children: ReactNode }
interface State { error: Error | null }

export class PanelErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[${this.props.label}] render failed:`, error, info.componentStack)
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div
        className="flex flex-col gap-2 p-4"
        style={{
          width: 380, flexShrink: 0, borderLeft: '1px solid var(--border)',
          background: 'var(--bg-primary)', color: 'var(--danger)', fontSize: 12, lineHeight: 1.6,
        }}
      >
        <div className="flex items-center gap-2" style={{ fontWeight: 600 }}>
          <AlertTriangle size={14} /> {this.props.label} failed to render
        </div>
        <div style={{ color: 'var(--text-secondary)', fontFamily: 'monospace', wordBreak: 'break-word' }}>
          {error.message || String(error)}
        </div>
        <button
          onClick={() => this.setState({ error: null })}
          className="text-xs px-2 py-1 self-start"
          style={{ border: '1px solid var(--border)', borderRadius: 5, background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer' }}
        >
          Try again
        </button>
      </div>
    )
  }
}
