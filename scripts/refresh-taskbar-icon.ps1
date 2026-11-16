param([switch]$WatchStartup)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$project = Split-Path -Parent $PSScriptRoot
$package = Get-AppxPackage OpenAI.Codex | Sort-Object Version -Descending | Select-Object -First 1
if (-not $package) { throw 'Codex desktop package not found.' }
$theme = Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize' -ErrorAction SilentlyContinue
$name = if ($null -ne $theme.SystemUsesLightTheme -and $theme.SystemUsesLightTheme -eq 0) { 'chatgpt-app-dark.ico' } else { 'chatgpt-app-light.ico' }
$source = Join-Path $package.InstallLocation "app\resources\$name"
$hash = (Get-FileHash -LiteralPath $source).Hash
$bin = Join-Path $project 'bin'
New-Item -ItemType Directory -Path $bin -Force | Out-Null
$icon = Join-Path $bin ('codex-app-' + $hash.Substring(0,16).ToLowerInvariant() + '.ico')
if (-not (Test-Path -LiteralPath $icon) -or (Get-FileHash -LiteralPath $icon).Hash -ne $hash) {
    Copy-Item -LiteralPath $source -Destination $icon -Force
}
$appRoot = [regex]::Escape((Split-Path -Parent $package.InstallLocation).TrimEnd('\'))
$family = [regex]::Escape($package.Name) + '_[^\\]+__' + [regex]::Escape($package.PublisherId)
$approvedTarget = '^' + $appRoot + '\\' + $family + '\\app\\(ChatGPT|Codex)\.exe$'
$folders = @(
    (Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs'),
    (Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar')
)
$shell = New-Object -ComObject WScript.Shell
$explorer = New-Object -ComObject Shell.Application
if (-not ('CodexTaskbarIconRefresh' -as [type])) {
    Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class CodexTaskbarIconRefresh { [DllImport("shell32.dll")] public static extern void SHChangeNotify(uint e,uint f,IntPtr a,IntPtr b); }'
}
# Electron can recreate its Start Menu link during launch, after the adapter's
# pre-launch repair. Observe only this bounded startup window; no resident task.
$attempts = if ($WatchStartup) { 16 } else { 1 }
for ($attempt = 0; $attempt -lt $attempts; $attempt++) {
    if ($attempt -gt 0) { Start-Sleep -Seconds 2 }
    $changed = $false
    foreach ($dir in $folders) {
        if (-not (Test-Path -LiteralPath $dir)) { continue }
        foreach ($file in @(Get-ChildItem -LiteralPath $dir -Filter '*.lnk')) {
            $link = $shell.CreateShortcut($file.FullName)
            if ($link.TargetPath -notmatch $approvedTarget) { continue }
            $id = $explorer.Namespace($dir).ParseName($file.Name).ExtendedProperty('System.AppUserModel.ID')
            if ($id -ne 'com.openai.codex') { continue }
            $newTarget = $link.TargetPath
            if (-not (Test-Path -LiteralPath $newTarget)) {
                $newTarget = Join-Path $package.InstallLocation ('app\' + [IO.Path]::GetFileName($link.TargetPath))
                if (-not (Test-Path -LiteralPath $newTarget)) { continue }
            }
            if ($link.IconLocation -eq "$icon,0" -and $link.TargetPath -eq $newTarget) { continue }
            $backupDir = Join-Path $project 'work\shortcut-backups'
            New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
            $backup = Join-Path $backupDir ('taskbar-' + [guid]::NewGuid().ToString('N') + '.lnk')
            Copy-Item -LiteralPath $file.FullName -Destination $backup
            $arguments = $link.Arguments
            $oldDirectory = Split-Path -Parent $link.TargetPath
            $link.TargetPath = $newTarget
            if ($link.WorkingDirectory -eq $oldDirectory) { $link.WorkingDirectory = Split-Path -Parent $newTarget }
            $link.IconLocation = "$icon,0"
            try {
                $link.Save()
                $verify = $shell.CreateShortcut($file.FullName)
                $newId = $explorer.Namespace($dir).ParseName($file.Name).ExtendedProperty('System.AppUserModel.ID')
                if ($newId -ne $id -or $verify.Arguments -ne $arguments -or $verify.TargetPath -ne $newTarget -or $verify.IconLocation -ne "$icon,0") {
                    throw 'Shortcut identity or properties changed unexpectedly.'
                }
            } catch {
                Copy-Item -LiteralPath $backup -Destination $file.FullName -Force
                throw
            }
            $changed = $true
            Write-Output "Restored App taskbar icon: $($file.Name)"
        }
    }
    if ($changed) { [CodexTaskbarIconRefresh]::SHChangeNotify(0x08000000,0,[IntPtr]::Zero,[IntPtr]::Zero) }
}
