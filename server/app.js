import express from 'express';
import http from 'node:http';
import {WebSocketServer,WebSocket} from 'ws';
import {spawn} from 'node:child_process';
import {Readable} from 'node:stream';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ensureSession,readSession,publicUser,persist,revoke} from './sessions.js';
import {authMode,jellyfinAuthorized} from './access.js';
import * as jellyfin from './jellyfin.js';
import * as stremio from './stremio.js';
import * as live from './live.js';
import {createTunerPool} from './tuner.js';
import {safeUrl} from './net.js';
import {qualities,bitrate,launch} from './ffmpeg.js';
const __dirname=path.dirname(fileURLToPath(import.meta.url));
const app=express(),server=http.createServer(app);
if(process.env.TRUST_PROXY==='true')app.set('trust proxy','loopback');
app.disable('x-powered-by');
app.use((req,res,next)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Content-Security-Policy',"default-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; script-src 'self'; style-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'");
  const origin=req.headers.origin;
  if(origin && new URL(origin).host!==req.headers.host)return res.status(403).json({error:'Cross-origin request refused'});
  next();
});
app.use(express.json({limit:'32kb'}));
app.use((req,res,next)=>{
  req.cookies=Object.fromEntries((req.headers.cookie||'').split(';').map(part=>{
    const i=part.indexOf('=');return i<0?['','']:[part.slice(0,i).trim(),decodeURIComponent(part.slice(i+1))];
  }).filter(x=>x[0]));
  ensureSession(req,res);next();
});
const respond=handler=>(req,res)=>Promise.resolve().then(()=>handler(req,res)).catch(err=>{
  console.warn(req.path,err.message);
  if(!res.headersSent)res.status(/sign in|allowlist|Unauthorized/i.test(err.message)?403:400).json({error:err.message});
});
function gateGuard(req,res,next){
  if(!jellyfinAuthorized(req.session))return res.status(403).json({error:'Jellyfin login is required for this installation'});
  next();
}
function stremioGuard(req,res,next){
  if(!jellyfinAuthorized(req.session))return res.status(403).json({error:'Jellyfin login required'});
  if(!req.session.stremio)return res.status(401).json({error:'Sign in to Stremio first'});
  next();
}
function liveGuard(req,res,next){
  if(!jellyfinAuthorized(req.session))return res.status(403).json({error:'Jellyfin login required'});
  if(authMode==='stremio'&&!req.session.stremio)return res.status(401).json({error:'Stremio sign-in required'});
  next();
}
// Short-window defense against accidental credential brute-force, including when proxied.
const attempts=new Map();
function loginLimit(req,res,next){
  const key=req.socket.remoteAddress||'unknown',now=Date.now();
  const saved=(attempts.get(key)||[]).filter(t=>now-t<300000);
  if(saved.length>=12)return res.status(429).json({error:'Too many login attempts. Try again in five minutes.'});
  saved.push(now);attempts.set(key,saved);
  if(attempts.size>1000)for(const [k,v] of attempts)if(v.at(-1)<now-300000)attempts.delete(k);
  next();
}
app.get('/api/health',(_,res)=>res.json({status:'ok',ffmpeg:'7+ required'}));
app.get('/api/session',(req,res)=>res.json(publicUser(req.session)));
app.post('/api/jellyfin/login',loginLimit,respond(async(req,res)=>{
  if(authMode!=='jellyfin')return res.status(404).json({error:'Jellyfin authentication is disabled'});
  const {username,password}=req.body||{};
  res.json(await jellyfin.signIn(req.session,username,password));
}));
app.post('/api/logout',respond(async(req,res)=>{
  if(req.session.stremio)await stremio.signOut(req.session);
  if(req.session.jellyfin)await jellyfin.signOut(req.session);
  revoke(req.session,res);res.json({ok:true});
}));
app.post('/api/stremio/login',loginLimit,gateGuard,respond(async(req,res)=>{
  const {email,password}=req.body||{};
  if(typeof email!=='string'||typeof password!=='string'||!email.includes('@')||password.length>500)throw new Error('Enter valid Stremio credentials');
  res.json(await stremio.signIn(req.session,email,password));
}));
app.post('/api/stremio/logout',gateGuard,respond(async(req,res)=>{
  await stremio.signOut(req.session);res.json({ok:true});
}));
app.get('/api/home',stremioGuard,respond(async(req,res)=>res.json(await stremio.home(req.session))));
app.get('/api/library',stremioGuard,respond(async(req,res)=>res.json(await stremio.libraryPage(req.session,req.query.type))));
const bridgeTuners=createTunerPool(process.env.FASTCHANNELS_BRIDGE_TUNERS||1);
app.get('/api/live',liveGuard,respond(async(req,res)=>{
  const result=await live.lineup(req.query.refresh==='1');
  res.setHeader('Cache-Control','private, no-store');
  res.json({...result,tuners:{used:bridgeTuners.used,max:bridgeTuners.max},feeds:live.configuredFeeds()});
}));
app.post('/api/live/select/:id',liveGuard,respond(async(req,res)=>{
  res.json(await live.select(req.session,req.params.id));
}));
app.get('/api/search',stremioGuard,respond(async(req,res)=>res.json(await stremio.search(req.session,String(req.query.q||'')))));
app.get('/api/meta/:type/:id',stremioGuard,respond(async(req,res)=>{
  res.json(await stremio.meta(req.session,req.params.type,req.params.id));
}));
app.get('/api/streams',stremioGuard,respond(async(req,res)=>{
  const type=String(req.query.type||''),id=String(req.query.videoId||'');
  if(!type||!id||type.length>50||id.length>200)throw new Error('Missing video ID');
  res.json(await stremio.streams(req.session,type,id));
}));
app.post('/api/progress',stremioGuard,respond(async(req,res)=>{
  const data=req.body||{};
  const valid={id:String(data.id||''),videoId:String(data.videoId||''),
    position:Number(data.position),duration:Number(data.duration)};
  if(valid.id.length>200||valid.videoId.length>200)throw new Error('Invalid item');
  await stremio.progress(req.session,valid);res.json({ok:true});
}));
app.get('/api/poster/:id',stremioGuard,respond(async(req,res)=>{
  let u=stremio.selectedPoster(req.session,req.params.id);
  if(!u)return res.status(404).end();
  for(let i=0;i<4;i++){
    await safeUrl(u);
    const r=await fetch(u,{redirect:'manual',signal:AbortSignal.timeout(12000),headers:{Accept:'image/*'}});
    if(r.status>=300&&r.status<400){u=new URL(r.headers.get('location'),u).href;continue;}
    if(!r.ok)throw new Error('Image server returned '+r.status);
    const type=(r.headers.get('content-type')||'').split(';')[0];
    if(!['image/jpeg','image/png','image/webp','image/gif','image/avif'].includes(type))throw new Error('Unsupported poster type');
    if(Number(r.headers.get('content-length')||0)>6000000)throw new Error('Poster too large');
    res.setHeader('Content-Type',type);
    res.setHeader('Cache-Control','private, max-age=3600');
    let amount=0;
    for await(const chunk of Readable.fromWeb(r.body)){
      amount+=chunk.length;if(amount>6000000)break;
      if(!res.write(chunk))await new Promise(resolve=>res.once('drain',resolve));
    }
    return res.end();
  }
  throw new Error('Too many poster redirects');
}));
app.get('/api/speedtest',liveGuard,(req,res)=>{
  const data=crypto.randomBytes(512*1024);
  res.setHeader('Content-Type','application/octet-stream');
  res.setHeader('Content-Length',data.length);
  res.setHeader('Cache-Control','no-store');
  res.end(data);
});
app.get('/api/probe',stremioGuard,respond(async(req,res)=>{
  const source=stremio.selectedStream(req.session,String(req.query.streamId||''));
  if(!source)throw new Error('Stream expired; select a source again');
  await safeUrl(source.url);
  const result=await new Promise((resolve,reject)=>{
    const child=spawn('ffprobe',['-v','error','-show_entries','format=duration:stream=codec_type,width,height,r_frame_rate',
      '-of','json',source.url],{stdio:['ignore','pipe','pipe']});
    let output='',err='';
    const timeout=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('ffprobe timeout'));},12000);
    child.stdout.on('data',b=>{output+=b;});
    child.stderr.on('data',b=>{err+=b;});
    child.on('error',reject);
    child.on('close',code=>{clearTimeout(timeout);if(code)reject(new Error(err.slice(-200)||'ffprobe failed'));
      else {try{resolve(JSON.parse(output));}catch(e){reject(e);}}});
  });
  res.json({duration:Number(result.format?.duration)||0,streams:result.streams||[]});
}));
const wsServer=new WebSocketServer({noServer:true,perMessageDeflate:false,maxPayload:16384});
server.on('upgrade',(req,socket,head)=>{
  try{
    const origin=req.headers.origin;
    if(origin&&new URL(origin).host!==req.headers.host)throw new Error('Origin mismatch');
    const raw=(req.headers.cookie||'').match(/(?:^|;\s*)tesstream=([^;]+)/)?.[1];
    const session=readSession(raw?decodeURIComponent(raw):'');
    if(!session||!jellyfinAuthorized(session))throw new Error('Sign-in required');
    if(authMode==='stremio'&&!session.stremio)throw new Error('Stremio sign-in required');
    const u=new URL(req.url,'http://localhost');
    if(u.pathname!=='/ws')throw new Error('Not found');
    const bench=u.searchParams.get('benchmark')==='1';
    // Live streams are allowed under Jellyfin authentication without a Stremio account.
    const source=bench?null:stremio.selectedStream(session,u.searchParams.get('streamId'));
    if(!bench&&!source)throw new Error('Stream selection expired');
    if(!bench&&!source.live&&!session.stremio)throw new Error('Stremio sign-in required for on-demand media');
    const quality=qualities[u.searchParams.get('quality')]?u.searchParams.get('quality'):'480p';
    const seek=source?.live?0:Math.max(0,Math.min(Number(u.searchParams.get('seek'))||0,864000));
    wsServer.handleUpgrade(req,socket,head,ws=>{
      if(source?.bridge){
        const lease=bridgeTuners.claim(session.id,ws);
        if(!lease.granted){
          ws.send(JSON.stringify({type:'error',message:'Bridge capture tuner is already in use. Try again when the other viewer finishes.'}));
          ws.close(1013,'Tuner busy');return;
        }
        ws.once('close',()=>bridgeTuners.release(session.id,ws));
        if(lease.previous&&lease.previous!==ws)lease.previous.close(1001,'Replaced by new playback session');
      }
      wsServer.emit('connection',ws,{bench,source,quality,seek});
    });
  }catch{socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');socket.destroy();}
});
wsServer.on('connection',async(ws,opts)=>{
  let worker=null,lastTick=Date.now(),lastBytes=0,encoder={};
  const openedAt=Date.now();
  let lastMediaAt=openedAt,firstPacketMs=null;
  const send=message=>{if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(message));};
  const timer=setInterval(()=>{
    if(ws.readyState!==WebSocket.OPEN)return;
    const delta=(Date.now()-lastTick)/1000;lastTick=Date.now();
    const nowBytes=worker?.bytes||0;
    const bps=Math.max(0,(nowBytes-lastBytes)/Math.max(.01,delta));lastBytes=nowBytes;
    const bytesPerSecond=bitrate(opts.quality)*1000/8;
    send({...encoder,type:'status',quality:opts.quality,source:opts.source?.bridge?'capture-bridge':opts.source?.prismcast?'prismcast':opts.source?.live?'live':'stremio',
      firstPacketMs,bufferedBytes:ws.bufferedAmount,bufferedSeconds:ws.bufferedAmount/bytesPerSecond,
      throughputBps:bps,uptime:worker?.age||0});
    // A successful upstream TCP connection is NOT proof of usable MPEG-TS.
    // Fail clearly if a capture tuner never produces any media.
    if(worker?.bytes===0&&Date.now()-openedAt>45000){
      send({type:'error',code:'NO_MEDIA',message:'Capture did not produce any media in 45 seconds. Run the FastChannels live bridge healthcheck and verify the HDMI encoder.'});
      ws.close(1013,'No capture data');
    }else if(worker?.bytes>0&&Date.now()-lastMediaAt>25000){
      send({type:'error',code:'MEDIA_STALLED',message:'No media data received for 25 seconds. Check the capture encoder and DIRECTV player device.'});
      ws.close(1013,'Capture stalled');
    }else if(ws.bufferedAmount>bytesPerSecond*8){
      send({type:'error',code:'CLIENT_BACKPRESSURE',message:'Client too slow: encoder stopped'});
      ws.close(1013);
    }
  },2000);timer.unref();
  ws.on('message',data=>{try{const x=JSON.parse(data.toString());if(x.type==='ping')send({type:'pong',t:x.t});}catch{}});
  const cleanup=()=>{clearInterval(timer);worker?.stop();worker=null;};
  ws.once('close',cleanup);ws.once('error',cleanup);
  try{
    worker=await launch({url:opts.source?.url,benchmark:opts.bench,bridge:!!opts.source?.bridge,
      quality:opts.quality,seek:opts.seek,
      onData:data=>{
        lastMediaAt=Date.now();
        if(ws.readyState===WebSocket.OPEN)ws.send(data,{binary:true});
      },
      onFirstData:m=>{firstPacketMs=m.firstPacketMs;send({type:'firstPacket',...m});},
      onStatus:m=>{encoder=m;},
      onExit:m=>{send({type:'ended',...m});ws.close();}});
    if(ws.readyState!==WebSocket.OPEN)cleanup();
    else send({type:'started',quality:opts.quality,seek:opts.seek,benchmark:opts.bench});
  }catch(e){send({type:'error',message:e.message});ws.close(1011);}
});
const root=path.resolve(__dirname,'../dist');
app.use('/assets',express.static(path.join(root,'assets'),{immutable:true,maxAge:'1y'}));
app.get('/{*path}',(req,res)=>{
  if(req.path.startsWith('/api/'))return res.status(404).json({error:'Not found'});
  res.setHeader('Cache-Control','no-store');res.sendFile(path.join(root,'index.html'));
});
const port=Number(process.env.PORT||3000),host=process.env.HOST||'127.0.0.1';
server.listen(port,host,()=>console.log('TeStream listening on http://'+host+':'+port));
function close(){wsServer.clients.forEach(ws=>ws.close(1001));server.close();}
process.once('SIGTERM',close);process.once('SIGINT',close);
