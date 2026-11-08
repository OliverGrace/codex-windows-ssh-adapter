import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const preferred=path.join(process.env.ProgramFiles??'C:\\Program Files','PowerShell','7','pwsh.exe');
const shell=fs.existsSync(preferred)?preferred:'powershell.exe';
const helper=fileURLToPath(new URL('../scripts/desktop-process.ps1',import.meta.url));
test('Desktop exit retry and confirmed force close affect only matching fixture processes',
  {skip:process.platform!=='win32'},()=>{
    const result=execFileSync(shell,['-NoProfile','-File',fileURLToPath(new URL('./desktop-process.test.ps1',import.meta.url))],
      {encoding:'utf8',windowsHide:true,timeout:30000});
    assert.match(result,/PASS:/);
  });
test('force-close confirmation accepts Enter or Y but rejects cancellation and EOF',
  {skip:process.platform!=='win32'},()=>{
    const command=`. '${helper.replaceAll("'","''")}'; if (Read-AdapterRestartConfirmation) { 'ACCEPTED' } else { 'CANCELLED' }`;
    for(const [input,expected] of [['\n','ACCEPTED'],['Y\n','ACCEPTED'],['n\n','CANCELLED'],['','CANCELLED']]) {
      const output=execFileSync(shell,['-NoProfile','-Command',command],{input,encoding:'utf8',windowsHide:true,timeout:10000});
      assert.ok(output.trimEnd().endsWith(expected));
    }
  });
