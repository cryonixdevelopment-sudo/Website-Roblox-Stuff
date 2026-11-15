const storageKeys={links:'orvian-links',engine:'orvian-search-engine',newTabs:'orvian-new-tabs',reduceMotion:'orvian-reduce-motion',profile:'orvian-profile',theme:'orvian-theme',background:'orvian-background',preferHttps:'orvian-prefer-https',stripTracking:'orvian-strip-tracking'};
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
const savedLinks=document.querySelector('#saved-links');
const displayName=document.querySelector('#display-name');
const toast=document.querySelector('#toast');
const launcher=document.querySelector('.launcher');
const viewer=document.querySelector('#viewer');
const viewerFrame=document.querySelector('#viewer-frame');
const viewerUrl=document.querySelector('#viewer-url');
const viewerExternal=document.querySelector('#viewer-external');
const viewerNote=document.querySelector('#viewer-note');
const viewerBack=document.querySelector('#viewer-back');
const proxyAvailable=Boolean(window.Ultraviolet&&window.__uv$config&&'serviceWorker' in navigator&&window.isSecureContext);
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
  if(!proxyReadyPromise){
    proxyReadyPromise=(async()=>{
      // GitHub Pages serves the frontend only; it cannot serve Bare or Ultraviolet assets.
      const health=await fetch('/health',{cache:'no-store'}).catch(()=>null);
      if(!health?.ok||!health.headers.get('content-type')?.includes('application/json'))return false;
      const status=await health.json().catch(()=>null);
      if(status?.status!=='ok')return false;
      const uvScript=await fetch('/uv/uv.sw.js',{method:'HEAD',cache:'no-store'}).catch(()=>null);
      if(!uvScript?.ok||!uvScript.headers.get('content-type')?.includes('javascript'))return false;
      const registration=await navigator.serviceWorker.register('/sw.js',{scope:'/service/'});
      if(registration.active)return true;
      const worker=registration.installing||registration.waiting;
      if(!worker)return false;
      return await new Promise(resolve=>{
        const timeout=setTimeout(()=>resolve(false),8000);
        worker.addEventListener('statechange',()=>{
          if(worker.state==='activated'){clearTimeout(timeout);resolve(true)}
          else if(worker.state==='redundant'){clearTimeout(timeout);resolve(false)}
        });
      });
    })().catch(error=>{console.warn('Orvian embedded browser failed:',error);return false});
  }
  return proxyReadyPromise;
}
function proxyUrl(url){
  return window.__uv$config.prefix+window.__uv$config.encodeUrl(url);
}
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
async function showInViewer(url,record=true){
  if(record&&currentViewerUrl!==url)viewerHistory.push(url);
  currentViewerUrl=url;
  viewerUrl.textContent=url;
  launcher.hidden=true;
  viewer.hidden=false;
  document.body.classList.add('viewing');
  viewerFrame.removeAttribute('src');
  viewerNote.textContent='Connecting to the in-page browser…';
  const requestedUrl=url;
  const ready=await prepareProxy();
  if(currentViewerUrl!==requestedUrl||viewer.hidden)return;
  viewerUsesProxy=ready;
  if(ready){
    viewerNote.textContent='Browsing inside Orvian. Some sites may still limit functionality.';
    try{
      viewerFrame.src=proxyUrl(url);
    }catch(error){
      console.error('Could not load embedded page:',error);
      viewerNote.textContent='This page could not be opened inside Orvian. Check the server and reload.';
      viewerFrame.src='about:blank';
    }
  }else{
    // Never try a raw cross-origin iframe: most search engines refuse embedding.
    viewerNote.textContent='In-page browsing is unavailable on this host. Run Orvian on its Node.js server with HTTPS and WebSocket support; static GitHub Pages cannot provide the browser backend.';
    viewerFrame.src='about:blank';
  }
}
function closeViewer(){
  currentViewerUrl='';
  viewerHistory=[];
  viewerFrame.src='about:blank';
  viewer.hidden=true;
  launcher.hidden=false;
  document.body.classList.remove('viewing');
  searchInput.focus();
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
      viewerFrame.contentWindow.history.back();
      return;
    }catch(error){console.warn('In-page history unavailable:',error)}
  }
  if(viewerHistory.length<=1){closeViewer();return}
  viewerHistory.pop();showInViewer(viewerHistory.at(-1),false);
});
viewerFrame.addEventListener('load',()=>{
  if(!viewerUsesProxy||viewer.hidden)return;
  try{
    const frameUrl=new URL(viewerFrame.contentWindow.location.href);
    if(frameUrl.pathname.startsWith(window.__uv$config.prefix)){
      const actual=window.__uv$config.decodeUrl(frameUrl.pathname.slice(window.__uv$config.prefix.length));
      if(/^https?:\/\//i.test(actual)){currentViewerUrl=actual;viewerUrl.textContent=actual}
    }
  }catch{/* Cross-origin navigation details are not readable; browsing remains available. */}
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
document.documentElement.classList.toggle('reduce-motion',motionSetting.checked);
document.documentElement.dataset.theme=themeSetting.value;
document.documentElement.style.setProperty('--background-opacity',String(Number(backgroundSetting.value)/100));
searchEngine.addEventListener('change',()=>localStorage.setItem(storageKeys.engine,searchEngine.value));
newTabSetting.addEventListener('change',()=>localStorage.setItem(storageKeys.newTabs,String(newTabSetting.checked)));
motionSetting.addEventListener('change',()=>{localStorage.setItem(storageKeys.reduceMotion,String(motionSetting.checked));document.documentElement.classList.toggle('reduce-motion',motionSetting.checked)});
themeSetting.addEventListener('change',()=>{localStorage.setItem(storageKeys.theme,themeSetting.value);document.documentElement.dataset.theme=themeSetting.value});
backgroundSetting.addEventListener('input',()=>{localStorage.setItem(storageKeys.background,backgroundSetting.value);document.documentElement.style.setProperty('--background-opacity',String(Number(backgroundSetting.value)/100))});
httpsSetting.addEventListener('change',()=>localStorage.setItem(storageKeys.preferHttps,String(httpsSetting.checked)));
trackingSetting.addEventListener('change',()=>localStorage.setItem(storageKeys.stripTracking,String(trackingSetting.checked)));
document.querySelectorAll('.settings-tab').forEach(tab=>tab.addEventListener('click',()=>{document.querySelectorAll('.settings-tab').forEach(item=>item.classList.toggle('active',item===tab));document.querySelectorAll('.settings-panel').forEach(panel=>panel.classList.toggle('active',panel.dataset.settingsPanel===tab.dataset.settingsTab))}));
displayName.value=localStorage.getItem(storageKeys.profile)||'';
document.querySelector('#save-profile').addEventListener('click',()=>{localStorage.setItem(storageKeys.profile,displayName.value.trim());notify('Profile saved locally')});
function clearLocalData(){
  if(!window.confirm('Clear Orvian bookmarks, settings, and profile from this browser?'))return;
  Object.values(storageKeys).forEach(key=>localStorage.removeItem(key));renderLinks();searchEngine.value='ddg';newTabSetting.checked=false;motionSetting.checked=false;themeSetting.value='midnight';backgroundSetting.value='100';httpsSetting.checked=false;trackingSetting.checked=false;displayName.value='';document.documentElement.classList.remove('reduce-motion');document.documentElement.dataset.theme='midnight';document.documentElement.style.setProperty('--background-opacity','1');notify('Local data cleared');
}
document.querySelector('#clear-data').addEventListener('click',clearLocalData);
document.querySelector('#settings-clear-data').addEventListener('click',clearLocalData);
renderLinks();
