// #611: red-dot count badge for a nav item (the operator's "new orders" alert).
// Presentational only — the caller resolves the count + a translated aria-label
// so this stays shared between the desktop Navbar and the MobileMenu list.
interface NavBadgeProps {
  readonly count: number
  /** Full, translated description for screen readers, e.g. "3 new bookings". */
  readonly label: string
}

// Above this, the dot reads "9+" — a precise count past a handful is noise.
const MAX_DISPLAY = 9

export function NavBadge({ count, label }: NavBadgeProps) {
  if (count <= 0) return null

  const display = count > MAX_DISPLAY ? `${MAX_DISPLAY}+` : String(count)

  return (
    // <output> carries an implicit ARIA role of "status" (a polite live region),
    // so screen readers announce the count change without a manual role attr.
    <output
      aria-label={label}
      className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[0.625rem] font-semibold leading-none text-destructive-foreground"
    >
      {display}
    </output>
  )
}
