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
export function transcodeArgs({url,quality='480p',seek=0,benchmark=false,bridge=false}){
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
    // FastChannels hardware-bridge URLs may END in .m3u8 but redirect to
    // an HTTP MPEG-TS capture encoder. Do not let ffmpeg force HLS by suffix.
    // This is only used for explicitly configured bridge feeds.
    if(bridge)args.push('-f','mpegts');
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
// Return only curated, non-secret diagnostics to the browser. ffmpeg may print
// signed URLs, authentication headers, and query-string tokens to stderr.
export function publicEncoderFailure(stderr,code,bytes=0){
  const message=String(stderr||'').toLowerCase();
  if(bytes===0&&code===0)return {failureKind:'empty',error:'Upstream closed without returning video or audio.'};
  if(/\b(401|403)\b|unauthorized|forbidden/.test(message))
    return {failureKind:'authorization',error:'Upstream refused playback (HTTP 401/403). Verify DIRECTV authorization, entitlement, and the FastChannels bridge.'};
  if(/\b(404|410)\b|not found/.test(message))
    return {failureKind:'missing',error:'Capture endpoint or channel was not found. Refresh the FastChannels bridge feed.'};
  if(/\b(500|502|503|504)\b|unavailable|not configured|tuner/.test(message))
    return {failureKind:'bridge',error:'FastChannels capture/encoder is unavailable. Check bridge configuration, tuner capacity, and its healthcheck.'};
  if(/invalid data|could not find codec|invalid argument|error when loading first segment/.test(message))
    return {failureKind:'format',error:'Upstream did not return decodable MPEG-TS. Check for a DRM-only manifest, an empty capture, or an incorrect feed type.'};
  if(/timed out|connection refused|connection reset|broken pipe/.test(message))
    return {failureKind:'network',error:'Capture stream connection failed or timed out. Check the bridge device and network connectivity.'};
  return {failureKind:'encoder',error:'ffmpeg stopped before playback finished. Inspect the bridge, capture hardware, and server logs (no source URLs exposed).'};
}
export async function launch({url,quality,seek=0,benchmark=false,bridge=false,onData,onStatus,onFirstData=()=>{},onExit}){
  if(!benchmark)await safeUrl(url);
  const child=spawn('ffmpeg',transcodeArgs({url,quality,seek,benchmark,bridge}),
    {stdio:['ignore','pipe','pipe','pipe'],windowsHide:true});
  let stderr='',progress='',started=Date.now(),bytes=0,stopped=false,firstDataMs=null;
  child.stdout.on('data',chunk=>{
    if(!chunk?.length)return;
    if(firstDataMs===null){firstDataMs=Date.now()-started;onFirstData({firstPacketMs:firstDataMs});}
    bytes+=chunk.length;onData(chunk);
  });
  child.stderr.on('data',buf=>{stderr=(stderr+buf.toString()).slice(-1200);});
  child.stdio[3].on('data',buf=>{
    progress+=buf.toString();
    const groups=progress.split(/\r?\nprogress=(?:continue|end)\r?\n/);
    progress=groups.pop()||'';
    if(groups.length){
      const entries=Object.fromEntries(groups.at(-1).split(/\r?\n/).filter(s=>s.includes('=')).map(s=>{const i=s.indexOf('=');return [s.slice(0,i),s.slice(i+1)];}));
      onStatus({type:'encoder',frames:Number(entries.frame)||0,fps:Number(entries.fps)||0,speed:entries.speed||'',
        outSeconds:Number(entries.out_time_us||entries.out_time_ms||0)/1e6,
        elapsedSeconds:(Date.now()-started)/1000,bytes});
    }
  });
  child.on('error',err=>{stderr=String(err.message);});
  child.on('close',(code,signal)=>{
    if(stopped)return;
    const failure=code!==0||bytes===0?publicEncoderFailure(stderr,code,bytes):null;
    onExit({code,signal,bytes,...(failure||{error:''})});
  });
  return {
    child,get bytes(){return bytes;},
    get age(){return (Date.now()-started)/1000;},
    stop(){stopped=true;child.stdout.destroy();child.kill('SIGTERM');
      const kill=setTimeout(()=>child.kill('SIGKILL'),3000);kill.unref();
      child.once('exit',()=>clearTimeout(kill));}
  };
}
