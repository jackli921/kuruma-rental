// #551: operators set a turnaround buffer (minutes) that a vehicle stays
// unbookable after a rental — cleaning, refuelling, inspection. Surfacing it on
// the storefront explains why a near-future search can come back empty: a long
// buffer (the 2880-min / 48h default) blocks the car for days, not minutes.

const MINUTES_PER_HOUR = 60

/** Turnaround minutes as readable hours, rounded to the nearest half hour. */
export function turnaroundHours(minutes: number): number {
  return Math.round((minutes / MINUTES_PER_HOUR) * 2) / 2
}
