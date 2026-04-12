// VIOLATION: reaching into another module's internals
import { fetchVehicles } from '@/modules/vehicles/api'
export function bookSomething() {
  return fetchVehicles()
}
