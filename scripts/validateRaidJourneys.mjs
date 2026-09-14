import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import test from 'node:test'
import { createMemoryRankedStore } from '../server/rankedStore.js'
import { createAccountRaidPokemonResolver } from '../server/accountService.js'
import { createRaidService } from '../server/raidService.js'
import { createRaidHttpHandler } from '../server/raidHttp.js'
import * as engine from '../server/raidBattle.js'
import { normalizePokemon, getLearnableMoves, getMoveById } from '../src/data/trainingData.js'

// Actual HTTP Request/Response adapter + authoritative account resolver + real
// battle engine. The isolated in-memory DB/authenticator are test-only; no
// production account, DB, environment or force-HP endpoint is touched.
const loadouts = {
  // The solo case must exercise stage two even when its random AI partners
  // share a weakness. This legal Psychic/Ice set clears the Poison prelude.
  mewtwo: [150, ['psystrike', 'icebeam', 'shadowball', 'protect']],
  hooh: [382, ['originpulse', 'waterspout', 'icebeam', 'thunder']],
  lugia: [1008, ['electrodrift', 'thunderbolt', 'calmmind', 'protect']],
}
const reports = []
const summary = battle => ({ phase: battle.phase, turn: battle.turn,
  allies: battle.player.team.map(p => [p.actorId, p.hp, p.maxHp, p.fainted]),
  enemies: battle.opponent.team.map(p => [p.actorId, p.hp, p.maxHp, p.raidForm ?? null]),
  gates: battle.raid.firedMechanics, weather: battle.raid.weatherLock })

