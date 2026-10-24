import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { AudioLines, Check, Music2, Upload, Volume2, VolumeX, X } from 'lucide-react';
import type { Sound, User } from '@haven/shared/types';
import type { useMedia } from './media';
import { soundboardService } from './soundboard-service';
import { ConfirmDialog } from './ZenithDialog';

export interface SoundboardModalProps {
  sounds: Sound[];
  soundServerId: string | null;
  currentVoiceChannelId?: string | null;
  connected?: boolean;
  canManage?: boolean;
  me: User;
  onClose: () => void;
  onPlay?: (sound: Sound) => Promise<void>;
  onDelete: (soundId: string) => Promise<void>;
  onUpload: (file: File) => Promise<void>;
  mode?: 'play' | 'select';
  selectedSoundId?: string | null;
  onSelectSound?: (sound: Sound) => void;
  media?: ReturnType<typeof useMedia>;
}

export function SoundboardModal({
  sounds,
  soundServerId,
  currentVoiceChannelId,
  connected = false,
  canManage = false,
  me,
  onClose,
  onPlay,
  onDelete,
  onUpload,
  mode = 'play',
  selectedSoundId,
  onSelectSound,
  media,
}: SoundboardModalProps) {
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [playingSeconds, setPlayingSeconds] = useState(0);
  const [soundToDelete, setSoundToDelete] = useState<Sound | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const playTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (playTimer.current) clearInterval(playTimer.current);
    };
  }, []);

  const handlePreviewSound = async (sound: Sound) => {
    setError(null);
    setPlayingId(sound.id);
    setPlayingSeconds(1);

    if (playTimer.current) clearInterval(playTimer.current);
    playTimer.current = setInterval(() => {
      setPlayingSeconds(prev => {
        if (prev >= 4) {
          if (playTimer.current) clearInterval(playTimer.current);
          setPlayingId(null);
          return 0;
        }
        return prev + 1;
      });
    }, 1000);

    try {
      await soundboardService.playSound(sound.url, {
        volume: media ? media.soundboardVolume : 1,
        isMuted: media ? media.soundboardMuted : false,
      });
    } catch (err) {
      if (playTimer.current) clearInterval(playTimer.current);
      setPlayingId(null);
      setError(err instanceof Error ? err.message : 'Could not preview sound');
    }
  };

  const handlePlaySound = async (sound: Sound) => {
    if (mode === 'select' || !currentVoiceChannelId || !connected) {
      await handlePreviewSound(sound);
      return;
    }

    if (!onPlay) {
      await handlePreviewSound(sound);
      return;
    }

    setError(null);
    setPlayingId(sound.id);
    setPlayingSeconds(1);

    if (playTimer.current) clearInterval(playTimer.current);
    playTimer.current = setInterval(() => {
      setPlayingSeconds(prev => {
        if (prev >= 4) {
          if (playTimer.current) clearInterval(playTimer.current);
          setPlayingId(null);
          return 0;
        }
        return prev + 1;
      });
    }, 1000);

    try {
      await onPlay(sound);
    } catch (err) {
      if (playTimer.current) clearInterval(playTimer.current);
      setPlayingId(null);
      setError(err instanceof Error ? err.message : 'Could not play sound');
    }
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      setError('Audio files must be 5 MB or smaller.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setUploadBusy(true);
    setError(null);
    try {
      await onUpload(file);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not upload sound');
    } finally {
      setUploadBusy(false);
    }
  };

  return (
    <section className="zenith-media-card" aria-label={mode === 'select' ? 'Choose Voice Entry Sound' : 'Room soundboard'}>
      {/* Header */}
      <div className="zenith-media-header">
        <div className="zenith-media-title-group">
          <div className="zenith-media-icon-badge" aria-hidden="true">
            <AudioLines size={18} />
          </div>
          <div>
            <h2 className="zenith-media-title">
              {mode === 'select' ? 'Voice Entry Sound' : 'Room soundboard'}
            </h2>
          </div>
        </div>
        <button
          type="button"
          className="zenith-media-close-btn"
          onClick={onClose}
          aria-label="Close soundboard dialog"
          title="Close dialog"
        >
          <X size={18} />
        </button>
      </div>

      {/* Subtitle */}
      <p className="zenith-media-subtitle">
        {mode === 'select'
          ? 'Choose a sound effect to play automatically whenever you join a voice channel in this community.'
          : 'Custom sounds travel through your voice connection. Join a voice channel to play for everyone.'}
      </p>

      {error && (
        <div className="form-error" role="alert" style={{ marginBottom: '14px' }}>
          {error}
        </div>
      )}

      {/* Sound Grid */}
      {sounds.length > 0 ? (
        <div className="zenith-sound-grid" role="grid" aria-label="Available sound effects">
          {sounds.map(sound => {
            const isPlaying = playingId === sound.id;
            const isSelected = selectedSoundId === sound.id;
            const canDeleteSound = canManage || sound.uploaderId === me.id;

            return (
              <div
                key={sound.id}
                className={`zenith-sound-pad ${isPlaying ? 'is-playing' : ''} ${isSelected ? 'is-selected' : ''}`}
                role="button"
                tabIndex={0}
                aria-pressed={mode === 'select' ? isSelected : isPlaying}
                aria-label={`${sound.name}${isSelected ? ' (Selected)' : ''}${isPlaying ? ` (Playing, 0:0${playingSeconds})` : ''}`}
                onClick={() => {
                  if (mode === 'select') {
                    onSelectSound?.(sound);
                  } else {
                    void handlePlaySound(sound);
                  }
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    if (mode === 'select') {
                      onSelectSound?.(sound);
                    } else {
                      void handlePlaySound(sound);
                    }
                  }
                }}
              >
                <div className="zenith-sound-pad-left">
                  <button
                    type="button"
                    className="zenith-sound-note-box"
                    aria-label={`Preview ${sound.name}`}
                    title={`Preview ${sound.name}`}
                    onClick={e => {
                      e.stopPropagation();
                      void handlePreviewSound(sound);
                    }}
                  >
                    <Music2 size={16} />
                  </button>
                  <div className="zenith-sound-pad-info">
                    <div className="zenith-sound-pad-title" title={sound.name}>
                      {sound.name}
                    </div>
                    {isPlaying ? (
                      <div className="zenith-sound-pad-playing-status">
                        <span className="zenith-sound-playing-dot" />
                        <span className="zenith-sound-playing-label">
                          Playing · 0:0{playingSeconds}
                        </span>
                      </div>
                    ) : (
                      <div className="zenith-sound-pad-meta">
                        {isSelected ? 'Active entry sound' : 'Sound clip'}
                      </div>
                    )}
                  </div>
                </div>

                <div className="zenith-sound-pad-right">
                  {isPlaying && (
                    <div className="zenith-waveform-container" aria-hidden="true">
                      <span className="zenith-wave-bar" />
                      <span className="zenith-wave-bar" />
                      <span className="zenith-wave-bar" />
                      <span className="zenith-wave-bar" />
                    </div>
                  )}

                  {mode === 'select' && (
                    <button
                      type="button"
                      className={`zenith-sound-select-btn ${isSelected ? 'is-active' : ''}`}
                      onClick={e => {
                        e.stopPropagation();
                        onSelectSound?.(sound);
                      }}
                      aria-label={isSelected ? `Selected entry sound ${sound.name}` : `Select ${sound.name} as entry sound`}
                    >
                      {isSelected && <Check size={12} />}
                      <span>{isSelected ? 'Selected' : 'Select'}</span>
                    </button>
                  )}

                  {canDeleteSound && (
                    <button
                      type="button"
                      className="zenith-sound-delete-btn"
                      title={`Delete ${sound.name}`}
                      aria-label={`Delete sound ${sound.name}`}
                      onClick={e => {
                        e.stopPropagation();
                        setSoundToDelete(sound);
                      }}
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="zenith-sound-empty">
          Your soundboard is waiting for its first sound.
        </div>
      )}

      {/* Global Soundboard Volume & Mute in Soundboard Modal */}
      {media && (
        <div className="zenith-soundboard-volume-row">
          <div className="zenith-soundboard-volume-header">
            <span className="zenith-soundboard-volume-title">SOUNDBOARD VOLUME</span>
            <span className="zenith-soundboard-volume-value">
              {media.soundboardMuted || media.soundboardVolume === 0
                ? 'Muted (0%)'
                : `${Math.round(media.soundboardVolume * 100)}%`}
            </span>
          </div>
          <div className="zenith-soundboard-volume-control">
            <button
              type="button"
              className={`zenith-soundboard-mute-btn ${media.soundboardMuted || media.soundboardVolume === 0 ? 'is-muted' : ''}`}
              onClick={media.toggleSoundboardMute}
              aria-label={media.soundboardMuted ? 'Unmute Soundboard' : 'Mute Soundboard'}
              title={media.soundboardMuted ? 'Unmute Soundboard' : 'Mute Soundboard'}
            >
              {media.soundboardMuted || media.soundboardVolume === 0 ? (
                <VolumeX size={16} />
              ) : (
                <Volume2 size={16} />
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
        </div>
      )}

      {/* Upload Callout */}
      <div className="zenith-soundboard-upload-section">
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          hidden
          disabled={!soundServerId || uploadBusy}
          onChange={e => void handleFileChange(e)}
        />
        <button
          type="button"
          className="zenith-sound-upload-btn"
          disabled={!soundServerId || uploadBusy}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload size={16} />
          <span>{uploadBusy ? 'Uploading sound…' : 'Upload a sound'}</span>
        </button>
        <div className="zenith-sound-upload-footnote">
          Audio files up to 5 MB. Keep clips short.
        </div>
      </div>

      {/* Deletion Confirmation Dialog */}
      {soundToDelete && (
        <ConfirmDialog
          title="Delete sound"
          message={`Are you sure you want to delete "${soundToDelete.name}" from this community's soundboard?`}
          confirmLabel="Delete sound"
          variant="danger"
          onCancel={() => setSoundToDelete(null)}
          onConfirm={async () => {
            const targetId = soundToDelete.id;
            setSoundToDelete(null);
            await onDelete(targetId);
          }}
        />
      )}
    </section>
  );
}
