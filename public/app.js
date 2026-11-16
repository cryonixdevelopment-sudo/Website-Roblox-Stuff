const storageKeys={links:'orvian-links',engine:'orvian-search-engine',newTabs:'orvian-new-tabs',reduceMotion:'orvian-reduce-motion',profile:'orvian-profile',theme:'orvian-theme',background:'orvian-background',preferHttps:'orvian-prefer-https',stripTracking:'orvian-strip-tracking',music:'orvian-music',showImages:'orvian-show-images',showTrail:'orvian-show-trail'};
const engines={ddg:'https://duckduckgo.com/?q=',google:'https://www.google.com/search?q=',bing:'https://www.bing.com/search?q=',brave:'https://search.brave.com/search?q=',startpage:'https://www.startpage.com/sp/search?query='};
const searchForm=document.querySelector('#search-form');
const searchInput=document.querySelector('#search-input');
const searchEngine=document.querySelector('#search-engine');
const newTabSetting=document.querySelector('#new-tab-setting');
const motionSetting=document.querySelector('#motion-setting');
const themeSetting=document.querySelector('#theme-setting');
const backgroundSetting=document.querySelector('#background-setting');
const httpsSetting=document.querySelector('#https-setting');
const trackingSetting=document.querySelector('#tracking-setting');
const imagesSetting=document.querySelector('#images-setting');
const trailSetting=document.querySelector('#trail-setting');
const musicSetting=document.querySelector('#music-setting');
const ambientAudio=document.querySelector('#ambient-audio');
const savedLinks=document.querySelector('#saved-links');
const toast=document.querySelector('#toast');
const launcher=document.querySelector('.launcher');
const viewer=document.querySelector('#viewer');
const viewerFrameHost=document.querySelector('#viewer-frame-host');
let viewerFrame=null, scramjetController=null, scramjetConnection=null;
const viewerUrl=document.querySelector('#viewer-url');
const viewerExternal=document.querySelector('#viewer-external');
const viewerNote=document.querySelector('#viewer-note');
const viewerBack=document.querySelector('#viewer-back');
const proxyAvailable=Boolean(window.$scramjetLoadController&&window.BareMux&&'serviceWorker' in navigator&&window.isSecureContext);
let proxyReadyPromise=null;
let viewerUsesProxy=false;
let viewerHistory=[];
let currentViewerUrl='';
let toastTimer;

function readLinks(){try{return JSON.parse(localStorage.getItem(storageKeys.links)||'[]')}catch{return[]}}
function normalize(value){
  const input=value.trim();
  if(!input)return null;
  if(/^https?:\/\//i.test(input)){
    let url=input;
    if(localStorage.getItem(storageKeys.preferHttps)==='true'&&url.startsWith('http://'))url=`https://${url.slice(7)}`;
    if(localStorage.getItem(storageKeys.stripTracking)==='true')try{const parsed=new URL(url);[...parsed.searchParams.keys()].forEach(key=>{/^(utm_|fbclid$|gclid$|mc_eid$|igshid$)/i.test(key)&&parsed.searchParams.delete(key)});url=parsed.toString()}catch{}
    return url;
  }
  if(/^[\w-]+(\.[\w-]+)+([/:?#].*)?$/i.test(input))return `https://${input}`;
  const engine=localStorage.getItem(storageKeys.engine)||'ddg';
  return `${engines[engine]||engines.ddg}${encodeURIComponent(input)}`;
}
async function prepareProxy(){
  if(!proxyAvailable)return false;
  if(!proxyReadyPromise)proxyReadyPromise=(async()=>{
    const health=await fetch('/health',{cache:'no-store'}).catch(()=>null);
    if(!health?.ok||!health.headers.get('content-type')?.includes('application/json'))return false;
    if((await health.json().catch(()=>null))?.status!=='ok')return false;
    for(const asset of ['/scram/scramjet.all.js','/scram/scramjet.wasm.wasm','/libcurl/index.mjs','/baremux/worker.js']){
      if(!(await fetch(asset,{method:'HEAD',cache:'no-store'}).catch(()=>null))?.ok)return false;
    }
    const {ScramjetController}=window.$scramjetLoadController();
    scramjetController=new ScramjetController({files:{
      wasm:'/scram/scramjet.wasm.wasm',all:'/scram/scramjet.all.js',sync:'/scram/scramjet.sync.js'
    }});
    await scramjetController.init();
    const registration=await navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'});
    await registration.update();
    // A registered worker may still be installing. Wait for activation AND
    // for the current document to be controlled before creating Scramjet frames.
    await navigator.serviceWorker.ready;
    if(!navigator.serviceWorker.controller){
      await Promise.race([
        new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true})),
        new Promise((_,reject)=>setTimeout(()=>reject(new Error('Service worker control timed out')),10000))
      ]);
    }
    if(!navigator.serviceWorker.controller)throw new Error('Service worker is not controlling Orvian');
    scramjetConnection=new window.BareMux.BareMuxConnection('/baremux/worker.js');
    const wispUrl=(location.protocol==='https:'?'wss://':'ws://')+location.host+'/wisp/';
    if((await scramjetConnection.getTransport())!=='/libcurl/index.mjs')
      await scramjetConnection.setTransport('/libcurl/index.mjs',[{websocket:wispUrl}]);
    return true;
  })().catch(error=>{console.error('Scramjet setup failed:',error);proxyReadyPromise=null;viewerNote.textContent='Scramjet initialization failed: '+(error?.message||String(error));return false});
  return proxyReadyPromise;
}
function clearEmbeddedFrame(){viewerFrameHost.replaceChildren();viewerFrame=null}
function openUrl(value){
  const url=normalize(value);
  if(!url)return;
  if(localStorage.getItem(storageKeys.newTabs)==='true'){
    window.open(url,'_blank','noopener,noreferrer');
    return;
  }
  showInViewer(url);
}
function openSearch(value){
  const url=normalize(value);
  if(url)showInViewer(url);
}
let navigationSequence=0;
async function showInViewer(url,record=true){
  if(record&&currentViewerUrl!==url)viewerHistory.push(url);
  currentViewerUrl=url;viewerUrl.textContent=url;launcher.hidden=true;viewer.hidden=false;
  document.body.classList.add('viewing');
  const sequence=++navigationSequence;
  viewerNote.textContent='Connecting to the in-page browser…';
  const ready=await prepareProxy();
  if(sequence!==navigationSequence||viewer.hidden)return;
  viewerUsesProxy=ready;clearEmbeddedFrame();
  if(!ready){
    if(!viewerNote.textContent.startsWith('Scramjet initialization failed:'))viewerNote.textContent='Scramjet is unavailable. Verify the Node.js deployment, service worker, and Wisp connection.';
    return;
  }
  try{
    const frame=scramjetController.createFrame();
    viewerFrame=frame.frame;viewerFrame.id='viewer-frame';viewerFrame.title='Website viewer';
    viewerFrame.setAttribute('allow','fullscreen; autoplay; clipboard-read; clipboard-write');
    viewerFrameHost.appendChild(viewerFrame);
    await frame.go(url);
    if(sequence===navigationSequence)viewerNote.textContent='Browsing inside Orvian with Scramjet. Some websites may still limit functionality.';
  }catch(error){
    console.error('Scramjet navigation failed:',error);
    if(sequence===navigationSequence){
      clearEmbeddedFrame();
      viewerNote.textContent='Unable to load this website in Scramjet. Check the server connection and try Reload.';
    }
  }
}
function closeViewer(){
  ++navigationSequence;currentViewerUrl='';viewerHistory=[];clearEmbeddedFrame();
  viewer.hidden=true;document.body.classList.remove('viewing');
  if(viewerReturnTarget==='games'){launcher.hidden=true;gamesView.hidden=false;document.body.classList.add('gaming');viewerReturnTarget='home';gamesSearchInput.focus()}
  else{launcher.hidden=false;searchInput.focus()}
}
function notify(text){
  clearTimeout(toastTimer);
  toast.textContent=text;toast.hidden=false;
  toastTimer=setTimeout(()=>{toast.hidden=true},2500);
}
function renderLinks(){
  const links=readLinks();savedLinks.replaceChildren();
  if(!links.length){const empty=document.createElement('p');empty.className='muted';empty.textContent='No saved links yet.';savedLinks.append(empty);return}
  links.forEach((link,index)=>{
    const row=document.createElement('div');row.className='saved-link';
    const anchor=document.createElement('a');anchor.href=link.url;anchor.textContent=link.name;
    anchor.addEventListener('click',event=>{event.preventDefault();document.querySelector('#links-dialog').close();openUrl(link.url)});
    const remove=document.createElement('button');remove.type='button';remove.textContent='Remove';
    remove.addEventListener('click',()=>{const updated=readLinks();updated.splice(index,1);localStorage.setItem(storageKeys.links,JSON.stringify(updated));renderLinks()});
    row.append(anchor,remove);savedLinks.append(row);
  });
}
function addLink(){
  const name=window.prompt('Bookmark name:');if(!name)return;
  const rawUrl=window.prompt('Website URL:');if(!rawUrl)return;
  const url=normalize(rawUrl);if(!url)return;
  const links=readLinks();links.push({name:name.trim().slice(0,40),url});
  localStorage.setItem(storageKeys.links,JSON.stringify(links.slice(-30)));renderLinks();notify('Bookmark saved');
}

