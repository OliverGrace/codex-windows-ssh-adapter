import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { parseSshArgs, classifyCommand, remoteCommand, desktopForwardPort } from './commands.mjs';
import { serveBridge } from './bridge.mjs';
import {detectHost,ensureHost} from './hosts.mjs';
import {clientScope} from './client-identity.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const config = JSON.parse(fs.readFileSync(path.join(root, 'adapter.config.json'), 'utf8'));
const args = process.argv.slice(2);
let activeConfig=config;
function log(event, details = {}) {
  // Never log arguments, prompts, responses, credentials, or remote stderr.
  try { fs.mkdirSync(path.join(root, 'logs'), { recursive: true });
    const file = path.join(root, 'logs', 'adapter.jsonl');
    if (fs.existsSync(file) && fs.statSync(file).size > 2 * 1024 * 1024) fs.renameSync(file, file + '.previous');
    fs.appendFileSync(file, JSON.stringify({ time: new Date().toISOString(), pid: process.pid, event, ...details }) + '\n');
  } catch { /* Logging must not affect the protocol. */ }
}
function end(code) { process.exitCode = code; process.stdin.destroy(); process.stdout.end(() => process.exit(code)); }
function runRaw(argv) {
  const p = spawn(config.realSsh, argv, { stdio: 'inherit', windowsHide: true });
  p.on('error', () => end(127)); p.on('exit', code => end(code ?? 1));
}
function spawnRemote(prefix, operation, mcpPort=0) {
  return spawn(config.realSsh, [...prefix, remoteCommand(activeConfig, operation, mcpPort)], { windowsHide: true, stdio: ['pipe','pipe','pipe'] });
}

try {
  const parsed = parseSshArgs(args);
  const auto=config.autoDetectWindows===true||process.env.CODEX_WINDOWS_SSH_AUTO==='1';
  const target = auto || config.aliases.some(alias => alias.toLowerCase() === parsed.host?.toLowerCase());
  let command = target && !parsed.configQuery && parsed.remote ? classifyCommand(parsed.remote) : null;
  let handled=false;
  if(command&&auto) {
    let info=await detectHost(root,config,parsed,{fresh:command.operation==='lookup'});
    if(info.platform==='unix')command=null;
    else if(command.operation==='lookup'||command.operation==='version') {
      handled=true;
      if(!info.cli) {process.stderr.write('[Codex Windows SSH adapter] Codex CLI not found in this SSH account. Install CLI or set CODEX_CLI_PATH.\n');end(86);}
      else {if(command.marker)process.stdout.write(command.marker);if(command.operation==='version')process.stdout.write(info.cli.version+'\n');end(0);}
    } else if(command.operation==='bootstrap'||command.operation==='proxy') {
      if(!info.installed){log('automatic_setup');process.stderr.write('[Codex Windows SSH adapter] Preparing this Windows host for first use...\n');info=await ensureHost(root,config,info);}
      activeConfig={...config,durableHost:true,remoteVersion:info.installed.version,remoteRunner:info.installed.runner,remoteRunnerKind:info.installed.runnerKind};
    }
  }
  if(handled) { /* stdout is being flushed by end(). */ }
  else if (!command) { if (target && parsed.configQuery) log('ssh_config_query'); runRaw(args); }
  else {
    log('operation', { operation: command.operation });
    if (command.operation === 'unsupported' || command.operation === 'platform' || command.operation === 'kill') {
      process.stderr.write('[Codex Windows SSH adapter] This desktop operation is not supported; no remote command was executed. Install/update the Windows CLI directly, or reconnect to start a fresh bridge.\n'); end(64);
    } else if (command.operation === 'proxy' && parsed.reverseForward && !activeConfig.durableHost) {
      // The desktop will retry without its optional Linux-only MCP forwarding probe.
      log('desktop_mcp_fallback');
      process.stderr.write('[Codex Windows SSH adapter] Optional desktop MCP forwarding unavailable; retry without desktop MCP.\n'); end(1);
    } else if (command.operation === 'proxy') {
      if (!command.marker) throw new Error('Missing desktop stream marker');
      const mcpPort=desktopForwardPort(parsed,command);
      if(mcpPort)log('desktop_mcp_forward',{port:mcpPort});
      process.stdout.write(command.marker);
      serveBridge({ input: process.stdin, output: process.stdout, maxMessageBytes: config.maxMessageBytes,
        clientScope: activeConfig.durableHost ? clientScope(config, root, parsed.host) : '',
        startChild() { const p = spawnRemote(parsed.prefix, 'proxy',mcpPort); p.stderr.pipe(process.stderr); return p; }, onFinish: end, log });
    } else {
      const p = spawnRemote(parsed.prefix, command.operation);
      let stdout = '', stderr = '';
      p.stdin.end();
      p.stdout.on('data', data => { stdout = (stdout + data.toString('utf8')).slice(-65536); });
      p.stderr.on('data', data => { stderr = (stderr + data.toString('utf8')).slice(-65536); });
      p.once('error', () => end(127));
      p.once('close', code => {
        if (stderr) process.stderr.write(stderr);
        if (code !== 0) { end(code ?? 1); return; }
        if (command.operation === 'bootstrap' && !activeConfig.durableHost && (!stdout.includes('--stdio') || !stdout.includes('app-server'))) {
          process.stderr.write('[Codex Windows SSH adapter] Remote CLI does not support the required stdio server.\n'); end(65); return;
        }
        if (command.marker) process.stdout.write(command.marker);
        if (command.operation === 'version') process.stdout.write(stdout);
        if (command.operation === 'bootstrap') log(activeConfig.durableHost?'durable_host_ready':'bootstrap_deferred_to_proxy');
        end(0);
      });
    }
  }
} catch (error) {
  log('adapter_error', { type: error.name });
  process.stderr.write('[Codex Windows SSH adapter] '+error.message+'\n'); end(64);
}
