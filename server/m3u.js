import crypto from 'node:crypto';
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
