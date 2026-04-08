import { auth } from '@/auth'
import { buttonVariants } from '@/components/ui/button'
import { Link } from '@/i18n/routing'
import { cn } from '@/lib/utils'
import { Car } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { LocaleSwitcher } from './LocaleSwitcher'
import { MobileMenu } from './MobileMenu'
import { NavbarClient } from './NavbarClient'

const BUSINESS_ROLES = ['STAFF', 'ADMIN'] as const

export async function Navbar() {
  const [session, t] = await Promise.all([auth(), getTranslations('nav')])

  const role = session?.user?.role
  const isBusiness = BUSINESS_ROLES.includes(role as (typeof BUSINESS_ROLES)[number])

  const publicItems = [{ href: '/vehicles' as const, label: t('vehicles') }]

  const renterItems = [
    { href: '/bookings' as const, label: t('bookings') },
    { href: '/messages' as const, label: t('messages') },
  ]

  const businessItems = [
    { href: '/dashboard' as const, label: t('dashboard') },
    { href: '/bookings' as const, label: t('bookings') },
    { href: '/vehicles' as const, label: t('fleet') },
    { href: '/customers' as const, label: t('customers') },
    { href: '/messages' as const, label: t('messages') },
  ]

  const navItems = isBusiness ? businessItems : [...publicItems, ...(session ? renterItems : [])]

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex h-14 items-center justify-between">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <Car className="size-5" />
            <span className="hidden sm:inline">Kuruma</span>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-1">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          {/* Right side: locale switcher + auth + mobile menu */}
          <div className="flex items-center gap-1">
            <LocaleSwitcher />
            <NavbarClient session={session} />
            <MobileMenu session={session} navItems={navItems} />
          </div>
        </div>
      </div>
    </header>
  )
}
