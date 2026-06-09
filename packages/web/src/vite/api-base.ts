/**
 * Base URL for the Hono API, resolved for the Vite/CF Pages build (#378).
 *
 * Defaults to the same-origin `/api` path served by the CF Pages Functions
 * proxy (spec §5.5/§7.3), so cookies stay `SameSite=Lax`. Override via
 * `VITE_API_BASE_URL` (baked in at build time) for partner/direct-origin builds.
 *
 * The frozen Next app keeps its own `createApiClient` / `process.env` path; this
 * seam exists so phase-5d route loaders never touch `process.env` in browser code.
 */
export function getApiBaseUrl(): string {
  return import.meta.env.VITE_API_BASE_URL ?? '/api'
}
