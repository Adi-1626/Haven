import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import type { DesktopUpdateState } from './desktop';
import { activeCommunication, disconnectForUpdate, downloadDetail, formatBytes, updateIndicator, updateStatusText, UPDATE_DISCONNECT_WARNING } from './desktop-updates';
import { DesktopUpdateButton, DesktopUpdateDialog, DesktopUpdateSettings } from './DesktopUpdates';

const base: DesktopUpdateState = { status: 'idle', currentVersion: '1.0.0', availableVersion: null, releaseName: null, releaseNotes: '', releaseDate: null, progress: null, error: null, errorKind: null, lastCheckedAt: null, reason: null };
const state = (patch: Partial<DesktopUpdateState>): DesktopUpdateState => ({ ...base, ...patch });
const media = (patch: Partial<{ voiceChannelId: string | null; sharing: boolean; watchingStreams: string[] }> = {}) => {
  const calls: string[] = [];
  return { calls, value: { voiceChannelId: null, sharing: false, watchingStreams: [] as string[], leave: () => { calls.push('leave'); }, ...patch } };
};

test('voice, screen sharing and watching a stream each count as an active call', () => {
  assert.equal(activeCommunication(media().value).active, false);
  assert.deepEqual(activeCommunication(media({ voiceChannelId: 'voice-1' }).value), { voice: true, sharing: false, watching: false, active: true });
  assert.equal(activeCommunication(media({ sharing: true }).value).active, true);
  assert.equal(activeCommunication(media({ watchingStreams: ['peer-1'] }).value).active, true);
});

test('confirmed updates leave voice through the existing deliberate disconnect before quitting', async () => {
  const waits: number[] = [];
  const idle = media();
  assert.equal(await disconnectForUpdate(idle.value, async ms => { waits.push(ms); }), false);
  assert.deepEqual([idle.calls, waits], [[], []]);
  const inCall = media({ voiceChannelId: 'voice-1', sharing: true, watchingStreams: ['peer-1'] });
  assert.equal(await disconnectForUpdate(inCall.value, async ms => { waits.push(ms); }), true);
  assert.deepEqual(inCall.calls, ['leave'], 'one leave tears down voice, sharing and watched streams');
  assert.deepEqual(waits, [400]);
});

test('the warning text matches the agreed wording', () => {
  assert.equal(UPDATE_DISCONNECT_WARNING, "Updating Haven will close the app and disconnect you from your current voice call or stream. You'll need to rejoin after the update.");
});

test('the toolbar indicator stays hidden until a newer version exists, then tracks download, ready and paused states', () => {
  assert.equal(updateIndicator(null), null, 'browser or pre-updater desktop build');
  for (const status of ['idle', 'checking', 'unsupported', 'failed', 'offline'] as const) assert.equal(updateIndicator(state({ status })), null, status);
  assert.deepEqual(updateIndicator(state({ status: 'downloading', availableVersion: '1.0.1', progress: { percent: 41.6, transferred: 1, total: 2, bytesPerSecond: 3 } })), { tone: 'progress', label: 'Downloading Haven 1.0.1 — 42%', percent: 42 });
  assert.deepEqual(updateIndicator(state({ status: 'waiting', availableVersion: '1.0.1' })), { tone: 'busy', label: 'Another Haven window is downloading Haven 1.0.1', percent: null });
  assert.equal(updateIndicator(state({ status: 'ready', availableVersion: '1.0.1' }))?.tone, 'ready');
  assert.equal(updateIndicator(state({ status: 'installing', availableVersion: '1.0.1' }))?.tone, 'busy');
  assert.match(updateIndicator(state({ status: 'offline', availableVersion: '1.0.1', error: 'You appear to be offline.' }))!.label, /paused — You appear to be offline/);
});

test('status text covers checking, downloading, ready, failed, offline and unsupported', () => {
  assert.equal(updateStatusText(state({})), 'Haven checks for updates automatically.');
  assert.equal(updateStatusText(state({ lastCheckedAt: 1 }), () => '9:41 AM'), 'Haven is up to date. Last checked at 9:41 AM.');
  assert.equal(updateStatusText(state({ status: 'checking' })), 'Checking for updates…');
  assert.match(updateStatusText(state({ status: 'downloading', availableVersion: '1.0.1' })), /in the background/);
  assert.match(updateStatusText(state({ status: 'waiting', availableVersion: '1.0.1' })), /Another Haven window .* the same download/);
  assert.match(updateStatusText(state({ status: 'ready', availableVersion: '1.0.1' })), /ready/);
  assert.equal(updateStatusText(state({ status: 'failed', error: 'GitHub could not provide the update (HTTP 502). Haven will try again.' })), 'GitHub could not provide the update (HTTP 502). Haven will try again.');
  assert.match(updateStatusText(state({ status: 'offline', error: 'You appear to be offline.' })), /offline/);
  assert.match(updateStatusText(state({ status: 'unsupported', reason: 'Portable copies of Haven cannot update themselves.' })), /Portable/);
});

test('download progress shows percent, size and speed', () => {
  assert.equal(downloadDetail(state({ progress: { percent: 42.2, transferred: 54 * 1024 ** 2, total: 129 * 1024 ** 2, bytesPerSecond: 5.2 * 1024 ** 2 } })), '42% · 54.0 MB of 129 MB · 5.2 MB/s');
  assert.equal(downloadDetail(state({})), '');
  assert.equal(formatBytes(0), '0 MB');
  assert.equal(formatBytes(2.5 * 1024 ** 3), '2.5 GB');
});

test('the update dialog shows both versions, plain-text notes and installs rather than linking to GitHub', () => {
  const html = renderToString(createElement(DesktopUpdateDialog, { state: state({ status: 'ready', availableVersion: '1.0.1', releaseName: 'Haven v1.0.1', releaseNotes: '<img src=x onerror=alert(1)> Faster voice', progress: { percent: 100, transferred: 1, total: 1, bytesPerSecond: 0 } }), media: media().value, onClose: () => {} }));
  assert.match(html, /Current version<\/dt><dd>1\.0\.0/);
  assert.match(html, /Available version<\/dt><dd>1\.0\.1/);
  assert.match(html, /Update &amp; Restart/);
  assert.match(html, />Later</);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt; Faster voice/, 'notes are rendered as text, never HTML');
  assert.doesNotMatch(html, /href=|github\.com/i);
  const downloading = renderToString(createElement(DesktopUpdateDialog, { state: state({ status: 'downloading', availableVersion: '1.0.1', progress: { percent: 37, transferred: 10, total: 100, bytesPerSecond: 1 } }), media: media().value, onClose: () => {} }));
  assert.match(downloading, /role="progressbar"[^>]*aria-valuenow="37"/);
  assert.match(downloading, /Downloading… <!-- -->37<!-- -->%/);
  assert.doesNotMatch(downloading, /Update &amp; Restart/, 'nothing to install until the download is verified');
  const waiting = renderToString(createElement(DesktopUpdateDialog, { state: state({ status: 'waiting', availableVersion: '1.0.1' }), media: media().value, onClose: () => {} }));
  assert.match(waiting, /Downloading update/);
  assert.match(waiting, /<button[^>]*disabled=""[^>]*>Check for Updates/, 'no second download while another window has the cache');
  assert.match(waiting, />Later</);
});

test('the update UI renders nothing outside Haven Desktop', () => {
  assert.equal(renderToString(createElement(DesktopUpdateButton, { media: media().value })), '');
  assert.equal(renderToString(createElement(DesktopUpdateSettings, { media: media().value })), '');
});
