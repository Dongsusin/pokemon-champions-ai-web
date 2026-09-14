import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft, Check, ChevronRight, Clock3, Crown, Flag, HeartPulse, KeyRound,
  Info, LoaderCircle, LockKeyhole, Play, Plus, RefreshCw, Shield, Sparkles, Swords,
  UsersRound, Wifi, WifiOff, X, ScrollText,
} from 'lucide-react'
import PokemonSprite from './PokemonSprite'
import SpriteImage from './SpriteImage'
import BattleItemSprite from './BattleItemSprite'
import FactoryInfoTooltip from './FactoryInfoTooltip'
import { firebaseAuth } from './auth/firebaseClient'
import { createBattleAudio } from './battleAudio'
import { RAID_BOSSES } from './data/raidRules'
import { getAbility, getMove, getSpeciesProfile, typeClassName } from './data/trainingData'
import { getBattleItem } from './data/shopData'
import { createRaidClient, createRaidRequestId, isRaidEnabled, isRaidLocalTest } from './raidClient'
import './raid.css'
import './raidStandardBattle.css'
import RaidBattleStage from './RaidBattleStage'
import RaidBattleCommands from './RaidBattleCommands'
import { turnStepDuration } from './BattleScreen'
import { raidPlaybackVersion } from './raidBattlePlayback'
import useRaidBattlePlayback from './useRaidBattlePlayback'

const EMPTY = Object.freeze({ catalog: null, rooms: [], room: null, raid: null, result: null, rewards: null, conflicts: null })
const LOCAL_IDENTITY_KEY = 'champions-raid-test-identity-v1'
const BOSS_COLORS = { mewtwo: '#ba8cff', hooh: '#ffb45e', lugia: '#7fdcf9' }
const OWNED_ROOM_STATUSES = new Set(['lobby', 'waiting', 'ready', 'starting'])
const NPC_ROLE_LABELS = Object.freeze({ attack: '공격 지원', support: '회복 · 지원' })
const RAID_STAT_LABELS = Object.freeze({
  attack: '공격', defense: '방어', specialAttack: '특공', specialDefense: '특방',
  speed: '스피드', accuracy: '명중', evasion: '회피',
})

const timeValue = value => typeof value === 'number' ? value : Date.parse(value)
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value ?? {}, key)
const actorId = (actor, fallback) => String(actor?.actorId ?? actor?.battleId ?? actor?.id ?? actor?.slotId ?? fallback ?? '')
const asArray = value => Array.isArray(value) ? value : []
const clockText = seconds => `${Math.floor(Math.max(0, seconds) / 60)}:${String(Math.max(0, seconds) % 60).padStart(2, '0')}`

function hpTransitionDuration(speed) {
  if (speed === 'instant') return 0
  if (speed === 'fast') return 160
  if (speed === 'slow') return 800
  return 350
}

function useReducedMotion() {
  const query = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)') : null
  const [reduced, setReduced] = useState(() => Boolean(query()?.matches))
  useEffect(() => {
    const media = query()
    if (!media) return undefined
    const update = () => setReduced(media.matches)
    update()
    media.addEventListener?.('change', update)
    return () => media.removeEventListener?.('change', update)
  }, [])
  return reduced
}

function initialIdentity() {
  if (!isRaidLocalTest) return 'alice'
  try {
    const saved = window.sessionStorage.getItem(LOCAL_IDENTITY_KEY)
    return ['alice', 'bob', 'charlie'].includes(saved) ? saved : 'alice'
  } catch {
    return 'alice'
  }
}

function mergeRaidEvents(previous, incoming) {
  const merged = []
  const ids = new Set()
  for (const event of [...asArray(previous), ...asArray(incoming)]) {
    const id = String(event?.id ?? `${event?.turn ?? ''}:${event?.kind ?? ''}:${event?.message ?? ''}`)
    if (ids.has(id)) continue
    ids.add(id)
    merged.push(event)
  }
  return merged.slice(-80)
}

function mergeRaidProjection(previous, incoming) {
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return incoming
  if (!previous || previous.id !== incoming.id) return incoming
  const previousCommandVersion = Number.isSafeInteger(previous.ownCommandVersion) ? previous.ownCommandVersion : 0
  const incomingCommandVersion = Number.isSafeInteger(incoming.ownCommandVersion) ? incoming.ownCommandVersion : 0
  // A same-revision retry can arrive after the command response. Keep the
  // newest local command marker so an old header cannot re-enable a move.
  const staleOwnCommand = incomingCommandVersion < previousCommandVersion
  const commandFence = staleOwnCommand ? {
    ownCommandVersion: previousCommandVersion,
    pendingSubmitted: previous.pendingSubmitted,
    submitted: previous.submitted,
    actionSubmitted: previous.actionSubmitted,
  } : {}
  if (!incoming.unchanged) return { ...incoming, ...commandFence }
  // Compact status headers intentionally omit battle data. Keep the last
  // engine-safe projection while refreshing public command/presence state.
  return {
    ...previous,
    ...incoming,
    battle: incoming.battle ?? previous.battle,
    events: mergeRaidEvents(previous.events, incoming.events),
    ...commandFence,
  }
}

function mergeSnapshot(current, response) {
  const currentRaid = current?.raid
  const incomingRaid = response?.raid
  // A late compact/full poll from the same raid must never roll a newer turn
  // or HP projection backwards after an action response has already arrived.
  const currentPublicVersion = Number.isSafeInteger(currentRaid?.publicVersion) ? currentRaid.publicVersion : currentRaid?.revision
  const incomingPublicVersion = Number.isSafeInteger(incomingRaid?.publicVersion) ? incomingRaid.publicVersion : incomingRaid?.revision
  if (currentRaid?.id && incomingRaid?.id && currentRaid.id === incomingRaid.id
    && Number.isSafeInteger(currentPublicVersion) && Number.isSafeInteger(incomingPublicVersion)
    && incomingPublicVersion < currentPublicVersion) return current
  const next = { ...current }
  for (const key of ['catalog', 'rooms', 'room', 'raid', 'result', 'rewards', 'conflicts']) {
    if (!hasOwn(response, key)) continue
    next[key] = key === 'raid' ? mergeRaidProjection(current.raid, response[key]) : response[key]
  }
  // A completed raid sometimes returns only result/rewards. Keep the last
  // projection until dismissing it so the outcome has a stable backdrop.
  if (response?.raid === null && response?.result && current.raid) next.raid = current.raid
  return next
}

function catalogBosses(catalog) {
  const remote = asArray(catalog?.bosses ?? catalog?.items ?? catalog)
  const indexed = new Map(remote.map(entry => [entry.id, entry]))
  return RAID_BOSSES.map(boss => ({ ...boss, ...(indexed.get(boss.id) ?? {}) }))
}

function getActorProfile(actor) {
  return getSpeciesProfile(actor?.speciesId ?? actor?.species?.id ?? actor?.pokemon?.speciesId ?? actor?.id)
}

function actorName(actor, fallback = '포켓몬') {
  return actor?.name ?? actor?.pokemon?.name ?? getActorProfile(actor)?.name ?? actor?.displayName ?? fallback
}

function actorTypes(actor) {
  return asArray(actor?.types ?? actor?.pokemon?.types ?? getActorProfile(actor)?.types)
}

function actorHp(actor) {
  const hp = Number(actor?.hp ?? actor?.currentHp ?? actor?.pokemon?.hp ?? actor?.health ?? 0)
  const maxHp = Number((actor?.maxHp ?? actor?.maxHealth ?? actor?.pokemon?.maxHp ?? actor?.pokemon?.stats?.hp ?? hp) || 1)
  return { hp: Math.max(0, hp), maxHp: Math.max(1, maxHp), percent: Math.max(0, Math.min(100, (Math.max(0, hp) / Math.max(1, maxHp)) * 100)) }
}

function actorSprite(actor, side) {
  const profile = getActorProfile(actor)
  const useBack = side === 'ally'
  const isShiny = Boolean(actor?.isShiny ?? actor?.pokemon?.isShiny)
  return {
    src: actor?.[useBack ? 'spriteBack' : 'spriteFront'] ?? actor?.sprite ?? actor?.pokemon?.[useBack ? 'spriteBack' : 'spriteFront']
      ?? (isShiny ? profile?.[useBack ? 'spriteBackShiny' : 'spriteFrontShiny'] : profile?.[useBack ? 'spriteBack' : 'spriteFront']),
    fallback: actor?.[useBack ? 'spriteBackFallback' : 'spriteFrontFallback'] ?? actor?.pokemon?.[useBack ? 'spriteBackFallback' : 'spriteFrontFallback']
      ?? (isShiny ? profile?.[useBack ? 'spriteBackShinyFallback' : 'spriteFrontShinyFallback'] : profile?.[useBack ? 'spriteBackFallback' : 'spriteFrontFallback']),
  }
}

