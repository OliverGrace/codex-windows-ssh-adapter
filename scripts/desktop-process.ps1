function Get-AdapterDesktopProcess {
    param([string[]]$ExecutablePaths)
    $session = [System.Diagnostics.Process]::GetCurrentProcess().SessionId
    $names = @($ExecutablePaths | ForEach-Object { [IO.Path]::GetFileNameWithoutExtension($_) } | Select-Object -Unique)
    Get-Process -Name $names -ErrorAction SilentlyContinue | Where-Object {
        $_.SessionId -eq $session -and $_.Path -and $_.Path -in $ExecutablePaths
    }
}

function Read-AdapterRestartConfirmation {
    Write-Host 'Codex is still running. Force close it and start again? This may interrupt local tasks.'
    Write-Host 'Press Enter or Y to confirm; any other input cancels: ' -NoNewline
    $answer = [Console]::ReadLine()
    # EOF is not an Enter key press, including when launched without a console.
    return $null -ne $answer -and ($answer -eq '' -or $answer -eq 'y')
}

function Stop-AdapterDesktopProcess {
    param([string[]]$ExecutablePaths)
    foreach ($candidate in @(Get-AdapterDesktopProcess -ExecutablePaths $ExecutablePaths)) {
        $process = $null
        try {
            $process = Get-Process -Id $candidate.Id -ErrorAction SilentlyContinue
            if ($null -eq $process) { continue }
            # Pin the process handle before rechecking identity, so a recycled
            # PID cannot target a different process between validation and Kill.
            $null = $process.Handle
            if ($process.HasExited) { continue }
            if ($process.StartTime -ne $candidate.StartTime -or
                $process.SessionId -ne [System.Diagnostics.Process]::GetCurrentProcess().SessionId -or
                $process.Path -notin $ExecutablePaths) { continue }
            $process.Kill()
        } catch {
            if ($null -eq $process -or -not $process.HasExited) { throw }
        } finally {
            if ($null -ne $process) { $process.Dispose() }
            $candidate.Dispose()
        }
    }
}

function Wait-AdapterDesktopExit {
    param([string[]]$ExecutablePaths)
    if (@(Get-AdapterDesktopProcess -ExecutablePaths $ExecutablePaths).Count -eq 0) { return $true }
    Write-Host 'Codex is still exiting. Retrying in 3 seconds...'
    Start-Sleep -Seconds 3
    if (@(Get-AdapterDesktopProcess -ExecutablePaths $ExecutablePaths).Count -eq 0) { return $true }
    if (-not (Read-AdapterRestartConfirmation)) {
        Write-Host 'Launch cancelled.'
        return $false
    }
    Stop-AdapterDesktopProcess -ExecutablePaths $ExecutablePaths
    # Wait for the single-instance owner to disappear before launching again.
    for ($attempt = 0; $attempt -lt 25; $attempt++) {
        if (@(Get-AdapterDesktopProcess -ExecutablePaths $ExecutablePaths).Count -eq 0) { return $true }
        Start-Sleep -Milliseconds 200
    }
    throw 'Codex did not exit after force close. The launcher has not started another instance.'
}

function Find-AdapterDesktopUpdateAttempt {
    param([int]$ProcessId, [datetime]$StartedUtc, [string]$PackageFamily, [version]$SourceVersion,
        [string]$LogRoot = (Join-Path $env:LOCALAPPDATA 'Codex\Logs'))
    $familyPattern = [regex]::Escape($PackageFamily)
    $sourcePattern = [regex]::Escape($SourceVersion.ToString())
    $guidPattern = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
    $now = [datetime]::UtcNow
    $directories = @($now, $now.AddDays(-1)) | ForEach-Object { Join-Path $LogRoot $_.ToString('yyyy/MM/dd', [Globalization.CultureInfo]::InvariantCulture) }
    $files = Get-ChildItem -LiteralPath $directories -Filter "*-$ProcessId-t0-*.log" -File -ErrorAction SilentlyContinue |
        Where-Object LastWriteTimeUtc -ge $StartedUtc | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 6
    foreach ($file in $files) {
        foreach ($line in (Get-Content -LiteralPath $file.FullName -Tail 1500 -ErrorAction SilentlyContinue)) {
            if ($line -notmatch '^\S+ info \[windows-updater\] Windows update attempt ' -or
                $line -notmatch "\bfamily=$familyPattern from=$sourcePattern outcome=accepted\b" -or
                $line -notmatch "\bacceptedAtMs=(\d{13}) attemptId=($guidPattern)\b") { continue }
            $acceptedUtc = [DateTimeOffset]::FromUnixTimeMilliseconds([long]$Matches[1]).UtcDateTime
            if ($acceptedUtc -ge $StartedUtc -and $acceptedUtc -le $now) {
                return [pscustomobject]@{ Id = $Matches[2]; AcceptedUtc = $acceptedUtc }
            }
        }
    }
}

function Test-AdapterUpdatedDesktopProcess {
    param($Process, [int]$SessionId, [string]$ExecutablePath, $Attempt)
    $marker = [regex]::Escape('--codex-update-attempt=' + $Attempt.Id)
    return $Process.SessionId -eq $SessionId -and $Process.ExecutablePath -eq $ExecutablePath -and
        $Process.CreationDate -and $Process.CreationDate.ToUniversalTime() -ge $Attempt.AcceptedUtc -and
        $Process.CommandLine -match ('(?:^|[\s"])' + $marker + '(?=$|[\s"])')
}
