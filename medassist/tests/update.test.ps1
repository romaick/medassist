$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../updater/Update-Core.ps1')
$started = [Diagnostics.Stopwatch]::StartNew()
$script:Passed = 0
$testRoot = Join-Path $PSScriptRoot ('../../.verification/update-core-' + [Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($testRoot) | Out-Null

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw $Message }
}

function Expect-Error {
    param([scriptblock]$Action, [string]$Message)
    $failed = $false
    try { & $Action | Out-Null }
    catch { $failed = $true }
    Assert-True $failed $Message
}

function Check {
    param([string]$Name, [scriptblock]$Action)
    & $Action
    $script:Passed += 1
    Write-Output ('PASS ' + $Name)
}

function New-FixturePackage {
    param([string]$Version = '0.3.0')
    $files = @()
    foreach ($name in $script:MedAssistAppFiles) {
        $content = 'Fixture file: ' + $name + ' version: ' + $Version
        if ($name -ceq 'version.json') { $content = @{version = $Version; dataSchemaVersion = 2} | ConvertTo-Json -Compress }
        $bytes = [Text.Encoding]::UTF8.GetBytes($content)
        $files += [pscustomobject]@{ name = $name; sha256 = Get-UpdateHash $bytes; contentBase64 = [Convert]::ToBase64String($bytes) }
    }
    return [pscustomobject]@{ format = 'medassist-update'; formatVersion = 1; version = $Version; dataSchemaVersion = 2; files = $files }
}

function Parse-Fixture {
    param($Document)
    return Load-UpdatePackage ($Document | ConvertTo-Json -Depth 8 -Compress)
}

function Write-FixtureApp {
    param([string]$Directory, $Package)
    [IO.Directory]::CreateDirectory($Directory) | Out-Null
    foreach ($file in $Package.Files) { [IO.File]::WriteAllBytes((Join-Path $Directory $file.Name), $file.Bytes) }
}

function New-FixtureInstall {
    $directory = Join-Path $testRoot ([Guid]::NewGuid().ToString('N'))
    Write-FixtureApp (Join-Path $directory 'app') (Parse-Fixture (New-FixturePackage '0.2.0'))
    [IO.File]::WriteAllText((Join-Path $directory 'user-backup.json'), 'fictional saved user data')
    [IO.File]::WriteAllText((Join-Path $directory 'Start-MedAssist.cmd'), 'unchanged launcher fixture')
    return $directory
}

function New-InterruptedFixture {
    param([string]$Phase)
    $directory = New-FixtureInstall
    $id = [Guid]::NewGuid().ToString('N')
    $work = Join-Path $directory 'update-work'
    $transaction = Join-Path $work $id
    $appPath = Join-Path $directory 'app'
    $staged = Join-Path $transaction 'staged'
    $backup = Join-Path $transaction 'backup'
    Write-FixtureApp $staged (Parse-Fixture (New-FixturePackage '0.3.0'))
    $journal = [ordered]@{
        format = 'medassist-update-journal'; formatVersion = 1; transactionId = $id
        previousVersion = '0.2.0'; nextVersion = '0.3.0'
        oldManifest = Get-UpdateDirectoryManifest $appPath
        newManifest = Get-UpdateDirectoryManifest $staged
    }
    [IO.File]::WriteAllText((Join-Path $work 'pending.json'), ($journal | ConvertTo-Json -Depth 8 -Compress))
    if ($Phase -eq 'old-moved' -or $Phase -eq 'new-moved') { [IO.Directory]::Move($appPath, $backup) }
    if ($Phase -eq 'new-moved') { [IO.Directory]::Move($staged, $appPath) }
    return [pscustomobject]@{ Root = $directory; Transaction = $transaction; Journal = $journal }
}

Check 'Strict valid bundle parsing and version metadata' {
    $package = Parse-Fixture (New-FixturePackage)
    Assert-True ($package.Version -ceq '0.3.0' -and $package.Files.Count -eq 9) 'Valid bundle did not load.'
}

Check 'Valid update, retained backup and unrelated files preserved' {
    $directory = New-FixtureInstall
    $result = Apply-MedAssistUpdate $directory (Parse-Fixture (New-FixturePackage))
    Assert-True ($result.Status -ceq 'updated' -and $result.PreviousVersion -ceq '0.2.0') 'Update result is incorrect.'
    $installed = Read-UpdateVersionJson ([IO.File]::ReadAllText((Join-Path $directory 'app/version.json')))
    Assert-True ($installed.version -ceq '0.3.0') 'New application version was not installed.'
    $backup = Read-UpdateVersionJson ([IO.File]::ReadAllText((Join-Path $result.BackupPath 'version.json')))
    Assert-True ($backup.version -ceq '0.2.0') 'Old application was not retained.'
    Assert-True ([IO.File]::ReadAllText((Join-Path $directory 'user-backup.json')) -ceq 'fictional saved user data') 'Unrelated data changed.'
    Assert-True ([IO.File]::ReadAllText((Join-Path $directory 'Start-MedAssist.cmd')) -ceq 'unchanged launcher fixture') 'Launcher changed.'
    Assert-True (-not [IO.File]::Exists((Join-Path $directory 'update-work/pending.json'))) 'Journal was not cleared.'
}

