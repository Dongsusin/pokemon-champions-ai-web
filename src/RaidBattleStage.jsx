import {
  Crown,
  Settings,
  UsersRound,
  Volume2,
  VolumeX,
} from 'lucide-react'
import PokemonSprite from './PokemonSprite'
import {
  BattleArenaEffects,
  BattleFieldEffects,
  BattleRuleBadge,
  BattleStatusPanel,
  BattleWeatherEffects,
  battleCameraClassName,
  battleStageClassName,
  battleStageStyle,
  TeraTypeJewel,
} from './BattleScreen'
import { activeRaidActors, normalizeRaidActor } from './data/raidCommandView'
import { RAID_FORM_MANIFEST } from './data/raidRules'
import './raidBattleStage.css'

const WEATHER_LABELS = Object.freeze({
  clear: '맑음',
  sun: '쾌청',
  rain: '비',
  sandstorm: '모래바람',
  snow: '눈',
  fog: '안개',
  deltastream: '델타스트림',
  desolateland: '끝없는 가뭄',
  primordialsea: '끝없는 비',
})

const TERRAIN_LABELS = Object.freeze({
  neutral: '일반 필드',
  grassy: '그래스필드',
  electric: '일렉트릭필드',
  psychic: '사이코필드',
  misty: '미스트필드',
})

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function finite(value, fallback = 0) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function turnSuffix(value) {
  if (value == null) return ''
  const numeric = Number(value)
  return Number.isFinite(numeric) ? ' · ' + numeric + 'T' : ''
}

function raidRules(battle) {
  const rules = battle?.rules ?? {}
  const weather = rules.weather ?? battle?.environment?.weather ?? { id: 'clear', label: WEATHER_LABELS.clear }
  const terrain = rules.terrain ?? battle?.environment?.terrain ?? { id: 'neutral', label: TERRAIN_LABELS.neutral }
  const weatherId = String(weather?.id ?? weather ?? 'clear').toLowerCase()
  const terrainId = String(terrain?.id ?? terrain ?? 'neutral').toLowerCase()
  return {
    weather: {
      id: weatherId,
      label: weather?.label ?? WEATHER_LABELS[weatherId] ?? '날씨 없음',
      turns: weather?.turns ?? battle?.environment?.weatherTurns,
    },
    terrain: {
      id: terrainId,
      label: terrain?.label ?? TERRAIN_LABELS[terrainId] ?? '일반 필드',
      turns: terrain?.turns ?? battle?.environment?.terrainTurns,
    },
  }
}

function isPreludePhase(raid, battle) {
  const phase = String(raid?.stage ?? raid?.phase ?? battle?.raid?.phase ?? '').toLowerCase()
  return ['1', 'stage1', 'stage-1', 'prelude', 'vanguard'].includes(phase)
}

function actorSlot(actor, fallback) {
  const slot = finite(actor?.slot ?? actor?.slotId, fallback)
  return Math.max(0, Math.min(2, Math.trunc(slot)))
}

function raidFormVisual(actor, side) {
  const form = String(actor?.raidForm ?? actor?.form ?? actor?.raidFormId ?? '').toLowerCase()
  const manifest = RAID_FORM_MANIFEST[form]
  if (!manifest) return null
  if (form === 'dark') {
    return {
      src: manifest.sheet ? manifest.sheet + (side === 'player' ? '#back' : '#front') : null,
      fallback: side === 'player' ? actor?.spriteBackFallback : actor?.spriteFrontFallback,
      aura: manifest.aura ?? 'dark',
    }
  }
  return {
    src: side === 'player' ? manifest.back : manifest.front,
    fallback: side === 'player' ? actor?.spriteBackFallback : actor?.spriteFrontFallback,
    aura: form,
  }
}

function actorOwnerLabel(actor, side) {
  if (side === 'opponent') return actor?.displayName ?? '보스 진영'
  if (actor?.isMine) return '나'
  if (actor?.isNpc) return actor?.displayName ?? '지원 AI'
  return actor?.displayName ?? '협동 트레이너'
}

function inspectorText(actor, side) {
  const details = [
    actorOwnerLabel(actor, side),
    actor?.ability ? '특성 ' + actor.ability : null,
    actor?.heldItemName ? '도구 ' + actor.heldItemName : null,
    actor?.status?.label ? '상태 ' + actor.status.label : null,
  ].filter(Boolean)
  return (actor?.name ?? '포켓몬') + ' · ' + details.join(' · ')
}

