import { handleProductionAccountRequest } from '../../../server/accountHttp.js'

export const config = { maxDuration: 60 }
export default { fetch: handleProductionAccountRequest }
