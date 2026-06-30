// "Update via agent" — builds a chat prompt that an agent on the gateway host runs
// to update OpenClaw itself (the gateway software). Mirrors the joaxclaw-fs install
// flow (see joaxclawFsInstall.ts): the agent runs `openclaw update` on the host, so
// it works for BOTH a local and a remote gateway — the agent always runs on the
// gateway host, whichever machine that is. `openclaw update` auto-detects the install
// method (git checkout vs npm/global package manager) and updates accordingly.

// The script the agent runs on the gateway host. `set -e` aborts on a failed update so
// the agent reports the real error instead of restarting a half-updated install.
// `--yes` makes it non-interactive (accepts downgrade prompts). We pass `--no-restart`
// and do the restart ourselves — detached + delayed — so the agent's turn finishes
// cleanly first; a synchronous restart mid-update kills the session and it hangs
// "running" (same reason the install script defers its restart). `update status`
// runs first so the chat shows the before/after version.
const UPDATE_SCRIPT = [
  '# Update OpenClaw (the gateway software) on this host.',
  'set -e',
  'openclaw update status || true',
  'openclaw update --yes --no-restart',
  'echo "OpenClaw updated. Restarting the gateway in a few seconds to load the new version."',
  "nohup sh -c 'sleep 4; openclaw gateway restart' >/dev/null 2>&1 &",
].join('\n')

export async function buildGatewayUpdatePrompt(): Promise<{ ok: boolean; prompt?: string; error?: string }> {
  const prompt = [
    'Update **OpenClaw** (the gateway software) on THIS gateway host to the latest',
    'version on its current update channel.',
    '',
    'Do it now: run the script below as a shell command, **exactly as written**. Run it',
    'in one shot (do not ask me to confirm first):',
    '',
    '```bash',
    UPDATE_SCRIPT,
    '```',
    '',
    'If `openclaw update` fails (e.g. this host has no internet, or a git checkout has',
    'local changes), stop and tell me the exact error — do not restart the gateway.',
    '',
    'The script restarts the gateway a few seconds after it finishes, so your turn will',
    'complete normally first and then the connection briefly drops — that is expected.',
    'JoaxClaw reconnects on its own. A one-line summary with the new version is enough.',
  ].join('\n')

  return { ok: true, prompt }
}
