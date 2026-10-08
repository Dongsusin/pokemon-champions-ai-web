export const FACTORY_RUN_STORAGE_KEY = 'champions-factory-run-v1'

function validRun(run) {
  return run?.version === 1 && typeof run.id === 'string' && run.id.length > 0
    && ['standard', 'challenge'].includes(run.mode ?? 'standard')
    && ['selection', 'ready', 'battle', 'exchange', 'finished'].includes(run.phase)
    && Number.isSafeInteger(run.floor) && run.floor >= 1
    && Number.isSafeInteger(run.wins) && run.wins >= 0
    && Array.isArray(run.offers) && run.offers.length === 6
    && Array.isArray(run.party) && (run.phase === 'selection' ? run.party.length === 0 : run.party.length === 3)
    && Array.isArray(run.completedBattleIds)
    && (run.phase !== 'battle' || (run.battleId === `${run.id}:floor:${run.floor}` && run.opponentTeam?.pokemon?.length === 3))
}

export function loadFactoryRun(storage = window.localStorage) {
  const raw = storage.getItem(FACTORY_RUN_STORAGE_KEY)
  if (!raw) return null
  const run = JSON.parse(raw)
  if (!validRun(run)) throw new Error('저장된 팩토리 도전을 읽지 못했습니다. 기록을 보호하기 위해 새 도전을 시작하지 않습니다.')
  return run
}

export function saveFactoryRun(run, storage = window.localStorage) {
  if (!validRun(run)) throw new Error('팩토리 진행 기록이 올바르지 않습니다.')
  // Persist synchronously before changing the screen. A storage failure must
  // leave the previous checkpoint intact, not silently advance an unsaved run.
  storage.setItem(FACTORY_RUN_STORAGE_KEY, JSON.stringify(run))
  return run
}

export function checkpointFactoryBattle(run, battleId, state) {
  if (run?.phase !== 'battle' || run.battleId !== battleId || run.battleState === state) return run
  return { ...run, battleState: state }
}
