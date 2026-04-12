// VIOLATION: reaching into a module's internal file from a page
import { VehicleCard } from '@/modules/vehicles/components'
export default function Page() { return <VehicleCard /> }
