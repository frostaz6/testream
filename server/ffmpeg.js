import {spawn} from 'node:child_process';
import {safeUrl} from './net.js';
export const qualities={
  '360p':{width:640,height:360,videoKbps:900,audioKbps:128},
  '480p':{width:854,height:480,videoKbps:1600,audioKbps:128},
  '720p':{width:1280,height:720,videoKbps:3000,audioKbps:160}
};
export const bitrate=q=>(qualities[q]?.videoKbps||900)+(qualities[q]?.audioKbps||128);
export function filterFor(level){
  const q=qualities[level]||qualities['360p'];
  return "fps='min(source_fps,30)',scale="+q.width+":"+q.height+
    ":force_original_aspect_ratio=decrease:flags=bicubic,pad="+q.width+":"+q.height+
    ":(ow-iw)/2:(oh-ih)/2:black,setsar=1";
}
export function transcodeArgs({url,quality='480p',seek=0,benchmark=false}){
  const q=qualities[quality]||qualities['480p'];
  const args=['-hide_banner','-nostdin','-loglevel','warning','-stats_period','1','-progress','pipe:3'];
  if(benchmark){
    args.push('-re','-readrate_initial_burst','0','-f','lavfi','-i',
      "color=c=black:s=640x360:r=30,drawbox=c=white:x=0:y=0:w=iw:h=ih:t=fill:enable='lt(mod(t,2),0.12)'");
    args.push('-re','-readrate_initial_burst','0','-f','lavfi','-i',
      "aevalsrc=if(lt(mod(t\\,2)\\,0.12)\\,0.55*sin(2*PI*880*t)\\,0):s=44100:c=stereo");
  }else{
    args.push('-re','-readrate_initial_burst','0');
    if(seek>0)args.push('-ss',String(Math.max(0,Math.min(seek,864000))));
    args.push('-i',url);
  }
  args.push('-map','0:v:0','-map',benchmark?'1:a:0':'0:a:0?',
    '-vf',filterFor(quality),'-c:v','mpeg1video','-pix_fmt','yuv420p',
    '-b:v',q.videoKbps+'k','-maxrate',q.videoKbps+'k','-bufsize',(q.videoKbps*2)+'k',
    '-bf','0','-g','15','-fps_mode:v','passthrough',
    '-c:a','mp2','-b:a',q.audioKbps+'k','-ar','44100','-ac','2',
    '-af','acompressor=threshold=-24dB:ratio=2.5:attack=20:release=250:makeup=3,volume=1.25,alimiter=limit=0.89,aresample=44100',
    '-muxdelay','0.001','-muxpreload','0','-pes_payload_size','0','-flush_packets','1',
    '-f','mpegts','pipe:1');
  return args;
}
export async function launch({url,quality,seek=0,benchmark=false,onData,onStatus,onExit}){
  if(!benchmark)await safeUrl(url);
  const child=spawn('ffmpeg',transcodeArgs({url,quality,seek,benchmark}),
    {stdio:['ignore','pipe','pipe','pipe'],windowsHide:true});
  let stderr='', progress='',started=Date.now(),bytes=0,stopped=false;
  child.stdout.on('data',chunk=>{bytes+=chunk.length;onData(chunk);});
  child.stderr.on('data',buf=>{stderr=(stderr+buf.toString()).slice(-1200);});
  child.stdio[3].on('data',buf=>{
    progress+=buf.toString();
    const groups=progress.split(/\r?\nprogress=(?:continue|end)\r?\n/);
    progress=groups.pop()||'';
    if(groups.length){
      const entries=Object.fromEntries(groups.at(-1).split(/\r?\n/).filter(s=>s.includes('=')).map(s=>{const i=s.indexOf('=');return [s.slice(0,i),s.slice(i+1)];}));
      onStatus({type:'encoder',fps:Number(entries.fps)||0,speed:entries.speed||'',
        outSeconds:Number(entries.out_time_us||entries.out_time_ms||0)/1e6,
        elapsedSeconds:(Date.now()-started)/1000,bytes});
    }
  });
  child.on('error',err=>{stderr=String(err.message);});
  child.on('close',(code,signal)=>{if(!stopped)onExit({code,signal,error:stderr.slice(-800)});});
  return {
    child,get bytes(){return bytes;},
    get age(){return (Date.now()-started)/1000;},
    stop(){stopped=true;child.stdout.destroy();child.kill('SIGTERM');
      const kill=setTimeout(()=>child.kill('SIGKILL'),3000);kill.unref();
      child.once('exit',()=>clearTimeout(kill));}
  };
}
