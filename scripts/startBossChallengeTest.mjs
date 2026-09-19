import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

if (process.env.NODE_ENV === 'production' || process.env.VERCEL) throw new Error('Local development only')
const root = fileURLToPath(new URL('../', import.meta.url))
const port = Number(process.env.BOSS_TEST_PORT || 5198)
const main = await readFile(new URL('../src/main.jsx', import.meta.url), 'utf8')
const styles = [...main.matchAll(/import ['"]\.\/([^'"]+\.css)['"]/g)].map(match => `import '/src/${match[1]}';`).join('\n')
const entry = `import React from 'react';import{createRoot}from'react-dom/client';
import{GameApp}from'/src/App.jsx';import'/src/mobileViewport.js';
import{createBossOpponent}from'/src/data/bossChallenge.js';import{createSavedTeams}from'/src/data/teamData.js';
import{loadGameSettings}from'/src/gameSettings.js';import{applyGameTextScale}from'/src/gameTextScale.js';
${styles}
if(!localStorage.getItem('boss-full-game-fixture-v2')){
  const box=[6,9,3,25,94,149,150,248,445,448,282,376,249,250,244,245,243].map((speciesId,i)=>({...createBossOpponent({speciesId},'dex-'+speciesId),directDrawCount:1}));
  const ids=box.map(p=>p.captureId),team=ids.slice(0,6);
  localStorage.setItem('champions-dex-v2',JSON.stringify(box));
  localStorage.setItem('champions-teams-v1',JSON.stringify({version:1,activeTeamId:'team-1',teams:createSavedTeams(team,ids)}));
  localStorage.setItem('champions-team-v2',JSON.stringify(team));
  localStorage.setItem('champions-vp-v1','100000');
  localStorage.setItem('champions-draw-tutorial-v1','complete');
  localStorage.setItem('boss-full-game-fixture-v2','ready');
}
applyGameTextScale(loadGameSettings().game.textScale);
const user={uid:'boss-local-preview',displayName:'보스전 테스트',isLocalGuest:true,isAnonymous:true,providerData:[]};
const unavailable=async()=>{throw new Error('로컬 테스트에서는 계정 연결과 온라인 대전을 사용할 수 없습니다.')};
createRoot(document.getElementById('root')).render(<GameApp user={user} accountError="" authBusy={false} autoLogin={false}
  onAutoLoginChange={()=>{}} onConnectGoogle={unavailable} onDeleteAccount={unavailable} onSetNickname={unavailable}
  onPlayerDataChanged={()=>{}} onSyncBeforeRanked={async()=>false} onSignOut={()=>location.reload()}/>);`
const server = await createServer({ root, mode: 'boss-challenge-test', cacheDir: 'scripts/.cache/boss-full-game-vite',
  plugins: [{ name: 'boss-full-game-test', enforce: 'pre',
    resolveId(id) {
      if (id === '/boss-full-game-entry.jsx') return id
      if (/\/auth\/firebaseClient(?:\.js)?$/.test(id) || id === './firebaseClient') return '\0boss-offline-auth'
    },
    load(id) {
      if (id === '/boss-full-game-entry.jsx') return entry
      if (id === '\0boss-offline-auth') return 'export const firebaseAuth=null;export const firebaseDb=null;export const isFirebaseConfigured=false;export const missingFirebaseEnvironmentVariables=[];'
    },
    configureServer(vite) {
      vite.middlewares.use(async (request, response, next) => {
        const pathname = new URL(request.url, 'http://localhost').pathname
        if (pathname.startsWith('/api/')) {
          response.statusCode = 503; response.setHeader('Content-Type', 'application/json')
          response.end(JSON.stringify({ error: { code: 'LOCAL_PREVIEW_OFFLINE', message: '로컬 게임 테스트: 온라인 서비스 미연결' } })); return
        }
        if (!['/', '/boss-preview.html'].includes(pathname)) return next()
        response.setHeader('Content-Type', 'text/html')
        response.end(await vite.transformIndexHtml('/', '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Champions Arena · 로컬 게임 테스트</title></head><body><div id="root"></div><script type="module" src="/boss-full-game-entry.jsx"></script></body></html>'))
      })
    },
  }], server: { host: '127.0.0.1', port, strictPort: true },
})
await server.listen()
console.log(`전체 게임 테스트: http://127.0.0.1:${port}/`)
console.log('실제 GameApp·스타일·전투 엔진 사용. 로비 → 시작하기 → 보스전. 테스트 포켓몬 17마리 / 100,000 VP. 온라인 계정과 분리된 로컬 저장.')
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await server.close(); process.exit(0) })
