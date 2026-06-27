import type { FxRates } from '@kuruma/shared/types/fx'

export type { FxRates }

/**
 * Provider-neutral source of indicative JPY→currency rates (#1070). Business
 * logic (the rates route) depends on this interface; the concrete adapter
 * (StaticFxRateProvider today, an HTTP rate API later) is wired only in index.ts
 * — a provider swap is a one-line change there, exactly like {@link Geocoder}.
 *
 * Must NEVER throw: a failure resolves to `null` so the rates endpoint can
 * degrade (the web falls back to JPY-only display) rather than 500.
 */
export interface FxRateProvider {
  getRates(): Promise<FxRates | null>
}

/**
 * Daily cache port for the rate table (#1070), mirroring {@link GeocodeCache}.
 * The rates are a single logical resource ("today's JPY base table"), so there's
 * no key argument. ONLY successful fetches are stored; a miss — or a corrupt
 * entry — reads as `null`. Operational failures (KV unavailable) may propagate;
 * the CachingFxRateProvider decorator degrades any throw to a miss, so a flaky
 * cache never breaks the endpoint. index.ts adapts the Workers KV binding (or an
 * in-memory map in dev/test).
 */
export interface FxRateCache {
  get(): Promise<FxRates | null>
  set(rates: FxRates): Promise<void>
}
