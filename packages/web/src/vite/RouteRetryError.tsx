import { useRouter } from '@tanstack/react-router'

export interface RouteRetryErrorProps {
  /** Already-translated load-error message (call sites own their i18n namespace). */
  message: string
  /** Already-translated retry button label. */
  retryLabel: string
  /**
   * Wrapper override. Defaults to the standalone centered card most routes use;
   * routes that nest the error inside a `<main>` shell pass their inner layout
   * (e.g. `mx-auto max-w-3xl py-20 text-center`) here.
   */
  className?: string
}

const DEFAULT_WRAPPER = 'mx-auto max-w-7xl px-4 py-20 text-center sm:px-6 lg:px-8'

/**
 * The shared loader-failure + retry widget for TanStack Router `errorComponent`s.
 * Clicking retry calls `router.invalidate()`, which re-runs the route loader.
 * Extracted from ~26 byte-drifted copies (#1374).
 */
export function RouteRetryError({ message, retryLabel, className }: RouteRetryErrorProps) {
  const router = useRouter()

  return (
    <div className={className ?? DEFAULT_WRAPPER}>
      <p className="text-lg text-muted-foreground">{message}</p>
      <button
        type="button"
        onClick={() => router.invalidate()}
        className="mt-4 inline-flex items-center rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted/50"
      >
        {retryLabel}
      </button>
    </div>
  )
}
