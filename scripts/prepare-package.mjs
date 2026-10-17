import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const quote=s=>"'"+s.replaceAll("'","''")+"'";
const licenseFile=path.join(root,'third_party','Node-'+process.version+'-LICENSE.txt');
if(!fs.existsSync(licenseFile)) {
  const url='https://raw.githubusercontent.com/nodejs/node/'+process.version+'/LICENSE';
  fs.mkdirSync(path.dirname(licenseFile),{recursive:true});
  let license;
  try {
    const response=await fetch(url,{signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw Error('License download failed: HTTP '+response.status);
    license=await response.text();
  } catch {
    // Windows PowerShell uses Windows networking/proxy settings, which may differ
    // from Node fetch. Keep certificate validation enabled on both paths.
    console.log('Retrying Node license download with Windows networking');
    const temporary=licenseFile+'.'+crypto.randomBytes(6).toString('hex')+'.tmp';
    try {
      execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',
        `$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -UseBasicParsing -TimeoutSec 60 -Uri ${quote(url)} -OutFile ${quote(temporary)}`],
        {windowsHide:true,stdio:['ignore','ignore','pipe'],timeout:70000});
      license=fs.readFileSync(temporary,'utf8');
    } catch {
      throw Error('Cannot download the Node runtime license. Check HTTPS/proxy access to raw.githubusercontent.com or place the matching LICENSE at '+licenseFile);
    } finally {fs.rmSync(temporary,{force:true});}
  }
  if(!license.includes('Permission is hereby granted')||!license.includes('Node.js'))throw Error('Unexpected Node license content');
  fs.writeFileSync(licenseFile,license);
}
const files=fs.readdirSync(path.join(root,'remote')).filter(n=>!n.endsWith('.exe'));
const hash=crypto.createHash('sha256').update(process.version).update(process.execPath);
for(const name of files)hash.update(name).update(fs.readFileSync(path.join(root,'remote',name)));
hash.update(fs.readFileSync(path.join(root,'src','SshLauncher.cs'))).update(fs.readFileSync(path.join(root,'package-lock.json'))).update(fs.readFileSync(licenseFile));
const fingerprint=hash.digest('hex'),archive=path.join(root,'bin','remote-v0.3.0.zip'),meta=archive+'.sha256';
try {if(fs.existsSync(archive)&&fs.readFileSync(meta,'utf8')===fingerprint){console.log('Windows SSH package ready');process.exit(0);}}catch{}
execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts','build-remote.ps1')],{windowsHide:true,stdio:'inherit'});
const stage=path.join(root,'work','remote-v0.3.0');fs.mkdirSync(stage,{recursive:true});
for(const name of [...files,'host-launcher.exe','proxy-launcher.exe'])fs.copyFileSync(path.join(root,'remote',name),path.join(stage,name));
fs.mkdirSync(path.join(stage,'node_modules'),{recursive:true});fs.cpSync(path.join(root,'node_modules','ws'),path.join(stage,'node_modules','ws'),{recursive:true});
fs.mkdirSync(path.join(stage,'runtime'),{recursive:true});fs.copyFileSync(process.execPath,path.join(stage,'runtime','node.exe'));
fs.copyFileSync(licenseFile,path.join(stage,'runtime','LICENSE.txt'));
fs.writeFileSync(path.join(stage,'runtime','README.txt'),'Private portable copy of the local Node.js '+process.version+' runtime. Source/license: https://github.com/nodejs/node/blob/'+process.version+'/LICENSE\r\n');
execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-Command',`Compress-Archive -Path ${quote(stage+'\\*')} -DestinationPath ${quote(archive)} -Force`],{windowsHide:true,stdio:'inherit'});
fs.writeFileSync(meta,fingerprint);console.log('Prepared portable Windows SSH package ('+Math.ceil(fs.statSync(archive).size/1024/1024)+' MiB)');
