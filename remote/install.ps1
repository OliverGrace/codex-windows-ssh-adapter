param(
 [Parameter(Mandatory=$true)][string]$Archive,
 [ValidatePattern('^CodexWindowsSshAdapter(?:-Test-[a-f0-9]{8})?$')][string]$Instance='CodexWindowsSshAdapter'
)
$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'
$stateDir=Join-Path $env:LOCALAPPDATA $Instance
$versionDir=Join-Path $stateDir 'v0.3.0'
$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$mutex=[Threading.Mutex]::new($false,"Global\$Instance-Install-$sid")
$locked=$false
try {
 try {$locked=$mutex.WaitOne(120000)} catch [Threading.AbandonedMutexException] {$locked=$true}
 if(!$locked){throw 'Another installer is running. Reconnect later.'}
 $existing=Get-ScheduledTask -TaskName $Instance -ErrorAction SilentlyContinue
 if($existing){
  $settings=Get-Content -Raw -LiteralPath (Join-Path $stateDir 'settings.json') | ConvertFrom-Json
  $existingDir=Join-Path $stateDir ('v'+$settings.version)
  if($settings.version -notin @('0.2.0','0.3.0') -or !(Test-Path -LiteralPath (Join-Path $existingDir 'entry.ps1'))){throw 'Existing adapter requires manual maintenance; no files changed.'}
  $native=Test-Path -LiteralPath (Join-Path $existingDir 'proxy-launcher.exe')
  $info=@{platform='windows';installed=@{version=$settings.version;runner=($native -or (Test-Path -LiteralPath (Join-Path $existingDir 'run-proxy.cmd')));runnerKind=$(if($native){'native'}else{'cmd'});taskState=[string]$existing.State;logonType=[string]$existing.Principal.LogonType}}
  [Console]::WriteLine('CODEX_WINDOWS_PROBE:'+ [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($info | ConvertTo-Json -Depth 6 -Compress))))
  return
 }
 New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
 & icacls.exe $stateDir /inheritance:r /grant:r "*${sid}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' | Out-Null
 if($LASTEXITCODE -ne 0){throw 'Cannot secure adapter directory'}
 Expand-Archive -LiteralPath $Archive -DestinationPath $versionDir -Force
 . (Join-Path $versionDir 'discover.ps1')
 $cli=Find-CodexExecutable
 if(!$cli){throw 'Codex CLI not found. Install native codex.exe or npm @openai/codex, or set CODEX_CLI_PATH.'}
 if(!$cli.compatible){throw 'Remote Codex CLI lacks app-server --stdio. Update CLI first.'}
 $node=Join-Path $versionDir 'runtime\node.exe'
 $nodeVersion=(& $node --version | Out-String).Trim()
 if($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v(2[2-9]|[3-9][0-9])\.'){throw 'Bundled Node cannot run on this Windows version/architecture.'}
 $bytes=New-Object byte[] 32
 $rng=[Security.Cryptography.RandomNumberGenerator]::Create();$rng.GetBytes($bytes);$rng.Dispose()
 $utf8=[Text.UTF8Encoding]::new($false)
 [IO.File]::WriteAllText((Join-Path $stateDir 'token'),[Convert]::ToBase64String($bytes),$utf8)
 [IO.File]::WriteAllText((Join-Path $stateDir 'settings.json'),(@{node=$node;codex=$cli.path;version='0.3.0';taskName=$Instance}|ConvertTo-Json),$utf8)
 $action=New-ScheduledTaskAction -Execute (Join-Path $versionDir 'host-launcher.exe')
 $taskSettings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
 try {
  $principal=New-ScheduledTaskPrincipal -UserId $sid -LogonType S4U -RunLevel Limited
  $trigger=New-ScheduledTaskTrigger -AtStartup
  Register-ScheduledTask -TaskName $Instance -Action $action -Principal $principal -Settings $taskSettings -Trigger $trigger -Description 'Persistent native Codex SSH adapter; private loopback transport.' | Out-Null
 } catch {
  if(Get-ScheduledTask -TaskName $Instance -ErrorAction SilentlyContinue){throw}
  $principal=New-ScheduledTaskPrincipal -UserId $sid -LogonType Interactive -RunLevel Limited
  $trigger=New-ScheduledTaskTrigger -AtLogOn -User $sid
  Register-ScheduledTask -TaskName $Instance -Action $action -Principal $principal -Settings $taskSettings -Trigger $trigger -Description 'Codex SSH adapter; Windows user must remain signed in.' | Out-Null
  [Console]::Error.WriteLine('S4U unavailable. Interactive task installed; keep this Windows user signed in.')
 }
 Start-ScheduledTask -TaskName $Instance
 $ready=$false
 for($i=0;$i -lt 50;$i++){
  Start-Sleep -Milliseconds 200
  try {
   $status=Get-Content -Raw -LiteralPath (Join-Path $stateDir 'status.json')|ConvertFrom-Json
   $proc=Get-Process -Id $status.pid -ErrorAction Stop
   if($proc.ProcessName -eq 'node' -and [Math]::Abs(($proc.StartTime.ToUniversalTime()-([datetime]$status.startedAt).ToUniversalTime()).TotalSeconds) -lt 10){$ready=$true;break}
  }catch{}
 }
 if(!$ready){throw 'Task installed but host did not start. Interactive tasks require this Windows user to be signed in. Check Task Scheduler permissions/history.'}
 $info=Get-AdapterProbe -Instance $Instance
 [Console]::WriteLine('CODEX_WINDOWS_PROBE:'+ [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($info|ConvertTo-Json -Depth 6 -Compress))))
} finally {
 if($locked){$mutex.ReleaseMutex()}
 $mutex.Dispose()
}
