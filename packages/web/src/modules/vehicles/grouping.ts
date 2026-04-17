import type { FleetVehicleOverviewData, VehicleData } from '@/lib/vehicle-api'
import type { VehicleClassData } from '@/modules/classes'

export interface VehicleClassGroup<TVehicle extends VehicleData = FleetVehicleOverviewData> {
  readonly classId: string | null
  readonly className: string
  readonly classSlug: string | null
  readonly vehicles: readonly TVehicle[]
}

// Pure helper: groups vehicles by their classId, preserving class sortOrder.
// Vehicles with a null classId — or a classId that no longer matches any
// class (e.g. the class was archived and the FK dropped) — fall into a
// trailing "Unassigned" group so the owner sees them and can reassign.
//
// Empty classes are dropped entirely; the Fleet page is for managing
// vehicles, not classes. The dedicated class-management page shows those.
export function groupVehiclesByClass<TVehicle extends VehicleData>(
  vehicles: readonly TVehicle[],
  classes: readonly VehicleClassData[],
  unassignedLabel = 'Unassigned',
): VehicleClassGroup<TVehicle>[] {
  const classById = new Map(classes.map((c) => [c.id, c]))
  const sortedClasses = [...classes].sort((a, b) => a.sortOrder - b.sortOrder)

  const groups: VehicleClassGroup<TVehicle>[] = []
  const unassigned: TVehicle[] = []

  // Bucket vehicles by class id (or "unassigned" bucket).
  const buckets = new Map<string, TVehicle[]>()
  for (const vehicle of vehicles) {
    const resolvedClassId =
      vehicle.classId != null && classById.has(vehicle.classId) ? vehicle.classId : null
    if (resolvedClassId == null) {
      unassigned.push(vehicle)
      continue
    }
    const bucket = buckets.get(resolvedClassId) ?? []
    bucket.push(vehicle)
    buckets.set(resolvedClassId, bucket)
  }

  for (const klass of sortedClasses) {
    const bucket = buckets.get(klass.id)
    if (!bucket || bucket.length === 0) continue
    groups.push({
      classId: klass.id,
      className: klass.name,
      classSlug: klass.slug,
      vehicles: bucket,
    })
  }

  if (unassigned.length > 0) {
    groups.push({
      classId: null,
      className: unassignedLabel,
      classSlug: null,
      vehicles: unassigned,
    })
  }

  return groups
}
