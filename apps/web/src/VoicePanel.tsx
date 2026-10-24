import { useState, type MouseEvent, type KeyboardEvent } from 'react';
import {
  Eye,
  Headphones,
  LayoutGrid,
  Maximize,
  Mic,
  MicOff,
  MonitorUp,
  MoreHorizontal,
  Music2,
  Play,
  Radio,
  SlidersHorizontal,
  Square,
  VolumeX,
  WifiOff,
  X,
} from 'lucide-react';
import type { Channel, User } from '@haven/shared/types';
import type { useMedia } from './media';
import { Avatar, Video } from './components';

export default function VoicePanel({
  media,
  me,
  channel,
  onQuality,
  onSounds,
  onWatch,
  onStopWatching,
  onExpand,
  onFullscreen,
  onProfile,
  onUserContext,
  watchingId,
  dismissedStreams,
  onDismissStream,
}: {
  media: ReturnType<typeof useMedia>;
  me: User;
  channel?: Channel;
  onQuality: () => void;
  onSounds: () => void;
  onWatch: (id: string) => void;
  onStopWatching?: (id: string) => void;
  onExpand?: (id: string) => void;
  onFullscreen?: (id: string) => void;
  onProfile: (userId: string) => void;
  onUserContext: (event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>, userId: string) => void;
  watchingId?: string | null;
  dismissedStreams?: Set<string>;
  onDismissStream?: (id: string) => void;
}) {
  const [tab, setTab] = useState<'participants' | 'streams'>('participants');
  const [layoutMode, setLayoutMode] = useState<'focus' | 'grid'>('focus');

  const activeBroadcasts = media.peers.filter(peer => peer.state.sharing);
  const streamCount = activeBroadcasts.length + (media.screenStream ? 1 : 0);
  const hasActiveBroadcasts = streamCount > 0;
  const isWatchingAny = Boolean(
    media.watchingStreams?.some(id => activeBroadcasts.some(p => p.socketId === id)) ||
    (watchingId && watchingId !== 'self') ||
    media.screenStream
  );
  const isStrip = isWatchingAny && layoutMode === 'focus';

  const unwatchedBroadcasts = activeBroadcasts.filter(
    peer => !media.watchingStreams?.includes(peer.socketId) && peer.socketId !== watchingId && !dismissedStreams?.has(peer.socketId)
  );

  return (
    <section className="call-panel voice-room-view" aria-label={`${channel?.name || 'Voice channel'} room`}>
      {/* ── 1. Voice Room Navigation & Action Toolbar ────────── */}
      <div className="call-header">
        <div className="voice-room-tabs" role="tablist" aria-label="Voice room views">
          <button
            id="room-participants-tab"
            role="tab"
            aria-selected={tab === 'participants'}
            aria-controls="voice-room-content"
            onClick={() => setTab('participants')}
          >
            <Headphones size={15} />
            Participants ({media.peers.length + 1})
          </button>
          <button
            id="room-streams-tab"
            role="tab"
            aria-selected={tab === 'streams'}
            aria-controls="voice-room-content"
            onClick={() => setTab('streams')}
          >
            <MonitorUp size={15} />
            Streams ({streamCount})
          </button>
        </div>

        <div className="voice-room-actions">
          {hasActiveBroadcasts && (
            <button
              className={`voice-action-btn ${layoutMode === 'focus' ? 'active' : ''}`}
              onClick={() => setLayoutMode(mode => (mode === 'focus' ? 'grid' : 'focus'))}
              title="Toggle stage layout"
            >
              <LayoutGrid size={15} />
              <span>{layoutMode === 'focus' ? 'Focus' : 'Grid'}</span>
            </button>
          )}
          <button
            className={media.sharing ? 'danger' : 'primary'}
            onClick={() => (media.sharing ? media.stopShare() : void media.startShare())}
            title={media.sharing ? 'Stop sharing screen' : 'Share screen'}
          >
            <MonitorUp size={16} />
            <span>{media.sharing ? 'Stop sharing' : 'Share screen'}</span>
          </button>
          <button title="Room soundboard" aria-label="Room soundboard" onClick={onSounds}>
            <Music2 size={16} />
            <span>Soundboard</span>
          </button>
          <button title="Stream quality" aria-label="Stream quality" onClick={onQuality}>
            <SlidersHorizontal size={16} />
            <span>Quality</span>
          </button>
        </div>
      </div>

      {/* ── 2. Connection State Banners ──────────────────────── */}
      {media.connectionStatus === 'reconnecting' && (
        <div className="voice-state-banner reconnecting" role="alert">
          <div className="voice-state-banner-left">
            <WifiOff size={18} />
            <div>
              <strong>Restoring voice connection…</strong>
              <small>Attempting to re-establish WebRTC direct mesh</small>
            </div>
          </div>
          <button
            className="voice-reconnect-btn"
            onClick={() => media.voiceChannelId && void media.join(media.voiceChannelId)}
          >
            Reconnect now
          </button>
        </div>
      )}

      {media.connectionStatus === 'connecting' && (
        <div className="voice-state-banner connecting" role="status">
          <div className="voice-state-banner-left">
            <Radio size={18} />
            <div>
              <strong>Connecting to voice room…</strong>
              <small>Negotiating peer connection</small>
            </div>
          </div>
        </div>
      )}


      {/* ── 4. Main Stage Content Area ───────────────────────── */}
      <div id="voice-room-content" role="tabpanel" aria-labelledby={tab === 'participants' ? 'room-participants-tab' : 'room-streams-tab'}>
        {/* Compact stream-available notification bars */}
        {tab === 'participants' && unwatchedBroadcasts.map(peer => {
          const name = peer.user.displayName || peer.user.username || 'Participant';
          return (
            <div className="stream-available-bar" key={peer.socketId} role="status" aria-label={`${name} is sharing their screen`}>
              <div className="stream-available-left">
                <span className="live-tag">LIVE</span>
                <span className="stream-available-text">
                  <strong>{name}</strong> is sharing their screen
                </span>
              </div>
              <div className="stream-available-actions">
                <button
                  type="button"
                  className="stream-watch-btn"
                  onClick={() => onWatch(peer.socketId)}
                  title={`Watch ${name}’s stream`}
                >
                  <Play size={13} fill="currentColor" />
                  <span>Watch Stream</span>
                </button>
                <button
                  type="button"
                  className="stream-dismiss-btn"
                  onClick={() => onDismissStream?.(peer.socketId)}
                  title="Dismiss preview invitation"
                >
                  <X size={14} />
                  <span>Dismiss</span>
                </button>
              </div>
            </div>
          );
        })}

        {/* Participants strip / grid (shown on participants tab OR alongside spotlight stream) */}
        {(tab === 'participants' || isWatchingAny) && (
          <div className={`call-tiles room-participants ${isStrip ? 'participant-strip' : 'grid-mode'}`} data-count={media.peers.length + 1} style={{ '--participant-count': media.peers.length + 1 } as React.CSSProperties}>
            {/* Local user tile */}
            <div className={`person-tile ${media.speaking ? 'speaking' : ''}`}>
              <button className="avatar-button" aria-label="View your profile" onClick={() => onProfile(me.id)}>
                    <Avatar user={me} size={isStrip ? 36 : 56} />
              </button>
              <div className="participant-details">
                <strong>
                  {me.displayName} <small>(you)</small>
                </strong>
                <div className="participant-meta">
                  <span className="participant-handle">@{me.username}</span>
                  <span
                    className={`participant-state ${
                      media.deafened ? 'state-deafened' : media.muted ? 'state-muted' : ''
                    }`}
                  >
                    {media.deafened ? (
                      <>
                        <VolumeX size={13} />
                        Deafened
                      </>
                    ) : media.muted ? (
                      <>
                        <MicOff size={13} />
                        Muted
                      </>
                    ) : media.speaking ? (
                      <>
                        <span className="speaking-dot" />
                        Speaking
                      </>
                    ) : (
                      <>
                        <Mic size={13} />
                        Listening
                      </>
                    )}
                  </span>
                  {media.sharing && <span className="live-tag">LIVE</span>}
                </div>
                {(media.moderation.muted || media.moderation.deafened) && (
                  <small className="moderation-label">
                    {media.moderation.deafened ? 'Server deafened' : 'Server muted'}
                  </small>
                )}
              </div>
              <button
                className="participant-more"
                aria-label={`More actions for ${me.displayName || me.username}`}
                onClick={event => onUserContext(event, me.id)}
              >
                <MoreHorizontal size={16} />
              </button>
            </div>

            {/* Remote peers tiles */}
            {media.peers.map(peer => {
              const name = peer.user.displayName || peer.user.username || 'Participant';
              const handle = peer.user.username || name.toLowerCase().replace(/\s+/g, '');
              const isSpeaking = peer.state.speaking && !peer.state.muted && !peer.state.deafened;

              return (
                <div
                  className={`person-tile ${isSpeaking ? 'speaking' : ''}`}
                  key={peer.socketId}
                  onContextMenu={event => onUserContext(event, peer.user.id)}
                  onKeyDown={event => {
                    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                      onUserContext(event, peer.user.id);
                    }
                  }}
                >
                  <button
                    className="avatar-button"
                    aria-label={`View profile for ${name}`}
                    onClick={() => onProfile(peer.user.id)}
                  >
                    <Avatar user={peer.user} size={isStrip ? 36 : 56} />
                  </button>
                  <div className="participant-details">
                    <strong>{name}</strong>
                    <div className="participant-meta">
                      <span className="participant-handle">@{handle}</span>
                      <span
                        className={`participant-state ${
                          peer.state.deafened ? 'state-deafened' : peer.state.muted ? 'state-muted' : ''
                        }`}
                      >
                        {peer.state.deafened ? (
                          <>
                            <VolumeX size={13} />
                            Deafened
                          </>
                        ) : peer.state.muted ? (
                          <>
                            <MicOff size={13} />
                            Muted
                          </>
                        ) : isSpeaking ? (
                          <>
                            <span className="speaking-dot" />
                            Speaking
                          </>
                        ) : (
                          <>
                            <Mic size={13} />
                            Listening
                          </>
                        )}
                      </span>
                      {peer.state.sharing && <span className="live-tag">LIVE</span>}
                    </div>
                    {peer.localMuted && <small className="moderation-label">Muted locally</small>}
                    {(peer.state.serverMuted || peer.state.serverDeafened) && (
                      <small className="moderation-label">
                        {peer.state.serverDeafened ? 'Server deafened' : 'Server muted'}
                      </small>
                    )}
                    {peer.connectionState && !['connected', 'closed'].includes(peer.connectionState) && (
                      <small className="peer-connection-state">
                        {peer.connectionError ?? (peer.connectionState === 'failed' ? 'Reconnecting audio…' : 'Connecting audio…')}
                      </small>
                    )}
                  </div>
                  <button
                    className="participant-more"
                    aria-label={`More actions for ${name}`}
                    onClick={event => onUserContext(event, peer.user.id)}
                  >
                    <MoreHorizontal size={16} />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Solo: no empty state, the single participant tile in grid-mode is sufficient */}

        {/* Dominant Screen Share Spotlight Theater */}
        {(isWatchingAny || tab === 'streams') && (
          <section className="room-streams" aria-label="Live streams">
            {!hasActiveBroadcasts ? (
              <div className="voice-empty-state">
                <div className="voice-empty-icon">
                  <MonitorUp size={28} />
                </div>
                <h3>No one is sharing yet</h3>
                <p>Share your screen with the room. Everyone can keep talking while watching.</p>
                <div style={{ marginTop: '16px' }}>
                  <button className="primary" onClick={() => void media.startShare()}>
                    <MonitorUp size={16} />
                    Start screen share
                  </button>
                </div>
              </div>
            ) : (
              <div className="call-tiles">
                {/* Local screen stream preview if local user is sharing */}
                {media.screenStream && (
                  <div className="remote-screen screen-theater-card">
                    <Video stream={media.screenStream} label="Your screen" local onExpand={() => onFullscreen ? onFullscreen('self') : onExpand ? onExpand('self') : undefined} />
                    <div className="stream-overlay-header">
                      <div className="stream-identity">
                        <span className="stream-live-dot" />
                        <strong>Your screen</strong>
                      </div>
                      <div className="stream-overlay-actions">
                        <button
                          type="button"
                          className="stream-overlay-btn stream-fullscreen-btn"
                          onClick={() => onFullscreen ? onFullscreen('self') : onExpand ? onExpand('self') : undefined}
                          title="Fullscreen"
                          aria-label="Fullscreen your screen"
                        >
                          <Maximize size={14} />
                          <span>Fullscreen</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Remote streams */}
                {activeBroadcasts.map(peer => {
                  const name = peer.user.displayName || peer.user.username || 'Participant';
                  const isWatching = media.watchingStreams?.includes(peer.socketId) || watchingId === peer.socketId;
                  const hasLiveTrack = peer.stream?.getVideoTracks().some(track => track.readyState === 'live');

                  if (isWatching && hasLiveTrack) {
                    return (
                      <div className="remote-screen screen-theater-card" key={peer.socketId}>
                        <Video stream={peer.stream!} label={name} onExpand={() => onFullscreen ? onFullscreen(peer.socketId) : onExpand ? onExpand(peer.socketId) : undefined} />
                        <div className="stream-overlay-header">
                          <div className="stream-identity">
                            <span className="stream-live-dot" />
                            <strong>{name}’s screen</strong>
                          </div>
                          <div className="stream-overlay-actions">
                            <button
                              type="button"
                              className="stream-overlay-btn stream-fullscreen-btn"
                              onClick={() => onFullscreen ? onFullscreen(peer.socketId) : onExpand ? onExpand(peer.socketId) : undefined}
                              title="Fullscreen"
                              aria-label={`Fullscreen ${name}’s stream`}
                            >
                              <Maximize size={14} />
                              <span>Fullscreen</span>
                            </button>
                            <button
                              type="button"
                              className="stream-stop-watching-btn"
                              onClick={() => onStopWatching?.(peer.socketId)}
                              title={`Stop watching ${name}`}
                            >
                              <Square size={13} />
                              Stop Watching
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  }

                  if (isWatching && !hasLiveTrack) {
                    return (
                      <div className="remote-screen screen-theater-card" key={peer.socketId}>
                        <div className="stream-loading-card" role="status" aria-label={`Connecting to ${name}’s stream`}>
                          <div className="stream-loading-spinner" />
                          <strong className="placeholder-title">Connecting to {name}’s stream…</strong>
                          <span className="placeholder-subtitle">Negotiating direct WebRTC video subscription</span>
                          <button
                            type="button"
                            className="placeholder-dismiss-btn"
                            onClick={() => onStopWatching?.(peer.socketId)}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    );
                  }

                  // Non-watching Zenith Minimal opaque black placeholder
                  return (
                    <div className="remote-screen screen-theater-card" key={peer.socketId}>
                      <div className="stream-placeholder-opaque" role="region" aria-label={`${name}’s stream preview`}>
                        <div className="placeholder-avatar-wrap">
                          <Avatar user={peer.user} size={56} />
                          <span className="placeholder-live-tag">LIVE</span>
                        </div>
                        <strong className="placeholder-title">{name}’s Screen</strong>
                        <span className="placeholder-subtitle" role={media.streamError(peer.socketId) ? 'alert' : undefined}>{media.streamError(peer.socketId) || 'Screen share available · Click to start watching'}</span>
                        <div className="placeholder-actions">
                          <button
                            type="button"
                            className="placeholder-watch-btn"
                            onClick={() => onWatch(peer.socketId)}
                          >
                            <Play size={14} fill="currentColor" />
                            <span>Watch Stream</span>
                          </button>
                          <button
                            type="button"
                            className="placeholder-dismiss-btn"
                            onClick={() => onDismissStream?.(peer.socketId)}
                          >
                            <X size={14} />
                            <span>Dismiss</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}
      </div>
    </section>
  );
}
