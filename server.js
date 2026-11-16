import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import express from 'express';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import {server as wisp,logging} from '@mercuryworkshop/wisp-js/server';
import {scramjetPath} from '@mercuryworkshop/scramjet/path';
import {libcurlPath} from '@mercuryworkshop/libcurl-transport';
import {baremuxPath} from '@mercuryworkshop/bare-mux/node';

const directory=path.dirname(fileURLToPath(import.meta.url));
const app=express();
const port=Number(process.env.PORT)||3000;
const {Pool}=pg;
const databaseUrl=process.env.DATABASE_URL||'';
const authPool=databaseUrl?new Pool({connectionString:databaseUrl,ssl:/localhost|127\.0\.0\.1/.test(databaseUrl)?false:{rejectUnauthorized:false}}):null;
let authSchemaPromise=null;
app.disable('x-powered-by');
app.set('trust proxy',1);
app.use(express.json({limit:'300kb'}));
logging.set_level(logging.NONE);
Object.assign(wisp.options,{allow_udp_streams:false});
app.use((_req,res,next)=>{
  res.setHeader('Cross-Origin-Opener-Policy','same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
  next();
});

const authAttempts=new Map();
function authRateLimit(req,res,next){
  const key=req.ip||req.socket.remoteAddress||'unknown';
  const now=Date.now(),windowMs=10*60*1000,limit=20;
  const recent=(authAttempts.get(key)||[]).filter(time=>now-time<windowMs);
  if(recent.length>=limit)return res.status(429).json({error:'Too many attempts. Please wait and try again.'});
  recent.push(now);authAttempts.set(key,recent);next();
}
function ensureAuthSchema(){
  if(!authPool)return Promise.reject(new Error('DATABASE_URL is not configured'));
  if(!authSchemaPromise)authSchemaPromise=authPool.query(`
    CREATE TABLE IF NOT EXISTS orvian_users (
      id BIGSERIAL PRIMARY KEY,
      username VARCHAR(24) NOT NULL,
      username_lower VARCHAR(24) NOT NULL UNIQUE,
      email VARCHAR(254),
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      edited_at TIMESTAMPTZ
    );
    ALTER TABLE orvian_chat_messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
    ALTER TABLE orvian_chat_messages ADD COLUMN IF NOT EXISTS attachment_data TEXT;
    ALTER TABLE orvian_chat_messages ADD COLUMN IF NOT EXISTS attachment_url TEXT;
    CREATE TABLE IF NOT EXISTS orvian_sessions (
      token_hash CHAR(64) PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES orvian_users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS orvian_sessions_expiry_idx ON orvian_sessions(expires_at);
    ALTER TABLE orvian_users ADD COLUMN IF NOT EXISTS role VARCHAR(16) NOT NULL DEFAULT 'member';
    ALTER TABLE orvian_users ADD COLUMN IF NOT EXISTS display_name VARCHAR(32);
    ALTER TABLE orvian_users ADD COLUMN IF NOT EXISTS bio VARCHAR(160);
    ALTER TABLE orvian_users ADD COLUMN IF NOT EXISTS avatar_data TEXT;
    ALTER TABLE orvian_users ADD COLUMN IF NOT EXISTS banner_data TEXT;
    ALTER TABLE orvian_users ADD COLUMN IF NOT EXISTS presence_status VARCHAR(16) NOT NULL DEFAULT 'online';
    ALTER TABLE orvian_users ADD COLUMN IF NOT EXISTS profile_effect VARCHAR(16) NOT NULL DEFAULT 'none';
    ALTER TABLE orvian_users ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ;
    UPDATE orvian_users SET role='owner'
      WHERE id=(SELECT id FROM orvian_users ORDER BY created_at ASC,id ASC LIMIT 1)
      AND NOT EXISTS(SELECT 1 FROM orvian_users WHERE role='owner');
    CREATE TABLE IF NOT EXISTS orvian_chat_messages (
      id BIGSERIAL PRIMARY KEY,
      channel VARCHAR(32) NOT NULL,
      user_id BIGINT NOT NULL REFERENCES orvian_users(id) ON DELETE CASCADE,
      body VARCHAR(1000) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS orvian_chat_channel_idx ON orvian_chat_messages(channel,created_at DESC);
  `).catch(error=>{authSchemaPromise=null;throw error});
  return authSchemaPromise;
}
function cookieValue(req,name){
  const cookie=req.headers.cookie||'';
  for(const part of cookie.split(';')){
    const [key,...value]=part.trim().split('=');
    if(key===name)return decodeURIComponent(value.join('='));
  }
  return '';
}
function tokenHash(token){return crypto.createHash('sha256').update(token).digest('hex')}
function sessionCookie(req,token,maxAge){
  const secure=req.secure||req.headers['x-forwarded-proto']==='https';
  return ['orvian_session='+encodeURIComponent(token),'Path=/','HttpOnly','SameSite=Lax',secure?'Secure':'',maxAge?'Max-Age='+maxAge:'Max-Age=0'].filter(Boolean).join('; ');
}
async function createSession(req,res,userId){
  const token=crypto.randomBytes(32).toString('base64url');
  const maxAge=30*24*60*60;
  await authPool.query('INSERT INTO orvian_sessions(token_hash,user_id,expires_at) VALUES($1,$2,NOW()+INTERVAL \'30 days\')',[tokenHash(token),userId]);
  res.setHeader('Set-Cookie',sessionCookie(req,token,maxAge));
}
async function currentAuthUser(req){
  if(!authPool)return null;
  const token=cookieValue(req,'orvian_session');
  if(!token)return null;
  await ensureAuthSchema();
  const result=await authPool.query(`
    SELECT u.id,u.username,u.email,u.role,u.display_name,u.bio,u.avatar_data,u.banner_data,u.presence_status,u.profile_effect FROM orvian_sessions s
    JOIN orvian_users u ON u.id=s.user_id
    WHERE s.token_hash=$1 AND s.expires_at>NOW()
  `,[tokenHash(token)]);
  return result.rows[0]||null;
}
function publicUser(user){return user?{
  id:String(user.id),username:user.username,email:user.email||null,role:user.role||'member',
  displayName:user.display_name||user.username,bio:user.bio||'',avatar:user.avatar_data||null,banner:user.banner_data||null,
  status:user.presence_status||'online',effect:user.profile_effect||'none'
}:null}
app.get('/api/auth/me',async(req,res)=>{
  try{return res.json({user:publicUser(await currentAuthUser(req)),available:Boolean(authPool)})}
  catch(error){console.error('Auth status failed:',error.message);return res.status(503).json({error:'Accounts are temporarily unavailable.',available:false})}
});
app.post('/api/auth/signup',authRateLimit,async(req,res)=>{
  if(!authPool)return res.status(503).json({error:'Accounts need a database connection first.'});
  const username=String(req.body?.username||'').trim();
  const usernameLower=username.toLowerCase();
  const password=String(req.body?.password||'');
  const email=String(req.body?.email||'').trim().toLowerCase()||null;
  if(!/^[a-zA-Z0-9_]{3,24}$/.test(username))return res.status(400).json({error:'Username must be 3–24 letters, numbers, or underscores.'});
  if(password.length<8||password.length>128)return res.status(400).json({error:'Password must be 8–128 characters.'});
  if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return res.status(400).json({error:'Enter a valid email or leave it blank.'});
  try{
    await ensureAuthSchema();
    const passwordHash=await bcrypt.hash(password,12);
    const result=await authPool.query('INSERT INTO orvian_users(username,username_lower,email,password_hash) VALUES($1,$2,$3,$4) RETURNING id,username,email',[username,usernameLower,email,passwordHash]);
    await createSession(req,res,result.rows[0].id);
    return res.status(201).json({user:publicUser(result.rows[0])});
  }catch(error){
    if(error.code==='23505')return res.status(409).json({error:'That username is already taken.'});
    console.error('Signup failed:',error.message);return res.status(500).json({error:'Unable to create the account.'});
  }
});
app.post('/api/auth/login',authRateLimit,async(req,res)=>{
  if(!authPool)return res.status(503).json({error:'Accounts need a database connection first.'});
  const username=String(req.body?.username||'').trim().toLowerCase();
  const password=String(req.body?.password||'');
  try{
    await ensureAuthSchema();
    const result=await authPool.query('SELECT id,username,email,password_hash,role,display_name,bio,avatar_data,banner_data,presence_status,profile_effect FROM orvian_users WHERE username_lower=$1',[username]);
    const user=result.rows[0];
    if(!user||!await bcrypt.compare(password,user.password_hash))return res.status(401).json({error:'Incorrect username or password.'});
    await createSession(req,res,user.id);
    return res.json({user:publicUser(user)});
  }catch(error){console.error('Login failed:',error.message);return res.status(500).json({error:'Unable to sign in.'})}
});
app.post('/api/auth/logout',async(req,res)=>{
  const token=cookieValue(req,'orvian_session');
  res.setHeader('Set-Cookie',sessionCookie(req,'',0));
  if(authPool&&token)authPool.query('DELETE FROM orvian_sessions WHERE token_hash=$1',[tokenHash(token)]).catch(()=>{});
  res.json({ok:true});
});
const chatChannels=new Set(['general','introductions','announcements','rules']);
async function requireAccount(req,res,next){
  try{
    const user=await currentAuthUser(req);
    if(!user)return res.status(401).json({error:'Sign in to use Chat.'});
    req.authUser=user;next();
  }catch(error){console.error('Account check failed:',error.message);res.status(503).json({error:'Chat is temporarily unavailable.'})}
}

app.post('/api/account/heartbeat',requireAccount,async(req,res)=>{
  try{await authPool.query('UPDATE orvian_users SET last_seen=NOW() WHERE id=$1',[req.authUser.id]);res.json({ok:true})}
  catch(error){res.status(500).json({error:'Unable to update presence.'})}
});
app.patch('/api/account/profile',requireAccount,async(req,res)=>{
  const displayName=String(req.body?.displayName||'').trim();
  const bio=String(req.body?.bio||'').trim();
  const avatar=req.body?.avatar===null?null:String(req.body?.avatar||'');
  const banner=req.body?.banner===null?null:String(req.body?.banner||'');
  const status=String(req.body?.status||'online');
  const effect=String(req.body?.effect||'none');
  if(displayName.length<1||displayName.length>32)return res.status(400).json({error:'Display name must be 1–32 characters.'});
  if(bio.length>160)return res.status(400).json({error:'Bio must be 160 characters or less.'});
  if(avatar&&(!/^data:image\/(png|jpeg|webp);base64,/i.test(avatar)||avatar.length>250000))
    return res.status(400).json({error:'Profile picture must be a small PNG, JPEG, or WebP image.'});
  if(banner&&(!/^data:image\/(png|jpeg|webp);base64,/i.test(banner)||banner.length>500000))
    return res.status(400).json({error:'Banner must be a small PNG, JPEG, or WebP image.'});
  if(!['online','idle','dnd','invisible'].includes(status))return res.status(400).json({error:'Invalid status.'});
  if(!['none','silver','pulse','sparkle'].includes(effect))return res.status(400).json({error:'Invalid profile effect.'});
  try{
    const result=await authPool.query(`
      UPDATE orvian_users SET display_name=$1,bio=$2,avatar_data=$3,banner_data=$4,presence_status=$5,profile_effect=$6,last_seen=NOW()
      WHERE id=$7 RETURNING id,username,email,role,display_name,bio,avatar_data,banner_data,presence_status,profile_effect
    `,[displayName,bio,avatar,banner,status,effect,req.authUser.id]);
    res.json({user:publicUser(result.rows[0])});
  }catch(error){console.error('Profile update failed:',error.message);res.status(500).json({error:'Unable to save profile.'})}
});
app.get('/api/chat/members',requireAccount,async(_req,res)=>{
  try{
    const result=await authPool.query(`
      SELECT id,username,role,display_name,bio,avatar_data,banner_data,presence_status,profile_effect,last_seen,
        CASE
          WHEN presence_status='invisible' THEN 'offline'
          WHEN last_seen>NOW()-INTERVAL '2 minutes' THEN presence_status
          ELSE 'offline'
        END AS effective_status
      FROM orvian_users ORDER BY
        CASE WHEN role='owner' THEN 0 ELSE 1 END,
        CASE WHEN last_seen>NOW()-INTERVAL '2 minutes' AND presence_status<>'invisible' THEN 0 ELSE 1 END,
        COALESCE(display_name,username)
    `);
    res.json({members:result.rows.map(member=>({
      id:String(member.id),username:member.username,displayName:member.display_name||member.username,
      role:member.role,bio:member.bio||'',avatar:member.avatar_data||null,banner:member.banner_data||null,
      status:member.effective_status,effect:member.profile_effect||'none'
    }))});
  }catch(error){console.error('Members fetch failed:',error.message);res.status(500).json({error:'Unable to load members.'})}
});
app.get('/api/chat/messages',requireAccount,async(req,res)=>{
  const channel=String(req.query.channel||'general');
  if(!chatChannels.has(channel))return res.status(400).json({error:'Unknown channel.'});
  try{
    const result=await authPool.query(`
      SELECT m.id,m.user_id,m.body,m.created_at,m.edited_at,m.attachment_data,m.attachment_url,u.username,u.role
      FROM orvian_chat_messages m JOIN orvian_users u ON u.id=m.user_id
      WHERE m.channel=$1 ORDER BY m.created_at DESC LIMIT 100
    `,[channel]);
    res.json({messages:result.rows.reverse().map(message=>({...message,id:String(message.id),user_id:String(message.user_id),canModify:String(message.user_id)===String(req.authUser.id)}))});
  }catch(error){console.error('Chat fetch failed:',error.message);res.status(500).json({error:'Unable to load messages.'})}
});
app.post('/api/chat/messages',requireAccount,async(req,res)=>{
  const channel=String(req.body?.channel||'');
  const body=String(req.body?.body||'').trim();
  const attachmentData=String(req.body?.attachmentData||'');
  const attachmentUrl=String(req.body?.attachmentUrl||'');
  if(!chatChannels.has(channel))return res.status(400).json({error:'Unknown channel.'});
  if((!body&&!attachmentData&&!attachmentUrl)||body.length>1000)return res.status(400).json({error:'Add a message or image; text is limited to 1000 characters.'});
  if(attachmentData&&(!/^data:image\/(png|jpeg|webp|gif);base64,/i.test(attachmentData)||attachmentData.length>350000))return res.status(400).json({error:'Image must be PNG, JPEG, WebP, or GIF under 250 KB.'});
  if(attachmentUrl){try{const parsed=new URL(attachmentUrl);if(parsed.protocol!=='https:')throw new Error()}catch{return res.status(400).json({error:'GIF URL must be a valid HTTPS address.'})}}
  if((channel==='announcements'||channel==='rules')&&req.authUser.role!=='owner')
    return res.status(403).json({error:'Only the Owner can post in this channel.'});
  try{
    const result=await authPool.query(`
      INSERT INTO orvian_chat_messages(channel,user_id,body,attachment_data,attachment_url) VALUES($1,$2,$3,$4,$5)
      RETURNING id,body,attachment_data,attachment_url,created_at
    `,[channel,req.authUser.id,body,attachmentData||null,attachmentUrl||null]);
    res.status(201).json({message:{...result.rows[0],id:String(result.rows[0].id),username:req.authUser.username,role:req.authUser.role}});
  }catch(error){console.error('Chat post failed:',error.message);res.status(500).json({error:'Unable to send message.'})}
});


app.patch('/api/chat/messages/:id',requireAccount,async(req,res)=>{
  const id=String(req.params.id||'');
  const body=String(req.body?.body||'').trim();
  if(!/^\d+$/.test(id))return res.status(400).json({error:'Invalid message.'});
  if(!body||body.length>1000)return res.status(400).json({error:'Messages must be 1–1000 characters.'});
  try{
    const result=await authPool.query(`
      UPDATE orvian_chat_messages SET body=$1,edited_at=NOW()
      WHERE id=$2 AND user_id=$3 RETURNING id,body,created_at,edited_at
    `,[body,id,req.authUser.id]);
    if(!result.rowCount)return res.status(404).json({error:'Message not found or does not belong to you.'});
    res.json({message:{...result.rows[0],id:String(result.rows[0].id)}});
  }catch(error){console.error('Chat edit failed:',error.message);res.status(500).json({error:'Unable to edit message.'})}
});
app.delete('/api/chat/messages/:id',requireAccount,async(req,res)=>{
  const id=String(req.params.id||'');
  if(!/^\d+$/.test(id))return res.status(400).json({error:'Invalid message.'});
  try{
    const result=await authPool.query('DELETE FROM orvian_chat_messages WHERE id=$1 AND user_id=$2 RETURNING id',[id,req.authUser.id]);
    if(!result.rowCount)return res.status(404).json({error:'Message not found or does not belong to you.'});
    res.status(204).end();
  }catch(error){console.error('Chat delete failed:',error.message);res.status(500).json({error:'Unable to delete message.'})}
});


const gameIconSources=new Map([["lichess","https://lichess1.org/assets/logo/lichess-favicon-32.png"],["tetrio","https://tetr.io/res/favicon.ico"],["skribbl","https://skribbl.io/favicon.png"],["agar","https://agar.io/favicon.ico"],["slither","https://slither.io/favicon.ico"],["shellshock","https://shellshock.io/favicon.ico"],["jstris","https://jstris.jezevec10.com/favicon.ico"],["alchemy","https://littlealchemy2.com/favicon.ico"],["quickdraw","https://quickdraw.withgoogle.com/favicon.ico"],["minesweeper","https://minesweeper.online/favicon.ico"],["cardgames","https://cardgames.io/favicon.ico"],["neal","https://neal.fun/favicons/favicon.ico"],["chess","https://www.chess.com/bundles/web/favicons/favicon-32x32.png"],["geoguessr","https://www.geoguessr.com/favicon.ico"],["itch","https://itch.io/favicon.ico"],["poki","https://poki.com/favicon.ico"],["crazygames","https://www.crazygames.com/favicon.ico"],["newgrounds","https://www.newgrounds.com/favicon.ico"],["gamesnacks","https://gamesnacks.com/favicon.ico"],["coolmath","https://www.coolmathgames.com/themes/custom/coolmath/favicon.ico"],["kongregate","https://www.kongregate.com/favicon.ico"],["sprintcoach","https://sprintcoach.sbs/logo.png"]]);
app.get('/api/game-icon/:key',async(req,res)=>{
  const source=gameIconSources.get(String(req.params.key||''));
  if(!source)return res.status(404).end();
  const domain=new URL(source).hostname.replace(/^www\./,'');
  const candidates=[source,`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`];
  let lastError='No icon source responded';
  for(const candidate of candidates){
    try{
      const upstream=await fetch(candidate,{redirect:'follow',headers:{'User-Agent':'Mozilla/5.0 Orvian/1.0','Accept':'image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5'},signal:AbortSignal.timeout(8000)});
      if(!upstream.ok)throw new Error('Icon source returned '+upstream.status);
      const type=String(upstream.headers.get('content-type')||'').split(';')[0];
      if(!type.startsWith('image/'))throw new Error('Icon source did not return an image');
      const bytes=Buffer.from(await upstream.arrayBuffer());
      if(!bytes.length||bytes.length>524288)throw new Error('Icon response was empty or too large');
      res.setHeader('Content-Type',type);res.setHeader('Cache-Control','public,max-age=86400,stale-while-revalidate=604800');
      return res.send(bytes);
    }catch(error){lastError=error.message}
  }
  console.warn('Game icon failed:',req.params.key,lastError);
  return res.status(404).end();
});

app.get('/health',(_req,res)=>{
  res.setHeader('Cache-Control','no-store');
  res.json({status:'ok',proxy:'scramjet',accounts:Boolean(authPool),uptimeSeconds:Math.floor(process.uptime())});
});
app.use('/scram/',express.static(scramjetPath));
app.use('/libcurl/',express.static(libcurlPath));
app.use('/baremux/',express.static(baremuxPath));
app.use(express.static(path.join(directory,'public')));
// Do not return Orvian's homepage for an unhandled proxy navigation.
// Doing so nests Orvian inside its own viewer instead of showing an error.
app.use((req,res,next)=>{
  if(req.path.startsWith('/scramjet/')||req.path.startsWith('/service/')||
     req.path.startsWith('/~/')||req.path.startsWith('/scram/')||
     req.path.startsWith('/baremux/')||req.path.startsWith('/libcurl/')||
     req.path.startsWith('/wisp/')){
    return res.status(404).type('text/plain').send('Embedded browser route was not handled by Scramjet. Reload Orvian and try again.');
  }
  next();
});
app.get('*',(_req,res,next)=>{
  res.sendFile(path.join(directory,'public/index.html'),error=>{if(error)next(error)});
});
app.use((error,_req,res,_next)=>{
  console.error('Request failed:',error.message);
  if(res.headersSent)return res.end();
  res.status(500).json({status:'error',message:'Internal server error'});
});
const server=http.createServer(app);
server.on('upgrade',(req,socket,head)=>{
  if(req.url?.split('?')[0]==='/wisp/'){
    try{wisp.routeRequest(req,socket,head)}
    catch(error){console.error('Wisp upgrade failed:',error.message);socket.destroy()}
  }else socket.destroy();
});
server.on('error',error=>console.error('HTTP server error:',error.message));
server.listen(port,'0.0.0.0',()=>console.log('Orvian (Scramjet) listening on '+port));
function shutdown(signal){console.log(signal+' received; shutting down');server.close()}
process.on('SIGTERM',()=>shutdown('SIGTERM'));
process.on('SIGINT',()=>shutdown('SIGINT'));
