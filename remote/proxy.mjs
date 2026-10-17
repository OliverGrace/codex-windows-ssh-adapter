import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {WebSocket} from 'ws';
const versionDir=path.dirname(fileURLToPath(import.meta.url)),dir=path.dirname(versionDir);
execFileSync('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(versionDir,'entry.ps1'),'-Operation','start'],{windowsHide:true,stdio:'ignore',timeout:25000});
const port=Number(process.argv[2]??0);
if(port) {
  // Match the desktop's Linux check: exactly one IPv4 loopback listener, no wildcard/IPv6.
  if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid MCP port');
  const ps=`$ErrorActionPreference='Stop'; $l=@(Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction Stop); if($l.Count -ne 1 -or $l[0].LocalAddress -ne '127.0.0.1'){exit 42}`;
  try{execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(ps,'utf16le').toString('base64')],{windowsHide:true,stdio:'ignore',timeout:15000});}
  catch {process.stderr.write('Desktop MCP forward is not exclusively bound to IPv4 loopback.\n');process.exit(42);}
}
const state=JSON.parse(fs.readFileSync(path.join(dir,'status.json'))),token=fs.readFileSync(path.join(dir,'token'),'utf8').trim();
const ws=new WebSocket(`ws://127.0.0.1:${state.port}/rpc`,{headers:{Authorization:'Bearer '+token},perMessageDeflate:false,maxPayload:16*1024*1024,handshakeTimeout:15000});
let buffer=Buffer.alloc(0),done=false,initializeId;
process.stdin.pause();
function end(code){if(done)return;done=true;ws.terminate();process.stdin.destroy();process.stdout.end(()=>process.exit(code));}
ws.on('open',()=>process.stdin.resume());
ws.on('message',data=>{
  const m=JSON.parse(data);
  // Desktop versions may omit the optional initialized notification. Also supports
  // a host already running during an adapter update without restarting its tasks.
  if(initializeId!==undefined&&m.id===initializeId&&!m.method&&m.result){initializeId=undefined;ws.send('{"method":"initialized"}');}
  if(!process.stdout.write(data+'\n')){ws.pause();process.stdout.once('drain',()=>ws.resume());}
});
ws.on('error',()=>{process.stderr.write('Durable Codex host unavailable; run the adapter remote start command.\n');end(1);});
ws.on('close',(code,reason)=>{if(!done&&code!==1000)process.stderr.write(`Durable host closed: ${code} ${reason.toString()}\n`);end(code===1000?0:1);});
process.stdout.on('error',()=>end(0));
process.stdin.on('end',()=>end(0));
process.stdin.on('error',()=>end(1));
process.stdin.on('data',chunk=>{
  buffer=Buffer.concat([buffer,chunk]);
  for(;;){const at=buffer.indexOf(10);if(at<0)break;const line=buffer.subarray(0,at);buffer=buffer.subarray(at+1);if(line.length>16*1024*1024){end(1);return;}if(line.length){const text=line.toString('utf8');let m;try{m=JSON.parse(text);}catch{end(1);return;}if(m.method==='initialize')initializeId=m.id;ws.send(text);}}
  if(buffer.length>16*1024*1024)end(1);
});
