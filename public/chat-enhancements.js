/* Chat interaction layer. Shares the authenticated state from app.js. */
const chatContext=()=>activeDmUser?'dm:'+activeDmUser.id:'channel:'+activeChatChannel;
let chatRequest=0,chatPending=null,chatRenderedKey='',chatRenderedContext='',chatForceScroll=true;
let chatConversations=[];
const chatDrafts=new Map();
let lastChatContext=chatContext();
let chatEvents=null;
function connectChatEvents(){
  if(chatEvents||!authUser||chatView.hidden)return;
  chatEvents=new EventSource('/api/chat/events');
  chatEvents.addEventListener('chat-update',()=>{loadChatMessages({quiet:true});loadConversations()});
  chatEvents.onerror=()=>{chatConnection.textContent='Reconnecting';chatConnection.dataset.state='error'};
  chatEvents.addEventListener('ready',()=>{chatConnection.textContent='Live';chatConnection.dataset.state='connected'});
}
function disconnectChatEvents(){chatEvents?.close();chatEvents=null}

async function chatApi(url,options={}){
  const response=await fetch(url,{credentials:'same-origin',cache:'no-store',...options,
    headers:{'Content-Type':'application/json',...options.headers}});
  const data=response.status===204?{}:await response.json().catch(()=>({}));
  if(!response.ok)throw Object.assign(new Error(data.error||'Chat is unavailable. Try again.'),{status:response.status});
  return data;
}

const chatConnection=document.createElement('span');chatConnection.className='chat-connection';chatConnection.textContent='Connecting';
document.querySelector('.chat-header-channel').append(chatConnection);
const newMessageButton=document.createElement('button');newMessageButton.type='button';newMessageButton.className='chat-new-messages';newMessageButton.textContent='New messages ↓';newMessageButton.hidden=true;
document.querySelector('.chat-content').append(newMessageButton);
newMessageButton.addEventListener('click',()=>{chatMessages.scrollTop=chatMessages.scrollHeight;newMessageButton.hidden=true});
chatMessages.addEventListener('scroll',()=>{if(chatMessages.scrollHeight-chatMessages.clientHeight-chatMessages.scrollTop<60)newMessageButton.hidden=true});

