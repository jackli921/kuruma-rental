import { and, eq, inArray, sql } from 'drizzle-orm'
import {
  BEST_CAR_RENTAL_NAME,
  BEST_CAR_RENTAL_OPERATOR_ID,
  BEST_CAR_RENTAL_OWNER_EMAIL,
  BEST_CAR_RENTAL_OWNER_NAME,
  BEST_CAR_RENTAL_SLUG,
} from './constants'
import { getDb } from './index'
import { parsePlatformAdminEmails } from './platform-admins'
import { insuranceOptions, locations, operators, users, vehicleClasses, vehicles } from './schema'

// Best Car Rental's renter-facing classes, keyed by ACRISS code (#388). Each
// seeded vehicle attaches to one of these via the (operatorId, classId)
// composite FK, so the class row MUST be inserted before the vehicle row.
// dailyRateJpy is the class "from" price (lowest in its bucket). Idempotent on
// slug. CCAR carries the Toyota Yaris (proposal §6 row 3 demo target).
const SEED_CLASSES = [
  {
    slug: 'kei',
    name: 'Kei car',
    acrissCode: 'MCAR',
    description: "Japan's compact kei class — cheapest to rent, easiest to park.",
    seats: 4,
    luggageCapacity: 1,
    transmission: 'AUTO' as const,
    fuelType: 'Gasoline',
    dailyRateJpy: 6500,
    hourlyRateJpy: 900,
    sortOrder: 1,
  },
  {
    slug: 'compact',
    name: 'Compact',
    acrissCode: 'CCAR',
    description: 'Fuel-efficient compact hatchbacks. Great for city driving and short trips.',
    seats: 5,
    luggageCapacity: 2,
    transmission: 'AUTO' as const,
    fuelType: 'Hybrid',
    dailyRateJpy: 8000,
    hourlyRateJpy: 1100,
    sortOrder: 2,
  },
  {
    slug: 'sedan',
    name: 'Sedan',
    acrissCode: 'SCAR',
    description: 'Comfortable mid-size sedans for longer highway drives.',
    seats: 5,
    luggageCapacity: 3,
    transmission: 'AUTO' as const,
    fuelType: 'Hybrid',
    dailyRateJpy: 9500,
    hourlyRateJpy: 1300,
    sortOrder: 3,
  },
  {
    slug: 'suv',
    name: 'SUV',
    acrissCode: 'SUVR',
    description: 'Mid-size SUVs and off-roaders for mountain roads and group trips.',
    seats: 5,
    luggageCapacity: 4,
    transmission: 'AUTO' as const,
    fuelType: 'Hybrid',
    dailyRateJpy: 9000,
    hourlyRateJpy: 1300,
    sortOrder: 4,
  },
  {
    slug: 'van',
    name: 'Van / MPV',
    acrissCode: 'IVAR',
    description: 'Spacious 6-7 seat minivans for families and groups with luggage.',
    seats: 7,
    luggageCapacity: 5,
    transmission: 'AUTO' as const,
    fuelType: 'Hybrid',
    dailyRateJpy: 11000,
    hourlyRateJpy: 1500,
    sortOrder: 5,
  },
] as const

// Maps each seeded vehicle (by name) to its class slug. A vehicle whose name
// is absent is seeded with no class (classId NULL is valid). Keeping this as a
// lookup avoids stamping classId on every SEED_VEHICLES entry.
const VEHICLE_CLASS_SLUG_BY_NAME: Record<string, string> = {
  'Honda N-BOX': 'kei',
  'Suzuki Hustler': 'kei',
  'Daihatsu Tanto': 'kei',
  'Toyota Aqua': 'compact',
  'Toyota Yaris': 'compact',
  'Honda Fit': 'compact',
  'Toyota Corolla': 'sedan',
  'Toyota Camry': 'sedan',
  'Mazda CX-5': 'suv',
  'Toyota RAV4': 'suv',
  'Toyota Harrier': 'suv',
  'Suzuki Jimny': 'suv',
  'Toyota Alphard': 'van',
  'Toyota Sienta': 'van',
  'Honda Freed': 'van',
}