searchForm.addEventListener('submit',event=>{event.preventDefault();openSearch(searchInput.value)});
document.querySelectorAll('.tile[href],.trending[href]').forEach(link=>link.addEventListener('click',event=>{event.preventDefault();if(link.hasAttribute('data-auth-required')&&!authUser){openAuthPrompt();return}openUrl(link.href)}));
document.querySelector('#viewer-close').addEventListener('click',closeViewer);
document.querySelector('#viewer-reload').addEventListener('click',()=>{if(currentViewerUrl)showInViewer(currentViewerUrl,false)});
viewerBack.addEventListener('click',()=>{
  if(viewerUsesProxy){
    try{
      viewerFrame?.contentWindow?.history.back();
      return;
    }catch(error){console.warn('In-page history unavailable:',error)}
  }
  if(viewerHistory.length<=1){closeViewer();return}
  viewerHistory.pop();showInViewer(viewerHistory.at(-1),false);
});
viewerExternal.addEventListener('click',()=>{if(currentViewerUrl)window.open(currentViewerUrl,'_blank','noopener,noreferrer')});
document.querySelectorAll('[data-panel]').forEach(button=>button.addEventListener('click',()=>{if(button.hasAttribute('data-auth-required')&&!authUser){openAuthPrompt();return}document.querySelector(`#${button.dataset.panel}`)?.showModal()}));
document.querySelector('#add-bookmark').addEventListener('click',addLink);
document.querySelector('#dialog-add-link').addEventListener('click',addLink);
searchEngine.value=localStorage.getItem(storageKeys.engine)||'ddg';
newTabSetting.checked=localStorage.getItem(storageKeys.newTabs)==='true';
motionSetting.checked=localStorage.getItem(storageKeys.reduceMotion)==='true';
themeSetting.value=localStorage.getItem(storageKeys.theme)||'midnight';
backgroundSetting.value=localStorage.getItem(storageKeys.background)||'100';
httpsSetting.checked=localStorage.getItem(storageKeys.preferHttps)==='true';
trackingSetting.checked=localStorage.getItem(storageKeys.stripTracking)==='true';
imagesSetting.checked=localStorage.getItem(storageKeys.showImages)!=='false';
trailSetting.checked=localStorage.getItem(storageKeys.showTrail)!=='false';
musicSetting.checked=localStorage.getItem(storageKeys.music)!=='false';
document.documentElement.classList.toggle('reduce-motion',motionSetting.checked);
document.documentElement.dataset.theme=themeSetting.value;
document.documentElement.classList.toggle('images-disabled',!imagesSetting.checked);
document.documentElement.classList.toggle('trail-disabled',!trailSetting.checked);
document.documentElement.style.setProperty('--background-opacity',String(Number(backgroundSetting.value)/100));
searchEngine.addEventListener('change',()=>localStorage.setItem(storageKeys.engine,searchEngine.value));
newTabSetting.addEventListener('change',()=>localStorage.setItem(storageKeys.newTabs,String(newTabSetting.checked)));
motionSetting.addEventListener('change',()=>{localStorage.setItem(storageKeys.reduceMotion,String(motionSetting.checked));document.documentElement.classList.toggle('reduce-motion',motionSetting.checked);syncSilverTrail()});
themeSetting.addEventListener('change',()=>{localStorage.setItem(storageKeys.theme,themeSetting.value);document.documentElement.dataset.theme=themeSetting.value});
backgroundSetting.addEventListener('input',()=>{localStorage.setItem(storageKeys.background,backgroundSetting.value);document.documentElement.style.setProperty('--background-opacity',String(Number(backgroundSetting.value)/100))});
httpsSetting.addEventListener('change',()=>localStorage.setItem(storageKeys.preferHttps,String(httpsSetting.checked)));
trackingSetting.addEventListener('change',()=>localStorage.setItem(storageKeys.stripTracking,String(trackingSetting.checked)));
imagesSetting.addEventListener('change',()=>{localStorage.setItem(storageKeys.showImages,String(imagesSetting.checked));document.documentElement.classList.toggle('images-disabled',!imagesSetting.checked)});
trailSetting.addEventListener('change',()=>{localStorage.setItem(storageKeys.showTrail,String(trailSetting.checked));document.documentElement.classList.toggle('trail-disabled',!trailSetting.checked);syncSilverTrail()});
musicSetting.addEventListener('change',()=>{localStorage.setItem(storageKeys.music,String(musicSetting.checked));syncAmbientAudio()});
document.querySelectorAll('.settings-tab').forEach(tab=>tab.addEventListener('click',()=>{document.querySelectorAll('.settings-tab').forEach(item=>item.classList.toggle('active',item===tab));document.querySelectorAll('.settings-panel').forEach(panel=>panel.classList.toggle('active',panel.dataset.settingsPanel===tab.dataset.settingsTab))}));
function clearLocalData(){
  if(!window.confirm('Clear Orvian bookmarks, settings, and profile from this browser?'))return;
  Object.values(storageKeys).forEach(key=>localStorage.removeItem(key));renderLinks();searchEngine.value='ddg';newTabSetting.checked=false;motionSetting.checked=false;themeSetting.value='midnight';backgroundSetting.value='100';httpsSetting.checked=false;trackingSetting.checked=false;imagesSetting.checked=true;trailSetting.checked=true;musicSetting.checked=true;document.documentElement.classList.remove('reduce-motion');document.documentElement.dataset.theme='midnight';document.documentElement.classList.remove('images-disabled','trail-disabled');document.documentElement.style.setProperty('--background-opacity','1');syncAmbientAudio();notify('Local data cleared');
}
document.querySelector('#clear-data').addEventListener('click',clearLocalData);
document.querySelector('#settings-clear-data').addEventListener('click',clearLocalData);
renderLinks();

