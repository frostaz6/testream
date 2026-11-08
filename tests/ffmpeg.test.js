import test from 'node:test';
import assert from 'node:assert/strict';
import {transcodeArgs,filterFor,qualities,bitrate} from '../server/ffmpeg.js';
test('encoder uses correct one-way pacing and bitrate control',()=>{
  const args=transcodeArgs({url:'https://example.com/video.mp4',quality:'720p',seek:120});
  const raw=args.join(' ');
  assert.match(raw,/-re -readrate_initial_burst 0/);
  assert.match(raw,/-ss 120/);
  assert.match(raw,/-b:v 3000k -maxrate 3000k -bufsize 6000k -bf 0/);
  assert.match(raw,/-pes_payload_size 0 -flush_packets 1/);
  assert.match(raw,/-c:v mpeg1video/);
  assert.match(raw,/-c:a mp2 -b:a 160k -ar 44100/);
  assert.doesNotMatch(raw,/-q:v/);
  assert.doesNotMatch(raw,/-r 30/);
  assert.match(raw,/source_fps,30/);
  assert.match(raw,/pad=1280:720/);
  assert.equal(args.at(-1),'pipe:1');
});
test('quality levels have bounded encoder settings',()=>{
  for(const [name,q] of Object.entries(qualities)){
    assert.match(filterFor(name),new RegExp('pad='+q.width+':'+q.height));
    assert.equal(bitrate(name),q.videoKbps+q.audioKbps);
  }
});
test('benchmark source has paired lavfi inputs',()=>{
  const args=transcodeArgs({benchmark:true,quality:'360p'});
  assert.equal(args.filter(x=>x==='-re').length,2);
  assert.ok(args.some(x=>x.includes('drawbox')));
  assert.ok(args.some(x=>x.includes('aevalsrc')));
});