function stageStatusClassName(side, actor, cue, slot) {
  const classes = ['battle-status-anchor', side + '-status-anchor', 'slot-' + slot]
  if (actor?.fainted || finite(actor?.hp) <= 0) classes.push('is-fainted')
  if (!cue) return classes.join(' ')

  const actorMatch = cue.sideId === side && (cue.actorSlot == null || Number(cue.actorSlot) === slot)
  const targetMatch = cue.targetSideId === side && (cue.targetSlot == null || Number(cue.targetSlot) === slot)
  if (actorMatch) classes.push('is-acting')
  if (targetMatch) classes.push('is-targeted')
  if (targetMatch && cue.phase === 'impact' && finite(cue.damage) > 0) classes.push('is-taking-damage')
  if (targetMatch && cue.phase === 'faint') classes.push('is-fainting')
  return classes.join(' ')
}

function RaidParticipantStrip({ participants, raid }) {
  const visible = asArray(participants).slice(0, 3)
  if (!visible.length) return null
  return (
    <div className="raid-standard-participant-strip" aria-label="협동 참가자 행동 상태">
      {visible.map((participant, index) => {
        const slot = actorSlot(participant, index)
        const own = Boolean(participant?.isOwn)
        const aiControlled = Boolean(participant?.aiControlled || participant?.isAi || participant?.isNpc)
        const submitted = Boolean(participant?.submitted ?? (own && (raid?.submitted ?? raid?.actionSubmitted)))
        const state = participant?.withdrawn ? '철수'
          : aiControlled ? 'AI 대행'
            : submitted ? '명령 완료' : '선택 중'
        return (
          <span
            key={participant?.slotId ?? participant?.slot ?? index}
            className={(own ? 'is-own ' : '') + (aiControlled ? 'is-ai ' : '') + (submitted ? 'is-submitted' : '')}
            title={'SLOT ' + (slot + 1) + ' · ' + state}
          >
            <i aria-hidden="true" />
            <b>{own ? 'YOU' : 'S' + (slot + 1)}</b>
            <small>{state}</small>
          </span>
        )
      })}
    </div>
  )
}

function RaidPartyIndicators({ actors, side }) {
  if (!actors.length) return null
  return (
    <div className={'raid-standard-party-indicators side-' + side} aria-label={(side === 'player' ? '아군' : '보스 진영') + ' 출전 포켓몬'}>
      {actors.map((actor, index) => (
        <span
          key={actor.battleId ?? actor.actorId ?? side + '-' + index}
          className={(actor.fainted || finite(actor.hp) <= 0 ? 'fainted' : '') + (actor.status ? ' statused' : '')}
          title={actor.name}
        ><i /></span>
      ))}
    </div>
  )
}

function RaidStagePokemon({ actor, side, slot, cue, animationMode }) {
  const isPlayer = side === 'player'
  const visual = raidFormVisual(actor, side)
  const sprite = visual?.src ?? (isPlayer ? actor.spriteBack : actor.spriteFront)
  const fallback = visual?.fallback ?? (isPlayer ? actor.spriteBackFallback : actor.spriteFrontFallback)
  return (
    <div
      className={battleStageClassName(side, actor, cue, slot) + (visual?.aura ? ' raid-form-' + visual.aura : '')}
      style={battleStageStyle(cue, animationMode)}
      tabIndex={0}
      role="img"
      aria-label={inspectorText(actor, side)}
      title={inspectorText(actor, side)}
    >
      <span className="battle-pokemon-shadow" aria-hidden="true" />
      <PokemonSprite
        animatedSrc={sprite}
        fallbackSrc={fallback}
        frameClassName={'battle-live-sprite-frame ' + (isPlayer ? 'player-sprite-frame' : 'opponent-sprite-frame')}
        className="battle-live-sprite"
        decodingMode="async"
        alt={actor.name}
      />
      {actor.teraActive && <TeraTypeJewel type={actor.teraType} />}
    </div>
  )
}

/**
 * Presentation-only raid battlefield. Commands and state transitions remain
 * server-owned; this component renders the currently active public actors.
 */
