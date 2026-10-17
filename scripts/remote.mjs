import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {parseSshArgs} from '../src/commands.mjs';
import {detectHost,psCommand} from '../src/hosts.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),cfg=JSON.parse(fs.readFileSync(path.join(root,'adapter.config.json')));
const op=process.argv[2]??'status',args=process.argv.slice(3);
if(!['status','start','stop'].includes(op))throw Error('Usage: node scripts/remote.mjs status|start|stop [SSH options] <host>');
if(!args.length){if(cfg.aliases?.[0])args.push(cfg.aliases[0]);else throw Error('Specify an SSH host');}
const parsed=parseSshArgs(args);if(!parsed.host||parsed.remote)throw Error('Pass SSH options and one host');
const info=await detectHost(root,cfg,parsed,{fresh:true});
if(!info.installed)throw Error('No Windows adapter is installed on this host');
if(op==='stop')console.error('Stopping this host adapter ends its remote Codex tasks and terminals.');
const command=psCommand(`$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; & (Join-Path $env:LOCALAPPDATA 'CodexWindowsSshAdapter\\v${info.installed.version}\\entry.ps1') -Operation ${op}; exit $LASTEXITCODE`);
const result=spawnSync(cfg.realSsh,[...info.prefix,command],{windowsHide:true,stdio:'inherit',timeout:30000});process.exitCode=result.status??1;
