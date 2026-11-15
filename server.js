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
app.use(express.json({limit:'10kb'}));
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
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS orvian_sessions (
      token_hash CHAR(64) PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES orvian_users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS orvian_sessions_expiry_idx ON orvian_sessions(expires_at);
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
    SELECT u.id,u.username,u.email FROM orvian_sessions s
    JOIN orvian_users u ON u.id=s.user_id
    WHERE s.token_hash=$1 AND s.expires_at>NOW()
  `,[tokenHash(token)]);
  return result.rows[0]||null;
}
function publicUser(user){return user?{id:String(user.id),username:user.username,email:user.email||null}:null}
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
    const result=await authPool.query('SELECT id,username,email,password_hash FROM orvian_users WHERE username_lower=$1',[username]);
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
