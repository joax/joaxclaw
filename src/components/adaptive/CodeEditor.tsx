import Editor, { type EditorProps } from '@monaco-editor/react'
import { usePlatform } from '../../lib/platform'

// Adaptive code editor — the single swap point for the app's text editors.
//
// Desktop renders Monaco (rich, but ~2.4 MB and touch-hostile). The mobile arm is a
// TODO: on a phone this should become CodeMirror 6 or a plain textarea (see the
// mobile-port roadmap). Routing both the gateway config editor and the agent file
// editor through here means that swap happens in ONE file, not at every call site.
export interface CodeEditorProps {
  value: string
  onChange: (value: string) => void
  language: string
  /** CSS height; defaults to filling its container. */
  height?: string
  /** Passed through to Monaco on desktop; merged over the shared defaults. */
  options?: EditorProps['options']
}

const BASE_OPTIONS: EditorProps['options'] = {
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  wordWrap: 'on',
  renderWhitespace: 'boundary',
}

export function CodeEditor({ value, onChange, language, height = '100%', options }: CodeEditorProps) {
  const { isMobile } = usePlatform()

  // TODO(mobile): render a CodeMirror 6 / textarea arm when `isMobile`. Until that
  // arm exists we always render Monaco so desktop is unchanged; `isMobile` is read
  // here to keep the seam honest and make the insertion point obvious.
  void isMobile

  return (
    <Editor
      height={height}
      language={language}
      value={value}
      onChange={v => onChange(v ?? '')}
      theme="vs-dark"
      options={{ ...BASE_OPTIONS, ...options }}
    />
  )
}
