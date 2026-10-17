export interface DevicePreferences {
  inputDevice: string;
  outputDevice: string;
  inputDeviceLabel: string;
  outputDeviceLabel: string;
}

/** Device IDs are origin-scoped; local desktop backend ports change on restart. */
export function restoreAudioDevices(settings: DevicePreferences, devices: Pick<MediaDeviceInfo, 'kind' | 'deviceId' | 'label'>[]): Partial<DevicePreferences> {
  const patch: Partial<DevicePreferences> = {};
  for (const [key, label, kind] of [['inputDevice', 'inputDeviceLabel', 'audioinput'], ['outputDevice', 'outputDeviceLabel', 'audiooutput']] as const) {
    if (!settings[key] || !settings[label] || devices.some(device => device.kind === kind && device.deviceId === settings[key])) continue;
    const matches = devices.filter(device => device.kind === kind && device.label === settings[label]);
    // Never guess between two identically named physical devices.
    if (matches.length === 1) patch[key] = matches[0].deviceId;
  }
  return patch;
}
