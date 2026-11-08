import test from 'node:test';
import assert from 'node:assert/strict';
import {measureBenchmarks} from '../client/benchmark.js';
test('identical flash and beep times produce zero offset and jitter',()=>{
  const result=measureBenchmarks([2000,4000,6000],[2000,4000,6000],300);
  assert.equal(result.samples,3);
  assert.equal(result.offsetMs,0);
  assert.equal(result.jitterMs,0);
  assert.equal(result.driftMsPerMinute,0);
  assert.equal(result.startupMs,300);
});
test('positive offset means delayed flash and drift uses elapsed minutes',()=>{
  const result=measureBenchmarks([2050,4070,6090],[2000,4000,6000],125);
  assert.equal(result.samples,3);
  assert.equal(result.offsetMs,70);
  assert.ok(result.jitterMs>0);
  assert.ok(result.driftMsPerMinute>0);
});
test('unpaired events do not invent offsets',()=>{
  assert.equal(measureBenchmarks([2000],[5000],0).samples,0);
});
