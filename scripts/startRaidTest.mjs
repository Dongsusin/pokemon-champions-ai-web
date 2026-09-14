import { createServer } from 'vite'
import { RAID_TEST_IDENTITIES, startRaidDevServer } from './raidDevServer.mjs'

if (process.env.NODE_ENV === 'production' || process.env.VERCEL) {
  throw new Error('The raid test launcher is only available on a local development computer.')
}

// These flags exist only for this Node/Vite process. They are never written to
// an env file and do not enable the deployed boss-raid route.
process.env.VITE_RAID_ENABLED = 'true'
process.env.VITE_RAID_LOCAL_TEST = 'true'
const apiPort = Number(process.env.RAID_TEST_API_PORT || 8789)
const uiPort = Number(process.env.RAID_TEST_PORT || 5187)
if (![apiPort, uiPort].every(port => Number.isInteger(port) && port > 0 && port <= 65535)) throw new Error('Invalid local raid test port')
process.env.VITE_RAID_API_URL = `http://127.0.0.1:${apiPort}/api/raid`

let backend
let frontend
let closing = false

async function close() {
  if (closing) return
  closing = true
  await frontend?.close()
  await backend?.close()
}

for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  close().then(() => process.exit(0), () => process.exit(1))
})

function appHtml(fixture) {
  const safeFixture = JSON.stringify(fixture).replace(/</g, '\\u003c')
  return `<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Champions Arena Raid Test</title></head><body><div id="root"></div><script>window.__raidTestFixture=${safeFixture}</script><script type="module" src="/raid-test-entry.js"></script></body></html>`
}

function appEntry() {
  return `import React from 'react';import{createRoot}from'react-dom/client';import{GameApp}from'/src/App.jsx';import'/src/mobileViewport.js';
import'/src/styles.css';import'/src/screenRedesign.css';import'/src/battleGen5.css';import'/src/titleCleanup.css';import'/src/battleGimmicks.css';import'/src/moveAnimationDirector.css';import'/src/settings.css';import'/src/auth.css';import'/src/mobileLandscape.css';import'/src/gameTextScale.css';
const fixture=window.__raidTestFixture;const requested=new URLSearchParams(location.search).get('player');const identity=fixture.identities.includes(requested)?requested:'alice';
try{localStorage.setItem('champions-dex-v2',JSON.stringify(fixture.boxes[identity]));localStorage.setItem('champions-draw-tutorial-v1','complete');localStorage.setItem('champions-game-settings-v1',JSON.stringify({audio:{enabled:false},game:{textScale:1}}));sessionStorage.setItem('champions-raid-test-identity-v1',identity)}catch{}
const user={uid:'ranked-test-'+identity,displayName:'로컬 '+identity,email:null,photoURL:null,nickname:'',isAnonymous:false,isLocalGuest:false,providerData:[]};
createRoot(document.getElementById('root')).render(React.createElement(GameApp,{user,accountError:'',authBusy:false,autoLogin:true,onAutoLoginChange:()=>{},onConnectGoogle:async()=>{},onDeleteAccount:async()=>{},onSetNickname:async()=>{},onPlayerDataChanged:()=>{},onSyncBeforeRanked:async()=>true,onSignOut:async()=>{}}));`
}

try {
  backend = await startRaidDevServer({ port: apiPort, timeouts: process.env.RAID_TEST_COMMAND_MS
    ? { command: Number(process.env.RAID_TEST_COMMAND_MS) } : undefined })
  process.env.VITE_RAID_API_URL = backend.url
  frontend = await createServer({
    mode: 'raid-test',
    cacheDir: 'scripts/.cache/raid-test/vite',
    plugins: [{
      name: 'raid-test-app-entry', enforce: 'pre',
      configureServer(viteServer) {
        viteServer.middlewares.use(async (request, response, next) => {
          if (new URL(request.url, 'http://localhost').pathname !== '/raid-test.html') { next(); return }
          response.setHeader('Content-Type', 'text/html')
          response.end(await viteServer.transformIndexHtml('/raid-test.html', appHtml({ boxes: backend.boxes, identities: RAID_TEST_IDENTITIES })))
        })
      },
      resolveId(source) {
        if (source === '/raid-test-entry.js') return source
        if (/\/auth\/firebaseClient(?:\.js)?$/.test(source) || source === './firebaseClient') return '\0raid-test-firebase'
        if (/\/auth\/accountSession(?:\.js)?$/.test(source) || source === './accountSession') return '\0raid-test-session'
      },
      load(id) {
        if (id === '/raid-test-entry.js') return appEntry()
        if (id === '\0raid-test-firebase') return 'export const firebaseAuth=null;export const firebaseDb=null;export const isFirebaseConfigured=false;export const missingFirebaseEnvironmentVariables=[];'
        if (id === '\0raid-test-session') return `export const hasActiveAccountSession=()=>true;
export const getActiveAccountSessionOwnerId=(uid='')=>String(uid);
export const acquireAccountSession=async()=>({release:async()=>{},pauseForGuestDeletion:async()=>null});
export const ACCOUNT_SESSION_ERROR_CODES={};`
      },
    }],
    server: { host: '127.0.0.1', port: uiPort, strictPort: true },
  })
  await frontend.listen()
  console.log('\n협동 보스전 로컬 테스트가 시작되었습니다.')
  for (const identity of RAID_TEST_IDENTITIES) console.log(`  ${identity}: http://127.0.0.1:${uiPort}/raid-test.html?player=${identity}`)
  console.log('각 창에서 시작하기 → 협동 보스전으로 들어가세요. 실제 로컬 HTTP 서비스·엔진·서버 소유 포켓몬만 사용하며, 종료하면 모든 테스트 기록이 지워집니다. 종료: Ctrl+C\n')
} catch (error) {
  await close()
  console.error(error.message)
  process.exitCode = 1
}
