const storageKeys={links:'orvian-links',engine:'orvian-search-engine',newTabs:'orvian-new-tabs',reduceMotion:'orvian-reduce-motion',profile:'orvian-profile',theme:'orvian-theme',background:'orvian-background',preferHttps:'orvian-prefer-https',stripTracking:'orvian-strip-tracking',showImages:'orvian-show-images',showTrail:'orvian-show-trail'};
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
const savedLinks=document.querySelector('#saved-links');
const displayName=document.querySelector('#display-name');
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
  viewer.hidden=true;launcher.hidden=false;document.body.classList.remove('viewing');searchInput.focus();
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
document.querySelectorAll('.tile[href],.trending[href]').forEach(link=>link.addEventListener('click',event=>{event.preventDefault();openUrl(link.href)}));
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
document.querySelectorAll('[data-panel]').forEach(button=>button.addEventListener('click',()=>document.querySelector(`#${button.dataset.panel}`)?.showModal()));
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
document.querySelectorAll('.settings-tab').forEach(tab=>tab.addEventListener('click',()=>{document.querySelectorAll('.settings-tab').forEach(item=>item.classList.toggle('active',item===tab));document.querySelectorAll('.settings-panel').forEach(panel=>panel.classList.toggle('active',panel.dataset.settingsPanel===tab.dataset.settingsTab))}));
displayName.value=localStorage.getItem(storageKeys.profile)||'';
document.querySelector('#save-profile').addEventListener('click',()=>{localStorage.setItem(storageKeys.profile,displayName.value.trim());notify('Profile saved locally')});
function clearLocalData(){
  if(!window.confirm('Clear Orvian bookmarks, settings, and profile from this browser?'))return;
  Object.values(storageKeys).forEach(key=>localStorage.removeItem(key));renderLinks();searchEngine.value='ddg';newTabSetting.checked=false;motionSetting.checked=false;themeSetting.value='midnight';backgroundSetting.value='100';httpsSetting.checked=false;trackingSetting.checked=false;imagesSetting.checked=true;trailSetting.checked=true;displayName.value='';document.documentElement.classList.remove('reduce-motion');document.documentElement.dataset.theme='midnight';document.documentElement.classList.remove('images-disabled','trail-disabled');document.documentElement.style.setProperty('--background-opacity','1');notify('Local data cleared');
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
