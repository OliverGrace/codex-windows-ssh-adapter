import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {pipeClient} from './helpers.mjs';
import {clientScope,scopedClientName} from '../src/client-identity.mjs';
import {capabilityProfile,activeSession,saveActiveSession} from '../src/session-profiles.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const start = () => pipeClient(process.execPath,[fileURLToPath(new URL('./mock-bridge.mjs',import.meta.url))]);
test('capability conflicts retry once with a stable isolated identity and preserve params',async()=>{
  const scope='profile-scope',capabilities={experimentalApi:true,requestAttestation:false};
  const c=await pipeClient(process.execPath,[fileURLToPath(new URL('./mock-bridge.mjs',import.meta.url)),scope,'migrate']);
  try {
    const result=await c.rpc('initialize',{clientInfo:{name:'Codex Desktop',title:'Test',version:'new'},capabilities});
    assert.equal(result.attempts,2);
    assert.equal(result.clientInfo.name,capabilityProfile(scopedClientName('Codex Desktop',scope),capabilities));
    assert.equal(result.clientInfo.title,'Test');assert.deepEqual(result.capabilities,capabilities);
    assert.notEqual(result.clientInfo.name,capabilityProfile(scopedClientName('Codex Desktop','other-scope'),capabilities));
  } finally {await c.close();}
  for(const mode of ['always-reject','other-error']) {
    const c=await pipeClient(process.execPath,[fileURLToPath(new URL('./mock-bridge.mjs',import.meta.url)),scope,mode]);
    try {await assert.rejects(c.rpc('initialize',{clientInfo:{name:'Codex Desktop'},capabilities},3000),mode==='other-error'?/unrelated/:/capabilities changed/);}
    finally {await c.close();}
  }
});
test('restart selection persists only an identity in the same installation scope',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'adapter-profiles-'));
  try {
    const base=scopedClientName('Codex Desktop','scope'),selected=capabilityProfile(base,{newFeature:true});
    assert.equal(activeSession(root,base),base);
    saveActiveSession(root,base,selected);assert.equal(activeSession(root,base),selected);
    assert.ok(selected.length<=200);
    assert.throws(()=>saveActiveSession(root,base,capabilityProfile(scopedClientName('Codex Desktop','other'),{})),/Invalid/);
    saveActiveSession(root,base,base);assert.equal(activeSession(root,base),base);
  } finally {assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));fs.rmSync(root,{recursive:true,force:true});}
});
test('client scope normalizes Windows names and supports a stable configured installation ID', () => {
  const scope=clientScope({},'C:\\fixtures\\adapter','windows-dev','test-machine');
  assert.equal(scope,clientScope({},'C:\\FIXTURES\\ADAPTER','WINDOWS-DEV','TEST-MACHINE'));
  assert.notEqual(scope,clientScope({},'C:\\fixtures\\other','windows-dev','test-machine'));
  assert.notEqual(scope,clientScope({},'C:\\fixtures\\adapter','other-host','test-machine'));
  assert.notEqual(scope,clientScope({},'C:\\fixtures\\adapter','windows-dev','other-machine'));
  assert.equal(clientScope({clientId:'installation-one'},'C:\\fixtures\\old','host','old-machine'),clientScope({clientId:'installation-one'},'C:\\fixtures\\new','host','new-machine'));
  for(const clientId of ['',null,{},42])assert.throws(()=>clientScope({clientId},'C:\\fixtures','host'),/clientId/);
  const long='a'.repeat(200),name=scopedClientName(long,scope);
  assert.ok(name.length<=200);
  assert.notEqual(name,scopedClientName(long.slice(0,-1)+'b',scope));
  assert.equal(scopedClientName('Desktop',''),'Desktop');
  assert.equal(scopedClientName('a'.repeat(201),scope),'a'.repeat(201),'do not hide an invalid upstream identity');
});
test('Desktop identity is stable across reconnects and isolated by installation and SSH target', async () => {
  async function initialize(scope) {
    const c=await pipeClient(process.execPath,[fileURLToPath(new URL('./mock-bridge.mjs',import.meta.url)),scope]);
    try { return await c.rpc('initialize',{clientInfo:{name:'Codex Desktop',version:'test',title:'Desktop'},capabilities:{experimentalApi:true}}); }
    finally { await c.close(); }
  }
  const first=await initialize('machine-a/host-a'), reconnect=await initialize('machine-a/host-a');
  assert.deepEqual(first,reconnect);
  assert.notEqual(first.clientInfo.name,(await initialize('machine-b/host-a')).clientInfo.name);
  assert.notEqual(first.clientInfo.name,(await initialize('machine-a/host-b')).clientInfo.name);
  assert.deepEqual({...first.clientInfo,name:'Codex Desktop'},{name:'Codex Desktop',version:'test',title:'Desktop'});
  assert.deepEqual(first.capabilities,{experimentalApi:true});
});
test('WebSocket/JSONL bridge preserves concurrent calls, Unicode, paths and large messages', {timeout:15000}, async () => {
  const c = await start();
  try {
    const params={path:"C:\\fixtures\\项目 空格\\a'b.txt",text:'中文\r\n'+ 'x'.repeat(1000000)};
    assert.deepEqual(await c.rpc('echo',params),params);
    assert.deepEqual(await Promise.all(Array.from({length:20},(_,i)=>c.rpc('echo',{i}))),Array.from({length:20},(_,i)=>({i})));
    const pong=once(c.ws,'pong'); c.ws.ping('test-heartbeat'); assert.equal((await pong)[0].toString(),'test-heartbeat');
    const fragmented=once(c.ws,'message'); c.ws.send('{"id":101,"method":"echo",', {fin:false}); c.ws.send('"params":{"fragmented":true}}',{fin:true});
    assert.deepEqual(JSON.parse((await fragmented)[0]).result,{fragmented:true});
    const request=once(c.ws,'message'); c.notify('approval',{}); const m=JSON.parse((await request)[0]);
    assert.equal(m.method,'item/commandExecution/requestApproval'); assert.equal(m.id,'server-approval-1');
    const response=once(c.ws,'message'); c.ws.send(JSON.stringify({id:m.id,result:{decision:'decline'}}));
    assert.deepEqual(JSON.parse((await response)[0]).result,{decision:'decline'});
  } finally {await c.close();}
});
test('invalid upstream JSON fails instead of silently corrupting the protocol', {timeout:10000}, async()=>{
  const c=await start(); c.notify('bad-output',{}); const result=await c.closed; assert.notEqual(result.code,0);
});
test('remote process failure propagates', {timeout:10000}, async()=>{
  const c=await start(); c.notify('fail',{}); assert.equal((await c.closed).code,23);
});
