import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const secret=process.env.SESSION_SECRET||'';
if(secret.length<32) throw new Error('SESSION_SECRET must contain at least 32 random characters');
const key=crypto.createHash('sha256').update(secret).digest();
const file=path.join(process.env.DATA_DIR||'./data','sessions.enc.json');
fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
const sessions=new Map();
function save(){
  const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
  const encrypted=Buffer.concat([cipher.update(JSON.stringify([...sessions]),'utf8'),cipher.final()]);
  fs.writeFileSync(file+'.tmp',JSON.stringify({iv:iv.toString('base64'),
    tag:cipher.getAuthTag().toString('base64'),data:encrypted.toString('base64')}),{mode:0o600});
  fs.renameSync(file+'.tmp',file);
}
try {
  const data=JSON.parse(fs.readFileSync(file,'utf8'));
  const decipher=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(data.iv,'base64'));
  decipher.setAuthTag(Buffer.from(data.tag,'base64'));
  const records=JSON.parse(Buffer.concat([decipher.update(Buffer.from(data.data,'base64')),decipher.final()]).toString('utf8'));
  for(const [id,s] of records)if(s.expires>Date.now())sessions.set(id,s);
} catch(err) {if(fs.existsSync(file))throw new Error('Cannot decrypt session store: check SESSION_SECRET',{cause:err});}
export function readSession(cookie){
  if(typeof cookie!=='string'||cookie.length<20||cookie.length>200)return null;
  const s=sessions.get(digest(cookie));
  return s&&s.expires>Date.now()?s:null;
}
export function ensureSession(req,res){
  let session=readSession(req.cookies?.tesstream);
  if(!session){
    const cookie=crypto.randomBytes(32).toString('base64url');
    session={id:digest(cookie),expires:Date.now()+7*86400e3,posters:{},streams:{},metas:{}};
    sessions.set(session.id,session);
    res.cookie('tesstream',cookie,{httpOnly:true,sameSite:'lax',
      secure:process.env.TRUST_PROXY==='true'&&req.secure,path:'/',maxAge:7*86400e3});
    save();
  }
  req.session=session;return session;
}
export function persist(session){session.expires=Date.now()+7*86400e3;save();}
export function revoke(session,res){sessions.delete(session.id);res.clearCookie('tesstream',{path:'/'});save();}
export function publicUser(session){
  return {plex:session.plex?{username:session.plex.username,email:session.plex.email}:null,
    stremio:session.stremio?{email:session.stremio.user?.email||''}:null};
}
export function opaque(map,value,ttl=7200000){
  const key=crypto.randomBytes(16).toString('hex');map[key]={value,expires:Date.now()+ttl};
  if(Object.keys(map).length>4000)for(const [k,v] of Object.entries(map))if(v.expires<Date.now())delete map[k];
  return key;
}
export function resolve(map,id){const item=map?.[id];return item&&item.expires>Date.now()?item.value:null;}
