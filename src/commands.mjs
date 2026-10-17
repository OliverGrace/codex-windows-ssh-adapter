// Parse only shell quoting; never evaluate substitutions, expansions, or commands.
export function shellWords(text) {
  const result = []; let word = '', mode = '', active = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (mode === "'") { if (c === "'") mode = ''; else word += c; active = true; continue; }
    if (mode === '"') {
      if (c === '"') mode = '';
      else if (c === '\\' && /[\\"$`\n]/.test(text[i + 1] ?? '')) { const next = text[++i]; if (next !== '\n') word += next; }
      else word += c;
      active = true; continue;
    }
    if (c === "'" || c === '"') { mode = c; active = true; }
    else if (/\s/.test(c)) { if (active) { result.push(word); word = ''; active = false; } }
    else if (c === '\\') { if (++i >= text.length) throw new Error('Trailing shell escape'); word += text[i]; active = true; }
    else { word += c; active = true; }
  }
  if (mode) throw new Error('Unclosed shell quote');
  if (active) result.push(word);
  return result;
}

const optionValues = new Set(['B','b','c','D','E','e','F','I','i','J','L','l','m','O','o','P','p','Q','R','S','W','w']);
export function parseSshArgs(args) {
  let hostIndex = -1, configQuery = false, reverseForward = false;
  const reverseForwards=[];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') { hostIndex = i + 1; break; }
    if (!a.startsWith('-') || a === '-') { hostIndex = i; break; }
    for (let j = 1; j < a.length; j++) {
      const flag = a[j];
      if (flag === 'G' || flag === 'Q' || flag === 'V') configQuery = true;
      if (flag === 'R') reverseForward = true;
      if (optionValues.has(flag)) {
        const value = a.slice(j + 1) || args[++i];
        if (value === undefined) throw new Error(`Missing SSH -${flag} argument`);
        if (flag === 'R') reverseForwards.push(value);
        if (flag === 'o' && /^RemoteForward(?:=|\s)/i.test(value)) { reverseForward = true; reverseForwards.push(value.replace(/^RemoteForward(?:=|\s)+/i,'')); }
        break;
      }
    }
  }
  return { hostIndex, host: args[hostIndex], prefix: hostIndex < 0 ? args : args.slice(0, hostIndex + 1),
    remote: hostIndex < 0 ? '' : args.slice(hostIndex + 1).join(' '), configQuery, reverseForward, reverseForwards };
}

const pathPrefix = 'PATH="${CODEX_INSTALL_DIR:-$HOME/.local/bin}:$PATH"; export PATH; ';
export function classifyCommand(remote) {
  if (!remote.startsWith('sh -c ')) return null;
  const words = shellWords(remote);
  if (words.length !== 5 || words[0] !== 'sh' || words[1] !== '-c' || words[3] !== 'sh' ||
      !words[2].includes('CODEX_REMOTE_PAYLOAD="$1"') || !words[2].includes('Codex remote SSH requires SHELL')) return null;
  let payload = words[4], marker = null;
  const match = /^printf '%b' '((?:\\[0-7]{3}){8})'; /.exec(payload);
  if (match) { marker = Buffer.from(match[1].match(/[0-7]{3}/g).map(s => parseInt(s, 8))); payload = payload.slice(match[0].length); }
  if (!payload.startsWith(pathPrefix)) return { operation: 'unsupported', marker };
  const command = payload.slice(pathPrefix.length);
  let operation = 'unsupported';
  if (/^if command -v (?:codex|'codex') >\/dev\/null 2>&1; then exit 0; fi; exit 86$/.test(command)) operation = 'lookup';
  else if (/^(?:codex|'codex') --version$/.test(command)) operation = 'version';
  else if (command.startsWith('if [ "${CODEX_SSH_SKIP_APP_SERVER_BOOT:-}" = "true" ]; then exit 0; fi; ') &&
           command.includes('nohup ') && /app-server --listen (?:'unix:\/\/'|unix:\/\/)/.test(command)) operation = 'bootstrap';
  else if (/&& exec (?:codex|'codex') app-server proxy$/.test(command)) operation = 'proxy';
  else if (command === 'uname -s') operation = 'platform';
  else if (command.startsWith('pkill -9 ')) operation = 'kill';
  if(operation==='proxy'&&command.includes('listeners=$(awk')) {
    const match=/\[ "\$listeners" = '0100007F:([0-9A-F]{4})' \] \|\| exit 1/.exec(command);
    if(!match) return {operation:'unsupported',marker};
    return {operation,marker,mcpPort:parseInt(match[1],16)};
  }
  return { operation, marker };
}

