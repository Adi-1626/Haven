import { useState } from 'react';
import { MonitorUp, MoreHorizontal, Music2, PhoneOff, Settings, SlidersHorizontal, Square, Volume2 } from 'lucide-react';
import type { Channel } from '@haven/shared/types';
import type { useMedia } from './media';
import ConnectionDiagnostics from './ConnectionDiagnostics';
import { VoiceControls } from './VoiceControlDropdowns';
import { ContextMenu, MenuItem, type MenuPosition } from './ContextMenu';

// The single persistent voice dock. It lives in the main panel so it stays put while the user navigates channels.
export default function VoiceConnection({ media, channel, serverName, onOpen, onSounds, onQuality, onOpenSettings }: { media: ReturnType<typeof useMedia>; channel?: Channel; serverName?: string; onOpen: () => void; onSounds: () => void; onQuality: () => void; onOpenSettings: (tab?: string) => void }) {
  const [menu, setMenu] = useState<MenuPosition | null>(null);
  if (!media.voiceChannelId && media.connectionStatus !== 'reconnecting' && media.connectionStatus !== 'connecting') return null;
  const status = media.connectionStatus === 'reconnecting' ? 'Reconnecting voice…' : media.connectionStatus === 'connecting' ? 'Joining voice…' : 'Voice connected';
  return <section className={`voice-connected voice-dock voice-dock-${media.connectionStatus}`} aria-label="Persistent voice connection">
    <button className="connected-room" title={`Open ${channel?.name || 'voice room'}${serverName ? ` · ${serverName}` : ''}`} onClick={onOpen}><i className="voice-dock-dot" /><span><strong>{channel?.name || 'Voice room'}</strong><small>{status}</small></span></button>
    <ConnectionDiagnostics status={media.connectionStatus} sources={media.connectionStatsSources} />
    <div className="persistent-voice-controls">
      <VoiceControls media={media} onOpenSettings={onOpenSettings} />
      <button className={`voice-dock-button ${media.sharing ? 'stop-sharing-button' : ''}`} aria-label={media.sharing ? 'Stop sharing' : 'Share screen'} title={media.sharing ? 'Stop sharing' : 'Share screen'} onClick={() => media.sharing ? media.stopShare() : void media.startShare()}>{media.sharing ? <><Square size={13} /><span>Stop sharing</span></> : <MonitorUp size={18} />}</button>
      <button className="voice-dock-button" aria-label="Soundboard" title="Soundboard" onClick={onSounds}><Music2 size={18} /></button>
      <span className="voice-dock-separator" aria-hidden="true" />
      <button className="voice-dock-button" aria-label="More voice options" title="More voice options" aria-haspopup="menu" aria-expanded={!!menu} onClick={event => { const rectangle = event.currentTarget.getBoundingClientRect(); setMenu(menu ? null : { x: rectangle.left, y: rectangle.top - 150 }); }}><MoreHorizontal size={18} /></button>
    </div>
    <button className="voice-dock-button voice-dock-leave" title="Disconnect voice" aria-label="Disconnect voice" onClick={media.leave}><PhoneOff size={18} /></button>
    {menu && <ContextMenu position={menu} width={210} label="Voice options" onClose={() => setMenu(null)}>
      <MenuItem icon={<Volume2 size={16} />} onClick={() => { setMenu(null); onOpen(); }}>Open {channel?.name || 'voice room'}</MenuItem>
      <MenuItem icon={<SlidersHorizontal size={16} />} onClick={() => { setMenu(null); onQuality(); }}>Screen share quality</MenuItem>
      <MenuItem icon={<Settings size={16} />} onClick={() => { setMenu(null); onOpenSettings('voice & video'); }}>Voice &amp; video settings</MenuItem>
    </ContextMenu>}
  </section>;
}
