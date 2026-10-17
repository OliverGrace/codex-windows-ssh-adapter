// Durable per-client stdio sessions. SSH processes never own the Codex child.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {WebSocketServer, WebSocket} from 'ws';

const dir = process.env.CODEX_ADAPTER_STATE;
if (!dir) throw new Error('Missing private state directory');
const settings = JSON.parse(fs.readFileSync(path.join(dir,'settings.json')));
const token = fs.readFileSync(path.join(dir,'token'),'utf8').trim();
const sessions = new Map(), limit = 16*1024*1024, queueLimit = 32*1024*1024;
function send(ws,m) { if(ws?.readyState===WebSocket.OPEN) ws.send(JSON.stringify(m)); }
function error(ws,id,message) {send(ws,{id,error:{code:-32000,message}});}
function state() {
  const value={version:settings.version??'0.3.0',pid:process.pid,port:server.address()?.port,startedAt,
    sessions:[...sessions.values()].map(s=>({name:s.name,pid:s.child.pid,attached:s.ws?.readyState===WebSocket.OPEN,queuedBytes:s.bytes,droppedNotifications:s.dropped}))};
  fs.writeFileSync(path.join(dir,'status.tmp'),JSON.stringify(value));
  fs.renameSync(path.join(dir,'status.tmp'),path.join(dir,'status.json'));
}
const startedAt=new Date().toISOString();
const server=new WebSocketServer({host:'127.0.0.1',port:0,maxPayload:limit,perMessageDeflate:false,
  verifyClient(info,done) {
    const given=Buffer.from(info.req.headers.authorization??''), expected=Buffer.from('Bearer '+token);
    done(given.length===expected.length&&crypto.timingSafeEqual(given,expected),401,'Unauthorized');
  }});
server.on('listening',state);
server.on('error',()=>process.exit(1));
const statusTimer=setInterval(state,5000);statusTimer.unref();
function activate(s) {
  if(s.ready)return;
  if(!s.initialized){s.child.stdin.write('{"method":"initialized"}\n');s.initialized=true;}
  s.ready=true;
  for(const item of s.queue)send(s.ws,item.m);s.queue=[];s.bytes=0;
  for(const request of s.requests.values())send(s.ws,request);
  state();
}

function createSession(name,params,ws,id) {
  const bypass=[process.env.NO_PROXY,process.env.no_proxy,'localhost','127.0.0.1','::1'].filter(Boolean).join(',');
  const child=spawn(settings.codex,settings.arguments??['-c','features.code_mode_host=true','app-server','--stdio'],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,NO_PROXY:bypass,no_proxy:bypass}});
  const s={name,child,params,ws,ready:false,initializing:true,initialized:false,initId:id,next:0,pending:new Map(),requests:new Map(),queue:[],bytes:0,dropped:0,buffer:Buffer.alloc(0)};
  sessions.set(name,s);
  // Avoid storing command output, prompts, MCP tokens, or native stderr in logs.
  child.stderr.resume();
  child.stdin.on('error',()=>{});
  child.once('error',()=>{error(s.ws,s.initId,'Cannot start native Codex');s.ws?.close(1011);sessions.delete(name);state();});
  child.once('close',()=>{s.ws?.close(1011,'Native Codex exited');sessions.delete(name);state();});
  child.stdout.on('data',chunk=>{
    s.buffer=Buffer.concat([s.buffer,chunk]);
    for (;;) {
      const at=s.buffer.indexOf(10);if(at<0)break;
      if(at>limit){child.kill();return;}
      const line=s.buffer.subarray(0,at).toString('utf8');s.buffer=s.buffer.subarray(at+1);
      if(!line.trim())continue;
      let m;try{m=JSON.parse(line);}catch{child.kill();return;}
      if(m.id==='adapter:init'&&!m.method) {
        s.initializing=false;
        if(m.error){send(s.ws,{...m,id:s.initId});s.ws?.close(1011);child.kill();return;}
        s.initResult=m.result;send(s.ws,{id:s.initId,result:m.result});
        if(s.ws?.readyState===WebSocket.OPEN)activate(s);continue;
      }
      if(!m.method&&m.id!==undefined) {
        const p=s.pending.get(m.id);s.pending.delete(m.id);
        if(p&&p.ws===s.ws)send(p.ws,{...m,id:p.id});
      } else if(m.method&&m.id!==undefined) {
        s.requests.set(m.id,m);if(s.ready)send(s.ws,m);
      } else if(s.ready&&s.ws?.readyState===WebSocket.OPEN) send(s.ws,m);
      else {
        const size=Buffer.byteLength(line);s.queue.push({m,size});s.bytes+=size;
        while(s.bytes>queueLimit){s.bytes-=s.queue.shift().size;s.dropped++;}
      }
    }
    if(s.buffer.length>limit)child.kill();
  });
  child.stdin.write(JSON.stringify({id:'adapter:init',method:'initialize',params})+'\n');
  return s;
}
server.on('connection',ws=>{
  let s;
  ws.on('error',()=>{});
  const timer=setTimeout(()=>ws.close(1008,'Initialize required'),15000);
  ws.on('message',(data,binary)=>{
    let m;try{if(binary)throw Error();m=JSON.parse(data);}catch{ws.close(1008,'Invalid JSON');return;}
    if(!m||typeof m!=='object'||Array.isArray(m)){ws.close(1008);return;}
    if(m.method==='initialize') {
      if(s){error(ws,m.id,'Already initialized');return;}
      const name=m.params?.clientInfo?.name;
      if(typeof name!=='string'||name.length>200){error(ws,m.id,'Valid client name required');return;}
      s=sessions.get(name);
      if(s) {
        if(s.initializing){error(ws,m.id,'Previous initialization still in progress; retry');s=undefined;return;}
        if(JSON.stringify(s.params.capabilities??{})!==JSON.stringify(m.params.capabilities??{})) {
          error(ws,m.id,'Client capabilities changed; finish tasks and restart the adapter service');s=undefined;return;
        }
        // One active attachment per client identity; a reconnect replaces only its transport.
        s.ws?.close(1012,'Reattached');s.ws=ws;s.ready=false;
        send(ws,{id:m.id,result:s.initResult});
        activate(s);
      } else {
        if(sessions.size>=12){error(ws,m.id,'Durable session limit reached; stop unused sessions via maintenance');return;}
        s=createSession(name,m.params,ws,m.id);
      }
      clearTimeout(timer);state();return;
    }
    if(!s||s.ws!==ws){error(ws,m.id??null,'Initialize first');return;}
    if(m.method==='initialized') {
      activate(s);return;
    }
    if(m.method&&m.id!==undefined) {
      if(s.pending.size>=4096){error(ws,m.id,'Too many outstanding requests');return;}
      const id='adapter:'+ ++s.next;s.pending.set(id,{ws,id:m.id});m={...m,id};
    } else if(!m.method&&m.id!==undefined) s.requests.delete(m.id);
    if(!s.child.stdin.write(JSON.stringify(m)+'\n')){ws.pause();s.child.stdin.once('drain',()=>ws.resume());}
  });
  ws.on('close',()=>{clearTimeout(timer);if(s?.ws===ws){s.ws=null;s.ready=false;state();}});
});
