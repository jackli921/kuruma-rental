import { sql } from 'drizzle-orm'
import { getDb } from './index'
import { vehicles } from './schema'

const SEED_VEHICLES = [
  // Kei cars
  {
    name: 'Honda N-BOX',
    description:
      "Japan's best-selling kei car. Surprisingly spacious interior with tall cabin design, perfect for city driving and easy parking.",
    photos: ['https://images.unsplash.com/photo-1734857039653-c1b0a4b3422a?w=800&q=80'],
    seats: 4,
    transmission: 'AUTO' as const,
    fuelType: 'Gasoline',
    bufferMinutes: 60,
    minRentalHours: 3,
  },
  {
    name: 'Suzuki Hustler',
    description:
      'Playful crossover-style kei car with a rugged look. Great for exploring both city streets and countryside roads.',
    photos: ['https://images.unsplash.com/photo-1627907361729-3f084212cf96?w=800&q=80'],
    seats: 4,
    transmission: 'AUTO' as const,
    fuelType: 'Hybrid',
    bufferMinutes: 60,
    minRentalHours: 3,
  },
  {
    name: 'Daihatsu Tanto',
    description:
      'Ultra-practical kei car with sliding rear doors. Easy to load luggage and get in and out of tight parking spots.',
    photos: ['https://images.unsplash.com/photo-1549317661-bd32c8ce0afa?w=800&q=80'],
    seats: 4,
    transmission: 'AUTO' as const,
    fuelType: 'Gasoline',
    bufferMinutes: 60,
    minRentalHours: 3,
  },
  // Compact
  {
    name: 'Toyota Aqua',
    description:
      "Fuel-efficient hybrid hatchback. One of Japan's most popular compact cars with excellent fuel economy for long drives.",
    photos: ['https://images.unsplash.com/photo-1638618164682-12b986ec2a75?w=800&q=80'],
    seats: 5,
    transmission: 'AUTO' as const,
    fuelType: 'Hybrid',
    bufferMinutes: 60,
    minRentalHours: 3,
  },
  {
    name: 'Toyota Yaris',
    description:
      'Nimble and modern compact car. Easy to handle in Osaka traffic with responsive steering and good visibility.',
    photos: ['https://images.unsplash.com/photo-1654617783689-9e85155659da?w=800&q=80'],
    seats: 5,
    transmission: 'AUTO' as const,
    fuelType: 'Hybrid',
    bufferMinutes: 60,
    minRentalHours: 3,
  },
  {
    name: 'Honda Fit',
    description:
      "Versatile compact hatchback with Honda's Magic Seat system. Fold-flat rear seats create impressive cargo space.",
    photos: ['https://images.unsplash.com/photo-1662981535849-b65888e3ec45?w=800&q=80'],
    seats: 5,
    transmission: 'AUTO' as const,
    fuelType: 'Hybrid',
    bufferMinutes: 60,
    minRentalHours: 3,
  },
  // Sedan
  {
    name: 'Toyota Corolla',
    description:
      'Comfortable and reliable sedan. Smooth highway ride with plenty of legroom for passengers. A great all-rounder.',
    photos: ['https://images.unsplash.com/photo-1623869675781-80aa31012a5a?w=800&q=80'],
    seats: 5,
    transmission: 'AUTO' as const,
    fuelType: 'Hybrid',
    bufferMinutes: 60,
    minRentalHours: 4,
  },
  {
    name: 'Toyota Camry',
    description:
      'Premium mid-size sedan with a quiet, refined cabin. Ideal for business travel or longer road trips across Japan.',
    photos: ['https://images.unsplash.com/photo-1621007947382-bb3c3994e3fb?w=800&q=80'],
    seats: 5,
    transmission: 'AUTO' as const,
    fuelType: 'Hybrid',
    bufferMinutes: 60,
    minRentalHours: 4,
  },
  // SUV
  {
    name: 'Mazda CX-5',
    description:
      "Stylish mid-size SUV with engaging driving dynamics. Premium interior materials and Mazda's signature driving feel.",
    photos: ['https://images.unsplash.com/photo-1743114713491-133c9211e7e5?w=800&q=80'],
    seats: 5,
    transmission: 'AUTO' as const,
    fuelType: 'Gasoline',
    bufferMinutes: 60,
    minRentalHours: 4,
  },
  {
    name: 'Toyota RAV4',
    description:
      'Popular compact SUV with available all-wheel drive. Confident handling on mountain roads and comfortable on highways.',
    photos: ['https://images.unsplash.com/photo-1617469767053-d3b523a0b982?w=800&q=80'],
    seats: 5,
    transmission: 'AUTO' as const,
    fuelType: 'Hybrid',
    bufferMinutes: 60,
    minRentalHours: 4,
  },
  {
    name: 'Toyota Harrier',
    description:
      'Luxury crossover SUV with a quiet, upscale cabin. Smooth ride quality and refined interior for premium travel.',
    photos: ['https://images.unsplash.com/photo-1706117948467-91727d5ef03c?w=800&q=80'],
    seats: 5,
    transmission: 'AUTO' as const,
    fuelType: 'Hybrid',
    bufferMinutes: 60,
    minRentalHours: 4,
  },
  {
    name: 'Suzuki Jimny',
    description:
      'Iconic compact off-roader with serious 4WD capability. Perfect for mountain adventures and unpaved roads.',
    photos: ['https://images.unsplash.com/photo-1622071356556-47f1b87743de?w=800&q=80'],
    seats: 4,
    transmission: 'AUTO' as const,
    fuelType: 'Gasoline',
    bufferMinutes: 60,
    minRentalHours: 3,
  },
  // Van / MPV
  {
    name: 'Toyota Alphard',
    description:
      "Japan's most popular luxury minivan. Captain seats, sliding doors, and spacious cabin for families or groups up to 7.",
    photos: ['https://images.unsplash.com/photo-1558101847-e017d5e414a4?w=800&q=80'],
    seats: 7,
    transmission: 'AUTO' as const,
    fuelType: 'Hybrid',
    bufferMinutes: 90,
    minRentalHours: 6,
  },
  {
    name: 'Toyota Sienta',
    description:
      'Compact minivan with sliding doors and flexible seating. Easy to drive yet fits the whole family with luggage.',
    photos: ['https://images.unsplash.com/photo-1548144417-06f20c6793e4?w=800&q=80'],
    seats: 7,
    transmission: 'AUTO' as const,
    fuelType: 'Hybrid',
    bufferMinutes: 60,
    minRentalHours: 4,
  },
  {
    name: 'Honda Freed',
    description:
      'Compact 6-seater minivan with low floor height for easy entry. Perfect balance of space and city-friendly size.',
    photos: ['https://images.unsplash.com/photo-1559416523-140ddc3d238c?w=800&q=80'],
    seats: 6,
    transmission: 'AUTO' as const,
    fuelType: 'Hybrid',
    bufferMinutes: 60,
    minRentalHours: 4,
  },
]

async function seed() {
  const db = getDb()

  // Clear existing vehicles for idempotent seeding
  console.log('Clearing existing vehicles...')
  await db.delete(vehicles).where(sql`1=1`)

  console.log('Seeding vehicles...')
  const inserted = await db
    .insert(vehicles)
    .values(SEED_VEHICLES)
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
