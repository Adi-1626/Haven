import { useEffect, useRef } from 'react';
import type { useMedia } from './media';

export function MicrophoneTest({ media }: { media: ReturnType<typeof useMedia> }) {
  const stop = useRef(media.stopMicTest);
  stop.current = media.stopMicTest;
  useEffect(() => () => stop.current(), []);
  const active = media.micTest.status === 'running' || media.micTest.status === 'starting';
  return <section className="microphone-test" aria-label="Microphone test">
    <h3>Mic Test</h3>
    <p>Check how you sound with your current input volume, sensitivity, noise suppression and echo cancellation. Use headphones to avoid feedback. Test playback is limited to 30% volume.</p>
    <div className="mic-test-controls">
      <button type="button" className={active ? 'danger' : 'primary'} onClick={() => active ? media.stopMicTest() : void media.startMicTest()}>{active ? 'Stop Test' : "Let's Check"}</button>
      <span role="status">{media.micTest.status === 'starting' ? 'Waiting for microphone…' : media.micTest.status === 'running' ? media.micTest.speaking ? 'Playing your voice' : 'Listening — speak into your microphone' : 'Test your microphone before joining voice'}</span>
    </div>
    <meter className="mic-input-meter" aria-label="Microphone input level" min={0} max={1} value={media.micTest.level} />
    <label>Input Volume <span>{Math.round(media.settings.inputVolume * 100)}%</span><input aria-label="Input volume" type="range" min="0" max="2" step="0.05" value={media.settings.inputVolume} onChange={event => media.setSettings({ inputVolume: Number(event.target.value) })} /></label>
    <label>Input Sensitivity <span>{media.settings.inputSensitivity} dB</span><input aria-label="Input sensitivity" type="range" min="-60" max="-10" step="1" value={media.settings.inputSensitivity} onChange={event => media.setSettings({ inputSensitivity: Number(event.target.value) })} /></label>
    <p>Lower sensitivity values pick up quieter speech. Microphone testing uses a separate capture and does not transmit test playback to your voice channel. Push to Talk and voice mute do not silence this test.</p>
    {media.micTest.error && <p className="error" role="alert">{media.micTest.error}</p>}
  </section>;
}

export default MicrophoneTest;
