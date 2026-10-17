function Find-CodexExecutable {
    $candidates = [Collections.Generic.List[string]]::new()
    if ($env:CODEX_CLI_PATH) { $candidates.Add($env:CODEX_CLI_PATH) }
    foreach ($command in @(Get-Command codex.exe -All -ErrorAction SilentlyContinue)) { $candidates.Add($command.Source) }
    $shims = @(Get-Command codex.cmd -All -ErrorAction SilentlyContinue | ForEach-Object { $_.Source })
    $shims += (Join-Path $env:APPDATA 'npm\codex.cmd')
    foreach ($shim in $shims) {
        $prefix = Split-Path -Parent $shim
        foreach ($arch in @(@('x64','x86_64'),@('arm64','aarch64'))) {
            $candidates.Add((Join-Path $prefix ('node_modules\@openai\codex\node_modules\@openai\codex-win32-'+$arch[0]+'\vendor\'+$arch[1]+'-pc-windows-msvc\bin\codex.exe')))
            $candidates.Add((Join-Path $prefix ('node_modules\@openai\codex\vendor\'+$arch[1]+'-pc-windows-msvc\bin\codex.exe')))
        }
    }
    $candidates.Add((Join-Path $env:USERPROFILE '.local\bin\codex.exe'))
    $candidates.Add((Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\codex.exe'))
    foreach ($candidate in ($candidates | Select-Object -Unique)) {
        if (!(Test-Path -LiteralPath $candidate -PathType Leaf)) { continue }
        try {
            $version = (& $candidate --version 2>$null | Out-String).Trim()
            if ($LASTEXITCODE -eq 0 -and $version -match '^codex-cli\s') {
                $help = (& $candidate app-server --help 2>$null | Out-String)
                return @{ path=[IO.Path]::GetFullPath($candidate); version=$version; compatible=($LASTEXITCODE -eq 0 -and $help.Contains('--stdio')) }
            }
        } catch {}
    }
    return $null
}

function Get-AdapterProbe {
    param([string]$Instance='CodexWindowsSshAdapter')
    $stateDir=Join-Path $env:LOCALAPPDATA $Instance
    $installed=$null
    if (Test-Path -LiteralPath (Join-Path $stateDir 'settings.json')) {
        try {
            $settings=Get-Content -Raw -LiteralPath (Join-Path $stateDir 'settings.json') | ConvertFrom-Json
            if ($settings.version -in @('0.2.0','0.3.0')) {
                $entryDir=Join-Path $stateDir ('v'+$settings.version)
                $task=Get-ScheduledTask -TaskName $Instance -ErrorAction Stop
                if ((Test-Path -LiteralPath (Join-Path $entryDir 'entry.ps1')) -and (Test-Path -LiteralPath $settings.node)) {
                    $native=Test-Path -LiteralPath (Join-Path $entryDir 'proxy-launcher.exe')
                    $installed=@{version=$settings.version; runner=($native -or (Test-Path -LiteralPath (Join-Path $entryDir 'run-proxy.cmd')));runnerKind=$(if($native){'native'}else{'cmd'});taskState=[string]$task.State;logonType=[string]$task.Principal.LogonType}
                }
            }
        } catch {}
    }
    return @{platform='windows'; machine=$env:COMPUTERNAME; architecture=$env:PROCESSOR_ARCHITECTURE; cli=(Find-CodexExecutable); installed=$installed}
}
