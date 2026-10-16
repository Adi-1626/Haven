import { useEffect, useState } from 'react';
import type { useMedia } from './media';
import type { Preferences } from './preferences';
import { normalizeLocalShortcut, validateShortcutDraft } from './shortcuts';
import { ShortcutRecorder } from './ShortcutRecorder';

type DesktopSnapshot = Awaited<ReturnType<NonNullable<Window['haven']>['getDesktopSettings']>>;
type DesktopValues = DesktopSnapshot['settings'];

export function useDesktopState() {
  const [state, setState] = useState<DesktopSnapshot | null>(null);
  useEffect(() => {
    const desktop = window.haven;
    if (!desktop?.getDesktopSettings) return;
    let mounted = true;
    const unsubscribe = desktop.onDesktopState(next => { if (mounted) setState(next); });
    void desktop.getDesktopSettings().then(next => { if (mounted) setState(next); }).catch(() => {});
    return () => { mounted = false; unsubscribe(); };
  }, []);
  return state;
}

export function DesktopSettings({ media, preferences, onPreferences }: { media: ReturnType<typeof useMedia>; preferences: Preferences; onPreferences: (patch: Partial<Preferences>) => void }) {
  const desktop = useDesktopState();
  const [draft, setDraft] = useState({ pttShortcut: 'Control+Shift+Space', muteShortcut: 'Control+Shift+M', deafenShortcut: 'Control+Shift+D' });
  const [browserKey, setBrowserKey] = useState(media.settings.pushToTalkKey);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (desktop) setDraft({ pttShortcut: desktop.settings.pttShortcut, muteShortcut: desktop.settings.muteShortcut, deafenShortcut: desktop.settings.deafenShortcut }); }, [desktop?.settings.pttShortcut, desktop?.settings.muteShortcut, desktop?.settings.deafenShortcut]);
  const update = async (patch: Partial<DesktopValues>) => {
    setError(''); setStatus(''); setBusy(true);
    try { await window.haven!.updateDesktopSettings(patch); setStatus('Desktop settings applied and saved'); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not apply desktop settings'); }
    finally { setBusy(false); }
  };
  return <div className="desktop-settings">
    <h3>Play first. Stay connected.</h3>
    <p className="quiet">Voice keeps running when Haven is minimized. Gaming mode uses a smaller voice bitrate, limits sharing bandwidth and pauses unnecessary visuals while keeping your microphone processing. It cannot guarantee unchanged game ping.</p>
    <label className="toggle-label"><span>Low-resource gaming mode<small>Pause emoji motion; use a smaller voice and screen-share bandwidth budget.</small></span><input aria-label="Low-resource gaming mode" type="checkbox" checked={media.settings.gamingMode} onChange={event => media.setSettings({ gamingMode: event.target.checked })} /></label>
    <label className="toggle-label"><span>Animate emoji<small>Only visible emoji animate. Reduced motion, background state and gaming mode pause them.</small></span><input aria-label="Animate emoji" type="checkbox" checked={preferences.animateEmoji} onChange={event => onPreferences({ animateEmoji: event.target.checked })} /></label>
    {desktop ? <>
      <h3>Background & startup</h3>
      <p className="quiet">Closing to tray keeps voice and active sharing alive. Use Quit Haven in the tray to end everything. Startup uses this executable; move a portable installation before enabling it.</p>
      {(['closeToTray', 'minimizeToTray', 'startAtLogin', 'startMinimized'] as const).map((key, index) => <label className="toggle-label" key={key}><span>{['Close to system tray', 'Minimize to system tray', 'Start Haven at Windows sign-in', 'Start minimized to tray'][index]}<small>{['Keep the main client and local backend running when closing the window.', 'Hide the taskbar window when minimizing.', 'Opt in to Windows startup; disabled by default.', 'Requires close-to-tray or minimize-to-tray so Haven stays reachable.'][index]}</small></span><input aria-label={['Close to system tray', 'Minimize to system tray', 'Start Haven at Windows sign-in', 'Start minimized to tray'][index]} type="checkbox" checked={desktop.settings[key]} disabled={busy || desktop.runtime.canConfigureDesktop === false} onChange={event => void update({ [key]: event.target.checked })} /></label>)}
      <h3>Global keyboard shortcuts</h3>
      <p className="quiet">These apply to the main Haven desktop client, including while unfocused. Choose a combination not used by your game. Push-to-talk does not suppress input or record typing. Elevated applications, anti-cheat or secure desktops may prevent delivery; verify with your game.</p>
      {(['pttShortcut', 'muteShortcut', 'deafenShortcut'] as const).map((key, index) => <ShortcutRecorder key={key} global label={['Push-to-talk shortcut', 'Global mute shortcut', 'Global deafen shortcut'][index]} value={draft[key]} disabled={busy || desktop.runtime.canConfigureDesktop === false} onChange={shortcut => { setDraft(previous => ({ ...previous, [key]: shortcut })); setError(''); setStatus('Shortcut recorded — Apply shortcuts to save'); }} />)}
      <p className="quiet">Use modifiers plus one key, for example Control+Shift+Space or Alt+F9. Duplicate, reserved and OS-occupied bindings are reported, not silently accepted.</p>
      <button className="primary" disabled={busy || desktop.runtime.canConfigureDesktop === false} onClick={() => { try { void update(validateShortcutDraft(draft)); } catch (caught) { setStatus(''); setError(caught instanceof Error ? caught.message : 'Invalid shortcuts'); } }}>Apply shortcuts</button>
      <p role="status">Global hold-to-talk: {desktop.runtime.globalPttAvailable ? 'Ready' : !media.voiceChannelId || !media.settings.pushToTalk ? 'Activates when you join voice with Push to talk enabled' : 'Unavailable — use focused push-to-talk until resolved'}</p>
      {desktop.runtime.canConfigureDesktop === false && <p className="notice">Configure desktop-wide settings in the main Haven window. This isolated client has local push-to-talk only.</p>}
      {desktop.runtime.shortcutErrors.map(message => <p className="error" role="alert" key={message}>{message}</p>)}
    </> : <>
      <h3>Browser push-to-talk</h3><p className="quiet">Global shortcuts, tray and startup controls require Haven Desktop. In a browser, push-to-talk works only while this page is focused and no text field is active.</p>
      <ShortcutRecorder label="Push-to-talk shortcut" value={browserKey} onChange={shortcut => { setBrowserKey(shortcut); setError(''); setStatus('Shortcut recorded — Apply shortcut to save'); }} />
      <button className="primary" onClick={() => { setError(''); setStatus(''); try { const shortcut = browserKey ? normalizeLocalShortcut(browserKey) : ''; media.setSettings({ pushToTalkKey: shortcut }); setBrowserKey(shortcut); setStatus('Push-to-talk shortcut applied'); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Invalid shortcut'); } }}>Apply shortcut</button>
    </>}
    {status && <p role="status">{status}</p>}{error && <p className="error" role="alert">{error}</p>}
  </div>;
}
