import crypto from 'node:crypto';
const clientId=crypto.createHash('sha256').update(process.env.SESSION_SECRET).digest('hex').slice(0,24);
const allowlist=(process.env.PLEX_ALLOWLIST||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
const headers={'Accept':'application/json','X-Plex-Client-Identifier':clientId,
  'X-Plex-Product':'TeStream','X-Plex-Version':'0.1.0','X-Plex-Platform':'Web'};
export function allowed(user){
  return allowlist.length>0 && [user.username,user.email,user.title].filter(Boolean).some(x=>allowlist.includes(String(x).toLowerCase()));
}
async function plex(url,options={}){
  const r=await fetch(url,{...options,headers:{...headers,...options.headers},signal:AbortSignal.timeout(12000)});
  if(!r.ok) throw new Error('Plex returned HTTP '+r.status);
  return r.json();
}
export async function startPin(session){
  const pin=await plex('https://plex.tv/api/v2/pins?strong=true',{method:'POST'});
  session.plexPin={id:pin.id,expires:Date.now()+300000};
  const params=new URLSearchParams({clientID:clientId,code:pin.code,
    'context[device][product]':'TeStream',forwardUrl:'http://127.0.0.1:3000/'});
  return {url:'https://app.plex.tv/auth#?'+params.toString(),expires:session.plexPin.expires};
}
export async function completePin(session){
  if(!session.plexPin || Date.now()>session.plexPin.expires) throw new Error('Plex login timed out');
  const pin=await plex('https://plex.tv/api/v2/pins/'+encodeURIComponent(session.plexPin.id));
  if(!pin.authToken) return {pending:true};
  const user=await plex('https://plex.tv/api/v2/user',{headers:{'X-Plex-Token':pin.authToken}});
  if(!allowed(user))throw new Error('This Plex account is not on the administrator allowlist');
  session.plex={username:user.username||user.title,email:user.email};
  delete session.plexPin;
  return {pending:false,username:session.plex.username};
}
