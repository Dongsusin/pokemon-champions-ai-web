import { applyRaidPresentation } from './data/raidPresentation.js'

const sequence = event => Number(String(event?.id ?? '').split(':').at(-1))
export const raidPlaybackVersion = raid => `${raid?.id ?? ''}:${raid?.publicVersion ?? raid?.revision ?? 0}:${raid?.battle?.raid?.eventSequence ?? ''}`

export function raidEventCue(event) {
  if (!event) return null
  const phase = event.cuePhase === 'announce' ? 'attack'
    : event.cuePhase === 'mechanic' ? (event.form ? 'form' : 'gimmick') : event.cuePhase
  if (event.kind === 'battle-cue') return { ...event, phase, mechanicId: event.gimmickId ?? event.mechanicId ?? event.form }
  if (event.kind === 'boss-mechanic' || event.kind === 'summon') {
    const actor = event.presentation?.actors?.find(actor => actor.actorId === event.actorId)
    return { ...event, phase: event.kind === 'summon' ? 'switch' : 'form', mechanicId: event.form ?? 'raid',
      sideId: event.sideId ?? actor?.sideId ?? 'opponent', actorSlot: event.actorSlot ?? actor?.slot ?? 0,
      actorName: event.actorName ?? actor?.name, mechanicLabel: event.message }
  }
  return { ...event, phase: 'message' }
}

// This queue only presents public server results. It never chooses an action,
// calculates damage, advances the server turn, or changes an account reward.
export function createRaidBattlePlayback({ publish, duration = () => 400, schedule = setTimeout, unschedule = clearTimeout } = {}) {
  let latest = null
  let view = { raidId: null, battle: null, events: [], cue: null, playing: false, readyVersion: null }
  let seen = new Set()
  let lastSequence = 0
  let queue = []
  let timer = null
  let disposed = false
  const emit = () => { if (!disposed) publish?.(view) }
  const stop = () => { if (timer !== null) unschedule(timer); timer = null; queue = [] }
  const settle = () => {
    view = { raidId: latest?.id ?? null, battle: latest?.battle ?? null,
      events: [...(latest?.events ?? latest?.battle?.raid?.events ?? [])], cue: null, playing: false,
      readyVersion: raidPlaybackVersion(latest) }
    emit()
  }
  const advance = () => {
    timer = null
    if (disposed) return
    const event = queue.shift()
    if (!event) { settle(); return }
    const cue = raidEventCue(event)
    view = { ...view, battle: applyRaidPresentation(view.battle, event.presentation),
      events: [...view.events, event].slice(-80), cue, playing: true }
    emit()
    timer = schedule(advance, Math.max(0, duration(cue)))
  }
  return {
    receive(raid) {
      if (disposed) return
      const nextId = raid?.id ?? null
      const events = raid?.events ?? raid?.battle?.raid?.events ?? []
      if (view.raidId !== nextId || !latest) {
        stop()
        latest = raid
        seen = new Set(events.map(event => event.id))
        lastSequence = Math.max(0, ...events.map(sequence).filter(Number.isFinite))
        settle()
        return
      }
      latest = raid
      const fresh = events.filter(event => !seen.has(event.id))
      for (const event of fresh) seen.add(event.id)
      if (seen.size > 240) seen = new Set([...seen].slice(-160))
      // Event retention is bounded. A reconnect beyond that window restores
      // the authoritative current state instead of replaying incomplete HP.
      const first = sequence(fresh[0])
      const gap = fresh.length && lastSequence > 0 && Number.isFinite(first) && first > lastSequence + 1
      lastSequence = Math.max(lastSequence, ...fresh.map(sequence).filter(Number.isFinite))
      if (gap) { stop(); settle(); return }
      if (fresh.length) queue.push(...fresh)
      if (timer === null) {
        if (queue.length) advance()
        else settle()
      }
    },
    finish() { stop(); settle() },
    dispose() { disposed = true; stop() },
    getSnapshot() { return view },
  }
}
