import LocalDataTools from './local/LocalDataTools.jsx'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChartNoAxesCombined,
  Clock3,
  Gamepad2,
  Gauge,
  Hash,
  HeartPulse,
  Headphones,
  LogOut,
  Megaphone,
  Mic2,
  MousePointer2,
  Music2,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Swords,
  Trophy,
  Type,
  BadgeCheck,
  UserRound,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
import { AchievementCatalog } from './AchievementsScreen'
import PokemonUsagePanel from './PokemonUsagePanel'
import { GAME_TEXT_SCALES } from './gameSettings'
import { isGameTextScaleLocked } from './gameTextScale'
import { NICKNAME_MIN_LENGTH, NICKNAME_MAX_LENGTH, normalizeTrainerNickname } from './data/trainerNickname'
import { getEarnedTrainerTitles, readTrainerTitle } from './data/titleData'
import './trainerNickname.css'

const SETTINGS_TAB_IDS = ['game', 'audio', 'achievements', 'usage', 'account']
const TEXT_SCALE_OPTIONS = GAME_TEXT_SCALES.map((value) => ({ value, label: `${value}배` }))

const ATTACK_ANIMATION_OPTIONS = [
  { value: 'skip', label: '스킵' },
  { value: 'normal', label: '1배' },
  { value: 'fast', label: '1.5배' },
  { value: 'very-fast', label: '2배' },
]

const HP_BAR_OPTIONS = [
  { value: 'slow', label: '느림' },
  { value: 'normal', label: '보통' },
  { value: 'fast', label: '빠름' },
  { value: 'instant', label: '즉시' },
]

const DAMAGE_NUMBER_OPTIONS = [
  { value: true, label: '표시' },
  { value: false, label: '숨김' },
]

const PLAYER_GENDER_OPTIONS = [
  { value: 'male', label: '남성' },
  { value: 'female', label: '여성' },
]

const AUDIO_CHANNELS = [
  { key: 'master', label: '전체 음량', icon: SlidersHorizontal },
  { key: 'music', label: '배경음', icon: Music2 },
  { key: 'ui', label: '메뉴·UI', icon: MousePointer2 },
  { key: 'event', label: '알림·이벤트', icon: Megaphone },
  { key: 'effects', label: '배틀 기술음', icon: Swords },
  { key: 'cries', label: '포켓몬 울음소리', icon: Mic2 },
]

