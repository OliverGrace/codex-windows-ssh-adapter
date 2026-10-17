import {liveTarget, remoteTemp} from './live-target.mjs';
const liveHost = liveTarget();
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {pipeClient,proxyCommand} from './helpers.mjs';
import {inspectDesktop} from '../scripts/desktop-compat.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),cfg=JSON.parse(fs.readFileSync(path.join(root,'adapter.config.json'))),desktop=inspectDesktop();
async function connect(){const marker=crypto.randomBytes(8);const c=await pipeClient(path.join(root,'bin','ssh.exe'),['-T','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes',liveHost,desktop.wrap(proxyCommand,marker)],marker);await c.rpc('initialize',{clientInfo:{name:'codex_adapter_agent_durable',version:'0.2.0'},capabilities:{experimentalApi:true}});c.notify('initialized');return c;}
async function waitFor(fn,timeout=120000){const start=Date.now();while(Date.now()-start<timeout){const value=fn();if(value)return value;await new Promise(r=>setTimeout(r,100));}throw Error('Agent test timed out');}
let c=await connect();
try {
  const started=await c.rpc('thread/start',{ephemeral:true,cwd:await remoteTemp(c),baseInstructions:'Read-only transport test. Execute only the exact requested command with your default shell. Do not browse, modify files, delegate, or run any other commands. Return output.'});
  const threadId=started.thread.id;
  await c.rpc('turn/start',{threadId,input:[{type:'text',text:"Run exactly this command once using your default execution shell, without starting another shell explicitly: Start-Sleep -Seconds 10; [Console]::WriteLine('AGENT_SURVIVED_DISCONNECT'); $PSVersionTable.PSVersion.ToString(). Return the output and do nothing else.",text_elements:[]}]});
  await waitFor(()=>c.messages.find(m=>m.method==='item/started'&&m.params?.threadId===threadId&&m.params?.item?.type==='commandExecution'));
  console.log('Agent command started; forcibly disconnecting SSH for 15 seconds');
  c.child.kill();await c.closed;c=null;
  await new Promise(r=>setTimeout(r,15000));c=await connect();
  const completed=await waitFor(()=>c.messages.find(m=>m.method==='turn/completed'&&m.params?.threadId===threadId));
  assert.equal(completed.params.turn.status,'completed');
  const item=c.messages.find(m=>m.method==='item/completed'&&m.params?.threadId===threadId&&m.params.item.type==='commandExecution')?.params.item;
  assert.ok(item?.aggregatedOutput.includes('AGENT_SURVIVED_DISCONNECT'));assert.ok(item.command.includes('pwsh.exe'));
  fs.writeFileSync(path.join(root,'work','agent-durable-report.json'),JSON.stringify({time:new Date().toISOString(),model:started.model,status:'completed',command:item.command,output:item.aggregatedOutput,disconnectedSeconds:15},null,2));
  console.log('PASS real agent continued during SSH outage; completion and pwsh output replayed on reconnect');
}finally{if(c)await c.close();}
