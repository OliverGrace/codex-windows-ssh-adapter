$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\scripts\desktop-process.ps1')
function Assert($condition, $message) { if (-not $condition) { throw $message } }

# Exercise retry/confirmation without sleeping or touching the running App.
foreach ($scenario in @('absent','exiting','cancel','force','stuck')) {
    & {
        $script:queries = 0
        $script:waits = @()
        $script:prompts = 0
        $script:stops = 0
        function Get-AdapterDesktopProcess {
            param($ExecutablePaths)
            $script:queries++
            if ($scenario -eq 'absent' -or ($scenario -eq 'exiting' -and $script:queries -gt 1) -or
                ($scenario -eq 'force' -and $script:stops -gt 0)) { return }
            [pscustomobject]@{Id=123}
        }
        function Start-Sleep { param($Seconds,$Milliseconds) $script:waits += ($Seconds * 1000 + $Milliseconds) }
        function Read-AdapterRestartConfirmation { $script:prompts++; return $scenario -ne 'cancel' }
        function Stop-AdapterDesktopProcess { param($ExecutablePaths) $script:stops++ }
        $failed = $false
        try { $result = Wait-AdapterDesktopExit -ExecutablePaths @('C:\fixtures\App.exe') }
        catch { if ($_.Exception.Message -notlike 'Codex did not exit*') { throw }; $failed = $true }
        Assert ($failed -eq ($scenario -eq 'stuck')) "Unexpected failure: $scenario"
        if (-not $failed) { Assert ($result -eq ($scenario -ne 'cancel')) "Unexpected result: $scenario" }
        Assert ($script:prompts -eq [int]($scenario -in @('cancel','force','stuck'))) "Unexpected prompt: $scenario"
        Assert ($script:stops -eq [int]($scenario -in @('force','stuck'))) "Unexpected force close: $scenario"
        if ($scenario -eq 'absent') { Assert ($script:waits.Count -eq 0) 'Unnecessary delay' }
        else { Assert ($script:waits[0] -eq 3000) 'Must retry once after 3 seconds' }
        if ($scenario -eq 'stuck') { Assert ($script:waits.Count -eq 26) 'Exit wait must be bounded' }
    }
}

