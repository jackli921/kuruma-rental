import { LUGGAGE_SIZES, TRANSMISSIONS } from '@kuruma/shared/enums'
import type { ClassComboSearchResult } from '@kuruma/shared/types/search-result'
import { z } from 'zod'

// #711/#785: Zod schemas for the public storefront *response* bodies (#391),
// extracted to a sibling schema.ts so `api.ts` can thread `unwrap(res, schema)`
// without the composite DTOs crowding the client (the #785 convention).
//
// The Vite shell OWNS these DTOs (it does not import the frozen Next module's
// copy), so each schema is the single source and its type is inferred from it —
// `export type X = z.infer<typeof xSchema>`. The API serializes everything to
// JSON, so there are no Date instances. Every field's nullability + enum domain
// was producer-verified against packages/api storefront-search / storefront-detail
// services before pinning, so the schema can't be stricter than the wire.

const operatingHoursSchema = z.object({
  openTime: z.string(),
  closeTime: z.string(),
})

const classSummarySchema = z.object({
  /** ACRISS code, or null when the class has no mapped code (#388). */
  acrissCode: z.string().nullable(),
  /** Operator-entered class name; the web localizes via acrissCode. */
  label: z.string(),
  // #457 D6: class-default luggage for compare-on-search badges.
  luggageCapacity: z.number().nullable(),
  luggageSize: z.enum(LUGGAGE_SIZES).nullable(),
  availableCount: z.number(),
})

const storefrontCardSchema = z.object({
  locationId: z.string(),
  operatorId: z.string(),
  operatorName: z.string(),
  name: z.string(),
  address: z.string(),
  operatingHours: operatingHoursSchema.nullable(),
  /** #551: operator turnaround buffer (minutes) between rentals at this store. */
  turnaroundMinutes: z.number(),
  classSummaries: z.array(classSummarySchema),
  fromDailyPriceJpy: z.number().nullable(),
  fromHourlyPriceJpy: z.number().nullable(),
  representativePhotos: z.array(z.string()),
  /** #651 Slice 3: store coords (WGS84) for distance labels + nearest-first sort. */
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
})

export const storefrontSearchResultSchema = z.object({
  storefronts: z.array(storefrontCardSchema),
  nextCursor: z.string().nullable(),
})

const availableVehicleSchema = z.object({
  id: z.string(),
  /** #1085 slice 5: vehicle's class id for the per-vehicle review-aggregate
   *  fetch on the storefront detail page. Null when the vehicle has no class
   *  (a classless vehicle gets no class-level badge — matches `classLabel: ''`). */
  classId: z.string().nullable(),
  name: z.string(),
  make: z.string().nullable(),
  model: z.string().nullable(),
  year: z.number().nullable(),
  seats: z.number(),
  // #457: effective luggage (vehicle override resolved against the class default).
  luggageCapacity: z.number().nullable(),
  luggageSize: z.enum(LUGGAGE_SIZES).nullable(),
  transmission: z.enum(TRANSMISSIONS),
  acrissCode: z.string().nullable(),
  // Class name, or '' when the vehicle has no class (never null — service falls
  // back to an empty string).
  classLabel: z.string(),
  dailyRateJpy: z.number().nullable(),
  hourlyRateJpy: z.number().nullable(),
  photos: z.array(z.string()),
})

const storefrontSummarySchema = z.object({
  locationId: z.string(),
  /** #1085 slice 5: owning operator id, surfaced so the detail header can
   *  fetch its operator-level review aggregate. Mirrors storefrontCardSchema. */
  operatorId: z.string(),
  name: z.string(),
  address: z.string(),
  operatorName: z.string(),
  operatingHours: operatingHoursSchema.nullable(),
  /** #551: operator turnaround buffer (minutes) between rentals at this store. */
  turnaroundMinutes: z.number(),
})

// #464: class-combo deals surfaced on the storefront-detail response, so the
// store page can list "book a class, exact car assigned at pickup" offerings
// beside its physical cars. Mirrors the shared `ClassComboSearchResult` — the
// same shape the flat search emits inline in `search/api.ts`; kept byte-identical
// in field set (not refactored into one module) so each feature owns its DTO.
const offeringLocationSchema = z.object({
  locationId: z.string(),
  operatorId: z.string(),
  operatorName: z.string(),
  name: z.string(),
  address: z.string(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
})

const classOfferingSchema = z.object({
  kind: z.literal('CLASS_COMBO'),
  location: offeringLocationSchema,
  dailyRateJpy: z.number().nullable(),
  hourlyRateJpy: z.number().nullable(),
  classLabel: z.string(),
  acrissCode: z.string().nullable(),
  seats: z.number(),
  photos: z.array(z.string()),
  classId: z.string(),
  availableCount: z.number(),
  // #464: `satisfies z.ZodType<ClassComboSearchResult>` pins this hand-written
  // mirror to the shared DTO (as `search/api.ts` pins its own mirror), so a new
  // renter-safe field on the shared type fails to compile here instead of being
  // silently stripped off the store page.
}) satisfies z.ZodType<ClassComboSearchResult>

export const storefrontDetailResultSchema = z.object({
  storefront: storefrontSummarySchema,
  vehicles: z.array(availableVehicleSchema),
  // `.default([])` is REQUIRED: web + api workers deploy independently, so a new
  // web hitting an old API (no `classOfferings`) must not parse-error the store
  // AND reservation loaders. The schema is never stricter than the wire.
  classOfferings: z.array(classOfferingSchema).default([]),
  nextCursor: z.string().nullable(),
})

export type OperatingHoursData = z.infer<typeof operatingHoursSchema>
export type ClassSummaryData = z.infer<typeof classSummarySchema>
export type StorefrontCardData = z.infer<typeof storefrontCardSchema>
export type StorefrontSearchResultData = z.infer<typeof storefrontSearchResultSchema>
export type AvailableVehicleData = z.infer<typeof availableVehicleSchema>
export type ClassOfferingData = z.infer<typeof classOfferingSchema>
export type StorefrontSummaryData = z.infer<typeof storefrontSummarySchema>
export type StorefrontDetailData = z.infer<typeof storefrontDetailResultSchema>
