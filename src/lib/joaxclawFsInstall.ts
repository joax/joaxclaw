// "Install via agent" — builds a chat prompt that an agent on the gateway host
// runs to install the joaxclaw-fs plugin. Now that the plugin is published to npm
// (openclaw-joaxclaw-fs), the install is a one-liner — no base64-embedded files, no
// clone, no skill upload. The plugin serves both teams.* and processes.* (and the
// engines.* probes), so one install makes Teams AND Processes work over a remote
// connection. Offline hosts can use the manual --link steps in Help → Remote Teams.

// The script the agent runs on the gateway host. `set -e` aborts on a failed
// install so the agent reports the real error instead of "restarting" a no-op.
// The gateway restart is detached + delayed so the agent's turn finishes cleanly
// first (otherwise the restart kills the session mid-call and it hangs "running").
const INSTALL_SCRIPT = [
  '# Install the JoaxClaw joaxclaw-fs gateway plugin from npm.',
  'set -e',
  'openclaw plugins install openclaw-joaxclaw-fs',
  'openclaw plugins allow joaxclaw-fs >/dev/null 2>&1 || true',
  'openclaw plugins list | grep -i joaxclaw-fs || true',
  'echo "joaxclaw-fs installed. Restarting the gateway in a few seconds to load it."',
  "nohup sh -c 'sleep 4; openclaw gateway restart' >/dev/null 2>&1 &",
].join('\n')

export async function buildPluginInstallPrompt(): Promise<{ ok: boolean; prompt?: string; error?: string }> {
  const prompt = [
    'Install the **joaxclaw-fs** gateway plugin on THIS gateway host so JoaxClaw can',
    'manage teams and processes — including ones you create — over this connection.',
    '',
    'Do it now: run the script below as a shell command, **exactly as written**. Run it',
    'in one shot (do not ask me to confirm first):',
    '',
    '```bash',
    INSTALL_SCRIPT,
    '```',
    '',
    'If `openclaw plugins install openclaw-joaxclaw-fs` fails (e.g. this host has no',
    'internet), stop and tell me the error — there is an offline install path I can give you.',
    '',
    'The script restarts the gateway a few seconds after it finishes, so your turn will',
    'complete normally first and then the connection briefly drops — that is expected.',
    'JoaxClaw reconnects on its own and Teams/Processes will then work. A one-line "done"',
    'is enough.',
  ].join('\n')

  return { ok: true, prompt }
}
