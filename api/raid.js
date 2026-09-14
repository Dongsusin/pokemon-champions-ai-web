import { handleProductionRaidRequest } from '../server/raidHttp.js'

export const config = { maxDuration: 60 }
export default { fetch: handleProductionRaidRequest }
