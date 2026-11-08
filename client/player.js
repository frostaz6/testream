import JSMpeg from '@cycjimmy/jsmpeg-player';
import {measureBenchmarks} from './benchmark.js';
const levels=['360p','480p','720p'];
const required={'360p':1028000,'480p':1728000,'720p':3160000};
const clamp=(n,a,b)=>Math.max(a,Math.min(n,b));
const elapsedLabel=n=>{n=Math.max(0,Math.floor(n||0));return Math.floor(n/3600)?[Math.floor(n/3600),String(Math.floor(n%3600/60)).padStart(2,'0'),String(n%60).padStart(2,'0')].join(':'):[Math.floor(n/60),String(n%60).padStart(2,'0')].join(':');};
const esc=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const makeUrl=params=>{const u=new URL('/ws',location.href);for(const [k,v]of Object.entries(params))u.searchParams.set(k,v);u.protocol=location.protocol==='https:'?'wss:':'ws:';return u.href;};
let socketStatusInstalled=false;
function installSocketHook(){
  if(socketStatusInstalled)return;
  socketStatusInstalled=true;
  // The socket can be created asynchronously when WASM/audio initialization completes.
  // Hook each start() rather than looking for player.source.socket after construction.
  const proto=JSMpeg.Source.WebSocket.prototype,original=proto.start;
  proto.start=function(){
    const result=original.apply(this,arguments),socket=this.socket;
    if(socket){
      const binaryHandler=socket.onmessage;
      socket.onmessage=event=>{
        if(typeof event.data==='string'){
          try{window.dispatchEvent(new CustomEvent('testream:ws-status',{detail:{source:this,data:JSON.parse(event.data)}}));}catch{}
          return;
        }
        binaryHandler?.call(socket,event);
      };
    }
    return result;
  };
}
export class CanvasPlayback{
  constructor(root,opts={}){
    this.root=root;this.opts=opts;this.quality=opts.quality||'480p';
    this.mode=opts.benchmark?'manual':'auto';this.cushion=.25;this.underruns=[];
    this.frameIntervals=[];this.lastFrame=null;this.startedAt=0;this.cleanSince=Date.now();
    this.lastQualityChange=0;this.seeking=false;this.paused=true;this.seekAnchor=opts.seek||0;
    this.duration=opts.duration||0;this.volume=.85;this.hasFirstFrame=false;this.bench={flashes:[],beeps:[],start:0};
    this.metrics={bufferedSeconds:0,videoLateSeconds:0,throughputBps:0};
    this.mount();
    installSocketHook();
    this.statusListener=ev=>{if(this.player?.source===ev.detail.source)this.onStatus(ev.detail.data);};
    window.addEventListener('testream:ws-status',this.statusListener);
    this.healthTimer=setInterval(()=>this.health(),2000);
    this.progressTimer=setInterval(()=>this.reportProgress(),15000);
    this.uiTimer=setInterval(()=>this.refresh(),250);
  }
  mount(){
    this.root.innerHTML='<div id="playerShell"><div class="videoStage" id="videoStage"></div>'+
      '<div class="statusBubble show" id="playStatus">Preparing stream…</div>'+
      '<div class="playerDiagnostics" id="diagnostics" hidden></div>'+
      '<div class="playerChrome" id="playerChrome"><div class="playerTop">'+
      '<div><div class="playerTitle">'+esc(this.opts.title||'TeStream')+'</div><div class="playerSubtitle">'+esc(this.opts.subtitle||'MPEG-TS · Canvas')+'</div></div>'+
      '<button class="control" data-action="exit" title="Close (Esc)">✕ Close</button></div>'+
      '<div class="playerBottom"><input class="seek" type="range" min="0" max="'+(this.duration||100)+'" value="'+this.seekAnchor+'" step="0.25" aria-label="Seek">'+
      '<div class="playRow"><button class="control" data-action="toggle" title="Play/pause (Space)">❚❚</button>'+
      '<button class="control" data-action="back" title="Back 10 seconds">↶ 10</button>'+
      '<button class="control" data-action="forward" title="Forward 10 seconds">10 ↷</button>'+
      '<span id="timeLabel" class="playerSubtitle">0:00 / —</span><span class="spacer"></span>'+
      '<button class="control" data-action="mute" title="Mute (M)">♫</button>'+
      '<input type="range" class="volume" min="0" max="1" value=".85" step=".01" aria-label="Volume">'+
      '<select class="quality" aria-label="Playback quality"><option value="auto">Auto</option><option>360p</option><option>480p</option><option>720p</option></select>'+
      '<button class="control" data-action="stats" title="Show diagnostics">Stats</button>'+
      '<button class="control" data-action="fullscreen" title="Fullscreen (F)">⛶</button></div></div></div></div>';
    this.stage=this.root.querySelector('#videoStage');this.statusEl=this.root.querySelector('#playStatus');
    this.chrome=this.root.querySelector('#playerChrome');this.diag=this.root.querySelector('#diagnostics');
    this.seekEl=this.root.querySelector('.seek');this.volumeEl=this.root.querySelector('.volume');
    this.qualityEl=this.root.querySelector('.quality');this.qualityEl.value=this.mode==='auto'?'auto':this.quality;
    this.seekEl.disabled=!this.duration||!!this.opts.benchmark;
    this.seekEl.addEventListener('change',()=>this.seekTo(Number(this.seekEl.value)));
    this.volumeEl.addEventListener('input',()=>{this.volume=Number(this.volumeEl.value);if(this.player)this.player.volume=this.volume;});
    this.qualityEl.addEventListener('change',async()=>{
      this.mode=this.qualityEl.value==='auto'?'auto':'manual';
      const next=this.mode==='auto'?await this.bestQuality():this.qualityEl.value;
      if(next!==this.quality)await this.changeQuality(next);
    });
    this.root.addEventListener('click',ev=>{
      const action=ev.target.closest('[data-action]')?.dataset.action;
      if(action==='exit')this.opts.onClose?.();
      if(action==='toggle')this.toggle();
      if(action==='back')this.seekTo(this.current()-10);
      if(action==='forward')this.seekTo(this.current()+10);
      if(action==='mute'){this.volume=this.volume?0:.85;this.volumeEl.value=this.volume;if(this.player)this.player.volume=this.volume;}
      if(action==='fullscreen'){const el=this.root;if(document.fullscreenElement)document.exitFullscreen();else el.requestFullscreen?.().catch(()=>{});}
      if(action==='stats')this.diag.hidden=!this.diag.hidden;
    });
    let hideTimer;const show=()=>{
      this.chrome.classList.remove('hidden');clearTimeout(hideTimer);
      hideTimer=setTimeout(()=>{if(!this.paused)this.chrome.classList.add('hidden');},3200);
    };
    this.root.addEventListener('pointermove',show);this.root.addEventListener('pointerdown',show);
  }
  status(text){this.statusEl.textContent=text;this.statusEl.classList.toggle('show',!!text);}
  async speed(){
    const started=performance.now(),r=await fetch('/api/speedtest',{cache:'no-store'});
    if(!r.ok)throw new Error('Speed test failed');
    const bytes=(await r.arrayBuffer()).byteLength;
    return bytes*8/Math.max(.001,(performance.now()-started)/1000);
  }
  async bestQuality(){
    try{
      const measured=await this.speed();this.metrics.speedBps=measured;
      return levels.filter(q=>required[q]<=measured*.5).at(-1)||'360p';
    }catch{return '360p';}
  }
  async begin(){
    if(this.mode==='auto'&&!this.opts.benchmark)this.quality=await this.bestQuality();
    await this.start(this.seekAnchor);
  }
  createAudioContext(){
    const existing=JSMpeg.AudioOutput.WebAudio.CachedContext;
    if(!existing||existing.state==='closed'){
      try{JSMpeg.AudioOutput.WebAudio.CachedContext=new AudioContext({sampleRate:44100,latencyHint:'interactive'});}
      catch{JSMpeg.AudioOutput.WebAudio.CachedContext=new AudioContext();}
    }
    this.context=JSMpeg.AudioOutput.WebAudio.CachedContext;
    this.context.resume().catch(()=>{});
    this.metrics.sampleRate=this.context.sampleRate;
  }
  async start(at){
    this.paused=false;this.seeking=false;this.seekAnchor=Math.max(0,at||0);
    this.startedAt=performance.now();this.cleanSince=Date.now();this.underruns=[];
    this.cushion=.25;this.hasFirstFrame=false;this.lastFrame=null;this.lastQueueHealthy=false;
    this.bench={flashes:[],beeps:[],start:this.startedAt,wasWhite:false,wasLoud:false};
    if(this.player){this.player.destroy();this.player=null;}
    if(this.analyserTimer){clearInterval(this.analyserTimer);this.analyserTimer=null;}
    if(this.silentGain){this.silentGain.disconnect();this.silentGain=null;}
    const old=this.stage.querySelectorAll('canvas');
    this.createAudioContext();
    const canvas=document.createElement('canvas');canvas.style.opacity='0';this.stage.append(canvas);
    this.canvas=canvas;
    const params=this.opts.benchmark?{benchmark:1,quality:this.quality}:{streamId:this.opts.streamId,quality:this.quality,seek:this.seekAnchor};
    this.status('Buffering '+this.quality+'…');
    const self=this;
    this.player=new JSMpeg.Player(makeUrl(params),{
      canvas,autoplay:true,loop:false,streaming:true,disableGl:true,reconnectInterval:0,
      videoBufferSize:8*1024*1024,audioBufferSize:1024*1024,
      onVideoDecode(){self.onFrame();},
      onStalled(){self.metrics.stalled=(self.metrics.stalled||0)+1;}
    });
    this.player.volume=this.volume;
    this.player.updateForStreaming=function(){self.clockUpdate(this);};
    this.player.play();
    if(this.opts.benchmark)this.attachAnalyzer();
    // Keep the prior picture until the replacement decoder renders its first frame.
    this.oldCanvases=[...old];
    this.refresh();
  }
  onFrame(){
    const now=performance.now();
    if(!this.hasFirstFrame){
      this.hasFirstFrame=true;this.canvas.style.opacity='1';
      for(const old of this.oldCanvases||[])old.remove();
      this.status('');
      this.metrics.startupMs=now-this.startedAt;
    }
    if(this.lastFrame!==null){
      const interval=now-this.lastFrame;
      if(interval<200)this.frameIntervals.push(interval);
      if(this.frameIntervals.length>100)this.frameIntervals.shift();
    }
    this.lastFrame=now;
    if(this.opts.benchmark){
      try{
        const ctx=this.canvas.getContext('2d'),c=ctx.getImageData(Math.floor(this.canvas.width/2),Math.floor(this.canvas.height/2),1,1).data;
        const white=c[0]>220&&c[1]>220&&c[2]>220;
        if(white&&!this.bench.wasWhite&&now-this.bench.start>150)this.bench.flashes.push(now);
        this.bench.wasWhite=white;
      }catch{}
      this.opts.onBenchmark?.(measureBenchmarks(this.bench.flashes,this.bench.beeps,this.metrics.startupMs));
    }
  }
  clockUpdate(p){
    if(this.paused||!p.source.established)return;
    const audio=p.audio,video=p.video,out=p.audioOut;
    let audioClock=null;
    if(audio?.canPlay&&out){
      // Queue decoded audio ahead, but do not flush arbitrary amounts per animation frame.
      let count=0;
      while(out.enqueuedTime<this.cushion && count++<30 && audio.decode()){}
      const queued=out.enqueuedTime;
      audioClock=Math.max(0,(audio.currentTime-audio.startTime)-queued);
      if(queued>.10)this.lastQueueHealthy=true;
      const age=(performance.now()-this.startedAt)/1000;
      if(age>3&&this.lastQueueHealthy&&queued<.025&&!this.underrunActive){
        this.underrunActive=true;this.underruns.push(Date.now());this.cushion=Math.min(2,this.cushion*2);
        this.cleanSince=Date.now();
      }
      if(queued>.1)this.underrunActive=false;
      this.metrics.audioQueued=queued;
    }
    const clock=audioClock===null?(performance.now()-this.startedAt)/1000:audioClock;
    this.playedSeconds=clock;
    if(video){
      const videoClock=Math.max(0,video.currentTime-video.startTime);
      this.metrics.videoLateSeconds=Math.max(0,clock-videoClock);
      let steps=0;
      // video.decode() displays on the canvas. Only show frames due by the audio clock.
      while(steps++<4&&video.canPlay&&Math.max(0,video.currentTime-video.startTime)<=clock+.014){
        if(!video.decode())break;
      }
    }
  }
  attachAnalyzer(){
    const out=this.player?.audioOut;
    if(!out||!this.context)return;
    const analyser=this.context.createAnalyser();analyser.fftSize=1024;
    const silent=this.context.createGain();silent.gain.value=0;
    out.gain.connect(analyser);analyser.connect(silent);silent.connect(this.context.destination);
    this.silentGain=silent;
    const buffer=new Float32Array(analyser.fftSize);
    this.analyserTimer=setInterval(()=>{
      analyser.getFloatTimeDomainData(buffer);
      const rms=Math.sqrt(buffer.reduce((sum,x)=>sum+x*x,0)/buffer.length);
      const isLoud=rms>.03;
      const now=performance.now();
      if(isLoud&&!this.bench.wasLoud&&now-this.bench.start>150)this.bench.beeps.push(now);
      this.bench.wasLoud=isLoud;
      this.opts.onBenchmark?.(measureBenchmarks(this.bench.flashes,this.bench.beeps,this.metrics.startupMs));
    },10);
  }
  onStatus(m){
    if(m.type==='error'){this.status(m.message);this.metrics.error=m.message;}
    if(m.type==='status'){
      this.metrics.bufferedSeconds=m.bufferedSeconds||0;
      this.metrics.throughputBps=m.throughputBps||0;
      this.metrics.encoderFps=m.fps||0;
    }
    if(m.type==='ended'){this.reportProgress();this.status(m.code?'Stream failed: '+(m.error||m.code):'Playback finished');this.paused=true;}
    if(m.type==='started')this.metrics.started=true;
  }
  current(){return this.seekAnchor+Math.max(0,this.playedSeconds||0);}
  async toggle(){
    if(!this.paused){this.pause();return;}
    await this.start(this.current());
  }
  pause(){
    if(this.paused)return;
    this.seekAnchor=this.current();this.playedSeconds=0;this.paused=true;
    this.player?.destroy();this.player=null;
    this.status('Paused');
    this.reportProgress();
    this.refresh();
  }
  async seekTo(time){
    if(this.opts.benchmark||!this.duration)return;
    const at=clamp(time,0,Math.max(0,this.duration-1));
    this.reportProgress();
    await this.start(at);
  }
  async changeQuality(level){
    if(!levels.includes(level)||this.opts.benchmark)return;
    const pos=this.current();
    this.quality=level;this.lastQualityChange=Date.now();
    await this.start(pos);
  }
  async health(){
    if(this.paused||this.opts.benchmark)return;
    const now=Date.now();
    this.underruns=this.underruns.filter(t=>now-t<30000);
    const bad=this.underruns.length>=2||this.metrics.bufferedSeconds>2||this.metrics.videoLateSeconds>.5;
    if(bad)this.cleanSince=now;
    if(this.mode!=='auto')return;
    const i=levels.indexOf(this.quality);
    if(bad&&i>0&&now-this.lastQualityChange>10000){
      await this.changeQuality(levels[i-1]);return;
    }
    if(i<2&&now-this.cleanSince>60000&&now-this.lastQualityChange>120000){
      const best=await this.bestQuality();
      if(levels.indexOf(best)>i)await this.changeQuality(levels[i+1]);
    }
    if(!bad&&now-this.cleanSince>60000&&this.cushion>.25){
      this.cushion=Math.max(.25,this.cushion*.8);this.cleanSince=now-45000;
    }
  }
  reportProgress(){
    if(this.opts.benchmark||!this.opts.itemId||!this.duration)return;
    fetch('/api/progress',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({id:this.opts.itemId,videoId:this.opts.videoId,
        position:this.current(),duration:this.duration}),keepalive:true}).catch(()=>{});
  }
  refresh(){
    const label=this.root.querySelector('#timeLabel');
    if(!label)return;
    const pos=this.current();
    label.textContent=elapsedLabel(pos)+' / '+(this.duration?elapsedLabel(this.duration):'—');
    if(!this.seekEl.matches(':active'))this.seekEl.value=pos;
    this.root.querySelector('[data-action="toggle"]').textContent=this.paused?'▶':'❚❚';
    this.qualityEl.value=this.mode==='auto'?'auto':this.quality;
    if(!this.diag.hidden){
      const a=this.frameIntervals;
      const mean=a.reduce((x,y)=>x+y,0)/(a.length||1);
      const jitter=Math.sqrt(a.reduce((x,y)=>x+(y-mean)**2,0)/(a.length||1));
      this.diag.textContent='Quality: '+this.quality+' ('+this.mode+')\n'+
        'Audio queue: '+(this.metrics.audioQueued||0).toFixed(3)+'s | cushion: '+this.cushion.toFixed(2)+'s\n'+
        'Video behind audio: '+(this.metrics.videoLateSeconds||0).toFixed(3)+'s\n'+
        'Frame cadence: '+mean.toFixed(1)+'ms ± '+jitter.toFixed(1)+'ms\n'+
        'Server WS pending: '+(this.metrics.bufferedSeconds||0).toFixed(3)+'s\n'+
        'Encoder fps: '+(this.metrics.encoderFps||0).toFixed(1)+
        '\nUnderruns /30s: '+this.underruns.length+'\nAudioContext: '+this.metrics.sampleRate+' Hz';
    }
  }
  async handleKey(e){
    if(e.target instanceof HTMLInputElement||e.target instanceof HTMLSelectElement)return;
    if(e.key===' '||e.key==='k'){e.preventDefault();await this.toggle();}
    if(e.key==='ArrowLeft')this.seekTo(this.current()-10);
    if(e.key==='ArrowRight')this.seekTo(this.current()+10);
    if(e.key==='m'){this.volume=this.volume?0:.85;this.volumeEl.value=this.volume;if(this.player)this.player.volume=this.volume;}
    if(e.key==='f'){if(document.fullscreenElement)document.exitFullscreen();else this.root.requestFullscreen?.().catch(()=>{});}
    if(e.key==='Escape')this.opts.onClose?.();
  }
  destroy(){
    this.reportProgress();this.paused=true;
    clearInterval(this.healthTimer);clearInterval(this.progressTimer);clearInterval(this.uiTimer);
    clearInterval(this.analyserTimer);window.removeEventListener('testream:ws-status',this.statusListener);
    this.player?.destroy();this.player=null;
    this.silentGain?.disconnect();this.root.innerHTML='';
  }
}
