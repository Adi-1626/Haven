import type { DesktopUpdateState } from './desktop';

export const UPDATE_DISCONNECT_WARNING = 'Updating Haven will close the app and disconnect you from your current voice call or stream. You\'ll need to rejoin after the update.';

/** The parts of useMedia() an update needs; nothing in the voice implementation changes for updates. */
export interface UpdateCommunication {
  voiceChannelId: string | null;
  sharing: boolean;
  watchingStreams: string[];
  leave: () => void;
}

export function activeCommunication(media: Pick<UpdateCommunication, 'voiceChannelId' | 'sharing' | 'watchingStreams'>) {
  const voice = Boolean(media.voiceChannelId);
  const sharing = Boolean(media.sharing);
  const watching = media.watchingStreams.length > 0;
  return { voice, sharing, watching, active: voice || sharing || watching };
}

/** Leaves voice deliberately (other members see the leave at once) before the app quits for the installer. */
export async function disconnectForUpdate(media: UpdateCommunication, wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))) {
  if (!activeCommunication(media).active) return false;
  media.leave();
  // Give the voice:leave message a moment to flush before the window closes.
  await wait(400);
  return true;
}

export type UpdateIndicator = { tone: 'progress' | 'ready' | 'attention' | 'busy'; label: string; percent: number | null };

/** The toolbar shows nothing until there is a newer version to talk about. */
export function updateIndicator(state: DesktopUpdateState | null): UpdateIndicator | null {
  if (!state?.availableVersion) return null;
  const version = state.availableVersion;
  switch (state.status) {
    case 'downloading': {
      const percent = Math.round(state.progress?.percent ?? 0);
      return { tone: 'progress', label: `Downloading Haven ${version} — ${percent}%`, percent };
    }
    case 'waiting': return { tone: 'busy', label: `Another Haven window is downloading Haven ${version}`, percent: null };
    case 'ready': return { tone: 'ready', label: `Haven ${version} is ready — restart to update`, percent: null };
    case 'installing': return { tone: 'busy', label: 'Restarting to install the update', percent: null };
    case 'failed':
    case 'offline': return { tone: 'attention', label: `Haven ${version} download paused — ${state.error ?? 'retrying later'}`, percent: null };
    default: return null;
  }
}

export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.max(0.1, bytes / 1024 ** 2).toFixed(bytes >= 100 * 1024 ** 2 ? 0 : 1)} MB`;
}

export function downloadDetail(state: DesktopUpdateState) {
  const progress = state.progress;
  if (!progress) return '';
  const parts = [`${Math.round(progress.percent)}%`];
  if (progress.total > 0) parts.push(`${formatBytes(progress.transferred)} of ${formatBytes(progress.total)}`);
  if (progress.bytesPerSecond > 0 && progress.percent < 100) parts.push(`${formatBytes(progress.bytesPerSecond)}/s`);
  return parts.join(' · ');
}

export function updateStatusText(state: DesktopUpdateState, formatTime = (at: number) => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })) {
  const version = state.availableVersion;
  switch (state.status) {
    case 'unsupported': return state.reason ?? 'This copy of Haven cannot update itself.';
    case 'checking': return 'Checking for updates…';
    case 'waiting': return `Another Haven window is downloading or installing Haven ${version}. This window will use the same download.`;
    case 'downloading': return `Downloading Haven ${version} in the background. Keep using Haven as normal.`;
    case 'ready': return `Haven ${version} is downloaded and ready. Restart Haven to finish updating.`;
    case 'installing': return 'Closing Haven to install the update. It will reopen automatically.';
    case 'failed':
    case 'offline': return state.error ?? 'Haven could not check for updates. It will try again.';
    default: return state.lastCheckedAt ? `Haven is up to date. Last checked at ${formatTime(state.lastCheckedAt)}.` : 'Haven checks for updates automatically.';
  }
}
