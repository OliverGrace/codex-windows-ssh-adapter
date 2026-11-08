import {spawn} from 'node:child_process';
import {serveBridge} from '../src/bridge.mjs';
serveBridge({input:process.stdin, output:process.stdout,
  clientScope:process.argv[2] || '',
  startChild:()=>spawn(process.execPath,[new URL(process.argv[3]?'./mock-capability-server.mjs':'./mock-server.mjs',import.meta.url).pathname.replace(/^\/(.:)/,'$1'),process.argv[3]??''],{stdio:['pipe','pipe','inherit']}),
  onFinish:code=>process.exit(code)});
