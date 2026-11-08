import crypto from 'node:crypto';
import {authMode,jellyfinAllowed} from './access.js';
import {persist} from './sessions.js';
const root=process.env.JELLYFIN_URL;
let base;
if(root){
  base=new URL(root.endsWith('/')?root:root+'/');
  if(!['http:','https:'].includes(base.protocol)||base.username||base.password||
     base.search||base.hash)throw new Error('JELLYFIN_URL must be an HTTP(S) server root without credentials or query parameters');
}
const deviceId=crypto.createHash('sha256').update(process.env.SESSION_SECRET||'').update(':jellyfin').digest('hex').slice(0,32);
const header=token=>'MediaBrowser Client="TeStream", Device="TeStream Docker", DeviceId="'+deviceId+
  '", Version="0.2.0"'+(token?', Token="'+token+'"':'');
export async function signIn(session,username,password){
  if(authMode!=='jellyfin')throw new Error('Jellyfin sign-in is not enabled');
  if(typeof username!=='string'||typeof password!=='string'||!username.trim()||
    username.length>200||password.length>500)throw new Error('Enter valid Jellyfin credentials');
  const r=await fetch(new URL('Users/AuthenticateByName',base),{
    method:'POST',redirect:'error',
    headers:{Authorization:header(),'content-type':'application/json',Accept:'application/json'},
    body:JSON.stringify({Username:username,Pw:password}),signal:AbortSignal.timeout(12000)
  });
  if(!r.ok)throw new Error(r.status===401||r.status===403?'Invalid Jellyfin credentials':'Jellyfin authentication failed (HTTP '+r.status+')');
  const data=await r.json();
  const user=data.User;
  if(!data.AccessToken||!user?.Id||!user?.Name)throw new Error('Jellyfin returned an invalid authentication response');
  if(!jellyfinAllowed({id:user.Id,username:user.Name}))throw new Error('Jellyfin account is not on JELLYFIN_ALLOWLIST');
  session.jellyfin={username:user.Name,id:user.Id,token:data.AccessToken,authenticatedAt:Date.now()};
  persist(session);
  return {username:user.Name};
}
export async function signOut(session){
  if(!session.jellyfin)return;
  const token=session.jellyfin.token;
  delete session.jellyfin;
  persist(session);
  if(!base||!token)return;
  try{
    await fetch(new URL('Sessions/Logout',base),{method:'POST',redirect:'error',
      headers:{Authorization:header(token)},signal:AbortSignal.timeout(4000)});
  }catch{}
}
