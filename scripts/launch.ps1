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
if ([string]$package.Version -ne $config.testedAppVersion) {
    throw "Codex changed to $($package.Version). Run the compatibility tests before updating testedAppVersion."
}
# Single-instance activation may silently reuse a process without our environment.
$running = @(Get-CimInstance Win32_Process | Where-Object {
    $_.ExecutablePath -and ($_.ExecutablePath -eq $executable -or $_.ExecutablePath -eq (Join-Path $package.InstallLocation 'app\ChatGPT.exe'))
})
if ($running.Count -gt 0 -and -not $CheckOnly) {
    throw 'Fully exit Codex from its tray/menu first, then run this launcher. Your running chats have not been stopped.'
}
if(-not $CheckOnly) {
    & $runtime.node (Join-Path $PSScriptRoot 'prepare-package.mjs')
    if($LASTEXITCODE -ne 0){throw 'Cannot prepare Windows SSH package.'}
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
    $started = Start-Process -FilePath $executable -ArgumentList 'codex://settings/connections/ssh' -WorkingDirectory (Split-Path $executable) -PassThru
    if ($started.WaitForExit(1500) -and $started.ExitCode -ne 0) { throw "Desktop startup failed with code $($started.ExitCode)." }
} finally { $env:PATH = $oldPath; $env:CODEX_WINDOWS_SSH_AUTO=$oldAuto }