const localTimeElement=document.querySelector('#local-time');
const localDateElement=document.querySelector('#local-date');
function updateLocalClock(){
  const now=new Date();
  // The browser supplies its own locale and IANA time zone automatically.
  localTimeElement.textContent=new Intl.DateTimeFormat(undefined,{hour:'numeric',minute:'2-digit'}).format(now);
  localDateElement.textContent=new Intl.DateTimeFormat(undefined,{weekday:'long',month:'long',day:'numeric'}).format(now);
  localTimeElement.dateTime=now.toISOString();
}
updateLocalClock();
setInterval(updateLocalClock,15000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)updateLocalClock()});


const sidePosterSources=[
  '/backgrounds/orvian-01.webp',
  '/backgrounds/orvian-02.webp',
  '/backgrounds/orvian-03.webp',
  '/backgrounds/orvian-04.webp',
  '/backgrounds/orvian-05.webp',
  '/backgrounds/orvian-06.webp',
  '/backgrounds/orvian-07.webp',
  '/backgrounds/orvian-08.webp',
  '/backgrounds/orvian-09.webp',
  '/backgrounds/orvian-10.webp'
];
const sidePosterImages=[...document.querySelectorAll('.side-art img')];
let sidePosterDeck=[];
let previousPosterPair=[];
function shufflePosters(){
  const deck=[...sidePosterSources];
  for(let index=deck.length-1;index>0;index--){
    const swapIndex=Math.floor(Math.random()*(index+1));
    [deck[index],deck[swapIndex]]=[deck[swapIndex],deck[index]];
  }
  if(previousPosterPair.includes(deck[0])||previousPosterPair.includes(deck[1])){
    const safeStart=deck.findIndex((source,index)=>index>1&&!previousPosterPair.includes(source));
    if(safeStart>1)[deck[0],deck[safeStart]]=[deck[safeStart],deck[0]];
    const secondStart=deck.findIndex((source,index)=>index>1&&!previousPosterPair.includes(source)&&source!==deck[0]);
    if(secondStart>1)[deck[1],deck[secondStart]]=[deck[secondStart],deck[1]];
  }
  sidePosterDeck=deck;
}
function rotateSidePosters(){
  if(sidePosterDeck.length<2)shufflePosters();
  const pair=sidePosterDeck.splice(0,2);
  sidePosterImages.forEach((image,index)=>{image.src=pair[index]});
  previousPosterPair=pair;
}
sidePosterSources.forEach(source=>{const image=new Image();image.src=source});
rotateSidePosters();
if(!window.matchMedia('(prefers-reduced-motion: reduce)').matches)setInterval(rotateSidePosters,9000);


// Smooth silver pointer trail
let silverTrailController=null;
function stopSilverTrail(){
  if(!silverTrailController)return;
  cancelAnimationFrame(silverTrailController.animationFrame);
  removeEventListener('pointermove',silverTrailController.onPointerMove);
  removeEventListener('resize',silverTrailController.onResize);
  silverTrailController.canvas.remove();
  silverTrailController=null;
}
function startSilverTrail(){
  if(silverTrailController||!window.matchMedia('(pointer:fine)').matches||window.matchMedia('(prefers-reduced-motion:reduce)').matches)return;
  const canvas=document.createElement('canvas');
  canvas.id='silver-trail-canvas';
  document.body.appendChild(canvas);
  const context=canvas.getContext('2d');
  const points=[];
  const controller={canvas,context,points,animationFrame:0,onPointerMove:null,onResize:null};
  silverTrailController=controller;
  controller.onResize=()=>{
    const ratio=Math.min(window.devicePixelRatio||1,1.5);
    canvas.width=Math.round(innerWidth*ratio);
    canvas.height=Math.round(innerHeight*ratio);
    context.setTransform(ratio,0,0,ratio,0,0);
  };
  controller.onPointerMove=event=>{
    points.push({x:event.clientX,y:event.clientY,life:1});
    if(points.length>22)points.shift();
  };
  controller.onResize();
  addEventListener('resize',controller.onResize,{passive:true});
  addEventListener('pointermove',controller.onPointerMove,{passive:true});
  const draw=()=>{
    if(silverTrailController!==controller)return;
    context.clearRect(0,0,innerWidth,innerHeight);
    context.shadowBlur=0;
    for(let index=1;index<points.length;index++){
      const previous=points[index-1],point=points[index];
      context.beginPath();
      context.moveTo(previous.x,previous.y);
      context.lineTo(point.x,point.y);
      context.lineCap='round';
      context.lineWidth=.8+point.life*2.6;
      context.strokeStyle=`rgba(222,225,233,${point.life*.5})`;
      context.stroke();
    }
    points.forEach(point=>{point.life-=.055});
    while(points[0]&&points[0].life<=0)points.shift();
    controller.animationFrame=requestAnimationFrame(draw);
  };
  controller.animationFrame=requestAnimationFrame(draw);
}
function syncSilverTrail(){
  const enabled=trailSetting.checked&&!motionSetting.checked;
  document.documentElement.classList.toggle('trail-disabled',!enabled);
  if(enabled)startSilverTrail();else stopSilverTrail();
}
syncSilverTrail();


