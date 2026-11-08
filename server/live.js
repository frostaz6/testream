import crypto from 'node:crypto';
import {safeUrl} from './net.js';
import {opaque,persist} from './sessions.js';

const configuredUrl=(process.env.FASTCHANNELS_M3U_URL||'').trim();
const CACHE_MS=60_000;
const MAX_PLAYLIST_BYTES=3_000_000;
let cached={at:0,channels:[]};

function attr(extinf,name){
  const pattern=new RegExp('(?:^|\\s)'+name+'="([^"]*)"','i');
  return extinf.match(pattern)?.[1]?.slice(0,250)||'';
}
export function parsePlaylist(body,base){
  if(typeof body!=='string'||!body.trimStart().startsWith('#EXTM3U'))throw new Error('Invalid M3U playlist');
  const lines=body.split(/\r?\n/),channels=[];
  let meta='';
  for(const lineRaw of lines){
    const line=lineRaw.trim();
    if(line.startsWith('#EXTINF:')){meta=line;continue;}
    if(!line||line[0]==='#')continue;
    if(!meta)continue;
    let u;
    try{u=new URL(line,base);}catch{meta='';continue;}
    if(!['https:','http:'].includes(u.protocol)||u.username||u.password){meta='';continue;}
    const name=(meta.slice(meta.indexOf(',')+1)||attr(meta,'tvg-name')||'Unnamed channel').slice(0,160).trim();
    const id=crypto.createHash('sha256').update(u.href).update('\0').update(name).digest('hex').slice(0,24);
    channels.push({id,name,group:attr(meta,'group-title'),channelNumber:attr(meta,'tvg-chno'),
      tvgId:attr(meta,'tvg-id'),url:u.href});
    meta='';
    if(channels.length>=3000)break;
  }
  return channels;
}
async function playlistText(url){
  let current=url;
  for(let redirects=0;redirects<4;redirects++){
    await safeUrl(current);
    const r=await fetch(current,{redirect:'manual',headers:{Accept:'audio/x-mpegurl, application/vnd.apple.mpegurl, text/plain'},
      signal:AbortSignal.timeout(15000)});
    if(r.status>=300&&r.status<400){
      const target=r.headers.get('location');
      if(!target)throw new Error('M3U redirected without Location');
      current=new URL(target,current).href;
      continue;
    }
    if(!r.ok)throw new Error('FastChannels returned HTTP '+r.status);
    if(Number(r.headers.get('content-length')||0)>MAX_PLAYLIST_BYTES)throw new Error('Playlist is too large');
    const reader=r.body?.getReader();
    if(!reader)throw new Error('M3U response had no body');
    const buffers=[];let bytes=0;
    try{
      while(true){
        const {value,done}=await reader.read();
        if(done)break;
        bytes+=value.byteLength;
        if(bytes>MAX_PLAYLIST_BYTES)throw new Error('Playlist exceeds 3 MB limit');
        buffers.push(value);
      }
    }finally{reader.releaseLock();}
    return {text:Buffer.concat(buffers).toString('utf8'),base:current};
  }
  throw new Error('FastChannels M3U exceeded redirect limit');
}
export async function channels(force=false){
  if(!configuredUrl)return {configured:false,channels:[]};
  if(!force&&Date.now()-cached.at<CACHE_MS)return {configured:true,channels:cached.channels};
  const playlist=await playlistText(configuredUrl);
  const next=parsePlaylist(playlist.text,playlist.base);
  const checked=[];
  for(const channel of next){
    try{await safeUrl(channel.url);checked.push(channel);}catch{}
  }
  cached={at:Date.now(),channels:checked};
  return {configured:true,channels:checked};
}
export async function select(session,id){
  if(typeof id!=='string'||!/^[a-f0-9]{24}$/.test(id))throw new Error('Invalid channel ID');
  const all=await channels(),channel=all.channels.find(c=>c.id===id);
  if(!channel)throw new Error('Channel unavailable or removed from the playlist');
  const streamId=opaque(session.streams,
    {url:channel.url,type:'live',videoId:channel.id,live:true},3600000);
  persist(session);
  return {streamId,title:channel.name,group:channel.group};
}