function activeActors(battle, side) {
  const directKey = side === 'ally' ? 'allies' : 'enemies'
  if (Array.isArray(battle?.[directKey])) return battle[directKey]
  const stateSide = battle?.[side === 'ally' ? 'player' : 'opponent']
  if (Array.isArray(stateSide?.active)) return stateSide.active
  const team = asArray(stateSide?.team)
  const activeIndexes = asArray(stateSide?.activeIndexes)
  return activeIndexes.length ? activeIndexes.map(index => team[index]).filter(Boolean) : team.filter(actor => actor?.active !== false).slice(0, 3)
}

function moveName(move) { return move?.displayName ?? move?.name ?? move?.move?.name ?? '기술' }
function moveType(move) { return move?.type ?? move?.move?.type ?? '노말' }
function movePp(move) { return `${move?.pp ?? move?.currentPp ?? '—'} / ${move?.maxPp ?? move?.maxPP ?? '—'}` }

function actorStatus(actor) {
  const status = actor?.status ?? actor?.majorStatus ?? actor?.pokemon?.status
  if (!status || status === 'none') return null
  return typeof status === 'string' ? status : status.label ?? status.name ?? status.id
}

function actorStatStages(actor) {
  const stages = actor?.statStages ?? actor?.pokemon?.statStages
  if (!stages || typeof stages !== 'object' || Array.isArray(stages)) return []
  return Object.entries(RAID_STAT_LABELS).flatMap(([key, label]) => {
    const stage = Number(stages[key] ?? 0)
    return Number.isFinite(stage) && stage !== 0 ? [{ key, label, stage: Math.max(-6, Math.min(6, Math.trunc(stage))) }] : []
  })
}

function StatStageBadges({ actor, className = '' }) {
  const stages = actorStatStages(actor)
  if (!stages.length) return null
  return <div className={`raid-stat-stages ${className}`.trim()} aria-label={`${actorName(actor)} 능력 변화`}>
    {stages.map(({ key, label, stage }) => <span className={stage > 0 ? 'raised' : 'lowered'} key={key}>{label}{stage > 0 ? '+' : ''}{stage}</span>)}
  </div>
}

function heldItemFor(actor) {
  const heldItemId = actor?.heldItemId ?? actor?.pokemon?.heldItemId
  const item = getBattleItem(heldItemId)
  const name = actor?.heldItemName ?? actor?.pokemon?.heldItemName ?? item?.name ?? ''
  return { item, name }
}

function MoveDetails({ move, className = '' }) {
  const name = moveName(move)
  const catalogMove = getMove(name)
  const description = move?.description ?? catalogMove?.description
  const category = move?.category ?? catalogMove?.category ?? '—'
  const power = move?.power ?? catalogMove?.power ?? '—'
  const accuracy = move?.accuracy ?? move?.accuracyLabel ?? catalogMove?.accuracyLabel ?? catalogMove?.accuracy ?? '—'
  return <FactoryInfoTooltip title={name} description={description}
    meta={`${moveType(move)} · ${category} · 위력 ${power || '—'} · 명중 ${accuracy || '—'} · PP ${movePp(move)}`}>
    <span className={`raid-detail-anchor ${className}`} role="button" aria-label={`${name} 기술 설명`}><Info size={13} /> 정보</span>
  </FactoryInfoTooltip>
}

function ActorLoadoutDetails({ actor }) {
  const abilityName = actor?.ability ?? actor?.pokemon?.ability
  const ability = getAbility(abilityName)
  const { item, name: itemName } = heldItemFor(actor)
  if (!abilityName && !itemName) return null
  return <div className="raid-actor-loadout" aria-label={`${actorName(actor)}의 장비와 특성`}>
    {abilityName && <FactoryInfoTooltip title={abilityName} description={ability?.description} meta={ability?.trigger ? `발동 조건 · ${ability.trigger}` : undefined}>
      <span className="raid-detail-anchor" role="button" aria-label={`${abilityName} 특성 설명`}><Sparkles size={12} /> {abilityName}</span>
    </FactoryInfoTooltip>}
    {itemName && <FactoryInfoTooltip title={itemName} description={item?.description ?? item?.effect ?? '현재 지니고 있는 도구입니다.'}>
      <span className="raid-detail-anchor" role="button" aria-label={`${itemName} 도구 설명`}>{item && <BattleItemSprite item={item} size={15} draggable="false" />} {itemName}</span>
    </FactoryInfoTooltip>}
  </div>
}

function PokemonLoadoutPreview({ pokemon }) {
  if (!pokemon) return null
  const abilityName = pokemon.ability
  const ability = getAbility(abilityName)
  const item = getBattleItem(pokemon.heldItemId)
  const moves = asArray(pokemon.moves).map(move => typeof move === 'string' ? getMove(move) : move).filter(Boolean)
  return <section className="raid-loadout-preview" aria-label="선택 포켓몬 상세 정보">
    <header><Info size={14} /> 탭하거나 포인터를 올려 상세 효과를 확인하세요</header>
    <div className="raid-loadout-meta">
      {abilityName && <FactoryInfoTooltip title={abilityName} description={ability?.description} meta={ability?.trigger ? `발동 조건 · ${ability.trigger}` : undefined}><span role="button" aria-label={`${abilityName} 특성 설명`}><Sparkles size={13} /> 특성 · {abilityName}</span></FactoryInfoTooltip>}
      <FactoryInfoTooltip title={item?.name ?? pokemon.heldItemName ?? '지닌 도구 없음'} description={item?.description ?? item?.effect ?? (pokemon.heldItemName ? '현재 지니고 있는 도구입니다.' : '')}><span role="button" aria-label="지닌 도구 설명">{item && <BattleItemSprite item={item} size={16} draggable="false" />} 도구 · {item?.name ?? pokemon.heldItemName ?? '없음'}</span></FactoryInfoTooltip>
    </div>
    {moves.length > 0 && <div className="raid-loadout-moves">{moves.map((move, index) => <MoveDetails key={`${move?.id ?? move?.name ?? index}-${index}`} move={move} />)}</div>}
  </section>
}

function phaseLabel(raid) {
  const phase = String(raid?.phase ?? raid?.battle?.raid?.phase ?? raid?.stage ?? '')
  if (phase === '1' || phase === 'stage1' || phase === 'vanguard' || phase === 'prelude') return '1단계 · 전초전'
  if (phase === '2' || phase === 'stage2' || phase === 'boss' || phase === 'final') return '2단계 · 보스전'
  return raid?.stageLabel ?? '보스전 진행 중'
}

function isFinished(raid, result) {
  return Boolean(result) || ['finished', 'complete', 'completed', 'failed', 'withdrawn', 'cancelled'].includes(String(raid?.lifecycle ?? raid?.status ?? '').toLowerCase())
}

function isLive(raid, result) { return Boolean(raid) && !isFinished(raid, result) }

function isBossActor(actor, raid) {
  return Boolean(actor?.isBoss || actor?.raidBoss || actor?.boss || actorId(actor) === String(raid?.primaryBossId ?? raid?.battle?.raid?.primaryBossId ?? raid?.bossActorId ?? ''))
}

function bossVisual(boss) {
  const phase = boss?.raidForm ?? boss?.form ?? boss?.raidFormId
  if (phase === 'armored') return { front: '/assets/pokemon/skins/armored-mewtwo-front.gif', back: '/assets/pokemon/skins/armored-mewtwo-back.gif', aura: 'armored' }
  if (phase === 'dark') return { front: '/assets/pokemon/skins/shadow-lugia-sheet.png#front', aura: 'dark' }
  return null
}

function BossCard({ boss, selected, onClick }) {
  const profile = getSpeciesProfile(boss.speciesId)
  const color = BOSS_COLORS[boss.id] ?? '#83eaff'
  const contents = <>
    <span className="raid-boss-card-glow" style={{ '--boss-color': color }} aria-hidden="true" />
    <span className="raid-boss-card-number">0{RAID_BOSSES.findIndex(entry => entry.id === boss.id) + 1}</span>
    <SpriteImage src={boss.spriteFront ?? profile?.spriteFront} fallbackSrc={boss.spriteFrontFallback ?? profile?.spriteFrontFallback} alt="" draggable="false" />
    <small>CO-OP BOSS RAID</small><h2>{boss.name}</h2><p>{boss.subtitle}</p>
    <span className="raid-boss-gates">{Object.entries(boss.gates ?? {}).sort(([left], [right]) => Number(right) - Number(left)).map(([gate, label]) => <span key={gate}><b>{gate}%</b>{label}</span>)}</span>
    <strong>도전 준비 <ChevronRight size={18} /></strong>
  </>
  return onClick ? <button type="button" className={`raid-boss-card${selected ? ' selected' : ''}`} style={{ '--boss-color': color }} onClick={onClick}>{contents}</button>
    : <article className="raid-boss-card" style={{ '--boss-color': color }}>{contents}</article>
}

