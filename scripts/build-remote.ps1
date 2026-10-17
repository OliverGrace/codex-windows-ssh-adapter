$ErrorActionPreference='Stop'
$project=Split-Path -Parent $PSScriptRoot
$compiler=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $compiler /nologo /target:exe /platform:x64 /optimize+ /define:DURABLE_HOST /reference:System.Web.Extensions.dll "/out:$project\remote\host-launcher.exe" (Join-Path $project 'src\SshLauncher.cs')
if ($LASTEXITCODE -ne 0) { throw 'Remote host launcher compilation failed' }
& $compiler /nologo /target:exe /platform:x64 /optimize+ /define:REMOTE_PROXY /reference:System.Web.Extensions.dll "/out:$project\remote\proxy-launcher.exe" (Join-Path $project 'src\SshLauncher.cs')
if ($LASTEXITCODE -ne 0) { throw 'Remote proxy launcher compilation failed' }
