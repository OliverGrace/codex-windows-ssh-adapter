// Opt-in: only terminate this test's unique session trees, never Desktop sessions.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {pipeClient,proxyCommand} from './helpers.mjs';
import {liveTarget} from './live-target.mjs';
import {inspectDesktop} from '../scripts/desktop-compat.mjs';
import {clientScope,scopedClientName} from '../src/client-identity.mjs';
import {restartSession} from '../src/restart-session.mjs';
import {runSsh,psCommand} from '../src/hosts.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)).replace(/[\\/]$/,'');
const cfg=JSON.parse(fs.readFileSync(new URL('../adapter.config.json',import.meta.url)));
const host=liveTarget(),prefix=['-T','-o','BatchMode=yes','-o','ConnectTimeout=10',host];
const desktop=inspectDesktop(),id=crypto.randomUUID().replaceAll('-','');
const names=['restart_'+id,'control_'+id];
const scope=clientScope(cfg,root,host),scoped=names.map(n=>scopedClientName(n,scope));
async function remote(script){const r=await runSsh(cfg,prefix,psCommand("$ProgressPreference='SilentlyContinue'; "+script));assert.equal(r.code,0,r.stderr);return r.stdout;}
async function status(){return JSON.parse(await remote("Get-Content -Raw (Join-Path $env:LOCALAPPDATA 'CodexWindowsSshAdapter\\status.json')"));}
async function connect(name){
 const marker=crypto.randomBytes(8),c=await pipeClient(fileURLToPath(new URL('../bin/ssh.exe',import.meta.url)),[...prefix,desktop.wrap(proxyCommand,marker)],marker);
 try {c.init=await c.rpc('initialize',{clientInfo:{name,version:'test'},capabilities:{experimentalApi:true}});c.notify('initialized');return c;}
 catch(e){await c.close();throw e;}
}
async function until(fn){for(let i=0;i<100;i++){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw Error('Condition timed out');}
let a,b,replacement;
try {
 a=await connect(names[0]);b=await connect(names[1]);
 const before=await status(),old=before.sessions.find(s=>s.name===scoped[0]),control=before.sessions.find(s=>s.name===scoped[1]);
 assert.ok(old?.pid&&control?.pid);
 const processId='restart-child-'+id;
 a.rpc('command/exec',{processId,streamStdoutStderr:true,command:['pwsh.exe','-NoProfile','-Command',"[Console]::WriteLine('RESTART_CHILD_PID='+$PID); Start-Sleep -Seconds 90"],timeoutMs:120000},125000).catch(()=>{});
 let childPid;
 await until(()=>{for(const m of a.messages){if(m.method==='command/exec/outputDelta'&&m.params?.processId===processId){const text=Buffer.from(m.params.deltaBase64??'','base64').toString();const match=/RESTART_CHILD_PID=(\d+)/.exec(text);if(match)childPid=Number(match[1]);}}return !!childPid;});
 const closed=once(a.ws,'close');
 await restartSession(cfg,prefix,scoped[0]);await closed;
 const after=await status();assert.equal(after.pid,before.pid);assert.equal(after.sessions.find(s=>s.name===scoped[1]).pid,control.pid);
 assert.ok(!after.sessions.some(s=>s.name===scoped[0]));
 assert.equal((await remote(`@(Get-Process -Id ${childPid} -ErrorAction SilentlyContinue).Count`)).trim(),'0');
 assert.equal((await b.rpc('command/exec',{command:['cmd.exe','/d','/c','echo CONTROL_OK'],timeoutMs:10000})).stdout.trim(),'CONTROL_OK');
 replacement=await connect(names[0]);const fresh=await status();assert.notEqual(fresh.sessions.find(s=>s.name===scoped[0]).pid,old.pid);
 const installed=(await remote('codex.cmd --version')).trim().replace('codex-cli ','');
 assert.ok(replacement.init.userAgent.includes('/'+installed+' '));
 console.log('PASS targeted restart replaces the CLI process with the installed version and ends its command tree');
 console.log('PASS host and another client session remain alive and usable');
} finally {
 for(const c of [a,b,replacement])if(c)await c.close();
 for(const name of scoped)await restartSession(cfg,prefix,name);
}
