import { useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, Download, Loader2, RefreshCw, X } from 'lucide-react';
import type { DesktopUpdateState } from './desktop';
import { activeCommunication, disconnectForUpdate, downloadDetail, updateIndicator, updateStatusText, UPDATE_DISCONNECT_WARNING, type UpdateCommunication } from './desktop-updates';
import { ConfirmDialog } from './ZenithDialog';
import { SettingsSection } from './settings/SettingsSection';
import { SettingRow } from './settings/SettingRow';

/** Null in browsers, in desktop builds without automatic updates and in secondary test windows. */
export function useDesktopUpdates() {
  const [state, setState] = useState<DesktopUpdateState | null>(null);
  useEffect(() => {
    const desktop = window.haven;
    if (!desktop?.getUpdateState || !desktop.onUpdateState) return;
    let mounted = true;
    let pushed = false;
    const unsubscribe = desktop.onUpdateState(next => { pushed = true; if (mounted) setState(next); });
    void desktop.getUpdateState().then(next => { if (mounted && !pushed) setState(next); }).catch(() => {});
    return () => { mounted = false; unsubscribe(); };
  }, []);
  return state;
}

function useUpdateActions(media: UpdateCommunication) {
  // The confirmation text from the main process, which also knows about other Haven windows.
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const check = async () => {
    setError('');
    setBusy(true);
    try { await window.haven?.checkForUpdates?.(); }
    catch { setError('Could not check for updates. Try again in a moment.'); }
    finally { setBusy(false); }
  };
  const install = async (confirmedDisconnect: boolean) => {
    // Never interrupt a call silently: voice, sharing or watching here, or any other open Haven window,
    // makes the main process ask for an explicit confirmation first.
    setError('');
    setBusy(true);
    try {
      const active = activeCommunication(media).active;
      if (confirmedDisconnect) await disconnectForUpdate(media);
      const result = await window.haven!.installUpdate!({ confirmedDisconnect, active });
      if (result.ok) { setConfirming(null); return; }
      setBusy(false);
      if (result.code === 'ACTIVE_CALL' || result.code === 'OTHER_WINDOWS') setConfirming(result.message || UPDATE_DISCONNECT_WARNING);
      else { setConfirming(null); setError(result.message); }
    } catch {
      setBusy(false);
      setConfirming(null);
      setError('Haven could not start the update. Try again.');
    }
  };
  const confirmDialog = <ConfirmDialog
    open={confirming !== null}
    title="Restart Haven to update?"
    message={confirming ?? UPDATE_DISCONNECT_WARNING}
    cancelLabel="Later"
    confirmLabel="Update & Restart"
    variant="warning"
    icon={<RefreshCw size={20} />}
    onConfirm={() => install(true)}
    onCancel={() => setConfirming(null)}
    testId="desktop-update-disconnect"
  />;
  return { check, install, busy, error, confirmDialog };
}

function ProgressRing({ percent }: { percent: number }) {
  const circumference = 2 * Math.PI * 13;
  return <svg className="desktop-update-ring" viewBox="0 0 32 32" aria-hidden="true">
    <circle className="desktop-update-ring-track" cx="16" cy="16" r="13" />
    <circle className="desktop-update-ring-value" cx="16" cy="16" r="13" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - Math.min(100, Math.max(0, percent)) / 100)} />
  </svg>;
}

export function DesktopUpdateButton({ media }: { media: UpdateCommunication }) {
  const state = useDesktopUpdates();
  const [open, setOpen] = useState(false);
  const indicator = updateIndicator(state);
  if (!state || (!indicator && !open)) return null;
  return <>
    {indicator && <button type="button" className={`icon-button desktop-update-button is-${indicator.tone}`} title={indicator.label} aria-label={indicator.label} aria-haspopup="dialog" onClick={() => setOpen(true)} data-testid="desktop-update-button">
      {indicator.percent !== null && <ProgressRing percent={indicator.percent} />}
      {indicator.tone === 'busy' ? <Loader2 size={16} className="zenith-spin" /> : <Download size={indicator.percent !== null ? 14 : 18} />}
      {(indicator.tone === 'ready' || indicator.tone === 'attention') && <span className="desktop-update-dot" aria-hidden="true" />}
    </button>}
    {open && <DesktopUpdateDialog state={state} media={media} onClose={() => setOpen(false)} />}
  </>;
}

