param([switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$bin = Join-Path $project 'bin'
$config = Get-Content -LiteralPath (Join-Path $project 'adapter.config.json') -Raw | ConvertFrom-Json
$package = Get-AppxPackage OpenAI.Codex | Sort-Object Version -Descending | Select-Object -First 1
if (-not $package) { throw 'Codex desktop package not found.' }
[xml]$manifest = Get-Content -LiteralPath (Join-Path $package.InstallLocation 'AppxManifest.xml') -Raw
$entry = $manifest.Package.Applications.Application | Where-Object Id -eq 'App' | Select-Object -First 1
if (-not $entry.Executable) { throw 'Codex desktop manifest entry not found.' }
$executable = Join-Path $package.InstallLocation $entry.Executable
if (-not (Test-Path -LiteralPath $executable)) { throw 'Codex executable not found.' }
if (-not (Test-Path -LiteralPath (Join-Path $bin 'ssh.exe'))) { throw 'Run scripts\build.ps1 first.' }
$runtime = Get-Content -LiteralPath (Join-Path $bin 'runtime.json') -Raw | ConvertFrom-Json
if (-not (Test-Path -LiteralPath $runtime.node)) { throw 'Node runtime has moved; rebuild the launcher.' }
if (-not (Test-Path -LiteralPath $config.realSsh)) { throw 'System OpenSSH executable not found.' }
# Check the installed protocol even for previously tested versions.
# testedAppVersion is historical information, not an allowlist or a bypass.
$compatOutput = & $runtime.node (Join-Path $PSScriptRoot 'check-desktop.mjs') ([string]$package.Version) $package.InstallLocation --json
if ($LASTEXITCODE -ne 0) { throw 'Desktop SSH protocol is incompatible or could not be checked. Run npm run doctor for details; update the adapter before connecting.' }
$compat = $compatOutput | ConvertFrom-Json
Write-Output "OK Desktop $($compat.version): $($compat.checks) SSH protocol checks passed"
# Single-instance activation may silently reuse a process without our environment.
$running = @(Get-CimInstance Win32_Process | Where-Object {
    $_.ExecutablePath -and ($_.ExecutablePath -eq $executable -or $_.ExecutablePath -eq (Join-Path $package.InstallLocation 'app\ChatGPT.exe'))
})
if ($running.Count -gt 0 -and -not $CheckOnly) {
    throw 'Fully exit Codex from its tray/menu first, then run this launcher. Your running chats have not been stopped.'
}
if(-not $CheckOnly) {
    try { & (Join-Path $PSScriptRoot 'update-shortcut.ps1') -OnlyIfExists }
    catch { Write-Warning ("Cannot refresh shortcut icon: " + $_.Exception.Message) }
    & $runtime.node (Join-Path $PSScriptRoot 'prepare-package.mjs')
    if($LASTEXITCODE -ne 0){throw 'Cannot prepare Windows SSH package.'}
    $launchUri = & $runtime.node (Join-Path $PSScriptRoot 'prepare-startup.mjs') ([string]$compat.startupConfigRefreshSupported).ToLowerInvariant()
    if($LASTEXITCODE -ne 0){throw 'Cannot prepare native startup refresh.'}
    if($launchUri -notin @('codex://codex-app/apply-config','codex://settings/connections/ssh')) { throw 'Unexpected startup route.' }
}
$oldPath = $env:PATH
$oldAuto = $env:CODEX_WINDOWS_SSH_AUTO
try {
    $env:PATH = "$bin;$oldPath"
    $env:CODEX_WINDOWS_SSH_AUTO = '1'
    $resolved = (Get-Command ssh.exe -ErrorAction Stop).Source
    if ($resolved -ne (Join-Path $bin 'ssh.exe')) { throw 'The adapter was not selected by PATH.' }
    if ($CheckOnly) {
        Write-Output "App: $executable"
        Write-Output "Adapter: $resolved"
        Write-Output 'Target: automatic Windows detection; Unix SSH passthrough'
        Write-Output "Existing desktop processes: $($running.Count)"
        return
    }
    # Start-Process normally inherits the caller's environment; never use -UseNewEnvironment.
    $started = Start-Process -FilePath $executable -ArgumentList $launchUri -WorkingDirectory (Split-Path $executable) -PassThru
    if ($started.WaitForExit(1500) -and $started.ExitCode -ne 0) { throw "Desktop startup failed with code $($started.ExitCode)." }
} finally { $env:PATH = $oldPath; $env:CODEX_WINDOWS_SSH_AUTO=$oldAuto }
