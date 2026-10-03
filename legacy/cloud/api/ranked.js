import { handleProductionRankedRequest } from '../../../server/rankedHttp.js'

export const config = { maxDuration: 60 }
export default { fetch: handleProductionRankedRequest }
