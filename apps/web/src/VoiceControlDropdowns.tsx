import { useState, useRef, useEffect, useCallback, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Headphones,
  HeadphoneOff,
  Mic,
  MicOff,
  Radio,
  Settings,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { useMedia } from './media';

interface VoiceControlsProps {
  media: ReturnType<typeof useMedia>;
  onOpenSettings: (tab?: string) => void;
}

/**
 * Segmented live audio activity meter inspired by Discord's voice level bar.
 * Illuminates 24 vertical bars according to the live microphone energy level (0.0 to 1.0).
 */
export function VoiceInputMeter({ level }: { level: number }) {
  const barCount = 24;
  const activeCount = Math.round(Math.max(0, Math.min(1, level)) * barCount);

  return (
    <div
      className="voice-input-meter"
      role="meter"
      aria-label="Microphone activity level"
      aria-valuenow={Math.round(level * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      {Array.from({ length: barCount }, (_, i) => {
        const isActive = i < activeCount;
        return (
          <span
            key={i}
            className={`meter-bar ${isActive ? 'active' : ''} ${i > 18 ? 'high' : i > 12 ? 'medium' : 'normal'}`}
          />
        );
      })}
    </div>
  );
}

export function VoiceControls({ media, onOpenSettings }: VoiceControlsProps) {
  const [micOpen, setMicOpen] = useState(false);
  const [headphoneOpen, setHeadphoneOpen] = useState(false);
  const [testingOutput, setTestingOutput] = useState(false);

  const micDropdownRef = useRef<HTMLButtonElement>(null);
  const headphoneDropdownRef = useRef<HTMLButtonElement>(null);
  const micPopoverRef = useRef<HTMLDivElement>(null);
  const headphonePopoverRef = useRef<HTMLDivElement>(null);

  // Monitor microphone activity when mic popover is open
  useEffect(() => {
    if (micOpen) {
      void media.startInputMonitor();
    } else {
      media.stopInputMonitor();
    }
  }, [micOpen, media.startInputMonitor, media.stopInputMonitor]);

  // Click-outside dismissal
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (
        micOpen &&
        micPopoverRef.current &&
        !micPopoverRef.current.contains(target) &&
        !micDropdownRef.current?.contains(target)
      ) {
        setMicOpen(false);
      }
      if (
        headphoneOpen &&
        headphonePopoverRef.current &&
        !headphonePopoverRef.current.contains(target) &&
        !headphoneDropdownRef.current?.contains(target)
      ) {
        setHeadphoneOpen(false);
      }
    }

    if (micOpen || headphoneOpen) {
      document.addEventListener('pointerdown', handleClickOutside);
      return () => document.removeEventListener('pointerdown', handleClickOutside);
    }
  }, [micOpen, headphoneOpen]);

  // Keyboard navigation & Escape key handling
  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>, which: 'mic' | 'headphone') => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (which === 'mic') {
          setMicOpen(false);
          micDropdownRef.current?.focus();
        } else {
          setHeadphoneOpen(false);
          headphoneDropdownRef.current?.focus();
        }
      }
    },
    [],
  );

  const inputDevices = media.devices.filter(d => d.kind === 'audioinput');
  const outputDevices = media.devices.filter(d => d.kind === 'audiooutput');

  const suppressionStatusText = ({
    off: 'Suppression: off',
    native: 'Browser WebRTC active',
    unverified: 'Browser WebRTC requested',
    unavailable: 'Browser WebRTC unavailable',
    starting: 'Loading RNNoise…',
    rnnoise: 'RNNoise active · on device',
    fallback: 'RNNoise fallback · standard',
  } as const)[
    media.micTest.status === 'running' || media.micTest.status === 'starting'
      ? media.testProcessing
      : media.microphoneProcessing
  ] || 'Standard';

  const handleTestOutput = async () => {
    setTestingOutput(true);
    try {
      await media.testOutputSound();
    } finally {
      setTimeout(() => setTestingOutput(false), 550);
    }
  };

  return (
    <div className="voice-controls-container" aria-label="Voice and audio controls">
      {/* 1. Microphone Split Button */}
      <div className="voice-split-group" role="group" aria-label="Microphone controls">
        <button
          type="button"
          className={`voice-action-btn ${media.muted ? 'danger-text is-muted' : ''}`}
          title={media.muted ? 'Unmute' : 'Mute'}
          aria-label={media.muted ? 'Unmute microphone' : 'Mute microphone'}
          onClick={media.toggleMute}
        >
          {media.muted ? <MicOff size={16} /> : <Mic size={16} />}
        </button>
        <button
          ref={micDropdownRef}
          type="button"
          className={`voice-dropdown-btn ${micOpen ? 'active' : ''}`}
          title="Input Options"
          aria-label="Input Options"
          aria-haspopup="dialog"
          aria-expanded={micOpen}
          onClick={() => {
            setMicOpen(prev => !prev);
            setHeadphoneOpen(false);
          }}
        >
          {micOpen ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
        </button>
      </div>

      {/* 2. Headphone Split Button */}
      <div className="voice-split-group" role="group" aria-label="Headphone controls">
        <button
          type="button"
          className={`voice-action-btn ${media.deafened ? 'danger-text is-deafened' : ''}`}
          title={media.deafened ? 'Undeafen' : 'Deafen'}
          aria-label={media.deafened ? 'Undeafen headphones' : 'Deafen headphones'}
          onClick={media.toggleDeafen}
        >
          {media.deafened ? <HeadphoneOff size={16} /> : <Headphones size={16} />}
        </button>
        <button
          ref={headphoneDropdownRef}
          type="button"
          className={`voice-dropdown-btn ${headphoneOpen ? 'active' : ''}`}
          title="Output Options"
          aria-label="Output Options"
          aria-haspopup="dialog"
          aria-expanded={headphoneOpen}
          onClick={() => {
            setHeadphoneOpen(prev => !prev);
            setMicOpen(false);
          }}
        >
          {headphoneOpen ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
        </button>
      </div>

      {/* --- Microphone Popover --- */}
      {micOpen && (
        <div
          ref={micPopoverRef}
          className="voice-popover mic-popover"
          role="dialog"
          aria-label="Input Options"
          onKeyDown={e => handleKeyDown(e, 'mic')}
        >
          <div className="voice-popover-header">
            <h4>Input Options</h4>
            <span className="popover-status-badge">{suppressionStatusText}</span>
          </div>

          <div className="voice-popover-body">
            {/* Input Device */}
            <div className="popover-section">
              <label htmlFor="voice-input-device-select" className="popover-section-label">
                INPUT DEVICE
              </label>
              <select
                id="voice-input-device-select"
                aria-label="Input device"
                value={media.settings.inputDevice}
                onChange={e => media.setSettings({ inputDevice: e.target.value })}
              >
                <option value="">System default</option>
                {inputDevices.map((device, index) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `Microphone ${index + 1} — permission needed`}
                  </option>
                ))}
              </select>
              {inputDevices.length === 0 && (
                <button
                  type="button"
                  className="popover-link-btn"
                  onClick={() => void media.refreshDevices()}
                >
                  Detect audio devices
                </button>
              )}
            </div>

            {/* Input Volume */}
            <div className="popover-section">
              <div className="popover-slider-header">
                <span className="popover-section-label">INPUT VOLUME</span>
                <span className="popover-value-display">
                  {Math.round(media.settings.inputVolume * 100)}%
                </span>
              </div>
              <input
                type="range"
                aria-label="Input volume"
                min="0"
                max="2"
                step="0.05"
                value={media.settings.inputVolume}
                onChange={e => media.setSettings({ inputVolume: Number(e.target.value) })}
              />
            </div>

            {/* Live Input Level Meter */}
            <div className="popover-section">
              <div className="popover-slider-header">
                <span className="popover-section-label">INPUT LEVEL</span>
                <span className="popover-value-display">
                  {media.inputLevel > 0.05 ? `${Math.round(media.inputLevel * 100)}%` : 'Listening'}
                </span>
              </div>
              <VoiceInputMeter level={media.inputLevel} />
            </div>

            {/* Input Mode: Voice Activity / Push to Talk */}
            <div className="popover-section">
              <span className="popover-section-label">INPUT MODE</span>
              <div className="popover-toggle-row">
                <label className="popover-checkbox-label">
                  <input
                    type="checkbox"
                    checked={media.settings.pushToTalk}
                    onChange={e => media.setSettings({ pushToTalk: e.target.checked })}
                  />
                  <span>Push to Talk</span>
                </label>
                {media.settings.pushToTalk && (
                  <kbd className="popover-ptt-key">
                    {media.settings.pushToTalkKey || 'Ctrl+Shift+Space'}
                  </kbd>
                )}
              </div>
            </div>

            {/* Noise Suppression */}
            <div className="popover-section">
              <span className="popover-section-label">NOISE SUPPRESSION</span>
              <div className="popover-segmented-control" role="radiogroup" aria-label="Noise suppression mode">
                <button
                  type="button"
                  className={`segmented-btn ${!media.settings.noiseSuppression ? 'selected' : ''}`}
                  role="radio"
                  aria-checked={!media.settings.noiseSuppression}
                  onClick={() => media.setSettings({ noiseSuppression: false })}
                >
                  Off
                </button>
                <button
                  type="button"
                  className={`segmented-btn ${
                    media.settings.noiseSuppression && media.settings.noiseSuppressionMode === 'standard'
                      ? 'selected'
                      : ''
                  }`}
                  role="radio"
                  aria-checked={
                    media.settings.noiseSuppression && media.settings.noiseSuppressionMode === 'standard'
                  }
                  onClick={() =>
                    media.setSettings({ noiseSuppression: true, noiseSuppressionMode: 'standard' })
                  }
                >
                  Standard
                </button>
                <button
                  type="button"
                  className={`segmented-btn ${
                    media.settings.noiseSuppression && media.settings.noiseSuppressionMode === 'enhanced'
                      ? 'selected'
                      : ''
                  }`}
                  role="radio"
                  aria-checked={
                    media.settings.noiseSuppression && media.settings.noiseSuppressionMode === 'enhanced'
                  }
                  onClick={() =>
                    media.setSettings({ noiseSuppression: true, noiseSuppressionMode: 'enhanced' })
                  }
                >
                  RNNoise
                </button>
              </div>
            </div>
          </div>

          {/* Voice Settings Shortcut */}
          <div className="voice-popover-footer">
            <button
              type="button"
              className="popover-settings-btn"
              onClick={() => {
                setMicOpen(false);
                onOpenSettings('voice & video');
              }}
            >
              <Settings size={15} />
              <span>Voice Settings</span>
            </button>
          </div>
        </div>
      )}

      {/* --- Headphone Popover --- */}
      {headphoneOpen && (
        <div
          ref={headphonePopoverRef}
          className="voice-popover headphone-popover"
          role="dialog"
          aria-label="Output Options"
          onKeyDown={e => handleKeyDown(e, 'headphone')}
        >
          <div className="voice-popover-header">
            <h4>Output Options</h4>
            <span className="popover-status-badge">
              {media.deafened ? 'Deafened' : 'Active'}
            </span>
          </div>

          <div className="voice-popover-body">
            {/* Output Device */}
            <div className="popover-section">
              <label htmlFor="voice-output-device-select" className="popover-section-label">
                OUTPUT DEVICE
              </label>
              <select
                id="voice-output-device-select"
                aria-label="Output device"
                value={media.settings.outputDevice}
                onChange={e => media.setSettings({ outputDevice: e.target.value })}
              >
                <option value="">System default</option>
                {outputDevices.map((device, index) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `Speaker ${index + 1} — permission needed`}
                  </option>
                ))}
              </select>
            </div>

            {/* Output Volume */}
            <div className="popover-section">
              <div className="popover-slider-header">
                <span className="popover-section-label">OUTPUT VOLUME</span>
                <span className="popover-value-display">
                  {Math.round((media.settings.outputVolume ?? 1) * 100)}%
                </span>
              </div>
              <input
                type="range"
                aria-label="Output volume"
                min="0"
                max="1"
                step="0.05"
                value={media.settings.outputVolume ?? 1}
                onChange={e => media.setSettings({ outputVolume: Number(e.target.value) })}
              />
            </div>

            {/* Output Test Button */}
            <div className="popover-section">
              <span className="popover-section-label">SPEAKER TEST</span>
              <button
                type="button"
                className={`popover-test-btn ${testingOutput ? 'testing' : ''}`}
                disabled={testingOutput}
                onClick={() => void handleTestOutput()}
              >
                <Volume2 size={15} />
                <span>{testingOutput ? 'Testing speakers…' : 'Test Output Sound'}</span>
              </button>
            </div>

            {/* Deafen toggle */}
            <div className="popover-section">
              <span className="popover-section-label">DEAFEN STATUS</span>
              <label className="popover-checkbox-label">
                <input
                  type="checkbox"
                  checked={media.deafened}
                  onChange={media.toggleDeafen}
                />
                <span>Deafen all incoming voice & sounds</span>
              </label>
            </div>
          </div>

          {/* Voice Settings Shortcut */}
          <div className="voice-popover-footer">
            <button
              type="button"
              className="popover-settings-btn"
              onClick={() => {
                setHeadphoneOpen(false);
                onOpenSettings('voice & video');
              }}
            >
              <Settings size={15} />
              <span>Voice Settings</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
