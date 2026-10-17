param([ValidateSet('proxy','start','status','stop')][string]$Operation='proxy', [int]$McpPort=0)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
$stateDir = Split-Path -Parent $PSScriptRoot
$settings = Get-Content -Raw -LiteralPath (Join-Path $stateDir 'settings.json') | ConvertFrom-Json
$taskName = if($settings.taskName){$settings.taskName}else{'CodexWindowsSshAdapter'}
if ($Operation -eq 'stop') { Stop-ScheduledTask -TaskName $taskName; exit 0 }
if ($Operation -eq 'status') {
  $saved=Get-Content -Raw -LiteralPath (Join-Path $stateDir 'status.json') | ConvertFrom-Json
  $saved | Add-Member -NotePropertyName taskState -NotePropertyValue ([string](Get-ScheduledTask -TaskName $taskName).State)
  $saved | ConvertTo-Json -Depth 5 -Compress
  exit 0
}
$task = Get-ScheduledTask -TaskName $taskName
if ($task.State -ne 'Running') { Start-ScheduledTask -TaskName $taskName }
$statusFile = Join-Path $stateDir 'status.json'
$ready = $false
for ($i=0; $i -lt 50; $i++) {
  if (Test-Path -LiteralPath $statusFile) {
    try {
      $status = Get-Content -Raw -LiteralPath $statusFile | ConvertFrom-Json
      $proc = Get-Process -Id $status.pid -ErrorAction Stop
      if ($proc.ProcessName -eq 'node' -and [Math]::Abs(($proc.StartTime.ToUniversalTime() - ([datetime]$status.startedAt).ToUniversalTime()).TotalSeconds) -lt 10) { $ready=$true; break }
    } catch {}
  }
  Start-Sleep -Milliseconds 200
}
if (!$ready) { throw 'Durable adapter task did not start' }
if ($Operation -eq 'start') { Write-Output 'Codex Windows SSH durable host ready'; exit 0 }
$env:CODEX_ADAPTER_STATE = $stateDir
$settings = Get-Content -Raw -LiteralPath (Join-Path $stateDir 'settings.json') | ConvertFrom-Json
& $settings.node (Join-Path $PSScriptRoot 'proxy.mjs') $McpPort
exit $LASTEXITCODE
