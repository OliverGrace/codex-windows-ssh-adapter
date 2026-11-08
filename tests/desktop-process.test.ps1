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