function HpBar({ actor, className = '', transitionMs }) {
  const hp = actorHp(actor)
  return <div className={`raid-hp${className}`} aria-label={`${actorName(actor)} HP ${Math.ceil(hp.percent)}%`}>
    <span style={transitionMs === undefined ? undefined : { '--raid-hp-transition': `${transitionMs}ms` }}><i style={{ width: `${hp.percent}%` }} /></span><small>{Math.max(0, Math.ceil(hp.hp)).toLocaleString()} / {Math.max(1, Math.ceil(hp.maxHp)).toLocaleString()}</small>
  </div>
}

function RaidActor({ actor, side, own = false, npc = false, boss = false, submitted = false, waiting = false, aiControlled = false, hpTransitionMs }) {
  if (!actor) return <div className={`raid-actor-card ${side} empty`}><span>빈 슬롯</span></div>
  const sprite = actorSprite(actor, side)
  const status = actorStatus(actor)
  const fainted = actor?.fainted || actorHp(actor).hp <= 0
  const visual = boss ? bossVisual(actor) : null
  const controlStatus = fainted ? '기절' : aiControlled ? 'AI 대행' : submitted ? '명령 완료' : waiting ? '대기 중' : ''
  return <article className={`raid-actor-card ${side}${own ? ' own' : ''}${npc ? ' npc' : ''}${boss ? ' boss' : ''}${fainted ? ' fainted' : ''}${visual?.aura ? ` aura-${visual.aura}` : ''}`}>
    <div className="raid-actor-status"><span>{own ? 'YOU' : npc ? 'NPC' : actor?.displayName ?? actor?.ownerName ?? actor?.trainerName ?? 'ALLY'}</span>{controlStatus && <b className={waiting ? 'waiting' : ''}>{submitted && <Check size={13} />}{controlStatus}</b>}</div>
    <PokemonSprite animatedSrc={visual?.[side === 'ally' ? 'back' : 'front'] ?? sprite.src} fallbackSrc={sprite.fallback} className="raid-live-sprite" frameClassName="raid-live-sprite-frame" alt={actorName(actor)} draggable="false" />
    <div className="raid-actor-copy"><strong>{actorName(actor)}</strong><small>{actorTypes(actor).map(type => <i className={`type-${typeClassName(type)}`} key={type}>{type}</i>)}</small>{status && <em>{status}</em>}<HpBar actor={actor} transitionMs={hpTransitionMs} /></div>
    {(own || boss) && <ActorLoadoutDetails actor={actor} />}
    {(own || boss) && <StatStageBadges actor={actor} />}
  </article>
}

function RaidBossHp({ actor, raid, hpTransitionMs }) {
  const hp = actorHp(actor)
  const label = actorName(actor, '보스')
  const raidView = raid?.battle?.raid ?? raid
  const vitality = actor?.raidVitalityStage ?? raidView?.vitalityStage
  const enrage = actor?.enraged ?? raidView?.enraged
  const weatherLock = raidView?.weatherLock
  const rain = weatherLock?.id === 'rain' || weatherLock === 'rain'
  const suppressed = Boolean(weatherLock?.suppressed ?? weatherLock?.isSuppressed ?? weatherLock?.effectSuppressed)
  const fired = new Set(asArray(raidView?.firedMechanics).map(value => String(value)))
  const gates = RAID_BOSSES.find(entry => entry.id === (raid?.bossId ?? raidView?.bossId))?.gates ?? {}
  return <section className="raid-boss-hp" aria-label={`${label} HP`}>
    <header><span><Crown size={17} /> FINAL BOSS</span><strong>{label}</strong><small>{vitality ? `생명력 ${vitality}단계` : '본체 HP 보호 적용'}</small></header>
    <div className="raid-boss-hp-track" style={hpTransitionMs === undefined ? undefined : { '--raid-hp-transition': `${hpTransitionMs}ms` }}><i style={{ width: `${hp.percent}%` }} />{[25, 50, 75].map(value => <b key={value} style={{ left: `${value}%` }}><span>{value}%</span></b>)}</div>
    <footer><span>{Math.ceil(hp.hp).toLocaleString()} / {Math.ceil(hp.maxHp).toLocaleString()} HP</span><span>{enrage && '격노 · 2회 공격'}{rain && `${enrage ? ' · ' : ''}${suppressed ? '고정 비 · 효과 일시 무효' : '고정 비'}`}</span></footer>
    {(Object.keys(gates).length > 0 || actorStatStages(actor).length > 0) && <div className="raid-boss-mechanics" aria-label="보스 HP 구간 기믹과 능력 변화">{Object.entries(gates).sort(([left], [right]) => Number(right) - Number(left)).map(([threshold, mechanic]) => {
      const active = fired.has(threshold) || fired.has(`gate-${threshold}`) || fired.has(String(mechanic)) || (Number(threshold) === 25 && enrage)
      return <span className={active ? 'active' : ''} key={threshold}><b>{threshold}%</b>{mechanic}</span>
    })}<StatStageBadges actor={actor} className="boss-stat-stages" /></div>}
  </section>
}

function RoomCard({ room, onJoin, busy }) {
  const isPrivate = room.visibility === 'private' || room.locked
  const starting = !OWNED_ROOM_STATUSES.has(String(room.status ?? '').toLowerCase())
  return <article className="raid-room-card">
    <header><span>{isPrivate ? <LockKeyhole size={14} /> : <UsersRound size={14} />}{isPrivate ? '비공개' : '공개'}</span><small>{room.memberCount ?? asArray(room.members).length} / {room.capacity ?? 3}</small></header>
    <strong>{room.title || `${room.hostName ?? '트레이너'}의 보스전`}</strong><p>{room.hostName ?? '트레이너'} · {starting ? '진행 중' : '참가자 대기 중'}</p>
    <button type="button" disabled={busy || starting} onClick={() => onJoin(room)}>{isPrivate ? <><KeyRound size={15} /> 코드로 참가</> : <><Plus size={15} /> 참가하기</>}</button>
  </article>
}

function OwnedPokemonPicker({ pokemon = [], selectedId, onSelect, onClose }) {
  const [query, setQuery] = useState('')
  const filtered = pokemon.filter(entry => String(entry?.name ?? getSpeciesProfile(entry?.speciesId)?.name ?? '').includes(query.trim()))
  return <div className="raid-picker-backdrop" role="presentation"><section className="raid-pokemon-picker" role="dialog" aria-modal="true" aria-labelledby="raid-pokemon-picker-title">
    <header><div><span>ONE POKÉMON RAID ENTRY</span><h2 id="raid-pokemon-picker-title">출전 포켓몬 1마리를 선택하세요</h2></div><button type="button" aria-label="선택창 닫기" onClick={onClose}><X size={20} /></button></header>
    <p>대기 포켓몬으로 교체할 수 없습니다. 선택한 한 마리로 끝까지 함께합니다.</p>
    <input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="포켓몬 이름 검색" aria-label="보유 포켓몬 검색" />
    <div className="raid-owned-grid">{filtered.map(entry => {
      const profile = getSpeciesProfile(entry.speciesId)
      const selected = selectedId === entry.captureId
      return <button type="button" key={entry.captureId} className={selected ? 'selected' : ''} onClick={() => onSelect(entry.captureId)} aria-pressed={selected}>
        <SpriteImage src={entry.spriteFront ?? (entry.isShiny ? profile?.spriteFrontShiny : profile?.spriteFront)} fallbackSrc={profile?.spriteFrontFallback} alt="" draggable="false" />
        <strong>{entry.name ?? profile?.name}</strong><small>Lv.{entry.level ?? 50} · {(entry.types ?? profile?.types ?? []).join(' · ')}</small>{selected && <span><Check size={14} /> 선택</span>}
      </button>
    })}</div>
    {!filtered.length && <div className="raid-picker-empty">보유한 포켓몬을 찾지 못했습니다.</div>}
  </section></div>
}

function RaidInviteCodeDialog({ code, copied, onCopy, onClose }) {
  return <div className="raid-picker-backdrop" role="presentation"><section className="raid-room-dialog raid-invite-dialog" role="dialog" aria-modal="true" aria-labelledby="raid-invite-title">
    <header><div><span>PRIVATE RAID INVITE</span><h2 id="raid-invite-title">초대 코드를 공유하세요</h2></div><button type="button" aria-label="초대 코드 닫기" onClick={onClose}><X size={20} /></button></header>
    <p>비공개 방의 코드는 지금 한 번만 표시됩니다. 참가자는 보스전 방 목록의 <b>초대 코드로 참가</b>에서 입력할 수 있습니다.</p>
    <output className="raid-invite-code" aria-label="초대 코드">{code}</output>
    <button className="raid-primary" type="button" onClick={onCopy}><KeyRound size={17} /> {copied ? '복사됨' : '코드 복사'}</button>
    <small>이 창을 닫으면 코드를 다시 표시할 수 없습니다.</small>
  </section></div>
}

