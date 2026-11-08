import test from 'node:test';
import assert from 'node:assert/strict';
import {createTunerPool} from '../server/tuner.js';

test('single bridge tuner rejects competing viewer and allows same-session restart',()=>{
  const pool=createTunerPool(1),first={},second={},other={};
  assert.equal(pool.claim('a',first).granted,true);
  assert.equal(pool.claim('b',other).granted,false);
  assert.equal(pool.claim('a',second).previous,first);
  assert.equal(pool.release('a',first),false);
  assert.equal(pool.used,1);
  assert.equal(pool.release('a',second),true);
  assert.equal(pool.claim('b',other).granted,true);
});
test('multiple capture tuners allow more than one viewer',()=>{
  const pool=createTunerPool(2);
  assert.equal(pool.claim('a',{}).granted,true);
  assert.equal(pool.claim('b',{}).granted,true);
  assert.equal(pool.claim('c',{}).granted,false);
});
