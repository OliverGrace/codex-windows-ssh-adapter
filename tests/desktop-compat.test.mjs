import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {extractFormatter,inspectSources} from '../scripts/desktop-protocol.mjs';
import {inspectDesktop} from '../scripts/desktop-compat.mjs';
import {quote} from './helpers.mjs';

// Synthetic protocol fixture, not code copied from Desktop. The surrounding
// module deliberately cannot run; only its small formatter may be evaluated.
function fixture({prefix='PATH="${CODEX_INSTALL_DIR:-$HOME/.local/bin}:$PATH"; export PATH; ',rename='format',module=false,markerChange=false}={}) {
  const code=`const shellQuote=(${quote.toString()});const pathSetup=${JSON.stringify(prefix)};
  function ${rename}(command,marker){
    const wrapper='echo "Codex remote SSH requires SHELL"; CODEX_REMOTE_PAYLOAD="$1"';
    const bytes=marker?Array.from(marker,b=>'\\\\'+b.toString(8).padStart(3,'0')).join(''):'';
    const lead=marker?"printf '%b' "+shellQuote(bytes)+"; ":'';
    return 'sh -c '+shellQuote(wrapper)+' sh '+shellQuote(lead+pathSetup+command${markerChange?"+'; changed'":''});
  }`;
  return module?`(function(){throw Error('Module must not execute');${code};return {renamedExport:${rename}};})();`:code;
}
const signals={name:'transport-new-name.js',source:'const startup=[\'if [ "${CODEX_SSH_SKIP_APP_SERVER_BOOT:-}" = "true" ]; then exit 0; fi; \']; // app-server proxy pkill -9'};
const inspect=source=>inspectSources([{name:'renamed-bundle.js',source},signals]);

test('formatter survives symbol renaming and movement into an unexecuted module',()=>{
  for(const module of [false,true]) {
    const result=inspect(fixture({rename:'differentSymbol',module}));
    assert.equal(result.checks,7);
    assert.equal(result.formatterBundle,'renamed-bundle.js');
  }
});
test('changed envelopes, missing protocol signals and ambiguous formatters fail closed',()=>{
  assert.throws(()=>inspect(fixture({prefix:'PATH=/different; '})),/command changed/);
  assert.throws(()=>inspect(fixture({markerChange:true})),/command changed/);
  assert.throws(()=>inspectSources([{name:'a.js',source:fixture()}]),/signal missing/);
  assert.throws(()=>inspectSources([{name:'a.js',source:fixture()},{name:'b.js',source:fixture()},signals]),/ambiguous/);
  assert.throws(()=>inspect(fixture()+fixture({rename:'second'}).replaceAll('shellQuote','quote2').replaceAll('pathSetup','path2')),/ambiguous/);
});
test('unknown dependencies and nonterminating formatters cannot start the App',()=>{
  assert.throws(()=>inspect(fixture().replace('lead+pathSetup+command','unavailable(lead)+pathSetup+command')),/dependency/);
  const wrap=extractFormatter('function hang(){while(true){};return "CODEX_REMOTE_PAYLOAD"}');
  assert.throws(()=>wrap('x',null),/timed out/);
});
test('actual bootstrap UID prelude is checked and unknown preludes are rejected',()=>{
  const prefix='uid=$(id -u) || exit 1; printf "%s\\n" "$uid"; ';
  const check=prelude=>inspectSources([{name:'formatter.js',source:fixture()},
    {...signals,source:signals.source.replace('startup=[','startup=['+JSON.stringify(prelude)+',')}]);
  assert.equal(check(prefix).bootstrapPrefix,prefix);
  assert.throws(()=>check('unknown-command; '),/command changed/);
});
test('unseen package versions are inspected from their archive instead of an allowlist',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'adapter-compat-'));
  try {
    const dir=path.join(root,'app','resources');fs.mkdirSync(dir,{recursive:true});
    const content=Buffer.from(fixture({module:true})+'\n'+signals.source);
    const json=Buffer.from(JSON.stringify({files:{'.vite':{files:{build:{files:{'arbitrary-bundle.js':{size:content.length,offset:'0'}}}}}}}));
    const header=Buffer.alloc(16);header.writeUInt32LE(8+json.length,4);header.writeUInt32LE(json.length,12);
    fs.writeFileSync(path.join(dir,'app.asar'),Buffer.concat([header,json,content]));
    const result=inspectDesktop({Version:'99.1234.5678.0',InstallLocation:root});
    assert.equal(result.version,'99.1234.5678.0');assert.equal(result.checks,7);
  } finally {
    assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));
    fs.rmSync(root,{recursive:true,force:true});
  }
});
