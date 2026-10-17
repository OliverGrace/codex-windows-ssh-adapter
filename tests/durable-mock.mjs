import readline from 'node:readline';
const send=m=>process.stdout.write(JSON.stringify(m)+'\n');let initialized=0;
for await(const line of readline.createInterface({input:process.stdin})) {
  const m=JSON.parse(line);
  if(m.method==='initialize')send({id:m.id,result:{pid:process.pid}});
  else if(m.method==='initialized')initialized++;
  else if(m.method==='delay')setTimeout(()=>{send({method:'test/done',params:m.params});send({id:m.id,result:m.params});},300);
  else if(m.method==='approval')setTimeout(()=>send({id:'approval-1',method:'item/commandExecution/requestApproval',params:{command:'test'}}),300);
  else if(!m.method)send({method:'test/approval',params:m.result});
  else if(m.method==='count')send({id:m.id,result:initialized});
  else if(m.id!==undefined)send({id:m.id,result:m.params});
}
