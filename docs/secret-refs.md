# SecretRef — credential indirection

How JoaxClaw represents **secrets** (API keys, channel tokens, …) in the gateway
config, and the rules every UI surface must follow so a secret can be either a
**literal string** or an **indirection** that points the gateway at a stored value.

## The shape

A credential field may hold a plain string **or** a `SecretRef` object:

```ts
// src/lib/types.ts — canonical definition
export interface SecretRef { source: string; provider?: string; id: string }
```

```jsonc
// literal — the key lives in the config
{ "apiKey": "sk-abc123" }

// indirection — the gateway resolves the value at runtime
{ "apiKey": { "source": "env", "provider": "default", "id": "OPENAI_API_KEY" } }
```

`source` is the backing store (e.g. `"env"`), `id` is the key within it
(e.g. the env var name), and `provider` optionally namespaces the lookup. The app
**never resolves** a SecretRef — only the gateway does. The UI treats it as an
opaque, read-only reference.

## Where it appears

| Surface | Field(s) | Type |
|---|---|---|
| **Channels** (gateway) | every curated credential field (token, apiKey, …) | `CredentialValue = string \| SecretRef \| undefined` |
| **Model providers** | `GwModelProvider.apiKey` | `string \| SecretRef` |

Any config value that *could* be a secret can arrive as a SecretRef, even when the
TypeScript type or a curated form was originally written assuming a string. When you
add a new credential-bearing field, assume both forms.

## The rules (read this before touching a credential field in the UI)

1. **Never render a credential value directly as a React child.** If it's a
   SecretRef object, React throws
   `Objects are not valid as a React child (found: object with keys {source, provider, id})`.
   Guard with `isSecretRef()` first.
2. **SecretRefs are read-only in curated forms.** Surface them as a labelled
   reference and tell the user to edit the raw config to change them. Convention:
   `secret ref → <id> (edit in raw config to change)`.
3. **Edit only the literal form.** Compute the editable draft from the literal
   (`typeof v === 'string' ? v : ''`) — never stringify the object into an input.
4. **Round-trip SecretRefs untouched.** On save, preserve the original object
   instead of overwriting it with an empty/edited string. A truthy spread does this:
   `...(p.apiKey ? { apiKey: p.apiKey } : {})` keeps both strings and objects.

## Helpers

| Helper | File | Purpose |
|---|---|---|
| `isSecretRef(v): v is SecretRef` | [src/lib/channels.ts](../src/lib/channels.ts) | Runtime guard — true when `v` is an object with `source` **and** `id`. Use to branch before rendering/editing. |
| `fieldLiteral(raw, key): string` | [src/lib/channels.ts](../src/lib/channels.ts) | Reads a curated field's literal string (returns `''` for a SecretRef). |
| `CredentialValue` | [src/lib/channels.ts](../src/lib/channels.ts) | `string \| SecretRef \| undefined` — the channels credential union. |

`SecretRef` is defined **canonically in [src/lib/types.ts](../src/lib/types.ts)** and
re-exported from `channels.ts` for backwards compatibility — import the type from
either; import `isSecretRef`/`fieldLiteral` from `channels.ts`.

## Reference implementations

- **Channels** — [src/components/gateway/ChannelsPanel.tsx](../src/components/gateway/ChannelsPanel.tsx)
  (`isRef = isSecretRef(raw[f.key])`): renders the read-only ref box, skips the
  input, and re-uses the existing ref on save (`if (isSecretRef(...) && v === '')
  settings[f.key] = raw[f.key]`).
- **Model providers** — `ConfigField` in
  [src/components/models/ModelsView.tsx](../src/components/models/ModelsView.tsx):
  early-returns a read-only row for a SecretRef; the editable branch uses the
  `literal` string only.
- **Save round-trip** — [src/store/models.ts](../src/store/models.ts) (`cleaned.apiKey`).

## Background — the bug that motivated this note

The Models → Providers tab crashed with *"Objects are not valid as a React child
(found: object with keys {source, provider, id})"*. `GwModelProvider.apiKey` was
typed `string`, but a provider's key was configured as a SecretRef. `ConfigField`
rendered `{value || 'Not set'}` — i.e. the raw object — and React threw.

Fix: widen `apiKey` to `string | SecretRef`, and make `ConfigField` follow the rules
above (the channels panel already did). The model-provider UI simply hadn't been
taught about the indirection that the config format already allowed.
