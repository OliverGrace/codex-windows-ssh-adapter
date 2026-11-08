import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {inspectSources} from './desktop-protocol.mjs';

export function inspectDesktop(pkg) {
  if(!pkg) {
    const pwsh=path.join(process.env.ProgramFiles??'C:\\Program Files','PowerShell','7','pwsh.exe');
    pkg=JSON.parse(execFileSync(fs.existsSync(pwsh)?pwsh:'powershell.exe',['-NoProfile','-Command',
      'Get-AppxPackage OpenAI.Codex | Sort-Object Version -Descending | Select-Object -First 1 Version,InstallLocation | ConvertTo-Json -Compress'],{encoding:'utf8',windowsHide:true}).trim());
  }
  if(!pkg?.InstallLocation||!pkg.Version)throw Error('Codex desktop package not found');
  const fd=fs.openSync(path.join(pkg.InstallLocation,'app','resources','app.asar'),'r');
  try {
    const b=Buffer.alloc(16);fs.readSync(fd,b,0,16,0);
    const size=b.readUInt32LE(12);
    if(size<2||size>32*1024*1024)throw Error('Unsupported Desktop archive header');
    const header=Buffer.alloc(size);fs.readSync(fd,header,0,size,16);
    const entries=JSON.parse(header).files?.['.vite']?.files?.build?.files;
    if(!entries)throw Error('Desktop JavaScript bundle layout changed');
    const sources=[];
    for(const [name,entry] of Object.entries(entries)) {
      if(!name.endsWith('.js')||entry.unpacked||entry.files)continue;
      const size=Number(entry.size),offset=Number(entry.offset);
      if(!Number.isSafeInteger(size)||size<0||size>64*1024*1024||!Number.isSafeInteger(offset)||offset<0)throw Error('Invalid Desktop bundle entry');
      const content=Buffer.alloc(size);
      if(fs.readSync(fd,content,0,size,8+b.readUInt32LE(4)+offset)!==size)throw Error('Incomplete Desktop bundle');
      sources.push({name,source:content.toString('utf8')});
    }
    return {version:String(pkg.Version),installLocation:pkg.InstallLocation,...inspectSources(sources)};
  } finally {fs.closeSync(fd);}
}
