import {liveTarget} from './live-target.mjs';
const liveHost = liveTarget();
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {pipeClient, proxyCommand, lookupCommand, bootstrapCommand} from './helpers.mjs';
import {inspectDesktop} from '../scripts/desktop-compat.mjs';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cfg=JSON.parse(fs.readFileSync(path.join(root,'adapter.config.json')));
const exe=path.join(root,'bin','ssh.exe');
const desktop=inspectDesktop();
assert.equal(desktop.version,cfg.testedAppVersion);
const prefix=['-T','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=8',liveHost];
const expectedMachine=execFileSync(cfg.realSsh,[...prefix,'hostname'],{encoding:'utf8',windowsHide:true,timeout:15000}).trim();
const report={time:new Date().toISOString(),desktop:desktop.version,checks:[]};
function pass(name,details){report.checks.push({name,passed:true,...details});console.log('PASS '+name+(details?' '+JSON.stringify(details):''));}
function probe(payload){const marker=crypto.randomBytes(8);const out=execFileSync(exe,[...prefix,desktop.wrap(payload,marker)],{windowsHide:true,timeout:20000});assert.ok(out.subarray(0,8).equals(marker));return out.subarray(8).toString('utf8');}
probe(lookupCommand);pass('desktop CLI lookup and binary marker');
const version=probe('codex --version').trim();assert.match(version,/codex-cli/);pass('desktop version probe',{version});
probe(bootstrapCommand);pass('desktop bootstrap validates stdio support');
const newClient=async()=>{const marker=crypto.randomBytes(8);return pipeClient(exe,[...prefix,desktop.wrap(proxyCommand,marker)],marker);};
const initialize=async c=>{const init=await c.rpc('initialize',{clientInfo:{name:'codex_windows_ssh_adapter_test',title:'Windows SSH adapter test',version:'0.1.0'},capabilities:{experimentalApi:true}});c.notify('initialized');assert.equal(init.platformFamily,'windows');return init;};
let c;
const unique=crypto.randomUUID();
let testFile=null;
try {
  c=await newClient(); const init=await initialize(c);pass('native Windows handshake',{platform:init.platformFamily,userAgent:init.userAgent});
  const shell=await c.rpc('command/exec',{command:['pwsh.exe','-NoProfile','-NonInteractive','-Command',
    '[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); @{machine=$env:COMPUTERNAME; version=$PSVersionTable.PSVersion.ToString(); edition=$PSVersionTable.PSEdition; executable=(Get-Process -Id $PID).Path; temp=$env:TEMP} | ConvertTo-Json -Compress'],timeoutMs:10000});
  assert.equal(shell.exitCode,0,shell.stderr);const identity=JSON.parse(shell.stdout.trim());
  assert.equal(identity.machine.toUpperCase(),expectedMachine.toUpperCase());assert.notEqual(identity.machine.toUpperCase(),process.env.COMPUTERNAME.toUpperCase());assert.equal(identity.edition,'Core');assert.match(identity.executable,/pwsh\.exe$/i);
  report.remote=identity;pass('PowerShell 7 executes on the remote host',{machine:identity.machine,version:identity.version,executable:identity.executable});
  testFile=path.win32.join(identity.temp,`codex-adapter-${unique}-中文 空格.txt`);
  const content='Codex SSH 适配测试\r\nWindows path C:\\a\\b\r\n'+unique;
  await c.rpc('fs/writeFile',{path:testFile,dataBase64:Buffer.from(content).toString('base64')});
  assert.equal(Buffer.from((await c.rpc('fs/readFile',{path:testFile})).dataBase64,'base64').toString(),content);
  pass('file read/write with Chinese and spaces');
  const processId='stream-'+unique;
  const stream=await c.rpc('command/exec',{processId,streamStdoutStderr:true,command:['pwsh.exe','-NoProfile','-Command',"[Console]::Write('stream-ok'); [Console]::Error.Write('stderr-ok')"],timeoutMs:10000});
  assert.equal(stream.exitCode,0);const deltas=c.messages.filter(m=>m.method==='command/exec/outputDelta'&&m.params?.processId===processId);
  assert.ok(deltas.length>0);pass('command output notifications',{notifications:deltas.length});
  const fail=await c.rpc('command/exec',{command:['pwsh.exe','-NoProfile','-Command','exit 7'],timeoutMs:10000});assert.equal(fail.exitCode,7);pass('remote exit code preserved');
  await c.close();c=null;pass('clean disconnect');
  c=await newClient();await initialize(c);
  assert.equal(Buffer.from((await c.rpc('fs/readFile',{path:testFile})).dataBase64,'base64').toString(),content);pass('reconnect and persistent remote file');
  await c.rpc('fs/remove',{path:testFile,recursive:false,force:false});testFile=null;pass('temporary test file cleanup');
} finally {
  if(c){if(testFile)await c.rpc('fs/remove',{path:testFile,recursive:false,force:true}).catch(()=>{});await c.close();}
  fs.mkdirSync(path.join(root,'work'),{recursive:true});fs.writeFileSync(path.join(root,'work','integration-report.json'),JSON.stringify(report,null,2));
}
