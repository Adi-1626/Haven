import { codeForKey, isModifierKey } from './shortcuts';

export function isCaptureCancellation(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'name' in error && ['NotAllowedError', 'AbortError', 'NotFoundError'].includes(String(error.name)));
}

export function audioBitrate(_gamingMode: boolean, congested = false, preferredKbps = 48) {
  const preferred = Math.max(24, Math.min(64, Number.isFinite(preferredKbps) ? preferredKbps : 48)) * 1000;
  return congested ? Math.min(32_000, preferred) : preferred;
}

export function voiceDescription(description: RTCSessionDescriptionInit, gamingMode: boolean, preferredKbps = 48): RTCSessionDescriptionInit {
  if (!description.sdp) return description;
  const payloads = [...description.sdp.matchAll(/^a=rtpmap:(\d+) opus\/48000(?:\/2)?\r?$/gmi)].map(match => match[1]);
  let sdp = description.sdp;
  for (const payload of payloads) {
    const expression = new RegExp(`^a=fmtp:${payload} ([^\\r\\n]*)(\\r?)$`, 'gm');
    const parameters = `minptime=10;useinbandfec=1;usedtx=1;stereo=0;sprop-stereo=0;maxaveragebitrate=${audioBitrate(gamingMode, false, preferredKbps)}`;
    if (expression.test(sdp)) {
      sdp = sdp.replace(expression, (_line, value: string, ending: string) => {
        const retained = value.split(';').map(part => part.trim()).filter(part => !/^(minptime|useinbandfec|usedtx|stereo|sprop-stereo|maxaveragebitrate)=/i.test(part));
        return `a=fmtp:${payload} ${[...retained, parameters].join(';')}${ending}`;
      });
    } else sdp = sdp.replace(new RegExp(`(^a=rtpmap:${payload} [^\\r\\n]+)(\\r?\\n)`, 'm'), `$1$2a=fmtp:${payload} ${parameters}$2`);
  }
  return { type: description.type, sdp };
}

const unidentified = (event: Pick<KeyboardEvent, 'code'>) => !event.code || event.code === 'Unidentified';

export function matchesShortcut(event: Pick<KeyboardEvent, 'code' | 'key' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'>, shortcut: string) {
  const parts = shortcut.split('+');
  const key = parts.at(-1) ?? '';
  if (!key) return false;
  // A lone modifier key (for example Right Control) is identified by its own code.
  if (isModifierKey(key)) return parts.length === 1 && event.code === key;
  const modifiers = new Set(parts.slice(0, -1));
  return event.ctrlKey === (modifiers.has('Control') || modifiers.has('CommandOrControl'))
    && event.shiftKey === modifiers.has('Shift') && event.altKey === modifiers.has('Alt')
    && event.metaKey === (modifiers.has('Super') || modifiers.has('Meta') || modifiers.has('Command'))
    && (event.code === codeForKey(key) || (unidentified(event) && event.key.toLowerCase() === key.toLowerCase()));
}

export function missingAudioDevice(devices: Pick<MediaDeviceInfo, 'kind' | 'deviceId'>[], kind: MediaDeviceKind, selected: string) {
  return Boolean(selected && !devices.some(device => device.kind === kind && device.deviceId === selected));
}

export function releasesShortcut(event: Pick<KeyboardEvent, 'code' | 'key'>, shortcut: string) {
  const parts = shortcut.split('+');
  const key = parts.at(-1) ?? '';
  if (isModifierKey(key)) return event.code === key;
  return event.code === codeForKey(key) || (unidentified(event) && event.key.toLowerCase() === key.toLowerCase())
    || parts.slice(0, -1).some(modifier => event.code.startsWith(modifier === 'CommandOrControl' ? 'Control' : modifier === 'Super' || modifier === 'Command' ? 'Meta' : modifier));
}