// Realistic JPY day-rates loosely anchored to Osaka/Kansai rental shop
// price lists in 2025-26. Hourly rate is roughly (daily / 8) rounded to a
// friendly number. The owner will override these via the form as real
// pricing decisions land — seed data is just so the app shows a number.
const SEED_VEHICLES = [
  // Kei cars — cheapest bucket
  {
    name: 'Honda N-BOX',
    make: 'Honda',
    model: 'N-BOX',
    year: 2023,
    color: 'White',
    description:
      "Japan's best-selling kei car. Surprisingly spacious interior with tall cabin design, perfect for city driving and easy parking.",
    photos: ['https://images.unsplash.com/photo-1734857039653-c1b0a4b3422a?w=800&q=80'],
    seats: 4,
    transmission: 'AUTO' as const,
    fuelType: 'Gasoline',
    bufferMinutes: 60,
    minRentalHours: 3,
    maxRentalHours: 72,
    advanceBookingHours: null,
    dailyRateJpy: 6500,
    hourlyRateJpy: 900,
  },
  {
    name: 'Suzuki Hustler',
    make: 'Suzuki',
    model: 'Hustler',
    year: 2022,
    color: 'Yellow',
    description:
      'Playful crossover-style kei car with a rugged look. Great for exploring both city streets and countryside roads.',
    photos: ['https://images.unsplash.com/photo-1627907361729-3f084212cf96?w=800&q=80'],
    seats: 4,
    transmission: 'AUTO' as const,
    fuelType: 'Hybrid',
    bufferMinutes: 60,
    minRentalHours: 3,
    maxRentalHours: 72,
    advanceBookingHours: null,
    dailyRateJpy: 6500,
    hourlyRateJpy: 900,
  },
  {
    name: 'Daihatsu Tanto',
    make: 'Daihatsu',
    model: 'Tanto',
    year: 2023,
    color: 'Pink',
    description:
      'Ultra-practical kei car with sliding rear doors. Easy to load luggage and get in and out of tight parking spots.',
    photos: ['https://images.unsplash.com/photo-1549317661-bd32c8ce0afa?w=800&q=80'],
    seats: 4,
    transmission: 'AUTO' as const,
    fuelType: 'Gasoline',
    bufferMinutes: 60,
    minRentalHours: 3,
    maxRentalHours: 72,
    advanceBookingHours: null,
    dailyRateJpy: 6500,
    hourlyRateJpy: 900,
  },
  // Compact — mid bucket
  {
    name: 'Toyota Aqua',
    make: 'Toyota',
    model: 'Aqua',
    year: 2022,
    color: 'White',
    description:
      "Fuel-efficient hybrid hatchback. One of Japan's most popular compact cars with excellent fuel economy for long drives.",
    photos: ['https://images.unsplash.com/photo-1638618164682-12b986ec2a75?w=800&q=80'],
    seats: 5,
    transmission: 'AUTO' as const,
    fuelType: 'Hybrid',
    bufferMinutes: 60,
    minRentalHours: 3,
    maxRentalHours: 120,
    advanceBookingHours: null,
    dailyRateJpy: 8000,
    hourlyRateJpy: 1100,
  },
  {
    name: 'Toyota Yaris',
    make: 'Toyota',
    model: 'Yaris',
    year: 2024,
    color: 'Red',
    description:
      'Nimble and modern compact car. Easy to handle in Osaka traffic with responsive steering and good visibility.',
    photos: ['https://images.unsplash.com/photo-1654617783689-9e85155659da?w=800&q=80'],
    seats: 5,
    transmission: 'AUTO' as const,
    fuelType: 'Hybrid',
    bufferMinutes: 60,
    minRentalHours: 3,
    maxRentalHours: 120,
    advanceBookingHours: null,
    dailyRateJpy: 8000,
    hourlyRateJpy: 1100,
  },
  {
    name: 'Honda Fit',
    make: 'Honda',
    model: 'Fit',
    year: 2023,
    color: 'Blue',
    description:
      "Versatile compact hatchback with Honda's Magic Seat system. Fold-flat rear seats create impressive cargo space.",
    photos: ['https://images.unsplash.com/photo-1662981535849-b65888e3ec45?w=800&q=80'],
    seats: 5,
    transmission: 'AUTO' as const,
    fuelType: 'Hybrid',
    bufferMinutes: 60,
    minRentalHours: 3,
    maxRentalHours: 120,
    advanceBookingHours: null,
    dailyRateJpy: 8000,
    hourlyRateJpy: 1100,
  },
  // Sedan — mid-high bucket
  {
    name: 'Toyota Corolla',
    make: 'Toyota',
    model: 'Corolla',
    year: 2023,
    color: 'Silver',
    description:
      'Comfortable and reliable sedan. Smooth highway ride with plenty of legroom for passengers. A great all-rounder.',
    photos: ['https://images.unsplash.com/photo-1623869675781-80aa31012a5a?w=800&q=80'],
    seats: 5,
    transmission: 'AUTO' as const,
    fuelType: 'Hybrid',
    bufferMinutes: 60,
    minRentalHours: 4,
    maxRentalHours: 168,
    advanceBookingHours: null,
    dailyRateJpy: 9500,
    hourlyRateJpy: 1300,
  },
  {
    name: 'Toyota Camry',
    make: 'Toyota',
    model: 'Camry',
    year: 2024,
    color: 'Black',
    description:
      'Premium mid-size sedan with a quiet, refined cabin. Ideal for business travel or longer road trips across Japan.',
    photos: ['https://images.unsplash.com/photo-1621007947382-bb3c3994e3fb?w=800&q=80'],
    seats: 5,
    transmission: 'AUTO' as const,
    fuelType: 'Hybrid',
    bufferMinutes: 60,
    minRentalHours: 4,
    maxRentalHours: 168,
    advanceBookingHours: 12,
    dailyRateJpy: 12000,
    hourlyRateJpy: 1700,
  },
  // SUV — high bucket
  {
    name: 'Mazda CX-5',
    make: 'Mazda',
    model: 'CX-5',
    year: 2023,
    color: 'Red',
    description:
      "Stylish mid-size SUV with engaging driving dynamics. Premium interior materials and Mazda's signature driving feel.",
    photos: ['https://images.unsplash.com/photo-1743114713491-133c9211e7e5?w=800&q=80'],
    seats: 5,
    transmission: 'AUTO' as const,
    fuelType: 'Gasoline',
    bufferMinutes: 60,
    minRentalHours: 4,
    maxRentalHours: 168,
    advanceBookingHours: null,
    dailyRateJpy: 11500,
    hourlyRateJpy: 1600,
  },
  {
    name: 'Toyota RAV4',
    make: 'Toyota',
    model: 'RAV4',
    year: 2022,
    color: 'White',
    description:
      'Popular compact SUV with available all-wheel drive. Confident handling on mountain roads and comfortable on highways.',
    photos: ['https://images.unsplash.com/photo-1617469767053-d3b523a0b982?w=800&q=80'],
    seats: 5,
    transmission: 'AUTO' as const,
    fuelType: 'Hybrid',
    bufferMinutes: 60,
    minRentalHours: 4,
    maxRentalHours: 168,
    advanceBookingHours: null,
    dailyRateJpy: 12500,
    hourlyRateJpy: 1700,
  },
  {
    name: 'Toyota Harrier',
    make: 'Toyota',
    model: 'Harrier',
    year: 2024,
    color: 'Black',
    description:
      'Luxury crossover SUV with a quiet, upscale cabin. Smooth ride quality and refined interior for premium travel.',
    photos: ['https://images.unsplash.com/photo-1706117948467-91727d5ef03c?w=800&q=80'],
    seats: 5,
    transmission: 'AUTO' as const,
    fuelType: 'Hybrid',
    bufferMinutes: 60,
    minRentalHours: 4,
    maxRentalHours: 168,
    advanceBookingHours: 12,
    dailyRateJpy: 14000,
    hourlyRateJpy: 1900,
  },
  {
    name: 'Suzuki Jimny',
    make: 'Suzuki',
    model: 'Jimny',
    year: 2023,
    color: 'Green',
    description:
      'Iconic compact off-roader with serious 4WD capability. Perfect for mountain adventures and unpaved roads.',
    photos: ['https://images.unsplash.com/photo-1622071356556-47f1b87743de?w=800&q=80'],
    seats: 4,
    transmission: 'AUTO' as const,
    fuelType: 'Gasoline',
    bufferMinutes: 60,
    minRentalHours: 3,
    maxRentalHours: 120,
    advanceBookingHours: null,
    dailyRateJpy: 9000,
    hourlyRateJpy: 1300,
  },
  // Van / MPV — highest bucket (7+ seats)
  {
    name: 'Toyota Alphard',
    make: 'Toyota',
    model: 'Alphard',
    year: 2024,
    color: 'White',
    description:
      "Japan's most popular luxury minivan. Captain seats, sliding doors, and spacious cabin for families or groups up to 7.",
    photos: ['https://images.unsplash.com/photo-1558101847-e017d5e414a4?w=800&q=80'],
    seats: 7,
    transmission: 'AUTO' as const,
    fuelType: 'Hybrid',
    bufferMinutes: 90,
    minRentalHours: 6,
    maxRentalHours: 240,
    advanceBookingHours: 24,
    dailyRateJpy: 18000,
    hourlyRateJpy: 2500,
  },
  {
    name: 'Toyota Sienta',
    make: 'Toyota',
    model: 'Sienta',
    year: 2023,
    color: 'Silver',
    description:
      'Compact minivan with sliding doors and flexible seating. Easy to drive yet fits the whole family with luggage.',
    photos: ['https://images.unsplash.com/photo-1548144417-06f20c6793e4?w=800&q=80'],
    seats: 7,
    transmission: 'AUTO' as const,
    fuelType: 'Hybrid',
    bufferMinutes: 60,
    minRentalHours: 4,
    maxRentalHours: 168,
    advanceBookingHours: null,
    dailyRateJpy: 11000,
    hourlyRateJpy: 1500,
  },
  {
    name: 'Honda Freed',
    make: 'Honda',
    model: 'Freed',
    year: 2022,
    color: 'White',
    description:
      'Compact 6-seater minivan with low floor height for easy entry. Perfect balance of space and city-friendly size.',
    photos: ['https://images.unsplash.com/photo-1559416523-140ddc3d238c?w=800&q=80'],
    seats: 6,
    transmission: 'AUTO' as const,
    fuelType: 'Hybrid',
    bufferMinutes: 60,
    minRentalHours: 4,
    maxRentalHours: 168,
    advanceBookingHours: null,
    dailyRateJpy: 11000,
    hourlyRateJpy: 1500,
  },
]

