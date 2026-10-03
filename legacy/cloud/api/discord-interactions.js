import { waitUntil } from '@vercel/functions'
import { createDiscordInteractionHandler } from '../../../server/discordInteractionHttp.js'

// Web Standard Request preserves the signed raw body. Server-only integration:
// no Discord token or community configuration is included in the Vite client.
const handle = createDiscordInteractionHandler({ schedule: waitUntil })
export const config = { maxDuration: 60 }
export default { fetch: handle }
