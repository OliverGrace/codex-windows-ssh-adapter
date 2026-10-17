import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';

export function inspectDesktop() {
  const pkg=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',
    'Get-AppxPackage OpenAI.Codex | Sort-Object Version -Descending | Select-Object -First 1 Version,InstallLocation | ConvertTo-Json -Compress'],{encoding:'utf8',windowsHide:true}).trim());
  const fd=fs.openSync(path.join(pkg.InstallLocation,'app','resources','app.asar'),'r');
  try {
    const b=Buffer.alloc(16); fs.readSync(fd,b,0,16,0);
    const header=Buffer.alloc(b.readUInt32LE(12));fs.readSync(fd,header,0,header.length,16);
    const entries=JSON.parse(header).files['.vite'].files.build.files;
    const name=Object.keys(entries).find(n=>/^main-.*\.js$/.test(n));
    if(!name)throw new Error('Desktop main bundle not found');
    const entry=entries[name], content=Buffer.alloc(Number(entry.size));
    fs.readSync(fd,content,0,content.length,8+b.readUInt32LE(4)+Number(entry.offset));
    const source=content.toString('utf8');
    const start=source.indexOf('function aS('), end=source.indexOf('function oS(',start);
    if(start<0||end<start||end-start>5000||!source.includes('app-server proxy')||!source.includes('CODEX_SSH_SKIP_APP_SERVER_BOOT'))throw new Error('Desktop command layout changed; review adapter before activation');
    // Only the small, pure command-formatting function from the installed, trusted
    // desktop package runs here. No state or application startup code is evaluated.
    const shellQuote=e=>`'${e.replaceAll("'","'\\''")}'`;
    const wrap=vm.runInNewContext(source.slice(start,end)+'; aS',{
      iS:shellQuote,jme:e=>Array.from(e,b=>'\\'+b.toString(8).padStart(3,'0')).join(''),
      Eme:'PATH="${CODEX_INSTALL_DIR:-$HOME/.local/bin}:$PATH"; export PATH',
      Dme:'CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"; export CODEX_HOME'
    },{timeout:1000});
    return {version:pkg.Version,installLocation:pkg.InstallLocation,wrap};
  } finally {fs.closeSync(fd);}
}
