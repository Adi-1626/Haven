import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useAppActivity } from './app-activity';

/** Detach only the visual sink; shared capture, audio and receiver tracks stay live. */
export function createVideoPlayback(element: HTMLVideoElement, stream: MediaStream, initialActive: boolean, onPlaying: (playing: boolean) => void) {
  let active = initialActive;
  let visible = true;
  let disposed = false;
  let generation = 0;
  const doc = element.ownerDocument;
  const fullscreen = () => doc.fullscreenElement === element || !!doc.fullscreenElement?.contains(element);
  const wanted = () => !disposed && (doc.pictureInPictureElement === element || (active && (visible || fullscreen())));
  const detach = () => {
    generation++;
    element.pause();
    element.srcObject = null;
    if (!disposed) onPlaying(false);
  };
  const play = async () => {
    if (!wanted()) return;
    element.srcObject = stream;
    const current = ++generation;
    try {
      await element.play();
      if (current === generation && wanted()) onPlaying(true);
    } catch (error) {
      if (current === generation && !disposed) onPlaying(false);
      throw error;
    }
  };
  const update = () => {
    if (wanted()) {
      if (element.srcObject !== stream) void play().catch(() => {});
    } else if (element.srcObject !== null) detach();
  };
  const Observer = doc.defaultView?.IntersectionObserver;
  const observer = Observer ? new Observer(entries => {
    const entry = entries.find(value => value.target === element);
    if (!entry) return;
    visible = entry.isIntersecting;
    update();
  }) : undefined;
  observer?.observe(element);
  doc.addEventListener('fullscreenchange', update);
  element.addEventListener('enterpictureinpicture', update);
  element.addEventListener('leavepictureinpicture', update);
  update();
  return {
    play,
    setActive(value: boolean) { active = value; update(); },
    destroy() {
      if (disposed) return;
      disposed = true;
      observer?.disconnect();
      doc.removeEventListener('fullscreenchange', update);
      element.removeEventListener('enterpictureinpicture', update);
      element.removeEventListener('leavepictureinpicture', update);
      detach();
    },
  };
}

export function useVideoPlayback(ref: RefObject<HTMLVideoElement | null>, stream: MediaStream) {
  const active = useAppActivity();
  const [playing, setPlaying] = useState(false);
  const playback = useRef<ReturnType<typeof createVideoPlayback> | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    setPlaying(false);
    const controller = createVideoPlayback(ref.current, stream, active, setPlaying);
    playback.current = controller;
    return () => { playback.current = null; controller.destroy(); };
  }, [ref, stream]);
  useEffect(() => { playback.current?.setActive(active); }, [active, ref, stream]);
  const play = useCallback(() => playback.current?.play() ?? Promise.resolve(), []);
  return { playing, play };
}
