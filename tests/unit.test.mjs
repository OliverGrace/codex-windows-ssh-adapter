import test from 'node:test';
import assert from 'node:assert/strict';
import { shellWords, parseSshArgs, classifyCommand, remoteCommand,desktopForwardPort } from '../src/commands.mjs';
import { envelope, proxyCommand, lookupCommand, bootstrapCommand, quote } from './helpers.mjs';

test('nested POSIX quotes preserve Windows paths, Unicode, substitutions and all marker bytes', () => {
  const value = "C:\\fixtures\\我的项目\\O'Brien; $(do-not-execute)";
  assert.deepEqual(shellWords(quote(value)), [value]);
  for (let n = 0; n < 256; n++) {
    const marker = Buffer.alloc(8,n); const e = envelope(proxyCommand,marker);
    assert.deepEqual(classifyCommand(e.command), {operation:'proxy',marker});
  }
});
test('desktop MCP probe must exactly match an IPv4 loopback reverse forward',()=>{
  const probe=`listeners=$(awk 'example' /proc/net/tcp /proc/net/tcp6) || exit 1\n[ "$listeners" = '0100007F:1234' ] || exit 1\n`;
  const c=classifyCommand(envelope(probe+proxyCommand).command);
  assert.equal(c.mcpPort,4660);
  const parse=f=>parseSshArgs(['-R',f,'WINDOWS-HOST','x']);
  assert.equal(desktopForwardPort(parse('127.0.0.1:4660:127.0.0.1:4660'),c),4660);
  for(const f of ['0.0.0.0:4660:127.0.0.1:4660','127.0.0.1:4661:127.0.0.1:4660','127.0.0.1:4660:localhost:4660'])assert.throws(()=>desktopForwardPort(parse(f),c));
  assert.throws(()=>desktopForwardPort(parse('127.0.0.1:4660:127.0.0.1:4660'),{operation:'proxy'}));
  assert.throws(()=>desktopForwardPort(parseSshArgs(['-R','127.0.0.1:4660:127.0.0.1:4660','-o','RemoteForward=0.0.0.0:2222 localhost:2222','WINDOWS-HOST']),c));
});
test('only supported desktop operations are translated', () => {
  for (const [payload,operation] of [[lookupCommand,'lookup'],['codex --version','version'],[bootstrapCommand,'bootstrap'],[proxyCommand,'proxy']])
    assert.equal(classifyCommand(envelope(payload).command).operation,operation);
  assert.equal(classifyCommand('cmd.exe /c ver'),null);
  assert.equal(classifyCommand("sh -c 'echo hello'"),null);
  assert.equal(classifyCommand(envelope('rm -rf anything').command).operation,'unsupported');
  assert.equal(classifyCommand(envelope(`pkill -9 -U "$(id -u)" -f 'codex.* app-server.* --listen'`).command).operation,'kill');
  for(const payload of ['pkill -9 codex',`pkill -9 -U "$(id -u)" -f 'codex.* app-server.* --listen'; echo extra`])
    assert.equal(classifyCommand(envelope(payload).command).operation,'unsupported');
  assert.throws(() => shellWords("'unclosed"));
  assert.throws(() => remoteCommand({remoteCodexCommand:'codex.cmd & echo injected'},'proxy'));
});
test('SSH option parsing does not confuse option values with the destination', () => {
  const p = parseSshArgs(['-T','-vv','-o','BatchMode=yes','-oConnectTimeout=8','-p','22','-i','C:\\fixtures\\keys\\x key','WINDOWS-HOST','hello']);
  assert.equal(p.host,'WINDOWS-HOST'); assert.equal(p.remote,'hello'); assert.equal(p.configQuery,false);
  assert.equal(parseSshArgs(['-G','WINDOWS-HOST']).configQuery,true);
  assert.equal(parseSshArgs(['-R','127.0.0.1:4000:127.0.0.1:4001','WINDOWS-HOST','x']).reverseForward,true);
  assert.equal(parseSshArgs(['-oRemoteForward=1234 localhost:1235','WINDOWS-HOST','x']).reverseForward,true);
});