const baseRenderMessages=renderChatMessages;
renderChatMessages=function(messages){
  const context=chatContext();const key=JSON.stringify([messages,allChatMembers.map(m=>[m.id,m.displayName,m.avatar]),localStorage.getItem(storageKeys.chatTime24)]);
  if(key===chatRenderedKey&&context===chatRenderedContext)return;
  const same=context===chatRenderedContext;const nearBottom=chatMessages.scrollHeight-chatMessages.clientHeight-chatMessages.scrollTop<80;
  const previousScroll=chatMessages.scrollTop;const previousCount=currentChatMessages.length;
  const previousIds=new Set(currentChatMessages.map(message=>message.id));
  if(same&&messages.some(message=>!previousIds.has(message.id)&&message.username!==authUser?.username))playChatNotification();
  baseRenderMessages(messages);
  chatRenderedKey=key;chatRenderedContext=context;
  const memberByName=new Map(allChatMembers.map(m=>[m.username.toLowerCase(),m]));
  const groups=[...chatMessages.querySelectorAll('.chat-message-group')];
  let previousDay='';
  groups.forEach(group=>{
    const firstTime=group.querySelector('time')?.dateTime;
    if(firstTime){const day=new Intl.DateTimeFormat(undefined,{month:'long',day:'numeric',year:'numeric'}).format(new Date(firstTime));if(day!==previousDay){const divider=document.createElement('div');divider.className='chat-date-divider';divider.textContent=day;group.before(divider);previousDay=day}}
    const name=group.querySelector('.chat-message-head>strong');
    const member=allChatMembers.find(m=>(m.displayName||m.username)===name?.textContent);
    if(member){
      for(const control of [name,group.querySelector('.chat-message-avatar')]){
        control.tabIndex=0;control.setAttribute('role','button');control.setAttribute('aria-label','View '+member.displayName+' profile');
        control.addEventListener('click',()=>openMemberProfile(member));
        control.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();openMemberProfile(member)}});
      }
    }
    group.querySelectorAll('.chat-message-entry>p').forEach(paragraph=>{
      // Tokenize text nodes only; never interpret messages as HTML.
      const node=paragraph.firstChild;if(!node||node.nodeType!==Node.TEXT_NODE)return;
      const text=node.textContent;const fragment=document.createDocumentFragment();let offset=0;
      const pattern=/https?:\/\/[^\s<>]+|@[a-zA-Z0-9_]{3,24}\b/g;
      for(const match of text.matchAll(pattern)){
        fragment.append(text.slice(offset,match.index));const token=match[0];
        if(token.startsWith('@')&&memberByName.has(token.slice(1).toLowerCase())){
          const person=memberByName.get(token.slice(1).toLowerCase());const button=document.createElement('button');button.type='button';button.className='chat-inline-mention';button.textContent=token;button.addEventListener('click',()=>openMemberProfile(person));fragment.append(button);
        }else if(token.startsWith('http')){
          const link=document.createElement('a');link.href=token;link.target='_blank';link.rel='noopener noreferrer';link.textContent=token;fragment.append(link);
        }else fragment.append(token);
        offset=match.index+token.length;
      }
      fragment.append(text.slice(offset));node.replaceWith(fragment);
    });
  });
  if(!messages.length){
    const welcome=chatMessages.querySelector('.chat-welcome');const title=document.createElement('h2');title.textContent=activeDmUser?'Start a conversation':'Welcome to #'+activeChatChannel;
    welcome.prepend(title);
  }
  messageSearch.dispatchEvent(new Event('input'));
  if(!same||chatForceScroll||(nearBottom&&localStorage.getItem(storageKeys.chatScroll)!=='false')){
    chatMessages.scrollTop=chatMessages.scrollHeight;newMessageButton.hidden=true;
  }else {chatMessages.scrollTop=previousScroll;if(messages.length>previousCount)newMessageButton.hidden=false}
  chatForceScroll=false;
};

loadChatMessages=async function({quiet=false}={}){
  if(!authUser||chatView.hidden||document.hidden)return;
  const context=chatContext();chatPending?.abort();chatPending=new AbortController();const sequence=++chatRequest;
  if(!quiet&&chatRenderedContext!==context){chatMessages.replaceChildren();chatMessages.setAttribute('aria-busy','true');chatConnection.textContent='Connecting'}
  try{
    const url=activeDmUser?'/api/chat/dm/'+encodeURIComponent(activeDmUser.id):'/api/chat/messages?channel='+encodeURIComponent(activeChatChannel);
    const data=await chatApi(url,{signal:chatPending.signal});
    if(sequence!==chatRequest||context!==chatContext()||chatView.hidden)return;
    renderChatMessages(data.messages||[]);chatConnection.textContent='Connected';chatConnection.dataset.state='connected';
    if(!quiet)chatStatus.textContent='';
  }catch(error){
    if(error.name==='AbortError'||context!==chatContext())return;
    chatConnection.textContent='Retrying';chatConnection.dataset.state='error';chatStatus.textContent=error.message;
    if(error.status===401||error.status===403){
      if(error.status===401)clearInterval(chatPollTimer);
      chatConnection.textContent='Access unavailable';chatMessages.replaceChildren();chatRenderedKey='';
      chatInput.disabled=true;document.querySelector('.composer-send').disabled=true;
    }
  }finally{if(sequence===chatRequest)chatMessages.removeAttribute('aria-busy')}
};

async function loadConversations(){
  if(!authUser||chatView.hidden)return;
  try{
    const data=await chatApi('/api/chat/conversations');chatConversations=data.conversations||[];
    const nav=document.querySelector('#dm-channels');nav.replaceChildren();
    for(const item of chatConversations){const member=allChatMembers.find(m=>m.id===item.id)||item;renderDmShortcut(member)}
    if(activeDmUser)renderDmShortcut(activeDmUser);
    channelFilter.dispatchEvent(new Event('input'));
  }catch(error){chatStatus.textContent=error.message}
}

