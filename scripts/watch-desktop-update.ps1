param(
    [Parameter(Mandatory)][int]$ProcessId,
    [Parameter(Mandatory)][long]$StartedTicks,
    [Parameter(Mandatory)][string]$PackageFamily,
    [Parameter(Mandatory)][version]$SourceVersion
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'desktop-process.ps1')
$sessionId = [Diagnostics.Process]::GetCurrentProcess().SessionId
$startedUtc = [datetime]::new($StartedTicks, [DateTimeKind]::Utc)
$original = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
if (-not $original) { return }
try {
    if ($original.SessionId -ne $sessionId -or $original.StartTime.ToUniversalTime() -ne $startedUtc) { return }
    $original.WaitForExit()
} finally { $original.Dispose() }

# A normal exit must never cause a relaunch. Use the exact original process's
# accepted update record, then match its attempt ID on the new process.
$attempt = Find-AdapterDesktopUpdateAttempt -ProcessId $ProcessId -StartedUtc $startedUtc `
    -PackageFamily $PackageFamily -SourceVersion $SourceVersion
if (-not $attempt) { return }
# Store deployment can take longer than 30 seconds after the old App exits.
# Only a recorded update gets this wait. Ordinary quits return immediately.
for ($i = 0; $i -lt 90; $i++) {
    $package = Get-AppxPackage OpenAI.Codex | Where-Object PackageFamilyName -eq $PackageFamily |
        Sort-Object Version -Descending | Select-Object -First 1
    if ($package -and [version]$package.Version -gt $SourceVersion) {
        [xml]$manifest = Get-Content -LiteralPath (Join-Path $package.InstallLocation 'AppxManifest.xml') -Raw
        $entry = $manifest.Package.Applications.Application | Where-Object Id -eq 'App' | Select-Object -First 1
        if (-not $entry.Executable) { return }
        $exe = Join-Path $package.InstallLocation $entry.Executable
        $processName = [IO.Path]::GetFileName($exe).Replace("'", "''")
        foreach ($process in (Get-CimInstance Win32_Process -Filter "Name='$processName' AND SessionId=$sessionId")) {
            if (Test-AdapterUpdatedDesktopProcess -Process $process -SessionId $sessionId -ExecutablePath $exe -Attempt $attempt) {
                # Open the interactive shortcut. Its existing prompt requires
                # consent before closing any running App.
                $launcher = Join-Path (Split-Path -Parent $PSScriptRoot) 'Launch-Codex-Windows.cmd'
                Start-Process -FilePath $launcher -WindowStyle Normal
                return
            }
        }
    }
    Start-Sleep -Seconds 2
}
