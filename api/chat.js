import { handleProductionGlobalChatRequest } from '../server/globalChatHttp.js'

export const config = { maxDuration: 30 }
export default { fetch: handleProductionGlobalChatRequest }
