'use client'

import { Badge } from '@/components/ui/badge'

interface BadgeGroupProps<T extends string | number> {
  readonly items: readonly T[]
  readonly selected: readonly T[] | undefined
  readonly onToggle: (value: T) => void
  readonly label?: (value: T) => string
  readonly groupLabel?: string
}

export function BadgeGroup<T extends string | number>({
  items,
  selected,
  onToggle,
  label,
  groupLabel,
}: BadgeGroupProps<T>) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: <fieldset> would force a <legend> child which doesn't fit an inline wrap of toggle badges. role="group" + aria-label is the standard ARIA authoring pattern for toggle button groups (matches VehicleStatusToggle).
    <div role="group" aria-label={groupLabel} className="flex flex-wrap gap-1.5">
      {items.map((item) => {
        const isSelected = selected?.includes(item) ?? false
        const displayLabel = label ? label(item) : String(item)
        return (
          <Badge
            key={String(item)}
            variant={isSelected ? 'default' : 'outline'}
            render={
              <button type="button" aria-pressed={isSelected} onClick={() => onToggle(item)} />
            }
          >
            {displayLabel}
          </Badge>
        )
      })}
    </div>
  )
}
