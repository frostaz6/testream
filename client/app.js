import {CanvasPlayback} from './player.js';
import {measureBenchmarks} from './benchmark.js';
const main=document.getElementById('content'),overlay=document.getElementById('overlay');
const badge=document.getElementById('userBadge'),nav=document.getElementById('links');
let session=null,activePlayer=null,selectedMeta=null,pendingSources=[],routeSeq=0,lastBenchmark=null;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const api=async(url,opts={})=>{
  const resp=await fetch(url,{credentials:'same-origin',...opts,headers:opts.body?{'content-type':'application/json'}:{}});
  const json=await resp.json().catch(()=>({error:'Invalid server response'}));
  if(!resp.ok)throw new Error(json.error||'Request failed');
  return json;
};
const post=(url,body={})=>api(url,{method:'POST',body:JSON.stringify(body)});
function toast(message){
  const el=document.getElementById('notice');el.textContent=message;el.style.display='block';
  clearTimeout(toast.timeout);toast.timeout=setTimeout(()=>el.style.display='none',4500);
}
function externalProviders(){
  return '<div class="section"><div class="sectionHead"><h2>Live sports & TV</h2><small>Official provider playback</small></div>'+
    '<div class="providerLinks"><a class="btn secondary" target="_blank" rel="noopener noreferrer" href="https://www.espn.com/watch/">ESPN+ · Sign in / Watch ↗</a>'+
    '<a class="btn secondary" target="_blank" rel="noopener noreferrer" href="https://stream.directv.com/">DIRECTV STREAM · Sign in / Watch ↗</a></div>'+
    '<p class="muted">These providers use protected playback. TeStream opens their official sites; it does not collect their passwords or transcode DRM-protected video.</p></div>';
}
function card(item){
  if(!item)return '';
  const position=Number(item.state?.timeOffset||0),duration=Number(item.state?.duration||0);
  const pct=duration?Math.min(100,Math.round(position/duration*100)):0;
  return '<a class="poster" href="#title/'+encodeURIComponent(item.type)+'/'+encodeURIComponent(item.id)+'">'+
    '<div class="art">'+(item.poster?'<img loading="lazy" alt="" src="'+esc(item.poster)+'">':'▶')+'</div>'+
    (pct>0&&pct<95?'<div class="barMini"><span style="width:'+pct+'%"></span></div>':'')+
    '<h3>'+esc(item.name)+'</h3><small>'+esc(item.year||item.releaseInfo||item.type)+'</small></a>';
}
function section(title,items,empty){
  return '<section class="section"><div class="sectionHead"><h2>'+esc(title)+'</h2><small>'+items.length+' titles</small></div>'+
    (items.length?'<div class="grid">'+items.map(card).join('')+'</div>':'<div class="empty">'+esc(empty||'Nothing here yet.')+'</div>')+'</section>';
}
function loading(){main.innerHTML='<div class="loader">Loading…</div>';}
function activeLinks(route){
  nav.querySelectorAll('[data-page]').forEach(a=>a.classList.toggle('active',a.dataset.page===route));
  badge.textContent=session?.jellyfin?.username||session?.stremio?.email||'';
}
function showJellyfinSignIn(){
  activeLinks('');
  main.innerHTML='<div class="panel authPanel"><div class="eyebrow">OPTIONAL ACCESS CONTROL</div>'+
    '<h1>Sign in with Jellyfin</h1>'+
    '<p>This TeStream installation requires an approved Jellyfin account before connecting Stremio. Jellyfin is used only to authenticate viewers, not for video playback.</p>'+
    '<form id="jellyfinForm" class="form">'+
    '<input required type="text" name="username" autocomplete="username" placeholder="Jellyfin username">'+
    '<input required type="password" name="password" autocomplete="current-password" placeholder="Jellyfin password">'+
    '<button class="btn" type="submit">Connect Jellyfin</button></form></div>';
  main.querySelector('#jellyfinForm').addEventListener('submit',async event=>{
    event.preventDefault();
    const form=event.currentTarget,username=form.elements.username.value,password=form.elements.password.value;
    form.elements.password.value='';
    try{await post('/api/jellyfin/login',{username,password});await init();toast('Jellyfin verified');}
    catch(err){toast(err.message);}
  });
}
function showStremioSignIn(){
  activeLinks('');
  main.innerHTML='<div class="panel authPanel"><div class="eyebrow">STREMIO LIBRARY ACCESS</div>'+
    '<h1>Connect Stremio</h1><p>Your Stremio token stays encrypted on the server. The browser receives only an HttpOnly session cookie.</p>'+
    '<form id="stremioForm" class="form"><input required type="email" name="email" placeholder="Stremio email" autocomplete="username">'+
    '<input required type="password" name="password" placeholder="Stremio password" autocomplete="current-password">'+
    '<button class="btn" type="submit">Sign in to Stremio</button></form>'+
    (session.authMode==='jellyfin'&&session.jellyfin?
      '<p class="muted">You can also use Live TV with your Jellyfin account without connecting Stremio.</p>'+
      '<a href="#live" class="btn secondary" id="goLiveDirect">Continue to Live TV</a>':'')+
    '</div>'+externalProviders();
  main.querySelector('#goLiveDirect')?.addEventListener('click',()=>navigate());
  main.querySelector('#stremioForm').addEventListener('submit',async e=>{
    e.preventDefault();const form=e.currentTarget;
    const email=form.elements.email.value,password=form.elements.password.value;
    form.elements.password.value='';
    try{await post('/api/stremio/login',{email,password});await init();toast('Stremio connected');}
    catch(err){toast(err.message);}
  });
}
async function init(){
  session=await api('/api/session');
  if(session.authMode==='jellyfin'&&!session.jellyfin){showJellyfinSignIn();return;}
  if(!session.stremio&&!(session.authMode==='jellyfin'&&session.jellyfin&&location.hash==='#live')){
    showStremioSignIn();return;
  }
  await navigate();
}
async function navigate(){
  if(!session)return;
  const route=decodeURIComponent((location.hash||'#home').slice(1));
  const parts=route.split('/'),page=parts[0]||'home',ticket=++routeSeq;
  if(session.authMode==='jellyfin'&&!session.jellyfin){showJellyfinSignIn();return;}
  if(!session.stremio&&page!=='live'&&page!=='benchmark'){
    showStremioSignIn();return;
  }
  if(!session.stremio&&session.authMode!=='jellyfin'){
    showStremioSignIn();return;
  }
  activeLinks(page);loading();
  try{
    if(page==='home'){
      const data=await api('/api/home');if(ticket!==routeSeq)return;
      main.innerHTML='<div class="hero"><div class="eyebrow">YOUR ENTERTAINMENT, YOUR SERVER</div>'+
        '<h1>Pick up right where you left off.</h1>'+
        '<p>Movies, shows, and streams from your Stremio account. Encoded on your Docker server, decoded on a canvas.</p>'+
        '<a href="#library" class="btn">Explore your library →</a></div>'+
        section('Continue Watching',data.continueWatching,'Your in-progress titles will appear here.')+
        section('Recently Added',data.recentlyAdded,'Add a movie or series to Stremio to get started.')+
        externalProviders();
    }else if(['library','movies','series'].includes(page)){
      const type=page==='movies'?'movie':page==='series'?'series':'all';
      const items=await api('/api/library?type='+encodeURIComponent(type));
      if(ticket!==routeSeq)return;
      main.innerHTML='<div class="eyebrow">YOUR LIBRARY</div><h1>'+
        (type==='movie'?'Movies':type==='series'?'Series':'All titles')+'</h1>'+
        section('Browse',items,'Nothing in your Stremio library yet.');
    }else if(page==='live'){
      await showLive(ticket);
    }else if(page==='search'){
      main.innerHTML='<div class="eyebrow">DISCOVER</div><h1>Find a title</h1>'+
        '<form id="searchForm" class="searchBox"><input id="query" class="input" type="search" placeholder="Movies, series, episodes…" maxlength="100" required>'+
        '<button class="btn" type="submit">Search</button></form><div id="results" style="margin-top:30px"></div>';
      main.querySelector('#searchForm').addEventListener('submit',async e=>{
        e.preventDefault();const q=main.querySelector('#query').value;
        main.querySelector('#results').innerHTML='<div class="loader">Searching installed Stremio add-ons…</div>';
        try{const items=await api('/api/search?q='+encodeURIComponent(q));main.querySelector('#results').innerHTML=section('Results',items,'No titles matched your search.');}
        catch(err){toast(err.message);}
      });
    }else if(page==='title'){
      const type=parts[1],id=parts.slice(2).join('/');
      const m=await api('/api/meta/'+encodeURIComponent(type)+'/'+encodeURIComponent(id));
      if(ticket!==routeSeq)return;
      showTitle(m);
    }else if(page==='benchmark'){
      renderBenchmark();
    }else{
      location.hash='#home';
    }
  }catch(err){
    if(ticket!==routeSeq)return;
    main.innerHTML='<div class="panel"><h2>Could not load this page</h2><p>'+esc(err.message)+'</p><a class="btn" href="#home">Return home</a></div>';
  }
}
async function showLive(ticket,force=false){
  const data=await api('/api/live'+(force?'?refresh=1':''));
  if(ticket!==routeSeq)return;
  if(!data.configured){
    main.innerHTML='<div class="eyebrow">LIVE TV · CANVAS</div><h1>Live TV and sports</h1>'+
      '<div class="panel"><h3>Connect a trusted FastChannels feed</h3>'+
      '<p>Configure FASTCHANNELS_M3U_URL and FASTCHANNELS_EPG_URL for clear TV, and the separate FASTCHANNELS_BRIDGE_M3U_URL / FASTCHANNELS_BRIDGE_EPG_URL for hardware-bridge channels.</p>'+
      '<p>TeStream requires an accessible media feed. A protected DRM manifest alone is not playable in JSMpeg.</p></div>';
    return;
  }
  const list=(data.channels||[]).sort((a,b)=>{
    const aNumber=Number(a.channelNumber),bNumber=Number(b.channelNumber);
    if(a.channelNumber&&b.channelNumber&&Number.isFinite(aNumber)&&Number.isFinite(bNumber)&&aNumber!==bNumber)return aNumber-bNumber;
    return a.name.localeCompare(b.name);
  });
  const directv=list.filter(c=>c.provider==='DIRECTV STREAM');
  const directvCapture=directv.filter(c=>c.bridge).length;
  const time=x=>new Date(x).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
  const errors=(data.errors||[]).map(x=>'<p class="muted">'+esc(x.feed)+': '+esc(x.message)+'</p>').join('');
  main.innerHTML='<div class="eyebrow">CANVAS LIVE TV</div><h1>Live TV and sports</h1>'+
    '<p class="muted">MPEG-TS → JSMpeg Canvas/WebAudio. DRM-only channels require a legitimate bridge providing playable video.</p>'+
    '<div class="panel"><h3>DIRECTV STREAM readiness</h3>'+
    '<p>'+directv.length+' DIRECTV channels listed; '+directvCapture+' in the capture feed. '+
      (directvCapture?'Channel listing detected — playback still requires a successful tune and decoded video/audio.':
        'No DIRECTV capture channels detected. Check FastChannels device-code sign-in, enable the DIRECTV source, and import its hardware bridge feed (prefer one mixed playlist for Gracenote channels).')+
    '</p><button class="btn secondary tiny" id="directvOnly">Show DIRECTV channels</button>'+
    '<p class="muted">A nonempty lineup is not proof of a usable HDMI feed. Run the FastChannels Bridge → Live bridge test and then play a channel here with Stats enabled.</p></div>'+
    '<div class="liveToolbar"><input class="input" id="filterLive" placeholder="Find a channel, show or event…" type="search">'+
    '<select id="feedFilter" class="quality" aria-label="Feed"><option value="all">All feeds</option><option value="clear">Direct</option><option value="bridge">Bridge</option><option value="DIRECTV STREAM">DIRECTV</option></select>'+
    '<button class="btn secondary" id="refreshLive">Refresh guide</button>'+
    '<span class="muted">'+list.length+' channels · Capture tuners '+esc(data.tuners?.used||0)+'/'+esc(data.tuners?.max||1)+'</span></div>'+
    (errors?'<div class="panel">'+errors+'</div>':'')+
    '<div id="liveChannels" class="guideRows"></div>';
  main.querySelector('#refreshLive').addEventListener('click',async()=>{
    const button=main.querySelector('#refreshLive');if(button)button.disabled=true;
    try{await showLive(++routeSeq,true);}
    catch(err){toast(err.message);if(button)button.disabled=false;}
  });
  const root=main.querySelector('#liveChannels'),field=main.querySelector('#filterLive'),filter=main.querySelector('#feedFilter');
  main.querySelector('#directvOnly').addEventListener('click',()=>{filter.value='DIRECTV STREAM';field.value='';render();});
  const render=()=>{
    const term=field.value.trim().toLowerCase(),kind=filter.value;
    const filtered=list.filter(x=>(kind==='all'||kind===x.kind||kind===x.provider)&&
      [x.name,x.group,x.provider,x.now?.title,x.next?.title].filter(Boolean).join(' ').toLowerCase().includes(term));
    root.innerHTML=filtered.length?filtered.map(x=>{
      const show=x.now,up=x.next;
      const progress=show&&show.stop>show.start?Math.max(0,Math.min(100,100*(Date.now()-show.start)/(show.stop-show.start))):0;
      return '<div class="guideRow"><div class="guideChannel">'+
        '<span class="guideNumber">'+esc(x.channelNumber||'TV')+'</span><div><strong>'+esc(x.name)+'</strong>'+
        '<small>'+esc([x.provider,x.group,x.bridge?'Capture bridge':'Direct'].filter(Boolean).join(' · '))+'</small></div></div>'+
        '<div class="guideProgram"><strong>'+esc(show?.title||'No current guide information')+'</strong>'+
        '<small>'+(show?time(show.start)+'–'+time(show.stop):'Live channel')+
        (up?' · Next '+time(up.start)+': '+esc(up.title):'')+'</small>'+
        (show?'<div class="guideTrack"><span style="width:'+progress.toFixed(1)+'%"></span></div>':'')+
        '</div><button class="btn tiny" data-channel="'+esc(x.id)+'" type="button">▶ Watch</button></div>';
    }).join(''):'<p class="empty">No matching channels or events.</p>';
    root.querySelectorAll('[data-channel]').forEach(button=>button.addEventListener('click',async()=>{
      button.disabled=true;
      try{
        const channel=await post('/api/live/select/'+encodeURIComponent(button.dataset.channel));
        await openPlayer({streamId:channel.streamId,live:true,duration:0,seek:0,title:channel.title,
          subtitle:'Live TV · '+(channel.group||'Canvas playback')});
      }catch(err){toast(err.message);}
      finally{button.disabled=false;}
    }));
  };
  field.addEventListener('input',render);filter.addEventListener('change',render);render();
}

