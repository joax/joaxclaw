import { useConnectionStore } from '../store/connection'
import { gatewayClient } from './gateway'

// Whether this gateway supports a feature, for deciding what to SHOW. It re-evaluates on
// every new connection (the store's `connectionSeq`), so reconnecting to an upgraded or
// different gateway updates every gated control. `admin` reports operator.admin, since
// several 2026.9 actions (updates, plugin installs) need it.
export function useGatewaySupport(req: {
  methods?: string[]
  events?: string[]
  capabilities?: string[]
  /** A scope the feature needs, e.g. 'operator.admin'. */
  scope?: string
}): { supported: boolean; admin: boolean } {
  // Subscribed so the component re-renders when a new connection's hello-ok arrives.
  useConnectionStore(s => s.connectionSeq)
  const connected = useConnectionStore(s => s.status === 'connected')
  const scopes = useConnectionStore(s => s.grantedScopes)
  const admin = scopes.includes('operator.admin')
  const supported = connected
    && (req.methods ?? []).every(m => gatewayClient.hasMethod(m))
    && (req.events ?? []).every(e => gatewayClient.hasEvent(e))
    && (req.capabilities ?? []).every(c => gatewayClient.supports(c))
    && (!req.scope || scopes.includes(req.scope))
  return { supported, admin }
}
