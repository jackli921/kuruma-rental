// Issue #225: maintenance log summary for fleet overview and vehicle detail.
export interface MaintenanceLogSummary {
  id: string
  vehicleId: string
  reason: string
  notes: string | null
  costJpy: number | null
  startedAt: Date
  resolvedAt: Date | null
  createdAt: Date
}
