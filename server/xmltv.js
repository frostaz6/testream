import {XMLParser} from 'fast-xml-parser';

const parser=new XMLParser({
  ignoreAttributes:false, attributeNamePrefix:'@_', textNodeName:'#text',
  parseTagValue:false, parseAttributeValue:false, trimValues:true, processEntities:true
});
const arr=x=>x===undefined||x===null?[]:Array.isArray(x)?x:[x];
const text=x=>typeof x==='string'?x:typeof x==='number'?String(x):x&&typeof x==='object'?String(x['#text']||''):'';

export function parseXmltvDate(value){
  const match=String(value||'').match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?(?:\s*([+-])(\d{2})(\d{2}))?/);
  if(!match)return null;
  const [_,y,month,day,hour,min,sec='00',sign='+',tzh='00',tzm='00']=match;
  const offset=(Number(tzh)*60+Number(tzm))*(sign==='+'?1:-1);
  const ms=Date.UTC(+y,+month-1,+day,+hour,+min,+sec)-offset*60000;
  return Number.isFinite(ms)?ms:null;
}

export function parseGuide(xml,{from=Date.now()-3600000,to=Date.now()+6*3600000}={}){
  if(typeof xml!=='string'||xml.length>18_000_000)throw new Error('Invalid or oversized XMLTV guide');
  if(/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml))throw new Error('XMLTV DOCTYPE and entities are not accepted');
  const result=parser.parse(xml);
  if(!result?.tv)throw new Error('Invalid XMLTV document');
  const index=new Map();
  for(const entry of arr(result.tv.programme)){
    const channel=String(entry?.['@_channel']||'');
    const start=parseXmltvDate(entry?.['@_start']),stop=parseXmltvDate(entry?.['@_stop']);
    if(!channel||start===null||stop===null||stop<=start||stop<from||start>to)continue;
    const event={
      start,stop,title:text(arr(entry.title)[0]).slice(0,250)||'Untitled program',
      subtitle:text(arr(entry['sub-title'])[0]).slice(0,200),
      description:text(arr(entry.desc)[0]).slice(0,450),
      category:text(arr(entry.category)[0]).slice(0,60)
    };
    if(!index.has(channel))index.set(channel,[]);
    const programs=index.get(channel);
    if(programs.length<100)programs.push(event);
  }
  for(const programs of index.values())programs.sort((a,b)=>a.start-b.start);
  return index;
}

export function currentPrograms(programs,at=Date.now()){
  const list=programs||[];
  const now=list.find(p=>p.start<=at&&p.stop>at)||null;
  const next=list.find(p=>p.start>at)||null;
  return {now,next};
}
