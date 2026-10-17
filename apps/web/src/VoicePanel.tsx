import { useState, type MouseEvent, type KeyboardEvent } from 'react';
import { Headphones, Mic, MicOff, MonitorUp, Music2, MoreHorizontal, Radio, SlidersHorizontal, VolumeX } from 'lucide-react';
import type { Channel, User } from '@haven/shared/types';
import type { useMedia } from './media';
import { Avatar, Video } from './components';

export default function VoicePanel({ media, me, channel, onQuality, onSounds, onWatch, onProfile, onUserContext }: { media: ReturnType<typeof useMedia>; me: User; channel?: Channel; onQuality: () => void; onSounds: () => void; onWatch: (id: string) => void; onProfile: (userId: string) => void; onUserContext: (event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>, userId: string) => void }) {
  const [tab, setTab] = useState<'participants' | 'streams'>('participants');
  const streams = media.peers.filter(peer => peer.state.sharing && peer.stream?.getVideoTracks().some(track => track.readyState === 'live'));
  const streamCount = streams.length + (media.screenStream ? 1 : 0);
  const localStatus = media.deafened ? 'Deafened' : media.muted ? 'Muted' : media.speaking ? 'Speaking' : 'Listening';
  return <section className="call-panel voice-room-view" aria-label={`${channel?.name || 'Voice channel'} room`}>
    <div className="call-header">
      <div className="voice-room-title"><h2><Radio size={22} />{channel?.name || 'Voice channel'}</h2><p>A shared community room. Stay connected while exploring Haven.</p></div>
      <span>{media.peers.length + 1} connected</span>
    </div>
    <div className="voice-room-actions">
      <button className={media.sharing ? 'danger' : 'primary'} onClick={() => media.sharing ? media.stopShare() : void media.startShare()}><MonitorUp size={17} />{media.sharing ? 'Stop sharing from room' : 'Share screen from room'}</button>
      <button title="Room soundboard" onClick={onSounds}><Music2 size={17} />Room soundboard</button>
      <button title="Stream quality" onClick={onQuality}><SlidersHorizontal size={17} />Stream quality</button>
    </div>
    <div className="voice-room-tabs" role="tablist" aria-label="Voice room views">
      <button id="room-participants-tab" role="tab" aria-selected={tab === 'participants'} aria-controls="voice-room-content" onClick={() => setTab('participants')}><Headphones size={16} />Participants ({media.peers.length + 1})</button>
      <button id="room-streams-tab" role="tab" aria-selected={tab === 'streams'} aria-controls="voice-room-content" onClick={() => setTab('streams')}><MonitorUp size={16} />Streams ({streamCount})</button>
    </div>
    <div id="voice-room-content" role="tabpanel" aria-labelledby={tab === 'participants' ? 'room-participants-tab' : 'room-streams-tab'}>
      {tab === 'participants' && <div className="call-tiles room-participants">
        <div className={`person-tile ${media.speaking ? 'speaking' : ''}`}>
          <button className="avatar-button" aria-label="View your profile" onClick={() => onProfile(me.id)}><Avatar user={me} size={64} /></button><strong>{me.displayName} <small>(you)</small></strong>
          <span className="participant-state">{media.deafened ? <VolumeX size={15} /> : media.muted ? <MicOff size={15} /> : <Mic size={15} />}{localStatus}</span>
          {(media.moderation.muted || media.moderation.deafened) && <small className="moderation-label">{media.moderation.deafened ? 'Server deafened' : 'Server muted'}</small>}{media.sharing && <span className="live-tag">LIVE</span>}
        </div>
        {media.peers.map(peer => {
          const name = peer.user.displayName || peer.user.username || 'Participant';
          const status = peer.state.deafened ? 'Deafened' : peer.state.muted ? 'Muted' : peer.state.speaking ? 'Speaking' : 'Listening';
          return <div className={`person-tile ${peer.state.speaking && !peer.state.muted && !peer.state.deafened ? 'speaking' : ''}`} key={peer.socketId} onContextMenu={event => onUserContext(event, peer.user.id)} onKeyDown={event => { if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') onUserContext(event, peer.user.id); }}>
            <button className="participant-more" aria-label={`More actions for ${name}`} onClick={event => onUserContext(event, peer.user.id)}><MoreHorizontal size={17} /></button>
            <button className="avatar-button" aria-label={`View profile for ${name}`} onClick={() => onProfile(peer.user.id)}><Avatar user={peer.user} size={64} /></button><strong>{name}</strong>
            <span className="participant-state">{peer.state.deafened ? <VolumeX size={15} /> : peer.state.muted ? <MicOff size={15} /> : <Mic size={15} />}{status}</span>
            {peer.localMuted && <small className="moderation-label">Muted locally</small>}{(peer.state.serverMuted || peer.state.serverDeafened) && <small className="moderation-label">{peer.state.serverDeafened ? 'Server deafened' : 'Server muted'}</small>}{peer.state.sharing && <span className="live-tag">LIVE</span>}
            {peer.connectionState && !['connected', 'closed'].includes(peer.connectionState) && <small className="peer-connection-state">{peer.connectionState === 'failed' ? 'Reconnecting audio…' : 'Connecting audio…'}</small>}
            <label className="participant-volume">Volume {Math.round(peer.volume * 100)}%<input aria-label={`${name} volume`} title="Individual volume" type="range" min="0" max="1" step=".05" value={peer.volume} onChange={event => media.setPeerVolume(peer.socketId, Number(event.target.value))} /></label>
          </div>;
        })}
      </div>}
      {(streamCount > 0 || tab === 'streams') && <section className="room-streams" aria-label="Live streams">
        <h3>{streamCount ? 'Live streams' : 'No one is sharing yet'}</h3>
        {!streamCount && <p>Share your screen with the room. Everyone can keep talking while watching.</p>}
        <div className="call-tiles">
          {media.screenStream && <div className="remote-screen"><Video stream={media.screenStream} label="Your screen" local onExpand={() => onWatch('self')} /><button onClick={() => onWatch('self')}>Watch your screen</button></div>}
          {streams.map(peer => {
            const name = peer.user.displayName || peer.user.username || 'Participant';
            return <div className="remote-screen" key={peer.socketId}><Video stream={peer.stream!} label={name} onExpand={() => onWatch(peer.socketId)} /><div className="screen-volume"><span className="live-tag">LIVE</span><button onClick={() => onWatch(peer.socketId)}>Watch {name}</button></div></div>;
          })}
        </div>
      </section>}
    </div>
    {media.sharing && <div className="stream-summary"><span className="live-tag">LIVE</span>Native source {media.quality.nativeWidth} × {media.quality.nativeHeight}<span>·</span>Target {media.quality.width} × {media.quality.height} at {media.quality.fps} fps<button onClick={onQuality}>Quality & statistics</button></div>}
  </section>;
}
