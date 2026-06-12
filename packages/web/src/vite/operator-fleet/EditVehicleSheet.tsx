import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { PhotoUpload } from '@/vite/operator-fleet/PhotoUpload'
import { VehicleForm } from '@/vite/operator-fleet/VehicleForm'
import {
  type OperatorFleetVehicle,
  vehicleClassOptionsQueryOptions,
} from '@/vite/operator-fleet/api'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'use-intl'

interface EditVehicleSheetProps {
  /** Whether the sheet is open. */
  readonly open: boolean
  /** The vehicle being edited, or `null` for create mode. */
  readonly vehicle: OperatorFleetVehicle | null
  /** Controlled open/close handler (the parent owns the sheet state). */
  readonly onOpenChange: (open: boolean) => void
  /** Called after a create/update succeeds (parent closes the sheet). */
  readonly onSaved: () => void
}

// Slide-over host that composes the add/edit form with photo management (#560).
// It owns no fleet state — the parent passes the target vehicle (null = create)
// and the open flag. Class options are fetched lazily (only while open) and the
// dropdown is hidden when empty, so a failed/absent class list never blocks the
// form. PhotoUpload renders in both modes: in create mode it shows its own
// "save the vehicle first" hint, since photos attach to a persisted vehicle id.
export function EditVehicleSheet({ open, vehicle, onOpenChange, onSaved }: EditVehicleSheetProps) {
  const t = useTranslations('business.vehicles')
  const { data: classOptions } = useQuery({ ...vehicleClassOptionsQueryOptions(), enabled: open })
  const isEdit = vehicle != null

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{isEdit ? t('editVehicle') : t('addVehicle')}</SheetTitle>
        </SheetHeader>
        <div className="space-y-6 p-4 pt-0">
          <VehicleForm
            vehicle={vehicle}
            classOptions={classOptions ?? []}
            onSaved={onSaved}
            onCancel={() => onOpenChange(false)}
          />
          <PhotoUpload vehicleId={vehicle?.id ?? null} photos={vehicle?.photos ?? []} />
        </div>
      </SheetContent>
    </Sheet>
  )
}