Check 'Same version is skipped and downgrade is rejected' {
    $directory = New-FixtureInstall
    $result = Apply-MedAssistUpdate $directory (Parse-Fixture (New-FixturePackage '0.2.0'))
    Assert-True ($result.Status -ceq 'current') 'Same version should not be reinstalled.'
    Expect-Error { Apply-MedAssistUpdate $directory (Parse-Fixture (New-FixturePackage '0.1.0')) } 'Downgrade was accepted.'
    Assert-True ((Read-UpdateVersionJson ([IO.File]::ReadAllText((Join-Path $directory 'app/version.json')))).version -ceq '0.2.0') 'Skipped or rejected update changed the app.'
}

Check 'Checksum corruption is rejected before installation' {
    $document = New-FixturePackage
    $document.files[0].sha256 = '0' * 64
    Expect-Error { Parse-Fixture $document } 'Tampered hash was accepted.'
}

Check 'Traversal, case changes, duplicate and missing filenames are rejected' {
    foreach ($badName in @('../outside.js', 'subdir/app.js', 'APP.JS', 'index.html')) {
        $document = New-FixturePackage
        $document.files[1].name = $badName
        Expect-Error { Parse-Fixture $document } ('Bad filename accepted: ' + $badName)
    }
    $document = New-FixturePackage
    $document.files = @($document.files | Where-Object { $_.name -cne 'version.json' })
    Expect-Error { Parse-Fixture $document } 'Missing version.json accepted.'
}

Check 'Malformed JSON, unsupported schemas, extra fields and wrong types are rejected' {
    Expect-Error { Load-UpdatePackage '{' } 'Malformed JSON accepted.'
    foreach ($field in @('formatVersion', 'dataSchemaVersion')) {
        $document = New-FixturePackage
        $document.$field = '2'
        Expect-Error { Parse-Fixture $document } 'A string schema version was accepted.'
        $document.$field = 9
        Expect-Error { Parse-Fixture $document } 'An unsupported schema version was accepted.'
    }
    $document = New-FixturePackage
    $document | Add-Member -NotePropertyName unexpected -NotePropertyValue 'x'
    Expect-Error { Parse-Fixture $document } 'Unknown root field was accepted.'
    foreach ($badVersion in @('0.3', 'v0.3.0', '0.3.0-beta', '01.2.3', '1.2.3.4', 3)) {
        $document = New-FixturePackage
        $document.version = $badVersion
        Expect-Error { Parse-Fixture $document } 'Invalid version accepted.'
    }
}

Check 'Package metadata and version.json must agree' {
    $document = New-FixturePackage
    $document.version = '0.4.0'
    Expect-Error { Parse-Fixture $document } 'Inconsistent version.json accepted.'
    $document = New-FixturePackage
    $bytes = [Text.Encoding]::UTF8.GetBytes('{"version":"0.3.0","dataSchemaVersion":3}')
    $document.files[8].contentBase64 = [Convert]::ToBase64String($bytes)
    $document.files[8].sha256 = Get-UpdateHash $bytes
    Expect-Error { Parse-Fixture $document } 'Unsupported nested schema accepted.'
}

Check 'Malformed Base64, response limits and decoded limits are enforced' {
    $document = New-FixturePackage
    $document.files[0].contentBase64 = '!invalid!'
    Expect-Error { Parse-Fixture $document } 'Malformed Base64 accepted.'
    Expect-Error { Load-UpdatePackage (' ' * (2 * 1024 * 1024 + 1)) } 'Oversized response accepted.'
    $document = New-FixturePackage
    $bytes = New-Object byte[] (1024 * 1024 + 1)
    $document.files[0].contentBase64 = [Convert]::ToBase64String($bytes)
    $document.files[0].sha256 = Get-UpdateHash $bytes
    Expect-Error { Parse-Fixture $document } 'Oversized decoded content accepted.'
}

Check 'Apply revalidates the bundle and rejects unsafe local application trees' {
    $directory = New-FixtureInstall
    $package = Parse-Fixture (New-FixturePackage)
    $package.Json = '{}'
    Expect-Error { Apply-MedAssistUpdate $directory $package } 'Mutated package source accepted.'
    [IO.File]::WriteAllText((Join-Path $directory 'app/unexpected.txt'), 'fixture')
    Expect-Error { Apply-MedAssistUpdate $directory (Parse-Fixture (New-FixturePackage)) } 'Unexpected local application file accepted.'
    Assert-True ([IO.File]::Exists((Join-Path $directory 'app/unexpected.txt'))) 'Rejected update removed local files.'
}

