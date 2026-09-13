import { useEffect, useRef, useState } from 'react'
import {
  ChartNoAxesCombined,
  Clock3,
  Gamepad2,
  Gauge,
  Hash,
  HeartPulse,
  Headphones,
  Link2,
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
  Trash2,
  Trophy,
  UserRound,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
import { AchievementCatalog } from './AchievementsScreen'
import PokemonUsagePanel from './PokemonUsagePanel'

const SETTINGS_TAB_IDS = ['game', 'audio', 'achievements', 'usage', 'account']

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

function AccountPanel({
  user,
  accountError,
  authBusy,
  autoLogin,
  onAutoLoginChange,
  onConnectGoogle,
  onDeleteAccount,
  onSignOut,
}) {
  const [deleteConfirmationOpen, setDeleteConfirmationOpen] = useState(false)
  const isGuest = Boolean(user?.isLocalGuest)
  const accountName = user?.displayName?.trim()
    || user?.email?.split('@')[0]
    || (isGuest ? '게스트 트레이너' : '트레이너')
  const accountInitial = Array.from(accountName)[0]?.toUpperCase() ?? 'T'

  return (
    <div
      className="settings-panel settings-account-panel"
      id="settings-account-panel"
      role="tabpanel"
      aria-labelledby="settings-account-tab"
    >
      <div className="settings-account-card">
        <span className="settings-account-avatar">
          {user?.photoURL ? <img src={user.photoURL} alt="" referrerPolicy="no-referrer" /> : accountInitial}
        </span>
        <span className="settings-account-copy">
          <small>{isGuest ? 'GUEST TRAINER' : 'GOOGLE TRAINER'}</small>
          <strong>{accountName}</strong>
          <span>{isGuest ? '이 PC 브라우저에만 저장' : user?.email}</span>
        </span>
        <span className="settings-account-badge">
          <ShieldCheck size={15} />
          {isGuest ? '로컬 저장' : '클라우드 동기화'}
        </span>
      </div>

      <div className="settings-account-persistence">
        <span className="settings-option-label">
          <Clock3 size={19} />
          <span>
            <strong>자동 로그인</strong>
            <small>다음 방문에도 현재 계정을 유지합니다.</small>
          </span>
        </span>
        <button
          className={`settings-account-toggle${autoLogin ? ' enabled' : ''}`}
          type="button"
          role="switch"
          aria-checked={autoLogin}
          disabled={authBusy}
          onClick={() => onAutoLoginChange(!autoLogin)}
        >
          <i aria-hidden="true" />
          <span>{autoLogin ? 'ON' : 'OFF'}</span>
        </button>
      </div>

      {isGuest && (
        <p className="settings-account-warning">
          게스트 데이터는 서버에 전송되지 않으며 이 브라우저의 데이터가 삭제되면 복구할 수 없습니다.
        </p>
      )}

      {accountError && <p className="settings-account-error" role="alert">{accountError}</p>}

      <div className="settings-account-actions">
        {isGuest && (
          <button className="settings-connect-account-button" type="button" disabled={authBusy} onClick={onConnectGoogle}>
            <Link2 size={19} />
            {authBusy ? 'Google 연결 중' : 'Google 계정에 연결'}
          </button>
        )}
        <button className="settings-sign-out-button" type="button" disabled={authBusy} onClick={onSignOut}>
          <LogOut size={19} />
          {authBusy ? '계정 전환 중' : '로그아웃하고 계정 전환'}
        </button>
      </div>

      <div className={`settings-account-danger-zone${deleteConfirmationOpen ? ' confirming' : ''}`}>
        <div className="settings-account-danger-copy">
          <span><Trash2 size={18} /></span>
          <span>
            <strong>계정 삭제</strong>
            <small>계정과 이 기기에 저장된 모든 게임 진행 데이터를 영구 삭제합니다.</small>
          </span>
        </div>

        {deleteConfirmationOpen ? (
          <div className="settings-account-delete-confirmation" role="alert">
            <p>
              {isGuest
                ? '게스트 계정, 포켓몬, 팀, 아이템과 VP가 모두 삭제되며 복구할 수 없습니다.'
                : '이 게임의 Google 로그인 계정, 서버 프로필, 포켓몬, 팀, 아이템과 VP가 모두 삭제되며 복구할 수 없습니다. Google 계정 자체는 삭제되지 않습니다.'}
            </p>
            <div>
              <button
                className="settings-account-delete-cancel"
                type="button"
                disabled={authBusy}
                onClick={() => setDeleteConfirmationOpen(false)}
              >
                취소
              </button>
              <button
                className="settings-account-delete-confirm"
                type="button"
                disabled={authBusy}
                onClick={onDeleteAccount}
              >
                <Trash2 size={17} />
                {authBusy ? '삭제 처리 중' : '영구 삭제'}
              </button>
            </div>
          </div>
        ) : (
          <button
            className="settings-delete-account-button"
            type="button"
            disabled={authBusy}
            onClick={() => setDeleteConfirmationOpen(true)}
          >
            계정 삭제
          </button>
        )}
      </div>
    </div>
  )
}

function SettingsModal({
  settings,
  achievementProgress,
  pokemonUsage,
  balance = 0,
  initialTab = 'game',
  user,
  accountError,
  authBusy,
  autoLogin,
  onAutoLoginChange,
  onConnectGoogle,
  onDeleteAccount,
  onChange,
  onClose,
  onReset,
  onSignOut,
}) {
  const [activeTab, setActiveTab] = useState(() => SETTINGS_TAB_IDS.includes(initialTab) ? initialTab : 'game')
  const closeButtonRef = useRef(null)
  const panelRef = useRef(null)
  const onCloseRef = useRef(onClose)

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
      if (event.key === 'Escape') onCloseRef.current()
      if (event.key !== 'Tab') return
      const controls = [...panelRef.current.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]')]
        .filter((element) => element.tabIndex >= 0 && element.getClientRects().length > 0)
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
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section className={`settings-modal${activeTab === 'achievements' ? ' settings-achievements-open' : ''}${activeTab === 'usage' ? ' settings-usage-open' : ''}`} ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header className="settings-modal-header">
          <span className="settings-header-mark"><Sparkles size={22} /></span>
          <div>
            <small>CHAMPIONS OPTIONS</small>
            <h2 id="settings-title">환경 설정</h2>
          </div>
          <button ref={closeButtonRef} className="settings-close-button" type="button" aria-label="설정 닫기" onClick={onClose}>
            <X size={22} />
          </button>
        </header>

        <nav className="settings-tabs" role="tablist" aria-label="설정 분류" onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
          event.preventDefault()
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
            aria-controls="settings-achievements-panel"
            aria-selected={activeTab === 'achievements'}
            tabIndex={activeTab === 'achievements' ? 0 : -1}
            onClick={() => setActiveTab('achievements')}
          >
            <Trophy size={20} /> 업적
          </button>
          <button className={activeTab === 'usage' ? 'selected' : ''} type="button" role="tab"
            id="settings-usage-tab" aria-controls="settings-usage-panel" aria-selected={activeTab === 'usage'}
            tabIndex={activeTab === 'usage' ? 0 : -1} onClick={() => setActiveTab('usage')}>
            <ChartNoAxesCombined size={20} /> 사용률
          </button>
          <button
            className={activeTab === 'account' ? 'selected' : ''}
            type="button"
            role="tab"
            id="settings-account-tab"
            aria-controls="settings-account-panel"
            aria-selected={activeTab === 'account'}
            tabIndex={activeTab === 'account' ? 0 : -1}
            onClick={() => setActiveTab('account')}
          >
            <UserRound size={20} /> 계정
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
              {pokemonUsage ? <PokemonUsagePanel usage={pokemonUsage} embedded /> : <p>사용률 집계를 준비하고 있습니다.</p>}
            </div>
          ) : (
            <AccountPanel
              user={user}
              accountError={accountError}
              authBusy={authBusy}
              autoLogin={autoLogin}
              onAutoLoginChange={onAutoLoginChange}
              onConnectGoogle={onConnectGoogle}
              onDeleteAccount={onDeleteAccount}
              onSignOut={onSignOut}
            />
          )}
        </div>

        <footer className="settings-modal-footer">
          {['game', 'audio'].includes(activeTab) && (
            <button className="settings-reset-button" type="button" onClick={onReset}>
              <RotateCcw size={17} /> 기본값 복원
            </button>
          )}
          <button className="settings-confirm-button" type="button" onClick={onClose}>완료</button>
        </footer>
      </section>
    </div>
  )
}

export default SettingsModal
