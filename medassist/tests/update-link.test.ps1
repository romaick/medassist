$ErrorActionPreference = 'Stop'
$started = [Diagnostics.Stopwatch]::StartNew()
$script:Passed = 0
$testRoot = [IO.Path]::GetFullPath((Join-Path ([IO.Path]::GetTempPath()) ('medassist-update-link-' + [Guid]::NewGuid().ToString('N'))))
$fixtures = New-Object 'System.Collections.Generic.List[object]'
[IO.Directory]::CreateDirectory($testRoot) | Out-Null

function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}

function Check([string]$Name, [scriptblock]$Action) {
    & $Action
    $script:Passed += 1
    Write-Output ('PASS ' + $Name)
}

function New-Fixture([string]$Name) {
    $root = Join-Path $testRoot $Name
    $updater = Join-Path $root 'updater'
    [IO.Directory]::CreateDirectory($updater) | Out-Null
    $scriptPath = Join-Path $updater 'Register-UpdateLink.ps1'
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot '../updater/Register-UpdateLink.ps1') -Destination $scriptPath
    [IO.File]::WriteAllText((Join-Path $updater 'Update-MedAssist.ps1'), 'throw "Fixture updater must never be executed."')
    $description = & $scriptPath -DescribeOnly
    $registryPath = 'Software\Classes\' + $description.Scheme
    $existing = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($registryPath)
    if ($null -ne $existing) { $existing.Dispose(); throw 'Unexpected fixture registry collision.' }
    $fixture = [pscustomobject]@{ Root = $root; ScriptPath = $scriptPath; Description = $description; RegistryPath = $registryPath }
    $fixtures.Add($fixture)
    return $fixture
}

function Mark-FixtureKey($Fixture) {
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($Fixture.RegistryPath, $true)
    try { $key.SetValue('MedAssistTestOwner', $testRoot, [Microsoft.Win32.RegistryValueKind]::String) }
    finally { $key.Dispose() }
}

function Read-Registration($Fixture) {
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($Fixture.RegistryPath)
    if ($null -eq $key) { return $null }
    try {
        $commandKey = $key.OpenSubKey('shell\open\command')
        try {
            return [pscustomobject]@{
                Owner = $key.GetValue('MedAssistInstallRoot')
                Label = $key.GetValue('')
                Protocol = $key.GetValue('URL Protocol', $null)
                Command = if ($null -ne $commandKey) { $commandKey.GetValue('') } else { $null }
            }
        } finally { if ($null -ne $commandKey) { $commandKey.Dispose() } }
    } finally { $key.Dispose() }
}