function RaidRoomLobby({ room, boxPokemon, selectedCaptureId, onPick, onReady, onNpcRolesChange, onStart, onLeave, busy, error, connected }) {
  const members = asArray(room?.members)
  const member = members.find(entry => entry?.isOwn)
  const selectedId = member?.selectedPokemon?.captureId ?? member?.selectedPokemonId ?? selectedCaptureId
  // Never let two missing ids match a malformed collection entry. Until the
  // player deliberately picks a capture, show the explicit selection CTA.
  const selected = selectedId ? boxPokemon.find(entry => entry.captureId === selectedId) : null
  const profile = getSpeciesProfile(selected?.speciesId)
  const host = Boolean(member?.isHost || room?.isHost)
  const allReady = members.filter(entry => !entry?.isAi).every(entry => entry?.ready)
  const startLabel = (room?.memberCount ?? members.length) <= 1 ? '솔로로 시작' : '보스전 시작'
  const npcRoles = asArray(room?.npcRoles)
  const npcSlots = asArray(room?.npcSlots)
  const emptySlots = [0, 1, 2].filter(slot => !members.some(entry => Number(entry?.slotId ?? entry?.slot ?? -1) === slot && !entry?.withdrawn))
  const changeNpcRole = (index, role) => {
    const next = emptySlots.map((_, roleIndex) => npcRoles[roleIndex] ?? (roleIndex === 0 ? 'attack' : 'support'))
    next[index] = role
    onNpcRolesChange?.(next)
  }
  return <main className="raid-room-screen">
    <header className="raid-page-header"><button className="screen-back-button" type="button" disabled={busy} onClick={onLeave}><ArrowLeft size={18} /> 보스 선택</button><div><span>CO-OP RAID ROOM</span><h1>{room?.title ?? '보스전 대기실'}</h1></div><aside>{connected ? <><Wifi size={15} /> 연결됨</> : <><WifiOff size={15} /> 복구 중</>}</aside></header>
    {error && <div className="raid-notice error" role="alert">{error}</div>}
    <section className="raid-room-layout">
      <article className="raid-room-members"><header><div><UsersRound size={20} /><strong>참가자 대기실</strong></div><span>{room?.memberCount ?? members.length} / {room?.capacity ?? 3}명</span></header>
        <div className="raid-member-slots">{[0, 1, 2].map(slot => {
          const entry = members.find(candidate => Number(candidate?.slotId ?? candidate?.slot ?? -1) === slot)
          const pokemon = entry?.selectedPokemon
          const memberProfile = getSpeciesProfile(pokemon?.speciesId)
          const npcSlot = npcSlots.find(candidate => Number(candidate?.slotId) === slot)
          const emptyIndex = emptySlots.indexOf(slot)
          const role = npcSlot?.role ?? npcRoles[emptyIndex] ?? (emptyIndex === 0 ? 'attack' : 'support')
          return <article key={slot} className={`raid-member-slot${entry?.isOwn ? ' own' : ''}${entry?.ready ? ' ready' : ''}`}>
            {entry ? <><span>{entry.isOwn ? 'YOU' : entry.isAi ? 'NPC' : 'PLAYER'} · SLOT {slot + 1}</span><div>{pokemon && <SpriteImage src={pokemon.icon ?? memberProfile?.icon} fallbackSrc={memberProfile?.iconFallback} alt="" draggable="false" />}<strong>{entry.name ?? '트레이너'}</strong><small>{pokemon?.name ?? (entry.ready ? '출전 포켓몬 확인됨' : '포켓몬 선택 중')}</small></div><b>{entry.ready ? <><Check size={14} /> 준비 완료</> : '준비 중'}</b></> : <><span>NPC SLOT {slot + 1}</span><div><UsersRound size={28} /><strong>{npcSlot?.name ?? '지원 AI'}</strong><small>{NPC_ROLE_LABELS[role] ?? '지원 역할을 준비하고 있습니다.'}</small></div><b>{NPC_ROLE_LABELS[role] ?? '지원 AI'}</b></>}
          </article>
        })}</div>
      </article>
      <article className="raid-room-entry"><span>YOUR RAID PARTNER</span><h2>출전 포켓몬</h2>
        {selected ? <button type="button" className="raid-selected-pokemon" onClick={onPick} disabled={busy}><SpriteImage src={selected.spriteFront ?? profile?.spriteFront} fallbackSrc={profile?.spriteFrontFallback} alt="" draggable="false" /><div><small>Lv.{selected.level ?? 50}</small><strong>{selected.name ?? profile?.name}</strong><span>{(selected.types ?? profile?.types ?? []).join(' · ')}</span></div><ChevronRight size={18} /></button>
          : <button type="button" className="raid-select-pokemon" onClick={onPick} disabled={busy}><Plus size={22} /><span>보유 포켓몬 선택</span><small>한 마리만 출전할 수 있습니다.</small></button>}
        {selected && <PokemonLoadoutPreview pokemon={selected} />}
        {host && emptySlots.length > 0 && <section className="raid-npc-role-picker" aria-label="지원 NPC 역할 선택"><header><UsersRound size={15} /><strong>지원 NPC 역할</strong><small>역할을 바꾸면 모두 다시 준비해야 합니다.</small></header>{emptySlots.map((slot, index) => {
          const current = npcRoles[index] ?? (index === 0 ? 'attack' : 'support')
          return <div key={slot}><span>SLOT {slot + 1}</span>{['attack', 'support'].map(role => <button key={role} type="button" disabled={busy || !selected} className={current === role ? 'selected' : ''} onClick={() => changeNpcRole(index, role)}>{NPC_ROLE_LABELS[role]}</button>)}</div>
        })}</section>}
        <p><Shield size={17} /> 내 포켓몬이 준비되면 <b>준비 완료</b>를 누르세요.<br />실제 참가자가 없는 슬롯은 역할에 맞는 NPC가 채웁니다.</p>
        <div className="raid-room-actions"><button type="button" className="raid-secondary" disabled={busy} onClick={onLeave}>나가기</button><button type="button" className="raid-primary" disabled={busy || !selected || Boolean(member?.ready)} onClick={onReady}>{member?.ready ? <><Check size={17} /> 준비 완료</> : '준비 완료'}</button></div>
        {host && <button type="button" className="raid-start-button" disabled={busy || !member?.ready || !allReady} onClick={onStart}><Play size={17} /> {startLabel}</button>}
      </article>
    </section>
  </main>
}

function RaidIntermission({ raid, battle, busy, connected, onAdvance, onWithdraw, error, onRefresh }) {
  const allies = activeActors(battle, 'ally')
  const nextBoss = RAID_BOSSES.find(entry => entry.id === raid?.bossId)
  return <main className="raid-intermission-screen">
    <section>
      <span className="raid-intermission-emblem"><Shield size={38} /></span>
      <small>STAGE 1 CLEAR · CO-OP BOSS RAID</small>
      <h1>전초전을 돌파했습니다!</h1>
      <p>{nextBoss?.name ?? '보스'}가 모습을 드러내기 전에 파트너들이 전투를 정비합니다.</p>
      <div className="raid-intermission-party">{allies.map((actor, index) => <RaidActor key={actorId(actor, index)} actor={actor} side="ally" own={actorId(actor) === String(raid?.ownActorId)} npc={Boolean(actor?.isNpc)} />)}</div>
      <p className="raid-intermission-rule">본 보스전은 같은 포켓몬으로 진행하며 HP·PP·상태와 전장이 초기화됩니다. 각 참가자는 단계마다 기믹을 한 번 사용할 수 있습니다.</p>
      {error && <div className="raid-notice error" role="alert">{error}<button type="button" onClick={onRefresh}><RefreshCw size={14} /> 다시 연결</button></div>}
      <div><button className="raid-secondary" type="button" disabled={busy} onClick={onWithdraw}><Flag size={16} /> 철수</button><button className="raid-primary" type="button" disabled={busy || !connected} onClick={onAdvance}><Crown size={17} /> 본 보스전 시작</button></div>
    </section>
  </main>
}

function RaidWithdrawDialog({ busy, connected, onClose, onWithdraw }) {
  return <div className="raid-picker-backdrop"><section className="raid-room-dialog raid-withdraw-dialog" role="alertdialog" aria-modal="true" aria-labelledby="raid-withdraw-title"><Flag size={28} /><h2 id="raid-withdraw-title">이번 보스전에서 철수할까요?</h2><p>남은 참가자들은 전투를 계속할 수 있습니다.</p><div><button type="button" className="raid-secondary" onClick={onClose}>계속 대전</button><button type="button" className="raid-primary" disabled={busy || !connected} onClick={onWithdraw}>철수하기</button></div></section></div>
}

