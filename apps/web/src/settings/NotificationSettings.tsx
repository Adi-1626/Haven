import { useState } from 'react';
import { Bell, ShieldAlert, CheckCircle2, AlertCircle } from 'lucide-react';
import type { Preferences } from '../preferences';
import { SettingsSection } from './SettingsSection';
import { SettingRow } from './SettingRow';
import { ToggleSwitch } from '../ToggleSwitch';

interface NotificationSettingsProps {
  preferences: Preferences;
  onPreferences: (patch: Partial<Preferences>) => void;
}

export function NotificationSettings({
  preferences,
  onPreferences,
}: NotificationSettingsProps) {
  const isSupported = typeof Notification !== 'undefined';
  const [notification, setNotification] = useState<'unsupported' | NotificationPermission>(() =>
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
  );
  const [notificationError, setNotificationError] = useState('');

  const requestPermission = () => {
    setNotificationError('');
    if (typeof Notification === 'undefined') return;

    Notification.requestPermission()
      .then(result => {
        setNotification(result);
        if (result === 'granted') {
          onPreferences({ notifications: true });
        }
      })
      .catch(() => {
        setNotificationError(
          'Notification permission could not be requested. Check Windows and browser permissions.'
        );
      });
  };

  const isUnsupported = notification === 'unsupported' || !isSupported;
  const isGranted = !isUnsupported && notification === 'granted';
  const isDenied = !isUnsupported && notification === 'denied';

  return (
    <div className="notification-settings notification-settings-panel">
      <div className="notification-hero-banner">
        <div className="notification-hero-icon-box">
          <Bell size={28} className="notification-hero-icon" />
        </div>
        <div className="notification-hero-text">
          <h3 className="notification-hero-title">Stay in the loop.</h3>
          <p className="notification-hero-subtitle">
            Receive incoming direct messages and mentions when Haven is running in the background.
          </p>
        </div>
      </div>

      <SettingsSection title="Preferences">
        <div className="settings-toggles-list">
          <SettingRow
            label="Desktop notifications"
            description="Notify about new messages outside this conversation while Haven is in the background. Do not disturb silences them."
            control={
              <ToggleSwitch
                aria-label="Desktop notifications"
                checked={preferences.notifications}
                onChange={event => onPreferences({ notifications: event.target.checked })}
              />
            }
          />
          <SettingRow
            label="Voice join and leave sounds"
            description="Play a short chime when people join or leave your voice channel. Reconnections stay silent; deafening silences them."
            control={
              <ToggleSwitch
                aria-label="Voice join and leave sounds"
                checked={preferences.voiceCues}
                onChange={event => onPreferences({ voiceCues: event.target.checked })}
              />
            }
          />
        </div>
      </SettingsSection>

      <SettingsSection title="System Permission">
        <div className="notification-permission-card">
          <div className="notification-permission-status">
            <span className="settings-field-label">BROWSER &amp; OS PERMISSION</span>
            <div className="permission-badge-row">
              {isUnsupported ? (
                <span className="permission-status-badge is-unsupported">
                  <AlertCircle size={13} />
                  <span>Notifications unsupported</span>
                </span>
              ) : isGranted ? (
                <span className="permission-status-badge is-granted">
                  <CheckCircle2 size={13} />
                  <span>Permission granted</span>
                </span>
              ) : isDenied ? (
                <span className="permission-status-badge is-denied">
                  <ShieldAlert size={13} />
                  <span>Permission blocked (denied)</span>
                </span>
              ) : (
                <span className="permission-status-badge is-default">
                  <span>Prompt required</span>
                </span>
              )}
            </div>
          </div>

          <div className="notification-permission-actions">
            <button
              type="button"
              className="primary"
              disabled={isUnsupported || isGranted}
              onClick={requestPermission}
            >
              {isUnsupported
                ? 'Notifications unavailable'
                : isGranted
                ? 'Notifications enabled'
                : 'Enable notifications'}
            </button>
          </div>

          {isUnsupported ? (
            <p className="quiet fine-print">
              Desktop notifications are not supported in this browser or environment.
            </p>
          ) : isDenied ? (
            <p className="quiet fine-print warning-guidance">
              Notifications are blocked in your browser or system settings. Allow notifications in
              your browser site settings or Windows notification center, then reopen this panel.
            </p>
          ) : null}

          {notificationError && (
            <p className="error" role="alert">
              {notificationError}
            </p>
          )}
        </div>
      </SettingsSection>
    </div>
  );
}
