import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function profilePrefix(base) {
  const match=/^(.+)-([a-f0-9]{24})$/.exec(base);
  if(!match)throw Error('Capability profile requires a scoped identity');
  return [match[1].slice(0,110),match[2]];
}
export function capabilityProfile(base,capabilities) {
  const [head,scope]=profilePrefix(base);
  // Match the durable host's exact JSON comparison, including property order.
  const hash=crypto.createHash('sha256').update(JSON.stringify(capabilities??{})).digest('hex').slice(0,24);
  return `${head}-caps-${hash}-${scope}`;
}
function validate(base,selected) {
  if(selected===base)return;
  const [head,scope]=profilePrefix(base),prefix=head+'-caps-',suffix='-'+scope;
  if(typeof selected!=='string'||!selected.startsWith(prefix)||!selected.endsWith(suffix)||
    !/^[a-f0-9]{24}$/.test(selected.slice(prefix.length,-suffix.length)))throw Error('Invalid active session profile');
}
function file(root,base) {
  return path.join(root,'work','active-sessions',crypto.createHash('sha256').update(base).digest('hex')+'.json');
}
export function saveActiveSession(root,base,selected) {
  validate(base,selected);
  const target=file(root,base);fs.mkdirSync(path.dirname(target),{recursive:true});
  const temporary=target+'.'+crypto.randomUUID()+'.tmp';
  fs.writeFileSync(temporary,JSON.stringify({base,selected}));fs.renameSync(temporary,target);
}
export function activeSession(root,base) {
  let saved;
  try {saved=JSON.parse(fs.readFileSync(file(root,base),'utf8'));}
  catch(error){if(error.code==='ENOENT')return base;throw error;}
  if(saved.base!==base)throw Error('Active session scope mismatch');
  validate(base,saved.selected);return saved.selected;
}