function syncChatContext(){
  const context=chatContext();
  if(context!==lastChatContext){
    chatDrafts.set(lastChatContext,chatInput.value);chatInput.value=chatDrafts.get(context)||'';
    clearChatAttachment();clearChatReply();hideMentionMenu();hideCommandMenu();chatForceScroll=true;lastChatContext=context;
  }
  const readOnly=!activeDmUser&&['rules','announcements'].includes(activeChatChannel)&&authUser?.role!=='owner';
  chatInput.disabled=readOnly;document.querySelector('.composer-send').disabled=readOnly;
  document.querySelector('#composer-add').disabled=readOnly;document.querySelector('#composer-gif').disabled=readOnly;
  if(readOnly)chatInput.placeholder='Only the owner can post in #'+activeChatChannel;
  document.querySelector('.chat-header-channel>b').textContent=activeDmUser?'@':'#';
  document.querySelector('.chat-sidebar').classList.remove('mobile-channels-open');
}
document.querySelector('.chat-channels').addEventListener('click',event=>{if(event.target.closest('.chat-channel'))syncChatContext()});
const previousOpenDm=openDirectMessage;
openDirectMessage=function(member){previousOpenDm(member);syncChatContext();loadChatMessages()};
const originalLoadMembers=loadMembers;
loadMembers=async function(){await originalLoadMembers();if(!chatView.hidden)loadConversations()};
const previousRenderMembers=renderMembers;
renderMembers=function(members){
  previousRenderMembers(members);
  if(currentChatMessages.length&&!chatView.hidden)renderChatMessages(currentChatMessages);
  const self=members.find(member=>member.id===authUser?.id);
  if(self)document.querySelector('.chat-user-avatar-shell>i').className='presence-'+self.status;
};
let chatSoundContext=null;
function playChatNotification(){
  if(authUser?.status==='dnd')return;
  if(localStorage.getItem(storageKeys.chatSounds)!=='false')try{
    chatSoundContext??=new (window.AudioContext||window.webkitAudioContext)();
    if(chatSoundContext.state!=='running')return;
    const tone=chatSoundContext.createOscillator(),gain=chatSoundContext.createGain();
    tone.frequency.value=680;tone.connect(gain);gain.connect(chatSoundContext.destination);
    gain.gain.setValueAtTime(.025,chatSoundContext.currentTime);gain.gain.exponentialRampToValueAtTime(.0001,chatSoundContext.currentTime+.12);
    tone.start();tone.stop(chatSoundContext.currentTime+.13);
  }catch{}
  if(document.hidden&&localStorage.getItem(storageKeys.desktopNotifications)==='true'&&'Notification' in window&&Notification.permission==='granted')new Notification('New Orvian message',{body:'Open Chat to view the conversation.',icon:'/favicon.png'});
}

const chatContextMenu=document.createElement('div');chatContextMenu.className='chat-context-menu';chatContextMenu.hidden=true;document.body.append(chatContextMenu);
function closeChatContextMenu(){chatContextMenu.hidden=true;chatContextMenu.replaceChildren()}
function contextAction(label,callback,danger=false){const button=document.createElement('button');button.type='button';button.textContent=label;button.classList.toggle('danger',danger);button.addEventListener('click',()=>{closeChatContextMenu();callback()});chatContextMenu.append(button)}
chatMessages.addEventListener('contextmenu',event=>{
  const entry=event.target.closest('.chat-message-entry');if(!entry)return;
  const message=currentChatMessages.find(item=>String(item.id)===entry.dataset.messageId);if(!message)return;
  event.preventDefault();closeChatContextMenu();
  contextAction('Reply',()=>beginChatReply(message));
  contextAction('React with 👍',()=>toggleChatReaction(message,'👍'));
  if(authUser?.role==='owner')contextAction(message.pinned_at?'Unpin message':'Pin message',()=>toggleChatPin(message));
  if(message.canModify){contextAction('Edit message',()=>editChatMessage(message));contextAction('Delete message',()=>deleteChatMessage(message),true)}
  chatContextMenu.style.left=Math.min(event.clientX,innerWidth-190)+'px';chatContextMenu.style.top=Math.min(event.clientY,innerHeight-220)+'px';chatContextMenu.hidden=false;
});
document.addEventListener('pointerdown',event=>{if(!chatContextMenu.contains(event.target))closeChatContextMenu()});
new MutationObserver(()=>{
  if(chatView.hidden){chatPending?.abort();chatRequest++;newMessageButton.hidden=true;disconnectChatEvents();return}
  syncChatContext();loadConversations();connectChatEvents();chatView.classList.toggle('chat-notifications-off',localStorage.getItem(storageKeys.chatSounds)==='false');
}).observe(chatView,{attributes:true,attributeFilter:['hidden']});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!chatView.hidden){sendHeartbeat();loadMembers();loadConversations();loadChatMessages({quiet:true})}});
window.addEventListener('online',()=>{if(!chatView.hidden)loadChatMessages({quiet:true})});
document.querySelector('#logout-button').addEventListener('click',()=>{disconnectChatEvents();if(!chatView.hidden)closeChat();allChatMembers=[];chatConversations=[];chatDrafts.clear();document.querySelector('#dm-channels').replaceChildren()});

