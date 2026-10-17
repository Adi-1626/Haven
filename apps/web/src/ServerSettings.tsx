import { useEffect, useState } from 'react';
import { Shield, Upload, X } from 'lucide-react';
import type { Role, Server, ServerEmoji, User } from '@haven/shared/types';
import { api, resolveApiUrl } from './api';
import { copyWithFeedback } from './clipboard';
import { Avatar } from './components';
import { InviteCreate } from './Invitations';
import { ServerEmojiManager } from './ServerEmojis';
import { profileFallback, profileImageSource } from './profile-images';

export interface CommunityMember { user: User; role: Role; serverMuted?: boolean; serverDeafened?: boolean }

export function ServerIcon({ server }: { server: Pick<Server, 'name' | 'icon'> }) {
  const source = profileImageSource(server.icon, true);
  const [failed, setFailed] = useState<string | null>(null);
  return <span className="community-icon">{source && failed !== source ? <img key={source} src={resolveApiUrl(source)} alt="" referrerPolicy="no-referrer" decoding="async" onError={() => setFailed(source)} /> : profileFallback(server.icon, server.name)}</span>;
}

export default function ServerSettings({ server, members, emojis, me, onChanged, onLeft, notify }: { server: Server; members: CommunityMember[]; emojis: ServerEmoji[]; me: User; onChanged: () => void | Promise<unknown>; onLeft: () => void; notify: (message: string) => void }) {
  const [tab, setTab] = useState('Overview');
  const [draft, setDraft] = useState({ name: server.name, icon: server.icon, description: server.description || '' });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const canManage = server.role !== 'member';
  useEffect(() => { setDraft({ name: server.name, icon: server.icon, description: server.description || '' }); }, [server.id, server.name, server.icon, server.description]);
  const run = async (operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError('');
    try { await operation(); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not update this community'); }
    finally { setBusy(false); }
  };
  return <div className="community-settings">
    <div className="community-settings-summary"><ServerIcon server={server} /><span><h3>{server.name}</h3><p>{members.length} members · {server.role === 'owner' ? 'Owner' : server.role === 'admin' ? 'Moderator' : 'Member'}</p></span></div>
    <nav className="community-settings-tabs" aria-label="Community settings sections">{['Overview', 'Members', 'Emoji', 'Invites'].map(item => <button className={tab === item ? 'active' : ''} key={item} onClick={() => { setTab(item); setError(''); }}>{item}</button>)}</nav>
    {error && <p className="form-error" role="alert">{error}</p>}
    {tab === 'Overview' && <>
      <form className="simple-form" onSubmit={event => { event.preventDefault(); void run(async () => { await api(`/servers/${server.id}`, 'PATCH', draft); await onChanged(); notify('Community updated'); }); }}>
        <label>SERVER NAME<input aria-label="SERVER NAME" required maxLength={80} value={draft.name} disabled={!canManage || busy} onChange={event => setDraft(previous => ({ ...previous, name: event.target.value }))} /></label>
        <label>DESCRIPTION<textarea aria-label="Community description" maxLength={1000} rows={4} placeholder="What brings your people together?" value={draft.description} disabled={!canManage || busy} onChange={event => setDraft(previous => ({ ...previous, description: event.target.value }))} /></label>
        <label>ICON <small>Emoji or HTTPS image URL; clear to use initials</small><input aria-label="Community icon" maxLength={300} value={draft.icon} disabled={!canManage || busy} onChange={event => setDraft(previous => ({ ...previous, icon: event.target.value }))} /></label>
        {canManage ? <button className="primary" disabled={busy}>Save community</button> : <p className="quiet">Only the owner and moderators can edit this community.</p>}
      </form>
      {canManage && <section className="community-icon-upload"><h3>Upload a server icon</h3><p className="quiet">PNG, JPEG or static WebP; at most 1 MB and 1024 × 1024 pixels. No SVG or animation.</p><input aria-label="Upload community icon" type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={event => setFile(event.target.files?.[0] ?? null)} /><button className="secondary" disabled={busy || !file} onClick={() => void run(async () => { const body = new FormData(); body.append('file', file!); await api(`/servers/${server.id}/icon`, 'POST', body); setFile(null); await onChanged(); notify('Server icon updated'); })}><Upload size={15} />Upload icon</button></section>}
      <div className="community-metadata"><span>Created {new Date(server.createdAt).toLocaleDateString()}</span><button className="text-link" onClick={() => void copyWithFeedback(server.id, 'Server ID', notify)}>Copy server ID</button></div>
    </>}
    {tab === 'Members' && <section><h3>People & permissions</h3><p className="quiet">Owners manage roles. Moderators manage channels, invites, emoji and members below their role. Right-click a voice participant for local audio and moderation controls.</p>{members.map(member => {
      const removable = member.user.id !== me.id && member.role !== 'owner' && (server.role === 'owner' || server.role === 'admin' && member.role === 'member');
      return <div className="permission-row" key={member.user.id}><Avatar user={member.user} size={28} /><span>{member.user.displayName}<small>@{member.user.username}{member.serverMuted ? ' · Server muted' : ''}{member.serverDeafened ? ' · Server deafened' : ''}</small></span>{server.role === 'owner' && member.role !== 'owner' ? <select aria-label={`Role for ${member.user.displayName}`} value={member.role} disabled={busy} onChange={event => void run(async () => { await api(`/servers/${server.id}/members/${member.user.id}`, 'PATCH', { role: event.target.value }); await onChanged(); notify('Member role updated'); })}><option value="member">Member</option><option value="admin">Admin</option></select> : <small>{member.role}</small>}{removable && <button className="icon-button danger-text" disabled={busy} title={`Remove ${member.user.displayName}`} aria-label={`Remove ${member.user.displayName}`} onClick={() => { if (confirm(`Remove ${member.user.displayName} from ${server.name}?`)) void run(async () => { await api(`/servers/${server.id}/members/${member.user.id}`, 'DELETE'); await onChanged(); }); }}><X size={16} /></button>}</div>;
    })}</section>}
    {tab === 'Emoji' && <ServerEmojiManager serverId={server.id} canManage={canManage} emojis={emojis} onChanged={async () => { await onChanged(); }} />}
    {tab === 'Invites' && <InviteCreate server={server} notify={notify} />}
    <div className="danger-zone"><button className="secondary danger" disabled={busy} onClick={() => { if (confirm(server.role === 'owner' ? 'Permanently delete this community and all of its messages?' : `Leave ${server.name}?`)) void run(async () => { await api(server.role === 'owner' ? `/servers/${server.id}` : `/servers/${server.id}/members/${me.id}`, 'DELETE'); await onChanged(); onLeft(); }); }}>{server.role === 'owner' ? 'Delete server' : 'Leave server'}</button></div>
  </div>;
}
