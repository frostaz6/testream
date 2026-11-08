import test from 'node:test';
import assert from 'node:assert/strict';
import {safeUrl} from '../server/net.js';
test('rejects local sources and non-network schemes',async()=>{
  for(const url of ['file:///etc/passwd','http://127.0.0.1:1234/','http://localhost:3000/','http://192.168.1.4/file','http://[::1]/']){
    await assert.rejects(()=>safeUrl(url));
  }
});
test('rejects embedded upstream credentials',async()=>{
  await assert.rejects(()=>safeUrl('https://admin:password@example.com/stream'));
});