export default function RaidBattleStage({
  battle,
  raid,
  cue = null,
  animationMode = 'normal',
  showDamageNumbers = true,
  hpTransitionMs = 350,
  soundEnabled = true,
  onToggleSound,
  onOpenSettings,
  bossHud = null,
}) {
  const allies = activeRaidActors(battle, 'player').slice(0, 3).map(normalizeRaidActor)
  const enemies = activeRaidActors(battle, 'opponent').slice(0, 3).map(normalizeRaidActor)
  const rules = raidRules(battle)
  const turn = Math.max(1, Math.trunc(finite(battle?.turn ?? raid?.turnNumber ?? raid?.turn, 1)))
  const participantCount = asArray(raid?.participants).filter(participant => !participant?.withdrawn).length
  const isPrelude = isPreludePhase(raid, battle)
  const sceneClass = [
    'battle-arena',
    'raid-standard-battle-arena',
    'weather-' + rules.weather.id,
    'terrain-' + rules.terrain.id,
    'phase-' + (cue?.phase ?? 'command'),
  ].join(' ')

  return (
    <>
      <header className="battle-game-header raid-standard-battle-header">
        <div className="battle-title-lockup">
          <span><Crown size={14} /> CO-OP BOSS RAID</span>
          <strong>{isPrelude ? '전초전' : '협동 보스전'}</strong>
        </div>
        <div className="battle-game-turn" aria-label={turn + '턴'}>
          <small>TURN</small>
          <strong>{turn}</strong>
        </div>
        <div className="battle-header-cluster">
          <div className="battle-rule-hud" aria-label="현재 보스전 필드 규칙">
            <BattleRuleBadge
              id="raid-weather"
              category="날씨"
              label={rules.weather.label + turnSuffix(rules.weather.turns)}
              description={rules.weather.label + ' 상태가 현재 전장에 적용됩니다.'}
            />
            <BattleRuleBadge
              id="raid-terrain"
              category="필드"
              label={rules.terrain.label + turnSuffix(rules.terrain.turns)}
              description={rules.terrain.label + ' 효과가 현재 전장에 적용됩니다.'}
            />
            <BattleRuleBadge
              id="raid-format"
              category="배틀"
              label="3인 협동"
              description="각 트레이너는 자신의 포켓몬 한 마리로 보스전의 같은 턴에 행동합니다."
            />
          </div>
          <div className="battle-header-actions">
            <span><UsersRound size={14} /> {participantCount || allies.length || 1}인 협동</span>
            <button type="button" aria-label={soundEnabled ? '배틀 사운드 끄기' : '배틀 사운드 켜기'} onClick={onToggleSound}>
              {soundEnabled ? <Volume2 size={17} /> : <VolumeX size={17} />}
            </button>
            <button type="button" aria-label="환경 설정" onClick={onOpenSettings}><Settings size={17} /></button>
          </div>
        </div>
      </header>

      <section
        className={sceneClass}
        style={{ '--battle-hp-duration': Math.max(0, finite(hpTransitionMs, 350)) + 'ms' }}
        aria-label="협동 보스전 전장"
      >
        {(bossHud || participantCount) && <div className="raid-standard-boss-hud" aria-label="보스 상태">
          {bossHud}
          <RaidParticipantStrip participants={raid?.participants} raid={raid} />
        </div>}

        {enemies.map((actor, index) => {
          const slot = actorSlot(actor, index)
          return (
            <div className={stageStatusClassName('opponent', actor, cue, slot)} key={'opponent-status-' + (actor.battleId ?? slot)}>
              <BattleStatusPanel pokemon={actor} side="opponent" trainerName={actorOwnerLabel(actor, 'opponent')} publicView={false} />
              {index === 0 && <RaidPartyIndicators actors={enemies} side="opponent" />}
            </div>
          )
        })}
        {allies.map((actor, index) => {
          const slot = actorSlot(actor, index)
          return (
            <div className={stageStatusClassName('player', actor, cue, slot)} key={'player-status-' + (actor.battleId ?? slot)}>
              <BattleStatusPanel pokemon={actor} side="player" trainerName={actorOwnerLabel(actor, 'player')} publicView={!actor.isMine} />
              {index === 0 && <RaidPartyIndicators actors={allies} side="player" />}
            </div>
          )
        })}

        <div className={battleCameraClassName(cue)} style={battleStageStyle(cue, animationMode)}>
          <div className="battle-environment-backdrop" />
          <BattleFieldEffects terrainId={rules.terrain.id} />
          <div className="battle-terrain-aura" />
          <BattleWeatherEffects weatherId={rules.weather.id} layer="back" />
          <div className="battle-field-horizon" />
          <div className="battle-field-light battle-field-light-player" />
          <div className="battle-field-light battle-field-light-opponent" />
          <div className="battle-cinematic-flash" />
          <div className="battle-arena-scanlines" />
          <div className="battle-platform opponent-platform" />
          <div className="battle-platform player-platform" />

          {enemies.map((actor, index) => {
            const slot = actorSlot(actor, index)
            return <RaidStagePokemon actor={actor} side="opponent" slot={slot} cue={cue} animationMode={animationMode} key={'opponent-stage-' + (actor.battleId ?? slot)} />
          })}
          {allies.map((actor, index) => {
            const slot = actorSlot(actor, index)
            return <RaidStagePokemon actor={actor} side="player" slot={slot} cue={cue} animationMode={animationMode} key={'player-stage-' + (actor.battleId ?? slot)} />
          })}

          <BattleWeatherEffects weatherId={rules.weather.id} layer="front" />
          <BattleArenaEffects cue={cue} animationMode={animationMode} showDamageNumbers={showDamageNumbers} />
        </div>
      </section>
    </>
  )
}
