import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cfg=JSON.parse(fs.readFileSync(path.join(root,'adapter.config.json')));
const args=process.argv.slice(2);
if(!args.length){if(cfg.aliases?.[0])args.push(cfg.aliases[0]);else throw Error('Usage: npm run install:remote -- <SSH-host>');}
execFileSync(process.execPath,[path.join(root,'scripts','prepare-package.mjs')],{windowsHide:true,stdio:'inherit'});
execFileSync(process.execPath,[path.join(root,'scripts','setup-host.mjs'),...args],{windowsHide:true,stdio:'inherit'});
