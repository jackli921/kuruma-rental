import { CallToAction } from '@/vite/landing/CallToAction'
import { FeaturedVehicles } from '@/vite/landing/FeaturedVehicles'
import { Features } from '@/vite/landing/Features'
import { Footer } from '@/vite/landing/Footer'
import { Hero } from '@/vite/landing/Hero'
import { createFileRoute } from '@tanstack/react-router'

// Public marketing landing (ports the Next `[locale]/page.tsx`). The Navbar is
// supplied by the `$locale` layout, so this route owns only the page body.
export const Route = createFileRoute('/$locale/')({
  component: LandingRoute,
})

function LandingRoute() {
  return (
    <main className="flex-1">
      <Hero />
      <FeaturedVehicles />
      <Features />
      <CallToAction />
      <Footer />
    </main>
  )
}
