import { buttonVariants } from '@/components/ui/button'
import { Link } from '@/i18n/routing'
import { cn } from '@/lib/utils'
import { ArrowRight, ChevronDown } from 'lucide-react'
import { useTranslations } from 'next-intl'

export function Hero() {
  const t = useTranslations('landing.hero')

  return (
    <section className="relative flex flex-col items-center justify-center min-h-[calc(100vh-3.5rem)] px-4 overflow-hidden">
      {/* Background texture -- warm gradient with subtle noise */}
      <div
        className="absolute inset-0 -z-10"
        style={{
          background: 'linear-gradient(160deg, #faf8f5 0%, #f5f0eb 40%, #faf8f5 100%)',
        }}
      />
      <div
        className="absolute inset-0 -z-10 opacity-[0.03]"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
          backgroundSize: '256px 256px',
        }}
      />

      {/* Decorative line -- Japanese-inspired geometric accent */}
      <div className="absolute top-12 left-1/2 -translate-x-1/2 w-px h-16 bg-gradient-to-b from-transparent via-red-400/40 to-transparent" />

      <div className="max-w-3xl mx-auto text-center">
        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-semibold tracking-tight text-foreground leading-[1.1]">
          {t('title')}
        </h1>

        <p className="mt-6 text-lg sm:text-xl text-muted-foreground max-w-xl mx-auto leading-relaxed">
          {t('subtitle')}
        </p>

        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            href="/vehicles"
            className={cn(
              buttonVariants({ size: 'lg' }),
              'bg-red-600 hover:bg-red-700 text-white shadow-sm px-8',
            )}
          >
            {t('cta')}
            <ArrowRight className="size-4 ml-2" />
          </Link>
          <a href="#features" className={cn(buttonVariants({ variant: 'outline', size: 'lg' }))}>
            {t('secondaryCta')}
          </a>
        </div>
      </div>

      {/* Scroll indicator */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce">
        <ChevronDown className="size-5 text-muted-foreground/50" />
      </div>
    </section>
  )
}
