import { useRef, useState, type FormEvent } from 'react';
import type { ServerEmoji } from '../shared/types';
import { api } from './api';
import { Emoji } from './emoji';
import { customEmojiToken } from './emoji-data';

const emojiName = /^[A-Za-z0-9_]{2,32}$/;
const maxUploadBytes = 256 * 1024;

export async function emojiPoster(file: File): Promise<Blob> {
  if (!file.size || file.size > maxUploadBytes) throw new Error('Choose an image smaller than 256 KiB.');
  if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)) throw new Error('Choose a PNG, JPEG, GIF or WebP image.');
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); }
  catch { throw new Error('This image cannot be decoded. Try another image.'); }
  try {
    if (bitmap.width > 128 || bitmap.height > 128) throw new Error('Emoji must be at most 128 × 128 pixels. Resize your image before uploading.');
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image processing is unavailable in this browser.');
    context.drawImage(bitmap, 0, 0);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not prepare the emoji preview.')), 'image/png'));
  } finally { bitmap.close(); }
}

export function ServerEmojiManager({ serverId, canManage, emojis, onChanged }: { serverId: string; canManage: boolean; emojis: ServerEmoji[]; onChanged: () => void | Promise<void> }) {
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState('');
  const [draft, setDraft] = useState('');
  const [deleting, setDeleting] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const pending = useRef(false);
  const serverEmojis = emojis.filter(emoji => emoji.serverId === serverId);
  const failure = (error: unknown) => error instanceof Error ? error.message : 'The emoji could not be saved. Try again.';
  async function change(action: () => Promise<unknown>, message: string) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(''); setNotice('');
    try { await action(); await onChanged(); setNotice(message); }
    catch (error) { setError(failure(error)); }
    finally { pending.current = false; setBusy(false); }
  }
  async function upload(event: FormEvent) {
    event.preventDefault();
    if (!emojiName.test(name)) { setError('Use 2–32 letters, numbers or underscores for the emoji name.'); return; }
    if (!file) { setError('Choose an emoji image first.'); return; }
    await change(async () => {
      const poster = await emojiPoster(file);
      const body = new FormData(); body.append('name', name); body.append('file', file); body.append('staticFile', poster, 'preview.png');
      await api(`/servers/${serverId}/emojis`, 'POST', body);
      setName(''); setFile(null); if (fileInput.current) fileInput.current.value = '';
    }, 'Emoji uploaded. Everyone in this server can now use it.');
  }
  async function rename(emoji: ServerEmoji) {
    if (!emojiName.test(draft)) { setError('Use 2–32 letters, numbers or underscores for the emoji name.'); return; }
    await change(async () => { await api(`/emojis/${emoji.id}`, 'PATCH', { name: draft }); setEditing(''); }, 'Emoji renamed. Existing messages and reactions keep working.');
  }
  return <section className="server-emoji-manager" aria-label="Server emoji management">
    <div className="emoji-manager-heading"><h3>Server emoji</h3><span>{serverEmojis.length} / 50</span></div>
    <p className="quiet">Custom emoji work in this server’s messages and reactions. PNG, JPEG, GIF and animated WebP/APNG are supported, up to 128 × 128 pixels and 256 KiB. Animation pauses offscreen, in the background and in gaming mode.</p>
    {canManage ? <form className="emoji-upload-form" onSubmit={event => void upload(event)}>
      <label>EMOJI NAME<input aria-label="New emoji name" value={name} onChange={event => setName(event.target.value)} placeholder="victory_dance" minLength={2} maxLength={32} pattern="[A-Za-z0-9_]{2,32}" required disabled={busy} /></label>
      <label>IMAGE<input ref={fileInput} type="file" aria-label="Emoji image" accept="image/png,image/jpeg,image/gif,image/webp" required disabled={busy || serverEmojis.length >= 50} onChange={event => { setFile(event.target.files?.[0] ?? null); setError(''); }} /></label>
      <button className="primary" type="submit" disabled={busy || serverEmojis.length >= 50}>{busy ? 'Saving…' : 'Upload emoji'}</button>
    </form> : <p className="quiet">Only the server owner and administrators can upload, rename or delete emoji.</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {notice && <p className="emoji-manager-notice" role="status">{notice}</p>}
    <div className="server-emoji-list">{serverEmojis.map(emoji => <div className="server-emoji-row" key={emoji.id}>
      <span className="emoji-manager-preview"><Emoji value={customEmojiToken(emoji.id)} /></span>
      {editing === emoji.id ? <form onSubmit={event => { event.preventDefault(); void rename(emoji); }}><input aria-label={`Rename ${emoji.name}`} autoFocus value={draft} onChange={event => setDraft(event.target.value)} minLength={2} maxLength={32} pattern="[A-Za-z0-9_]{2,32}" required disabled={busy} /><button type="submit" className="secondary" disabled={busy}>Save name</button><button type="button" className="text-link" disabled={busy} onClick={() => setEditing('')}>Cancel</button></form> : <span className="emoji-manager-name">:{emoji.name}:<small>{emoji.animated ? 'Animated' : 'Static'}</small></span>}
      {canManage && editing !== emoji.id && <div className="emoji-row-actions"><button type="button" className="secondary" aria-label={`Rename emoji ${emoji.name}`} disabled={busy} onClick={() => { setEditing(emoji.id); setDraft(emoji.name); setDeleting(''); }}>Rename</button>{deleting === emoji.id ? <><button type="button" className="danger" aria-label={`Confirm delete emoji ${emoji.name}`} disabled={busy} onClick={() => void change(async () => { await api(`/emojis/${emoji.id}`, 'DELETE'); setDeleting(''); }, 'Emoji deleted. Its existing tokens are retained as text.')}>Confirm delete</button><button type="button" className="text-link" disabled={busy} onClick={() => setDeleting('')}>Cancel</button></> : <button type="button" className="text-link danger-text" aria-label={`Delete emoji ${emoji.name}`} disabled={busy} onClick={() => setDeleting(emoji.id)}>Delete</button>}</div>}
    </div>)}</div>
    {!serverEmojis.length && <p className="emoji-empty">No custom emoji in this server yet.</p>}
  </section>;
}
