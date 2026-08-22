import { useEffect, useRef, useState } from 'react'
import {
  Gamepad2,
  Gauge,
  Hash,
  HeartPulse,
  Headphones,
  Megaphone,
  Mic2,
  MousePointer2,
  Music2,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Swords,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'

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

function SettingsModal({ settings, onChange, onClose, onReset }) {
  const [activeTab, setActiveTab] = useState('game')
  const closeButtonRef = useRef(null)
  const onCloseRef = useRef(onClose)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    const previouslyFocusedElement = document.activeElement
    const previousBodyOverflow = document.body.style.overflow
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onCloseRef.current()
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
      <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
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

        <nav className="settings-tabs" role="tablist" aria-label="설정 분류">
          <button
            className={activeTab === 'game' ? 'selected' : ''}
            type="button"
            role="tab"
            id="settings-game-tab"
            aria-controls="settings-game-panel"
            aria-selected={activeTab === 'game'}
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
            onClick={() => setActiveTab('audio')}
          >
            <Headphones size={20} /> 오디오
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
          ) : (
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
          )}
        </div>

        <footer className="settings-modal-footer">
          <button className="settings-reset-button" type="button" onClick={onReset}>
            <RotateCcw size={17} /> 기본값 복원
          </button>
          <button className="settings-confirm-button" type="button" onClick={onClose}>완료</button>
        </footer>
      </section>
    </div>
  )
}

export default SettingsModal
