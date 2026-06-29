import { Wordmark } from '@/components/mediakit/Wordmark'

// Scroll-progress bar + fixed top navigation. Static (no hooks):
// RevealRoot scales .prog-fill on scroll, and .nav CSS in globals.css handles
// the fixed + backdrop-blur treatment under the .mk root scope.
export function TopNav({ name, showRates = true }: { name: string; showRates?: boolean }) {
  return (
    <>
      <div className="prog">
        <div className="prog-fill" />
      </div>
      <header className="nav">
        <div className="navwrap wrap flex items-center justify-between">
          <a href="#top" className="brand display">
            <Wordmark name={name} />
          </a>
          <nav className="flex items-center gap-6">
            <a href="#reach" className="nlink">Reach</a>
            <a href="#partners" className="nlink">Partners</a>
            {showRates && <a href="#rates" className="nlink">Rates</a>}
            <a href="#contact" className="btn btn-primary btn-sm magnetic">Work with me</a>
          </nav>
        </div>
      </header>
    </>
  )
}
