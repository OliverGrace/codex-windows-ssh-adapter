import {maintenancePrefix, psCommand, runSsh} from './hosts.mjs';

export function restartSessionCommand(name) {
  if (!/^[A-Za-z0-9_ -]{1,160}-[a-f0-9]{24}$/.test(name)) throw Error('Restart requires a scoped client identity');
  // Existing 0.2/0.3 hosts need no service update. Verify ownership before using
  // taskkill on this one session tree; never stop the host or match by image name.
  return psCommand(`$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue';
$file=Join-Path $env:LOCALAPPDATA 'CodexWindowsSshAdapter\\status.json';
$state=Get-Content -Raw -LiteralPath $file | ConvertFrom-Json;
$sessions=@($state.sessions | Where-Object name -CEQ '${name}');
if($sessions.Count -eq 0){[Console]::WriteLine('CODEX_SESSION_RESTARTED'); exit 0};
if($sessions.Count -ne 1){throw 'Ambiguous session identity'};
$hostProcess=Get-Process -Id $state.pid;
if($hostProcess.ProcessName -ne 'node' -or [Math]::Abs(($hostProcess.StartTime.ToUniversalTime()-([datetime]$state.startedAt).ToUniversalTime()).TotalSeconds) -gt 10){throw 'Stale adapter host status'};
$sessionPid=[int]$sessions[0].pid;
if($sessionPid -le 0 -or $sessionPid -eq [int]$state.pid){throw 'Invalid session process'};
$child=Get-CimInstance Win32_Process -Filter "ProcessId=$sessionPid";
if($null -eq $child -or $child.Name -ne 'codex.exe' -or [int]$child.ParentProcessId -ne [int]$state.pid -or $child.CreationDate -lt $hostProcess.StartTime){throw 'Session process ownership mismatch'};
& (Join-Path $env:SystemRoot 'System32\\taskkill.exe') /PID $sessionPid /T /F | Out-Null;
if($LASTEXITCODE -ne 0){throw 'Cannot terminate the selected session'};
for($i=0;$i -lt 50;$i++){
  $current=Get-Content -Raw -LiteralPath $file | ConvertFrom-Json;
  if([int]$current.pid -ne [int]$state.pid){throw 'Adapter host changed during restart'};
  if(!@($current.sessions | Where-Object { $_.name -ceq '${name}' -and [int]$_.pid -eq $sessionPid }).Count){[Console]::WriteLine('CODEX_SESSION_RESTARTED'); exit 0};
  Start-Sleep -Milliseconds 100;
}; throw 'Adapter has not released the old session'`);
}

export async function restartSession(config, prefix, name, {run = runSsh} = {}) {
  const result = await run(config, maintenancePrefix(prefix), restartSessionCommand(name), {timeout:30000});
  if (result.code !== 0 || !result.stdout.split(/\r?\n/).includes('CODEX_SESSION_RESTARTED'))
    throw Error('Cannot restart this Desktop session. Check its remote process ownership and SSH execution permissions.');
}
