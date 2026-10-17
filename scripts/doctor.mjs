import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {inspectDesktop} from './desktop-compat.mjs';
import {classifyCommand} from '../src/commands.mjs';
import crypto from 'node:crypto';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const config=JSON.parse(fs.readFileSync(path.join(root,'adapter.config.json')));
const runtime=JSON.parse(fs.readFileSync(path.join(root,'bin','runtime.json')));
for(const file of [runtime.node,config.realSsh,path.join(root,'bin','ssh.exe')]) {
  if(!fs.existsSync(file))throw new Error('Missing executable: '+file);
  console.log('OK executable: '+file);
}
const desktop=inspectDesktop();
if(desktop.version!==config.testedAppVersion)throw new Error('Desktop version changed; run compatibility review before enabling the launcher');
const command=desktop.wrap('if [ -S "${SSH_AUTH_SOCK:-}" ]; then true; fi && exec codex app-server proxy',crypto.randomBytes(8));
if(classifyCommand(command)?.operation!=='proxy')throw new Error('Desktop command envelope is incompatible');
console.log('OK desktop command compatibility: '+desktop.version);
console.log('Windows host discovery: '+(config.autoDetectWindows?'automatic (all SSH targets)':'alias allowlist'));
console.log('Portable setup package: '+(fs.existsSync(path.join(root,'bin','remote-v0.3.0.zip'))?'ready':'run npm run prepare:remote'));
for(const alias of config.aliases){
  const resolved=execFileSync(path.join(root,'bin','ssh.exe'),['-G',alias],{encoding:'utf8',windowsHide:true,timeout:10000,stdio:['ignore','pipe','pipe']});
  console.log('OK SSH alias '+alias+': '+resolved.split(/\r?\n/).filter(s=>/^(hostname|user|port) /.test(s)).join(', '));
}
const report=path.join(root,'work','integration-report.json');
if(fs.existsSync(report)){const saved=JSON.parse(fs.readFileSync(report));console.log('Last saved live test: '+saved.checks.length+' checks at '+saved.time+' (not rerun by doctor)');}
console.log('Doctor is read-only; use npm run test:integration to retest the live host.');
