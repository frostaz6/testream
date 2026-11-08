import {safeUrl} from './net.js';
import {opaque,persist} from './sessions.js';
import {parsePlaylist} from './m3u.js';

const configuredUrl=(process.env.FASTCHANNELS_M3U_URL||'').trim();
const CACHE_MS=60_000;
const MAX_PLAYLIST_BYTES=3_000_000;
let cached={at:0,channels:[]};

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
