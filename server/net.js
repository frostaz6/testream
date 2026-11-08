import dns from 'node:dns/promises';
import net from 'node:net';
const exceptions=new Set((process.env.STREAM_HOST_ALLOWLIST||'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean));
function privateIp(ip){
  const v=ip.toLowerCase();
  if(v.includes(':')) return v==='::1'||v==='::'||v.startsWith('fe80:')||v.startsWith('fc')||v.startsWith('fd')||v.startsWith('::ffff:');
  const p=v.split('.').map(Number);
  return p[0]===0||p[0]===10||p[0]===127||p[0]>=224||(p[0]===169&&p[1]===254)||
    (p[0]===172&&p[1]>=16&&p[1]<=31)||(p[0]===192&&p[1]===168)||
    (p[0]===100&&p[1]>=64&&p[1]<=127)||(p[0]===192&&p[1]===0)||
    (p[0]===198&&(p[1]===18||p[1]===19));
}
export async function safeUrl(value){
  const u=new URL(value);
  if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw new Error('Unsupported media or add-on URL');
  if(u.hostname.length>253)throw new Error('Invalid hostname');
  if(exceptions.has(u.hostname.toLowerCase()))return u;
  if(u.hostname.endsWith('.local')||u.hostname.endsWith('.internal')||u.hostname==='localhost')throw new Error('Private host not allowed');
  const addresses=await dns.lookup(u.hostname,{all:true});
  if(!addresses.length||addresses.some(x=>privateIp(x.address)||!net.isIP(x.address)))throw new Error('Private address not allowed; configure STREAM_HOST_ALLOWLIST for trusted hosts');
  return u;
}
export async function getJson(value){
  let url=value;
  for(let i=0;i<4;i++){
    await safeUrl(url);
    const r=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(12000),headers:{Accept:'application/json'}});
    if(r.status>=300&&r.status<400){url=new URL(r.headers.get('location'),url).href;continue;}
    if(!r.ok)throw new Error('Upstream HTTP '+r.status);
    if(Number(r.headers.get('content-length')||0)>4000000)throw new Error('Response too large');
    const text=await r.text();
    if(text.length>4000000)throw new Error('Response too large');
    return JSON.parse(text);
  }
  throw new Error('Too many redirects');
}
