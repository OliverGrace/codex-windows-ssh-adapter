$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$bin = Join-Path $project 'bin'
New-Item -ItemType Directory -Force -Path $bin | Out-Null
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) { throw '.NET Framework C# compiler is not installed.' }
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
& $compiler /nologo /target:exe /platform:x64 /optimize+ /reference:System.Web.Extensions.dll "/out:$bin\ssh.exe" (Join-Path $project 'src\SshLauncher.cs')
if ($LASTEXITCODE -ne 0) { throw 'SSH adapter compilation failed.' }
$utf8 = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText((Join-Path $bin 'runtime.json'), (@{node=$nodePath}|ConvertTo-Json), $utf8)
if (-not (Test-Path -LiteralPath (Join-Path $project 'adapter.config.json'))) {
    Copy-Item -LiteralPath (Join-Path $project 'adapter.config.example.json') -Destination (Join-Path $project 'adapter.config.json')
}
Write-Output "Built $bin\ssh.exe"
