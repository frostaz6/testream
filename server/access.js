// Local-only by default. Jellyfin is an opt-in second login gate, not a media dependency.
export const authMode=(process.env.AUTH_MODE||'stremio').trim().toLowerCase();
if(!['stremio','jellyfin'].includes(authMode))throw new Error('AUTH_MODE must be stremio or jellyfin');
const normalized=s=>String(s||'').trim().toLowerCase();
const jellyfinAllowlist=new Set((process.env.JELLYFIN_ALLOWLIST||'').split(',').map(normalized).filter(Boolean));
const stremioAllowlist=new Set((process.env.STREMIO_ALLOWLIST||'').split(',').map(normalized).filter(Boolean));
if(authMode==='jellyfin'){
  if(!process.env.JELLYFIN_URL)throw new Error('JELLYFIN_URL is required when AUTH_MODE=jellyfin');
  if(jellyfinAllowlist.size===0)throw new Error('JELLYFIN_ALLOWLIST is required when AUTH_MODE=jellyfin');
}
export function jellyfinAllowed(user){
  return !!user && jellyfinAllowlist.size>0 &&
    [user.username,user.name,user.id].some(v=>v && jellyfinAllowlist.has(normalized(v)));
}
export function jellyfinAuthorized(session,now=Date.now()){
  return authMode!=='jellyfin'||(jellyfinAllowed(session?.jellyfin)&&
    Number.isFinite(session.jellyfin.authenticatedAt)&&now-session.jellyfin.authenticatedAt<12*3600000);
}
export function stremioAllowed(email){
  return stremioAllowlist.size===0||stremioAllowlist.has(normalized(email));
}
