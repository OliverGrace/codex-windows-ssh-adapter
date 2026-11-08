import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

export function prepareStartup({supported,codexHome=process.env.CODEX_HOME||path.join(os.homedir(),'.codex')}) {
  if(!supported)return 'codex://settings/connections/ssh';
  const file=path.join(codexHome,'codex-app','config.json');
  fs.mkdirSync(path.dirname(file),{recursive:true});
  try {
    // Empty means refresh existing preferences, not enable all discovered hosts.
    // Native setup may also be managed by the user: never replace its contents.
    fs.writeFileSync(file,JSON.stringify({version:1,remoteConnections:[]})+'\n',{flag:'wx'});
  } catch(error) {if(error.code!=='EEXIST')throw error;}
  // Desktop validates any existing setup config itself. Its startup URL queue
  // applies this after initialization, in addition to its earlier startup read.
  return 'codex://codex-app/apply-config';
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const supported=process.argv[2]==='true';
    if(!supported)console.error('Native startup refresh is unavailable; saved connections may need a manual toggle.');
    console.log(prepareStartup({supported}));
  } catch(error) {
    console.error('Cannot prepare native startup refresh: '+error.message);
    process.exitCode=1;
  }
}
