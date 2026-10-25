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
    const readEntry=name=>{
      const entry=entries[name], content=Buffer.alloc(Number(entry.size));
      fs.readSync(fd,content,0,content.length,8+b.readUInt32LE(4)+Number(entry.offset));
      return content.toString('utf8');
    };
    const main=readEntry(name);
    let source=main, first='aS', next='oS';
    let names={quote:'iS',octal:'jme',path:'Eme',home:'Dme'};
    // This reviewed release moved the same pure shell formatter into bootstrap.
    // Keep the version guard: future minifier names must not select unrelated code.
    if(pkg.Version==='26.1021.3705.0') {
      const bootstrap=/require\("\.\/(bootstrap-[^"/]+\.js)"\)/.exec(main)?.[1];
      if(!bootstrap||!entries[bootstrap])throw new Error('Desktop bootstrap bundle not found');
      source=readEntry(bootstrap); first='nO'; next='rO';
      names={quote:'tO',octal:'cO',path:'$D',home:'eO'};
      if(!source.includes('exports.gt=nO')||!main.includes('_.gt(i,a)'))throw new Error('Desktop SSH formatter call changed');
    } else if(pkg.Version!=='26.1013.4894.0') {
      throw new Error('Desktop version has not been reviewed: '+pkg.Version);
    }
    const start=source.indexOf('function '+first+'('), end=source.indexOf('function '+next+'(',start);
    if(start<0||end<start||end-start>5000||!main.includes('app-server proxy')||!main.includes('CODEX_SSH_SKIP_APP_SERVER_BOOT')||!source.slice(start,end).includes('CODEX_REMOTE_PAYLOAD'))throw new Error('Desktop command layout changed; review adapter before activation');
    // Only the small, pure command-formatting function from the installed, trusted
    // desktop package runs here. No state or application startup code is evaluated.
    const shellQuote=e=>`'${e.replaceAll("'","'\\''")}'`;
    const wrap=vm.runInNewContext(source.slice(start,end)+'; '+first,{
      [names.quote]:shellQuote,[names.octal]:e=>Array.from(e,b=>'\\'+b.toString(8).padStart(3,'0')).join(''),
      [names.path]:'PATH="${CODEX_INSTALL_DIR:-$HOME/.local/bin}:$PATH"; export PATH',
      [names.home]:'CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"; export CODEX_HOME'
    },{timeout:1000});
    return {version:pkg.Version,installLocation:pkg.InstallLocation,wrap};
  } finally {fs.closeSync(fd);}
}
