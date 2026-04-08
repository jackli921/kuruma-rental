import { Hono } from 'hono'
import health from './routes/health'
import vehicles from './routes/vehicles'

const app = new Hono()

app.route('/', health)
app.route('/', vehicles)

export default app
