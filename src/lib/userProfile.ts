import type { UserProfile } from './types'

// The user's self-description (Settings → You) and how it reaches the models:
//  - buildProfilePreamble → a compact context block prepended to the FIRST message of a
//    chat (sent to the model, but kept out of the user's own visible bubble).
//  - chatIdentityName → the sender label the model sees; the user's name replaces the
//    default "JoaxClaw" when they've opted in.
// Pure + dependency-free so it's easy to test and safe to call from the gateway client.

export const DEFAULT_IDENTITY = 'JoaxClaw'

export function profileIsEmpty(profile: UserProfile | undefined): boolean {
  return !profile?.name?.trim() && !profile?.about?.trim()
}

/**
 * A short "about the person you're talking with" block, or null when the profile is
 * empty. Written so the model treats it as background context, not a message to answer.
 */
export function buildProfilePreamble(profile: UserProfile | undefined): string | null {
  const name = profile?.name?.trim() ?? ''
  const about = profile?.about?.trim() ?? ''
  if (!name && !about) return null

  const lines = ["[About the person you're talking with — use it to address and tailor your replies; don't call out this note."]
  if (name) lines.push(`Name: ${name}`)
  if (about) lines.push(`About: ${about}`)
  return lines.join('\n') + ']'
}

/** The sender label the model should see: the user's name when opted in, else JoaxClaw. */
export function chatIdentityName(profile: UserProfile | undefined, useNameAsIdentity: boolean): string {
  const name = profile?.name?.trim()
  return useNameAsIdentity && name ? name : DEFAULT_IDENTITY
}
