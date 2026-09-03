import type { UserProfile } from './types'

// Merging the durable profile backup (~/.joaxclaw/store.json) into the freshly
// rehydrated localStorage state on app start.
//
// Two things make the backup necessary. localStorage in an Electron renderer is not
// durable — a partition change or profile corruption wipes it, which is how a set of
// saved connections was lost once (see store/connection.ts). And the packaged app
// (file://) and `npm run dev` (http://localhost:5173) are SEPARATE localStorage origins,
// so a profile entered in one is invisible to the other: the first-run welcome then asks
// again every time the app is opened from the other side. The file is shared by both.

export interface ProfileState {
  userProfile: UserProfile
  shareProfile: boolean
  useNameAsIdentity: boolean
  welcomeSeen: boolean
}

export type ProfileBackup = Partial<ProfileState>

const filled = (p?: UserProfile): boolean => !!(p?.name?.trim() || p?.about?.trim())

/**
 * What to write over the current state. Empty when the backup adds nothing.
 *
 * Local state wins wherever it holds real content — it is what the user most recently
 * typed. The backup only fills gaps.
 */
export function mergeProfileBackup(current: ProfileState, backup: ProfileBackup): Partial<ProfileState> {
  const patch: Partial<ProfileState> = {}

  // Only adopt the backup profile when there is nothing local to lose.
  if (!filled(current.userProfile) && filled(backup.userProfile)) patch.userProfile = backup.userProfile

  // "Seen" is one-way: once the welcome has been answered anywhere, never ask again.
  // It is never un-set from the backup, so dismissing it always sticks.
  if (!current.welcomeSeen && backup.welcomeSeen) patch.welcomeSeen = true

  // These default to true, so only a stored `false` records a real choice.
  if (backup.shareProfile === false && current.shareProfile) patch.shareProfile = false
  if (backup.useNameAsIdentity === false && current.useNameAsIdentity) patch.useNameAsIdentity = false

  return patch
}