// Replace blocking browser prompts with matching in-app dialogs.
const actionDialog=document.createElement('dialog');actionDialog.className='chat-action-dialog';
document.body.append(actionDialog);
function chatAction({title,value='',confirmText='Save',input=true,description=''}){
  return new Promise(resolve=>{
    actionDialog.replaceChildren();const form=document.createElement('form');form.method='dialog';const heading=document.createElement('h2');heading.textContent=title;
    const detail=document.createElement('p');detail.textContent=description;const field=document.createElement('textarea');field.value=value;field.maxLength=1000;field.rows=4;field.setAttribute('aria-label',title);
    const controls=document.createElement('div');controls.className='chat-action-controls';const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Cancel';const save=document.createElement('button');save.type='submit';save.textContent=confirmText;controls.append(cancel,save);form.append(heading,detail);if(input)form.append(field);form.append(controls);actionDialog.append(form);
    let result=null;cancel.onclick=()=>actionDialog.close();form.onsubmit=event=>{event.preventDefault();if(input&&!field.value.trim())return;result=input?field.value.trim():true;actionDialog.close()};actionDialog.addEventListener('close',()=>resolve(result),{once:true});actionDialog.showModal();if(input)field.focus();else cancel.focus();
  });
}
actionDialog.addEventListener('click',event=>{if(event.target===actionDialog){const box=actionDialog.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)actionDialog.close()}});
editChatMessage=async function(message){
  const direct=Boolean(activeDmUser);const context=chatContext();
  const body=await chatAction({title:'Edit message',value:message.body});if(body===null||body===message.body)return;
  try{await chatApi('/api/chat/'+(direct?'direct-messages/':'messages/')+message.id,{method:'PATCH',body:JSON.stringify({body})});chatRenderedKey='';if(context===chatContext())await loadChatMessages({quiet:true})}catch(error){chatStatus.textContent=error.message}
};
deleteChatMessage=async function(message){
  const direct=Boolean(activeDmUser);const context=chatContext();
  if(!await chatAction({title:'Delete message?',description:'This message will be permanently removed.',input:false,confirmText:'Delete'}))return;
  try{await chatApi('/api/chat/'+(direct?'direct-messages/':'messages/')+message.id,{method:'DELETE'});chatRenderedKey='';if(context===chatContext())await loadChatMessages({quiet:true})}catch(error){chatStatus.textContent=error.message}
};

