import {spawn} from 'node:child_process';
import {serveBridge} from '../src/bridge.mjs';
serveBridge({input:process.stdin, output:process.stdout,
  clientScope:process.argv[2] || '',
  startChild:()=>spawn(process.execPath,[new URL('./mock-server.mjs',import.meta.url).pathname.replace(/^\/(.:)/,'$1')],{stdio:['pipe','pipe','inherit']}),
  onFinish:code=>process.exit(code)});
