import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {transcodeArgs} from '../server/ffmpeg.js';
const exec=promisify(execFile);
const tmp=await mkdtemp(join(tmpdir(),'testream-'));
function run(args){
  return new Promise((resolve,reject)=>{
    const child=spawn('ffmpeg',args,{stdio:['ignore','pipe','pipe','pipe']});
    child.stdio[3].resume();
    const chunks=[];let error='';
    child.stdout.on('data',b=>chunks.push(b));
    child.stderr.on('data',b=>{error+=b;if(error.length>10000)error=error.slice(-10000);});
    child.once('error',reject);
    child.once('close',code=>code?reject(new Error(error)):resolve(Buffer.concat(chunks)));
  });
}
function nearAudio(pts,list){
  const nearest=list.reduce((best,x)=>Math.abs(x-pts)<Math.abs(best-pts)?x:best,Infinity);
  return Number.isFinite(nearest)?pts-nearest:null;
}
try{
  const {stdout:version}=await exec('ffmpeg',['-version']);
  const major=Number(version.match(/ffmpeg version (\d+)/)?.[1]||0);
  if(major<7)throw new Error('ffmpeg >=7 required, got '+version.split('\n')[0]);
  const args=transcodeArgs({benchmark:true,quality:'360p'});
  args.splice(args.length-3,0,'-t','6');
  const data=await run(args),media=join(tmp,'flash-beep.ts');
  await writeFile(media,data);
  const {stdout}=await exec('ffprobe',['-v','error','-show_entries','stream=codec_name,sample_rate,width,height,avg_frame_rate:packet=codec_type,pts_time',
    '-of','json',media],{maxBuffer:15*1024*1024});
  const scan=JSON.parse(stdout),tracks=scan.streams||[];
  if(!tracks.some(x=>x.codec_name==='mpeg1video'&&x.width===640&&x.height===360))throw new Error('Missing MPEG-1 video');
  if(!tracks.some(x=>x.codec_name==='mp2'&&x.sample_rate==='44100'))throw new Error('Missing 44.1kHz MP2');
  const packets=scan.packets||[];
  const video=packets.filter(x=>x.codec_type==='video').map(x=>Number(x.pts_time));
  const audio=packets.filter(x=>x.codec_type==='audio').map(x=>Number(x.pts_time));
  if(video.length<140||audio.length<150)throw new Error('Too few packets: video='+video.length+', audio='+audio.length);
  const nearest=video.map(v=>nearAudio(v,audio)).filter(Number.isFinite);
  const mean=nearest.reduce((x,y)=>x+y,0)/nearest.length;
  const jitter=Math.sqrt(nearest.reduce((x,y)=>x+(y-mean)**2,0)/nearest.length);
  const framePeriods=video.slice(1).map((v,i)=>(v-video[i])*1000);
  const period=framePeriods.reduce((x,y)=>x+y,0)/framePeriods.length;
  console.log(JSON.stringify({test:'flash-beep MPEG-TS',bytes:data.length,videoFrames:video.length,
    audioPackets:audio.length,nearestAudioPacketOffsetMs:Number((mean*1000).toFixed(2)),
    packetJitterMs:Number((jitter*1000).toFixed(2)),meanFramePeriodMs:Number(period.toFixed(3))},null,2));
  if(Math.abs(mean)>.1||jitter>.08)throw new Error('Abnormal timestamp skew or packet jitter');
  const film=await run(['-hide_banner','-loglevel','error','-f','lavfi','-i',
    'testsrc2=size=640x360:rate=24000/1001','-t','3','-vf',
    "fps='min(source_fps,30)'",'-c:v','mpeg1video','-bf','0','-an','-f','mpegts','pipe:1']);
  const filmPath=join(tmp,'film.ts');await writeFile(filmPath,film);
  const fr=await exec('ffprobe',['-v','error','-select_streams','v:0','-count_frames',
    '-show_entries','stream=nb_read_frames,avg_frame_rate','-of','json',filmPath]);
  const stream=JSON.parse(fr.stdout).streams?.[0];
  console.log('Film fps test:',stream);
  if(Math.abs(Number(stream.nb_read_frames)-72)>1)throw new Error('23.976fps video was duplicated/dropped');
  console.log('PASS: synthetic transport, codec, timestamps and film fps');
}finally{await rm(tmp,{recursive:true,force:true});}