# Same executable name in two locations: only the selected path may be stopped.
$tempRoot = [IO.Path]::GetTempPath()
$fixtureRoot = Join-Path $tempRoot ('adapter-process-' + [guid]::NewGuid().ToString('N'))
$first = $null
$second = $null
try {
    New-Item -ItemType Directory -Path "$fixtureRoot\one","$fixtureRoot\two" -Force | Out-Null
    $source = Join-Path $fixtureRoot 'Fixture.cs'
    [IO.File]::WriteAllText($source, 'class Fixture { static void Main() { System.Threading.Thread.Sleep(60000); } }')
    $one = Join-Path $fixtureRoot 'one\AdapterExitFixture.exe'
    $two = Join-Path $fixtureRoot 'two\AdapterExitFixture.exe'
    & "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:exe "/out:$one" $source
    if ($LASTEXITCODE -ne 0) { throw 'Fixture compilation failed' }
    Copy-Item -LiteralPath $one -Destination $two
    $first = Start-Process -FilePath $one -WindowStyle Hidden -PassThru
    $second = Start-Process -FilePath $two -WindowStyle Hidden -PassThru
    Assert (@(Get-AdapterDesktopProcess -ExecutablePaths @($one)).Count -eq 1) 'Exact path discovery failed'
    Stop-AdapterDesktopProcess -ExecutablePaths @($one)
    Assert ($first.WaitForExit(5000)) 'Selected fixture did not stop'
    Assert (-not $second.HasExited) 'Unrelated same-name fixture was stopped'

    $savedLocalAppData = $env:LOCALAPPDATA
    try {
        $env:LOCALAPPDATA = $fixtureRoot
        $now = [datetime]::UtcNow
        $startedUtc = $now.AddSeconds(-40)
        $acceptedMs = ([DateTimeOffset]$now.AddSeconds(-2)).ToUnixTimeMilliseconds()
        $dateFolder = $now.ToString('yyyy/MM/dd', [Globalization.CultureInfo]::InvariantCulture)
        $logDirectory = Join-Path $fixtureRoot "Codex/Logs/$dateFolder"
        New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
        $family = 'OpenAI.Codex_fixture'
        $sourceVersion = [version]'26.1.1.0'
        $attemptId = [guid]::NewGuid().ToString()
        $line = "$($now.ToString('o')) info [windows-updater] Windows update attempt acceptedAtMs=$acceptedMs attemptId=$attemptId family=$family from=$sourceVersion outcome=accepted trigger=user"
        $logPath = Join-Path $logDirectory 'codex-desktop-test-123-t0-i1-123456-0.log'
        [IO.File]::WriteAllText($logPath, $line)
        $attempt = Find-AdapterDesktopUpdateAttempt 123 $startedUtc $family $sourceVersion
        Assert ($attempt.Id -eq $attemptId) 'Did not recognize the accepted update for this process'
        Assert (-not (Find-AdapterDesktopUpdateAttempt 124 $startedUtc $family $sourceVersion)) 'Matched a different App process'
        Assert (-not (Find-AdapterDesktopUpdateAttempt 123 $now $family $sourceVersion)) 'Matched an attempt before this process started'
        Assert (-not (Find-AdapterDesktopUpdateAttempt 123 $startedUtc $family ([version]'26.1.0.0'))) 'Matched an unrelated package version'
        $updated = [pscustomobject]@{ SessionId = 1; ExecutablePath = $two; CreationDate = $now; CommandLine = "`"$two`" --codex-update-attempt=$attemptId" }
        Assert (Test-AdapterUpdatedDesktopProcess $updated 1 $two $attempt) 'Missed the updater restart'
        Assert (-not (Test-AdapterUpdatedDesktopProcess $updated 2 $two $attempt)) 'Matched another Windows session'
        Assert (-not (Test-AdapterUpdatedDesktopProcess $updated 1 $one $attempt)) 'Matched another executable'
        $updated.CommandLine = "`"$two`""
        Assert (-not (Test-AdapterUpdatedDesktopProcess $updated 1 $two $attempt)) 'Matched a normal launch'

        # The Store can wait 40 seconds to register and start the replacement.
        # Exercise the real watcher with a simulated clock and no App launch.
        & {
            $sessionId = [Diagnostics.Process]::GetCurrentProcess().SessionId
            $old = [pscustomobject]@{ SessionId = $sessionId; StartTime = $startedUtc }
            $old | Add-Member -MemberType ScriptMethod -Name WaitForExit -Value {}
            $old | Add-Member -MemberType ScriptMethod -Name Dispose -Value {}
            $updated.SessionId = $sessionId
            $updated.CommandLine = "`"$two`" --codex-update-attempt=$attemptId"
            $fixturePackage = [pscustomobject]@{ PackageFamilyName = $family; Version = [version]'26.1.2.0'; InstallLocation = $fixtureRoot }
            [IO.File]::WriteAllText((Join-Path $fixtureRoot 'AppxManifest.xml'), '<Package><Applications><Application Id="App" Executable="two\AdapterExitFixture.exe" /></Applications></Package>')
            $observed = @{ Seconds = 0; Launches = 0 }
            function Get-Process { param($Id) $old }
            function Get-AppxPackage { param($Name) if ($observed.Seconds -ge 40) { $fixturePackage } }
            function Get-CimInstance { param($ClassName,$Filter) $updated }
            function Start-Sleep { param($Seconds) $observed.Seconds += $Seconds }
            function Start-Process { param($FilePath,$WindowStyle) $observed.Launches++ }
            & (Join-Path $PSScriptRoot '..\scripts\watch-desktop-update.ps1') -ProcessId 123 `
                -StartedTicks $startedUtc.Ticks -PackageFamily $family -SourceVersion $sourceVersion
            Assert ($observed.Launches -eq 1 -and $observed.Seconds -eq 40) 'Missed the delayed Store update restart'
        }
    } finally { $env:LOCALAPPDATA = $savedLocalAppData }
} finally {
    foreach ($process in @($first,$second)) {
        if ($null -ne $process) {
            if (-not $process.HasExited) { $process.Kill(); $null = $process.WaitForExit(5000) }
            $process.Dispose()
        }
    }
    $resolved = [IO.Path]::GetFullPath($fixtureRoot)
    Assert ([IO.Path]::GetDirectoryName($resolved).TrimEnd('\') -eq $tempRoot.TrimEnd('\')) 'Unsafe fixture cleanup path'
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
Write-Output 'PASS: retry, cancellation, confirmed close, bounded failure, exact-path process isolation'
