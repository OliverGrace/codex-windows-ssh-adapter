import {liveTarget} from './live-target.mjs';
const liveHost = liveTarget();
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {pipeClient,proxyCommand,lookupCommand,bootstrapCommand} from './helpers.mjs';
import {inspectDesktop} from '../scripts/desktop-compat.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),cfg=JSON.parse(fs.readFileSync(path.join(root,'adapter.config.json'))),desktop=inspectDesktop();
const host=liveHost;assert.ok(!cfg.aliases.some(alias=>alias.toLowerCase()===host.toLowerCase()), 'Choose a host absent from adapter.config.json aliases to test automatic discovery');
// Connection details come exclusively from the local SSH config.
const prefix=['-T','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes',host];
const exe=path.join(root,'bin','ssh.exe');
for(const payload of [lookupCommand,'codex --version',bootstrapCommand]){const marker=crypto.randomBytes(8);const output=execFileSync(exe,[...prefix,desktop.wrap(payload,marker)],{windowsHide:true,timeout:30000});assert.ok(output.subarray(0,8).equals(marker));}
const marker=crypto.randomBytes(8);const c=await pipeClient(exe,[...prefix,desktop.wrap(proxyCommand,marker)],marker);
try {
 const init=await c.rpc('initialize',{clientInfo:{name:'codex_adapter_generic_test',version:'0.3'},capabilities:{experimentalApi:true}});assert.equal(init.platformFamily,'windows');
 c.notify('initialized');
 const result=await c.rpc('command/exec',{command:['pwsh.exe','-NoProfile','-Command',"[Console]::WriteLine('UNLISTED_HOST_OK'); $env:COMPUTERNAME"],timeoutMs:10000});assert.equal(result.exitCode,0);assert.ok(result.stdout.includes('UNLISTED_HOST_OK'));
 fs.mkdirSync(path.join(root,'work'),{recursive:true});
 fs.writeFileSync(path.join(root,'work','generic-host-report.json'),JSON.stringify({time:new Date().toISOString(),host,allowlistEntryRequired:false,windowsHandshake:true,output:result.stdout},null,2));
 console.log('PASS unlisted Windows SSH destination: discovery, bootstrap, native handshake and pwsh');
}finally{await c.close();}