export function DesktopUpdateDialog({ state, media, onClose }: { state: DesktopUpdateState; media: UpdateCommunication; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const actions = useUpdateActions(media);
  const installing = state.status === 'installing' || actions.busy;
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, []);
  const close = () => { if (state.status !== 'installing') onClose(); };
  const percent = Math.round(state.progress?.percent ?? 0);
  const title = { ready: 'Update ready', waiting: 'Downloading update', downloading: 'Downloading update', installing: 'Installing update', failed: 'Update paused', offline: 'Update paused' }[state.status as string] ?? 'Haven updates';
  let primary = null;
  if (state.status === 'ready' || state.status === 'installing') {
    primary = <button type="button" className="zenith-dialog-btn zenith-dialog-btn-primary" disabled={installing} onClick={() => void actions.install(false)} data-testid="desktop-update-install">
      {installing ? <><Loader2 size={13} className="zenith-spin" /><span>Restarting…</span></> : 'Update & Restart'}
    </button>;
  } else if (state.status === 'downloading') {
    primary = <button type="button" className="zenith-dialog-btn zenith-dialog-btn-primary" disabled>Downloading… {percent}%</button>;
  } else if (state.status !== 'unsupported') {
    primary = <button type="button" className="zenith-dialog-btn zenith-dialog-btn-primary" disabled={actions.busy || state.status === 'checking' || state.status === 'waiting'} onClick={() => void actions.check()}>
      {state.status === 'failed' || state.status === 'offline' ? 'Try again' : 'Check for Updates'}
    </button>;
  }
  return <>
    <dialog ref={dialogRef} className="modal zenith-modal-frame zenith-dialog-modal zenith-dialog-primary desktop-update-dialog" aria-labelledby={titleId} data-testid="desktop-update-dialog"
      onCancel={event => { event.preventDefault(); close(); }}
      onClick={event => { if (event.target === dialogRef.current) close(); }}>
      <div className="zenith-dialog-inner">
        <div className="zenith-dialog-header">
          <div className="zenith-dialog-icon zenith-dialog-icon-primary"><Download size={20} /></div>
          <div className="zenith-dialog-title-group"><h3 className="zenith-dialog-title" id={titleId}>{title}</h3></div>
          <button type="button" className="zenith-dialog-close-btn" disabled={state.status === 'installing'} onClick={close} aria-label="Close dialog"><X size={16} /></button>
        </div>
        <div className="zenith-dialog-body">
          <dl className="desktop-update-versions">
            <div><dt>Current version</dt><dd>{state.currentVersion}</dd></div>
            <div><dt>Available version</dt><dd>{state.availableVersion ?? '—'}</dd></div>
          </dl>
          <p role="status">{updateStatusText(state)}</p>
          {state.status === 'downloading' && <>
            <div className="desktop-update-progress" role="progressbar" aria-label="Update download progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><span style={{ width: `${percent}%` }} /></div>
            <p className="desktop-update-detail">{downloadDetail(state)}</p>
          </>}
          {state.releaseNotes && <section className="desktop-update-notes" aria-label="Release notes">
            <h4>{state.releaseName || 'What’s new'}</h4>
            <div>{state.releaseNotes}</div>
          </section>}
        </div>
        {(actions.error || (state.errorKind === 'install' && state.error)) && <div className="zenith-dialog-error" role="alert"><AlertTriangle size={14} /><span>{actions.error || state.error}</span></div>}
        <div className="zenith-dialog-actions">
          <button type="button" className="zenith-dialog-btn zenith-dialog-btn-cancel" disabled={state.status === 'installing'} onClick={close} data-testid="desktop-update-later">Later</button>
          {primary}
        </div>
      </div>
    </dialog>
    {actions.confirmDialog}
  </>;
}

/** "Updates" in Settings → App & Gaming. Hidden entirely outside Haven Desktop. */
export function DesktopUpdateSettings({ media }: { media: UpdateCommunication }) {
  const state = useDesktopUpdates();
  const actions = useUpdateActions(media);
  const [open, setOpen] = useState(false);
  if (!state) return null;
  const working = actions.busy || ['checking', 'waiting', 'downloading', 'installing'].includes(state.status);
  return <SettingsSection title="Updates" description="Haven checks GitHub Releases for new versions and downloads them in the background. Nothing is installed until you choose Update & Restart.">
    <SettingRow as="div" className="desktop-update-row" label={`Haven ${state.currentVersion}`} description={<span role="status">{updateStatusText(state)}</span>} control={<div className="desktop-update-row-actions">
      {state.availableVersion && <button type="button" className="secondary" onClick={() => setOpen(true)}>{state.status === 'ready' ? 'Update & Restart…' : 'View update'}</button>}
      {state.status !== 'unsupported' && <button type="button" className="primary" disabled={working || state.status === 'ready'} onClick={() => void actions.check()} data-testid="desktop-update-check">
        {state.status === 'checking' ? 'Checking…' : 'Check for Updates'}
      </button>}
    </div>} />
    {actions.error && <p className="error" role="alert">{actions.error}</p>}
    {open && <DesktopUpdateDialog state={state} media={media} onClose={() => setOpen(false)} />}
  </SettingsSection>;
}
