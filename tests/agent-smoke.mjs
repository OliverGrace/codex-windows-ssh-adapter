import {liveTarget, remoteTemp} from './live-target.mjs';
const liveHost = liveTarget();
// Optional, explicit model smoke test. Uses the remote user's configured model.
// The test thread is ephemeral and only requests read-only shell identity data.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import crypto from 'node:crypto';
import {pipeClient,proxyCommand} from './helpers.mjs';
import {inspectDesktop} from '../scripts/desktop-compat.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cfg=JSON.parse(fs.readFileSync(path.join(root,'adapter.config.json')));
const desktop=inspectDesktop(), marker=crypto.randomBytes(8);
const c=await pipeClient(path.join(root,'bin','ssh.exe'),['-T','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes',liveHost,desktop.wrap(proxyCommand,marker)],marker);
let threadId;
try {
  await c.rpc('initialize',{clientInfo:{name:'codex_adapter_agent_smoke',version:'0.1.0'},capabilities:{experimentalApi:true}});c.notify('initialized');
  const started=await c.rpc('thread/start',{cwd:await remoteTemp(c),ephemeral:true,
    baseInstructions:'You are running a read-only compatibility test. Execute only the exact shell identity command requested. Do not browse, edit files, read credentials, delegate, install tools, or change configuration. Use the default execution shell; do not launch another shell explicitly. Return the command output.'});
  threadId=started.thread.id;
  console.log('Ephemeral agent test started; remote model: '+started.model);
  let resolveDone,rejectDone;
  const done=new Promise((resolve,reject)=>{resolveDone=resolve;rejectDone=reject;});
  const timer=setTimeout(()=>rejectDone(new Error('Agent smoke test timed out')),120000);
  c.ws.on('message',data=>{
    const m=JSON.parse(data);
    if(m.method==='turn/completed'&&m.params?.threadId===threadId)resolveDone(m.params.turn);
    if(m.method==='item/completed'&&m.params?.threadId===threadId) console.log('Completed item: '+m.params.item?.type);
  });
  try {
    await c.rpc('turn/start',{threadId,input:[{type:'text',text:"Run exactly this one command using the execution tool's DEFAULT shell (do not prefix pwsh.exe, powershell.exe, cmd.exe, or bash): [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); @{marker='CODEX_ADAPTER_DEFAULT_SHELL'; machine=$env:COMPUTERNAME; version=$PSVersionTable.PSVersion.ToString(); edition=$PSVersionTable.PSEdition; executable=(Get-Process -Id $PID).Path} | ConvertTo-Json -Compress. Return the output. Do nothing else.",text_elements:[]}]});
    const turn=await done;
    const items=c.messages.filter(m=>m.method==='item/completed'&&m.params?.threadId===threadId).map(m=>m.params.item);
    const report={time:new Date().toISOString(),model:started.model,status:turn.status,items};
    fs.writeFileSync(path.join(root,'work','agent-smoke-report.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report,null,2));
    if(turn.status!=='completed')throw new Error('Agent turn did not complete');
    const execution=items.filter(i=>i.type==='commandExecution');
    if(!execution.some(i=>(i.aggregatedOutput??'').includes('CODEX_ADAPTER_DEFAULT_SHELL')&&(i.aggregatedOutput??'').includes('pwsh.exe')))throw new Error('Default pwsh execution was not confirmed');
  }finally{clearTimeout(timer);}
}finally{await c.close();}