function RaidBattle({ raid, result, playback, replayPending, busy, connected, secondsLeft, onSubmit, onRevoke, onWithdraw, onAdvance, error, onRefresh, soundEnabled, audioSettings, gameSettings = {}, onToggleSound, onOpenSettings }) {
  const battle = playback.raidId === raid.id ? playback.battle ?? raid.battle : raid.battle
  const allies = activeActors(battle, 'ally')
  const enemies = activeActors(battle, 'enemy')
  const ownActor = allies.find(actor => actorId(actor) === String(raid.ownActorId ?? battle.ownActorId))
  const playing = playback.playing || replayPending
  const cue = playback.raidId === raid.id ? playback.cue : null
  const displayRaid = { ...raid, phase: battle.raid?.phase ?? raid.phase, stage: battle.raid?.phase ?? raid.stage, battle }
  const boss = enemies.find(actor => isBossActor(actor, displayRaid))
  const submitted = Boolean(raid.submitted ?? raid.actionSubmitted)
  const battleAudioRef = useRef(null)
  const audioStartedRef = useRef(null)
  const playedCueRef = useRef(null)
  const forcedAttemptRef = useRef(null)
  const logRef = useRef(null)
  const [confirmWithdraw, setConfirmWithdraw] = useState(false)
  const animationMode = gameSettings.attackAnimation ?? 'normal'
  const hpTransitionMs = hpTransitionDuration(gameSettings.hpBarSpeed)
  const reducedMotion = useReducedMotion()
  if (!battleAudioRef.current) battleAudioRef.current = createBattleAudio(soundEnabled, audioSettings)
  useEffect(() => () => battleAudioRef.current?.destroy(), [])
  useEffect(() => { battleAudioRef.current?.setEnabled(soundEnabled) }, [soundEnabled])
  useEffect(() => { battleAudioRef.current?.setMix(audioSettings) }, [audioSettings])
  useEffect(() => {
    const unlock = () => battleAudioRef.current?.unlock()
    const events = ['pointerdown', 'keydown', 'touchend']
    events.forEach(event => window.addEventListener(event, unlock, true))
    return () => events.forEach(event => window.removeEventListener(event, unlock, true))
  }, [])
  useEffect(() => {
    if (audioStartedRef.current === raid.id) return
    audioStartedRef.current = raid.id
    battleAudioRef.current?.start({ playerPokemon: allies, opponentPokemon: enemies })
  }, [raid.id])
  useEffect(() => {
    if (!cue?.id || playedCueRef.current === cue.id) return
    playedCueRef.current = cue.id
    battleAudioRef.current?.playCue(cue, { animationMode: animationMode === 'skip' ? 'normal' : animationMode, durationMs: turnStepDuration(cue, animationMode) })
  }, [cue, animationMode])
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight }, [cue?.id, battle.log])
  const canAct = Boolean(!playing && raid.lifecycle === 'input' && connected && !busy && ownActor && !ownActor.fainted && actorHp(ownActor).hp > 0 && !submitted
    && !isFinished(raid, result) && (secondsLeft === null || secondsLeft > 0))
  useEffect(() => {
    if (!canAct || !battle.forcedAction) return
    if (forcedAttemptRef.current?.token !== raid.decisionToken) forcedAttemptRef.current = { token: raid.decisionToken, attempts: 0 }
    const attempt = forcedAttemptRef.current
    if (attempt.pending || attempt.completed || attempt.attempts >= 2) return
    attempt.pending = true
    attempt.attempts += 1
    Promise.resolve(onSubmit({ ...battle.forcedAction, actorId: actorId(ownActor) })).then(value => { attempt.completed = Boolean(value) })
      .catch(() => { /* The request panel offers manual continuation after bounded retries. */ })
      .finally(() => { attempt.pending = false })
  }, [canAct, raid.decisionToken, battle.forcedAction])
  const waitText = !connected ? '연결을 복구하고 있습니다.' : busy ? '행동을 전송하고 있습니다.'
    : submitted ? '다른 참가자가 행동을 선택하고 있습니다.' : secondsLeft === 0 ? '행동 시간이 끝났습니다. 전투 진행을 기다려 주세요.'
      : ownActor?.fainted ? '내 포켓몬이 쓰러졌습니다. 동료의 전투를 지켜보세요.' : '이번 턴의 행동을 선택하세요.'
  const withdrawDialog = confirmWithdraw && <RaidWithdrawDialog busy={busy} connected={connected} onClose={() => setConfirmWithdraw(false)} onWithdraw={onWithdraw} />
  if (raid.lifecycle === 'intermission' && !playing) return <><RaidIntermission raid={raid} battle={battle} busy={busy} connected={connected} onAdvance={onAdvance} onWithdraw={() => setConfirmWithdraw(true)} error={error} onRefresh={onRefresh} />{withdrawDialog}</>
  const latestEvent = playback.events?.at(-1)
  const currentMessage = cue?.message ?? battle.log?.at(-1)?.message ?? latestEvent?.message ?? waitText
  const history = asArray(battle.log).slice(-14).filter((entry, index, list) => index !== list.length - 1 || entry.message !== currentMessage)
  const turn = Math.max(1, cue?.turn ?? battle.turn ?? raid.turnNumber ?? 1)
  return <main className={`battle-game-screen raid-battle-screen raid-standard-battle cue-${cue?.phase ?? 'command'}${reducedMotion ? ' reduce-motion' : ''}`} style={{ '--battle-hp-duration': `${hpTransitionMs}ms`, '--raid-hp-transition': `${hpTransitionMs}ms` }}>
    <div className="raid-online-bar" role="status"><span>{connected ? <Wifi size={14} /> : <WifiOff size={14} />}{playing ? '배틀 진행 중' : waitText}</span><div><Clock3 size={14} /><b>{secondsLeft === null ? '—' : clockText(secondsLeft)}</b><button type="button" disabled={busy} onClick={() => setConfirmWithdraw(true)}><Flag size={14} /> 기권</button></div></div>
    {error && <div className="raid-notice error" role="alert">{error}<button type="button" onClick={onRefresh}><RefreshCw size={14} /> 다시 연결</button></div>}
    <RaidBattleStage battle={{ ...battle, turn }} raid={displayRaid} cue={cue} animationMode={reducedMotion ? 'skip' : animationMode} hpTransitionMs={hpTransitionMs}
      soundEnabled={soundEnabled} onToggleSound={onToggleSound} onOpenSettings={onOpenSettings} showDamageNumbers={gameSettings.showDamageNumbers !== false}
      bossHud={boss && <RaidBossHp actor={boss} raid={displayRaid} hpTransitionMs={hpTransitionMs} />} />
    <section className="battle-command-deck">
      <aside className="battle-log-panel"><header><span><ScrollText size={15} /> 배틀 로그</span><strong>TURN {turn}</strong></header><div className="battle-log-body"><div className="battle-log-scroll" ref={logRef} aria-label="배틀 로그" aria-live="polite">
        {history.map((entry, index) => <p className={`tone-${entry.tone ?? 'neutral'}`} key={`${index}-${entry.message}`}>{entry.message}</p>)}
        <p className="battle-log-current" key={cue?.id ?? currentMessage}><span aria-hidden="true">▶</span><span className="battle-log-current-message">{currentMessage}</span></p>
      </div></div></aside>
      <RaidBattleCommands battle={battle} raid={raid} canAct={canAct} playing={playing} submitted={submitted} busy={busy} connected={connected} waitText={waitText}
        onSubmit={onSubmit} onRevoke={onRevoke} onWithdraw={onWithdraw} onPreview={() => battleAudioRef.current?.playMenu('select')}
        renderActor={(actor, index) => <RaidActor key={actorId(actor, index)} actor={actor} side={actor.sideId === 'opponent' ? 'enemy' : 'ally'} own={actorId(actor) === actorId(ownActor)} boss={isBossActor(actor, displayRaid)} npc={actor.isNpc} hpTransitionMs={hpTransitionMs} />} />
    </section>
    {withdrawDialog}
  </main>
}

