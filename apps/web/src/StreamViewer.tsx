import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Headphones,
  Maximize,
  Mic,
  MicOff,
  Minimize,
  PictureInPicture2,
  Square,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { createPortal } from 'react-dom';
import { useVideoPlayback } from './video-playback';

interface ReactionBurst {
  id: number;
  emoji: string;
  left: number;
}

export default function StreamViewer({
  stream,
  name,
  local,
  initialFullscreen = false,
  muted,
  deafened,
  onToggleMute,
  onToggleDeafen,
  onClose,
  onStop,
  onStopWatching,
  streamVolume = 1,
  onStreamVolumeChange,
  onError,
}: {
  stream: MediaStream;
  name: string;
  local: boolean;
  initialFullscreen?: boolean;
  muted: boolean;
  deafened: boolean;
  onToggleMute: () => void;
  onToggleDeafen: () => void;
  onClose: () => void;
  onStop: () => void;
  onStopWatching?: () => void;
  streamVolume?: number;
  onStreamVolumeChange?: (volume: number) => void;
  onError: (message: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [volume, setVolume] = useState(streamVolume);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const reactionTimers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const [isIdle, setIsIdle] = useState(false);
  const [reactions, setReactions] = useState<ReactionBurst[]>([]);
  const idleTimerRef = useRef<NodeJS.Timeout | null>(null);

  const { playing, play } = useVideoPlayback(video, stream);

  // Auto-hide Ghost HUDs when inactive
  const resetIdleTimer = useCallback(() => {
    setIsIdle(false);
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      setIsIdle(true);
    }, 3000);
  }, []);

  useEffect(() => {
    resetIdleTimer();
    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      reactionTimers.current.forEach(clearTimeout);
      reactionTimers.current.clear();
    };
  }, [resetIdleTimer]);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement;
    const element = container.current;
    const videoElement = video.current;
    element?.focus();

    const ended = () => {
      if (!stream.getVideoTracks().some(track => track.readyState === 'live')) {
        closeRef.current();
      }
    };

    const tracks = new Set(stream.getVideoTracks());
    const added = () => stream.getVideoTracks().forEach(track => {
      if (!tracks.has(track)) { tracks.add(track); track.addEventListener('ended', ended); }
    });
    stream.addEventListener('addtrack', added);
    stream.addEventListener('removetrack', ended);
    tracks.forEach(track => track.addEventListener('ended', ended));

    return () => {
      if (document.fullscreenElement === element) {
        void document.exitFullscreen().catch(() => {});
      }
      stream.removeEventListener('removetrack', ended);
      stream.removeEventListener('addtrack', added);
      tracks.forEach(track => track.removeEventListener('ended', ended));
      if (document.pictureInPictureElement === videoElement) void document.exitPictureInPicture().catch(() => {});
      previousFocus?.focus();
    };
  }, [stream]);

  useEffect(() => {
    const changed = () => setFullscreen(document.fullscreenElement === container.current);
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);

  useEffect(() => {
    if (initialFullscreen && container.current?.requestFullscreen && !document.fullscreenElement) {
      container.current.requestFullscreen().catch(() => {});
    }
  }, [initialFullscreen]);

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        if (!container.current?.requestFullscreen) {
          throw new Error('Fullscreen is unavailable. The expanded viewer remains available.');
        }
        await container.current.requestFullscreen();
      }
    } catch (failure) {
      onError((failure as Error).message);
    }
  }

  async function togglePip() {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (video.current && document.pictureInPictureEnabled) {
        await video.current.requestPictureInPicture();
      } else {
        throw new Error('Picture-in-picture is not supported in this runtime.');
      }
    } catch (failure) {
      onError((failure as Error).message);
    }
  }

  async function close() {
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => {});
    }
    closeRef.current();
  }

  const handleVolumeChange = (newVal: number) => {
    setVolume(newVal);
    onStreamVolumeChange?.(newVal);
  };

  const triggerReaction = (emoji: string) => {
    const id = Date.now() + Math.random();
    const left = 45 + (Math.random() * 10 - 5);
    setReactions(prev => [...prev, { id, emoji, left }]);
    const timer = setTimeout(() => {
      reactionTimers.current.delete(timer);
      setReactions(prev => prev.filter(r => r.id !== id));
    }, 2000);
    reactionTimers.current.add(timer);
  };

  const qualityLabel = size.height >= 1440 ? '1440p' : size.height >= 1080 ? '1080p' : size.height >= 720 ? '720p' : size.height > 0 ? `${size.height}p` : 'HD';

  return createPortal(
    <div
      ref={container}
      className={`stream-viewer zenith-fullscreen-stream ${isIdle ? 'is-idle' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={`${name} stream viewer`}
      tabIndex={-1}
      onMouseMove={resetIdleTimer}
      onPointerDown={resetIdleTimer}
      onKeyDown={event => {
        resetIdleTimer();
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          if (document.fullscreenElement === container.current) {
            void document.exitFullscreen().catch(() => {});
          } else void close();
        }
        if (event.key === 'Tab') {
          const buttons = Array.from(
            container.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || []
          );
          const first = buttons[0];
          const last = buttons[buttons.length - 1];
          if (
            event.shiftKey &&
            (document.activeElement === first || document.activeElement === container.current)
          ) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }
      }}
    >
      {/* 1. Fullscreen Video Surface */}
      <main className="zenith-stream-main-surface">
        <div className="zenith-stream-video-containment">
          <video
            ref={video}
            muted
            autoPlay
            playsInline
            onResize={() =>
              setSize({
                width: video.current?.videoWidth || 0,
                height: video.current?.videoHeight || 0,
              })
            }
            onLoadedMetadata={() =>
              setSize({
                width: video.current?.videoWidth || 0,
                height: video.current?.videoHeight || 0,
              })
            }
            className="zenith-stream-native-video"
          />

          {!playing && (
            <button
              type="button"
              className="primary zenith-stream-play-btn"
              onClick={() => void play().catch(failure => onError(failure.message))}
            >
              Resume playback
            </button>
          )}

          {/* Vignettes for OLED Edge Sealing */}
          <div className="stream-vignette-top" aria-hidden="true" />
          <div className="stream-vignette-bottom" aria-hidden="true" />
        </div>
      </main>

      {/* 2. Top Ghost HUD Bar */}
      <header
        className={`zenith-stream-top-hud ghost-hud ${isIdle ? 'ghost-hud-idle' : ''}`}
        id="top-ghost-hud"
      >
        <div className="stream-hud-left">
          {/* Return Button */}
          <button
            type="button"
            className="stream-hud-btn return-btn"
            onClick={() => void close()}
            title="Return to voice room (ESC)"
          >
            <ArrowLeft size={15} />
            <span className="return-label">Return to voice room</span>
            <kbd className="stream-kbd-badge">ESC</kbd>
          </button>

          <div className="stream-hud-divider" />

          {/* LIVE Badge */}
          <div className="stream-live-pill">
            <span className="live-pulse-dot" />
            <span>LIVE</span>
          </div>

          {/* Title & Quality Pill */}
          <div className="stream-info-col">
            <div className="stream-info-row">
              <strong className="stream-author-title">
                {local ? 'Your Screen' : `${name}’s Screen`}
              </strong>
              <span className="stream-quality-pill">
                {qualityLabel} · Direct Stream
              </span>
            </div>
            {size.width > 0 && (
              <span className="stream-resolution-text font-mono">
                {size.width} × {size.height} · Native aspect ratio preserved
              </span>
            )}
          </div>
        </div>

        <div className="stream-hud-right">
          {/* Popout PIP */}
          <button
            type="button"
            className="stream-hud-icon-btn"
            onClick={() => void togglePip()}
            title="Picture in picture"
            aria-label="Picture in picture"
          >
            <PictureInPicture2 size={16} />
          </button>

          {/* Fullscreen Toggle */}
          <button
            type="button"
            className="stream-hud-icon-btn"
            onClick={() => void toggleFullscreen()}
            title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {fullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
          </button>

          {!local && onStopWatching && (
            <button
              type="button"
              className="stream-hud-btn stop-watching-btn"
              onClick={() => {
                onStopWatching();
                void close();
              }}
              title="Stop watching stream"
            >
              <Square size={13} />
              <span>Stop Watching</span>
            </button>
          )}

          {/* Close Button */}
          <button
            type="button"
            className="stream-hud-icon-btn danger-hover"
            onClick={() => void close()}
            title="Close viewer"
            aria-label="Close stream viewer"
          >
            <X size={16} />
          </button>
        </div>
      </header>

      {/* 3. Bottom Floating Ghost Dock */}
      <section
        className={`zenith-stream-dock ghost-hud ${isIdle ? 'ghost-dock-idle' : ''}`}
        id="dock-hud"
      >
        <div className="stream-dock-pill">
          {/* Connected Voice Channel Status */}
          <div className="stream-dock-voice-status">
            <span className="dock-status-pulse-wrap">
              <span className="dock-pulse-outer" />
              <span className="dock-pulse-inner" />
            </span>
            <div className="dock-voice-text">
              <span className="dock-voice-title">Voice Connected</span>
              <span className="dock-voice-subtitle">WebRTC Active</span>
            </div>
          </div>

          <div className="stream-dock-divider" />

          {/* Audio Peripherals Controls */}
          <div className="stream-dock-btn-group">
            <button
              type="button"
              className={`stream-dock-btn ${muted ? 'is-muted' : ''}`}
              onClick={onToggleMute}
              title={muted ? 'Unmute microphone' : 'Mute microphone'}
              aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}
            >
              {muted ? <MicOff size={16} /> : <Mic size={16} />}
            </button>

            <button
              type="button"
              className={`stream-dock-btn ${deafened ? 'is-deafened' : ''}`}
              onClick={onToggleDeafen}
              title={deafened ? 'Undeafen incoming audio' : 'Deafen audio'}
              aria-label={deafened ? 'Undeafen incoming audio' : 'Deafen audio'}
            >
              {deafened ? <VolumeX size={16} /> : <Headphones size={16} />}
            </button>
          </div>

          <div className="stream-dock-divider" />

          {/* Stream Volume Slider */}
          <div className="stream-dock-volume-wrap">
            <button
              type="button"
              className="stream-dock-vol-icon-btn"
              onClick={() => handleVolumeChange(volume === 0 ? 1 : 0)}
              title={volume === 0 ? 'Unmute stream' : 'Mute stream'}
            >
              {volume === 0 ? <VolumeX size={15} /> : <Volume2 size={15} />}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={volume}
              onChange={e => handleVolumeChange(Number(e.target.value))}
              className="stream-dock-vol-slider"
              aria-label="Stream volume"
            />
            <span className="stream-dock-vol-text font-mono">
              {Math.round(volume * 100)}%
            </span>
          </div>

          <div className="stream-dock-divider" />

          {/* Reaction Emoji Pills */}
          <div className="stream-dock-reactions">
            {(['🚀', '🔥', '👏', '❤️'] as const).map(emoji => (
              <button
                key={emoji}
                type="button"
                className="reaction-emoji-btn"
                onClick={() => triggerReaction(emoji)}
                title={`React with ${emoji}`}
              >
                {emoji}
              </button>
            ))}
          </div>

          {/* Local Sharing indicator or stop share */}
          {local && (
            <>
              <div className="stream-dock-divider" />
              <button
                type="button"
                className="stream-dock-stop-share-btn"
                onClick={() => {
                  onStop();
                  void close();
                }}
                title="Stop screen sharing"
              >
                <Square size={13} />
                <span>Stop sharing</span>
              </button>
            </>
          )}

          {!local && onStopWatching && (
            <>
              <div className="stream-dock-divider" />
              <button
                type="button"
                className="stream-dock-stop-share-btn stop-watching-dock-btn"
                onClick={() => {
                  onStopWatching();
                  void close();
                }}
                title="Stop watching stream"
              >
                <Square size={13} />
                <span>Stop Watching</span>
              </button>
            </>
          )}

          <div className="stream-dock-divider" />

          {/* Dedicated Exit Fullscreen Button */}
          <button
            type="button"
            className="stream-dock-exit-btn"
            onClick={() => void (fullscreen ? toggleFullscreen() : close())}
            title="Exit (ESC)"
          >
            <Minimize size={14} />
            <span>{fullscreen ? 'Exit Fullscreen' : 'Exit'}</span>
            <kbd className="stream-kbd-badge">ESC</kbd>
          </button>
        </div>
      </section>

      {/* 4. Ephemeral Floating Reaction Bursts */}
      <div className="stream-reaction-burst-container" aria-hidden="true">
        {reactions.map(r => (
          <div
            key={r.id}
            className="reaction-burst-particle"
            style={{ left: `${r.left}%` }}
          >
            {r.emoji}
          </div>
        ))}
      </div>
    </div>,
    document.body
  );
}
