import test from 'node:test';
import assert from 'node:assert/strict';
import { probeUrls, verdict } from './turn-relay-probe.mjs';

const server = { username: 'probe-user', credential: 'probe-secret' };
const urls = [
  'turn:relay.example:3478?transport=udp',
  'turn:relay.example:3478?transport=tcp',
  'turns:relay.example:443?transport=udp',
  'turns:relay.example:443?transport=tcp',
].map(url => ({ url, server }));
const relayed = { ok: true, local: 'relay', remote: 'relay', relayProtocol: 'udp' };

/** Fake pages whose evaluate behaves per URL; records every page opened and closed. */
function pages(behavior) {
  const opened = [], closed = [];
  const openPage = async () => {
    const index = opened.length;
    opened.push(index);
    return {
      page: { evaluate: async (_fn, { url }) => behavior(url) },
      close: async () => { closed.push(index); if (behavior.closeFails) throw new Error('already closed'); },
    };
  };
  return { openPage, opened, closed };
}

test('a page that crashes mid-test fails only its URL; the remaining URLs still run', async () => {
  // The regression: TURN over DTLS gathered nothing, the page died, and every later evaluate threw.
  const fake = pages(url => {
    if (url.startsWith('turns:relay.example:443?transport=udp')) throw new Error('page.evaluate: Target page, context or browser has been closed\n    at stack');
    return relayed;
  });
  const results = await probeUrls(urls, { openPage: fake.openPage });
  assert.deepEqual(results.map(result => result.ok), [true, true, false, true]);
  assert.equal(results[2].error, 'page.evaluate: Target page, context or browser has been closed');
  assert.equal(fake.opened.length, 4, 'every URL gets its own page');
  assert.deepEqual(fake.closed, [0, 1, 2, 3], 'every page is closed, including the crashed one');
});

test('a hung page is abandoned at the deadline and later URLs still run', async () => {
  const fake = pages(url => url.includes('transport=tcp') && url.startsWith('turn:') ? new Promise(() => {}) : relayed);
  const results = await probeUrls(urls, { openPage: fake.openPage, deadlineMs: 50 });
  assert.deepEqual(results.map(result => result.ok), [true, false, true, true]);
  assert.match(results[1].error, /no result within/);
  assert.equal(fake.closed.length, 4);
});

test('failing to open or close a page does not stop the run', async () => {
  let calls = 0;
  const flaky = async () => { if (calls++ === 0) throw new Error('browser crashed'); return { page: { evaluate: async () => relayed }, close: async () => { throw new Error('gone'); } }; };
  const results = await probeUrls(urls, { openPage: flaky });
  assert.deepEqual(results.map(result => result.ok), [false, true, true, true]);
  assert.equal(results[0].error, 'browser crashed');
});

test('verdict: plain TURN must relay; TURN/TLS counts only when required', () => {
  const result = (url, value) => ({ url, ...value });
  const plainOk = [result(urls[0].url, relayed), result(urls[1].url, relayed)];
  const tlsFailed = [result(urls[2].url, { ok: false }), result(urls[3].url, { ok: false })];
  assert.equal(verdict([...plainOk, ...tlsFailed]), true);
  assert.equal(verdict([...plainOk, ...tlsFailed], { requireTls: true }), false);
  assert.equal(verdict([result(urls[0].url, relayed), result(urls[1].url, { ok: true, local: 'srflx', remote: 'relay' })]), false, 'a non-relay pair is not a relay pass');
  assert.equal(verdict(tlsFailed), false, 'TLS alone is never a pass');
  assert.equal(verdict([]), false);
});
