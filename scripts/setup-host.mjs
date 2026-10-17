import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseSshArgs} from '../src/commands.mjs';
import {detectHost,ensureHost} from '../src/hosts.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),cfg=JSON.parse(fs.readFileSync(path.join(root,'adapter.config.json')));
const argv=process.argv.slice(2),check=argv[0]==='--check';if(check)argv.shift();
if(!argv.length)throw Error('Usage: node scripts/setup-host.mjs [--check] [SSH options] <host>');
const parsed=parseSshArgs(argv);if(!parsed.host||parsed.remote)throw Error('Pass SSH options and one host, without a remote command');
let info=await detectHost(root,cfg,parsed,{fresh:true});
if(info.platform==='unix'){console.log('Unix host: normal Codex SSH transport will be used');}
else {
  console.log(JSON.stringify({platform:info.platform,machine:info.machine,architecture:info.architecture,cli:info.cli,installed:info.installed},null,2));
  if(!check){info=await ensureHost(root,cfg,info);console.log('Windows SSH adapter ready: '+info.installed.version+' ('+info.installed.logonType+')');}
}