for (const [bossId, [speciesId, moveIds]] of Object.entries(loadouts)) for (const humans of [1, 2, 3]) {
  test(`HTTP journey: ${bossId}, ${humans} humans, owned selection through two stages and final receipts`, async () => {
    const seed = `journey-${bossId}-${humans}-v1`
    let time = 1_000_000, requestSerial = 0, serverSerial = 0, seedSerial = 0
    const store = createMemoryRankedStore(), accounts = createMemoryRankedStore()
    const identities = Array.from({ length: humans }, (_, i) => ({ uid: `journey-private-user-${i}`, name: `비공개이름${i}`, isGuest: false }))
    const legal = new Set(getLearnableMoves(speciesId).map(m => m.id))
    moveIds.forEach(id => assert(legal.has(id), `${speciesId} illegal move ${id}`))
    await accounts.transaction(tx => {
      identities.forEach((identity, i) => tx.set('gameData', identity.uid, { revision: `owned-save-${i}`, payload: {
        'champions-dex-v2': JSON.stringify([normalizePokemon({ speciesId, captureId: `owned-raid-${i}`, moves: moveIds.map(id => getMoveById(id).name) })]),
        'champions-battle-items-v1': '{}',
      } }))
    })
    const savesBefore = await accounts.inspect()
    const options = { store, engine, resolvePokemon: createAccountRaidPokemonResolver(accounts), now: () => time,
      newId: () => `journey-server-${++serverSerial}`, makeSeed: () => `${seed}:${++seedSerial}` }
    let service = createRaidService(options)
    const handler = createRaidHttpHandler({ enabled: true, service: { execute: (...args) => service.execute(...args) }, now: () => time,
      authenticate: async (_request, token) => {
        const identity = identities.find((_, i) => token === `journey-bearer-${i}`)
        if (!identity) throw Object.assign(new Error('Invalid fixture token'), { code: 'UNAUTHENTICATED', status: 401 })
        return identity
      } })
    const latencies = [], cursors = Array(humans).fill(0)
    async function request(i, action, payload = {}) {
      const read = action === 'status'
      const query = read ? `?action=status${payload.raidId ? `&raidId=${payload.raidId}` : ''}` : ''
      const start = performance.now()
      const response = await handler(new Request(`http://127.0.0.1/api/raid${query}`, {
        method: read ? 'GET' : 'POST', headers: { authorization: `Bearer journey-bearer-${i}`, 'content-type': 'application/json' },
        ...(read ? {} : { body: JSON.stringify({ ...payload, action, requestId: payload.requestId ?? `journey-request-${++requestSerial}` }) }),
      }))
      latencies.push(performance.now() - start)
      const body = await response.json()
      assert.equal(response.status, 200, `${seed} ${action}: ${JSON.stringify(body)}`)
      const serialized = JSON.stringify(body)
      for (const identity of identities) assert(!serialized.includes(identity.uid), 'Raw account UID in public response')
      for (const secret of ['journey-bearer', 'summonPool', 'reviveOrder', 'commandsByOwner', 'codeHash']) assert(!serialized.includes(secret), secret)
      if (body.raid) { assert(body.raid.eventCursor >= cursors[i]); cursors[i] = body.raid.eventCursor }
      return body
    }
    let snapshot = await request(0, 'roomCreate', { bossId, visibility: 'public', title: '협동 여정 검증' })
    const roomId = snapshot.room.id
    for (let i = 1; i < humans; i++) {
      const listed = await request(i, 'status')
      await request(i, 'roomJoin', { roomId, roomRevision: listed.rooms.find(room => room.id === roomId).roomRevision })
    }
    for (let i = 0; i < humans; i++) {
      snapshot = await request(i, 'status')
      await request(i, 'roomReady', { roomId, roomRevision: snapshot.room.roomRevision, ready: true, pokemon: { captureId: `owned-raid-${i}` } })
    }
    snapshot = await request(0, 'status')
    snapshot = await request(0, 'roomStart', { roomId, roomRevision: snapshot.room.roomRevision })
    const raidId = snapshot.raid.id, stages = new Set([snapshot.raid.phase]), seenGates = new Set()
    let restarted = false
    for (let step = 0; step < 125 && snapshot.raid; step++) {
      time += 11_000
      const views = await Promise.all(identities.map((_, i) => request(i, 'status')))
      for (const view of views) assert.deepEqual(summary(view.raid.battle), summary(views[0].raid.battle), 'All member projections must share HP/forms/turn')
      stages.add(views[0].raid.phase)
      assert.notEqual(views[0].raid.lifecycle, 'intermission', 'The boss stage starts without a manual advance request')
      const stored = await store.transaction(tx => tx.get('raidRuns', raidId))
      stored.battle.raid.firedMechanics.forEach(gate => seenGates.add(gate))
      // Recreate the service during a real run, preserving only persisted DB
      // state; no closure caches or battle objects survive this boundary.
      if (!restarted && step >= 2) {
        const before = await request(0, 'status')
        service = createRaidService(options)
        assert.deepEqual(await request(0, 'status'), before)
        restarted = true
      }
      const commands = identities.flatMap((identity, i) => {
        const command = engine.chooseRaidCommand(stored.battle, identity.uid, { seed: `${seed}:input:${step}:${i}` })
        return command ? [{ i, command, view: views[i].raid }] : []
      })
      await Promise.all(commands.map(({ i, command, view }) => request(i, 'raidSubmit', {
        raidId, decisionToken: view.decisionToken, commandVersion: (view.ownCommandVersion ?? 0) + 1, command,
      })))
      snapshot = await request(0, 'status')
      if (snapshot.raid?.lifecycle === 'input' && snapshot.raid.turnNumber === stored.turnNumber) {
        // All surviving actors may be NPCs. Only an explicit authenticated
        // advance/heartbeat resolves that turn; GET itself must never do so.
        time += 46_000
        snapshot = await request(0, 'raidAdvance', { raidId, decisionToken: snapshot.raid.decisionToken })
      }
    }
    assert(!snapshot.raid, `${seed} did not terminate`)
    assert.deepEqual([...stages], [1, 2], `${seed} must reach the real boss stage`)
    assert(['win', 'loss'].includes(snapshot.result?.outcome), 'A terminal result must be projected')
    const final = await store.transaction(tx => tx.get('raidRuns', raidId))
    assert.equal(final.lifecycle, 'finished')
    assert.equal(final.battle.raid.members.filter(m => m.isNpc).length, 3 - humans)
    assert.equal(await store.transaction(tx => tx.get('raidRooms', roomId)), null)
    const won = snapshot.result.outcome === 'win'
    for (let i = 0; i < humans; i++) {
      const first = await request(i, 'status'), again = await request(i, 'status')
      assert.deepEqual(first, again, 'Result polling must be read-only and idempotent')
      assert.equal(first.result.outcome, snapshot.result.outcome)
      assert.equal(first.rewards.total, won ? 800 : 0)
      assert.equal(first.conflicts.activeRaidId, null)
      assert.equal(first.result.raidId, raidId, 'Result-only recovery must retain the close target id')
      assert.equal(first.result.humanCount, humans, 'Result-only recovery counts human trainers separately')
      assert.equal(first.result.npcCount, 3 - humans, 'Result-only recovery retains the NPC slot count')
      await request(i, 'raidDismissResult', { raidId: first.result.raidId })
      assert.equal((await request(i, 'status')).result, null)
    }
    assert.deepEqual(await accounts.inspect(), savesBefore, 'Raid forms/HP/PP/items must never mutate owned Pokemon')
    const sorted = latencies.toSorted((a, b) => a - b)
    const record = { seed, bossId, humans, stages: [...stages], outcome: snapshot.result.outcome,
      totalTurns: final.battle.raid.totalTurns, gatesSeen: [...seenGates], requests: latencies.length,
      p50Ms: +sorted[Math.floor(sorted.length * .5)].toFixed(2), p95Ms: +sorted[Math.floor(sorted.length * .95)].toFixed(2) }
    reports.push(record)
    console.log(JSON.stringify(record))
    const output = new URL('./.cache/raid-journeys/', import.meta.url)
    mkdirSync(output, { recursive: true })
    writeFileSync(new URL('results.json', output), JSON.stringify({ environment: `Node ${process.version}, HTTP adapter, isolated memory stores and synthetic authenticated identities; no production OAuth/DB`, reports }, null, 2))
  })
}
