// Shown by guarded layouts while the session query is in flight on a cold load,
// so auth state never flashes (spec §4.5). Minimal for now; styled in 5d.
export function PageSkeleton() {
  return <div aria-busy="true" className="min-h-dvh" />
}
