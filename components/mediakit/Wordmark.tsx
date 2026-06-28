// The "simxmargo" lockup with the middle "x" set in the accent italic, matching
// the Bodoni masthead. Data-driven: splits the display name on " x " so it tracks
// whatever the profile's displayName is. Server-safe (no hooks).
export function Wordmark({ name, className = '' }: { name: string; className?: string }) {
  // Accent the middle "x", whether the name is stored spaced ("simxmargo") or
  // joined ("simxmargo") — the live displayName is the joined handle. Renders
  // "<a> x <b>" with the x in the accent italic; falls back to plain text if there
  // is no usable internal x (e.g. a name like "max" with nothing after it).
  let parts: [string, string] | null = null
  const spaced = name.split(/\s+x\s+/i)
  if (spaced.length === 2) {
    parts = [spaced[0], spaced[1]]
  } else {
    const m = name.match(/^(.+?)x(.+)$/i)
    if (m) parts = [m[1], m[2]]
  }
  if (parts && parts[0] && parts[1]) {
    // Joined wordmark — "simxmargo" with the middle "x" accented, NO spaces around
    // it (it's one handle, not a "sim × margo" collaboration mark).
    return (
      <span className={className}>
        {parts[0]}
        <span className="amp">x</span>
        {parts[1]}
      </span>
    )
  }
  return <span className={className}>{name}</span>
}

// Two-letter monogram from the display name, reusing the wordmark's "x" split
// ("simxmargo" / "simxmargo" → "SM"); else the first letters of the first two
// words; else the first two characters. Used for the portrait placeholder.
export function initials(name: string): string {
  const spaced = name.split(/\s+x\s+/i)
  let parts: string[]
  if (spaced.length === 2) {
    parts = spaced
  } else {
    const m = name.match(/^(.+?)x(.+)$/i)
    parts = m ? [m[1], m[2]] : name.trim().split(/\s+/)
  }
  const letters = parts.map((p) => p.trim()[0]).filter(Boolean)
  const pick = letters.length >= 2 ? letters.slice(0, 2) : [...name.replace(/\s+/g, '').slice(0, 2)]
  return pick.join('').toUpperCase()
}