// Playlist-ready ambient music player
const ambientPlaylist=[
  {title:'Kerosene',artist:'Crystal Castles',src:'/audio/ambient.mp3'}
];
const musicPlayer=document.querySelector('#music-player');
const musicTitle=document.querySelector('#music-title');
const musicArtist=document.querySelector('#music-artist');
const musicPlayPause=document.querySelector('#music-play-pause');
const musicPrevious=document.querySelector('#music-previous');
const musicNext=document.querySelector('#music-next');
const musicProgress=document.querySelector('#music-progress');
const musicCurrentTime=document.querySelector('#music-current-time');
const musicDuration=document.querySelector('#music-duration');
let ambientTrackIndex=0;
let ambientFadeFrame=0;
let ambientUnlockBound=false;
let ambientUserPaused=false;
function formatMusicTime(seconds){
  if(!Number.isFinite(seconds))return '0:00';
  const minutes=Math.floor(seconds/60);
  return `${minutes}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;
}
function updateMusicPlayer(){
  const track=ambientPlaylist[ambientTrackIndex];
  musicTitle.textContent=track.title;
  musicArtist.textContent=track.artist;
  musicCurrentTime.textContent=formatMusicTime(ambientAudio.currentTime);
  musicDuration.textContent=formatMusicTime(ambientAudio.duration);
  musicProgress.value=ambientAudio.duration?String(ambientAudio.currentTime/ambientAudio.duration*100):'0';
  const playing=!ambientAudio.paused&&!ambientAudio.ended;
  musicPlayer.classList.toggle('playing',playing);
  musicPlayPause.textContent=playing?'Ⅱ':'▶';
  musicPlayPause.setAttribute('aria-label',playing?'Pause':'Play');
}
function fadeAmbientTo(target,duration,onComplete){
  cancelAnimationFrame(ambientFadeFrame);
  const startVolume=ambientAudio.volume;
  const startedAt=performance.now();
  const step=now=>{
    const progress=Math.min(1,(now-startedAt)/duration);
    ambientAudio.volume=startVolume+(target-startVolume)*(1-Math.pow(1-progress,3));
    if(progress<1)ambientFadeFrame=requestAnimationFrame(step);
    else if(onComplete)onComplete();
  };
  ambientFadeFrame=requestAnimationFrame(step);
}
function playAmbientTrack({restart=false}={}){
  const track=ambientPlaylist[ambientTrackIndex];
  if(ambientAudio.getAttribute('src')!==track.src){
    ambientAudio.src=track.src;
    ambientAudio.load();
  }
  if(restart)ambientAudio.currentTime=0;
  ambientUserPaused=false;
  ambientAudio.volume=0;
  ambientAudio.play().then(()=>{fadeAmbientTo(.42,1200);updateMusicPlayer()}).catch(bindAmbientUnlock);
}
function changeAmbientTrack(direction){
  fadeAmbientTo(0,350,()=>{
    ambientTrackIndex=(ambientTrackIndex+direction+ambientPlaylist.length)%ambientPlaylist.length;
    playAmbientTrack({restart:true});
  });
}
function unlockAmbientAudio(){
  if(!musicSetting.checked||ambientUserPaused)return;
  playAmbientTrack();
}
function bindAmbientUnlock(){
  if(ambientUnlockBound)return;
  ambientUnlockBound=true;
  const unlock=()=>{
    ambientUnlockBound=false;
    removeEventListener('pointerdown',unlock);
    removeEventListener('keydown',unlock);
    unlockAmbientAudio();
  };
  addEventListener('pointerdown',unlock,{once:true,passive:true});
  addEventListener('keydown',unlock,{once:true});
}
function syncAmbientAudio(){
  document.documentElement.classList.toggle('music-disabled',!musicSetting.checked);
  musicPlayer.classList.toggle('visible',musicSetting.checked);
  if(!musicSetting.checked){
    fadeAmbientTo(0,700,()=>{ambientAudio.pause();updateMusicPlayer()});
    return;
  }
  if(!ambientUserPaused)playAmbientTrack();
}
musicPlayPause.addEventListener('click',()=>{
  if(ambientAudio.paused){ambientUserPaused=false;playAmbientTrack()}
  else{ambientUserPaused=true;fadeAmbientTo(0,450,()=>{ambientAudio.pause();updateMusicPlayer()})}
});
musicPrevious.addEventListener('click',()=>changeAmbientTrack(-1));
musicNext.addEventListener('click',()=>changeAmbientTrack(1));
musicProgress.addEventListener('input',()=>{
  if(ambientAudio.duration)ambientAudio.currentTime=Number(musicProgress.value)/100*ambientAudio.duration;
  updateMusicPlayer();
});
ambientAudio.addEventListener('timeupdate',updateMusicPlayer);
ambientAudio.addEventListener('loadedmetadata',updateMusicPlayer);
ambientAudio.addEventListener('play',updateMusicPlayer);
ambientAudio.addEventListener('pause',updateMusicPlayer);
ambientAudio.addEventListener('ended',()=>changeAmbientTrack(1));
document.addEventListener('visibilitychange',()=>{
  if(document.hidden)fadeAmbientTo(0,650,()=>ambientAudio.pause());
  else if(musicSetting.checked&&!ambientUserPaused)playAmbientTrack();
});
syncAmbientAudio();
updateMusicPlayer();
requestAnimationFrame(()=>requestAnimationFrame(()=>document.body.classList.add('page-ready')));


// Real-time Web Audio spectrum analyzer
let musicAudioContext=null;
let musicAnalyser=null;
let musicSourceNode=null;
let musicFrequencyData=null;
let musicVisualizerFrame=0;
const musicMeterBars=[...document.querySelectorAll('#music-meter i')];
async function setupAudioVisualizer(){
  if(!musicAudioContext){
    const AudioContextClass=window.AudioContext||window.webkitAudioContext;
    if(!AudioContextClass)return;
    musicAudioContext=new AudioContextClass();
    musicAnalyser=musicAudioContext.createAnalyser();
    musicAnalyser.fftSize=64;
    musicAnalyser.smoothingTimeConstant=.76;
    musicFrequencyData=new Uint8Array(musicAnalyser.frequencyBinCount);
    musicSourceNode=musicAudioContext.createMediaElementSource(ambientAudio);
    musicSourceNode.connect(musicAnalyser);
    musicAnalyser.connect(musicAudioContext.destination);
  }
  if(musicAudioContext.state==='suspended')await musicAudioContext.resume().catch(()=>{});
  if(!musicVisualizerFrame)drawAudioVisualizer();
}
function drawAudioVisualizer(){
  musicVisualizerFrame=requestAnimationFrame(drawAudioVisualizer);
  if(!musicAnalyser)return;
  musicAnalyser.getByteFrequencyData(musicFrequencyData);
  const usableBins=Math.min(24,musicFrequencyData.length);
  musicMeterBars.forEach((bar,index)=>{
    const start=Math.floor(index*usableBins/musicMeterBars.length);
    const end=Math.max(start+1,Math.floor((index+1)*usableBins/musicMeterBars.length));
    let total=0;
    for(let bin=start;bin<end;bin++)total+=musicFrequencyData[bin];
    const level=total/(end-start)/255;
    const shaped=Math.pow(level,1.35);
    bar.style.height=`${Math.max(8,shaped*100)}%`;
    bar.style.opacity=String(.32+shaped*.68);
  });
}
const activateAudioSystem=()=>setupAudioVisualizer();
addEventListener('pointerdown',activateAudioSystem,{once:true,passive:true});
addEventListener('keydown',activateAudioSystem,{once:true});
musicPlayPause.addEventListener('click',setupAudioVisualizer);
musicPrevious.addEventListener('click',setupAudioVisualizer);
musicNext.addEventListener('click',setupAudioVisualizer);


// Compatibility notice for platforms outside the primary support targets
const compatibilityNotice=document.querySelector('#compatibility-notice');
const compatibilityUA=navigator.userAgent||'';
const compatibilityPlatform=navigator.userAgentData?.platform||navigator.platform||'';
const isSupportedOrvianDevice=/Windows/i.test(compatibilityPlatform)||/Win32|Win64|Windows/i.test(compatibilityUA)||/CrOS/i.test(compatibilityUA);
if(!isSupportedOrvianDevice&&compatibilityNotice){
  compatibilityNotice.hidden=false;
  window.setTimeout(()=>compatibilityNotice.remove(),6500);
}


// Optional shared accounts for Chat and Lounge
let authUser=null;
const accountDialog=document.querySelector('#account-dialog');
const authSignedOut=document.querySelector('#auth-signed-out');
const authSignedIn=document.querySelector('#auth-signed-in');
const authMessage=document.querySelector('#auth-message');
const loginForm=document.querySelector('#login-form');
const signupForm=document.querySelector('#signup-form');
function renderAuthState(){
  authSignedOut.hidden=Boolean(authUser);
  authSignedIn.hidden=!authUser;
  document.querySelectorAll('[data-auth-required]').forEach(element=>element.classList.toggle('auth-locked',!authUser));
  if(authUser){
    document.querySelector('#account-username').textContent=authUser.username;
    document.querySelector('#account-email').textContent=authUser.email||'No email added';
    document.querySelector('#account-role').textContent=authUser.role;
    document.querySelector('#account-avatar').textContent=authUser.username.charAt(0).toUpperCase();
  }
}
function openAuthPrompt(){
  authMessage.textContent='Sign in or create an account to unlock Chat and Lounge.';
  accountDialog.showModal();
}
async function refreshAuth(){
  try{
    const response=await fetch('/api/auth/me',{credentials:'same-origin',cache:'no-store'});
    const data=await response.json();
    authUser=data.user||null;
    if(!data.available&&!authUser)authMessage.textContent='Account setup is not connected yet.';
  }catch{authUser=null}
  renderAuthState();
}
document.querySelectorAll('.auth-tab').forEach(tab=>tab.addEventListener('click',()=>{
  document.querySelectorAll('.auth-tab').forEach(item=>item.classList.toggle('active',item===tab));
  loginForm.hidden=tab.dataset.authMode!=='login';
  signupForm.hidden=tab.dataset.authMode!=='signup';
  authMessage.textContent='';
}));
async function submitAuthForm(form,endpoint){
  authMessage.classList.remove('success');
  authMessage.textContent='Please wait…';
  const payload=Object.fromEntries(new FormData(form));
  try{
    const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify(payload)});
    const data=await response.json();
    if(!response.ok)throw new Error(data.error||'Unable to continue.');
    authUser=data.user;
    form.reset();
    authMessage.textContent='';
    renderAuthState();
    notify('Signed in as '+authUser.username);
  }catch(error){authMessage.textContent=error.message}
}
loginForm.addEventListener('submit',event=>{event.preventDefault();submitAuthForm(loginForm,'/api/auth/login')});
signupForm.addEventListener('submit',event=>{event.preventDefault();submitAuthForm(signupForm,'/api/auth/signup')});
document.querySelector('#logout-button').addEventListener('click',async()=>{
  await fetch('/api/auth/logout',{method:'POST',credentials:'same-origin'}).catch(()=>{});
  authUser=null;renderAuthState();notify('Signed out');
});
refreshAuth();


// Internal authenticated community chat
const chatView=document.querySelector('#chat-view');
const chatMessages=document.querySelector('#chat-messages');
const chatInput=document.querySelector('#chat-input');
const chatStatus=document.querySelector('#chat-status');
const chatChannelName=document.querySelector('#chat-channel-name');
const chatChannelDescription=document.querySelector('#chat-channel-description');
const chatDescriptions={general:'Talk with the Orvian community',introductions:'Introduce yourself',announcements:'Official updates from the Owner',rules:'Community rules from the Owner'};
let activeChatChannel='general';
let chatPollTimer=0;
let currentChatMessages=[];
let pendingChatAttachment=null;
function renderChatMessages(messages){
  currentChatMessages=messages;
  chatMessages.replaceChildren();
  if(!messages.length){
    const empty=document.createElement('p');empty.className='chat-welcome';
    empty.textContent=activeChatChannel==='announcements'?'No announcements yet.':activeChatChannel==='rules'?'No rules have been posted yet.':'This channel is quiet. Start the conversation.';
    chatMessages.append(empty);return;
  }
  messages.forEach(message=>{
    const item=document.createElement('article');item.className='chat-message';
    const avatar=document.createElement('span');avatar.className='chat-message-avatar';avatar.textContent=message.username.charAt(0).toUpperCase();
    const body=document.createElement('div');
    const head=document.createElement('div');head.className='chat-message-head';
    const name=document.createElement('strong');name.textContent=message.username;head.append(name);
    if(message.role==='owner'){const badge=document.createElement('span');badge.className='chat-owner-badge';badge.textContent='OWNER';head.append(badge)}
    const time=document.createElement('time');time.dateTime=message.created_at;time.textContent=new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(message.created_at));head.append(time);
    if(message.edited_at){const edited=document.createElement('span');edited.className='chat-edited';edited.textContent='(edited)';head.append(edited)}
    if(message.canModify){
      const actions=document.createElement('span');actions.className='chat-message-actions';
      const edit=document.createElement('button');edit.type='button';edit.className='chat-message-action';edit.textContent='Edit';edit.addEventListener('click',()=>editChatMessage(message));
      const remove=document.createElement('button');remove.type='button';remove.className='chat-message-action delete';remove.textContent='Delete';remove.addEventListener('click',()=>deleteChatMessage(message));
      actions.append(edit,remove);head.append(actions);
    }
    const text=document.createElement('p');text.textContent=message.body;
    body.append(head,text);
    const attachment=message.attachment_data||message.attachment_url;
    if(attachment){const image=document.createElement('img');image.className='chat-message-attachment';image.src=attachment;image.alt='Shared attachment';image.loading='lazy';body.append(image)}
    item.dataset.search=(message.username+' '+message.body).toLowerCase();item.append(avatar,body);chatMessages.append(item);
  });
  chatMessages.scrollTop=chatMessages.scrollHeight;
}
async function editChatMessage(message){
  const next=window.prompt('Edit your message',message.body);
  if(next===null||next.trim()===message.body)return;
  const body=next.trim();
  if(!body||body.length>1000){chatStatus.textContent='Messages must be 1–1000 characters.';return}
  try{
    const response=await fetch('/api/chat/messages/'+encodeURIComponent(message.id),{method:'PATCH',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({body})});
    const data=await response.json();if(!response.ok)throw new Error(data.error||'Unable to edit message.');
    chatStatus.textContent='';loadChatMessages({quiet:true});
  }catch(error){chatStatus.textContent=error.message}
}
async function deleteChatMessage(message){
  if(!window.confirm('Delete this message?'))return;
  try{
    const response=await fetch('/api/chat/messages/'+encodeURIComponent(message.id),{method:'DELETE',credentials:'same-origin'});
    if(!response.ok){const data=await response.json();throw new Error(data.error||'Unable to delete message.')}
    chatStatus.textContent='';loadChatMessages({quiet:true});
  }catch(error){chatStatus.textContent=error.message}
}
async function loadChatMessages({quiet=false}={}){
  try{
    const response=await fetch('/api/chat/messages?channel='+encodeURIComponent(activeChatChannel),{credentials:'same-origin',cache:'no-store'});
    const data=await response.json();
    if(!response.ok)throw new Error(data.error||'Unable to load chat.');
    renderChatMessages(data.messages||[]);
    if(!quiet)chatStatus.textContent='';
  }catch(error){if(!quiet)chatStatus.textContent=error.message}
}
function openChat(){
  if(!authUser){openAuthPrompt();return}
  launcher.hidden=true;chatView.hidden=false;document.body.classList.add('chatting');
  document.querySelector('#chat-user-name').textContent=authUser.username;
  document.querySelector('#chat-user-role').textContent=authUser.role;
  document.querySelector('#chat-user-avatar').textContent=authUser.username.charAt(0).toUpperCase();
  loadChatMessages();
  clearInterval(chatPollTimer);chatPollTimer=setInterval(()=>loadChatMessages({quiet:true}),4000);
}
function closeChat(){
  clearInterval(chatPollTimer);chatView.hidden=true;launcher.hidden=false;document.body.classList.remove('chatting');
}
document.querySelector('[data-chat-open]').addEventListener('click',openChat);
document.querySelector('#chat-close').addEventListener('click',closeChat);
document.querySelectorAll('.chat-channel').forEach(button=>button.addEventListener('click',()=>{
  document.querySelectorAll('.chat-channel').forEach(item=>item.classList.toggle('active',item===button));
  activeChatChannel=button.dataset.channel;
  chatChannelName.textContent=activeChatChannel;
  chatChannelDescription.textContent=chatDescriptions[activeChatChannel];
  chatInput.placeholder='Message #'+activeChatChannel;
  chatStatus.textContent='';
  loadChatMessages();
}));
document.querySelector('#chat-form').addEventListener('submit',async event=>{
  event.preventDefault();
  const body=chatInput.value.trim();if(!body)return;
  chatStatus.textContent='Sending…';
  try{
    const response=await fetch('/api/chat/messages',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({channel:activeChatChannel,body})});
    const data=await response.json();if(!response.ok)throw new Error(data.error||'Unable to send.');
    chatInput.value='';clearChatAttachment();chatStatus.textContent='';loadChatMessages();
  }catch(error){chatStatus.textContent=error.message}
});


// Member presence and editable profiles
const membersList=document.querySelector('#members-list');
const memberProfileDialog=document.querySelector('#member-profile-dialog');
memberProfileDialog.addEventListener('click',event=>{
  const rect=memberProfileDialog.getBoundingClientRect();
  const outside=event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom;
  if(outside)memberProfileDialog.close();
});
function openMemberProfile(member){
  const effect=document.querySelector('#member-profile-effect');effect.className='member-profile-effect effect-'+member.effect;effect.style.backgroundImage=member.banner?`linear-gradient(rgba(0,0,0,.08),rgba(0,0,0,.3)),url("${member.banner}")`:'';effect.style.backgroundSize='cover';effect.style.backgroundPosition='center';
  const avatar=document.querySelector('#member-profile-avatar');avatar.style.backgroundImage=member.avatar?`url("${member.avatar}")`:'';
  avatar.textContent=member.avatar?'':(member.displayName||member.username).charAt(0).toUpperCase();
  document.querySelector('#member-profile-name').textContent=member.displayName;
  document.querySelector('#member-profile-username').textContent='@'+member.username;
  document.querySelector('#member-profile-role').textContent=member.role==='owner'?'Owner':'Member';
  document.querySelector('#member-profile-bio').textContent=member.bio||'No bio yet.';
  const dot=document.querySelector('#member-profile-dot');dot.className=member.status;
  document.querySelector('#member-profile-status').textContent=member.status==='dnd'?'Do Not Disturb':member.status;
  memberProfileDialog.showModal();
}

const profileDialog=document.querySelector('#profile-dialog');
const profileForm=document.querySelector('#profile-form');
const profileDisplayName=document.querySelector('#profile-display-name');
const profileBio=document.querySelector('#profile-bio');
const profileStatus=document.querySelector('#profile-status');
const profileEffect=document.querySelector('#profile-effect');
const profileAvatarInput=document.querySelector('#profile-avatar-input');
const profileBannerInput=document.querySelector('#profile-banner-input');
const profileMessage=document.querySelector('#profile-message');
let pendingProfileAvatar=undefined;
let pendingProfileBanner=undefined;
let memberPollTimer=0;
function avatarElement(member,className='member-avatar'){
  if(member.avatar){const image=document.createElement('img');image.className=className;image.src=member.avatar;image.alt='';return image}
  const fallback=document.createElement('span');fallback.className=className;fallback.textContent=(member.displayName||member.username).charAt(0).toUpperCase();return fallback;
}
function renderMembers(members){
  membersList.replaceChildren();
  document.querySelector('#member-count').textContent=String(members.length);
  for(const group of [{title:'Online',members:members.filter(member=>member.status!=='offline')},{title:'Offline',members:members.filter(member=>member.status==='offline')}]){
    const title=document.createElement('h3');title.className='member-group-title';title.textContent=group.title+' — '+group.members.length;membersList.append(title);
    group.members.forEach(member=>{
      const card=document.createElement('button');card.type='button';card.className='member-card '+member.status;card.setAttribute('aria-label','View '+member.displayName+' profile');card.addEventListener('click',()=>openMemberProfile(member));
      const wrap=document.createElement('span');wrap.className='member-avatar-wrap effect-'+member.effect;
      wrap.append(avatarElement(member));const dot=document.createElement('i');dot.className='member-status-dot '+member.status;wrap.append(dot);
      const info=document.createElement('span');const name=document.createElement('strong');name.textContent=member.displayName;
      if(member.role==='owner'){name.classList.add('member-owner-name');card.classList.add('is-owner')}
      const detail=document.createElement('small');detail.textContent=member.role==='owner'?'Owner':member.status==='dnd'?'Do Not Disturb':member.status;
      info.append(name,detail);card.append(wrap,info);membersList.append(card);
    });
  }
}
async function loadMembers(){
  if(!authUser)return;
  try{const response=await fetch('/api/chat/members',{credentials:'same-origin',cache:'no-store'});const data=await response.json();if(response.ok)renderMembers(data.members||[])}catch{}
}
async function sendHeartbeat(){
  if(!authUser)return;
  await fetch('/api/account/heartbeat',{method:'POST',credentials:'same-origin'}).catch(()=>{});
}
function openProfileEditor(){
  if(!authUser)return;
  pendingProfileAvatar=authUser.avatar;
  pendingProfileBanner=authUser.banner;
  profileDisplayName.value=authUser.displayName||authUser.username;
  profileBio.value=authUser.bio||'';
  profileStatus.value=authUser.status||'online';
  profileEffect.value=authUser.effect||'none';
  profileMessage.textContent='';updateProfilePreview();profileDialog.showModal();
}
function updateProfilePreview(){
  const preview=document.querySelector('.profile-preview');preview.className='profile-preview effect-'+profileEffect.value;
  const banner=document.querySelector('#profile-preview-banner');banner.style.backgroundImage=pendingProfileBanner?`url("${pendingProfileBanner}")`:'';
  const avatar=document.querySelector('#profile-preview-avatar');
  avatar.style.backgroundImage=pendingProfileAvatar?`url("${pendingProfileAvatar}")`:'';
  avatar.style.backgroundSize='cover';avatar.textContent=pendingProfileAvatar?'':(profileDisplayName.value||authUser?.username||'O').charAt(0).toUpperCase();
  document.querySelector('#profile-preview-name').textContent=profileDisplayName.value||authUser?.username||'Member';
  document.querySelector('#profile-preview-status').textContent=profileStatus.options[profileStatus.selectedIndex].text;
}
async function compressBannerImage(file){
  const bitmap=await createImageBitmap(file);const canvas=document.createElement('canvas');canvas.width=600;canvas.height=200;
  const context=canvas.getContext('2d');const scale=Math.max(600/bitmap.width,200/bitmap.height);const width=bitmap.width*scale,height=bitmap.height*scale;context.drawImage(bitmap,(600-width)/2,(200-height)/2,width,height);bitmap.close();return canvas.toDataURL('image/jpeg',.72);
}
async function compressProfileImage(file){
  const bitmap=await createImageBitmap(file);const canvas=document.createElement('canvas');canvas.width=128;canvas.height=128;
  const context=canvas.getContext('2d');const scale=Math.max(128/bitmap.width,128/bitmap.height);
  const width=bitmap.width*scale,height=bitmap.height*scale;context.drawImage(bitmap,(128-width)/2,(128-height)/2,width,height);
  bitmap.close();return canvas.toDataURL('image/jpeg',.76);
}
profileAvatarInput.addEventListener('change',async()=>{const file=profileAvatarInput.files[0];if(!file)return;profileMessage.textContent='Processing picture…';try{pendingProfileAvatar=await compressProfileImage(file);profileMessage.textContent='';updateProfilePreview()}catch{profileMessage.textContent='Unable to use that image.'}});
document.querySelector('#profile-remove-avatar').addEventListener('click',()=>{pendingProfileAvatar=null;profileAvatarInput.value='';updateProfilePreview()});
profileBannerInput.addEventListener('change',async()=>{const file=profileBannerInput.files[0];if(!file)return;profileMessage.textContent='Processing banner…';try{pendingProfileBanner=await compressBannerImage(file);profileMessage.textContent='';updateProfilePreview()}catch{profileMessage.textContent='Unable to use that banner.'}});
document.querySelector('#profile-remove-banner').addEventListener('click',()=>{pendingProfileBanner=null;profileBannerInput.value='';updateProfilePreview()});
profileDisplayName.addEventListener('input',updateProfilePreview);profileStatus.addEventListener('change',updateProfilePreview);profileEffect.addEventListener('change',updateProfilePreview);
document.querySelector('#edit-chat-profile').addEventListener('click',openProfileEditor);
profileForm.addEventListener('submit',async event=>{
  event.preventDefault();profileMessage.textContent='Saving…';
  try{
    const response=await fetch('/api/account/profile',{method:'PATCH',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({displayName:profileDisplayName.value,bio:profileBio.value,avatar:pendingProfileAvatar,banner:pendingProfileBanner,status:profileStatus.value,effect:profileEffect.value})});
    const data=await response.json();if(!response.ok)throw new Error(data.error||'Unable to save profile.');
    authUser=data.user;renderAuthState();profileDialog.close();openChat();loadMembers();notify('Profile updated');
  }catch(error){profileMessage.textContent=error.message}
});
const originalOpenChat=openChat;
openChat=function(){
  originalOpenChat();if(!authUser)return;
  sendHeartbeat();loadMembers();clearInterval(memberPollTimer);memberPollTimer=setInterval(()=>{sendHeartbeat();loadMembers()},45000);
};
const originalCloseChat=closeChat;
closeChat=function(){clearInterval(memberPollTimer);originalCloseChat()};


// Functional chat workspace controls
const channelFilter=document.querySelector('#channel-filter');
const messageSearch=document.querySelector('#chat-message-search');
const attachmentInput=document.querySelector('#chat-attachment-input');
const attachmentPreview=document.querySelector('#chat-attachment-preview');
function clearChatAttachment(){pendingChatAttachment=null;attachmentInput.value='';attachmentPreview.hidden=true;attachmentPreview.replaceChildren()}
function showChatAttachment(label,src){
  attachmentPreview.replaceChildren();const name=document.createElement('span');name.textContent=label;
  const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.setAttribute('aria-label','Remove attachment');remove.addEventListener('click',clearChatAttachment);
  attachmentPreview.append(name,remove);if(src){const image=document.createElement('img');image.src=src;image.alt='Attachment preview';attachmentPreview.append(image)}attachmentPreview.hidden=false;
}
document.querySelectorAll('.category-toggle').forEach(button=>button.addEventListener('click',()=>{
  const section=button.closest('.channel-category');const collapsed=section.classList.toggle('collapsed');button.setAttribute('aria-expanded',String(!collapsed));
}));
document.querySelector('#chat-collapse-all').addEventListener('click',event=>{
  const expanded=event.currentTarget.getAttribute('aria-expanded')==='true';
  document.querySelectorAll('.channel-category').forEach(section=>{section.classList.toggle('collapsed',expanded);section.querySelector('.category-toggle')?.setAttribute('aria-expanded',String(!expanded))});
  event.currentTarget.setAttribute('aria-expanded',String(!expanded));event.currentTarget.textContent=expanded?'›':'⌄';
});
channelFilter.addEventListener('input',()=>{
  const query=channelFilter.value.trim().toLowerCase();
  document.querySelectorAll('.chat-channel').forEach(channel=>channel.classList.toggle('filtered-out',!channel.textContent.toLowerCase().includes(query)));
  document.querySelectorAll('.channel-category').forEach(section=>{if(query)section.classList.remove('collapsed')});
});
messageSearch.addEventListener('input',()=>{
  const query=messageSearch.value.trim().toLowerCase();
  chatMessages.querySelectorAll('.chat-message').forEach(message=>message.classList.toggle('filtered-out',query&&!message.dataset.search.includes(query)));
});
document.querySelector('#chat-settings-control').addEventListener('click',()=>document.querySelector('#settings-dialog').showModal());
document.querySelector('#chat-status-control').addEventListener('click',openProfileEditor);
document.querySelector('#chat-notification-control').addEventListener('click',()=>{
  const off=chatView.classList.toggle('chat-notifications-off');localStorage.setItem('orvian-chat-notifications',off?'off':'on');notify(off?'Chat sounds muted':'Chat sounds enabled');
});
document.querySelector('#chat-members-toggle').addEventListener('click',()=>chatView.classList.toggle('members-hidden'));
document.querySelector('#composer-add').addEventListener('click',()=>attachmentInput.click());
attachmentInput.addEventListener('change',async()=>{
  const file=attachmentInput.files?.[0];if(!file)return;
  if(!/^image\/(png|jpeg|webp|gif)$/.test(file.type)){chatStatus.textContent='Choose a PNG, JPEG, WebP, or GIF image.';return}
  if(file.size>250000){chatStatus.textContent='Images must be under 250 KB.';return}
  const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file)});
  pendingChatAttachment={data};showChatAttachment(file.name,data);
});
document.querySelector('#composer-gif').addEventListener('click',()=>{
  const url=window.prompt('Paste a direct HTTPS GIF or image URL');if(!url)return;
  try{const parsed=new URL(url);if(parsed.protocol!=='https:')throw new Error();pendingChatAttachment={url:parsed.href};showChatAttachment('GIF link',parsed.href)}
  catch{chatStatus.textContent='Enter a valid HTTPS image URL.'}
});
document.querySelector('#composer-emoji').addEventListener('click',()=>{
  const emojis=['🙂','😂','🔥','💀','👍','❤️','🎮','✨'];const chosen=window.prompt('Choose or paste an emoji',emojis.join(' '));if(chosen){chatInput.value+=chosen;chatInput.focus()}
});


// Full-screen Orvian game library
const gamesView=document.querySelector('#games-view');
const gamesSearchInput=document.querySelector('#games-search-input');
let activeGameFilter='all';
let viewerReturnTarget='home';
function openGames(){
  if(!gamesView)return;
  launcher.hidden=true;viewer.hidden=true;if(typeof chatView!=='undefined')chatView.hidden=true;gamesView.hidden=false;
  document.body.classList.remove('viewing','chatting');document.body.classList.add('gaming');
  requestAnimationFrame(()=>gamesSearchInput?.focus());
}
function closeGames(){
  if(!gamesView)return;gamesView.hidden=true;launcher.hidden=false;document.body.classList.remove('gaming');
}
function filterGames(){
  if(!gamesSearchInput)return;
  const query=gamesSearchInput.value.trim().toLowerCase();let shown=0;
  document.querySelectorAll('.games-main .game-card[data-game-category]').forEach(card=>{
    const category=(card.dataset.gameCategory||'').toLowerCase();
    const searchable=((card.dataset.gameName||'')+' '+card.textContent+' '+category).toLowerCase();
    const matchesCategory=activeGameFilter==='all'||category.split(/\s+/).includes(activeGameFilter);
    const visible=matchesCategory&&(!query||searchable.includes(query));
    card.classList.toggle('filtered-out',!visible);if(visible)shown++;
  });
  const empty=document.querySelector('#games-empty');if(empty)empty.hidden=shown>0;
}
document.querySelector('#games-open')?.addEventListener('click',openGames);
document.querySelector('#games-close')?.addEventListener('click',closeGames);
gamesSearchInput?.addEventListener('input',filterGames);
gamesSearchInput?.addEventListener('search',filterGames);
gamesSearchInput?.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();filterGames()}});
document.querySelectorAll('.game-filter').forEach(button=>button.addEventListener('click',()=>{
  activeGameFilter=button.dataset.gameFilter||'all';
  document.querySelectorAll('.game-filter').forEach(item=>item.classList.toggle('active',item===button));
  filterGames();
}));
document.querySelectorAll('[data-game-url]').forEach(card=>card.addEventListener('click',()=>{
  viewerReturnTarget='games';gamesView.hidden=true;document.body.classList.remove('gaming');showInViewer(card.dataset.gameUrl);
}));



document.querySelectorAll('.official-game-icon').forEach(image=>image.addEventListener('error',()=>{
  image.hidden=true;const holder=image.closest('.game-card-icon');if(holder){holder.classList.add('icon-fallback');holder.dataset.fallback=image.dataset.iconFallback||'◈'}
},{once:true}));
