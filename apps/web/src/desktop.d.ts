export interface DesktopSettings {
  closeToTray: boolean;
  minimizeToTray: boolean;
  startAtLogin: boolean;
  startMinimized: boolean;
  gamingMode: boolean;
  pttShortcut: string;
  muteShortcut: string;
  deafenShortcut: string;
}
export interface DesktopState {
  settings: DesktopSettings;
  runtime: { globalPttAvailable: boolean; shortcutErrors: string[]; background: boolean; canConfigureDesktop: boolean };
}
export type DesktopShortcut = { action: 'ptt'; pressed: boolean } | { action: 'mute' | 'deafen' };
/** 'waiting': another installed Haven window (a separate profile or Local Mode) is using the shared update cache. */
export type DesktopUpdateStatus = 'unsupported' | 'idle' | 'checking' | 'waiting' | 'downloading' | 'ready' | 'failed' | 'offline' | 'installing';
export interface DesktopUpdateState {
  status: DesktopUpdateStatus;
  currentVersion: string;
  availableVersion: string | null;
  releaseName: string | null;
  /** Plain text; the main process strips GitHub's HTML. */
  releaseNotes: string;
  releaseDate: string | null;
  progress: { percent: number; transferred: number; total: number; bytesPerSecond: number } | null;
  error: string | null;
  errorKind: 'offline' | 'network' | 'disk' | 'integrity' | 'metadata' | 'http' | 'install' | 'unknown' | null;
  lastCheckedAt: number | null;
  /** Why this copy cannot update itself, when status is 'unsupported'. */
  reason: string | null;
}
/** ACTIVE_CALL and OTHER_WINDOWS need the user's confirmation; BUSY means another window holds the update cache. */
export type DesktopUpdateInstallResult = { ok: true; state: DesktopUpdateState } | { ok: false; code: 'ACTIVE_CALL' | 'OTHER_WINDOWS' | 'BUSY' | 'FAILED' | string; message: string };
declare global {
  interface Window {
    haven?: {
      getApiOrigin?: () => string | null;
      connectServer: (address: string) => Promise<void>;
      getConnection: () => Promise<{ url: string; local: boolean }>;
      openBrowserClient: () => Promise<void>;
      openTestClient: () => Promise<void>;
      getDesktopSettings: () => Promise<DesktopState>;
      updateDesktopSettings: (patch: Partial<DesktopSettings>) => Promise<DesktopState>;
      setShortcutRecording: (active: boolean) => Promise<void>;
      onDesktopState: (callback: (state: DesktopState) => void) => () => void;
      onDesktopShortcut: (callback: (shortcut: DesktopShortcut) => void) => () => void;
      setVoiceState: (state: { connected: boolean; muted: boolean; deafened: boolean; sharing: boolean; pushToTalk?: boolean }) => void;
      readClientSetting: (key: 'haven.media.settings' | 'haven.voice.state' | 'haven.preferences') => string | null;
      readClientSettingStatus?: (key: 'haven.media.settings' | 'haven.voice.state') => { value: string | null; error: string | null; canPersist: boolean };
      writeClientSetting: (key: 'haven.media.settings' | 'haven.voice.state' | 'haven.preferences', value: string) => { ok: boolean; error?: string } | void;
      storeAuthSession?: (sessionJson: string) => Promise<boolean>;
      getAuthSession?: () => Promise<string | null>;
      clearAuthSession?: () => Promise<boolean>;
      writeClipboard?: (text: string) => Promise<boolean>;
      // Absent in desktop builds before automatic updates and in browsers.
      getUpdateState?: () => Promise<DesktopUpdateState>;
      checkForUpdates?: () => Promise<DesktopUpdateState>;
      /** `active`: this window is in voice, sharing or watching, which needs confirmation first. */
      installUpdate?: (options?: { confirmedDisconnect?: boolean; active?: boolean }) => Promise<DesktopUpdateInstallResult>;
      onUpdateState?: (callback: (state: DesktopUpdateState) => void) => () => void;
    };
  }
}
