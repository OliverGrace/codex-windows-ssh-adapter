import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {WebSocket} from 'ws';
import {scopedClientName} from '../src/client-identity.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<100;i++){if(fn())return;await sleep(30);}throw Error('Timeout');}
test('durable host authenticates, preserves sessions, replays approvals and isolates request IDs',{timeout:15000},async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'codex-adapter-unit-'));
  fs.writeFileSync(path.join(dir,'token'),'unit-test-only');
  fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify({codex:process.execPath,arguments:[fileURLToPath(new URL('./durable-mock.mjs',import.meta.url))]}));
  const child=spawn(process.execPath,[fileURLToPath(new URL('../remote/host.mjs',import.meta.url))],{env:{...process.env,CODEX_ADAPTER_STATE:dir},windowsHide:true,stdio:['ignore','ignore','pipe']});
  child.stderr.resume();const closed=once(child,'close');const clients=[];
  try {
    await until(()=>fs.existsSync(path.join(dir,'status.json')));const {port}=JSON.parse(fs.readFileSync(path.join(dir,'status.json')));
    const rejected=new WebSocket(`ws://127.0.0.1:${port}/rpc`);await assert.rejects(once(rejected,'open'),/401/);
    async function connect(name='durable_test',notify=true) {
      const ws=new WebSocket(`ws://127.0.0.1:${port}/rpc`,{headers:{Authorization:'Bearer unit-test-only'}});ws.on('error',()=>{});clients.push(ws);
      const messages=[];ws.on('message',data=>messages.push(JSON.parse(data)));await once(ws,'open');let id=0;
      const c={ws,messages,send:m=>ws.send(JSON.stringify(m)),async rpc(method,params){const n=++id;c.send({id:n,method,params});await until(()=>messages.some(m=>m.id===n&&!m.method));const m=messages.find(m=>m.id===n&&!m.method);if(m.error)throw Error(m.error.message);return m.result;},async close(){ws.close();await once(ws,'close');}};
      c.init=await c.rpc('initialize',{clientInfo:{name,version:'unit'},capabilities:{experimentalApi:true}});if(notify)c.send({method:'initialized'});return c;
    }
    let a=await connect();const pid=a.init.pid;
    a.send({id:2,method:'delay',params:{old:true}});a.send({id:3,method:'approval'});await a.close();await sleep(450);
    a=await connect('durable_test',false);assert.equal(a.init.pid,pid);
    assert.deepEqual(await a.rpc('echo',{new:true}),{new:true});
    await until(()=>a.messages.some(m=>m.method==='test/done')&&a.messages.some(m=>m.id==='approval-1'));
    assert.equal(await a.rpc('count',{}),1,'initialized must be forwarded only once');
    a.send({id:'approval-1',result:{decision:'decline'}});await until(()=>a.messages.some(m=>m.method==='test/approval'));
    const b=await connect('separate_test');assert.notEqual(b.init.pid,pid);await b.close();
    const taken=await connect();assert.equal(taken.init.pid,pid);await until(()=>a.ws.readyState===WebSocket.CLOSED);await taken.close();
    const leftName=scopedClientName('Codex Desktop','installation-left/target');
    const left=await connect(leftName), right=await connect(scopedClientName('Codex Desktop','installation-right/target'));
    assert.notEqual(left.init.pid,right.init.pid);
    assert.equal(left.ws.readyState,WebSocket.OPEN,'another Desktop must not evict this installation');
    const resumed=await connect(leftName);assert.equal(resumed.init.pid,left.init.pid);
    await until(()=>left.ws.readyState===WebSocket.CLOSED);
    assert.equal(right.ws.readyState,WebSocket.OPEN,'reconnecting one installation must preserve the other');
    await resumed.close();await right.close();
  } finally {
    for(const ws of clients)ws.terminate();child.kill();await closed;
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
