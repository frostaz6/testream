import {getJson,safeUrl} from './net.js';
import {opaque,resolve,persist} from './sessions.js';
const API='https://api.strem.io/api/';
const CINEMETA='https://v3-cinemeta.strem.io/';
async function call(method,body){
  const r=await fetch(API+method,{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify(body),signal:AbortSignal.timeout(12000)});
  if(!r.ok)throw new Error('Stremio HTTP '+r.status);
  const json=await r.json();
  if(json.error)throw new Error(json.error.message||'Stremio API error');
  return json.result;
}
export async function signIn(session,email,password){
  const data=await call('login',{email,password});
  if(!data?.authKey)throw new Error('Stremio did not return an auth key');
  session.stremio={authKey:data.authKey,user:data.user||{email}};
  delete session.cachedLibrary;delete session.cachedAddons;
  persist(session);
  return {email:session.stremio.user.email||email};
}
export async function signOut(session){
  if(session.stremio)await call('logout',{authKey:session.stremio.authKey}).catch(()=>{});
  delete session.stremio;delete session.cachedLibrary;delete session.cachedAddons;
  session.streams={};session.metas={};session.posters={};persist(session);
}
function auth(session){if(!session.stremio)throw new Error('Sign in to Stremio first');return session.stremio.authKey;}
export async function library(session,force=false){
  if(!force&&session.cachedLibrary&&Date.now()-session.cachedLibrary.at<30000)return session.cachedLibrary.value;
  const data=await call('datastoreGet',{authKey:auth(session),collection:'libraryItem',all:true});
  const items=(Array.isArray(data)?data:data?.library||[]).filter(x=>x&&!x.removed);
  session.cachedLibrary={at:Date.now(),value:items};
  return items;
}
export async function addons(session){
  if(session.cachedAddons&&Date.now()-session.cachedAddons.at<300000)return session.cachedAddons.value;
  const data=await call('addonCollectionGet',{authKey:auth(session),update:true});
  const descriptors=(Array.isArray(data)?data:data?.addons||[]).filter(x=>x.transportUrl);
  const result=[];
  for(const d of descriptors.slice(0,30)){
    try{
      const u=new URL(d.transportUrl);
      const base=u.pathname.endsWith('/manifest.json')?new URL('.',u).href:d.transportUrl.replace(/\/?$/,'/');
      await safeUrl(base);
      const manifest=d.manifest?.resources?d.manifest:await getJson(new URL('manifest.json',base));
      result.push({base,manifest});
    }catch(err){console.warn('Skipping add-on:',String(err.message));}
  }
  result.push({base:CINEMETA,manifest:{id:'org.stremio.cinemeta',resources:['meta','catalog'],catalogs:[]}});
  session.cachedAddons={at:Date.now(),value:result};
  return result;
}
function resource(manifest,name){
  return (manifest.resources||[]).some(r=>r===name||r?.name===name);
}
function typeOk(manifest,type){return !manifest.types?.length||manifest.types.includes(type);}
async function queryAddons(session,kind,type,id,extra=''){
  const set=await addons(session),results=[];
  for(const add of set){
    if(!resource(add.manifest,kind)||!typeOk(add.manifest,type))continue;
    try{
      const safeType=encodeURIComponent(type),safeId=encodeURIComponent(id);
      const path=kind+'/'+safeType+'/'+safeId+(extra?'/'+extra:'')+'.json';
      const body=await getJson(new URL(path,add.base));
      if(body)results.push(body);
    }catch{continue;}
  }
  return results;
}
function image(session,value){
  if(!value||typeof value!=='string')return '';
  return '/api/poster/'+opaque(session.posters,value,24*3600e3);
}
export function normalize(session,m){
  if(!m||!m.id&&!m._id)return null;
  const id=m.id||m._id;
  const ret={id,name:m.name||m.title||id,type:m.type||'movie',description:m.description||'',
    year:m.year||'',releaseInfo:m.releaseInfo||'',poster:image(session,m.poster),
    background:image(session,m.background),genres:m.genres||[],videos:m.videos||[],
    state:m.state||{},ctime:m._ctime||'',mtime:m._mtime||''};
  session.metas[id]={value:{id:ret.id,name:ret.name,type:ret.type,poster:m.poster||'',background:m.background||''},expires:Date.now()+86400000};
  return ret;
}
export async function home(session){
  const raw=await library(session),sorted=[...raw].sort((a,b)=>Date.parse(b._ctime||0)-Date.parse(a._ctime||0));
  const recent=sorted.slice(0,40).map(x=>normalize(session,x)).filter(Boolean);
  const continued=[...raw].filter(x=>x.state?.duration>0&&x.state?.timeOffset>0&&
    x.state.timeOffset/x.state.duration<0.94).sort((a,b)=>Date.parse(b.state?.lastWatched||0)-Date.parse(a.state?.lastWatched||0))
    .slice(0,30).map(x=>normalize(session,x)).filter(Boolean);
  persist(session);
  return {continueWatching:continued,recentlyAdded:recent};
}
export async function libraryPage(session,type){
  const items=(await library(session)).filter(x=>!type||type==='all'||x.type===type)
    .sort((a,b)=>String(a.name).localeCompare(String(b.name))).map(x=>normalize(session,x)).filter(Boolean);
  persist(session);return items;
}
export async function search(session,query){
  const term=query.trim().slice(0,100);
  if(!term)return [];
  const local=(await library(session)).filter(x=>x.name?.toLowerCase().includes(term.toLowerCase()));
  const set=await addons(session);const results=[...local];const seen=new Set(local.map(x=>x._id));
  for(const a of set){
    for(const catalog of a.manifest.catalogs||[]){
      if(!catalog.extra?.some(x=>x.name==='search'))continue;
      try{
        const part='catalog/'+encodeURIComponent(catalog.type)+'/'+encodeURIComponent(catalog.id)+
          '/search='+encodeURIComponent(term)+'.json';
        const body=await getJson(new URL(part,a.base));
        for(const m of body.metas||[]){if(!seen.has(m.id)){results.push(m);seen.add(m.id);}}
      }catch{}
    }
  }
  if(results.length===0){
    for(const type of ['movie','series']){
      try{const body=await getJson(CINEMETA+'catalog/'+type+'/top/search='+encodeURIComponent(term)+'.json');
        for(const m of body.metas||[])if(!seen.has(m.id)){seen.add(m.id);results.push(m);}
      }catch{}
    }
  }
  const ret=results.slice(0,80).map(x=>normalize(session,x)).filter(Boolean);persist(session);return ret;
}
export async function meta(session,type,id){
  const results=await queryAddons(session,'meta',type,id);
  const m=results.find(x=>x.meta)?.meta;
  if(!m)throw new Error('No metadata found for this title');
  const saved=(await library(session)).find(x=>x._id===id);
  const normalized=normalize(session,{...m,state:saved?.state||{}});
  persist(session);return normalized;
}
export async function streams(session,type,videoId){
  const results=await queryAddons(session,'stream',type,videoId);
  const found=[];
  for(const result of results){
    for(const s of result.streams||[]){
      if(!s.url||typeof s.url!=='string')continue;
      try{await safeUrl(s.url);}catch{continue;}
      const key=opaque(session.streams,{url:s.url,videoId,type},3600000);
      found.push({id:key,title:s.title||s.name||'HTTP stream',name:s.name||'',quality:s.quality||''});
    }
  }
  persist(session);return found;
}
export function selectedStream(session,id){return resolve(session.streams,id);}
export function selectedPoster(session,id){return resolve(session.posters,id);}
export async function progress(session,{id,videoId,position,duration}){
  if(!id||!videoId||!Number.isFinite(position)||!Number.isFinite(duration)||duration<=0)return;
  const known=resolve(session.metas,id);
  if(!known)throw new Error('Play item not recognized by this session');
  const items=await library(session);const existing=items.find(x=>x._id===id)||{};
  const old=existing.state||{};
  const now=new Date().toISOString();
  const ms=Math.round(Math.max(0,Math.min(position,duration))*1000);
  const durationMs=Math.round(duration*1000);
  const ended=ms/durationMs>0.94;
  const change={...existing,_id:id,name:known.name,type:known.type,
    poster:known.poster||existing.poster,removed:false,temp:false,
    _ctime:existing._ctime||now,_mtime:now,
    state:{...old,video_id:videoId,timeOffset:ended?0:ms,duration:durationMs,
      lastWatched:now,timeWatched:Math.max(0,(old.timeWatched||0)+15000),
      overallTimeWatched:Math.max(0,(old.overallTimeWatched||0)+15000),
      timesWatched:Math.max(old.timesWatched||0,ended?1:0)}};
  await call('datastorePut',{authKey:auth(session),collection:'libraryItem',changes:[change]});
  session.cachedLibrary=null;
  persist(session);
}