export function desktopForwardPort(parsed, command) {
  if(!parsed.reverseForward&&!command.mcpPort)return 0;
  if(!command.mcpPort||parsed.reverseForwards.length!==1)throw new Error('Unrecognized desktop MCP forward');
  const m=/^127\.0\.0\.1:(\d+):127\.0\.0\.1:(\d+)$/.exec(parsed.reverseForwards[0]);
  if(!m||Number(m[1])!==command.mcpPort||Number(m[2])!==command.mcpPort||command.mcpPort<1||command.mcpPort>65535)
    throw new Error('MCP forward does not match the loopback probe');
  return command.mcpPort;
}

export function remoteCommand(config, operation, mcpPort=0) {
  // Configured basename only: no shell metacharacters, paths, or caller-supplied code.
  if (!/^[A-Za-z0-9_.-]+\.cmd$/i.test(config.remoteCodexCommand)) throw new Error('remoteCodexCommand must be a .cmd basename');
  const cli = config.remoteCodexCommand;
  if (operation === 'lookup' || operation === 'version') return `cmd.exe /d /c ${cli} --version`;
  if(config.durableHost&&(operation==='bootstrap'||operation==='proxy')) {
    if(!Number.isInteger(mcpPort)||mcpPort<0||mcpPort>65535)throw new Error('Invalid port');
    const version=config.remoteVersion??'0.2.0';
    if(!['0.2.0','0.3.0'].includes(version))throw new Error('Unknown remote adapter version');
    if(config.remoteRunnerKind==='native'&&operation==='proxy') {
      const script=`$ProgressPreference='SilentlyContinue'; [Console]::InputEncoding=[Text.UTF8Encoding]::new($false); [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); $OutputEncoding=[Console]::OutputEncoding; & (Join-Path $env:LOCALAPPDATA 'CodexWindowsSshAdapter\\v${version}\\proxy-launcher.exe') ${mcpPort}; exit $LASTEXITCODE`;
      return 'powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand '+Buffer.from(script,'utf16le').toString('base64');
    }
    if(config.remoteRunner&&operation==='proxy')return `cmd.exe /d /c "%LOCALAPPDATA%\\CodexWindowsSshAdapter\\v${version}\\run-proxy.cmd" ${mcpPort}`;
    if(operation==='bootstrap'||config.remoteVersion) {
      const script=`$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; [Console]::InputEncoding=[Text.UTF8Encoding]::new($false); [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); $OutputEncoding=[Console]::OutputEncoding; & (Join-Path $env:LOCALAPPDATA 'CodexWindowsSshAdapter\\v${version}\\entry.ps1') -Operation ${operation==='bootstrap'?'start':'proxy'} -McpPort ${mcpPort}; exit $LASTEXITCODE`;
      return 'powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand '+Buffer.from(script,'utf16le').toString('base64');
    }
    if(operation==='proxy')return `cmd.exe /d /c node.exe "%LOCALAPPDATA%\\CodexWindowsSshAdapter\\v0.2.0\\proxy.mjs" ${mcpPort}`;
  }
  if (operation === 'bootstrap') return `cmd.exe /d /c ${cli} app-server --help`;
  if (operation === 'proxy') return `cmd.exe /d /c ${cli} -c features.code_mode_host=true app-server --stdio`;
  throw new Error(`Unsupported operation: ${operation}`);
}
