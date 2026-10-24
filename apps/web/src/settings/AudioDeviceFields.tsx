import { RefreshCw } from 'lucide-react';
import type { useMedia } from '../media';

interface AudioDeviceFieldsProps {
  media: ReturnType<typeof useMedia>;
  disabled?: boolean;
}

export function AudioDeviceFields({ media, disabled = false }: AudioDeviceFieldsProps) {

  const inputDevices = media.devices.filter(device => device.kind === 'audioinput');
  const outputDevices = media.devices.filter(device => device.kind === 'audiooutput');

  return (
    <div className="audio-devices-grid">
      <div className="audio-device-control">
        <label className="settings-field-label">
          <span>INPUT DEVICE</span>
          <div className="settings-select-wrapper">
            <select
              aria-label="Input device"
              disabled={disabled}
              value={media.settings.inputDevice}
              onChange={event => media.setSettings({ inputDevice: event.target.value })}
            >
              <option value="">System default</option>
              {inputDevices.map((device, index) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || `Microphone ${index + 1} — permission needed`}
                </option>
              ))}
            </select>
          </div>
        </label>
      </div>

      <div className="audio-device-control">
        <label className="settings-field-label">
          <span>OUTPUT DEVICE</span>
          <div className="settings-select-wrapper">
            <select
              aria-label="Output device"
              disabled={disabled}
              value={media.settings.outputDevice}
              onChange={event => media.setSettings({ outputDevice: event.target.value })}
            >
              <option value="">System default</option>
              {outputDevices.map((device, index) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || `Speaker ${index + 1} — permission needed`}
                </option>
              ))}
            </select>
          </div>
        </label>
      </div>

      <div className="audio-device-refresh-row">
        <span className="audio-device-hint">
          Detect newly connected or unplugged hardware:
        </span>
        <div className="audio-device-actions">
          <button
            type="button"
            className="secondary small-button"
            disabled={disabled}
            onClick={() => void media.refreshDevices()}
          >
            <RefreshCw size={13} />
            <span>Detect audio devices</span>
          </button>
        </div>
      </div>

      {media.deviceError && (
        <p className="error" role="alert">
          {media.deviceError}
        </p>
      )}
    </div>
  );
}
