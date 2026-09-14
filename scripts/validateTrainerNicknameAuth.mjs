import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { resolveChromiumExecutable } from '../promo/scripts/browserRuntime.mjs'

// Real AuthProvider -> playerProfile -> accountApiClient. Only Firebase/session
// admission and HTTP outcomes are local fixtures; no real credentials are used.
const require = createRequire(new URL('../promo/package.json', import.meta.url))
const { chromium } = require('playwright')
const root = fileURLToPath(new URL('../', import.meta.url))
const output = path.join(root, 'scripts/.cache/trainer-nickname-auth')
await fs.mkdir(output, { recursive: true })
const firebase = `
export const firebaseDb=null, isFirebaseConfigured=true, missingFirebaseEnvironmentVariables=[];
function sdkUser(uid){const user={uid,displayName:'김본명',email:uid+'@example.test',providerData:[{providerId:'google.com'}],isAnonymous:false};
user.getIdToken=async function(){if(this!==user)throw Error('SDK token lost its receiver');return 'nickname-'+uid+'-token'};return user;}
export const firebaseAuth={currentUser:sdkUser('auth-a'),app:{options:{projectId:'local-test'}}};
export function changeUser(uid){firebaseAuth.currentUser=uid?sdkUser(uid):null;window.__authListener?.(firebaseAuth.currentUser)};
window.__changeNicknameAuthUser=changeUser;`
const sdk = `import {firebaseAuth,changeUser} from '/nickname-auth-firebase.js';
export class GoogleAuthProvider{setCustomParameters(){} static credentialFromError(){return null}}
export const browserLocalPersistence={},browserSessionPersistence={};
export async function setPersistence(){}
export function onAuthStateChanged(auth,callback){window.__authListener=callback;queueMicrotask(()=>callback(auth.currentUser));return()=>{window.__authListener=null}}
export async function signOut(){changeUser(null)}
export const deleteUser=signOut;
export async function reauthenticateWithPopup(){return{user:firebaseAuth.currentUser}}
export const linkWithPopup=reauthenticateWithPopup,signInAnonymously=reauthenticateWithPopup,signInWithCredential=reauthenticateWithPopup,signInWithPopup=reauthenticateWithPopup;`
const session = `export const ACCOUNT_SESSION_ERROR_CODES={};
export function getActiveAccountSessionOwnerId(uid){return window.__nicknameLease===uid?'nickname-owner-1234567890':null}
export async function acquireAccountSession(user){window.__nicknameLease=user.uid;return{isActive:()=>window.__nicknameLease===user.uid,release:async()=>{if(window.__nicknameLease===user.uid)window.__nicknameLease=null}}}`
const entry = `import React from 'react';import{createRoot}from'react-dom/client';
import{AuthProvider,useAuth}from'/src/auth/AuthProvider.jsx';import{withPlayerNickname}from'/src/auth/playerProfile.js';
import{maskRankedTrainerName}from'/src/data/rankedPrivacy.js';
function Harness(){const auth=useAuth();window.__nicknameAuth=auth;window.__guestNickname=()=>withPlayerNickname({uid:'guest-a',isAnonymous:true,displayName:'guest-123456'},{uid:'guest-a',nickname:'위조별명'});
return React.createElement('main',null,React.createElement('p',{id:'ready'},String(auth.ready)),React.createElement('p',{id:'uid'},auth.user?.uid??''),React.createElement('p',{id:'name'},auth.user?maskRankedTrainerName(auth.user.displayName,false,auth.user.nickname):''),React.createElement('p',{id:'original'},auth.user?.displayName??''))}
createRoot(document.getElementById('root')).render(React.createElement(AuthProvider,null,React.createElement(Harness)));`
const modules = { '/nickname-auth-firebase.js': firebase, '/nickname-auth-sdk.js': sdk, '/nickname-auth-session.js': session, '/nickname-auth-entry.js': entry }
const server = await createServer({ root, plugins: [{ name: 'nickname-auth-validation', enforce: 'pre',
  resolveId: id => modules[id] ? id : undefined,
  load(id) {
    if (modules[id]) return modules[id]
    const normalized = id.replaceAll('\\', '/').split('?')[0]
    if (normalized.endsWith('/src/auth/firebaseClient.js')) return `export * from '/nickname-auth-firebase.js'`
    if (normalized.endsWith('/src/auth/accountSession.js')) return `export * from '/nickname-auth-session.js'`
    if (normalized.endsWith('/src/auth/gameStorageConfig.js')) return `export const isServerGameStorage=true,accountApiUrl=location.origin+'/api/account'`
  },
  transform(code, id) {
    if (id.replaceAll('\\', '/').split('?')[0].endsWith('/src/auth/AuthProvider.jsx')) return code.replace("from 'firebase/auth'", "from '/nickname-auth-sdk.js'")
  },
}], server: { host: '127.0.0.1', port: 0, hmr: false }, logLevel: 'error' })
let browser, context
const results = [], errors = [], requests = [], external = []
const profiles = new Map([['auth-a', '빛의트레이너'], ['auth-b', '다른트레이너']])
let holdSave = false, releaseSave, failSave = false, wrongUid = false
try {
  await server.listen()
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`
  const html = await server.transformIndexHtml('/nickname-auth.html', '<html><body><div id="root"></div><script type="module" src="/nickname-auth-entry.js"></script></body></html>')
  browser = await chromium.launch({ executablePath: await resolveChromiumExecutable(chromium), headless: true })
  context = await browser.newContext()
  await context.route('**/*', async route => {
    if (!route.request().url().startsWith(origin)) { external.push(route.request().url()); return route.abort() }
    return route.continue()
  })
  await context.route('**/nickname-auth.html', route => route.fulfill({ contentType: 'text/html', body: html }))
  await context.route('**/api/account', async route => {
    const body = route.request().postDataJSON(), token = route.request().headers().authorization
    const uid = token === 'Bearer nickname-auth-a-token' ? 'auth-a' : token === 'Bearer nickname-auth-b-token' ? 'auth-b' : null
    assert(uid, 'SDK-bound account token required')
    assert.equal(body.ownerId, 'nickname-owner-1234567890')
    requests.push({ uid, ...body })
    if (body.action === 'setNickname') {
      if (holdSave) await new Promise(resolve => { releaseSave = resolve })
      if (failSave) return route.fulfill({ status: 503, json: { error: { code: 'UNAVAILABLE', message: '닉네임 저장 서버 오류' } } })
      profiles.set(uid, body.nickname)
    } else assert.equal(body.action, 'ensureProfile')
    return route.fulfill({ json: { profile: { uid: wrongUid ? 'someone-else' : uid, nickname: profiles.get(uid) } } })
  })
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`${origin}/nickname-auth.html`)
  await page.waitForFunction(() => window.__nicknameAuth?.ready && window.__nicknameAuth.user?.nickname === '빛의트레이너')
  assert.equal(await page.locator('#original').innerText(), '김본명')
  assert.equal(await page.locator('#name').innerText(), '빛의트레이너')
  results.push('profile restored before admission without modifying Google name')

  await page.evaluate(() => window.__nicknameAuth.setNickname('새트레이너'))
  await page.waitForFunction(() => document.querySelector('#name').textContent === '새트레이너')
  await page.reload()
  await page.waitForFunction(() => window.__nicknameAuth?.user?.nickname === '새트레이너')
  results.push('save is authenticated and survives a fresh login/profile load')

  failSave = true
  assert.match(await page.evaluate(() => window.__nicknameAuth.setNickname('저장실패').catch(e => e.message)), /서버 오류/)
  assert.equal(await page.locator('#name').innerText(), '새트레이너')
  failSave = false
  results.push('server failure preserves the last confirmed nickname')

  wrongUid = true
  assert.match(await page.evaluate(() => window.__nicknameAuth.setNickname('잘못된응답').catch(e => e.message)), /결과를 확인하지/)
  assert.equal(await page.locator('#name').innerText(), '새트레이너')
  wrongUid = false
  results.push('a profile response for another UID is rejected')

  await page.evaluate(() => window.__nicknameAuth.setNickname(''))
  await page.waitForFunction(() => document.querySelector('#name').textContent === '김**')
  assert.equal(await page.locator('#original').innerText(), '김본명')
  results.push('clearing restores masked original identity')

  holdSave = true
  await page.evaluate(() => { window.__pendingNickname = window.__nicknameAuth.setNickname('지연별명').catch(e => e.message) })
  for (let attempt = 0; !releaseSave && attempt < 300; attempt++) await new Promise(resolve => setTimeout(resolve, 10))
  assert(releaseSave, 'The controlled save must reach the local HTTP handler')
  assert.match(await page.evaluate(() => window.__nicknameAuth.setNickname('중복저장').catch(e => e.message)), /진행 중/)
  await page.evaluate(() => window.__changeNicknameAuthUser('auth-b'))
  await page.waitForFunction(() => window.__nicknameAuth.user?.uid === 'auth-b' && window.__nicknameAuth.user.nickname === '다른트레이너')
  releaseSave()
  assert.match(await page.evaluate(() => window.__pendingNickname), /계정이 변경/)
  assert.equal(await page.locator('#name').innerText(), '다른트레이너')
  results.push('duplicate saves and a delayed old-account response cannot change the new account')
  const guest = await page.evaluate(() => window.__guestNickname())
  assert.equal(guest.nickname, '')
  assert.equal(guest.displayName, 'guest-123456')
  results.push('guest profiles ignore custom nickname data')
  assert.deepEqual(errors, [])
  assert.deepEqual(external, [])
  console.log(`${results.length}/${results.length} nickname authentication/lifetime checks passed; browser errors 0, external requests 0`)
} finally {
  releaseSave?.()
  await context?.close()
  await browser?.close()
  await server.close()
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ results, errors, requests, external }, null, 2))
}
