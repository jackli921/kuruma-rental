import { Button } from '@/components/ui/button'
import { Pencil } from 'lucide-react'
import { useTranslations } from 'use-intl'

interface FleetEditButtonProps {
  readonly onEdit: () => void
}

// Visible per-vehicle Edit affordance for the fleet list (#1275). Edit used to
// live only inside the per-row kebab menu, so operators missed it and assumed
// editing was impossible. This surfaces it as a dedicated icon button on every
// row and card, wired to the same onEdit handler the kebab uses (no duplicate
// edit logic). Icon-only, so the reused "Edit vehicle" label rides as aria-label.
export function FleetEditButton({ onEdit }: FleetEditButtonProps) {
  const t = useTranslations('business.vehicles')
  return (
    <Button variant="ghost" size="icon-sm" aria-label={t('editVehicle')} onClick={onEdit}>
      <Pencil />
    </Button>
  )
}
