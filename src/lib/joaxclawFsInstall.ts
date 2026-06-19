// "Install via agent" — builds a chat prompt that an agent on the gateway host
// runs to install the joaxclaw-fs plugin. The plugin's files travel INSIDE the
// prompt (base64, decoded by the script), so there's no clone, no npm, no skill
// upload, and no way for the bytes to be garbled. The agent runs the script
// verbatim. The plugin serves both teams.* and processes.*, so one install makes
// Teams AND Processes work over a remote connection.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const teamsApi = () => (window as any)?.api?.teams as {
  installScript: () => Promise<{ ok: boolean; script?: string; error?: string }>
} | null

export async function buildPluginInstallPrompt(): Promise<{ ok: boolean; prompt?: string; error?: string }> {
  const api = teamsApi()
  if (!api) return { ok: false, error: 'Install helper is only available in the desktop app.' }

  let res: { ok: boolean; script?: string; error?: string }
  try {
    res = await api.installScript()
  } catch (e) {
    // e.g. a stale main process with no handler registered — fail visibly, don't hang.
    const msg = String(e instanceof Error ? e.message : e)
    return { ok: false, error: /No handler registered/i.test(msg) ? 'Restart JoaxClaw to enable this (the app needs to reload).' : msg }
  }
  if (!res.ok || !res.script) return { ok: false, error: res.error ?? 'Could not build the install script.' }

  const prompt = [
    'Install the **joaxclaw-fs** gateway plugin on THIS gateway host so JoaxClaw can',
    'manage teams and processes — including ones you create — over this connection.',
    '',
    'Do it now: run the script below as a **single** shell command, **exactly as written**.',
    'Pass the base64 blocks through verbatim — do not retype, summarize, reformat, or "fix"',
    'them. Run it in one shot (do not ask me to confirm first):',
    '',
    '```bash',
    res.script,
    '```',
    '',
    'The script restarts the gateway a few seconds after it finishes, so your turn will',
    'complete normally first and then the connection briefly drops — that is expected.',
    'JoaxClaw reconnects on its own and Teams/Processes will then work. A one-line "done"',
    'is enough.',
  ].join('\n')

  return { ok: true, prompt }
}