// Best Car Rental's pickup/return storefronts across Kansai (#387 slice 2).
// Distinct names per operator satisfy locations_operatorId_name_unique. Hours
// are a single open/close pair (LocationOperatingHours MVP shape); turnaround
// uses the 48h (2880m) default unless a storefront needs a tighter cooldown.
const SEED_LOCATIONS = [
  {
    name: 'Namba Store',
    address: '2-10-70 Namba, Chuo Ward, Osaka 542-0076',
    operatingHours: { openTime: '08:00', closeTime: '20:00' },
  },
  {
    name: 'Umeda Store',
    address: '3-1-1 Umeda, Kita Ward, Osaka 530-0001',
    operatingHours: { openTime: '08:00', closeTime: '21:00' },
  },
  {
    name: 'Kansai Airport Counter',
    address: '1 Senshu-kuko Naka, Tajiri, Sennan District, Osaka 549-0001',
    operatingHours: { openTime: '06:00', closeTime: '23:00' },
  },
]

// Best Car Rental's insurance options (#404 slice 4a, proposal §2/§3). A normal
// option (150,000 yen deductible) and a premium one (250,000 yen deductible).
// dailyPriceJpy are operator-set placeholders. Distinct names per operator
// satisfy insurance_options_active_name_unique (partial, ACTIVE-only).
const SEED_INSURANCE_OPTIONS = [
  {
    name: 'Standard Cover',
    description: 'Collision damage waiver with a standard deductible.',
    dailyPriceJpy: 1500,
    deductibleJpy: 150000,
  },
  {
    name: 'Premium Cover',
    description: 'Lower out-of-pocket exposure with a higher protection tier.',
    dailyPriceJpy: 2500,
    deductibleJpy: 250000,
  },
]

