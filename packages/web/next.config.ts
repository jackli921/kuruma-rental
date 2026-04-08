import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

const nextConfig: NextConfig = {
  // TypeScript is checked locally and in CI via `tsc --noEmit`.
  // Skipping during `next build` saves ~10s on Cloudflare deploys.
  typescript: { ignoreBuildErrors: true },
}

export default withNextIntl(nextConfig)
