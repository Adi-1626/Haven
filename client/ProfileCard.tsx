import { useEffect, useState } from 'react';
import { Copy, ExternalLink, Maximize } from 'lucide-react';
import type { Bootstrap, Role, User } from '../shared/types';
import { Avatar, Modal } from './components';
import { ProfileActions } from './Friends';
import { profileImageSource } from './profile-images';

export function ImageViewer({ source, name, onClose }: { source: string; name: string; onClose: () => void }) {
  const [actualSize, setActualSize] = useState(false);
  const [failed, setFailed] = useState(false);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => { setFailed(false); setSize({ width: 0, height: 0 }); }, [source]);
  return <Modal title={`${name} — original picture`} wide onClose={onClose}>
    <div className={`profile-image-viewer ${actualSize ? 'actual-size' : ''}`}>
      {failed ? <p role="alert">This image could not be loaded. Its host may block external viewing or the URL may have expired.</p> : <img src={source} alt={`${name}'s full profile picture`} referrerPolicy="no-referrer" onLoad={event => setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} onError={() => setFailed(true)} />}
    </div>
    <div className="image-viewer-actions"><span>{size.width > 0 && `${size.width} × ${size.height} · Original supplied image`}</span><button type="button" className="secondary" disabled={failed} onClick={() => setActualSize(value => !value)}>{actualSize ? 'Fit to window' : 'Actual size'}</button><a href={source} target="_blank" rel="noreferrer">Open original <ExternalLink size={14} aria-hidden="true" /></a></div>
    <p className="quiet">Haven uses the original URL, without requesting a thumbnail. A small source cannot become a higher-resolution image.</p>
  </Modal>;
}

export default function ProfileCard({ data, user, role, onClose, onChanged, onMessage, notify }: { data: Bootstrap; user: User; role?: Role; onClose: () => void; onChanged: () => void; onMessage: (userId: string) => void; notify: (message: string) => void }) {
  const [viewing, setViewing] = useState(false);
  const source = profileImageSource(user.avatar);
  const copy = async (value: string, description: string) => { try { await navigator.clipboard.writeText(value); notify(`${description} copied`); } catch { notify('Clipboard access was denied'); } };
  return <>
    <Modal title="Profile" onClose={onClose}><div className="profile-card enhanced-profile">
      <button type="button" className="profile-picture-button" disabled={!source} aria-label={`View ${user.displayName}'s original profile picture`} onClick={() => setViewing(true)}><Avatar user={user} size={96} />{source && <Maximize size={17} />}</button>
      <h2>{user.displayName}</h2><button className="username-copy" onClick={() => void copy(user.username, 'Username')}>@{user.username}<Copy size={13} /></button>
      <div className="profile-badges"><span className="profile-status">{user.status === 'dnd' ? 'Do not disturb' : user.status}</span>{role && <span>{role === 'owner' ? 'Community owner' : role === 'admin' ? 'Moderator' : 'Member'}</span>}</div>
      <section className="profile-about"><h3>About me</h3><p>{user.bio || 'No bio yet.'}</p><h3>Member since</h3><p>{new Date(user.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}</p></section>
      <ProfileActions data={data} user={user} onChanged={onChanged} onMessage={onMessage} notify={notify} />
      <button className="text-link profile-copy-id" onClick={() => void copy(user.id, 'User ID')}>Copy user ID</button>
    </div></Modal>
    {viewing && source && <ImageViewer source={source} name={user.displayName} onClose={() => setViewing(false)} />}
  </>;
}
