// Standardized luggage-size taxonomy (issue #457). Single source of truth for
// the DB pgEnum (schema.ts), the Zod enum (validators), the TS type, and the
// resolver below — so the three values are declared exactly once.
export const LUGGAGE_SIZES = ['SMALL', 'MEDIUM', 'LARGE'] as const
export type LuggageSize = (typeof LUGGAGE_SIZES)[number]

/** Per-vehicle override — both fields nullable; null means "use the class default". */
export interface VehicleLuggage {
  luggageCapacity: number | null
  luggageSize: LuggageSize | null
}

/** Class-level default — both fields always present (NOT NULL in the DB). */
export interface ClassLuggage {
  luggageCapacity: number
  luggageSize: LuggageSize
}

export type ResolvedLuggage = ClassLuggage

/**
 * Effective luggage shown to renters: the vehicle override wins per-field, and
 * each field independently falls back to the class default when blank. `??`
 * (not `||`) so a deliberate zero-count override is preserved, not coalesced.
 */
export function resolveLuggage(
  vehicle: VehicleLuggage,
  classDefault: ClassLuggage,
): ResolvedLuggage {
  return {
    luggageCapacity: vehicle.luggageCapacity ?? classDefault.luggageCapacity,
    luggageSize: vehicle.luggageSize ?? classDefault.luggageSize,
  }
}
