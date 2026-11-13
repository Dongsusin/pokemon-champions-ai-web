import { timingSafeEqual } from 'node:crypto'
import { getProductionServices } from '../server/productionServices.js'

export const config = { maxDuration: 60 }

export default { async fetch(request) {
  const secret = process.env.CRON_SECRET
  if (request.method !== 'GET') return new Response(null, { status: 405, headers: { Allow: 'GET' } })
  if (!secret) return new Response(null, { status: 401 })
  const expected = Buffer.from('Bearer ' + secret)
  const supplied = Buffer.from(request.headers.get('authorization') ?? '')
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return new Response(null, { status: 401 })
  try {
    const services = await getProductionServices()
    return Response.json({ pruned: await services.pruneCompletedBattles() })
  } catch {
    return new Response(null, { status: 503 })
  }
} }
