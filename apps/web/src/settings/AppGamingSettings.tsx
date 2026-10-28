import { useEffect, useState } from 'react';
import type { useMedia } from '../media';
import type { Preferences } from '../preferences';
import { normalizeLocalShortcut, validateShortcutDraft } from '../shortcuts';
import { ShortcutRecorder } from '../ShortcutRecorder';
import { useDesktopState } from '../desktop-settings';
import { SettingsSection } from './SettingsSection';
import { SettingRow } from './SettingRow';
import { ToggleSwitch } from '../ToggleSwitch';
import { DesktopUpdateSettings } from '../DesktopUpdates';

type DesktopSnapshot = Awaited<ReturnType<NonNullable<Window['haven']>['getDesktopSettings']>>;
type DesktopValues = DesktopSnapshot['settings'];

export function AppGamingSettings({
  media,
  preferences,
  onPreferences,
}: {
  media: ReturnType<typeof useMedia>;
  preferences: Preferences;
  onPreferences: (patch: Partial<Preferences>) => void;
}) {
  const desktop = useDesktopState();
  const [draft, setDraft] = useState({
    pttShortcut: 'Control+Shift+Space',
    muteShortcut: 'Control+Shift+M',
    deafenShortcut: 'Control+Shift+D',
  });
  const [browserKey, setBrowserKey] = useState(media.settings.pushToTalkKey);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (desktop) {
      setDraft({
        pttShortcut: desktop.settings.pttShortcut,
        muteShortcut: desktop.settings.muteShortcut,
        deafenShortcut: desktop.settings.deafenShortcut,
      });
    }
  }, [
    desktop?.settings.pttShortcut,
    desktop?.settings.muteShortcut,
    desktop?.settings.deafenShortcut,
  ]);

  const update = async (patch: Partial<DesktopValues>) => {
    setError('');
    setStatus('');
    setBusy(true);
    try {
      await window.haven!.updateDesktopSettings(patch);
      setStatus('Desktop settings applied and saved');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not apply desktop settings');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="desktop-settings app-gaming-settings">
      <SettingsSection
        title="Play first. Stay connected."
        description="Haven reduces visual work automatically when unfocused or minimized. Gaming Mode adds temporary screen-sharing limits and pauses motion while preserving your microphone processing and voice-quality preference. Turning it off restores your selections. It cannot guarantee unchanged game ping."
      >
        <div className="settings-toggles-list">
          <SettingRow
            label="Low-resource gaming mode"
            description="Pause motion; temporarily cap sharing at 720p, 30 fps and 3 Mbps per viewer."
            control={
              <ToggleSwitch
                aria-label="Low-resource gaming mode"
                disabled={desktop?.runtime.canConfigureDesktop === false}
                checked={media.settings.gamingMode}
                onChange={event => media.setSettings({ gamingMode: event.target.checked })}
              />
            }
          />

          <SettingRow
            label="Animate emoji"
            description="Only visible emoji animate. Reduced motion, background state and gaming mode pause them."
            control={
              <ToggleSwitch
                aria-label="Animate emoji"
                checked={preferences.animateEmoji}
                onChange={event => onPreferences({ animateEmoji: event.target.checked })}
              />
            }
          />
        </div>
      </SettingsSection>

      {desktop ? (
        <>
          <SettingsSection
            title="Background & startup"
            description="Closing to tray keeps voice and active sharing alive. Use Quit Haven in the tray to end everything. Startup uses this executable; move a portable installation before enabling it."
          >
            <div className="settings-toggles-list">
              {(
                [
                  'closeToTray',
                  'minimizeToTray',
                  'startAtLogin',
                  'startMinimized',
                ] as const
              ).map((key, index) => {
                const labelText = [
                  'Close to system tray',
                  'Minimize to system tray',
                  'Start Haven at Windows sign-in',
                  'Start minimized to tray',
                ][index];
                const descText = [
                  'Keep Haven running in the background when closing the window.',
                  'Hide the taskbar window when minimizing.',
                  'Opt in to Windows startup; disabled by default.',
                  'Requires close-to-tray or minimize-to-tray so Haven stays reachable.',
                ][index];
                return (
                  <SettingRow
                    key={key}
                    label={labelText}
                    description={descText}
                    control={
                      <ToggleSwitch
                        aria-label={labelText}
                        checked={desktop.settings[key]}
                        disabled={busy || desktop.runtime.canConfigureDesktop === false}
                        onChange={event => void update({ [key]: event.target.checked })}
                      />
                    }
                  />
                );
              })}
            </div>
          </SettingsSection>

          <SettingsSection
            title="Global keyboard shortcuts"
            description="These apply to the main Haven desktop client, including while unfocused. Choose a combination not used by your game. Push-to-talk does not suppress input or record typing. Elevated applications, anti-cheat or secure desktops may prevent delivery; verify with your game."
          >
            <div className="shortcuts-list">
              {(['pttShortcut', 'muteShortcut', 'deafenShortcut'] as const).map((key, index) => (
                <ShortcutRecorder
                  key={key}
                  global
                  requireModifier={key !== 'pttShortcut'}
                  label={
                    [
                      'Push-to-talk shortcut',
                      'Global mute shortcut',
                      'Global deafen shortcut',
                    ][index]
                  }
                  value={draft[key]}
                  disabled={busy || desktop.runtime.canConfigureDesktop === false}
                  onChange={shortcut => {
                    setDraft(previous => ({ ...previous, [key]: shortcut }));
                    setError('');
                    setStatus('Shortcut recorded — Apply shortcuts to save');
                  }}
                />
              ))}
            </div>

            <p className="quiet fine-print">
              Push-to-talk can be a single key such as ` (Backquote), a numpad or function key, a
              lone modifier such as Right Control, or a combination. Keys are matched by physical
              position, whatever your keyboard layout. Mute and deafen need a modifier plus one key.
              Duplicate, reserved and OS-occupied bindings are reported, not silently accepted.
              Push-to-talk never blocks the key, so a single typing key is still typed into the
              active game or chat.
            </p>

            <div className="shortcuts-actions">
              <button
                type="button"
                className="primary"
                disabled={busy || desktop.runtime.canConfigureDesktop === false}
                onClick={() => {
                  try {
                    void update(validateShortcutDraft(draft));
                  } catch (caught) {
                    setStatus('');
                    setError(caught instanceof Error ? caught.message : 'Invalid shortcuts');
                  }
                }}
              >
                Apply shortcuts
              </button>
            </div>

            <p role="status" className="ptt-status-text">
              Global hold-to-talk:{' '}
              {desktop.runtime.globalPttAvailable
                ? 'Ready'
                : !media.voiceChannelId || !media.settings.pushToTalk
                ? 'Activates when you join voice with Push to talk enabled'
                : 'Unavailable — use focused push-to-talk until resolved'}
            </p>

            {desktop.runtime.canConfigureDesktop === false && (
              <p className="notice">
                Configure desktop-wide settings in the main Haven window. Push-to-talk in this
                window works only while it is focused.
              </p>
            )}

            {desktop.runtime.shortcutErrors.map(message => (
              <p className="error" role="alert" key={message}>
                {message}
              </p>
            ))}
          </SettingsSection>
        </>
      ) : (
        <SettingsSection
          title="Browser push-to-talk"
          description="Global shortcuts, tray and startup controls require Haven Desktop. Browsers cannot read the keyboard while another window has focus, so in a browser push-to-talk works only while this page is focused (and, for typing keys, no text field is active). It stops transmitting as soon as the page loses focus or is hidden. Use Haven Desktop for push-to-talk while gaming."
        >
          <div className="shortcuts-list">
            <ShortcutRecorder
              label="Push-to-talk shortcut"
              value={browserKey}
              onChange={shortcut => {
                setBrowserKey(shortcut);
                setError('');
                setStatus('Shortcut recorded — Apply shortcut to save');
              }}
            />
          </div>

          <div className="shortcuts-actions">
            <button
              type="button"
              className="primary"
              onClick={() => {
                setError('');
                setStatus('');
                try {
                  const shortcut = browserKey ? normalizeLocalShortcut(browserKey) : '';
                  media.setSettings({ pushToTalkKey: shortcut });
                  setBrowserKey(shortcut);
                  setStatus('Push-to-talk shortcut applied');
                } catch (caught) {
                  setError(caught instanceof Error ? caught.message : 'Invalid shortcut');
                }
              }}
            >
              Apply shortcut
            </button>
          </div>
        </SettingsSection>
      )}

      <DesktopUpdateSettings media={media} />

      {status && (
        <p role="status" className="settings-success-status">
          {status}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
