import readline from 'node:readline';
let attempts=0;
for await (const line of readline.createInterface({input:process.stdin})) {
  const m=JSON.parse(line);if(m.method!=='initialize')continue;
  attempts++;
  const name=m.params.clientInfo.name,mode=process.argv[2];
  if(!name.includes('-caps-')||mode==='always-reject') {
    const message=mode==='other-error'?'An unrelated error':'Client capabilities changed; finish tasks and restart the adapter service';
    process.stdout.write(JSON.stringify({id:m.id,error:{code:-32000,message}})+'\n');
  } else process.stdout.write(JSON.stringify({id:m.id,result:{...m.params,attempts}})+'\n');
}
