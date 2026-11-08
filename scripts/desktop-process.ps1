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
