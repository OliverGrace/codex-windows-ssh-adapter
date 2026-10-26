import {maintenancePrefix, psCommand, runSsh} from './hosts.mjs';

// Fail before the local WebSocket handshake so Desktop can retry without MCP.
// A local ephemeral port may be reserved or occupied on the remote Windows host.
export async function checkDesktopForward(config, prefix, port, {run = runSsh} = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error('Invalid MCP port');
  if (!port) return;
  const script = `$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; $l=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,${port}); $l.Server.ExclusiveAddressUse=$true; try {$l.Start(); [Console]::WriteLine('CODEX_FORWARD_AVAILABLE')} catch {exit 42} finally {$l.Stop()}`;
  const result = await run(config, maintenancePrefix(prefix), psCommand(script), {timeout:15000});
  if (result.code === 42) throw Error('Remote loopback MCP port is reserved or occupied; retry without desktop MCP.');
  if (result.code !== 0 || !result.stdout.split(/\r?\n/).includes('CODEX_FORWARD_AVAILABLE'))
    throw Error('Cannot check remote MCP port. Verify SSH and remote powershell.exe execution permissions.');
  // This is a preflight, not a reservation: SSH and the remote proxy still enforce
  // ExitOnForwardFailure and the exclusive IPv4-loopback listener check.
}
