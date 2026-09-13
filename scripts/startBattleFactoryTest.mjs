import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'

if (process.env.NODE_ENV === 'production' || process.env.VERCEL) {
  throw new Error('The factory test launcher is available only on a local development server.')
}

// These flags exist only in this process. The launcher never loads a cloud
// account and cannot send matchmaking or statistics to the production API.
process.env.VITE_RANKED_ENABLED = 'false'
process.env.VITE_RANKED_LOCAL_TEST = 'false'
process.env.VITE_RANKED_API_URL = '/api/ranked'
process.env.VITE_POKEMON_USAGE_ENABLED = 'false'
process.env.VITE_POKEMON_USAGE_DEMO = 'false'
process.env.VITE_POKEMON_USAGE_SEEDED_TEST = 'false'

const root = fileURLToPath(new URL('../', import.meta.url))
const entryId = '/factory-local-entry.js'
const styles = ['styles', 'screenRedesign', 'battleGen5', 'titleCleanup', 'battleGimmicks',
  'moveAnimationDirector', 'settings', 'auth', 'mobileLandscape']
const entry = `
import '/src/mobileViewport.js';
import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { GameApp } from '/src/App.jsx';
import { normalizePokemon } from '/src/data/trainingData.js';
${styles.map(name => `import '/src/${name}.css';`).join('\n')}
if (location.hostname !== '127.0.0.1') throw new Error('Local factory preview only');
if (localStorage.getItem('champions-factory-local-v1') !== 'ready') {
  localStorage.setItem('champions-dex-v2', JSON.stringify([
    normalizePokemon({ speciesId:25, captureId:'factory-local-box-25', directDrawCount:1 })
  ]));
  localStorage.setItem('champions-draw-tutorial-v1', 'complete');
  localStorage.setItem('champions-settings-v1', JSON.stringify({
    audio:{enabled:false}, game:{attackAnimation:'fast',hpBarSpeed:'fast'}
  }));
  localStorage.setItem('champions-factory-local-v1', 'ready');
}
createRoot(document.getElementById('root')).render(React.createElement(StrictMode,null,
  React.createElement(GameApp,{user:{uid:'factory-local',displayName:'팩토리 테스트',isLocalGuest:true}})));
`

let server
async function close() { await server?.close() }
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  close().then(() => process.exit(0), () => process.exit(1))
})
try {
  server = await createServer({ root, mode: 'factory-test', plugins: [{
    name: 'factory-local-preview', enforce: 'pre',
    transformIndexHtml(html) { return html.replace('/src/main.jsx', entryId) },
    resolveId(source) {
      if (source === entryId) return source
      if (/\/auth\/firebaseClient(?:\.js)?$/.test(source) || source === './firebaseClient') return '\0factory-local-auth'
    },
    load(id) {
      if (id === entryId) return entry
      if (id === '\0factory-local-auth') return 'export const firebaseAuth=null;export const firebaseDb=null;export const isFirebaseConfigured=false;export const missingFirebaseEnvironmentVariables=[];'
    },
    configureServer(vite) {
      vite.middlewares.use('/api', (_request, response) => {
        response.writeHead(503, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ error: { message: '팩토리 로컬 테스트에서는 온라인 API를 사용하지 않습니다.' } }))
      })
    },
  }], server: { host: '127.0.0.1', port: 5187, strictPort: true } })
  await server.listen()
  console.log('배틀팩토리 로컬 테스트: http://127.0.0.1:5187')
  console.log('시작하기 → 배틀팩토리 → 렌탈 3마리 선택 → 준비 화면에서 선봉 선택')
  console.log('승리 후 교환 또는 건너뛰기 → 다음 층. 패배·기권 시 도전 종료.')
  console.log('운영 계정·온라인 API를 사용하지 않습니다. 배포 없음. 종료: Ctrl+C')
} catch (error) { await close(); console.error(error.message); process.exitCode = 1 }
