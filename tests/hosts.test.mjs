import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {maintenancePrefix,detectHost,ensureHost,decodeProbe,scpArguments} from '../src/hosts.mjs';
import {parseSshArgs,remoteCommand} from '../src/commands.mjs';
const encoded=x=>'CODEX_WINDOWS_PROBE:'+Buffer.from(JSON.stringify(x)).toString('base64');
const win={platform:'windows',architecture:'AMD64',cli:{path:'C:\\custom\\codex.exe',version:'codex-cli 0.162.0',compatible:true},installed:null};
function fixture(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'adapter-hosts-'));fs.mkdirSync(path.join(root,'remote'));fs.copyFileSync(fileURLToPath(new URL('../remote/discover.ps1',import.meta.url)),path.join(root,'remote','discover.ps1'));return root;}
test('maintenance keeps SSH identity/jump/config but never opens App forwarding ports',()=>{
 const result=maintenancePrefix(['-T','-v','-F','C:\\fixtures\\my config','-Jjumpbox','-p','2222','-l','bob','-i','C:\\fixtures\\my key','-o','ProxyCommand=custom proxy','-R','127.0.0.1:123:127.0.0.1:123','-oRemoteForward=222 localhost:333','-o','ControlPath=somewhere','new-win']);
 assert.ok(result.includes('C:\\fixtures\\my config'));assert.ok(result.includes('jumpbox'));assert.ok(result.includes('2222'));assert.ok(result.includes('bob'));assert.ok(result.includes('C:\\fixtures\\my key'));assert.ok(result.includes('ProxyCommand=custom proxy'));assert.equal(result.at(-1),'new-win');
 assert.ok(!result.includes('-R'));assert.ok(!result.join(' ').includes('localhost:333'));assert.ok(!result.includes('ControlPath=somewhere'));
});
test('SFTP upload preserves custom SSH port/user/key/ProxyJump and brackets IPv6 destinations',()=>{
 const args=scpArguments({realSsh:'C:\\system\\ssh.exe'},maintenancePrefix(['-p','2222','-l','bob','-J','jump','-i','my key','fe80::1234']),'package.zip','codex-adapter-abcd.zip');
 assert.ok(args.includes('-P'));assert.ok(args.includes('2222'));assert.ok(args.includes('User=bob'));assert.ok(args.includes('jump'));assert.ok(args.includes('my key'));
 assert.equal(args.at(-1),'[fe80::1234]:codex-adapter-abcd.zip');assert.ok(!args.includes('-T'));
 assert.throws(()=>scpArguments({},['win'],'file','bad;name'));
});
test('unknown Windows hosts discovered; caches separated by resolved SSH identity; Unix passes through',async()=>{
 const root=fixture();let calls=0,platform='windows',identity='host:one user:a port:22';
 const run=async(config,prefix,command,options)=>{calls++;if(command===null)return {code:0,stdout:identity};if(command==='uname -s')return {code:0,stdout:'Linux\n'};assert.ok(command.length<8191);assert.ok(options.input.length>0);return platform==='windows'?{code:0,stdout:encoded(win)}:{code:127,stdout:''};};
 try {
  const parsed=parseSshArgs(['-T','not-on-any-allowlist']);
  const a=await detectHost(root,{},parsed,{run});assert.equal(a.platform,'windows');assert.equal(calls,2);
  const again=await detectHost(root,{},parsed,{run});assert.equal(again.file,a.file);assert.equal(calls,3);
  identity='host:two user:a port:22';platform='unix';const other=await detectHost(root,{},parsed,{run});assert.equal(other.platform,'unix');assert.notEqual(other.file,a.file);
  await assert.rejects(detectHost(root,{},parsed,{fresh:true,run:async(c,p,command)=>command===null?{code:0,stdout:'authfail'}:{code:255,stdout:''}}),/authentication/);
 } finally {fs.rmSync(root,{recursive:true,force:true});}
});
test('provisioning is idempotent, rejects unsupported CLI and validates discovered versions',async()=>{
 const existing={...win,installed:{version:'0.2.0',runner:false}};
 assert.equal(await ensureHost('',{},existing,{run:()=>assert.fail('must not install')}),existing);
 await assert.rejects(ensureHost('',{},{...win,cli:null}),/CLI was not found/);
 await assert.rejects(ensureHost('',{},{...win,cli:{compatible:false}}),/lacks app-server/);
 assert.throws(()=>decodeProbe(encoded({...win,installed:{version:'../anything'}})),/discovery/);
 const cmd=remoteCommand({remoteCodexCommand:'codex.cmd',durableHost:true,remoteVersion:'0.3.0',remoteRunner:true},'proxy',1234);
 assert.ok(cmd.includes('v0.3.0\\run-proxy.cmd'));assert.ok(cmd.endsWith('1234'));
 const native=remoteCommand({remoteCodexCommand:'codex.cmd',durableHost:true,remoteVersion:'0.3.0',remoteRunnerKind:'native'},'proxy',1234);
 assert.ok(Buffer.from(native.split(' ').at(-1),'base64').toString('utf16le').includes('proxy-launcher.exe'));
});
