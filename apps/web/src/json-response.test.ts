import test from 'node:test';
import assert from 'node:assert/strict';
import { readApiJson, BackendUnavailableError } from './json-response.js';

test('API success requires a JSON object, including on Voroa HTTP-200 startup responses', async () => {
  for (const response of [
    new Response('<title>Starting your app - Voroa</title>', { headers: { 'content-type': 'text/html' } }),
    new Response('broken JSON', { headers: { 'content-type': 'application/json' } }),
    Response.json(null), Response.json([]), Response.json('ok'),
    Response.json({ error: 'upstream restarting' }, { status: 503 }),
  ]) await assert.rejects(readApiJson(response), BackendUnavailableError);
  assert.deepEqual(await readApiJson(Response.json({ ok: true })), { ok: true });
  await assert.rejects(readApiJson(Response.json({ error: 'Server permission denied' }, { status: 403 })), /Server permission denied/);
});
