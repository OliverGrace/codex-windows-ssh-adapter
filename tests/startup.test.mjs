import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {prepareStartup} from '../scripts/prepare-startup.mjs';

function temporary(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'adapter-startup-'));
  t.after(()=>{
    assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));
    fs.rmSync(root,{recursive:true,force:true});
  });
  return root;
}

test('startup refresh leaves saved enable and disable preferences untouched',t=>{
  const root=temporary(t),state=path.join(root,'.codex-global-state.json');
  const original=JSON.stringify({'remote-connection-auto-connect-by-host-id':{enabled:true,disabled:false}});
  fs.writeFileSync(state,original);
  assert.equal(prepareStartup({supported:true,codexHome:root}),'codex://codex-app/apply-config');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'codex-app','config.json'),'utf8')),
    {version:1,remoteConnections:[]});
  assert.equal(fs.readFileSync(state,'utf8'),original);
});

test('repeated preparation preserves existing native setup config byte for byte',t=>{
  const root=temporary(t),file=path.join(root,'codex-app','config.json');
  fs.mkdirSync(path.dirname(file));
  const original='{ "version": 1, "remoteConnections": [{"sshAlias":"example","projects":[]}] }\n';
  fs.writeFileSync(file,original);
  for(let i=0;i<2;i++)prepareStartup({supported:true,codexHome:root});
  assert.equal(fs.readFileSync(file,'utf8'),original);
});

test('unsupported native route falls back without writing configuration',t=>{
  const root=temporary(t);
  assert.equal(prepareStartup({supported:false,codexHome:root}),'codex://settings/connections/ssh');
  assert.deepEqual(fs.readdirSync(root),[]);
});