function RaidResult({ raid, result, rewards, onDismiss, busy }) {
  const outcome = result?.outcome ?? result?.status ?? (result?.victory ? 'win' : 'loss')
  const won = ['win', 'won', 'victory', 'cleared', 'success'].includes(String(outcome).toLowerCase())
  const vp = Number(rewards?.vp ?? rewards?.vpGranted ?? result?.rewardVp ?? result?.vp ?? 0)
  const boss = RAID_BOSSES.find(entry => entry.id === (raid?.bossId ?? result?.bossId))
  const stage = raid?.stage ?? raid?.phase ?? result?.stage ?? result?.phase
  const participants = asArray(raid?.participants ?? result?.participants)
  const participantCount = participants.length || Number(result?.participantCount ?? result?.memberCount ?? 0)
  const humanCount = result?.humanCount != null && Number.isFinite(Number(result.humanCount))
    ? Math.max(0, Number(result.humanCount))
    : participants.filter(participant => !participant?.isAi && !participant?.isNpc).length
  const npcCount = result?.npcCount != null && Number.isFinite(Number(result.npcCount))
    ? Math.max(0, Number(result.npcCount))
    : participants.filter(participant => participant?.isAi || participant?.isNpc).length
  const participantLabel = humanCount > 0
    ? `실제 참가 ${humanCount}명${npcCount > 0 ? ` · NPC ${npcCount}명 지원` : ''}`
    : participantCount > 0 ? `${participantCount}슬롯 협동` : ''
  return <main className={`raid-result-screen ${won ? 'won' : 'lost'}`}><section><span>{won ? <TrophyIcon /> : <Flag size={42} />}</span><small>CO-OP BOSS RAID · 결과 확정</small><h1>{won ? '보스 토벌 성공!' : '보스전 종료'}</h1><p>{result?.reasonLabel ?? result?.message ?? (won ? `${boss?.name ?? '보스'}를 쓰러뜨렸습니다.` : '다시 준비한 뒤 보스전에 도전하세요.')}</p>
    {(boss || stage || participantLabel) && <div className="raid-result-meta">{(boss || stage) && <span><Shield size={18} /> {boss?.name ?? '보스전'}{stage ? ` · ${phaseLabel({ stage, phase: stage })}` : ''}</span>}{participantLabel && <span><UsersRound size={18} /> {participantLabel}</span>}</div>}
    <div className="raid-result-vp"><small>서버 정산 VP</small><strong>{won ? `+${vp.toLocaleString()}` : '+0'} <em>VP</em></strong><span>{won ? '지급 내역은 계정 잔액에 반영됩니다.' : '승리 보상은 지급되지 않았습니다.'}</span></div>
    <button type="button" className="raid-primary" disabled={busy} onClick={onDismiss}>보스전 로비로 <ChevronRight size={18} /></button>
  </section></main>
}

function TrophyIcon() { return <Crown size={44} /> }