async function seed() {
  const db = getDb()

  // Transitional tenant (#386). vehicles.operatorId is NOT NULL with an FK to
  // operators, so the Best Car Rental operator must exist before any vehicle.
  // Idempotent so reseeding a warm DB is safe.
  console.log('Seeding Best Car Rental operator...')
  await db
    .insert(operators)
    .values({
      id: BEST_CAR_RENTAL_OPERATOR_ID,
      slug: BEST_CAR_RENTAL_SLUG,
      name: BEST_CAR_RENTAL_NAME,
    })
    .onConflictDoNothing()

  // Best Car Rental owner — the first OPERATOR_OWNER, scoped to the operator
  // above so their session/JWT carries operatorId (proposal acceptance:
  // "operator-staff login includes operatorId"). Idempotent: reseeding
  // re-asserts the role + tenant rather than duplicating the user.
  console.log('Seeding Best Car Rental owner...')
  await db
    .insert(users)
    .values({
      name: BEST_CAR_RENTAL_OWNER_NAME,
      email: BEST_CAR_RENTAL_OWNER_EMAIL,
      role: 'OPERATOR_OWNER',
      operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
    })
    .onConflictDoUpdate({
      target: users.email,
      set: {
        role: 'OPERATOR_OWNER',
        operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
        updatedAt: new Date(),
      },
    })

  // Platform-admin bootstrap (proposal §9 item 23): promote any existing user
  // whose email is in the PLATFORM_ADMIN_EMAILS allowlist. Idempotent and a
  // no-op when the env var is unset.
  const platformAdminEmails = parsePlatformAdminEmails(process.env.PLATFORM_ADMIN_EMAILS)
  if (platformAdminEmails.length > 0) {
    console.log(`Promoting ${platformAdminEmails.length} platform admin(s)...`)
    const promoted = await db
      // operatorId is nulled: a PLATFORM_ADMIN belongs to no tenant (proposal
      // §6.2). Promoting an existing OPERATOR_* row must clear its old tenant,
      // not leave a contradictory "admin scoped to operator X" row.
      .update(users)
      .set({ role: 'PLATFORM_ADMIN', operatorId: null, updatedAt: new Date() })
      .where(inArray(sql`lower(${users.email})`, platformAdminEmails))
      // Print the affected rows: a misconfigured allowlist that overlaps an
      // operator owner silently strips their tenant — make that visible (#386).
      .returning({ email: users.email })
    for (const u of promoted) {
      console.log(`  + ${u.email} -> PLATFORM_ADMIN (tenant cleared)`)
    }
    const unmatched = platformAdminEmails.length - promoted.length
    if (unmatched > 0) {
      console.log(`  note: ${unmatched} allowlisted email(s) matched no existing user`)
    }
  }

  // Best Car Rental storefronts (#387). Idempotent on (operatorId, name): a
  // reseed leaves existing rows untouched, preserving each row's id so the
  // vehicles->locations composite FK target stays stable across reseeds.
  console.log('Seeding locations...')
  const insertedLocations = await db
    .insert(locations)
    .values(SEED_LOCATIONS.map((l) => ({ ...l, operatorId: BEST_CAR_RENTAL_OPERATOR_ID })))
    .onConflictDoNothing({ target: [locations.operatorId, locations.name] })
    .returning({ id: locations.id, name: locations.name })
  console.log(`  seeded ${insertedLocations.length} new location(s)`)
  for (const l of insertedLocations) {
    console.log(`  + ${l.name} (${l.id})`)
  }

  // Vehicle classes MUST exist before vehicles: vehicles.(operatorId, classId)
  // is a composite FK to vehicle_classes.(operatorId, id) (#395). Idempotent on
  // slug so a reseed leaves existing class rows (and their ids) untouched,
  // keeping the composite-FK target stable across reseeds (#388).
  console.log('Seeding vehicle classes...')
  await db
    .insert(vehicleClasses)
    .values(SEED_CLASSES.map((c) => ({ ...c, operatorId: BEST_CAR_RENTAL_OPERATOR_ID })))
    .onConflictDoNothing({ target: vehicleClasses.slug })

  // Resolve slug -> id for the just-seeded (or pre-existing) classes so each
  // vehicle can attach by classId. Scoped to this operator's classes.
  const classRows = await db
    .select({ id: vehicleClasses.id, slug: vehicleClasses.slug })
    .from(vehicleClasses)
    .where(eq(vehicleClasses.operatorId, BEST_CAR_RENTAL_OPERATOR_ID))
  const classIdBySlug = new Map(classRows.map((r) => [r.slug, r.id]))

  // Best Car Rental insurance options (#404). The active-name uniqueness is a
  // PARTIAL index (status='ACTIVE'), which onConflict can't target, so insert
  // each option only when no ACTIVE row of that name exists — idempotent across
  // reseeds without disturbing an operator's edits.
  console.log('Seeding insurance options...')
  for (const option of SEED_INSURANCE_OPTIONS) {
    const [existing] = await db
      .select({ id: insuranceOptions.id })
      .from(insuranceOptions)
      .where(
        and(
          eq(insuranceOptions.operatorId, BEST_CAR_RENTAL_OPERATOR_ID),
          eq(insuranceOptions.name, option.name),
          eq(insuranceOptions.status, 'ACTIVE'),
        ),
      )
    if (existing) continue
    const [inserted] = await db
      .insert(insuranceOptions)
      .values({ ...option, operatorId: BEST_CAR_RENTAL_OPERATOR_ID })
      .returning({ id: insuranceOptions.id, name: insuranceOptions.name })
    if (inserted) console.log(`  + ${inserted.name} (${inserted.id})`)
  }

  // Clear existing vehicles for idempotent seeding. Classes are NOT cleared —
  // their ids must stay stable as composite-FK targets.
  console.log('Clearing existing vehicles...')
  await db.delete(vehicles).where(sql`1=1`)

  console.log('Seeding vehicles...')
  const inserted = await db
    .insert(vehicles)
    .values(
      SEED_VEHICLES.map((v) => {
        const classSlug = VEHICLE_CLASS_SLUG_BY_NAME[v.name]
        const classId = classSlug ? (classIdBySlug.get(classSlug) ?? null) : null
        return { ...v, operatorId: BEST_CAR_RENTAL_OPERATOR_ID, classId }
      }),
    )
    .returning({ id: vehicles.id, name: vehicles.name })

  for (const v of inserted) {
    console.log(`  + ${v.name} (${v.id})`)
  }

  console.log(`\nSeeded ${inserted.length} vehicles.`)
  process.exit(0)
}

seed().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})
