import { useState } from 'react'
import { UserRound, X } from 'lucide-react'
import { useSettingsStore } from '../../store/settings'
import { Btn } from '../ui/Btn'
import { TextField, TextAreaField } from '../settings/SettingsView'

// First-run welcome: invites the user to introduce themselves so agents know who they're
// talking to. Skippable, and everything here is re-editable in Settings → You. Shown once
// (until `welcomeSeen`), gated by the caller.
export function WelcomeModal() {
  const { userProfile, setUserProfile, setUseNameAsIdentity, dismissWelcome } = useSettingsStore()
  const [name, setName] = useState(userProfile.name)
  const [about, setAbout] = useState(userProfile.about)

  const save = () => {
    const trimmed = { name: name.trim(), about: about.trim() }
    setUserProfile(trimmed)
    if (trimmed.name) setUseNameAsIdentity(true)
    dismissWelcome()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.55)' }}>
      <div className="animate-fade-in" style={{ width: 460, maxWidth: '92vw', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: '0 12px 48px rgba(0,0,0,0.45)', overflow: 'hidden' }}>
        <div className="flex items-center gap-2 px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <UserRound size={16} style={{ color: 'var(--accent)' }} />
          <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)', flex: 1 }}>Welcome to JoaxClaw 👋</span>
          <button onClick={dismissWelcome} title="Skip" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 2 }}>
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-3">
          <p className="text-sm" style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}>
            Want your agents to know who they’re talking to? Introduce yourself and it’ll be shared as context at the start of your chats — so replies are addressed and tailored to you. You can edit this or turn it off anytime in <b style={{ color: 'var(--text-primary)' }}>Settings → You</b>.
          </p>
          <TextField label="Your name" value={name} placeholder="How agents should address you" onChange={setName} />
          <TextAreaField label="About you (optional)" value={about} placeholder="Role, expertise, how you like answers (concise vs. detailed), timezone…" onChange={setAbout} />
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3" style={{ borderTop: '1px solid var(--border)' }}>
          <Btn size="sm" variant="ghost" onClick={dismissWelcome}>Skip for now</Btn>
          <Btn size="sm" onClick={save} disabled={!name.trim() && !about.trim()}>Save</Btn>
        </div>
      </div>
    </div>
  )
}
