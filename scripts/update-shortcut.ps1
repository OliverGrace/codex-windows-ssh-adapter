param([switch]$OnlyIfExists)
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$target = Join-Path $project 'Launch-Codex-Windows.cmd'
$shortcutPath = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Codex Windows SSH.lnk'
$hasDesktopShortcut = Test-Path -LiteralPath $shortcutPath
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
if ((Test-Path -LiteralPath $shortcutPath) -and $shortcut.TargetPath -ne $target) {
    throw 'The existing shortcut belongs to another installation; it was not changed.'
}
$package = Get-AppxPackage OpenAI.Codex | Sort-Object Version -Descending | Select-Object -First 1
if (-not $package) { throw 'Codex desktop package not found.' }
# Match Desktop's system-integrated window icon, not icon-chatgpt.ico (the
# legacy executable artwork has a shaded outline). Keep the packaged artwork
# unchanged and select its variant using the Windows shell theme.
$theme = Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize' -ErrorAction SilentlyContinue
$iconName = if ($null -ne $theme.SystemUsesLightTheme -and $theme.SystemUsesLightTheme -eq 0) { 'chatgpt-app-dark.ico' } else { 'chatgpt-app-light.ico' }
$source = Join-Path $package.InstallLocation "app\resources\$iconName"
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
$changed = $false
function Save-AdapterIconShortcut {
    param($Link, [string]$LinkPath)
    $backup = Join-Path $project 'work\shortcut-backups'
    New-Item -ItemType Directory -Path $backup -Force | Out-Null
    if (Test-Path -LiteralPath $LinkPath) {
        Copy-Item -LiteralPath $LinkPath -Destination (Join-Path $backup ([IO.Path]::GetFileNameWithoutExtension($LinkPath)+'-'+[guid]::NewGuid().ToString()+'.lnk'))
    }
    $Link.IconLocation = "$icon,0"
    $Link.Save()
    Write-Output "Updated icon: $LinkPath"
}
if ((-not $OnlyIfExists -or $hasDesktopShortcut) -and
    ($shortcut.IconLocation -ne "$icon,0" -or $shortcut.TargetPath -ne $target)) {
    $shortcut.TargetPath = $target
    $shortcut.WorkingDirectory = $project
    $shortcut.Description = 'Codex with native Windows SSH support'
    Save-AdapterIconShortcut -Link $shortcut -LinkPath $shortcutPath
    $changed = $true
}
# Taskbar grouping resolves the AppUserModelID through its Start Menu link.
# The installer leaves that link using the executable's legacy shaded icon.
# Update existing links only; preserve targets, arguments, pinning and AppID.
$shellApplication = New-Object -ComObject Shell.Application
$appPaths = @((Join-Path $package.InstallLocation 'app\ChatGPT.exe'), (Join-Path $package.InstallLocation 'app\Codex.exe'))
$linkFolders = @(
    (Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs'),
    (Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar')
)
foreach ($folderPath in $linkFolders) {
    if (-not (Test-Path -LiteralPath $folderPath)) { continue }
    $folder = $shellApplication.Namespace($folderPath)
    foreach ($file in @(Get-ChildItem -LiteralPath $folderPath -Filter '*.lnk')) {
        $link = $shell.CreateShortcut($file.FullName)
        $appId = $folder.ParseName($file.Name).ExtendedProperty('System.AppUserModel.ID')
        $isApp = $link.TargetPath -in $appPaths -and $appId -eq 'com.openai.codex'
        if (-not $isApp -and $link.TargetPath -ne $target) { continue }
        if ($link.IconLocation -eq "$icon,0") { continue }
        Save-AdapterIconShortcut -Link $link -LinkPath $file.FullName
        $updatedId = $shellApplication.Namespace($folderPath).ParseName($file.Name).ExtendedProperty('System.AppUserModel.ID')
        if ($updatedId -ne $appId) { throw 'Shortcut application identity changed unexpectedly; restore its saved backup.' }
        $changed = $true
    }
}
if (-not $changed) { Write-Output 'Application shortcuts already use the current transparent icon.'; return }
if (-not ('CodexAdapterShellRefresh' -as [type])) {
    Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class CodexAdapterShellRefresh { [DllImport("shell32.dll")] public static extern void SHChangeNotify(uint e, uint f, IntPtr a, IntPtr b); }'
}
[CodexAdapterShellRefresh]::SHChangeNotify(0x08000000,0,[IntPtr]::Zero,[IntPtr]::Zero)
