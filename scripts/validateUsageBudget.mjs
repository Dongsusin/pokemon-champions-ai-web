import fs from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const run=promisify(execFile), root=new URL('../',import.meta.url), output=new URL('scripts/.cache/usage-budget/',root)
await fs.mkdir(output,{recursive:true})
const scripts=['validateSaveSplices.mjs','validatePoolCost.mjs','validateIdleBudget.mjs','validateAccountApiClient.mjs','validateAccountServer.mjs','validatePostgresStore.mjs','validateAccountGameData.mjs','validateAccountSession.mjs','validateOnlinePlayersServer.mjs','validateOnlinePlayersClient.mjs','validateNicknameProductionAuth.mjs','validateChatRemoval.mjs','validateNicknameModeration.mjs','validateRankedPolling.mjs','validateRankedService.mjs','validateBattleRooms.mjs','validateRoomSpectators.mjs','validateGuestAccountDeletion.mjs','validateGuestCleanupStorage.mjs','validateStorageMigration.mjs']
const results=[]
for(const script of scripts){const start=Date.now();let code=0,stdout='',stderr='';try{({stdout,stderr}=await run(process.execPath,['scripts/'+script],{cwd:root,encoding:'utf8',timeout:90000,maxBuffer:2000000}))}catch(error){code=error.code??1;stdout=error.stdout??'';stderr=error.stderr??''}await fs.writeFile(new URL(script+'.log',output),stdout+stderr);const result={script,exitCode:code,ms:Date.now()-start,passLines:(stdout.match(/^PASS /gm)||[]).length,skipped:stdout.split('\n').filter(line=>line.startsWith('SKIP '))};results.push(result);console.log(JSON.stringify(result))}
// The PostgreSQL backend is also checked against the live project using a
// rollback-only generated query when its direct connection secret is sensitive.
const summary={passed:results.every(r=>r.exitCode===0),scripts:results.length,checks:results.reduce((n,r)=>n+r.passLines,0),results}
await fs.writeFile(new URL('latest.json',output),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));process.exitCode=summary.passed?0:1
