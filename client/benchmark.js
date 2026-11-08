export function measureBenchmarks(flashes,beeps,startupMs){
  const pairs=[];
  for(const flash of flashes){
    const beep=beeps.reduce((best,t)=>Math.abs(t-flash)<Math.abs(best-flash)?t:best,Infinity);
    if(Number.isFinite(beep)&&Math.abs(beep-flash)<450)pairs.push({flash,beep,offset:flash-beep});
  }
  const offsets=pairs.map(x=>x.offset);
  const mean=offsets.reduce((a,b)=>a+b,0)/(offsets.length||1);
  const jitter=Math.sqrt(offsets.reduce((a,b)=>a+(b-mean)**2,0)/(offsets.length||1));
  const elapsed=(pairs.at(-1)?.flash-pairs[0]?.flash)||0;
  const drift=elapsed>0?(offsets.at(-1)-offsets[0])/(elapsed/60000):0;
  return {samples:pairs.length,offsetMs:Math.round(mean*10)/10,
    jitterMs:Math.round(jitter*10)/10,driftMsPerMinute:Math.round(drift*10)/10,
    startupMs:Math.round(startupMs||0),pairs};
}