try {
    $spaces = New-Fixture 'Install with spaces'
    $cyrillic = New-Fixture 'Клиника тест'
    $unicode = New-Fixture 'Клиника İ (тест)'
    $foreign = New-Fixture 'Foreign occupied link'

    Check 'DescribeOnly is read-only and preserves full paths with spaces and Unicode' {
        foreach ($fixture in @($spaces, $cyrillic, $unicode)) {
            Assert-True ($fixture.Description.InstallRoot -ceq $fixture.Root) 'Installation path changed.'
            Assert-True ($null -eq (Read-Registration $fixture)) 'DescribeOnly wrote to the registry.'
            Assert-True ($fixture.Description.Uri -cmatch '^medassist-update-[a-f0-9]{32}://check$') 'Invalid protocol URI.'
        }
    }

    Check 'Scheme is the deterministic SHA256 of the lowercase canonical path' {
        foreach ($fixture in @($spaces, $cyrillic, $unicode)) {
            $hasher = New-Object Security.Cryptography.SHA256CryptoServiceProvider
            try {
                $bytes = $hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($fixture.Root.ToLowerInvariant()))
                $expected = 'medassist-update-' + (($bytes | ForEach-Object { $_.ToString('x2') }) -join '').Substring(0, 32)
            } finally { $hasher.Dispose() }
            Assert-True ($fixture.Description.Scheme -ceq $expected) 'Scheme hash does not match the shared contract.'
            $again = & $fixture.ScriptPath -DescribeOnly
            Assert-True ($again.Uri -ceq $fixture.Description.Uri) 'Scheme changed between runs.'
        }
        Assert-True ($spaces.Description.Scheme -cne $cyrillic.Description.Scheme) 'Different installations share a scheme.'
    }

    Check 'Command is fixed, quoted, and never includes the incoming URI or policy overrides' {
        foreach ($fixture in @($spaces, $cyrillic, $unicode)) {
            $expected = '"' + (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') + '" -NoLogo -NoProfile -STA -WindowStyle Hidden -File "' + (Join-Path $fixture.Root 'updater\Update-MedAssist.ps1') + '"'
            Assert-True ($fixture.Description.Command -ceq $expected) 'Unexpected launch command.'
            Assert-True ($fixture.Description.Command -notmatch '%[0-9*]|://|-ExecutionPolicy|-EncodedCommand|-Command\s') 'Command accepts URI content or changes execution policy.'
        }
    }

    Check 'Registration writes the current-user protocol and exact command for each installation' {
        foreach ($fixture in @($spaces, $cyrillic, $unicode)) {
            $result = & $fixture.ScriptPath
            Mark-FixtureKey $fixture
            $registration = Read-Registration $fixture
            Assert-True ($registration.Owner -ceq $fixture.Root) 'Owner marker is missing or incorrect.'
            Assert-True ($registration.Protocol -ceq '') 'URL Protocol is missing or incorrect.'
            Assert-True ($registration.Label -ceq 'URL:MedAssist update') 'Protocol label is incorrect.'
            Assert-True ($registration.Command -ceq $fixture.Description.Command) 'Registered command differs from DescribeOnly.'
            Assert-True ($result.Uri -ceq $fixture.Description.Uri) 'Registered URI differs from DescribeOnly.'
        }
    }

    Check 'LaunchToken returns only the exact registered scheme after success' {
        foreach ($fixture in @($spaces, $cyrillic, $unicode)) {
            $tokens = @(& $fixture.ScriptPath -LaunchToken)
            Assert-True ($tokens.Count -eq 1 -and $tokens[0] -is [string]) 'LaunchToken returned additional output.'
            Assert-True ($tokens[0] -ceq $fixture.Description.Scheme) 'LaunchToken changed the registered scheme.'
            Assert-True ((Read-Registration $fixture).Command -ceq $fixture.Description.Command) 'LaunchToken succeeded before registration.'
        }
    }

    Check 'Windows PowerShell scripts parse and retain UTF-8 BOM for Unicode paths' {
        foreach ($file in @((Join-Path $PSScriptRoot '../updater/Register-UpdateLink.ps1'), $PSCommandPath)) {
            $parseTokens = $null
            $parseErrors = $null
            [void][Management.Automation.Language.Parser]::ParseFile($file, [ref]$parseTokens, [ref]$parseErrors)
            Assert-True ($parseErrors.Count -eq 0) 'PowerShell syntax errors were found.'
            $bytes = [IO.File]::ReadAllBytes($file)
            Assert-True ($bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) 'PowerShell file is missing the UTF-8 BOM.'
        }
    }

    Check 'Registration is idempotent and leaves the other installation intact' {
        $before = Read-Registration $spaces | ConvertTo-Json -Compress
        $otherBefore = Read-Registration $cyrillic | ConvertTo-Json -Compress
        & $spaces.ScriptPath | Out-Null
        Assert-True ((Read-Registration $spaces | ConvertTo-Json -Compress) -ceq $before) 'Repeated registration changed its values.'
        Assert-True ((Read-Registration $cyrillic | ConvertTo-Json -Compress) -ceq $otherBefore) 'Another installation changed.'
    }

    Check 'Windows ShellExecute activates only the fixed updater and passes no URI arguments' {
        $proofScript = @'
$ErrorActionPreference = 'Stop'
$proof = [pscustomobject]@{ argumentCount = $args.Count; arguments = @($args); updater = $PSCommandPath }
[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'activation-proof.json'), ($proof | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding($false)))
'@
        foreach ($fixture in @($spaces, $cyrillic, $unicode)) {
            $updaterPath = Join-Path $fixture.Root 'updater/Update-MedAssist.ps1'
            [IO.File]::WriteAllText($updaterPath, $proofScript, (New-Object Text.UTF8Encoding($true)))
            $proofPath = Join-Path $fixture.Root 'updater/activation-proof.json'
            foreach ($uri in @($fixture.Description.Uri, ($fixture.Description.Scheme + '://check/%22%20-NoProfile%20-Command%20%22throw%20UnexpectedUriExecution%22?arg=%26%20echo%20injected'))) {
                if (Test-Path -LiteralPath $proofPath) { Remove-Item -LiteralPath $proofPath }
                $startInfo = New-Object Diagnostics.ProcessStartInfo
                $startInfo.FileName = $uri
                $startInfo.UseShellExecute = $true
                $process = [Diagnostics.Process]::Start($startInfo)
                try {
                    $deadline = [DateTime]::UtcNow.AddSeconds(10)
                    while (-not (Test-Path -LiteralPath $proofPath) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 100 }
                    Assert-True (Test-Path -LiteralPath $proofPath) 'Windows did not launch the fixed fixture updater.'
                    if ($null -ne $process) { Assert-True ($process.WaitForExit(10000)) 'Fixture updater did not finish.' }
                    $proof = Get-Content -LiteralPath $proofPath -Raw -Encoding UTF8 | ConvertFrom-Json
                    Assert-True ($proof.argumentCount -eq 0 -and $proof.arguments.Count -eq 0) 'Incoming URI reached the updater arguments.'
                    Assert-True ($proof.updater -ceq $updaterPath.Replace('/', '\')) 'Windows launched a different script.'
                } finally { if ($null -ne $process) { $process.Dispose() } }
            }
        }
    }

    Check 'Foreign protocol registration is refused without mutation' {
        $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($foreign.RegistryPath)
        try {
            $key.SetValue('MedAssistTestOwner', $testRoot, [Microsoft.Win32.RegistryValueKind]::String)
            $key.SetValue('', 'Foreign application fixture', [Microsoft.Win32.RegistryValueKind]::String)
        } finally { $key.Dispose() }
        foreach ($owner in @($null, (Join-Path $testRoot 'Different owner'))) {
            if ($null -ne $owner) {
                $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($foreign.RegistryPath, $true)
                try { $key.SetValue('MedAssistInstallRoot', $owner, [Microsoft.Win32.RegistryValueKind]::String) }
                finally { $key.Dispose() }
            }
            $before = Read-Registration $foreign | ConvertTo-Json -Compress
            $refused = $false
            $captured = New-Object 'System.Collections.Generic.List[object]'
            try { & $foreign.ScriptPath -LaunchToken | ForEach-Object { $captured.Add($_) } } catch { $refused = $_.Exception.Message -like '*already registered*' }
            Assert-True $refused 'Foreign registration was not refused.'
            Assert-True ($captured.Count -eq 0) 'A launch token was emitted despite registration failure.'
            Assert-True ((Read-Registration $foreign | ConvertTo-Json -Compress) -ceq $before) 'Foreign registration was modified.'
        }
    }

    Check 'Real launcher passes the native token for Unicode paths and omits it on registration failure' {
        $browserRoot = Join-Path $testRoot 'Browser stub'
        $browserFolder = Join-Path $browserRoot 'Microsoft/Edge/Application'
        [IO.Directory]::CreateDirectory($browserFolder) | Out-Null
        $browserSource = @'
using System;
using System.IO;
using System.Text;
public static class MedAssistBrowserFixture {
    public static void Main(string[] args) {
        File.WriteAllLines(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "browser-args.txt"), args, Encoding.UTF8);
    }
}
'@
        Add-Type -TypeDefinition $browserSource -OutputAssembly (Join-Path $browserFolder 'msedge.exe') -OutputType ConsoleApplication
        $proofPath = Join-Path $browserFolder 'browser-args.txt'
        foreach ($fixture in @($unicode, $foreign)) {
            [IO.Directory]::CreateDirectory((Join-Path $fixture.Root 'app')) | Out-Null
            [IO.File]::WriteAllText((Join-Path $fixture.Root 'app/index.html'), '<!doctype html><title>Launcher fixture</title>')
            $launcherPath = Join-Path $fixture.Root 'Start-MedAssist.cmd'
            Copy-Item -LiteralPath (Join-Path $PSScriptRoot '../Start-MedAssist.cmd') -Destination $launcherPath
            if (Test-Path -LiteralPath $proofPath) { Remove-Item -LiteralPath $proofPath }
            $startInfo = New-Object Diagnostics.ProcessStartInfo
            $startInfo.FileName = Join-Path $env:SystemRoot 'System32/cmd.exe'
            $startInfo.Arguments = '/d /c ""' + $launcherPath + '""'
            $startInfo.UseShellExecute = $false
            $startInfo.CreateNoWindow = $true
            $startInfo.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
            $startInfo.RedirectStandardOutput = $true
            $startInfo.RedirectStandardError = $true
            foreach ($name in @('ProgramFiles(x86)', 'ProgramFiles', 'LocalAppData')) { $startInfo.EnvironmentVariables[$name] = $browserRoot }
            $process = [Diagnostics.Process]::Start($startInfo)
            try {
                Assert-True ($process.WaitForExit(10000)) 'Fixture launcher did not finish.'
                $stdout = $process.StandardOutput.ReadToEnd()
                $stderr = $process.StandardError.ReadToEnd()
                Assert-True ($process.ExitCode -eq 0) ('Fixture launcher failed: ' + $stderr)
                $deadline = [DateTime]::UtcNow.AddSeconds(10)
                while (-not (Test-Path -LiteralPath $proofPath) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 100 }
                Assert-True (Test-Path -LiteralPath $proofPath) ('Fixture browser was not launched: ' + $stdout + $stderr)
                $browserArgs = @([IO.File]::ReadAllLines($proofPath))
                $expected = '--app=file:///' + (Join-Path $fixture.Root 'app/index.html').Replace('\', '/')
                if ($fixture -eq $unicode) {
                    $expected += '#updates=' + $fixture.Description.Scheme
                    Assert-True ($stdout -notlike '*setup was unavailable*') 'Successful registration displayed a failure message.'
                } else {
                    Assert-True ($stdout -like '*setup was unavailable*') 'Failed registration did not explain the fallback.'
                }
                Assert-True ($browserArgs.Count -eq 1 -and $browserArgs[0] -ceq $expected) ('Launcher token handoff did not match: ' + ($browserArgs -join ' | '))
            } finally { $process.Dispose() }
        }
    }

    Check 'Missing updater refuses registration' {
        $missing = New-Fixture 'Missing updater'
        Remove-Item -LiteralPath (Join-Path $missing.Root 'updater/Update-MedAssist.ps1')
        $refused = $false
        try { & $missing.ScriptPath | Out-Null } catch { $refused = $_.Exception.Message -like '*updater file is missing*' }
        Assert-True $refused 'Missing updater was not refused.'
        Assert-True ($null -eq (Read-Registration $missing)) 'Registration was written with no updater.'
    }
} finally {
    foreach ($fixture in $fixtures) {
        Assert-True ($fixture.Root.StartsWith($testRoot + '\', [StringComparison]::OrdinalIgnoreCase)) 'Fixture path escaped the test folder.'
        Assert-True ($fixture.RegistryPath -ceq ('Software\Classes\' + $fixture.Description.Scheme)) 'Fixture registry path changed.'
        $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($fixture.RegistryPath)
        if ($null -ne $key) {
            try {
                $owner = $key.GetValue('MedAssistInstallRoot')
                $testOwner = $key.GetValue('MedAssistTestOwner')
                Assert-True (($testOwner -ceq $testRoot) -or ($owner -ceq $fixture.Root)) 'Refusing to remove an unowned registry fixture.'
                if ($null -ne $owner) {
                    Assert-True ($owner.StartsWith($testRoot + '\', [StringComparison]::OrdinalIgnoreCase)) 'Registry owner escaped the test folder.'
                }
            } finally { $key.Dispose() }
            [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($fixture.RegistryPath, $false)
        }
    }
    $resolvedTestRoot = [IO.Path]::GetFullPath($testRoot)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    Assert-True ($resolvedTestRoot.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) 'Test folder escaped the temporary directory.'
    Assert-True ([IO.Path]::GetFileName($resolvedTestRoot) -match '^medassist-update-link-[a-f0-9]{32}$') 'Unexpected test folder name.'
    Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force
}

$started.Stop()
Write-Output ('PASS ' + $script:Passed + ' update-link checks in ' + [Math]::Round($started.Elapsed.TotalSeconds, 3) + ' s; PowerShell ' + $PSVersionTable.PSVersion.ToString())
