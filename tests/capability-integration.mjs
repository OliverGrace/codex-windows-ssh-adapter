import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {liveTarget} from './live-target.mjs';
import {pipeClient,proxyCommand} from './helpers.mjs';
import {inspectDesktop} from '../scripts/desktop-compat.mjs';
import {clientScope,scopedClientName} from '../src/client-identity.mjs';
import {capabilityProfile,activeSession} from '../src/session-profiles.mjs';
import {runSsh} from '../src/hosts.mjs';
import {restartSession} from '../src/restart-session.mjs';

const host=liveTarget(),root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cfg=JSON.parse(fs.readFileSync(path.join(root,'adapter.config.json'))),desktop=inspectDesktop();
const name='capability_test_'+crypto.randomUUID().replaceAll('-','');
const base=scopedClientName(name,clientScope(cfg,root,host));
const original={experimentalApi:true},changed={experimentalApi:true,optOutNotificationMethods:['turn/diff/updated']};
const profile=capabilityProfile(base,changed),prefix=['-T','-o','BatchMode=yes','-o','ConnectTimeout=12',host];
async function status() {
  const r=await runSsh(cfg,prefix,'cmd.exe /d /c type "%LOCALAPPDATA%\\CodexWindowsSshAdapter\\status.json"');
  assert.equal(r.code,0);return JSON.parse(r.stdout);
}
async function connect(capabilities) {
  const marker=crypto.randomBytes(8),client=await pipeClient(path.join(root,'bin','ssh.exe'),[...prefix,desktop.wrap(proxyCommand,marker)],marker);
  try {await client.rpc('initialize',{clientInfo:{name,version:'test'},capabilities});client.notify('initialized');return client;}
  catch(error){await client.close();throw error;}
}
let client;
try {
  client=await connect(original);const before=await status(),old=before.sessions.find(s=>s.name===base);assert.ok(old);
  await client.close();client=await connect(changed);
  const after=await status(),next=after.sessions.find(s=>s.name===profile);assert.ok(next);
  assert.equal(after.pid,before.pid);assert.equal(after.sessions.find(s=>s.name===base).pid,old.pid);assert.notEqual(next.pid,old.pid);
  assert.equal(activeSession(root,base),profile);
  const command=await client.rpc('command/exec',{command:['cmd.exe','/d','/c','hostname'],timeoutMs:10000});assert.equal(command.exitCode,0);
  await client.close();client=await connect(changed);
  assert.equal((await status()).sessions.find(s=>s.name===profile).pid,next.pid);
  await client.close();client=null;
  await restartSession(cfg,prefix,activeSession(root,base));
  const restarted=await status();assert.ok(!restarted.sessions.some(s=>s.name===profile));
  assert.equal(restarted.sessions.find(s=>s.name===base).pid,old.pid);assert.equal(restarted.pid,before.pid);
  console.log('PASS changed capabilities connect and reconnect; restart selects the new session and preserves the old process');
} finally {
  if(client)await client.close();
  for(const selected of [profile,base])await restartSession(cfg,prefix,selected);
  const record=path.join(root,'work','active-sessions',crypto.createHash('sha256').update(base).digest('hex')+'.json');
  if(fs.existsSync(record))fs.unlinkSync(record);
}
