import { useState } from 'react';
import { Modal } from './components';
import { getApiBaseUrl } from './api';
import { copyWithFeedback } from './clipboard';

export function parseHavenAddress(address: string): URL {
  let url: URL;
  try { url = new URL(address.trim()); } catch { throw new Error('Enter a full Haven server URL or invitation link. To redeem just a community code, use Join a community.'); }
  if (address.length > 2000 || url.username || url.password || url.search || url.hash || (url.pathname !== '/' && !/^\/invite\/[A-Za-z0-9_-]+\/?$/.test(url.pathname))) throw new Error('Use a server URL or a full /invite/code invitation link');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('Use HTTPS. HTTP works only on this computer’s localhost.');
  return url;
}

export function ClientTools({ onError }: { onError?: (message: string) => void }) {
  const [connection, setConnection] = useState<{ url: string; local: boolean } | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(''); setStatus('');
    try { await action(); } catch (caught) { const message = caught instanceof Error ? caught.message : 'Could not open the client'; setError(message); onError?.(message); }
    finally { setBusy(false); }
  };
  return <>
    <button onClick={() => void run(async () => {
      setConnection(window.haven ? await window.haven.getConnection() : { url: getApiBaseUrl() || window.location.origin, local: ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname) });
    })} disabled={busy}>Test with another account</button>
    {connection && <Modal title="Test with another account" onClose={() => { setConnection(null); setError(''); setStatus(''); }}>
      <p>Keep Account A signed in here. Open an independent client at this same backend, then create or sign in to Account B.</p>
      <label>HAVEN BACKEND URL<input readOnly value={connection.url} onFocus={event => event.target.select()} /></label>
      <div className="button-row"><button disabled={busy} onClick={() => void run(async () => { await copyWithFeedback(connection.url, 'Backend URL', msg => setStatus(msg)); })}>Copy backend URL</button>
        {window.haven && <><button disabled={busy} onClick={() => void run(async () => { await window.haven!.openBrowserClient(); setStatus('Browser opened. Use a private window if that browser is already signed in.'); })}>Open browser client</button>
          <button className="primary" disabled={busy} onClick={() => void run(async () => { await window.haven!.openTestClient(); setStatus('Independent test client opened with a fresh session'); })}>Open isolated test client</button></>}
      </div>
      <p>A normal browser has its own session, separate from Haven Desktop. Browser tabs in the same profile share a session: use a private window or another browser profile for another account. Each isolated test client starts with a fresh session and forgets its login when closed.</p>
      {connection.local && <p className="notice">This localhost address works only on this computer. Keep Haven Desktop running while testing; hiding to tray is supported when enabled, but fully quitting stops its local backend and test clients. Copy the current address again after restarting Haven. Another computer needs a reachable HTTPS server address.</p>}
      <p>On one computer, use headphones, mute one microphone, and deafen one client to prevent feedback. Two physical computers with headsets are best for testing real speech. A community invite code joins a community after sign-in; it does not select a backend.</p>
      {status && <p role="status">{status}</p>}{error && <p className="error" role="alert">{error}</p>}
    </Modal>}
    {!connection && error && <p className="error" role="alert">{error}</p>}
  </>;
}
