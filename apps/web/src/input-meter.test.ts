import test from 'node:test';
import assert from 'node:assert/strict';
import { createInputMeter } from './input-meter';

test('hidden meters retain the latest sample without publishing React notifications', () => {
  const meter = createInputMeter();
  for (let i = 0; i < 100; i++) meter.publish(i / 100);
  assert.equal(meter.getSnapshot(), 1);
  let updates = 0;
  const stop = meter.subscribe(() => updates++);
  meter.publish(0.5); meter.publish(0.501);
  assert.equal(updates, 1, 'unchanged quantized levels do not notify');
  stop(); meter.publish(0.7);
  assert.equal(updates, 1); assert.equal(meter.getSnapshot(), 0.7);
});

test('meter listeners subscribe independently, reset and clamp without an audio timer', () => {
  const meter = createInputMeter(); let a = 0; let b = 0;
  const stopA = meter.subscribe(() => a++); const stopB = meter.subscribe(() => b++);
  meter.publish(2); stopA(); meter.publish(-1); stopB(); meter.publish(0.2);
  assert.deepEqual([a, b], [1, 2]); assert.equal(meter.getSnapshot(), 0.2);
});
