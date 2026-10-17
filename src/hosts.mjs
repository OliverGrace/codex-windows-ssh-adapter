import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';

export const psCommand=script=>'powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand '+Buffer.from(script,'utf16le').toString('base64');
const optionsWithValues=new Set(['B','b','c','D','E','e','F','I','i','J','L','l','m','O','o','P','p','Q','R','S','W','w']);
// Probing/upload must not bind the App's reverse-forward port or consume its transport.
export function maintenancePrefix(prefix) {
  const result=[];
  for(let i=0;i<prefix.length-1;i++) {
    const arg=prefix[i];
    if(!arg.startsWith('-')||arg==='--')continue;
    for(let j=1;j<arg.length;j++) {
      const flag=arg[j];
      if(optionsWithValues.has(flag)) {
        const value=arg.slice(j+1)||prefix[++i];
        if(['R','L','D','W','O','S'].includes(flag))break;
        if(flag==='o'&&/^(RemoteForward|LocalForward|DynamicForward|ControlMaster|ControlPath|ControlPersist|ExitOnForwardFailure|RequestTTY|RemoteCommand)(?:=|\s)/i.test(value))break;
        result.push('-'+flag,value);break;
      }
      if(!'vNTtfMqG'.includes(flag))result.push('-'+flag);
    }
  }
  // No new trust is granted here: existing known_hosts and user SSH configuration apply.
  return ['-T','-o','BatchMode=yes','-o','ControlMaster=no','-o','ControlPath=none','-o','ClearAllForwardings=yes','-o','RemoteCommand=none',...result,prefix.at(-1)];
}
export function runSsh(config,prefix,command,{input,timeout=30000}={}) {
  return new Promise((resolve,reject)=>{
    const p=spawn(config.realSsh,command===null?prefix:[...prefix,command],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    let stdout='',stderr='',finished=false;
    const timer=setTimeout(()=>{p.kill();finish(new Error('SSH operation timed out'));},timeout);
    function finish(error,result){if(finished)return;finished=true;clearTimeout(timer);error?reject(error):resolve(result);}
    p.once('error',e=>finish(e));p.stdin.on('error',()=>{});
    p.stdout.on('data',b=>{stdout=(stdout+b.toString()).slice(-2*1024*1024);});
    p.stderr.on('data',b=>{stderr=(stderr+b.toString()).slice(-16384);});
    p.once('close',code=>finish(null,{code,stdout,stderr}));
    p.stdin.end(input);
  });
}
export function decodeProbe(stdout) {
  const m=/CODEX_WINDOWS_PROBE:([A-Za-z0-9+/=]+)/.exec(stdout);
  if(!m)return null;
  const value=JSON.parse(Buffer.from(m[1],'base64').toString('utf8'));
  if(value.platform!=='windows'||(value.installed&&!['0.2.0','0.3.0'].includes(value.installed.version)))throw Error('Unsupported adapter discovery response');
  return value;
}
export function scpArguments(config,prefix,file,remoteName) {
  if(!/^codex-adapter-[a-f0-9-]+\.zip$/.test(remoteName))throw Error('Invalid upload filename');
  const args=['-q','-S',config.realSsh];
  for(let i=0;i<prefix.length-1;i++) {
    const option=prefix[i];
    if(option==='-T')continue;
    if(option==='-p'){args.push('-P',prefix[++i]);continue;}
    if(option==='-l'){args.push('-o','User='+prefix[++i]);continue;}
    if(option==='-b'){args.push('-o','BindAddress='+prefix[++i]);continue;}
    if(option==='-B'){args.push('-o','BindInterface='+prefix[++i]);continue;}
    if(option==='-E'){i++;continue;}
    args.push(option);if(optionsWithValues.has(option.slice(1)))args.push(prefix[++i]);
  }
  let host=prefix.at(-1);
  const at=host.lastIndexOf('@'),user=at<0?'':host.slice(0,at+1),address=host.slice(at+1);
  if(address.includes(':')&&!address.startsWith('['))host=user+'['+address+']';
  return [...args,file,host+':'+remoteName];
}
async function upload(config,prefix,file,name) {
  const scp=path.join(path.dirname(config.realSsh),'scp.exe');
  const args=scpArguments(config,prefix,file,name);
  const result=await runSsh({...config,realSsh:scp},args,null,{timeout:120000});
  if(result.code!==0)throw Error('Cannot upload adapter through SSH/SFTP. Enable the Windows OpenSSH SFTP subsystem. '+result.stderr.slice(-1000));
}
export async function detectHost(root,config,parsed,{fresh=false,run=runSsh}={}) {
  const prefix=maintenancePrefix(parsed.prefix);
  // Resolve OpenSSH configuration (including Include/ProxyJump/user/port/identity).
  // Hash it instead of persisting raw proxy commands or authentication paths.
  const resolved=await run(config,['-G',...prefix],null);
  if(resolved.code!==0)throw Error('Cannot resolve SSH host configuration: '+resolved.stderr.slice(-1000));
  return detectResolved(root,config,parsed,prefix,{fresh,run,resolved});
}
async function detectResolved(root,config,parsed,prefix,{fresh,run,resolved}) {
  const key=crypto.createHash('sha256').update(JSON.stringify(prefix)).update(resolved.code===0?resolved.stdout:'').digest('hex');
  const cacheDir=path.join(root,'work','hosts');fs.mkdirSync(cacheDir,{recursive:true});const file=path.join(cacheDir,key+'.json');
  if(!fresh){try{const cached=JSON.parse(fs.readFileSync(file));if(Date.now()-cached.checkedAt<60000)return {...cached,prefix,file};}catch{}}
  const discovery=fs.readFileSync(path.join(root,'remote','discover.ps1'),'utf8');
  const script=`$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue';\n${discovery}\nif($env:OS -ne 'Windows_NT'){exit 87}; $result=Get-AdapterProbe; [Console]::WriteLine('CODEX_WINDOWS_PROBE:'+ [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($result | ConvertTo-Json -Depth 6 -Compress))))`;
  // Keep the remote command below cmd.exe's 8191-character limit.
  const loader="[Console]::InputEncoding=[Text.UTF8Encoding]::new($false); & ([scriptblock]::Create([Console]::In.ReadToEnd()))";
  const result=await run(config,prefix,psCommand(loader),{input:Buffer.from(script)});
  let probe=decodeProbe(result.stdout);
  if(!probe) {
    if(result.code===255)throw Error('SSH authentication or connection failed. Verify this host with system ssh first.');
    const unix=await run(config,prefix,'uname -s');
    if(unix.code!==0||! /^(Linux|Darwin|FreeBSD|OpenBSD|NetBSD)\s*$/.test(unix.stdout.trim()))throw Error('Cannot identify this SSH host as Windows or Unix; no installation attempted.');
    probe={platform:'unix'};
  }
  const value={...probe,checkedAt:Date.now()};fs.writeFileSync(file,JSON.stringify(value));return {...value,prefix,file};
}
export async function ensureHost(root,config,info,{run=runSsh,transfer=upload,instance='CodexWindowsSshAdapter'}={}) {
  if(!/^CodexWindowsSshAdapter(?:-Test-[a-f0-9]{8})?$/.test(instance))throw Error('Invalid installation instance');
  if(info.installed)return info;
  if(!info.cli)throw Error('Codex CLI was not found in the SSH account. Install it or set remote CODEX_CLI_PATH to its native codex.exe.');
  if(!info.cli.compatible)throw Error('Remote Codex CLI lacks app-server --stdio; update the remote CLI first.');
  if(!['AMD64','ARM64'].includes(info.architecture))throw Error('This package requires 64-bit Windows; unsupported host architecture.');
  const bundle=path.join(root,'bin','remote-v0.3.0.zip');
  if(!fs.existsSync(bundle))throw Error('Remote package missing. Run Launch-Codex-Windows.cmd to prepare it.');
  const hash=crypto.createHash('sha256').update(fs.readFileSync(bundle)).digest('hex');
  const name='codex-adapter-'+crypto.randomUUID()+'.zip';
  await transfer(config,info.prefix,bundle,name);
  const script=`$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; $upload=Join-Path $env:USERPROFILE '${name}'; try { if((Get-FileHash -Algorithm SHA256 -LiteralPath $upload).Hash -ne '${hash}'){throw 'Adapter package hash mismatch'}; Add-Type -AssemblyName System.IO.Compression.FileSystem; $zip=[IO.Compression.ZipFile]::OpenRead($upload); try{$reader=[IO.StreamReader]::new($zip.GetEntry('install.ps1').Open()); $code=$reader.ReadToEnd(); $reader.Dispose()}finally{$zip.Dispose()}; & ([scriptblock]::Create($code)) -Archive $upload -Instance '${instance}' } finally { if(Test-Path -LiteralPath $upload){Remove-Item -LiteralPath $upload} }`;
  const result=await run(config,info.prefix,psCommand(script),{timeout:120000});
  if(result.code!==0)throw Error('Windows adapter setup failed. Check task-scheduler permissions and remote CLI. Run node scripts/setup-host.mjs <SSH-host> for details.\n'+result.stderr.slice(-2500));
  const installed=decodeProbe(result.stdout);
  if(!installed?.installed)throw Error('Remote setup did not confirm a ready service; reconnect to retry.');
  const value={...installed,checkedAt:Date.now()};fs.writeFileSync(info.file,JSON.stringify(value));return {...value,prefix:info.prefix,file:info.file};
}