function SegmentedSetting({ label, icon: Icon, value, options, onChange }) {
  return (
    <div className="settings-option-row">
      <span className="settings-option-label"><Icon size={19} /><strong>{label}</strong></span>
      <div className="settings-segmented-control" role="group" aria-label={label}>
        {options.map((option) => (
          <button
            className={value === option.value ? 'selected' : ''}
            type="button"
            aria-pressed={value === option.value}
            key={String(option.value)}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function AudioSlider({ channel, value, disabled, onChange }) {
  const Icon = channel.icon
  return (
    <label className={`settings-audio-row${disabled ? ' is-disabled' : ''}`}>
      <span className="settings-option-label"><Icon size={19} /><strong>{channel.label}</strong></span>
      <span className="settings-range-control">
        <input
          type="range"
          min="0"
          max="100"
          step="1"
          value={value}
          disabled={disabled}
          aria-label={`${channel.label} ${value}%`}
          style={{ '--settings-range-value': `${value}%` }}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <output>{value}%</output>
      </span>
    </label>
  )
}

function TrainerTitleEditor({ title, titles, authBusy, saving, onSetTitle }) {
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const mountedRef = useRef(false)
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false } }, [])
  const unavailable = authBusy || saving || typeof onSetTitle !== 'function'
  const selected = titles.find((entry) => entry.id === title) ?? null

  async function submit(value) {
    if (unavailable || value === title) return
    setError('')
    setNotice('')
    try {
      await onSetTitle(value)
      if (mountedRef.current) setNotice(value ? '칭호를 적용했습니다.' : '칭호를 해제했습니다.')
    } catch (error) {
      if (mountedRef.current) setError(error?.message || '칭호를 저장하지 못했습니다. 다시 시도해 주세요.')
    }
  }

  return <section className="settings-title" aria-label="트레이너 칭호 설정" aria-busy={saving}>
    <div className="settings-nickname-heading"><BadgeCheck size={19} aria-hidden="true" /><strong>트레이너 칭호</strong></div>
    <p className="settings-nickname-description">업적으로 얻은 칭호를 트레이너 이름 옆에 표시합니다.</p>
    {titles.length === 0
      ? <p className="settings-title-empty">아직 획득한 칭호가 없습니다. 업적을 달성하면 여기에서 선택할 수 있습니다.</p>
      : <>
        <label className="settings-nickname-label" htmlFor="settings-trainer-title">칭호</label>
        <select id="settings-trainer-title" className="settings-title-select" value={title} disabled={unavailable}
          onChange={(event) => void submit(event.target.value)}>
          <option value="">칭호 표시 안 함</option>
          {titles.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
        </select>
        <p className="settings-title-preview">{selected ? selected.description : '칭호를 선택하면 설명이 표시됩니다.'}</p>
      </>}
    {error && <p className="settings-nickname-error" role="alert">{error}</p>}
    {notice && <p className="settings-nickname-notice" role="status">{notice}</p>}
  </section>
}

function TrainerNicknameEditor({ nickname, accountName, authBusy, saving, onSetNickname }) {
  const [draft, setDraft] = useState(nickname)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const pendingRef = useRef(false)
  const composingRef = useRef(false)
  const inputRef = useRef(null)
  const wasSavingRef = useRef(false)
  const mountedRef = useRef(false)
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false } }, [])
  useEffect(() => { setDraft(nickname) }, [nickname])
  useEffect(() => {
    if (wasSavingRef.current && !saving) inputRef.current?.focus({ preventScroll: true })
    wasSavingRef.current = saving
  }, [saving])
  const unavailable = authBusy || saving || typeof onSetNickname !== 'function'

  async function submit(value) {
    if (unavailable || pendingRef.current || composingRef.current) return
    setError('')
    setNotice('')
    let normalized
    try { normalized = normalizeTrainerNickname(value) } catch (error) {
      setError(error.message || '닉네임을 확인해 주세요.')
      return
    }
    pendingRef.current = true
    try {
      await onSetNickname(normalized)
      if (mountedRef.current) {
        setDraft(normalized)
        setNotice(normalized ? '닉네임을 저장했습니다.' : '닉네임을 해제했습니다. 기본 표시 이름을 사용합니다.')
      }
    } catch (error) {
      if (mountedRef.current) setError(error?.message || '닉네임을 저장하지 못했습니다. 다시 시도해 주세요.')
    } finally { pendingRef.current = false }
  }

  return <form className="settings-nickname" aria-label="트레이너 닉네임 설정" aria-busy={saving}
    onSubmit={event => { event.preventDefault(); if (draft.trim()) void submit(draft) }}>
    <div className="settings-nickname-heading"><UserRound size={19} aria-hidden="true" /><strong>트레이너 닉네임</strong></div>
    <p className="settings-nickname-description">이 기기의 게스트 트레이너 이름입니다. 변경한 이름과 칭호도 로컬에 저장합니다.</p>
    <div className="settings-nickname-current"><span>현재 표시 이름</span><strong>{accountName}</strong></div>
    <label className="settings-nickname-label" htmlFor="settings-trainer-nickname">닉네임</label>
    <div className="settings-nickname-input-row">
      <input ref={inputRef} id="settings-trainer-nickname" type="text" autoComplete="off" spellCheck={false}
        value={draft} disabled={unavailable} placeholder="사용할 닉네임을 입력하세요"
        aria-invalid={Boolean(error)} aria-describedby={`settings-nickname-rules${error ? ' settings-nickname-error' : ''}`}
        onChange={event => { setDraft(event.target.value); setError(''); setNotice('') }}
        onCompositionStart={() => { composingRef.current = true }}
        onCompositionEnd={() => { composingRef.current = false }}
        onKeyDown={event => {
          if (event.key === 'Enter' && (composingRef.current || event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault()
        }} />
      <button className="settings-nickname-save" type="submit" disabled={unavailable || !draft.trim() || draft === nickname}>
        {saving ? '저장 중…' : '닉네임 저장'}
      </button>
    </div>
    <div className="settings-nickname-rules"><span id="settings-nickname-rules">{NICKNAME_MIN_LENGTH}~{NICKNAME_MAX_LENGTH}자 · 한글, 영문, 숫자, 공백, _와 - 사용 가능</span><span className="settings-nickname-counter">{Array.from(draft).length} / {NICKNAME_MAX_LENGTH}</span></div>
    {error && <p id="settings-nickname-error" className="settings-nickname-error" role="alert">{error}</p>}
    {notice && <p className="settings-nickname-notice" role="status">{notice}</p>}
    {nickname && <button className="settings-nickname-clear" type="button" disabled={unavailable} onClick={() => void submit('')}><RotateCcw size={15} aria-hidden="true" />닉네임 해제</button>}
    {saving && <p className="settings-nickname-progress" role="status">저장 결과를 확인하고 있습니다. 잠시만 기다려 주세요.</p>}
  </form>
}

function AccountPanel({ user, accountError, authBusy, autoLogin, onAutoLoginChange,
  onSignOut, onSetNickname, nicknameSaving, onSetTitle, titleSaving, earnedTitles = [] }) {
  const accountName = user?.nickname || user?.displayName || '로컬 트레이너'
  return <div className="settings-panel settings-account-panel" id="settings-account-panel" role="tabpanel" aria-labelledby="settings-account-tab">
    <div className="settings-account-card"><span className="settings-account-avatar">{Array.from(accountName)[0]}</span>
      <span className="settings-account-copy"><small>LOCAL GUEST</small><strong>{accountName}</strong><span>이 기기의 게스트 · 진행 기록 유지</span></span>
      <span className="settings-account-badge"><ShieldCheck size={15} /> 로컬 저장</span></div>
    <TrainerNicknameEditor key={user?.uid} nickname={user?.nickname ?? ''} accountName={accountName}
      authBusy={authBusy} saving={nicknameSaving} onSetNickname={onSetNickname} />
    <TrainerTitleEditor key={`${user?.uid}:title`} title={readTrainerTitle(user?.title)} titles={earnedTitles}
      authBusy={authBusy} saving={titleSaving} onSetTitle={onSetTitle} />
    <LocalDataTools />
    <div className="settings-account-persistence"><span className="settings-option-label"><Clock3 size={19} /><span><strong>자동으로 이어서 시작</strong><small>다음 실행에서 이 게스트의 기록을 불러옵니다.</small></span></span>
      <button className={`settings-account-toggle${autoLogin ? ' enabled' : ''}`} type="button" role="switch" aria-checked={autoLogin} disabled={authBusy}
        onClick={() => { void onAutoLoginChange(!autoLogin).catch(() => {}) }}><i /><span>{autoLogin ? 'ON' : 'OFF'}</span></button></div>
    {accountError && <p className="settings-account-error" role="alert">{accountError}</p>}
    <div className="settings-account-actions"><button className="settings-sign-out-button" type="button" disabled={authBusy || nicknameSaving || titleSaving} onClick={onSignOut}><LogOut size={19} /> 저장하고 시작 화면으로</button></div>
    <p className="settings-nickname-description">시작 화면으로 돌아가거나 게임을 종료해도 게스트와 모든 진행 기록이 유지됩니다.</p>
  </div>
}

function SettingsModal({
  settings,
  achievementProgress,
  pokemonUsage,
  itemInventory = {},
  balance = 0,
  initialTab = 'game',
  user,
  accountError,
  authBusy,
  autoLogin,
  onAutoLoginChange,
  onChange,
  onClose,
  onReset,
  onSignOut,
  onSetNickname,
  onSetTitle,
}) {
  const [activeTab, setActiveTab] = useState(() => SETTINGS_TAB_IDS.includes(initialTab) ? initialTab : 'game')
  const earnedTitles = useMemo(() => getEarnedTrainerTitles(achievementProgress), [achievementProgress])
  const textScaleLocked = isGameTextScaleLocked()
  const [nicknameSaving, setNicknameSaving] = useState(false)
  const [titleSaving, setTitleSaving] = useState(false)
  const nicknamePendingRef = useRef(false)
  const closeButtonRef = useRef(null)
  const panelRef = useRef(null)
  const onCloseRef = useRef(onClose)
  const closeSettings = () => { if (!nicknamePendingRef.current) onCloseRef.current?.() }
  const setNickname = typeof onSetNickname === 'function' ? async value => {
    if (nicknamePendingRef.current) return
    nicknamePendingRef.current = true
    setNicknameSaving(true)
    try { await onSetNickname(value) } finally {
      nicknamePendingRef.current = false
      setNicknameSaving(false)
    }
  } : undefined
  // The nickname and the title write the same profile record, so they share one
  // in-flight guard and the close button waits for either of them.
  const setTitle = typeof onSetTitle === 'function' ? async value => {
    if (nicknamePendingRef.current) return
    nicknamePendingRef.current = true
    setTitleSaving(true)
    try { await onSetTitle(value) } finally {
      nicknamePendingRef.current = false
      setTitleSaving(false)
    }
  } : undefined

  useEffect(() => {
    setActiveTab(SETTINGS_TAB_IDS.includes(initialTab) ? initialTab : 'game')
  }, [initialTab])

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    const previouslyFocusedElement = document.activeElement
    const previousBodyOverflow = document.body.style.overflow
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !nicknamePendingRef.current) onCloseRef.current()
      if (event.key !== 'Tab') return
      const controls = [...panelRef.current.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]')]
        .filter((element) => !element.disabled && element.tabIndex >= 0 && element.getClientRects().length > 0)
      if (!controls.length) { event.preventDefault(); panelRef.current.focus({ preventScroll: true }); return }
      const first = controls[0]
      const last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }

    document.body.style.overflow = 'hidden'
    closeButtonRef.current?.focus()
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousBodyOverflow
      window.removeEventListener('keydown', handleKeyDown)
      previouslyFocusedElement?.focus?.()
    }
  }, [])

  return (
    <div
      className="settings-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeSettings()
      }}
    >
      <section className={`settings-modal${activeTab === 'achievements' ? ' settings-achievements-open' : ''}${activeTab === 'usage' ? ' settings-usage-open' : ''}`} ref={panelRef} role="dialog" tabIndex={-1} aria-modal="true" aria-labelledby="settings-title" aria-busy={nicknameSaving}>
        <header className="settings-modal-header">
          <span className="settings-header-mark"><Sparkles size={22} /></span>
          <div>
            <small>CHAMPIONS OPTIONS</small>
            <h2 id="settings-title">환경 설정</h2>
          </div>
          <button ref={closeButtonRef} className="settings-close-button" type="button" aria-label="설정 닫기" disabled={nicknameSaving} onClick={closeSettings}>
            <X size={22} />
          </button>
        </header>

        <nav className="settings-tabs" role="tablist" aria-label="설정 분류" onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
          event.preventDefault()
          if (nicknamePendingRef.current) return
          const current = SETTINGS_TAB_IDS.indexOf(activeTab)
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? SETTINGS_TAB_IDS.length - 1
            : (current + (event.key === 'ArrowRight' ? 1 : -1) + SETTINGS_TAB_IDS.length) % SETTINGS_TAB_IDS.length
          const id = SETTINGS_TAB_IDS[next]
          setActiveTab(id)
          document.getElementById(`settings-${id}-tab`)?.focus()
        }}>
          <button
            className={activeTab === 'game' ? 'selected' : ''}
            type="button"
            role="tab"
            id="settings-game-tab"
            disabled={nicknameSaving}
            aria-controls="settings-game-panel"
            aria-selected={activeTab === 'game'}
            tabIndex={activeTab === 'game' ? 0 : -1}
            onClick={() => setActiveTab('game')}
          >
            <Gamepad2 size={20} /> 게임
          </button>
          <button
            className={activeTab === 'audio' ? 'selected' : ''}
            type="button"
            role="tab"
            id="settings-audio-tab"
            disabled={nicknameSaving}
            aria-controls="settings-audio-panel"
            aria-selected={activeTab === 'audio'}
            tabIndex={activeTab === 'audio' ? 0 : -1}
            onClick={() => setActiveTab('audio')}
          >
            <Headphones size={20} /> 오디오
          </button>
          <button
            className={activeTab === 'achievements' ? 'selected' : ''}
            type="button"
            role="tab"
            id="settings-achievements-tab"
            disabled={nicknameSaving}
            aria-controls="settings-achievements-panel"
            aria-selected={activeTab === 'achievements'}
            tabIndex={activeTab === 'achievements' ? 0 : -1}
            onClick={() => setActiveTab('achievements')}
          >
            <Trophy size={20} /> 업적
          </button>
          <button className={activeTab === 'usage' ? 'selected' : ''} type="button" role="tab"
            id="settings-usage-tab" disabled={nicknameSaving} aria-controls="settings-usage-panel" aria-selected={activeTab === 'usage'}
            tabIndex={activeTab === 'usage' ? 0 : -1} onClick={() => setActiveTab('usage')}>
            <ChartNoAxesCombined size={20} /> 사용률
          </button>
          <button
            className={activeTab === 'account' ? 'selected' : ''}
            type="button"
            role="tab"
            id="settings-account-tab"
            disabled={nicknameSaving}
            aria-controls="settings-account-panel"
            aria-selected={activeTab === 'account'}
            tabIndex={activeTab === 'account' ? 0 : -1}
            onClick={() => setActiveTab('account')}
          >
            <UserRound size={20} /> 저장 · 트레이너
          </button>
        </nav>

        <div className="settings-modal-body">
          {activeTab === 'game' ? (
            <div
              className="settings-panel"
              id="settings-game-panel"
              role="tabpanel"
              aria-labelledby="settings-game-tab"
              key="game-settings"
            >
              {!textScaleLocked && <>
                <SegmentedSetting
                  label="글자 크기"
                  icon={Type}
                  value={settings.game.textScale}
                  options={TEXT_SCALE_OPTIONS}
                  onChange={(value) => onChange('game', 'textScale', value)}
                />
                <p className="settings-text-scale-preview" aria-live="polite">
                  현재 글자 크기 {settings.game.textScale}배 · 기본 크기는 1배입니다.
                </p>
              </>}
              <SegmentedSetting
                label="플레이어 캐릭터"
                icon={UserRound}
                value={settings.game.playerGender}
                options={PLAYER_GENDER_OPTIONS}
                onChange={(value) => onChange('game', 'playerGender', value)}
              />
              <SegmentedSetting
                label="공격 애니메이션"
                icon={Gauge}
                value={settings.game.attackAnimation}
                options={ATTACK_ANIMATION_OPTIONS}
                onChange={(value) => onChange('game', 'attackAnimation', value)}
              />
              <SegmentedSetting
                label="HP 바 속도"
                icon={HeartPulse}
                value={settings.game.hpBarSpeed}
                options={HP_BAR_OPTIONS}
                onChange={(value) => onChange('game', 'hpBarSpeed', value)}
              />
              <SegmentedSetting
                label="데미지 숫자"
                icon={Hash}
                value={settings.game.showDamageNumbers}
                options={DAMAGE_NUMBER_OPTIONS}
                onChange={(value) => onChange('game', 'showDamageNumbers', value)}
              />
            </div>
          ) : activeTab === 'audio' ? (
            <div
              className={`settings-panel settings-audio-panel${settings.audio.enabled ? '' : ' is-muted'}`}
              id="settings-audio-panel"
              role="tabpanel"
              aria-labelledby="settings-audio-tab"
              key="audio-settings"
            >
              <div className="settings-audio-master-toggle">
                <span className="settings-option-label">
                  {settings.audio.enabled ? <Volume2 size={20} /> : <VolumeX size={20} />}
                  <strong>전체 사운드</strong>
                </span>
                <button
                  className={settings.audio.enabled ? 'enabled' : ''}
                  type="button"
                  aria-pressed={settings.audio.enabled}
                  onClick={() => onChange('audio', 'enabled', !settings.audio.enabled)}
                >
                  <i /> {settings.audio.enabled ? 'ON' : 'OFF'}
                </button>
              </div>
              {AUDIO_CHANNELS.map((channel) => (
                <AudioSlider
                  channel={channel}
                  value={settings.audio[channel.key]}
                  disabled={!settings.audio.enabled}
                  key={channel.key}
                  onChange={(value) => onChange('audio', channel.key, value)}
                />
              ))}
            </div>
          ) : activeTab === 'achievements' ? (
            <div className="settings-achievements-panel" id="settings-achievements-panel" role="tabpanel" aria-labelledby="settings-achievements-tab">
              <AchievementCatalog progress={achievementProgress} balance={balance} embedded />
            </div>
          ) : activeTab === 'usage' ? (
            <div className="settings-usage-panel" id="settings-usage-panel" role="tabpanel" aria-labelledby="settings-usage-tab">
              {pokemonUsage ? <PokemonUsagePanel usage={pokemonUsage} inventory={itemInventory} embedded /> : <p>사용률 집계를 준비하고 있습니다.</p>}
            </div>
          ) : (
            <AccountPanel
              user={user}
              accountError={accountError}
              authBusy={authBusy}
              autoLogin={autoLogin}
              onAutoLoginChange={onAutoLoginChange}
              onSignOut={onSignOut}
              onSetNickname={setNickname}
              nicknameSaving={nicknameSaving}
              onSetTitle={setTitle}
              titleSaving={titleSaving}
              earnedTitles={earnedTitles}
            />
          )}
        </div>

        <footer className="settings-modal-footer">
          {['game', 'audio'].includes(activeTab) && (
            <button className="settings-reset-button" type="button" onClick={onReset}>
              <RotateCcw size={17} /> 기본값 복원
            </button>
          )}
          <button className="settings-confirm-button" type="button" disabled={nicknameSaving} onClick={closeSettings}>완료</button>
        </footer>
      </section>
    </div>
  )
}

export default SettingsModal
