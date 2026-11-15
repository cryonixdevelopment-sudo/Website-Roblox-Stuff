import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import express from 'express';
import {server as wisp,logging} from '@mercuryworkshop/wisp-js/server';
import {scramjetPath} from '@mercuryworkshop/scramjet/path';
import {libcurlPath} from '@mercuryworkshop/libcurl-transport';
import {epoxyPath} from '@mercuryworkshop/epoxy-transport';
import {baremuxPath} from '@mercuryworkshop/bare-mux/node';

const directory=path.dirname(fileURLToPath(import.meta.url));
const app=express();
const port=Number(process.env.PORT)||3000;
app.disable('x-powered-by');
logging.set_level(logging.NONE);
Object.assign(wisp.options,{allow_udp_streams:false});
app.use((_req,res,next)=>{
  res.setHeader('Cross-Origin-Opener-Policy','same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
  next();
});
app.get('/health',(_req,res)=>{
  res.setHeader('Cache-Control','no-store');
  res.json({status:'ok',proxy:'scramjet',uptimeSeconds:Math.floor(process.uptime())});
});
app.use('/scram/',express.static(scramjetPath));
app.use('/libcurl/',express.static(libcurlPath));
app.use('/epoxy/',express.static(epoxyPath));
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
