export function nanoid(size = 10): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  return Array.from(crypto.getRandomValues(new Uint8Array(size)))
    .map(b => chars[b % chars.length])
    .join('')
}
