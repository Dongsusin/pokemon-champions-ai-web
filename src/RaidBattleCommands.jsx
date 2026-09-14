import { useEffect, useMemo, useState } from 'react'
import { Activity, ArrowLeft, ArrowLeftRight, Flag, LoaderCircle, Swords } from 'lucide-react'
import { MoveMenu, MoveTargetMenu } from './BattleScreen'
import { activeRaidActors, createRaidCommandBattle } from './data/raidCommandView'

export default function RaidBattleCommands({ battle, raid, canAct, playing, submitted, busy, connected, waitText, onSubmit, onRevoke, onWithdraw, onPreview, renderActor }) {
  const [menu, setMenu] = useState('command')
  const [gimmick, setGimmick] = useState(null)
  const [moveIndex, setMoveIndex] = useState(null)
  const [confirm, setConfirm] = useState(false)
  const adapter = useMemo(() => createRaidCommandBattle(battle, raid), [battle, raid])
  const actor = adapter.battle.player.team[adapter.activeSlot]
  const options = adapter.battle.commandOptions[adapter.activeSlot]
  useEffect(() => { setMenu('command'); setGimmick(null); setMoveIndex(null); setConfirm(false) }, [raid.id, raid.decisionToken, raid.turnNumber])
  useEffect(() => { if (submitted) { setMenu('command'); setGimmick(null); setMoveIndex(null) } }, [submitted])
  const back = () => { onPreview?.(); setMenu('command'); setGimmick(null); setMoveIndex(null) }
  const submit = (index, target) => {
    if (!canAct) return
    onPreview?.()
    void onSubmit({ type: 'move', actorId: actor.battleId, moveIndex: index, ...(target ? { targetActorId: target.actorId ?? target.battleId } : {}), ...(gimmick ? { gimmickId: gimmick } : {}) })
  }
  const chooseMove = index => {
    const base = options?.moves.find(move => move.moveIndex === index)
    const option = gimmick ? base?.variants?.[gimmick] : base
    if (!canAct || !option || option.disabled) return
    const targets = option.targets ?? []
    if (targets.length <= 1) submit(index, targets[0])
    else { onPreview?.(); setMoveIndex(index); setMenu('target') }
  }
  const allActors = [...activeRaidActors(battle, 'player'), ...activeRaidActors(battle, 'opponent')]
  return <div className={`battle-command-panel raid-standard-commands${playing ? ' is-turn-locked' : ''}`} aria-busy={playing || busy}>
    {confirm ? <section className="raid-command-confirm" role="alertdialog" aria-label="보스전 기권 확인"><Flag size={26} /><strong>이번 보스전에서 철수할까요?</strong><p>남은 참가자들은 전투를 계속할 수 있습니다.</p><div><button type="button" onClick={() => setConfirm(false)}>계속 대전</button><button type="button" disabled={busy || !connected} onClick={onWithdraw}>철수하기</button></div></section>
      : (menu === 'party' || menu === 'overview') ? <section className="raid-standard-overview"><header><button type="button" onClick={back}><ArrowLeft size={15} /> 행동 선택</button><strong>{menu === 'party' ? '출전 포켓몬' : '현재 전황'}</strong></header>
        <p>{menu === 'party' ? '각자 선택한 한 마리로 전투합니다. 교체할 대기 포켓몬은 없습니다.' : `${battle.rules?.weather?.label ?? '맑음'} · ${battle.rules?.terrain?.label ?? '일반 필드'} · 포켓몬별 상태와 능력 변화를 확인하세요.`}</p>
        <div className="raid-standard-roster">{(menu === 'party' ? activeRaidActors(battle, 'player') : allActors).map((entry, index) => renderActor(entry, index))}</div></section>
        : !canAct ? <section className="raid-command-wait" role="status"><LoaderCircle className={playing || busy ? 'spin' : ''} size={25} /><strong>{playing ? '배틀 진행 중' : submitted ? '행동 선택 완료' : '명령 대기'}</strong><p>{playing ? '기술과 전투 결과를 순서대로 확인하고 있습니다.' : waitText}</p><div>{playing && <span>연출 후 다음 행동을 선택할 수 있습니다.</span>}{submitted && !playing && <button type="button" disabled={busy || !connected} onClick={onRevoke}>선택 취소</button>}<button type="button" onClick={() => setMenu('overview')}>전황 확인</button></div></section>
          : battle.forcedAction ? <section className="raid-command-wait"><strong>이전 기술의 행동이 이어집니다</strong><p>충전·반동으로 쉬는 턴 등은 자동으로 진행됩니다.</p><button type="button" onClick={() => onSubmit({ ...battle.forcedAction, actorId: actor.battleId })}>행동 계속</button></section>
          : menu === 'fight' ? <MoveMenu battle={adapter.battle} activeSlot={adapter.activeSlot} targetSlot={0} pendingGimmick={gimmick} onGimmick={setGimmick} onMove={chooseMove} onBack={back} onPreview={onPreview} />
            : menu === 'target' ? <MoveTargetMenu battle={adapter.battle} activeSlot={adapter.activeSlot} moveIndex={moveIndex} pendingGimmick={gimmick} onSelect={(slot, sideId) => submit(moveIndex, adapter.battle[sideId].team[slot])} onBack={() => setMenu('fight')} onPreview={onPreview} />
              : <section className="battle-command-menu"><div className="battle-command-buttons">
                <button className="fight" type="button" onClick={() => { onPreview?.(); setMenu('fight') }}><Swords size={21} /><span><small>FIGHT</small><strong>싸운다</strong></span></button>
                <button className="pokemon" type="button" onClick={() => { onPreview?.(); setMenu('party') }}><ArrowLeftRight size={21} /><span><small>POKÉMON</small><strong>포켓몬</strong></span></button>
                <button className="overview" type="button" onClick={() => { onPreview?.(); setMenu('overview') }}><Activity size={21} /><span><small>STATUS</small><strong>전황</strong></span></button>
                <button className="surrender" type="button" onClick={() => setConfirm(true)}><Flag size={21} /><span><small>GIVE UP</small><strong>기권</strong></span></button>
              </div></section>}
  </div>
}
