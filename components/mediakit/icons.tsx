// Shared media-kit icons. Same contract as the inline set in PortfolioGrid: a
// 24×24 viewBox drawn with currentColor so the parent controls size and colour
// (`.mk .ico` stretches each one to fill its button).

export function CopyIcon() {
  return (
    <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x={9} y={9} width={12} height={12} rx={2.5} />
      <path d="M5 15a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2" />
    </svg>
  )
}

export function CheckIcon() {
  return (
    <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

export function MailIcon() {
  return (
    <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x={2.5} y={4.5} width={19} height={15} rx={2.5} />
      <path d="m3.5 7 8.5 6 8.5-6" />
    </svg>
  )
}
