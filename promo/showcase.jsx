import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import BoxScreen from '../src/BoxScreen.jsx'
import ShopScreen from '../src/ShopScreen.jsx'
import CompetitionScreen from '../src/CompetitionScreen.jsx'
import BattleSelectScreen from '../src/BattleSelectScreen.jsx'
import TrainerSprite from '../src/TrainerSprite.jsx'
import PokemonSprite from '../src/PokemonSprite.jsx'
import { BATTLE_ITEMS, createCompleteBattleItemInventory } from '../src/data/shopData.js'
import { NATIONAL_DEX_COUNT, getSpeciesProfile, normalizePokemon } from '../src/data/trainingData.js'
import { POKEMON_POOL } from '../src/data/pokemonPool.js'
import { TRAINERS } from '../src/data/trainerTeams.js'
import { createSavedTeams } from '../src/data/teamData.js'
import { createCompetition } from '../src/data/competitionData.js'
import '../src/styles.css'
import '../src/screenRedesign.css'
import '../src/battleGen5.css'
import '../src/titleCleanup.css'
import '../src/battleGimmicks.css'
import './showcase.css'

// This isolated recording entry point imports the real game screens and data.
// Fixture ownership and team edits stay in React memory; no auth/save APIs run.
const FEATURED_SPECIES = [6, 448, 445, 658, 282, 376, 94, 149, 248, 257, 260, 254,
  9, 3, 212, 700, 196, 197, 143, 131, 350, 373, 437, 479, 468, 461,
  727, 730, 724, 778, 887, 823, 815, 812, 818, 937, 936, 1000, 983,
  908, 911, 914, 134, 135, 136, 470, 471, 242, 306, 635, 637, 706,
  778, 497, 500, 503, 405, 398, 389, 392, 395, 150, 384, 249, 250,
  382, 383, 483, 484, 487, 643, 644, 646, 716, 717, 888, 889, 1007, 1008]
const ITEMS = ['charizardite-x', 'lucarionite', 'choice-scarf', 'waterium-z--held', 'gardevoirite', 'metagrossite']
const STARTER_ROSTER = [...new Set(FEATURED_SPECIES)].map((speciesId, index) => normalizePokemon({
  captureId: `promo-${speciesId}`, speciesId, dexSpeciesId: speciesId,
  directDrawCount: 1, obtainedAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
  heldItemId: ITEMS[index] ?? null, shinyObtained: [6, 448, 94, 376, 384].includes(speciesId),
  nature: '노력', teraType: getSpeciesProfile(speciesId).types[0],
}))
const FEATURED_TRAINERS = ['레드', '난천', '성호', '단델', '아이리스', '지우']
  .map(name => TRAINERS.find(trainer => trainer.name === name)).filter(Boolean)
const REGIONS = {kanto: '관동', johto: '성도', hoenn: '호연', sinnoh: '신오', unova: '하나', kalos: '칼로스', alola: '알로라', galar: '가라르', paldea: '팔데아', anime: '애니메이션'}
const noop = () => {}
const twoFrames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))

function TrainerMontage({ selected, onSelect }) {
  const active = FEATURED_TRAINERS[selected % FEATURED_TRAINERS.length]
  const team = active.teams[0]
  const ace = getSpeciesProfile(active.ace?.speciesId ?? team.pokemon[0].speciesId)
  return <main className="promo-trainers">
    <header className="promo-trainer-heading">
      <span>CHAMPIONS AI · TRAINER LINEUP</span>
      <strong><b>{TRAINERS.length}</b>명의 AI 트레이너</strong>
      <p>각자의 파트너, 각자의 배틀 전략.</p>
    </header>
    <section className="promo-trainer-stage" key={active.id}>
      <span className="promo-stage-grid" />
      <span className="promo-stage-number">{String(selected + 1).padStart(2, '0')}</span>
      <div className="promo-trainer-identity">
        <span className="promo-tier">{active.tier} TIER <i /> {REGIONS[active.region] ?? active.region}</span>
        <h1>{active.name}</h1>
        <p>에이스 포켓몬 <strong>{ace.name}</strong></p>
        <div className="promo-trainer-team">
          {team.pokemon.map((pokemon, index) => {
            const profile = getSpeciesProfile(pokemon.speciesId)
            return <span key={`${pokemon.speciesId}-${index}`}><img src={profile.icon} alt={profile.name} /><small>{profile.name}</small></span>
          })}
        </div>
        <span className="promo-team-note">트레이너별 3개의 배틀 팀</span>
      </div>
      <div className="promo-trainer-art">
        <div className="promo-trainer-halo" />
        <PokemonSprite animatedSrc={ace.spriteFront} fallbackSrc={ace.spriteFrontFallback} frameClassName="promo-ace" alt={ace.name} />
        <TrainerSprite trainer={active} className="promo-featured-trainer" />
      </div>
    </section>
    <nav className="promo-trainer-lineup" aria-label="광고 등장 트레이너">
      {FEATURED_TRAINERS.map((trainer, index) => <button key={trainer.id} className={selected === index ? 'selected' : ''} onClick={() => onSelect(index)}>
        <TrainerSprite trainer={trainer} /><span><small>{REGIONS[trainer.region] ?? trainer.region}</small><strong>{trainer.name}</strong></span>
        <b>{trainer.tier}</b>
      </button>)}
    </nav>
  </main>
}

