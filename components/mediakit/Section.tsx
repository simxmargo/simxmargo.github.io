import type { ReactNode } from 'react'

// Consistent editorial section rhythm: centered max-width, generous vertical
// padding, an optional uppercase eyebrow + Playfair title. Pure/server-safe.
export function Section({
  id,
  eyebrow,
  title,
  children,
  className = '',
}: {
  id?: string
  eyebrow?: string
  title?: string
  children: ReactNode
  className?: string
}) {
  return (
    <section id={id} className={`mx-auto w-full max-w-5xl px-6 py-16 md:py-24 ${className}`}>
      {(eyebrow || title) && (
        <header className="mb-10">
          {eyebrow && <p className="text-xs font-medium uppercase tracking-[0.2em] text-ivory/60">{eyebrow}</p>}
          {title && <h2 className="mt-3 font-editorial text-3xl text-ivory md:text-4xl">{title}</h2>}
        </header>
      )}
      {children}
    </section>
  )
}
