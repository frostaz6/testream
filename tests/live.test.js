import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePlaylist,identifyProvider} from '../server/m3u.js';

test('M3U parses FastChannels channel metadata without exposing URLs to the client',()=>{
  const playlist='#EXTM3U\n#EXTINF:-1 tvg-id="espn1" tvg-chno="206" group-title="Sports",ESPN\n'+
    'http://fastchannels:5523/play/espn/channel.m3u8\n'+
    '#EXTINF:-1 group-title="Events",ESPN+ Volleyball\n/feeds/sports/event.ts\n';
  const channels=parsePlaylist(playlist,'http://fastchannels:5523/feeds/default/m3u');
  assert.equal(channels.length,2);
  assert.equal(channels[0].name,'ESPN');
  assert.equal(channels[0].group,'Sports');
  assert.equal(channels[0].channelNumber,'206');
  assert.equal(channels[1].url,'http://fastchannels:5523/feeds/sports/event.ts');
  assert.match(channels[1].id,/^[a-f0-9]{24}$/);
});
test('M3U rejects non-network and credential-bearing stream URLs and malformed input',()=>{
  assert.throws(()=>parsePlaylist('not an m3u','http://example.com'));
  const p='#EXTM3U\n#EXTINF:-1,Local\nfile:///etc/passwd\n'+
    '#EXTINF:-1,Userinfo\nhttp://user:password@localhost:8000/stream\n'+
    '#EXTINF:-1,Allowed\nhttps://example.org/stream.m3u8\n';
  assert.deepEqual(parsePlaylist(p,'http://example.com').map(c=>c.name),['Allowed']);
});

test('detects DIRECTV bridge channels without exposing the source URL',()=>{
  assert.equal(identifyProvider('http://fastchannels:5523/play/fc-player/directv/206.m3u8'),'DIRECTV STREAM');
  assert.equal(identifyProvider('http://ah4c:7654/play/tuner/directv:206'),'DIRECTV STREAM');
  assert.equal(identifyProvider('http://fastchannels:5523/play/fc-player/espn/abcd.m3u8'),'ESPN');
  assert.equal(identifyProvider('http://fastchannels:5523/play/fc-player/other/abcd.m3u8'),'');
  const result=parsePlaylist('#EXTM3U\n#EXTINF:-1 group-title="Sports",ESPN\nhttp://fastchannels:5523/play/fc-player/directv/206.m3u8\n','http://fastchannels:5523/');
  assert.equal(result[0].provider,'DIRECTV STREAM');
});
