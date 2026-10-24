import { useEffect, useState } from 'react';
import { Info, Music2, Trash2, Volume2, VolumeX } from 'lucide-react';
import type { Server, Sound, User } from '@haven/shared/types';
import type { useMedia } from '../media';
import { api } from '../api';
import { Modal } from '../components';
import { SoundboardModal } from '../SoundboardModal';
import { soundboardService } from '../soundboard-service';
import { MicrophoneTest } from '../MicrophoneTest';
import { AudioDeviceFields } from './AudioDeviceFields';
import { SettingsSection } from './SettingsSection';
import { SettingRow } from './SettingRow';
import { ToggleSwitch } from '../ToggleSwitch';
import { useDesktopState } from '../desktop-settings';

interface VoiceSettingsProps {
  media: ReturnType<typeof useMedia>;
  onNavigateToGaming?: () => void;
  servers?: Server[];
  me?: User;
}

export function VoiceSettings({ media, onNavigateToGaming, servers, me }: VoiceSettingsProps) {
  const desktop = useDesktopState();
  const [testingSound, setTestingSound] = useState(false);
  const [testSoundError, setTestSoundError] = useState('');

  // Community selection for Voice Entry Sounds
  const availableServers = servers || [];
  const [selectedCommunityId, setSelectedCommunityId] = useState<string>(
    () => availableServers[0]?.id || ''
  );

  useEffect(() => {
    if ((!selectedCommunityId || !availableServers.some(s => s.id === selectedCommunityId)) && availableServers.length > 0) {
      setSelectedCommunityId(availableServers[0].id);
    }
  }, [availableServers, selectedCommunityId]);

  const [communitySounds, setCommunitySounds] = useState<Sound[]>([]);
  const [soundboardModalOpen, setSoundboardModalOpen] = useState(false);
  const [previewingSoundId, setPreviewingSoundId] = useState<string | null>(null);
  const [entrySoundSaveStatus, setEntrySoundSaveStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedCommunityId) {
      setCommunitySounds([]);
      return;
    }
    let current = true;
    api<{ sounds: Sound[] }>(`/servers/${selectedCommunityId}/sounds`)
      .then(res => {
        if (current) setCommunitySounds(res.sounds);
      })
      .catch(() => {
        if (current) setCommunitySounds([]);
      });
    return () => { current = false; };
  }, [selectedCommunityId]);

  const currentEntrySoundId = selectedCommunityId
    ? media.getEntrySoundId?.(selectedCommunityId, me) ?? null
    : null;
  const currentEntrySound = communitySounds.find(s => s.id === currentEntrySoundId);
  const selectedServer = availableServers.find(s => s.id === selectedCommunityId);
  const canManageSelectedServer = selectedServer?.role !== 'member';

  const handlePreviewEntrySound = async (sound: Sound) => {
    setPreviewingSoundId(sound.id);
    try {
      await soundboardService.playSound(sound.url, {
        volume: media.soundboardVolume,
        isMuted: media.soundboardMuted,
      });
    } catch {
      // preview error
    } finally {
      setTimeout(() => setPreviewingSoundId(null), 3000);
    }
  };

  const handleSelectSound = async (sound: Sound) => {
    if (!selectedCommunityId || !me) return;
    try {
      await media.saveEntrySound?.(selectedCommunityId, sound.id, me);
      setSoundboardModalOpen(false);
      setEntrySoundSaveStatus(`Entry sound set to "${sound.name}"`);
      setTimeout(() => setEntrySoundSaveStatus(null), 3500);
    } catch {
      // error
    }
  };

  const handleRemoveEntrySound = async () => {
    if (!selectedCommunityId || !me) return;
    try {
      await media.saveEntrySound?.(selectedCommunityId, null, me);
      setEntrySoundSaveStatus('Entry sound removed');
      setTimeout(() => setEntrySoundSaveStatus(null), 3500);
    } catch {
      // error
    }
  };

  const handleTestSound = async () => {
    setTestingSound(true);
    setTestSoundError('');
    try {
      await media.testOutputSound();
    } catch (caught) {
      setTestSoundError(caught instanceof Error ? caught.message : 'Could not play output test sound');
    } finally {
      setTimeout(() => setTestingSound(false), 550);
    }
  };

  // Effective PTT binding calculation (F06)
  const isDesktop = Boolean(desktop);
  const isMainElectron = isDesktop && desktop?.runtime.canConfigureDesktop !== false;
  const isIsolatedElectron = isDesktop && desktop?.runtime.canConfigureDesktop === false;

  // Authoritative native shortcut state in Electron. An empty native binding
  // ("") must remain explicitly unassigned, not fall back to browser pushToTalkKey.
  // Distinguish an unavailable native value (e.g. desktop === null or undefined)
  // from an explicitly empty native value ("").
  const hasNativePtt = isDesktop && typeof desktop?.settings?.pttShortcut === 'string';
  const effectivePttKey = hasNativePtt
    ? desktop.settings.pttShortcut
    : media.settings.pushToTalkKey;

  const pttScopeLabel = isMainElectron
    ? 'Global shortcut'
    : isIsolatedElectron
    ? 'Focused window only (isolated client)'
    : 'Browser focused window only';

  const currentSuppressionStatus =
    media.micTest.status === 'running' || media.micTest.status === 'starting'
      ? 'Mic test'
      : media.voiceChannelId
      ? 'Outgoing microphone'
      : 'Suppression';

  const suppressionLabel =
    !media.voiceChannelId &&
    media.micTest.status !== 'running' &&
    media.micTest.status !== 'starting'
      ? 'applied when you join voice or start Mic Test'
      : ({
          off: 'off',
          native: 'browser suppression active',
          unverified: 'browser suppression requested; confirmation unavailable',
          unavailable: 'browser reports suppression unavailable',
          starting: 'loading enhanced denoising…',
          rnnoise: 'RNNoise active · on device',
          fallback: 'enhanced unavailable; using browser suppression where supported',
        }[
          media.micTest.status === 'running' || media.micTest.status === 'starting'
            ? media.testProcessing
            : media.microphoneProcessing
        ] || 'off');

  const isRnnoiseActive =
    suppressionLabel.includes('RNNoise') ||
    suppressionLabel.includes('enhanced') ||
    suppressionLabel.includes('browser suppression');

  return (
    <div className="audio-settings voice-settings-panel">
      {/* Banner */}
      <div className="settings-notice-banner">
        <Info size={16} className="settings-notice-icon" />
        <p className="settings-notice-text">
          Changes are saved immediately and apply to your active voice room. Use{' '}
          <strong className="text-highlight">Detect audio devices</strong> to grant microphone
          permission and reveal device names.
        </p>
      </div>

      {/* Hardware Devices */}
      <SettingsSection title="Connected Hardware">
        <AudioDeviceFields media={media} />
      </SettingsSection>

      {/* Output Volume */}
      <SettingsSection title="Volume & Output Levels">
        <div className="volume-slider-row">
          <div className="volume-slider-header">
            <span className="volume-slider-title">OUTPUT VOLUME</span>
            <span className="volume-slider-value">
              {Math.round((media.settings.outputVolume ?? 1) * 100)}%
            </span>
          </div>
          <div className="volume-slider-control">
            <Volume2 size={16} className="volume-icon" aria-hidden="true" />
            <input
              aria-label="Output volume"
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={media.settings.outputVolume ?? 1}
              onChange={event => media.setSettings({ outputVolume: Number(event.target.value) })}
              className="zenith-range-input"
            />
          </div>
          <div className="volume-slider-actions">
            <button
              type="button"
              className="secondary small-button test-sound-btn"
              disabled={testingSound}
              onClick={handleTestSound}
            >
              <Volume2 size={13} />
              <span>{testingSound ? 'Playing test…' : 'Test sound'}</span>
            </button>
            <span className="volume-slider-hint">
              Play a test chime to verify playback volume on your selected output device.
            </span>
          </div>
          {testSoundError && (
            <p className="error" role="alert" style={{ marginTop: '6px' }}>
              {testSoundError}
            </p>
          )}
        </div>

        {/* Soundboard Volume */}
        <div className="volume-slider-row" style={{ marginTop: '20px' }}>
          <div className="volume-slider-header">
            <span className="volume-slider-title">SOUNDBOARD VOLUME</span>
            <span className="volume-slider-value">
              {media.soundboardMuted || media.soundboardVolume === 0
                ? 'Muted (0%)'
                : `${Math.round(media.soundboardVolume * 100)}%`}
            </span>
          </div>
          <div className="volume-slider-control">
            <button
              type="button"
              className="zenith-volume-mute-btn"
              onClick={media.toggleSoundboardMute}
              aria-label={media.soundboardMuted || media.soundboardVolume === 0 ? 'Unmute Soundboard' : 'Mute Soundboard'}
              title={media.soundboardMuted || media.soundboardVolume === 0 ? 'Unmute Soundboard' : 'Mute Soundboard'}
              style={{
                background: 'none',
                border: 'none',
                padding: '0 4px 0 0',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                color: media.soundboardMuted || media.soundboardVolume === 0 ? '#ffb4ab' : '#90909a',
              }}
            >
              {media.soundboardMuted || media.soundboardVolume === 0 ? (
                <VolumeX size={16} className="volume-icon" aria-hidden="true" />
              ) : (
                <Volume2 size={16} className="volume-icon" aria-hidden="true" />
              )}
            </button>
            <input
              aria-label="Soundboard volume"
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={media.soundboardMuted ? 0 : media.soundboardVolume}
              onChange={event => media.setSoundboardVolume(Number(event.target.value))}
              className="zenith-range-input"
            />
          </div>
          <span className="volume-slider-hint">
            Governs all incoming soundboard effects and automatic voice entry sounds.
          </span>
        </div>
      </SettingsSection>

      {/* Voice Entry Sound */}
      <SettingsSection title="Voice Entry Sound">
        <p className="quiet fine-print" style={{ margin: '0 0 14px 0', fontSize: '13px' }}>
          Choose a custom sound effect that plays automatically whenever you join a voice channel in this community.
        </p>

        {availableServers.length > 0 ? (
          <div className="entry-sound-settings-group" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div className="audio-device-control">
              <label className="settings-field-label">
                <span>SELECT COMMUNITY</span>
                <div className="settings-select-wrapper">
                  <select
                    aria-label="Select community for entry sound"
                    value={selectedCommunityId}
                    onChange={e => setSelectedCommunityId(e.target.value)}
                  >
                    {availableServers.map(server => (
                      <option key={server.id} value={server.id}>
                        {server.name}
                      </option>
                    ))}
                  </select>
                </div>
              </label>
            </div>

            <div
              className="entry-sound-status-card"
              style={{
                background: '#101319',
                border: '1px solid #2b3240',
                borderRadius: '8px',
                padding: '14px 16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '12px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                <div
                  style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '8px',
                    background: currentEntrySound ? 'rgba(192, 193, 255, 0.1)' : 'rgba(255, 255, 255, 0.04)',
                    border: currentEntrySound ? '1px solid rgba(192, 193, 255, 0.3)' : '1px solid #2b3240',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: currentEntrySound ? '#c0c1ff' : '#767680',
                    flexShrink: 0,
                  }}
                >
                  <Music2 size={18} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: '#e1e2eb', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {currentEntrySound
                      ? currentEntrySound.name
                      : currentEntrySoundId
                      ? 'Unavailable sound (deleted or revoked)'
                      : 'No entry sound selected'}
                  </div>
                  <div style={{ fontSize: '12px', color: '#90909a', marginTop: '2px' }}>
                    {currentEntrySound
                      ? `Plays automatically on join in ${selectedServer?.name || 'this community'}`
                      : currentEntrySoundId
                      ? 'The selected sound was deleted from this community.'
                      : 'Choose a sound from the community soundboard library.'}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                {currentEntrySound && (
                  <button
                    type="button"
                    className="secondary small-button"
                    onClick={() => handlePreviewEntrySound(currentEntrySound)}
                    disabled={previewingSoundId === currentEntrySound.id}
                    title="Preview entry sound"
                    aria-label={`Preview ${currentEntrySound.name}`}
                  >
                    <Volume2 size={13} />
                    <span>{previewingSoundId === currentEntrySound.id ? 'Playing…' : 'Preview'}</span>
                  </button>
                )}

                <button
                  type="button"
                  className="secondary small-button"
                  onClick={() => setSoundboardModalOpen(true)}
                  aria-label={currentEntrySoundId ? 'Change entry sound' : 'Choose entry sound'}
                >
                  <span>{currentEntrySoundId ? 'Change sound' : 'Choose sound'}</span>
                </button>

                {currentEntrySoundId && (
                  <button
                    type="button"
                    className="secondary small-button danger-text"
                    onClick={handleRemoveEntrySound}
                    title="Remove entry sound"
                    aria-label="Remove entry sound"
                  >
                    <Trash2 size={13} />
                    <span>Remove</span>
                  </button>
                )}
              </div>
            </div>

            {entrySoundSaveStatus && (
              <p className="quiet" role="status" style={{ margin: 0, fontSize: '12px', color: '#34d399' }}>
                {entrySoundSaveStatus}
              </p>
            )}
          </div>
        ) : (
          <p className="quiet fine-print">
            Join a community to set custom voice entry sounds.
          </p>
        )}
      </SettingsSection>

      {/* Audio Processing Toggles */}
      <SettingsSection title="Audio Processing">
        <div className="settings-toggles-list">
          <SettingRow
            label="Noise suppression"
            description="Reduce background noise locally before sending your microphone"
            control={
              <ToggleSwitch
                aria-label="Noise suppression"
                checked={media.settings.noiseSuppression}
                onChange={event => media.setSettings({ noiseSuppression: event.target.checked })}
              />
            }
          />

          <SettingRow
            label="Echo cancellation"
            description="Keep speaker audio out of your microphone"
            control={
              <ToggleSwitch
                aria-label="Echo cancellation"
                checked={media.settings.echoCancellation}
                onChange={event => media.setSettings({ echoCancellation: event.target.checked })}
              />
            }
          />

          <SettingRow
            label="Push to talk"
            description={
              effectivePttKey ? (
                <>
                  Effective key: <kbd>{effectivePttKey}</kbd> ({pttScopeLabel}) · configure under{' '}
                  <button
                    type="button"
                    className="text-link"
                    onClick={e => {
                      e.preventDefault();
                      e.stopPropagation();
                      onNavigateToGaming?.();
                    }}
                  >
                    desktop &amp; gaming
                  </button>
                </>
              ) : (
                <>
                  No shortcut assigned ({pttScopeLabel}) · configure under{' '}
                  <button
                    type="button"
                    className="text-link"
                    onClick={e => {
                      e.preventDefault();
                      e.stopPropagation();
                      onNavigateToGaming?.();
                    }}
                  >
                    desktop &amp; gaming
                  </button>
                </>
              )
            }
            control={
              <ToggleSwitch
                aria-label="Push to talk"
                checked={media.settings.pushToTalk}
                onChange={event => media.setSettings({ pushToTalk: event.target.checked })}
              />
            }
          />
        </div>
      </SettingsSection>

      {/* Advanced Tuning */}
      <SettingsSection title="Advanced Tuning">
        <div className="audio-devices-grid">
          <div className="audio-device-control">
            <label className="settings-field-label">
              <span>NOISE SUPPRESSION MODE</span>
              <div className="settings-select-wrapper">
                <select
                  aria-label="Noise suppression mode"
                  disabled={!media.settings.noiseSuppression}
                  value={media.settings.noiseSuppressionMode}
                  onChange={event =>
                    media.setSettings({
                      noiseSuppressionMode: event.target.value as 'standard' | 'enhanced',
                    })
                  }
                >
                  <option value="standard">Standard · browser processing</option>
                  <option value="enhanced">Enhanced · RNNoise</option>
                </select>
              </div>
            </label>
          </div>

          <div className="audio-device-control">
            <label className="settings-field-label">
              <span>VOICE BITRATE</span>
              <div className="settings-select-wrapper">
                <select
                  aria-label="Voice bitrate"
                  value={media.settings.voiceBitrateKbps}
                  onChange={event =>
                    media.setSettings({ voiceBitrateKbps: Number(event.target.value) })
                  }
                >
                  {[24, 32, 48, 64].map(value => (
                    <option key={value} value={value}>
                      {value} kbps{value === 48 ? ' · balanced' : ''}
                    </option>
                  ))}
                </select>
              </div>
            </label>
          </div>
        </div>

        {/* Live Status Readout Pill */}
        <div className="rnnoise-status-pill-row">
          <div
            className={`rnnoise-status-pill ${
              isRnnoiseActive ? 'is-active' : 'is-inactive'
            }`}
            role="status"
          >
            <span className="status-dot-pulse" />
            <span>
              {currentSuppressionStatus}: {suppressionLabel}
            </span>
          </div>
        </div>

        <p className="quiet fine-print">
          Voice bitrate is a maximum per participant. Gaming Mode keeps your choice; sustained packet
          loss can temporarily reduce it.
        </p>
        <p className="quiet fine-print">
          Standard uses your browser’s built-in suppression with minimal overhead. Enhanced adds local
          speech denoising for noisy rooms and uses more CPU. Compare both with Mic Test; keep Standard
          if speech sounds more natural. Automatic gain amplification is disabled.
        </p>
      </SettingsSection>

      {/* Live Microphone Test */}
      <SettingsSection title="Live Microphone Test">
        <div className="microphone-test-container">
          <MicrophoneTest media={media} />
        </div>
        <p className="quiet fine-print">
          Devices refresh automatically when connected or removed. An unavailable device falls back
          to the system default. Output selection depends on browser support.
        </p>
      </SettingsSection>

      {soundboardModalOpen && selectedCommunityId && me && (
        <Modal
          hideHeader
          title="Choose Voice Entry Sound"
          className="zenith-modal-frame zenith-soundboard-modal"
          onClose={() => setSoundboardModalOpen(false)}
        >
          <SoundboardModal
            mode="select"
            sounds={communitySounds}
            soundServerId={selectedCommunityId}
            currentVoiceChannelId={media.voiceChannelId}
            connected={Boolean(media.voiceChannelId)}
            canManage={canManageSelectedServer}
            me={me}
            media={media}
            selectedSoundId={currentEntrySoundId}
            onSelectSound={handleSelectSound}
            onClose={() => setSoundboardModalOpen(false)}
            onDelete={async soundId => {
              await api(`/sounds/${soundId}`, 'DELETE');
              setCommunitySounds(prev => prev.filter(item => item.id !== soundId));
              if (currentEntrySoundId === soundId) {
                await media.saveEntrySound?.(selectedCommunityId, null, me);
              }
            }}
            onUpload={async file => {
              const data = new FormData();
              data.append('name', file.name.replace(/\.[^.]+$/, '').slice(0, 120));
              data.append('file', file);
              const result = await api<{ sound: Sound }>(`/servers/${selectedCommunityId}/sounds`, 'POST', data);
              setCommunitySounds(prev => [...prev, result.sound]);
            }}
          />
        </Modal>
      )}
    </div>
  );
}
