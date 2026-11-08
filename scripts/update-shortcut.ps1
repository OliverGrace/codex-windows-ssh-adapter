param([switch]$OnlyIfExists)
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$target = Join-Path $project 'Launch-Codex-Windows.cmd'
$shortcutPath = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Codex Windows SSH.lnk'
if ($OnlyIfExists -and -not (Test-Path -LiteralPath $shortcutPath)) { return }
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
if ((Test-Path -LiteralPath $shortcutPath) -and $shortcut.TargetPath -ne $target) {
    throw 'The existing shortcut belongs to another installation; it was not changed.'
}
$package = Get-AppxPackage OpenAI.Codex | Sort-Object Version -Descending | Select-Object -First 1
if (-not $package) { throw 'Codex desktop package not found.' }
$source = Join-Path $package.InstallLocation 'app\resources\icon-chatgpt.ico'
if (-not (Test-Path -LiteralPath $source)) { throw 'Desktop application icon not found; shortcut was not changed.' }
$hash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.Substring(0,16).ToLowerInvariant()
$bin = Join-Path $project 'bin'
New-Item -ItemType Directory -Path $bin -Force | Out-Null
# A local content-addressed copy survives App package removal and avoids stale
# Explorer caches. Only installed App artwork is used; none is distributed.
$icon = Join-Path $bin "codex-app-$hash.ico"
if (-not (Test-Path -LiteralPath $icon) -or (Get-FileHash -LiteralPath $icon).Hash -ne (Get-FileHash -LiteralPath $source).Hash) {
    Copy-Item -LiteralPath $source -Destination $icon -Force
}
if ($shortcut.IconLocation -eq "$icon,0" -and $shortcut.TargetPath -eq $target) {
    Write-Output 'Desktop shortcut already uses the current application icon.'
    return
}
if (Test-Path -LiteralPath $shortcutPath) {
    $backup = Join-Path $project 'work\shortcut-backups'
    New-Item -ItemType Directory -Path $backup -Force | Out-Null
    Copy-Item -LiteralPath $shortcutPath -Destination (Join-Path $backup ("Codex-Windows-SSH-"+[guid]::NewGuid().ToString()+'.lnk'))
}
$shortcut.TargetPath = $target
$shortcut.WorkingDirectory = $project
$shortcut.IconLocation = "$icon,0"
$shortcut.Description = 'Codex with native Windows SSH support'
$shortcut.Save()
if (-not ('CodexAdapterShellRefresh' -as [type])) {
    Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class CodexAdapterShellRefresh { [DllImport("shell32.dll")] public static extern void SHChangeNotify(uint e, uint f, IntPtr a, IntPtr b); }'
}
[CodexAdapterShellRefresh]::SHChangeNotify(0x08000000,0,[IntPtr]::Zero,[IntPtr]::Zero)
Write-Output "Updated desktop shortcut: $shortcutPath"
