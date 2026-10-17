import {liveTarget} from './live-target.mjs';
const liveHost = liveTarget();
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {detectHost,ensureHost,runSsh,psCommand} from '../src/hosts.mjs';
import {parseSshArgs,remoteCommand} from '../src/commands.mjs';
import {pipeClient} from './helpers.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),cfg=JSON.parse(fs.readFileSync(path.join(root,'adapter.config.json')));
const prefix=['-T','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes',liveHost],instance='CodexWindowsSshAdapter-Test-'+crypto.randomBytes(4).toString('hex');
const info=await detectHost(root,cfg,parseSshArgs(prefix),{fresh:true});
const report={time:new Date().toISOString(),instance,checks:[]};let c;
try {
 const installed=await ensureHost(root,cfg,{...info,installed:null,file:path.join(root,'work',instance+'.json')},{instance});assert.equal(installed.installed.version,'0.3.0');report.checks.push('fresh automatic SSH upload and task installation');console.log('PASS fresh installation with portable Node');
 const template=remoteCommand({...cfg,durableHost:true,remoteVersion:'0.3.0',remoteRunnerKind:'native'},'proxy',0);
 const script=Buffer.from(template.split(' ').at(-1),'base64').toString('utf16le').replaceAll('CodexWindowsSshAdapter\\',instance+'\\');
 const command=psCommand(script);
 // Reuse the local WebSocket bridge but target the isolated test installation.
 const fixture=path.join(root,'work',instance+'.mjs');
 fs.writeFileSync(fixture,`import {spawn} from 'node:child_process';import {serveBridge} from '../src/bridge.mjs';serveBridge({input:process.stdin,output:process.stdout,startChild(){const p=spawn(${JSON.stringify(cfg.realSsh)},${JSON.stringify([...prefix,command])},{windowsHide:true,stdio:['pipe','pipe','pipe']});p.stderr.pipe(process.stderr);return p;},onFinish:code=>process.exit(code)});`);
 c=await pipeClient(process.execPath,[fixture]);
 await c.rpc('initialize',{clientInfo:{name:'generic_install_test',version:'0.3'},capabilities:{experimentalApi:true}});
 // Intentionally omit initialized: the real Desktop does so too.
 const result=await c.rpc('command/exec',{command:['pwsh.exe','-NoProfile','-Command',"[Console]::WriteLine('GENERIC_FRESH_HOST_OK')"],timeoutMs:10000});assert.equal(result.exitCode,0);assert.ok(result.stdout.includes('GENERIC_FRESH_HOST_OK'));
 report.checks.push('fresh service uses real native CLI and PowerShell');console.log('PASS fresh native protocol and PowerShell');
 await c.close();c=null;
 const before=await runSsh(cfg,info.prefix,psCommand(`Get-Content -Raw (Join-Path $env:LOCALAPPDATA '${instance}\\status.json')`));const pid=JSON.parse(before.stdout).pid;
 await ensureHost(root,cfg,{...info,installed:null,file:path.join(root,'work',instance+'.json')},{instance});
 const after=await runSsh(cfg,info.prefix,psCommand(`Get-Content -Raw (Join-Path $env:LOCALAPPDATA '${instance}\\status.json')`));assert.equal(JSON.parse(after.stdout).pid,pid);report.checks.push('repeat setup preserves running service and token');console.log('PASS repeat setup keeps same host PID');
} finally {
 if(c)await c.close();
 const cleanup=`$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';$name='${instance}';if($name -notmatch '^CodexWindowsSshAdapter-Test-[a-f0-9]{8}$'){throw 'Invalid cleanup scope'};$dir=[IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA $name));$expected=[IO.Path]::GetFullPath($env:LOCALAPPDATA).TrimEnd('\\')+'\\';if(!$dir.StartsWith($expected,[StringComparison]::OrdinalIgnoreCase)){throw 'Invalid cleanup path'};if(Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue){Stop-ScheduledTask -TaskName $name;Unregister-ScheduledTask -TaskName $name -Confirm:$false};Start-Sleep -Seconds 2;if(Test-Path -LiteralPath $dir){Remove-Item -LiteralPath $dir -Recurse -Force};Write-Output 'Test installation removed'`;
 const result=await runSsh(cfg,info.prefix,psCommand(cleanup));if(result.code!==0)throw Error('Isolated test cleanup failed: '+result.stderr);
 report.cleanedUp=true;fs.writeFileSync(path.join(root,'work',report.checks.length===3?'generic-install-report.json':'generic-install-failure-'+instance+'.json'),JSON.stringify(report,null,2));
}
