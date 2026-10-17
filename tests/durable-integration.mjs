import {liveTarget, remoteTemp} from './live-target.mjs';
const liveHost = liveTarget();
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import {once} from 'node:events';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {pipeClient,proxyCommand} from './helpers.mjs';
import {inspectDesktop} from '../scripts/desktop-compat.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),cfg=JSON.parse(fs.readFileSync(path.join(root,'adapter.config.json')));
const desktop=inspectDesktop(),exe=path.join(root,'bin','ssh.exe'),token=crypto.randomBytes(24).toString('hex');
const report={time:new Date().toISOString(),checks:[]};
function pass(name){report.checks.push(name);console.log('PASS '+name);}
const calls=[];
const server=http.createServer(async(req,res)=>{
  if(req.headers.authorization!=='Bearer '+token){res.writeHead(401).end();return;}
  if(req.method!=='POST'){res.writeHead(405).end();return;}
  let body='';for await(const chunk of req)body+=chunk;
  const m=JSON.parse(body);calls.push(m.method);
  if(m.id===undefined){res.writeHead(202).end();return;}
  let result;
  if(m.method==='initialize')result={protocolVersion:m.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'adapter-loopback-test',version:'1'}};
  else if(m.method==='tools/list')result={tools:[{name:'echo',description:'Echo a test marker',inputSchema:{type:'object',properties:{text:{type:'string'}},required:['text']}}]};
  else if(m.method==='tools/call')result={content:[{type:'text',text:m.params.arguments.text}]};
  else result={};
  res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({jsonrpc:'2.0',id:m.id,result}));
});
server.listen(0,'127.0.0.1');await once(server,'listening');const port=server.address().port;
const hex=port.toString(16).toUpperCase().padStart(4,'0');
const check=`listeners=$(awk '$4 == "0A" && $2 ~ /:${hex}$/ {print $2}' /proc/net/tcp /proc/net/tcp6) || exit 1\n[ "$listeners" = '0100007F:${hex}' ] || exit 1`;
const prefix=['-T','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ExitOnForwardFailure=yes','-R',`127.0.0.1:${port}:127.0.0.1:${port}`,liveHost];
async function connect(){const marker=crypto.randomBytes(8);const c=await pipeClient(exe,[...prefix,desktop.wrap(check+'\n'+proxyCommand,marker)],marker);await c.rpc('initialize',{clientInfo:{name:'codex_adapter_durable_test',version:'0.2.0'},capabilities:{experimentalApi:true}});c.notify('initialized');return c;}
async function waitFor(fn,ms=15000){const start=Date.now();while(Date.now()-start<ms){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw Error('Condition timed out');}
function status(){return JSON.parse(execFileSync(cfg.realSsh,['-T','-o','BatchMode=yes',liveHost,'cmd.exe /d /c type "%LOCALAPPDATA%\\CodexWindowsSshAdapter\\status.json"'],{encoding:'utf8',windowsHide:true,timeout:10000}));}
let c,threadId,processId,doneFile,temp;
try {
  c=await connect();temp=await remoteTemp(c);pass('MCP loopback forward accepted by Windows listener verification');
  const initial=status(),session=initial.sessions.find(s=>s.name==='codex_adapter_durable_test');assert.ok(session?.pid);
  const unique=crypto.randomUUID();processId='durable-'+unique;doneFile=path.win32.join(temp,'codex-durable-'+unique+'.txt');
  const command=`[Console]::WriteLine('DURABLE_READY'); $line=[Console]::ReadLine(); Start-Sleep -Seconds 4; [IO.File]::WriteAllText('${doneFile.replaceAll("'","''")}',$line); [Console]::WriteLine('DURABLE_FINISHED')`;
  c.rpc('command/exec',{processId,streamStdin:true,streamStdoutStderr:true,command:['pwsh.exe','-NoProfile','-Command',command],timeoutMs:60000},65000).catch(()=>{});
  await waitFor(()=>c.messages.some(m=>m.method==='command/exec/outputDelta'&&JSON.stringify(m).includes(Buffer.from('DURABLE_READY').toString('base64').slice(0,12))));
  // Kill the real native wrapper, exercising its kill-on-close Job and abrupt SSH loss.
  c.child.kill();await c.closed;c=null;
  const detached=status();assert.equal(detached.pid,initial.pid);assert.equal(detached.sessions.find(s=>s.name===session.name).pid,session.pid);
  c=await connect();
  await c.rpc('command/exec/write',{processId,deltaBase64:Buffer.from('SURVIVED_DISCONNECT\r\n').toString('base64'),closeStdin:true});
  pass('same native Codex process and interactive stdin survive forced SSH disconnect');
  c.child.kill();await c.closed;c=null;
  await new Promise(r=>setTimeout(r,5500));
  c=await connect();
  const content=Buffer.from((await c.rpc('fs/readFile',{path:doneFile})).dataBase64,'base64').toString();assert.equal(content,'SURVIVED_DISCONNECT');
  pass('PowerShell command finishes while no SSH client is attached');
  assert.equal(status().sessions.find(s=>s.name===session.name).pid,session.pid);
  const started=await c.rpc('thread/start',{ephemeral:true,cwd:temp,config:{mcp_servers:{adapter_echo:{url:`http://127.0.0.1:${port}/mcp`,http_headers:{Authorization:'Bearer '+token},enabled:true,startup_timeout_sec:15}}}},30000);
  threadId=started.thread.id;
  const result=await c.rpc('mcpServer/tool/call',{threadId,server:'adapter_echo',tool:'echo',arguments:{text:'MCP_REVERSE_FORWARD_OK'}},30000);
  assert.ok(JSON.stringify(result).includes('MCP_REVERSE_FORWARD_OK'));
  assert.ok(calls.includes('initialize')&&calls.includes('tools/list')&&calls.includes('tools/call'));
  pass('native remote Codex initializes and calls authenticated local MCP through reverse forwarding');
  await c.close();c=null;c=await connect();
  const again=await c.rpc('mcpServer/tool/call',{threadId,server:'adapter_echo',tool:'echo',arguments:{text:'MCP_RECONNECTED_OK'}},30000);
  assert.ok(JSON.stringify(again).includes('MCP_RECONNECTED_OK'));pass('MCP forwarding restored after reconnect with same endpoint');
  await c.rpc('fs/remove',{path:doneFile,recursive:false,force:false});doneFile=null;
} finally {
  if(c){if(doneFile)await c.rpc('fs/remove',{path:doneFile,recursive:false,force:true}).catch(()=>{});await c.close();}
  server.closeAllConnections();server.close();
  fs.writeFileSync(path.join(root,'work','durable-test-report.json'),JSON.stringify(report,null,2));
}
