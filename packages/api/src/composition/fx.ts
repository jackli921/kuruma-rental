import type { AppOverrides } from '../app-overrides'
import { CachingFxRateProvider } from '../services/fx/caching-fx-rate-provider'
import { InMemoryFxRateCache } from '../services/fx/fx-rate-cache'
import { KvFxRateCache, type KvStore } from '../services/fx/kv-fx-rate-cache'
import { StaticFxRateProvider } from '../services/fx/static-fx-rate-provider'
import type { FxRateCache, FxRateProvider } from '../services/fx/types'

/**
 * Composition-root factory for the indicative-FX provider (#1070). Lives in
 * `composition/` (a sanctioned place to `new` concretes, like buildRepos) rather
 * than inline in index.ts, which is at its size cap.
 *
 * A pinned static snapshot today (no upstream/secret for the demo); a real HTTP
 * rate API drops in behind the same {@link FxRateProvider} port later. Wrapped in
 * a daily cache — durable Workers KV when the `FX_RATE_CACHE` binding is present,
 * else an in-process slot (dev/test). Display-only; the charge is always JPY.
 */
export function buildFxRateProvider(overrides?: AppOverrides): FxRateProvider {
  const inner: FxRateProvider = overrides?.fxRateProvider ?? new StaticFxRateProvider()
  const cache: FxRateCache =
    overrides?.fxRateCache ??
    (() => {
      const kv = (globalThis as Record<string, unknown>).FX_RATE_CACHE as KvStore | undefined
      return kv ? new KvFxRateCache(kv) : new InMemoryFxRateCache()
    })()
  return new CachingFxRateProvider(inner, cache)
}
