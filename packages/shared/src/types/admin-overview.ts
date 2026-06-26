/**
 * Platform-owner home overview (#1087, epic #1075 slice 1). Six platform-wide
 * health KPIs for the `_admin` landing screen — distinct from the operator-scoped
 * {@link OperatorOverview} (one tenant) and the X-API-Key `DashboardStats` (4
 * fields). Every figure is a single-table COUNT/SUM computed in the repo layer
 * (never load-then-count); the `AdminOverviewService` is the platform-admin authz
 * chokepoint. Read-only.
 */
export interface AdminOverview {
  /** `COUNT(bookings)` — every booking ever placed, across all operators. */
  bookings: number
  /** `COALESCE(SUM(payment_events.grossJpy), 0)` over SUCCEEDED payments. Whole JPY. */
  gmvJpy: number
  /** `COUNT(vehicles WHERE status != 'RETIRED')` — the live fleet across all operators. */
  fleet: number
  /**
   * `COUNT(operators)`. Labelled "Operators" for now; #1088 adds a `deactivatedAt`
   * column and relabels this to "Active operators" (`deactivatedAt IS NULL`).
   */
  operators: number
  /** `COUNT(payment_anomalies WHERE resolvedAt IS NULL)` — duplicate/mismatch charges awaiting review. */
  unresolvedAnomalies: number
  /** `COUNT(renter_documents WHERE status = 'PENDING')` — the verification queue depth. */
  pendingDocs: number
}