export default function RaidScreen({
  user, boxPokemon = [], onBack, onBeforeJoin, onBattleActiveChange,
  soundEnabled = true, gameSettings = {}, audioSettings = {}, onVpRewards, onReceiveVpRewards,
  client: providedClient, enabled = isRaidEnabled, onToggleSound, onOpenSettings,
}) {
  const [identity, setIdentity] = useState(initialIdentity)
  const [snapshot, setSnapshot] = useState(EMPTY)
  const playback = useRaidBattlePlayback(snapshot.raid, gameSettings)
  const replayPending = Boolean(snapshot.raid?.id && playback.raidId === snapshot.raid.id && playback.readyVersion !== raidPlaybackVersion(snapshot.raid))
  const snapshotRef = useRef(EMPTY)
  const [selectedBossId, setSelectedBossId] = useState(null)
  const [busy, setBusy] = useState(false)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState('')
  const [refreshError, setRefreshError] = useState('')
  const [now, setNow] = useState(Date.now())
  const [serverOffset, setServerOffset] = useState(0)
  const [createOpen, setCreateOpen] = useState(false)
  const [joinRoom, setJoinRoom] = useState(null)
  const [roomTitle, setRoomTitle] = useState('')
  const [visibility, setVisibility] = useState('public')
  const [roomCode, setRoomCode] = useState('')
  const [issuedInviteCode, setIssuedInviteCode] = useState('')
  const [inviteCopied, setInviteCopied] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [selectedCaptureId, setSelectedCaptureId] = useState(null)
  const [pollEpoch, setPollEpoch] = useState(0)
  const mountedRef = useRef(true)
  const snapshotGenerationRef = useRef(0)
  const mutationFenceRef = useRef(0)
  const operationRef = useRef(false)
  const refreshRef = useRef(null)
  const appliedRewardRef = useRef(null)

  const featureAvailable = Boolean(enabled || isRaidLocalTest || providedClient)
  const canAuthenticate = Boolean(providedClient || isRaidLocalTest || (user?.uid && !user?.isLocalGuest))
  const client = useMemo(() => providedClient ?? createRaidClient({
    getIdToken: async () => {
      const current = firebaseAuth?.currentUser
      if (!current || current.uid !== user?.uid) return null
      const token = await current.getIdToken()
      return firebaseAuth?.currentUser?.uid === user?.uid ? token : null
    },
    localTestIdentity: isRaidLocalTest ? identity : undefined,
  }), [providedClient, user?.uid, identity])

  const accept = useCallback((value, generation = snapshotGenerationRef.current) => {
    if (generation !== snapshotGenerationRef.current) return false
    if (!value || typeof value !== 'object') return
    const next = mergeSnapshot(snapshotRef.current, value)
    if (next === snapshotRef.current) return false
    snapshotRef.current = next
    setSnapshot(next)
    if (value.serverTime) {
      const serverTime = timeValue(value.serverTime)
      if (Number.isFinite(serverTime)) setServerOffset(serverTime - Date.now())
    }
    if (value.raid || value.room) setConnected(true)
    return true
  }, [])

  const refresh = useCallback(async ({ signal, quiet = false } = {}) => {
    if (!featureAvailable || !canAuthenticate) return null
    // A status snapshot is useful only when no mutation is in flight.  The
    // server may have read a run just before a command commit; allowing that
    // response to land later would restore an older command/HP projection.
    if (operationRef.current) return null
    const current = snapshotRef.current
    const generation = snapshotGenerationRef.current
    const mutationFence = mutationFenceRef.current
    try {
      const value = await client.status({ raidId: current.raid?.id, revision: current.raid?.revision, sinceRevision: current.raid?.revision, eventCursor: current.raid?.eventCursor }, { signal })
      if (!mountedRef.current || signal?.aborted || operationRef.current
        || generation !== snapshotGenerationRef.current || mutationFence !== mutationFenceRef.current) return null
      accept(value, generation)
      setConnected(true)
      if (!quiet) setRefreshError('')
      return value
    } catch (failure) {
      if (failure?.name === 'AbortError') return null
      if (mountedRef.current) { setConnected(false); setRefreshError(failure.message) }
      throw failure
    }
  }, [accept, canAuthenticate, client, featureAvailable])

  useEffect(() => {
    refreshRef.current = refresh
    return () => { if (refreshRef.current === refresh) refreshRef.current = null }
  }, [refresh])

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    if (!featureAvailable || !canAuthenticate) return undefined
    let closed = false
    let controller = null
    let timer = null
    let failures = 0
    const poll = async () => {
      if (operationRef.current) {
        if (!closed) timer = setTimeout(poll, 300)
        return
      }
      controller?.abort()
      controller = new AbortController()
      const generation = snapshotGenerationRef.current
      const mutationFence = mutationFenceRef.current
      try {
        const [catalog] = await Promise.all([
          snapshotRef.current.catalog ? Promise.resolve(null) : client.catalog({}, { signal: controller.signal }),
          refresh({ signal: controller.signal, quiet: true }),
        ])
        if (catalog && !closed && !operationRef.current && generation === snapshotGenerationRef.current
          && mutationFence === mutationFenceRef.current) accept(catalog, generation)
        failures = 0
      } catch (failure) {
        if (failure?.name !== 'AbortError') {
          failures += 1
          if (!closed) setRefreshError(failure.message)
        }
      } finally {
        if (closed) return
        // A result is final for this UI session. The user can dismiss it to
        // return to the lobby, without a background request repeatedly
        // reading a terminal raid document.
        if (snapshotRef.current.result ?? snapshotRef.current.raid?.result) return
        const active = isLive(snapshotRef.current.raid, snapshotRef.current.result)
        const standardDelay = active ? 1_500 : 5_000
        const retryDelay = failures ? Math.min(30_000, 2_000 * (2 ** Math.min(failures, 4))) : standardDelay
        const delay = document.hidden
          ? Math.max(10_000, Math.min(15_000, retryDelay))
          : retryDelay
        timer = setTimeout(poll, delay)
      }
    }
    poll()
    return () => { closed = true; controller?.abort(); clearTimeout(timer) }
  }, [accept, canAuthenticate, client, featureAvailable, pollEpoch, refresh])

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [])

  const liveRaid = isLive(snapshot.raid, snapshot.result)
  const battleVisible = liveRaid || replayPending
  useEffect(() => { onBattleActiveChange?.(battleVisible); return () => onBattleActiveChange?.(false) }, [battleVisible, onBattleActiveChange])

  const receiveVpRewards = onReceiveVpRewards ?? onVpRewards
  useEffect(() => {
    const rewards = snapshot.rewards
    if (!receiveVpRewards || !rewards || !Number.isSafeInteger(rewards.total)) return undefined
    // The server intentionally omits an account identifier from a scoped raid
    // response. Scope the local idempotency receipt to the signed-in user,
    // rather than trusting an identifier sent over the wire.
    const receipt = `${user?.uid ?? 'raid'}:${rewards.total}`
    if (appliedRewardRef.current === receipt) return undefined
    let cancelled = false
    Promise.resolve(receiveVpRewards(rewards)).then(() => {
      if (!cancelled) appliedRewardRef.current = receipt
    }).catch(failure => {
      if (!cancelled) setError(failure.message || '보스전 VP를 계정에 반영하지 못했습니다.')
    })
    return () => { cancelled = true }
  }, [receiveVpRewards, snapshot.rewards, user?.uid])

  // Status is deliberately read-only. The server's heartbeat is the only
  // active-raid keepalive, so a hidden tab can resume and deadline recovery
  // stays server-authoritative instead of being inferred in the client.
  useEffect(() => {
    const raidId = snapshot.raid?.id
    if (!liveRaid || !raidId) return undefined
    let cancelled = false
    let inFlight = false
    const beat = async () => {
      if (cancelled || operationRef.current || inFlight) return
      inFlight = true
      const generation = snapshotGenerationRef.current
      const mutationFence = mutationFenceRef.current
      try {
        const value = await client.request('raidHeartbeat', { raidId }, { requestId: createRaidRequestId() })
        if (!cancelled && !operationRef.current && generation === snapshotGenerationRef.current
          && mutationFence === mutationFenceRef.current) { accept(value, generation); setConnected(true) }
      } catch (failure) {
        if (!cancelled && failure?.code === 'network-error') { setConnected(false); setRefreshError(failure.message) }
      } finally {
        inFlight = false
      }
    }
    const timer = setInterval(beat, 10_000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [accept, client, liveRaid, snapshot.raid?.id])

  // Waiting rooms use an explicit lease too. A read-only status refresh must
  // never keep a room alive by itself, so only an active participant sends the
  // presence mutation while the lobby is open.
  useEffect(() => {
    const room = snapshot.room
    if (!room?.id || String(room.status ?? '').toLowerCase() !== 'waiting') return undefined
    let cancelled = false
    let inFlight = false
    const beat = async () => {
      if (cancelled || operationRef.current || inFlight) return
      inFlight = true
      const generation = snapshotGenerationRef.current
      const mutationFence = mutationFenceRef.current
      try {
        const value = await client.request('roomHeartbeat', { roomId: room.id }, { requestId: createRaidRequestId() })
        if (!cancelled && !operationRef.current && generation === snapshotGenerationRef.current
          && mutationFence === mutationFenceRef.current) { accept(value, generation); setConnected(true) }
      } catch (failure) {
        if (!cancelled && failure?.code === 'network-error') { setConnected(false); setRefreshError(failure.message) }
      } finally {
        inFlight = false
      }
    }
    const timer = setInterval(beat, 10_000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [accept, client, snapshot.room?.id, snapshot.room?.roomRevision, snapshot.room?.status])

  const mutate = useCallback(async (action, payload = {}, before) => {
    if (operationRef.current) throw new Error('요청을 처리하고 있습니다.')
    operationRef.current = true
    const generation = ++snapshotGenerationRef.current
    mutationFenceRef.current += 1
    setBusy(true)
    setError('')
    try {
      if (before && await before() === false) throw new Error('계정 저장을 완료하지 못했습니다. 저장 상태를 확인한 뒤 다시 시도해 주세요.')
      const value = await client.request(action, payload, { requestId: createRaidRequestId() })
      if (!mountedRef.current) return value
      accept(value, generation)
      setConnected(true)
      return value
    } catch (failure) {
      if (mountedRef.current) { setError(failure.message); if (failure.code === 'network-error') setConnected(false) }
      throw failure
    } finally {
      operationRef.current = false
      if (mountedRef.current) setBusy(false)
    }
  }, [accept, client])

  const fire = async (action, payload, before) => { try { return await mutate(action, payload, before) } catch { return null } }
  const bosses = catalogBosses(snapshot.catalog)
  const selectedBoss = bosses.find(entry => entry.id === selectedBossId) ?? null
  const result = snapshot.result ?? snapshot.raid?.result
  const deadline = timeValue(snapshot.raid?.deadlineAt)
  const secondsLeft = Number.isFinite(deadline) ? Math.max(0, Math.ceil((deadline - now - serverOffset) / 1000)) : null
  const rooms = asArray(snapshot.rooms).filter(room => !selectedBossId || room.bossId === selectedBossId)

  const switchLocalIdentity = value => {
    if (!['alice', 'bob', 'charlie'].includes(value)) return
    try { window.sessionStorage.setItem(LOCAL_IDENTITY_KEY, value) } catch {}
    // The interactive GameApp starter owns a separate fixture box and account
    // for each browser URL. Reloading the player query keeps the selected
    // local identity, `user.uid`, and server-owned capture list in sync.
    try {
      const url = new URL(window.location.href)
      if (url.pathname.endsWith('/raid-test.html')) {
        if (url.searchParams.get('player') !== value) {
          url.searchParams.set('player', value)
          window.location.assign(url.href)
        }
        return
      }
    } catch {}
    setIdentity(value)
  }

  useEffect(() => {
    const room = snapshot.room
    const member = asArray(room?.members).find(entry => entry?.isOwn)
    const current = member?.selectedPokemon?.captureId ?? member?.selectedPokemonId
    if (current) setSelectedCaptureId(current)
  }, [snapshot.room])

  async function createRoom({ solo = false } = {}) {
    if (!selectedBossId) return
    const effectiveVisibility = solo ? 'private' : visibility
    const value = await fire('roomCreate', { bossId: selectedBossId, title: roomTitle.trim() || (solo ? '솔로 보스전' : undefined), visibility: effectiveVisibility }, onBeforeJoin)
    if (value) {
      const inviteCode = value?.inviteCode ?? value?.room?.inviteCode
      // Solo rooms are private only to keep them out of the public browser;
      // there is nobody to invite, so showing the one-time code over the
      // Pokémon picker obscures the next required action.
      setIssuedInviteCode(!solo && typeof inviteCode === 'string' ? inviteCode : '')
      setInviteCopied(false)
      setCreateOpen(false)
      setRoomCode('')
      setRoomTitle('')
      setPickerOpen(true)
    }
  }
  async function joinSelectedRoom() {
    if (!joinRoom) return
    const invite = joinRoom.mode === 'invite'
    const value = await fire('roomJoin', invite
      ? { code: roomCode.trim().toUpperCase() }
      : { roomId: joinRoom.id, roomRevision: joinRoom.roomRevision }, onBeforeJoin)
    if (value) { setJoinRoom(null); setRoomCode(''); setPickerOpen(true) }
  }
  function selectCapture(captureId) { setSelectedCaptureId(captureId); setPickerOpen(false) }
  async function ready() {
    const room = snapshotRef.current.room
    if (!room?.id || !selectedCaptureId) return
    await fire('roomReady', { roomId: room.id, roomRevision: room.roomRevision, pokemon: { captureId: selectedCaptureId }, ready: true }, onBeforeJoin)
  }
  async function setNpcRoles(npcRoles) {
    const room = snapshotRef.current.room
    if (!room?.id || !selectedCaptureId) return
    await fire('roomReady', { roomId: room.id, roomRevision: room.roomRevision, pokemon: { captureId: selectedCaptureId }, ready: true, npcRoles }, onBeforeJoin)
  }
  async function leaveRoom() {
    const room = snapshotRef.current.room
    if (!room?.id) return
    const value = await fire('roomLeave', { roomId: room.id, roomRevision: room.roomRevision })
    if (!value) return
    snapshotGenerationRef.current += 1
    mutationFenceRef.current += 1
    setSelectedCaptureId(null)
    setSelectedBossId(null)
    setIssuedInviteCode('')
  }
  async function dismissResult() {
    const current = snapshotRef.current
    // A reconnect after settlement can intentionally receive a compact
    // result-only snapshot. The result carries its raid id for that path, so
    // it remains dismissible without requiring a stale full battle payload.
    const raidId = current.raid?.id ?? current.result?.raidId
    if (!raidId) return
    let value = null
    try {
      value = await mutate('raidDismissResult', { raidId })
    } catch (failure) {
      // A newer terminal run can replace a stale reconnect result. Re-read
      // the server snapshot rather than clearing the newer receipt locally.
      if (failure?.code === 'STALE_RESULT') await refresh({ quiet: false }).catch(() => {})
      return
    }
    if (!value) return
    snapshotGenerationRef.current += 1
    mutationFenceRef.current += 1
    const next = { ...snapshotRef.current, result: null, rewards: null, raid: null, room: null }
    snapshotRef.current = next
    setSnapshot(next)
    setSelectedBossId(null)
    setIssuedInviteCode('')
    // The terminal-result poll intentionally stopped. Start a fresh lobby
    // cycle only after the server confirms that this result was dismissed.
    setPollEpoch(value => value + 1)
  }

  if (!featureAvailable) return <main className="raid-disabled"><Crown size={44} /><h1>협동 보스전을 준비하고 있습니다</h1><p>현재 환경에서는 보스전 모드를 활성화하지 않았습니다.</p><button className="screen-back-button" type="button" onClick={onBack}><ArrowLeft size={18} /> 배틀 선택</button></main>
  if (!canAuthenticate) return <main className="raid-disabled"><UsersRound size={44} /><h1>온라인 계정으로 참가하세요</h1><p>게스트 또는 Google 로그인 후 협동 보스전 기록과 보상을 저장하며 참가할 수 있습니다.</p><button className="screen-back-button" type="button" onClick={onBack}><ArrowLeft size={18} /> 배틀 선택</button></main>
  if (result && !replayPending) return <RaidResult raid={snapshot.raid} result={result} rewards={snapshot.rewards} busy={busy} onDismiss={dismissResult} />
  if (battleVisible) return <RaidBattle playback={playback} replayPending={replayPending} raid={snapshot.raid} result={result} busy={busy} connected={connected} secondsLeft={secondsLeft} error={error || refreshError}
    onRefresh={() => refreshRef.current?.()} onRevoke={() => fire('raidRevoke', { raidId: snapshot.raid.id, revision: snapshot.raid.revision, decisionToken: snapshot.raid.decisionToken, commandVersion: snapshot.raid.ownCommandVersion })}
    onWithdraw={() => fire('raidWithdraw', { raidId: snapshot.raid.id })}
    onAdvance={() => fire('raidAdvance', { raidId: snapshot.raid.id, decisionToken: snapshot.raid.decisionToken })}
    onSubmit={command => fire('raidSubmit', { raidId: snapshot.raid.id, revision: snapshot.raid.revision, decisionToken: snapshot.raid.decisionToken, commandVersion: (snapshot.raid.ownCommandVersion ?? 0) + 1, command })}
    soundEnabled={soundEnabled} gameSettings={gameSettings} audioSettings={audioSettings} onToggleSound={onToggleSound} onOpenSettings={onOpenSettings} />
  if (snapshot.room) return <>
    <RaidRoomLobby room={snapshot.room} boxPokemon={boxPokemon} selectedCaptureId={selectedCaptureId} onPick={() => setPickerOpen(true)} onReady={ready} onStart={() => fire('roomStart', { roomId: snapshot.room.id, roomRevision: snapshot.room.roomRevision })}
      onNpcRolesChange={setNpcRoles} onLeave={leaveRoom} busy={busy} error={error || refreshError} connected={connected} />
    {pickerOpen && <OwnedPokemonPicker pokemon={boxPokemon} selectedId={selectedCaptureId} onSelect={selectCapture} onClose={() => setPickerOpen(false)} />}
    {issuedInviteCode && <RaidInviteCodeDialog code={issuedInviteCode} copied={inviteCopied} onCopy={async () => {
      try { await navigator.clipboard?.writeText?.(issuedInviteCode); setInviteCopied(true) } catch { setInviteCopied(false) }
    }} onClose={() => setIssuedInviteCode('')} />}
  </>

  return <main className="raid-lobby-screen">
    <header className="raid-page-header"><button className="screen-back-button" type="button" onClick={onBack}><ArrowLeft size={18} /> 배틀 선택</button><div><span>CO-OP BOSS RAID</span><h1>협동 보스전</h1><p>한 마리의 파트너와 최대 3명이 함께 전설의 보스에 도전하세요.</p></div><aside>{isRaidLocalTest ? <label>로컬 테스트<select value={identity} onChange={event => switchLocalIdentity(event.target.value)}><option value="alice">Alice</option><option value="bob">Bob</option><option value="charlie">Charlie</option></select></label> : <span>{connected ? <><Wifi size={15} /> 실시간 연결</> : <><WifiOff size={15} /> 연결 중</>}</span>}</aside></header>
    {(error || refreshError) && <div className="raid-notice error" role="alert">{error || refreshError}<button type="button" onClick={() => refresh({ quiet: false })}><RefreshCw size={14} /> 다시 연결</button></div>}
    {!selectedBoss ? <><section className="raid-intro"><div><Crown size={26} /><span>1~3 PLAYERS · ONE POKÉMON EACH</span><h2>세 보스의 패턴을 읽고<br />협동으로 돌파하세요.</h2></div><p>전초전 뒤 본체전에 돌입합니다. HP 구간마다 보스의 패턴이 변하며, 재접속해도 서버가 진행을 보존합니다.</p></section><section className="raid-boss-grid" aria-label="도전할 보스 선택">{bosses.map(boss => <BossCard boss={boss} key={boss.id} onClick={() => setSelectedBossId(boss.id)} />)}</section></>
      : <><header className="raid-room-browser-heading"><button type="button" onClick={() => setSelectedBossId(null)}><ArrowLeft size={16} /> 보스 선택</button><BossCard boss={selectedBoss} /><div><span>RAID ROOM LIST</span><h2>{selectedBoss.name} 보스전</h2><p>공개 방에 참가하거나 나만의 방을 만드세요. 비공개 방은 서버가 발급한 8자리 초대 코드로만 참가할 수 있습니다.</p></div><section><button className="raid-secondary" type="button" disabled={busy} onClick={() => { setVisibility('private'); setRoomTitle('솔로 보스전'); setRoomCode(''); createRoom({ solo: true }) }}><HeartPulse size={17} /> 솔로 도전</button><button className="raid-secondary" type="button" disabled={busy} onClick={() => { setJoinRoom({ mode: 'invite', title: '초대 코드로 참가' }); setRoomCode('') }}><KeyRound size={17} /> 초대 코드 참가</button><button className="raid-primary" type="button" disabled={busy} onClick={() => { setCreateOpen(true); setVisibility('public'); setRoomTitle('') }}><Plus size={17} /> 방 만들기</button></section></header>
        <section className="raid-room-list">{rooms.length ? rooms.map(room => <RoomCard room={room} key={room.id} busy={busy} onJoin={room => { setJoinRoom(room); setRoomCode('') }} />) : <div className="raid-empty-rooms"><UsersRound size={34} /><h2>참가할 공개 방이 없습니다</h2><p>새 방을 만들어 가장 먼저 보스전에 도전하세요.</p></div>}</section></>}
    {createOpen && <div className="raid-picker-backdrop" role="presentation"><section className="raid-room-dialog" role="dialog" aria-modal="true" aria-label="보스전 방 만들기"><header><div><span>CREATE RAID ROOM</span><h2>{selectedBoss?.name} 보스전 방 만들기</h2></div><button type="button" onClick={() => setCreateOpen(false)}><X size={20} /></button></header><label>방 제목<input maxLength={24} value={roomTitle} placeholder="예: 전설 레이드 도전" onChange={event => setRoomTitle(event.target.value)} /></label><fieldset><legend>공개 설정</legend><label><input type="radio" checked={visibility === 'public'} onChange={() => setVisibility('public')} /> 공개 방</label><label><input type="radio" checked={visibility === 'private'} onChange={() => setVisibility('private')} /> 비공개 방</label></fieldset>{visibility === 'private' && <p className="raid-private-note"><KeyRound size={15} /> 방을 만든 뒤 서버가 8자리 초대 코드를 한 번 발급합니다.</p>}<p>최대 3명이 참가하며, 빈 자리는 NPC 지원 포켓몬이 채웁니다.</p><button className="raid-primary" type="button" disabled={busy} onClick={() => createRoom()}>방 만들기 <ChevronRight size={17} /></button></section></div>}
    {joinRoom && <div className="raid-picker-backdrop" role="presentation"><section className="raid-room-dialog" role="dialog" aria-modal="true" aria-label={joinRoom.mode === 'invite' ? '초대 코드로 보스전 참가' : '보스전 방 참가'}><header><div><span>JOIN RAID ROOM</span><h2>{joinRoom.mode === 'invite' ? '초대 코드로 참가' : joinRoom.title || '보스전 방 참가'}</h2></div><button type="button" onClick={() => setJoinRoom(null)}><X size={20} /></button></header>{joinRoom.mode === 'invite' && <label>8자리 초대 코드<input autoFocus autoCapitalize="characters" spellCheck="false" maxLength={8} value={roomCode} placeholder="예: A7K9Q2PW" onChange={event => setRoomCode(event.target.value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, '').slice(0, 8))} /></label>}<p>{joinRoom.mode === 'invite' ? '초대받은 8자리 코드를 입력하세요. 코드가 맞으면 비공개 방에 바로 참가합니다.' : `${joinRoom.hostName ?? '트레이너'}의 공개 방에 참가합니다. 입장 후 내 보유 포켓몬 한 마리를 선택하세요.`}</p><button className="raid-primary" type="button" disabled={busy || (joinRoom.mode === 'invite' && roomCode.length !== 8)} onClick={joinSelectedRoom}>참가하기 <ChevronRight size={17} /></button></section></div>}
  </main>
}
