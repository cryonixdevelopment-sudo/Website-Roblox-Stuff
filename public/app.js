const storageKeys={links:'orvian-links',engine:'orvian-search-engine',newTabs:'orvian-new-tabs',reduceMotion:'orvian-reduce-motion',profile:'orvian-profile'};
const engines={ddg:'https://duckduckgo.com/?q=',google:'https://www.google.com/search?q=',bing:'https://www.bing.com/search?q='};
const searchForm=document.querySelector('#search-form');
const searchInput=document.querySelector('#search-input');
const searchEngine=document.querySelector('#search-engine');
const newTabSetting=document.querySelector('#new-tab-setting');
const motionSetting=document.querySelector('#motion-setting');
const savedLinks=document.querySelector('#saved-links');
const displayName=document.querySelector('#display-name');
const toast=document.querySelector('#toast');
const launcher=document.querySelector('.launcher');
const viewer=document.querySelector('#viewer');
const viewerFrame=document.querySelector('#viewer-frame');
const viewerUrl=document.querySelector('#viewer-url');
const viewerExternal=document.querySelector('#viewer-external');
let viewerHistory=[];
let currentViewerUrl='';
let toastTimer;

function readLinks(){try{return JSON.parse(localStorage.getItem(storageKeys.links)||'[]')}catch{return[]}}
function normalize(value){
  const input=value.trim();
  if(!input)return null;
  if(/^https?:\/\//i.test(input))return input;
  if(/^[\w-]+(\.[\w-]+)+([/:?#].*)?$/i.test(input))return `https://${input}`;
  const engine=localStorage.getItem(storageKeys.engine)||'ddg';
  return `${engines[engine]||engines.ddg}${encodeURIComponent(input)}`;
}
function openUrl(value){
  const url=normalize(value);
  if(!url)return;
  if(localStorage.getItem(storageKeys.newTabs)==='true')window.open(url,'_blank','noopener,noreferrer');
  else showInViewer(url);
}
function showInViewer(url,record=true){
  if(record&&currentViewerUrl!==url)viewerHistory.push(url);
  currentViewerUrl=url;
  viewerUrl.textContent=url;
  viewerFrame.src=url;
  launcher.hidden=true;
  viewer.hidden=false;
  document.body.classList.add('viewing');
}
function closeViewer(){
  viewerFrame.src='about:blank';viewer.hidden=true;launcher.hidden=false;
  document.body.classList.remove('viewing');searchInput.focus();
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

searchForm.addEventListener('submit',event=>{event.preventDefault();openUrl(searchInput.value)});
document.querySelectorAll('.tile[href],.trending[href]').forEach(link=>link.addEventListener('click',event=>{event.preventDefault();openUrl(link.href)}));
document.querySelector('#viewer-close').addEventListener('click',closeViewer);
document.querySelector('#viewer-reload').addEventListener('click',()=>{if(currentViewerUrl)viewerFrame.src=currentViewerUrl});
document.querySelector('#viewer-back').addEventListener('click',()=>{
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
document.documentElement.classList.toggle('reduce-motion',motionSetting.checked);
searchEngine.addEventListener('change',()=>localStorage.setItem(storageKeys.engine,searchEngine.value));
newTabSetting.addEventListener('change',()=>localStorage.setItem(storageKeys.newTabs,String(newTabSetting.checked)));
motionSetting.addEventListener('change',()=>{localStorage.setItem(storageKeys.reduceMotion,String(motionSetting.checked));document.documentElement.classList.toggle('reduce-motion',motionSetting.checked)});
displayName.value=localStorage.getItem(storageKeys.profile)||'';
document.querySelector('#save-profile').addEventListener('click',()=>{localStorage.setItem(storageKeys.profile,displayName.value.trim());notify('Profile saved locally')});
document.querySelector('#clear-data').addEventListener('click',()=>{
  if(!window.confirm('Clear Orvian bookmarks, settings, and profile from this browser?'))return;
  Object.values(storageKeys).forEach(key=>localStorage.removeItem(key));renderLinks();searchEngine.value='ddg';newTabSetting.checked=false;motionSetting.checked=false;displayName.value='';document.documentElement.classList.remove('reduce-motion');notify('Local data cleared');
});
renderLinks();