Check 'Exclusive lock blocks simultaneous updates' {
    $directory = New-FixtureInstall
    $lock = Open-UpdateLock $directory
    try { Expect-Error { Apply-MedAssistUpdate $directory (Parse-Fixture (New-FixturePackage)) } 'Concurrent update was accepted.' }
    finally { $lock.Dispose() }
    Assert-True ((Recover-MedAssistUpdate $directory).Status -ceq 'none') 'A blocked update left a transaction.'
}

Check 'Filesystem roots and junctions cannot redirect updates outside the installation' {
    Expect-Error { Get-UpdateRoot ([IO.Path]::GetPathRoot($testRoot)) } 'Filesystem root was accepted.'
    $directory = New-FixtureInstall
    $outside = Join-Path $testRoot ('junction-target-' + [Guid]::NewGuid().ToString('N'))
    [IO.Directory]::CreateDirectory($outside) | Out-Null
    [IO.File]::WriteAllText((Join-Path $outside 'marker.txt'), 'untouched outside fixture')
    New-Item -ItemType Junction -Path (Join-Path $directory 'update-work') -Target $outside | Out-Null
    Expect-Error { Apply-MedAssistUpdate $directory (Parse-Fixture (New-FixturePackage)) } 'Junction was followed.'
    Assert-True ([IO.File]::ReadAllText((Join-Path $outside 'marker.txt')) -ceq 'untouched outside fixture') 'Junction target changed.'
    Assert-True (@([IO.Directory]::GetFileSystemEntries($outside)).Count -eq 1) 'Updater wrote into the junction target.'
}

Check 'Update move failure restores the previous application' {
    $directory = New-FixtureInstall
    $originalMove = ${function:Move-UpdateDirectory}
    try {
        function Move-UpdateDirectory {
            param([string]$Source, [string]$Destination)
            if ([IO.Path]::GetFileName($Source) -ceq 'staged') { throw 'Injected rename failure.' }
            [IO.Directory]::Move($Source, $Destination)
        }
        Expect-Error { Apply-MedAssistUpdate $directory (Parse-Fixture (New-FixturePackage)) } 'Injected move failure did not fail the update.'
    }
    finally { Set-Item -Path Function:Move-UpdateDirectory -Value $originalMove }
    Assert-True ((Read-UpdateVersionJson ([IO.File]::ReadAllText((Join-Path $directory 'app/version.json')))).version -ceq '0.2.0') 'Failed update did not roll back.'
    Assert-True (-not [IO.File]::Exists((Join-Path $directory 'update-work/pending.json'))) 'Rollback did not clear the journal.'
}

Check 'Interrupted prepared, old-moved and new-moved states recover deterministically' {
    foreach ($phase in @('prepared', 'old-moved', 'new-moved')) {
        $fixture = New-InterruptedFixture $phase
        $result = Recover-MedAssistUpdate $fixture.Root
        Assert-True ($result.Status -ceq 'recovered') ('Recovery did not finish: ' + $phase)
        Assert-True ((Read-UpdateVersionJson ([IO.File]::ReadAllText((Join-Path $fixture.Root 'app/version.json')))).version -ceq '0.2.0') ('Previous version not restored: ' + $phase)
        Assert-True ((Recover-MedAssistUpdate $fixture.Root).Status -ceq 'none') 'Recovery was not idempotent.'
    }
}

Check 'Recovery rejects unsafe journal paths and tampered transaction files' {
    $fixture = New-InterruptedFixture 'prepared'
    $fixture.Journal.transactionId = '../outside'
    [IO.File]::WriteAllText((Join-Path $fixture.Root 'update-work/pending.json'), ($fixture.Journal | ConvertTo-Json -Depth 8 -Compress))
    Expect-Error { Recover-MedAssistUpdate $fixture.Root } 'Unsafe journal path accepted.'
    $fixture = New-InterruptedFixture 'old-moved'
    [IO.File]::WriteAllText((Join-Path $fixture.Transaction 'staged/app.js'), 'tampered fixture')
    Expect-Error { Recover-MedAssistUpdate $fixture.Root } 'Tampered recovery tree accepted.'
    Assert-True ([IO.File]::Exists((Join-Path $fixture.Transaction 'backup/version.json'))) 'Rejected recovery lost the old application.'
}

Check 'Production downloader rejects non-HTTPS, credentials and fragments before network access' {
    foreach ($address in @('http://example.com/feed.json', 'file:///tmp/feed.json', 'https://user:pass@example.com/feed.json', 'https://example.com/feed.json#fragment', 'invalid')) {
        Expect-Error { Get-MedAssistUpdate $address } ('Unsafe feed URL accepted: ' + $address)
    }
}

$started.Stop()
Write-Output ('PASS ' + $script:Passed + ' update checks in ' + [Math]::Round($started.Elapsed.TotalSeconds, 3) + ' s; PowerShell ' + $PSVersionTable.PSVersion.ToString())
