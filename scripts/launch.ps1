param([switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$bin = Join-Path $project 'bin'
$adapter = Join-Path $bin 'ssh.exe'
$config = Get-Content -LiteralPath (Join-Path $project 'adapter.config.json') -Raw | ConvertFrom-Json
$package = Get-AppxPackage OpenAI.Codex | Sort-Object Version -Descending | Select-Object -First 1
if (-not $package) { throw 'Codex desktop package not found.' }
[xml]$manifest = Get-Content -LiteralPath (Join-Path $package.InstallLocation 'AppxManifest.xml') -Raw
$entry = $manifest.Package.Applications.Application | Where-Object Id -eq 'App' | Select-Object -First 1
if (-not $entry.Executable) { throw 'Codex desktop manifest entry not found.' }
$executable = Join-Path $package.InstallLocation $entry.Executable
if (-not (Test-Path -LiteralPath $executable)) { throw 'Codex executable not found.' }
# Launch through the package-specific execution alias so Windows gives Desktop
# its package identity. Starting the executable directly loses that identity.
$aliasNode = $entry.SelectSingleNode('./*[local-name()="Extensions"]/*[@Category="windows.appExecutionAlias" and not(@Executable)]//*[local-name()="ExecutionAlias"]')
$aliasName = if ($aliasNode) { $aliasNode.GetAttribute('Alias') }
if ($aliasName -notmatch '^[a-zA-Z0-9][a-zA-Z0-9._-]*\.exe$') { throw 'The Codex package does not declare an application execution alias.' }
$appEntryPoint = Join-Path $env:LOCALAPPDATA "Microsoft\WindowsApps\$($package.PackageFamilyName)\$aliasName"
if (-not (Test-Path -LiteralPath $appEntryPoint -PathType Leaf)) {
    throw "The packaged Codex entry point is missing. Enable $aliasName in Windows Settings > Apps > Advanced app settings > App execution aliases."
}
if ($CheckOnly -and -not (Test-Path -LiteralPath $adapter -PathType Leaf)) { throw 'The local SSH adapter is missing. Run scripts\build.ps1 or launch using the adapter shortcut.' }
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
. (Join-Path $PSScriptRoot 'desktop-process.ps1')
$desktopPaths = @($executable, (Join-Path $package.InstallLocation 'app\ChatGPT.exe')) | Select-Object -Unique
if (-not $CheckOnly -and -not (Wait-AdapterDesktopExit -ExecutablePaths $desktopPaths)) {
    return
}
if(-not $CheckOnly) {
    if (-not (Test-Path -LiteralPath $adapter -PathType Leaf)) {
        Write-Output 'Local SSH adapter missing. Rebuilding it from this checkout...'
        & (Join-Path $PSScriptRoot 'build.ps1')
        if (-not (Test-Path -LiteralPath $adapter -PathType Leaf)) { throw 'The local SSH adapter is still missing after rebuilding.' }
    }
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
    if ($resolved -ne $adapter) { throw 'The adapter was not selected by PATH.' }
    if ($CheckOnly) {
        Write-Output "App: $executable"
        Write-Output "Packaged entry point: $appEntryPoint"
        Write-Output "Adapter: $resolved"
        Write-Output 'Target: automatic Windows detection; Unix SSH passthrough'
        Write-Output "Existing desktop processes: $(@(Get-AdapterDesktopProcess -ExecutablePaths $desktopPaths).Count)"
        return
    }
    # Use CreateProcess through the execution alias, so the App receives both
    # its package identity and the SSH environment inherited from this process.
    $launch = New-Object System.Diagnostics.ProcessStartInfo
    $launch.FileName = $appEntryPoint
    $launch.Arguments = $launchUri
    $launch.WorkingDirectory = Split-Path -Parent $executable
    $launch.UseShellExecute = $false
    $started = [System.Diagnostics.Process]::Start($launch)
    $pwsh = Join-Path $env:ProgramFiles 'PowerShell\7\pwsh.exe'
    $helperShell = if (Test-Path -LiteralPath $pwsh) { $pwsh } else { 'powershell.exe' }
    try {
        if ($started.WaitForExit(1500)) {
            if ($started.ExitCode -ne 0) { throw "Desktop startup failed with code $($started.ExitCode)." }
        } else {
            try {
                $watchScript = Join-Path $PSScriptRoot 'watch-desktop-update.ps1'
                $watchArgs = '-NoProfile -ExecutionPolicy Bypass -File "{0}" -ProcessId {1} -StartedTicks {2} -PackageFamily {3} -SourceVersion {4}' -f
                    $watchScript, $started.Id, $started.StartTime.ToUniversalTime().Ticks, $package.PackageFamilyName, $package.Version
                Start-Process -FilePath $helperShell -ArgumentList $watchArgs -WindowStyle Hidden -WorkingDirectory $project | Out-Null
            } catch { Write-Warning ("Cannot watch for Desktop update restart: " + $_.Exception.Message) }
        }
    } finally { $started.Dispose() }
    # The App may recreate its Start Menu link after our pre-launch icon repair.
    # A hidden, bounded helper repairs it again without restarting Explorer/App.
    try {
        $iconScript = Join-Path $PSScriptRoot 'refresh-taskbar-icon.ps1'
        $iconArgs = '-NoProfile -ExecutionPolicy Bypass -File "' + $iconScript + '" -WatchStartup'
        Start-Process -FilePath $helperShell -ArgumentList $iconArgs -WindowStyle Hidden -WorkingDirectory $project | Out-Null
    } catch { Write-Warning ("Cannot schedule taskbar icon refresh: " + $_.Exception.Message) }
} finally { $env:PATH = $oldPath; $env:CODEX_WINDOWS_SSH_AUTO=$oldAuto }