function showTitle(m){
  selectedMeta=m;
  const seasons=[...new Set((m.videos||[]).map(v=>v.season).filter(Number.isInteger))].sort((a,b)=>a-b);
  const photo=m.poster?'<img src="'+esc(m.poster)+'" alt="">':'▶';
  main.innerHTML='<div class="details"><div class="art">'+photo+'</div><div>'+
    '<div class="eyebrow">'+esc(m.type)+'</div><h1>'+esc(m.name)+'</h1>'+
    '<div class="tags">'+[m.year||m.releaseInfo,...(m.genres||[])].filter(Boolean).map(g=>'<span>'+esc(g)+'</span>').join('')+'</div>'+
    '<p>'+esc(m.description||'No synopsis available.')+'</p>'+
    '<button class="btn" id="playTitle">▶ '+(m.type==='series'?'Select episode':'Watch movie')+'</button>'+
    '<div id="seasonList"></div><div id="sources"></div></div></div>';
  const seasonsEl=main.querySelector('#seasonList');
  if(seasons.length){
    let active=seasons[0];
    const renderSeason=()=>{
      seasonsEl.innerHTML='<h2>Episodes</h2><div class="seasons">'+seasons.map(s=>
        '<button class="'+(s===active?'active':'')+'" data-season="'+s+'">Season '+s+'</button>').join('')+'</div>'+
        (m.videos||[]).filter(v=>v.season===active).map(v=>
          '<button class="episode" data-video="'+esc(v.id)+'"><span>'+
          esc('E'+v.episode+' · '+(v.title||v.name||'Episode'))+'</span><small>▶ Play</small></button>').join('');
      seasonsEl.querySelectorAll('[data-season]').forEach(b=>b.addEventListener('click',()=>{active=Number(b.dataset.season);renderSeason();}));
      seasonsEl.querySelectorAll('[data-video]').forEach(b=>b.addEventListener('click',()=>chooseSource(m,b.dataset.video)));
    };
    renderSeason();
  }
  main.querySelector('#playTitle').addEventListener('click',()=>{
    if(m.type==='series'&&m.videos?.length){
      const resume=m.state?.video_id;
      const first=m.videos.find(v=>v.id===resume)||m.videos[0];
      chooseSource(m,first.id);
    }else chooseSource(m,m.id);
  });
}
async function chooseSource(m,videoId){
  const el=main.querySelector('#sources');
  el.innerHTML='<div class="panel">Looking for playable HTTP streams…</div>';
  try{
    const found=await api('/api/streams?type='+encodeURIComponent(m.type)+'&videoId='+encodeURIComponent(videoId));
    pendingSources=found;
    if(!found.length){el.innerHTML='<div class="panel"><h3>No direct HTTP streams found</h3>'+
      '<p>TeStream can decode direct HTTP(S) media. Magnet links, external players, and DRM-protected sources cannot be passed into ffmpeg.</p></div>';return;}
    el.innerHTML='<div class="panel"><h3>Choose a stream</h3><p>Each viewer gets a separate ffmpeg process.</p>'+
      found.map((s,i)=>'<button class="source" data-source="'+i+'">'+esc(s.title)+'<small>'+esc(s.name||s.quality||'HTTP video')+'</small></button>').join('')+'</div>';
    el.querySelectorAll('[data-source]').forEach(button=>button.addEventListener('click',()=>openStream(m,videoId,found[Number(button.dataset.source)])));
  }catch(err){el.innerHTML='<div class="panel">'+esc(err.message)+'</div>';}
}
async function openStream(m,videoId,s){
  let duration=Number(m.state?.duration||0)/1000,seek=videoId===m.state?.video_id?Number(m.state?.timeOffset||0)/1000:0;
  try{const data=await api('/api/probe?streamId='+encodeURIComponent(s.id));duration=data.duration||duration;}catch(err){toast('Could not probe duration: '+err.message);}
  await openPlayer({itemId:m.id,videoId,streamId:s.id,duration,seek,
    title:m.name,subtitle:videoId===m.id?'Movie':videoId+' · '+s.title});
}
async function openPlayer(opts){
  if(activePlayer){activePlayer.destroy();activePlayer=null;}
  overlay.hidden=false;
  const close=()=>{
    activePlayer?.destroy();activePlayer=null;overlay.hidden=true;
    if(document.fullscreenElement)document.exitFullscreen().catch(()=>{});
    if(opts.benchmark){renderBenchmark();}
  };
  activePlayer=new CanvasPlayback(overlay,{...opts,onClose:close,
    onBenchmark:result=>{lastBenchmark=result;const el=document.getElementById('benchLive');
      if(el)el.textContent=JSON.stringify(result,null,2);}});
  await activePlayer.begin();
}
function metric(name,value,detail){
  return '<div class="metric"><span>'+esc(name)+'</span><strong>'+esc(value)+'</strong><span>'+esc(detail)+'</span></div>';
}
function renderBenchmark(){
  main.innerHTML='<div class="eyebrow">MEASUREMENT LAB</div><h1>Audio / video timing benchmark</h1>'+
    '<div class="panel"><p>Generate synchronized white flashes and 880 Hz beeps using ffmpeg. TeStream measures flash presentation on its canvas and beep energy in the WebAudio graph. These are software timing estimates, not physical speaker/display latency measurements.</p>'+
    '<button class="btn" id="startBenchmark">▶ Run live benchmark</button>'+
    '<button class="btn secondary" style="margin-left:10px" id="clearBenchmark">Reset results</button></div>'+
    '<div class="metrics" id="benchMetrics">'+formatBench(lastBenchmark)+'</div>'+
    '<div class="panel"><h3>How to interpret the results</h3><p>Offset is video minus audio (positive means the flash was observed later than the beep). Jitter is the standard deviation of those offsets. Drift is the change in offset per minute. Startup time is measured from opening the stream to the first decoded canvas picture. A microphone and high-speed camera are required for true acoustic/display sync.</p></div>';
  main.querySelector('#startBenchmark').addEventListener('click',()=>openPlayer({benchmark:true,title:'Sync Lab',subtitle:'Flash + beep · 2 second interval',quality:'360p'}));
  main.querySelector('#clearBenchmark').addEventListener('click',()=>{lastBenchmark=null;renderBenchmark();});
}
function formatBench(result){
  const b=result||{};
  return metric('A/V offset',b.samples?b.offsetMs+' ms':'—','Flash relative to beep')+
    metric('Jitter',b.samples?b.jitterMs+' ms':'—','Standard deviation')+
    metric('Drift',b.samples>1?b.driftMsPerMinute+' ms/min':'—','Change over time')+
    metric('Startup',b.startupMs?b.startupMs+' ms':'—','First rendered video')+
    metric('Samples',b.samples||0,'Paired flash/beep events');
}
window.addEventListener('hashchange',navigate);
window.addEventListener('keydown',e=>{if(activePlayer)activePlayer.handleKey(e);});
window.addEventListener('visibilitychange',()=>{
  if(document.hidden&&activePlayer&&!activePlayer.paused)activePlayer.pause();
});
window.addEventListener('unhandledrejection',event=>{console.error(event.reason);toast(event.reason?.message||'Unexpected error');});
document.getElementById('userBadge').addEventListener('click',async()=>{
  if(!session?.stremio&&!session?.jellyfin)return;
  if(confirm('Sign out of TeStream on this browser?')){await post('/api/logout');location.hash='#home';await init();}
});
init().catch(e=>{main.textContent='Could not connect to TeStream: '+e.message;});
