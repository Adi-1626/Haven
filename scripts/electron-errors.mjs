import assert from 'node:assert/strict';

export async function watchElectronErrors(instance) {
  const marker = 'HAVEN_TEST_MAIN_EXCEPTION:';
  const errors = [];
  let pending = '';
  instance.process().stderr?.on('data', chunk => {
    pending += chunk.toString();
    const lines = pending.split('\n');
    pending = lines.pop() || '';
    for (const line of lines) if (line.includes(marker)) errors.push(line.slice(line.indexOf(marker) + marker.length));
  });
  await instance.evaluate(() => {
    process.on('uncaughtException', error => process.stderr.write(`\nHAVEN_TEST_MAIN_EXCEPTION:${JSON.stringify({ message: error.message, stack: error.stack })}\n`));
  });
  return () => assert.deepEqual(errors, [], 'Electron main-process exceptions occurred, including during window teardown');
}
