[CmdletBinding()]
param([switch]$DescribeOnly, [switch]$LaunchToken)

$ErrorActionPreference = 'Stop'
$installRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot)).Replace('/', '\').TrimEnd('\')
$normalizedRoot = $installRoot.ToLowerInvariant()
$hasher = [Security.Cryptography.SHA256]::Create()
try {
    $hash = [BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($normalizedRoot))).Replace('-', '').ToLowerInvariant()
} finally {
    $hasher.Dispose()
}

$scheme = 'medassist-update-' + $hash.Substring(0, 32)
$powershellPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$updaterPath = Join-Path $installRoot 'updater\Update-MedAssist.ps1'
$command = '"' + $powershellPath + '" -NoLogo -NoProfile -STA -WindowStyle Hidden -File "' + $updaterPath + '"'
$description = [pscustomobject]@{
    Scheme = $scheme
    Uri = $scheme + '://check'
    Command = $command
    InstallRoot = $installRoot
}

if ($DescribeOnly) { return $description }
if (-not [IO.File]::Exists($updaterPath)) { throw 'The MedAssist updater file is missing.' }

$registryPath = 'Software\Classes\' + $scheme
$protocolKey = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($registryPath, $true)
try {
    if ($null -ne $protocolKey) {
        $owner = $protocolKey.GetValue('MedAssistInstallRoot', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
        if (-not ($owner -is [string]) -or -not [string]::Equals($owner, $installRoot, [StringComparison]::OrdinalIgnoreCase)) {
            throw 'This update link is already registered to another application. Existing registration was not changed.'
        }
    } else {
        $protocolKey = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($registryPath)
        $protocolKey.SetValue('MedAssistInstallRoot', $installRoot, [Microsoft.Win32.RegistryValueKind]::String)
    }
    $protocolKey.SetValue('', 'URL:MedAssist update', [Microsoft.Win32.RegistryValueKind]::String)
    $protocolKey.SetValue('URL Protocol', '', [Microsoft.Win32.RegistryValueKind]::String)
    $commandKey = $protocolKey.CreateSubKey('shell\open\command')
    try {
        $commandKey.SetValue('', $command, [Microsoft.Win32.RegistryValueKind]::String)
    } finally {
        $commandKey.Dispose()
    }
} finally {
    if ($null -ne $protocolKey) { $protocolKey.Dispose() }
}

if ($LaunchToken) { return $scheme }
return $description
