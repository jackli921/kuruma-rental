// Object-storage ports (#459 documents, #461/#952 photos) live in their own
// module to keep the repositories/types.ts barrel under the file-size cap (#978);
// re-exported for callers from ./types.

export interface PhotoStorage {
  put(vehicleId: string, file: File): Promise<{ key: string; url: string }>
  /** Accepts a key or full URL. `ownerVehicleId` scopes the delete to that vehicle's key prefix, so a cross-referenced URL can't reach another vehicle's object (cross-tenant IDOR guard, #952). */
  delete(keyOrUrl: string, ownerVehicleId: string): Promise<void>
}

/** Private object storage for renter document scans (#459) — private, not public-URL addressable (cf. `PhotoStorage`). */
export interface DocumentStorage {
  put(renterId: string, file: File): Promise<{ key: string }>
  /** @deprecated Dormant pending #304; superseded by getFile(). Signed URL to view a scan. */
  getSignedUrl(key: string): Promise<string>
  /** Stream a stored scan's bytes + content-type for an authenticated viewer (#932). */
  getFile(key: string): Promise<{ body: ReadableStream; contentType: string } | null>
  delete(key: string): Promise<void>
}