function replaceChatControl(id,callback){const old=document.querySelector(id);const button=old.cloneNode(true);old.replaceWith(button);button.addEventListener('click',callback);return button}
replaceChatControl('#composer-gif',async()=>{
  const url=await chatAction({title:'Add a GIF',description:'Paste a direct HTTPS image or GIF link.',confirmText:'Attach'});if(!url)return;
  try{const parsed=new URL(url);if(parsed.protocol!=='https:')throw new Error();pendingChatAttachment={url:parsed.href};showChatAttachment('GIF attachment',parsed.href)}catch{chatStatus.textContent='Use a valid HTTPS image or GIF link.'}
});
const emojiPicker=document.createElement('div');emojiPicker.className='chat-emoji-picker';emojiPicker.hidden=true;emojiPicker.setAttribute('aria-label','Choose an emoji');
for(const emoji of ['😀','😂','🥹','😎','🤔','😭','😤','💀','👀','🔥','✨','❤️','💯','👍','👎','👏','🙌','🎉','🎮','🖤','✅','❌','⭐','🤝']){const button=document.createElement('button');button.type='button';button.textContent=emoji;button.setAttribute('aria-label',emoji);button.addEventListener('click',()=>{chatInput.setRangeText(emoji,chatInput.selectionStart,chatInput.selectionEnd,'end');emojiPicker.hidden=true;chatInput.focus();chatInput.dispatchEvent(new Event('input'))});emojiPicker.append(button)}
document.querySelector('.chat-compose-wrap').append(emojiPicker);
const emojiButton=replaceChatControl('#composer-emoji',()=>{emojiPicker.hidden=!emojiPicker.hidden});
document.addEventListener('click',event=>{if(!emojiPicker.contains(event.target)&&!emojiButton.contains(event.target))emojiPicker.hidden=true});

// Multi-line composer: Enter sends, Shift+Enter adds a line.
chatInput.addEventListener('keydown',event=>{
  if(event.defaultPrevented||event.isComposing)return;
  if(event.key==='Enter'&&!event.shiftKey&&localStorage.getItem(storageKeys.enterSends)!=='false'){event.preventDefault();document.querySelector('#chat-form').requestSubmit()}
  if(event.key==='Escape')emojiPicker.hidden=true;
});
const counter=document.createElement('small');counter.className='chat-character-count';counter.textContent='0 / 1000';document.querySelector('.chat-compose-wrap').append(counter);
chatInput.addEventListener('input',()=>{counter.textContent=chatInput.value.length+' / 1000';chatDrafts.set(chatContext(),chatInput.value)});
const searchCount=document.createElement('span');searchCount.className='chat-search-count';messageSearch.parentElement.append(searchCount);
messageSearch.addEventListener('input',()=>{const query=messageSearch.value.trim();searchCount.textContent=query?chatMessages.querySelectorAll('.chat-message:not(.filtered-out)').length+' groups':''});
// Channel navigation on small screens stays named and usable.
const channelToggle=document.createElement('button');channelToggle.type='button';channelToggle.className='chat-channel-toggle';channelToggle.textContent='☰';channelToggle.setAttribute('aria-label','Choose channel');document.querySelector('.chat-header').prepend(channelToggle);
channelToggle.addEventListener('click',()=>document.querySelector('.chat-sidebar').classList.toggle('mobile-channels-open'));
document.querySelectorAll('.chat-space-button').forEach(button=>button.addEventListener('click',()=>{
  document.querySelectorAll('.chat-space-button').forEach(item=>item.classList.toggle('active',item===button));
  if(button.dataset.chatSpace==='orvian')document.querySelector('[data-channel="general"]')?.click();
  else {
    const first=document.querySelector('.dm-channel');
    if(first)first.click();else{document.querySelector('.chat-sidebar').classList.add('mobile-channels-open');channelFilter.focus();chatStatus.textContent='Start a direct message from the member list.'}
  }
}));
document.querySelector('#chat-members-toggle').addEventListener('click',()=>{document.querySelector('#chat-members-toggle').setAttribute('aria-expanded',String(!chatView.classList.contains('members-hidden')))});
document.querySelector('#profile-dialog').addEventListener('close',()=>{chatRenderedKey=''});

// Consistent, local vector icons keep the small controls recognizable.
const chatIcons={
 '#chat-members-toggle':['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2','M16 3a4 4 0 0 1 0 8','M22 21v-2a4 4 0 0 0-3-3.87','M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8'],
 '#chat-settings-control':['M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8','M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2'],
 '#composer-emoji':['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20','M8 14s1 3 4 3 4-3 4-3','M8 8h.01M16 8h.01']
};
for(const [selector,paths] of Object.entries(chatIcons)){
 const button=document.querySelector(selector);button.replaceChildren();const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');
 for(const d of paths){const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',d);svg.append(path)}button.append(svg);
}