function Showcase() {
  const [scene, setScene] = useState(new URLSearchParams(location.search).get('scene') || 'pokemon')
  const [pokemon, setPokemon] = useState(STARTER_ROSTER)
  const [teams, setTeams] = useState(() => createSavedTeams(STARTER_ROSTER.slice(0, 6).map(p => p.captureId), STARTER_ROSTER.map(p => p.captureId)))
  const [activeTeamId, setActiveTeamId] = useState('team-1')
  const [trainer, setTrainer] = useState(Number(new URLSearchParams(location.search).get('trainer') || 1))
  const [balance, setBalance] = useState(30_000)
  const [inventory, setInventory] = useState(createCompleteBattleItemInventory)
  const playbackTimers = useRef([])
  const playbackFrames = useRef([])
  const activeTeam = teams.find(t => t.id === activeTeamId)
  const playerTeam = useMemo(() => activeTeam.pokemonIds.map(id => pokemon.find(p => p.captureId === id)), [activeTeam, pokemon])
  const competition = useMemo(() => {
    let seed = 731
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 }
    return createCompetition('tournament', playerTeam, 'CHAMPIONS', 'normal', random)
  }, [])
  const updatePokemon = (id, patch) => setPokemon(list => list.map(p => p.captureId === id ? {...p, ...patch} : p))
  const click = selector => { const node = document.querySelector(selector); node?.click(); return Boolean(node) }
  useEffect(() => {
    const stop = () => {
      playbackTimers.current.forEach(clearTimeout)
      playbackFrames.current.forEach(cancelAnimationFrame)
      playbackTimers.current = []
      playbackFrames.current = []
      document.querySelector('.promo-showcase')?.classList.remove('is-playing')
    }
    const later = (milliseconds, action) => playbackTimers.current.push(setTimeout(action, milliseconds))
    const scroll = (selector, end, duration = 3000, horizontal = false) => {
      const element = document.querySelector(selector)
      if (!element) return
      const property = horizontal ? 'scrollLeft' : 'scrollTop'
      const start = element[property]
      const startTime = performance.now()
      const extent = horizontal ? element.scrollWidth - element.clientWidth : element.scrollHeight - element.clientHeight
      const target = Math.max(0, Math.min(end, extent))
      const frame = now => {
        const progress = Math.min(1, (now - startTime) / duration)
        const eased = progress * progress * (3 - 2 * progress)
        element[property] = start + (target - start) * eased
        if (progress < 1) playbackFrames.current.push(requestAnimationFrame(frame))
      }
      playbackFrames.current.push(requestAnimationFrame(frame))
    }
    const selectPokemon = name => [...document.querySelectorAll('.team-box-card-select')]
      .find(node => node.getAttribute('aria-label')?.startsWith(`${name},`))?.click()
    const category = (selector, index) => document.querySelectorAll(selector)[index]?.click()
    window.promoShowcase = {
      ready: true,
      metadata: {trainerCount: TRAINERS.length, itemCount: BATTLE_ITEMS.length, nationalDex: NATIONAL_DEX_COUNT, drawPool: POKEMON_POOL.length, fixturePokemon: pokemon.length},
      setScene: async value => { setScene(value); await twoFrames(); return value },
      selectTrainer: async value => { setTrainer(typeof value === 'string' ? Math.max(0, FEATURED_TRAINERS.findIndex(t => t.name === value)) : Number(value)); await twoFrames() },
      selectPokemon: async name => { const button = [...document.querySelectorAll('.team-box-card-select')].find(node => node.getAttribute('aria-label')?.startsWith(`${name},`)); button?.click(); await twoFrames(); return Boolean(button) },
      scrollBox: (top, behavior = 'smooth') => document.querySelector('.team-box-grid')?.scrollTo({top, behavior}),
      itemCategory: async value => { const index = ['all', 'berry', 'held', 'gimmick'].indexOf(value); document.querySelectorAll('.shop-category-tabs button')[index]?.click(); await twoFrames() },
      itemNext: () => click('.shop-pagination button[aria-label="다음 페이지"]'),
      openEquip: () => click('.pokedex-held-item-button'),
      closeDialog: () => document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true})),
      state: () => ({scene, trainer, pokemon: pokemon.length, team: activeTeam.pokemonIds}),
      stop,
      play: () => {
        stop()
        const detail = new URLSearchParams(location.search).get('variant') === 'detail'
        if (scene === 'pokemon' && detail) {
          selectPokemon('루카리오')
          later(1300, () => selectPokemon('가디안'))
          later(2600, () => selectPokemon('리자몽'))
          later(3800, () => click('.pokedex-tera-button'))
          later(6100, () => document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true})))
          later(6500, () => click('.pokedex-shiny-toggle'))
        } else if (scene === 'pokemon') {
          later(700, () => scroll('.team-box-grid', 650, 5500))
          later(2200, () => selectPokemon('밀로틱'))
          later(4800, () => selectPokemon('레쿠쟈'))
        } else if (scene === 'trainers') {
          later(2000, () => setTrainer(0))
          later(4100, () => setTrainer(3))
          later(5900, () => setTrainer(5))
        } else if (scene === 'competition') {
          const surface = document.querySelector('.promo-showcase')
          surface?.classList.add('is-playing')
          // Select a different lead through the real selection buttons. No match
          // is started and the generated teams, rules and bracket stay intact.
          const selectLead = index => {
            const buttons = [...document.querySelectorAll('.competition-team-selection > div > button')]
            const selected = buttons.filter(button=>button.getAttribute('aria-pressed')==='true')
            const required = selected.length
            if (!buttons[index] || !required) return
            selected.forEach(button=>button.click())
            for (let offset=0;offset<required;offset++) buttons[(index+offset)%buttons.length].click()
          }
          later(2200, () => selectLead(1))
          later(5100, () => selectLead(2))
        } else if (scene === 'items') {
          category('.shop-category-tabs button', detail ? 3 : 2)
          later(2200, () => click('.shop-pagination button[aria-label="다음 페이지"]'))
          later(4000, () => click('.shop-pagination button[aria-label="다음 페이지"]'))
        } else if (scene === 'equipment') {
          if (!document.querySelector('.item-equip-panel')) click('.pokedex-held-item-button')
          later(500, () => category('.item-equip-categories button', 3))
          later(1800, () => scroll('.item-equip-grid', 900, 3500))
        }
        return {scene, detail, started:true}
      },
    }
  }, [scene, trainer, pokemon, activeTeam])
  useEffect(() => () => {
    playbackTimers.current.forEach(clearTimeout)
    playbackFrames.current.forEach(cancelAnimationFrame)
    playbackTimers.current = []
    playbackFrames.current = []
  }, [scene])
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const frame = requestAnimationFrame(() => {
      if (scene === 'equipment') click('.pokedex-held-item-button')
      if (scene === 'items' && params.has('category')) {
        const index = ['all', 'berry', 'held', 'gimmick'].indexOf(params.get('category'))
        document.querySelectorAll('.shop-category-tabs button')[index]?.click()
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [scene])
  return <div className={`app-shell promo-showcase scene-${scene} ${scene === 'items' ? 'shop-view' : scene === 'pokemon' || scene === 'equipment' ? 'pc-view' : 'battle-select-view'}`}>
    {scene === 'trainers' ? <TrainerMontage selected={trainer} onSelect={setTrainer} /> :
      scene === 'items' ? <ShopScreen balance={balance} inventory={inventory} onBack={noop} onPurchase={id => { const item = BATTLE_ITEMS.find(i => i.id === id); if (!inventory[id] && balance >= item.price) {setBalance(value => value - item.price); setInventory(value => ({...value, [id]: 1}))} }} /> :
      scene === 'competition' ? <CompetitionScreen competition={competition} onBack={noop} onStartBattle={noop} /> :
      scene === 'modes' ? <BattleSelectScreen pokemon={pokemon} teams={teams} activeTeamId={activeTeamId} onBack={noop} onOpenBox={() => setScene('pokemon')} onSelectTeam={setActiveTeamId} onStartMode={noop} /> :
      <BoxScreen pokemon={pokemon} teams={teams} activeTeamId={activeTeamId} teamIds={activeTeam.pokemonIds} inventory={inventory} onBack={noop}
        onEquipItem={(id, heldItemId) => updatePokemon(id, {heldItemId})}
        onSetTeraType={(id, teraType) => updatePokemon(id, {teraType})}
        onSetDynamaxMode={(id, dynamaxMode) => updatePokemon(id, {dynamaxMode})}
        onSelectTeam={setActiveTeamId} onToggleTeam={id => setTeams(list => list.map(team => team.id !== activeTeamId ? team : {...team, pokemonIds: team.pokemonIds.includes(id) ? team.pokemonIds.filter(value => value !== id) : [...team.pokemonIds, id].slice(0, 6)}))}
        onAutoTeam={noop} onConfirmTeam={noop} onOpenHatch={noop} onOpenShop={() => setScene('items')} />}
  </div>
}

createRoot(document.getElementById('root')).render(<Showcase />)
