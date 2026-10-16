import { useEffect, useState } from 'react';
import { Copy, Link, Shield, Trash2 } from 'lucide-react';
import { api } from './api';
import { isLoopback, parseInvitation } from './invite-links';
import type { Server } from '../shared/types';
import { profileFallback, profileImageSource } from './profile-images';

function InvitationIcon({ icon, name }: { icon: string; name: string }) {
  const source = profileImageSource(icon);
  const [failed, setFailed] = useState<string | null>(null);
  return <span className="invited-community-icon">{source && source !== failed ? <img src={source} alt="" referrerPolicy="no-referrer" onError={() => setFailed(source)} /> : profileFallback(icon, name)}</span>;
}

interface Preview { community: { name: string; icon: string }; expiresAt: number | null }
interface Invite { code: string; createdAt: number; expiresAt: number | null; revokedAt: number | null }
async function copy(value: string, notify: (message: string) => void) {
  try { await navigator.clipboard.writeText(value); notify('Copied to clipboard'); }
  catch { notify('Clipboard unavailable. Select and copy the link or code.'); }
}

export function InviteCreate({ server, notify }: { server: Server; notify: (message: string) => void }) {
  const [host, setHost] = useState(window.location.origin);
  const [invite, setInvite] = useState<{ code: string; expiresAt: number | null } | null>(null);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [hours, setHours] = useState('168');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const moderate = server.role !== 'member';
  async function refresh() { if (moderate) setInvites((await api<{ invites: Invite[] }>(`/servers/${server.id}/invites`)).invites); }
  useEffect(() => { void api<{ publicUrl?: string }>('/config').then(config => { if (config.publicUrl) setHost(config.publicUrl.replace(/\/$/, '')); }).catch(() => {}); void refresh().catch(failure => setError(failure.message)); }, [server.id]);
  return <div className="invite-dialog">
    <p className="quiet">Invite someone into <b>{server.name}</b> on this Haven host. They can create their own account after opening the link.</p>
    {isLoopback(host) && <div className="notice"><Shield size={17} /><span>This link works on this computer only. For another computer, host Haven at a reachable HTTPS address and configure its public URL.</span></div>}
    <label>INVITE EXPIRES<select aria-label="Invite expiration" value={hours} onChange={event => setHours(event.target.value)}><option value="24">In 24 hours</option><option value="168">In 7 days</option><option value="720">In 30 days</option></select></label>
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="primary" disabled={busy} onClick={async () => { setBusy(true); setError(''); try { const result = await api<{ code: string; expiresAt: number | null }>(`/servers/${server.id}/invites`, 'POST', { expiresInHours: +hours }); setInvite(result); await refresh(); } catch (failure) { setError((failure as Error).message); } finally { setBusy(false); } }}><Link size={16} />{busy ? 'Creating invite…' : 'Create invitation'}</button>
    {invite && <div className="created-invite"><label>SHAREABLE INVITATION LINK<input aria-label="Invitation link" value={`${host}/invite/${invite.code}`} readOnly onFocus={event => event.target.select()} /></label><button className="primary" onClick={() => void copy(`${host}/invite/${invite.code}`, notify)}><Copy size={15} />Copy invite link</button><div className="invite-code"><code>{invite.code}</code><button className="secondary" onClick={() => void copy(invite.code, notify)}>Copy code</button></div><p className="quiet">Already on this host? Choose <b>Join a community</b> in the server rail and paste this code. {invite.expiresAt && `Expires ${new Date(invite.expiresAt).toLocaleString()}.`}</p></div>}
    {moderate && <details className="managed-invites"><summary>Manage active invitations</summary>{invites.filter(item => !item.revokedAt && (!item.expiresAt || item.expiresAt > Date.now())).map(item => <div key={item.code}><code>{item.code}</code><small>{item.expiresAt ? new Date(item.expiresAt).toLocaleDateString() : 'No expiry'}</small><button title={`Revoke ${item.code}`} className="icon-button danger-text" onClick={async () => { try { await api(`/invites/${item.code}`, 'DELETE'); if (invite?.code === item.code) setInvite(null); await refresh(); notify('Invitation revoked'); } catch (failure) { setError((failure as Error).message); } }}><Trash2 size={15} /></button></div>)}</details>}
  </div>;
}

export function InviteRedeem({ code, authenticated, onJoined, onAuthenticate }: { code: string; authenticated: boolean; onJoined: (serverId: string) => void; onAuthenticate?: () => void }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { let active = true; setError(''); setPreview(null); void api<Preview>(`/invites/${encodeURIComponent(code)}`).then(value => { if (active) setPreview(value); }).catch(failure => { if (active) setError(failure.message); }); return () => { active = false; }; }, [code]);
  return <div className="invite-preview">{error ? <p className="form-error" role="alert">{error}</p> : !preview ? <p className="quiet">Checking your invitation…</p> : <>
    <InvitationIcon icon={preview.community.icon} name={preview.community.name} /><p className="eyebrow">YOU’RE INVITED TO</p><h2>{preview.community.name}</h2><p className="quiet">{authenticated ? 'Join this community with your current account.' : 'Create an account or sign in on this Haven host, then accept your invitation.'}</p>{preview.expiresAt && <small className="quiet">Invite expires {new Date(preview.expiresAt).toLocaleString()}</small>}
    {authenticated ? <button className="primary" disabled={busy} onClick={async () => { setBusy(true); setError(''); try { onJoined((await api<{ serverId: string }>(`/invites/${encodeURIComponent(code)}/join`, 'POST')).serverId); } catch (failure) { setError((failure as Error).message); } finally { setBusy(false); } }}>{busy ? 'Joining…' : `Join ${preview.community.name}`}</button> : onAuthenticate && <button className="primary" onClick={onAuthenticate}>Continue to sign in or create an account</button>}
  </>}</div>;
}

export function CommunityJoin({ authenticated, onJoined, onPending }: { authenticated: boolean; onJoined: (serverId: string) => void; onPending: (code: string) => void }) {
  const [value, setValue] = useState('');
  const [parsed, setParsed] = useState<ReturnType<typeof parseInvitation> | null>(null);
  const [error, setError] = useState('');
  return <div className="community-join"><form className="simple-form" onSubmit={event => { event.preventDefault(); setError(''); try { setParsed(parseInvitation(value, window.location.origin)); } catch (failure) { setParsed(null); setError((failure as Error).message); } }}><p className="quiet">Paste a community invitation link or a code from someone on this same Haven host. A host address connects you to an installation; an invite joins a community inside it.</p><label>INVITE CODE OR LINK<input aria-label="INVITE CODE" value={value} onChange={event => { setValue(event.target.value); setParsed(null); }} required placeholder="Code or https://haven.example/invite/…" autoFocus /></label>{error && <p className="form-error" role="alert">{error}</p>}<button className="primary" type="submit">Join server</button></form>
    {parsed && (parsed.origin !== window.location.origin ? <div className="foreign-invite"><h3>This invitation is on another host</h3><p className="quiet">{parsed.origin}</p><p className="quiet">You’ll need an account on that host. Open it separately to keep your current session available.</p><a className="primary" href={parsed.url} target="_blank" rel="noreferrer">Open invite on its Haven host</a>{window.haven && <button className="secondary" onClick={() => void window.haven!.connectServer(parsed.url).catch(failure => setError(failure.message))}>Switch desktop to invite host</button>}</div> : <InviteRedeem code={parsed.code} authenticated={authenticated} onJoined={onJoined} onAuthenticate={() => onPending(parsed.code)} />)}
  </div>;
}
