import {execFileSync} from 'node:child_process';

// Inspect the Git index, not ignored machine state. Never echo matching contents.
const git = args => execFileSync('git', args, {windowsHide:true, maxBuffer:16*1024*1024});
const files = git(['ls-files','-z']).toString('utf8').split('\0').filter(Boolean);
if (!files.length) throw new Error('No staged or tracked files to inspect');
const forbidden = /^(?:node_modules|bin|work|logs|local)\/|^adapter\.config\.(?!example\.json$).*\.json$|^adapter\.config\.json$|(?:^|\/)\.env(?:\.|$)|\.(?:exe|lnk|zip|pem|key)$/i;
const patterns = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ['GitHub credential', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/],
  ['API credential', /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}\b/],
  ['credential in URL', /https?:\/\/[^\s/@:]+:[^\s/@]+@/i],
  ['personal Windows home', /[A-Z]:[\\/]+Users[\\/]+[^\s<>"'\\/]+/i],
  ['personal Unix home', /\/(?:home|Users)\/(?!example\b|user\b)[\w.-]+\//],
  ['private LAN address', /\b(?:192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/],
];
const failures=[];
for (const file of files) {
  if(forbidden.test(file)) failures.push(file+': local/generated/credential file');
  const content=git(['show',':'+file]);
  if(content.includes(0)) {failures.push(file+': binary content');continue;}
  const text=content.toString('utf8');
  for(const [label,pattern] of patterns) if(pattern.test(text)) failures.push(file+': '+label);
}
if(failures.length){console.error(failures.join('\n'));process.exitCode=1;}
else console.log('Publication check passed: '+files.length+' indexed text files; no prohibited files or matching sensitive patterns.');
