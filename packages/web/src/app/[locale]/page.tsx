import { CallToAction } from '@/components/landing/CallToAction'
import { FeaturedVehicles } from '@/components/landing/FeaturedVehicles'
import { Features } from '@/components/landing/Features'
import { Footer } from '@/components/landing/Footer'
import { Hero } from '@/components/landing/Hero'

export default function Home() {
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
