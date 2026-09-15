import { useEffect } from 'react'
import { gatewayClient } from '../../lib/gateway'
import { findGatewayModel, isLocalModel } from '../../lib/gatewayModels'
import { localToolSearchOn } from '../../lib/toolSearch'
import { useGatewayModelsStore } from '../../store/gatewayModels'
import { useToolSearchStore } from '../../store/toolSearch'

// Shown inside the "Written as text" notice when a LOCAL model wrote the calls and the
// gateway has it on Tool Search. That combination is the usual cause (see
// lib/toolSearch.ts), and it's fixed by one gateway setting, so name it and offer the
// switch. Cloud models, or a gateway with Tool Search already off, get nothing extra:
// the text calls then have another cause.

const COMMAND = 'openclaw config set tools.toolSearch false'

export function ToolSearchHint({ modelRef, fallbackProvider }: { modelRef?: string; fallbackProvider?: string }) {
  const models = useGatewayModelsStore(s => s.models)
  const { status, setting, localModelLean, saving, turnedOff, error, turnOff } = useToolSearchStore()

  const local = isLocalModel(findGatewayModel(models, modelRef, fallbackProvider), modelRef, fallbackProvider)

  useEffect(() => {
    if (!local) return
    useGatewayModelsStore.getState().ensure()
    useToolSearchStore.getState().ensure()
  }, [local])

  if (!local) return null

  const box: React.CSSProperties = { borderTop: '1px solid var(--border)', color: 'var(--text-secondary)', lineHeight: 1.5 }

  if (turnedOff) {
    return (
      <div className="px-3 py-2" style={box}>
        <span style={{ color: 'var(--success)', fontWeight: 600 }}>Tool Search is off.</span>{' '}
        Local models now get their tools directly. Start a new chat to try again: this one&apos;s history
        is full of text calls, and the model will keep copying them.
      </div>
    )
  }

  // Unreadable config (e.g. no operator.read): fall back to what the version implies.
  if (status !== 'ready' && status !== 'error') return null
  const on = localToolSearchOn({
    setting: status === 'ready' ? setting : undefined,
    localModelLean: status === 'ready' ? localModelLean : undefined,
    serverVersion: gatewayClient.serverVersion,
  })
  if (!on) return null

  const canChange = gatewayClient.grantedScopes.includes('operator.admin')

  return (
    <div className="px-3 py-2 flex flex-col gap-1.5" style={box}>
      <div>
        <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>Likely cause: Tool Search.</span>{' '}
        This gateway gives local models a search tool and a list of tool names instead of the tools
        themselves, and they tend to write the calls as text. Turning it off gives them their tools
        directly, at the cost of a longer prompt. Cloud models aren&apos;t affected.
      </div>
      {canChange ? (
        <div>
          <button
            type="button"
            onClick={() => void turnOff()}
            disabled={saving}
            className="px-2 py-1 rounded"
            style={{
              border: '1px solid var(--accent)', background: 'transparent', color: 'var(--accent)',
              cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1, fontSize: 'inherit',
            }}
          >
            {saving ? 'Turning off…' : 'Turn off Tool Search'}
          </button>
        </div>
      ) : (
        <div>
          This connection can&apos;t change gateway settings. On the gateway host, run{' '}
          <code className="font-mono px-1 rounded" style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>{COMMAND}</code>
        </div>
      )}
      {error && <div style={{ color: 'var(--danger)' }}>Couldn&apos;t change it: {error}</div>}
    </div>
  )
}
