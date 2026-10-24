import test from 'node:test';
import assert from 'node:assert/strict';
import { createCandidateRouter, iceUfrags } from './ice-candidates';

const sdp = (...ufrags: string[]) => ['v=0', 'o=- 1 2 IN IP4 127.0.0.1', 's=-', ...ufrags.flatMap((ufrag, index) => [`m=audio ${9 + index} UDP/TLS/RTP/SAVPF 111`, `a=ice-ufrag:${ufrag}`, 'a=ice-pwd:secret'])].join('\r\n') + '\r\n';
const candidate = (ufrag: string | null, port: number): RTCIceCandidateInit => ({ candidate: `candidate:1 1 udp 2122260223 192.0.2.1 ${port} typ host`, sdpMid: '0', sdpMLineIndex: 0, usernameFragment: ufrag });

test('reads every ICE ufrag from a description, including Chromium and Firefox formats', () => {
  assert.deepEqual([...iceUfrags(sdp('jdTc'))], ['jdTc']);
  assert.deepEqual([...iceUfrags(sdp('3f8c1d2a', '3f8c1d2a'))], ['3f8c1d2a']);
  assert.deepEqual([...iceUfrags(sdp('a', 'b'))], ['a', 'b']);
  assert.equal(iceUfrags(undefined).size, 0);
});

test('candidates that arrive before the first remote description wait and are released in order', () => {
  const router = createCandidateRouter();
  assert.equal(router.receive(candidate('jdTc', 1)), null);
  assert.equal(router.receive(candidate('jdTc', 2)), null);
  assert.equal(router.receive(candidate(null, 3)), null);
  assert.deepEqual(router.applied(sdp('jdTc')).map(value => value.candidate), [candidate('jdTc', 1), candidate('jdTc', 2), candidate(null, 3)].map(value => value.candidate));
  assert.equal(router.pending, 0);
  assert.deepEqual(router.receive(candidate('jdTc', 4)), candidate('jdTc', 4));
});

test('a candidate of an ICE restart that overtakes its offer waits instead of failing as an unknown ufrag', () => {
  const router = createCandidateRouter();
  router.applied(sdp('old1'));
  // Delayed/out of order: the restart candidate arrives while the old generation is still applied.
  assert.equal(router.receive(candidate('new2', 1)), null);
  assert.deepEqual(router.receive(candidate('old1', 2)), candidate('old1', 2));
  assert.deepEqual(router.applied(sdp('new2')), [candidate('new2', 1)]);
  assert.equal(router.discarded, 0);
});

test('candidates of a replaced ICE generation are discarded, including ones already waiting', () => {
  const router = createCandidateRouter();
  router.applied(sdp('gen1'));
  assert.equal(router.receive(candidate('gen2', 1)), null);
  router.applied(sdp('gen3'));
  // gen2 was never applied, so its early candidate still waits for a later description.
  assert.equal(router.pending, 1);
  assert.equal(router.receive(candidate('gen1', 2)), null);
  assert.equal(router.discarded, 1);
  router.applied(sdp('gen2'));
  router.applied(sdp('gen4'));
  assert.equal(router.receive(candidate('gen2', 3)), null);
  assert.equal(router.receive(candidate('gen3', 4)), null);
  assert.equal(router.discarded, 3);
  // A peer that reuses credentials after a renegotiation is current again.
  router.applied(sdp('gen3'));
  assert.deepEqual(router.receive(candidate('gen3', 5)), candidate('gen3', 5));
});

test('an ignored colliding offer keeps current candidates flowing and resolves its own on the next description', () => {
  const router = createCandidateRouter();
  router.applied(sdp('live'));
  router.ignoredOffer(sdp('glare'));
  assert.deepEqual(router.receive(candidate('live', 1), true), candidate('live', 1));
  assert.equal(router.receive(candidate('glare', 2), true), null);
  assert.equal(router.receive(candidate(null, 3), true), null);
  // The polite peer rolled back and answered with fresh credentials: its offer's candidates are stale.
  assert.deepEqual(router.applied(sdp('answer')), [candidate(null, 3)]);
  assert.equal(router.discarded, 1);
  assert.equal(router.receive(candidate('glare', 4)), null);

  const reused = createCandidateRouter();
  reused.applied(sdp('live'));
  reused.ignoredOffer(sdp('kept'));
  assert.equal(reused.receive(candidate('kept', 1), true), null);
  assert.deepEqual(reused.applied(sdp('kept')), [candidate('kept', 1)]);
  // Renegotiation glare without an ICE restart never retires the live generation.
  reused.ignoredOffer(sdp('kept'));
  assert.deepEqual(reused.receive(candidate('kept', 2), true), candidate('kept', 2));
});

test('descriptions without ICE credentials release candidates for the browser to validate', () => {
  const router = createCandidateRouter();
  assert.equal(router.receive(candidate('any', 1)), null);
  assert.deepEqual(router.applied('v=0\r\n'), [candidate('any', 1)]);
});

test('unmatched candidates are bounded and overflow is reported instead of dropped silently', () => {
  const router = createCandidateRouter();
  for (let port = 0; port < 256; port++) router.receive(candidate('future', port));
  assert.throws(() => router.receive(candidate('future', 999)), /More than 256 ICE candidates/);
});
