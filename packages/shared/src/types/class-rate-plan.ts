// JSON-serialized ClassRatePlan wire shape (#464 slice 6). Dates cross the wire
// as ISO strings. The api repo row is fenced to this DTO in wire-contract.test.ts
// and the web Zod schema pins to it with `satisfies` — a producer-side field
// drift then fails to compile at both ends. Pure type module, no runtime deps.
export interface ClassRatePlanData {
  id: string
  operatorId: string
  classId: string
  pickupLocationId: string
  dayRateJpy: number
  isActive: boolean
  // Operator-only display name (Q3). Never surfaced to renters.
  label: string | null
  createdAt: string
  updatedAt: string
}
