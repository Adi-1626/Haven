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
declare global {
  interface Window {
    haven?: {
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
    };
  }
}
