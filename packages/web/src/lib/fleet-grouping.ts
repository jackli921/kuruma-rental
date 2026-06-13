// Pure grouping for the operator fleet grid view (#561). Buckets vehicles by
// their `classId`, resolving the display name from a caller-supplied
// id -> name map (the operator-scoped class options query). Vehicles whose
// classId is null — or names a class no longer in the map (archived, FK
// dropped) — fall into a trailing "Unassigned" group so the owner can spot
// and reassign them. Empty classes are dropped (the fleet page manages
// vehicles, not classes). The map's iteration order is the display order;
// the server returns classes already sortOrder-ordered.

export interface FleetClassGroup<T> {
  readonly classId: string | null
  readonly className: string
  readonly vehicles: readonly T[]
}

// Stable key for the trailing "no class / archived class" group. Exported so
// consumers (e.g. the grid's collapse state) key on the same literal the
// grouping uses, rather than re-typing it and risking silent drift.
export const UNASSIGNED_KEY = '__unassigned__'

export function groupVehiclesByClassId<T extends { classId: string | null }>(
  vehicles: readonly T[],
  classNames: ReadonlyMap<string, string>,
  unassignedLabel: string,
): FleetClassGroup<T>[] {
  const buckets = new Map<string, T[]>()
  for (const vehicle of vehicles) {
    const key =
      vehicle.classId != null && classNames.has(vehicle.classId) ? vehicle.classId : UNASSIGNED_KEY
    const bucket = buckets.get(key) ?? []
    buckets.set(key, [...bucket, vehicle])
  }

  const groups: FleetClassGroup<T>[] = []
  for (const [classId, className] of classNames) {
    const bucket = buckets.get(classId)
    if (bucket && bucket.length > 0) {
      groups.push({ classId, className, vehicles: bucket })
    }
  }

  const unassigned = buckets.get(UNASSIGNED_KEY)
  if (unassigned && unassigned.length > 0) {
    groups.push({ classId: null, className: unassignedLabel, vehicles: unassigned })
  }

  return groups
}
