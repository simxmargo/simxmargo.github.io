import type { NextConfig } from 'next'

// Local dev/build = the full app (admin + API). Set EXPORT_STATIC=1 (the GitHub
// Pages CI job does) to emit a static export of the PUBLIC media kit only. The CI
// workflow first removes app/api + app/admin + app/opengraph-image.tsx, because a
// static export cannot contain route handlers or a dynamic OG image. The org Pages
// site is served at the domain root (simxmargo.github.io) → no basePath needed.
const isExport = process.env.EXPORT_STATIC === '1'

const nextConfig: NextConfig = isExport
  ? {
      output: 'export',
      images: { unoptimized: true }, // no Image Optimization server on Pages
    }
  : {}

export default nextConfig
