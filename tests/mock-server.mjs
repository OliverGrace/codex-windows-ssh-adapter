import readline from 'node:readline';
const input = readline.createInterface({input:process.stdin});
for await (const line of input) {
  const m = JSON.parse(line);
  if (m.method === 'approval') process.stdout.write(JSON.stringify({id:'server-approval-1',method:'item/commandExecution/requestApproval',params:{command:'pwsh'}})+'\n');
  else if (m.method === 'bad-output') process.stdout.write('not-json\n');
  else if (m.method === 'fail') process.exit(23);
  else if (m.id !== undefined) process.stdout.write(JSON.stringify({id:m.id,result:m.params ?? m.result ?? null})+'\n');
}
