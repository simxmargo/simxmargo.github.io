// The "@simxmargo" lockup, set in the Bodoni masthead face. Rendered as ONE uniform
// word with a leading "@" so it reads as the handle everywhere it appears (hero · nav ·
// footer); the middle "x" carries no accent tint. Data-driven off the profile's
// displayName — a leading "@" already in the name is stripped so it never doubles.
// Server-safe (no hooks).
export function Wordmark({ name, className = '' }: { name: string; className?: string }) {
  return <span className={className}>@{name.replace(/^@+/, '')}</span>
}
