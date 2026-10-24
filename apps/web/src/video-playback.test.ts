import test from 'node:test';
import assert from 'node:assert/strict';
import { createVideoPlayback } from './video-playback';

function fixture(withObserver = true) {
  let intersection!: (entries: IntersectionObserverEntry[]) => void;
  let disconnected = 0;
  let pauses = 0;
  let plays = 0;
  let trackStops = 0;
  const pending: Array<() => void> = [];
  const playing: boolean[] = [];
  class Observer {
    constructor(callback: typeof intersection) { intersection = callback; }
    observe() {}
    disconnect() { disconnected++; }
  }
  const doc = Object.assign(new EventTarget(), { pictureInPictureElement: null as unknown, fullscreenElement: null as { contains(element: unknown): boolean } | null, defaultView: { IntersectionObserver: withObserver ? Observer : undefined } });
  const element = Object.assign(new EventTarget(), {
    ownerDocument: doc, srcObject: null as MediaStream | null,
    pause() { pauses++; }, play() { plays++; return new Promise<void>(done => pending.push(done)); },
  });
  const stream = { getTracks: () => [{ stop: () => trackStops++ }] } as unknown as MediaStream;
  const controller = createVideoPlayback(element as unknown as HTMLVideoElement, stream, true, value => playing.push(value));
  return {
    controller, doc, element, stream, playing,
    intersect(value: boolean) { intersection([{ target: element, isIntersecting: value } as unknown as IntersectionObserverEntry]); },
    resolvePlay() { pending.shift()?.(); },
    counts: () => ({ disconnected, pauses, plays, trackStops }),
  };
}

test('background and offscreen videos release the decoder without stopping shared tracks', async () => {
  const view = fixture();
  assert.equal(view.element.srcObject, view.stream);
  view.resolvePlay(); await Promise.resolve();
  assert.equal(view.playing.at(-1), true);
  view.controller.setActive(false);
  assert.equal(view.element.srcObject, null);
  assert.equal(view.playing.at(-1), false);
  view.controller.setActive(true);
  assert.equal(view.element.srcObject, view.stream);
  view.intersect(false);
  assert.equal(view.element.srcObject, null);
  view.resolvePlay(); await Promise.resolve();
  assert.equal(view.playing.at(-1), false, 'late playback promises cannot revive a detached video');
  view.intersect(true);
  assert.equal(view.element.srcObject, view.stream);
  view.resolvePlay(); await Promise.resolve();
  assert.equal(view.playing.at(-1), true);
  const plays = view.counts().plays;
  view.intersect(true);
  assert.equal(view.counts().plays, plays, 'unchanged intersection must not restart playback');
  view.controller.destroy(); view.controller.destroy();
  assert.equal(view.element.srcObject, null);
  assert.equal(view.counts().disconnected, 1);
  assert.equal(view.counts().trackStops, 0);
  const messages = view.playing.length;
  view.intersect(true); view.controller.setActive(true);
  assert.equal(view.playing.length, messages);
});

test('fullscreen playback overrides stale offscreen intersections but still respects background state', () => {
  const view = fixture();
  view.intersect(false);
  assert.equal(view.element.srcObject, null);
  view.doc.fullscreenElement = { contains: element => element === view.element };
  view.doc.dispatchEvent(new Event('fullscreenchange'));
  assert.equal(view.element.srcObject, view.stream);
  view.controller.setActive(false);
  assert.equal(view.element.srcObject, null);
  view.controller.setActive(true);
  assert.equal(view.element.srcObject, view.stream);
  view.doc.fullscreenElement = null;
  view.doc.dispatchEvent(new Event('fullscreenchange'));
  assert.equal(view.element.srcObject, null);
  view.controller.destroy();
});

test('browsers without IntersectionObserver retain foreground playback and cleanup pending play', async () => {
  const view = fixture(false);
  assert.equal(view.element.srcObject, view.stream);
  view.controller.destroy();
  view.resolvePlay(); await Promise.resolve();
  assert.equal(view.element.srcObject, null);
  assert.equal(view.playing.includes(true), false);
  assert.equal(view.counts().trackStops, 0);
});

test('picture in picture retains its visual sink in the background, then releases it on exit or disposal', () => {
  const view = fixture();
  view.doc.pictureInPictureElement = view.element;
  view.element.dispatchEvent(new Event('enterpictureinpicture'));
  view.controller.setActive(false);
  view.intersect(false);
  assert.equal(view.element.srcObject, view.stream);
  view.doc.pictureInPictureElement = null;
  view.element.dispatchEvent(new Event('leavepictureinpicture'));
  assert.equal(view.element.srcObject, null);
  view.doc.pictureInPictureElement = view.element;
  view.element.dispatchEvent(new Event('enterpictureinpicture'));
  assert.equal(view.element.srcObject, view.stream);
  view.controller.destroy();
  assert.equal(view.element.srcObject, null);
  view.element.dispatchEvent(new Event('enterpictureinpicture'));
  assert.equal(view.element.srcObject, null);
  assert.equal(view.counts().trackStops, 0);
});
