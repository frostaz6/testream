// End-to-end encoder integration test with a synthetic FastChannels/HDMI
// MPEG-TS source. This verifies a .m3u8 bridge URL that 302-redirects to
// video/mp2t is playable by ffmpeg. It does NOT authenticate with DIRECTV.
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

process.env.STREAM_HOST_ALLOWLIST='127.0.0.1';
const {launch}=await import('../server/ffmpeg.js');
const exec=promisify(execFile);
const temp=await mkdtemp(join(tmpdir(),'testream-bridge-'));
let server,worker;
function ffmpeg(args){
  return new Promise((resolve,reject)=>{
    const child=spawn('ffmpeg',args,{stdio:['ignore','pipe','pipe']});
    let error='';const buffers=[];
    child.stdout.on('data',x=>buffers.push(x));
    child.stderr.on('data',x=>{error=(error+x.toString()).slice(-2000);});
    child.once('error',reject);
    child.once('close',code=>code===0?resolve(Buffer.concat(buffers)):reject(new Error(error)));
  });
}
try{
  const {stdout:version}=await exec('ffmpeg',['-version']);
  assert(Number(version.match(/ffmpeg version (\d+)/)?.[1])>=7,'ffmpeg 7+ required');
  // Generate an MPEG-TS capture source with independent moving video and audio.
  const fixture=await ffmpeg([
    '-hide_banner','-loglevel','error',
    '-f','lavfi','-i','testsrc2=size=320x180:rate=24000/1001',
    '-f','lavfi','-i','sine=frequency=440:sample_rate=44100',
    '-t','2.5','-c:v','mpeg2video','-bf','0','-b:v','800k',
    '-c:a','mp2','-ar','44100','-b:a','128k',
    '-f','mpegts','pipe:1'
  ]);
  assert(fixture.length>100000,'Fixture must contain actual MPEG-TS packets');
  let redirects=0,encoderHits=0;
  server=http.createServer((req,res)=>{
    if(req.url==='/play/fc-player/directv/206.m3u8'){
      redirects++;
      res.writeHead(302,{Location:'/channels/7/stream.mpg'});res.end();
    }else if(req.url==='/channels/7/stream.mpg'){
      encoderHits++;
      res.writeHead(200,{'Content-Type':'video/mp2t','Content-Length':fixture.length});
      res.end(fixture);
    }else{res.writeHead(404);res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url='http://127.0.0.1:'+server.address().port+'/play/fc-player/directv/206.m3u8';
  const out=[],encoder=[],first=[];
  const ended=new Promise((resolve,reject)=>{
    const watchdog=setTimeout(()=>{
      worker?.stop();
      reject(new Error('Timed out reading synthetic bridge MPEG-TS')),25000);
    watchdog.unref();
    launch({url,quality:'360p',bridge:true,
      onData:b=>out.push(b),
      onStatus:status=>encoder.push(status),
      onFirstData:status=>first.push(status),
      onExit:status=>{clearTimeout(watchdog);status.code===0?resolve(status):reject(new Error(status.error));}
    }).then(w=>{worker=w;}).catch(err=>{clearTimeout(watchdog);reject(err);});
  });
  const outcome=await ended;
  assert(outcome.bytes>100000,'Output must contain actual transcoded media');
  assert(redirects>=1&&encoderHits>=1,'Redirect must reach the MPEG-TS capture endpoint');
  assert(first.length===1&&first[0].firstPacketMs>=0,'First packet timing required');
  const output=join(temp,'bridge-transcoded.ts');
  await writeFile(output,Buffer.concat(out));
  const {stdout}=await exec('ffprobe',['-v','error','-show_entries',
    'stream=codec_name,sample_rate,width,height','-of','json',output]);
  const streams=JSON.parse(stdout).streams;
  assert(streams.some(x=>x.codec_name==='mpeg1video'&&x.width===640&&x.height===360));
  assert(streams.some(x=>x.codec_name==='mp2'&&x.sample_rate==='44100'));
  console.log(JSON.stringify({result:'pass',test:'FastChannels-style 302 to MPEG-TS',
    bytes:outcome.bytes,firstPacketMs:first[0].firstPacketMs,videoFrames:encoder.at(-1)?.frames,
    redirects,encoderHits,streams},null,2));
}finally{
  worker?.stop();
  if(server)await new Promise(resolve=>server.close(resolve));
  await rm(temp,{recursive:true,force:true});
}
