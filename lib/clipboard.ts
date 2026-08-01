// Copy text to the clipboard, resolving to whether it actually worked so callers
// only show a "copied" confirmation when it's true.
//
// navigator.clipboard needs a secure context (the live site is HTTPS, so it's the
// normal path) AND can still reject when the document isn't focused or a
// permission policy blocks it. The execCommand path is deprecated but remains the
// only fallback that works on http:// origins and older in-app browsers.
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to the legacy path rather than failing outright
  }

  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    // Off-screen but still focusable — execCommand needs a real selection, and
    // position:fixed avoids scrolling the page to reach it.
    ta.style.cssText = 'position:fixed;top:-1000px;left:0;opacity:0;'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}
