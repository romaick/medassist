Set-StrictMode -Version 2.0

$script:MedAssistAppFiles = @('index.html', 'styles.css', 'exam-options.js', 'core.js', 'storage.js', 'modules.js', 'app.js', 'icon.svg', 'version.json')
# Size limits bound memory use while a package is read and checked. release/build-update.cjs reads both values from here.
# Updaters before 0.26.1 used 2 MiB and 1 MiB and cannot install 0.26.0 or later.
$script:MedAssistPackageLimit = 6 * 1024 * 1024
$script:MedAssistDecodedLimit = 4 * 1024 * 1024

function Assert-UpdateProperties {
    param($Value, [string[]]$Names)
    if ($null -eq $Value -or $Value -isnot [System.Management.Automation.PSCustomObject]) { throw 'Expected a JSON object.' }
    $actual = @($Value.PSObject.Properties.Name)
    if ($actual.Count -ne $Names.Count) { throw 'Unexpected JSON properties.' }
    foreach ($name in $Names) { if ($actual -cnotcontains $name) { throw ('Missing JSON property: ' + $name) } }
}

function Assert-UpdateVersion {
    param($Value)
    if ($Value -isnot [string] -or $Value -cnotmatch '^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$') { throw 'Invalid update version.' }
}

function Assert-UpdateInteger {
    param($Value, [int[]]$Expected)
    if (($Value -isnot [int] -and $Value -isnot [long]) -or $Expected -notcontains $Value) { throw 'Unsupported numeric format or data schema version.' }
}

function Get-UpdateHash {
    param([byte[]]$Bytes)
    $algorithm = [System.Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($algorithm.ComputeHash($Bytes))).Replace('-', '').ToLowerInvariant() }
    finally { $algorithm.Dispose() }
}

function Read-UpdateVersionJson {
    param([string]$Json)
    $value = ConvertFrom-Json -InputObject $Json -ErrorAction Stop
    Assert-UpdateProperties $value @('version', 'dataSchemaVersion')
    Assert-UpdateVersion $value.version
    Assert-UpdateInteger $value.dataSchemaVersion @(2, 3, 4)
    return $value
}

function Load-UpdatePackage {
    param([Parameter(Mandatory = $true)][string]$Json)
    if ([Text.Encoding]::UTF8.GetByteCount($Json) -gt $script:MedAssistPackageLimit) { throw 'Update package exceeds 6 MiB.' }
    $document = ConvertFrom-Json -InputObject ($Json.TrimStart([char]0xFEFF)) -ErrorAction Stop
    Assert-UpdateProperties $document @('format', 'formatVersion', 'version', 'dataSchemaVersion', 'files')
    if ($document.format -isnot [string] -or $document.format -cne 'medassist-update') { throw 'Invalid update package format.' }
    Assert-UpdateInteger $document.formatVersion 1
    Assert-UpdateInteger $document.dataSchemaVersion @(2, 3, 4)
    Assert-UpdateVersion $document.version
    if ($document.files -isnot [array] -or $document.files.Count -ne $script:MedAssistAppFiles.Count) { throw 'Update package must contain all application files.' }
    $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
    $files = New-Object 'System.Collections.Generic.List[object]'
    $total = 0
    foreach ($file in $document.files) {
        Assert-UpdateProperties $file @('name', 'sha256', 'contentBase64')
        if ($file.name -isnot [string] -or $script:MedAssistAppFiles -cnotcontains $file.name -or -not $seen.Add($file.name)) { throw 'Unexpected or duplicate application filename.' }
        if ($file.sha256 -isnot [string] -or $file.sha256 -notmatch '^[0-9a-fA-F]{64}$' -or $file.contentBase64 -isnot [string]) { throw 'Invalid application file metadata.' }
        $bytes = [Convert]::FromBase64String($file.contentBase64)
        if ([Convert]::ToBase64String($bytes) -cne $file.contentBase64) { throw 'Non-canonical Base64 data.' }
        $total += $bytes.Length
        if ($total -gt $script:MedAssistDecodedLimit) { throw 'Decoded application exceeds 4 MiB.' }
        if ((Get-UpdateHash $bytes) -ine $file.sha256) { throw ('Checksum mismatch: ' + $file.name) }
        $files.Add([pscustomobject]@{ Name = $file.name; Sha256 = $file.sha256.ToLowerInvariant(); Bytes = $bytes })
    }
    $versionBytes = @($files | Where-Object { $_.Name -ceq 'version.json' })[0].Bytes
    $utf8 = New-Object Text.UTF8Encoding($false, $true)
    $versionFile = Read-UpdateVersionJson ($utf8.GetString($versionBytes).TrimStart([char]0xFEFF))
    if ($versionFile.version -cne $document.version) { throw 'Package and application versions differ.' }
    if ($versionFile.dataSchemaVersion -ne $document.dataSchemaVersion) { throw 'Package and application data schemas differ.' }
    return [pscustomobject]@{ Json = $Json; Version = $document.version; DataSchemaVersion = $document.dataSchemaVersion; Files = $files.ToArray() }
}

function Get-MedAssistUpdate {
    param([Parameter(Mandatory = $true)][string]$FeedUrl)
    $address = $null
    if (-not [Uri]::TryCreate($FeedUrl, [UriKind]::Absolute, [ref]$address) -or $address.Scheme -cne 'https' -or $address.UserInfo -ne '' -or $address.Fragment -ne '' -or $address.Host -eq '') { throw 'The update feed must be an HTTPS URL without credentials or a fragment.' }
    Add-Type -AssemblyName System.Net.Http -ErrorAction Stop
    $handler = New-Object Net.Http.HttpClientHandler
    $handler.AllowAutoRedirect = $false
    $client = New-Object Net.Http.HttpClient($handler)
    $client.Timeout = [TimeSpan]::FromSeconds(20)
    $cancel = New-Object Threading.CancellationTokenSource
    $cancel.CancelAfter(20000)
    $response = $null
    $stream = $null
    $buffered = New-Object IO.MemoryStream
    try {
        $response = $client.GetAsync($address, [Net.Http.HttpCompletionOption]::ResponseHeadersRead, $cancel.Token).GetAwaiter().GetResult()
        if ([int]$response.StatusCode -ne 200) { throw ('Update server returned HTTP ' + [int]$response.StatusCode + '. Redirects are not followed.') }
        if ($null -ne $response.Content.Headers.ContentLength -and $response.Content.Headers.ContentLength -gt $script:MedAssistPackageLimit) { throw 'Update response exceeds 6 MiB.' }
        $stream = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
        $buffer = New-Object byte[] 8192
        do {
            $count = $stream.ReadAsync($buffer, 0, $buffer.Length, $cancel.Token).GetAwaiter().GetResult()
            if ($buffered.Length + $count -gt $script:MedAssistPackageLimit) { throw 'Update response exceeds 6 MiB.' }
            if ($count -gt 0) { $buffered.Write($buffer, 0, $count) }
        } while ($count -gt 0)
        $utf8 = New-Object Text.UTF8Encoding($false, $true)
        return Load-UpdatePackage ($utf8.GetString($buffered.ToArray()))
    }
    finally {
        if ($null -ne $stream) { $stream.Dispose() }
        if ($null -ne $response) { $response.Dispose() }
        $buffered.Dispose()
        $cancel.Dispose()
        $client.Dispose()
        $handler.Dispose()
    }
}

function Assert-UpdatePath {
    param([string]$Path)
    $fullPath = [IO.Path]::GetFullPath($Path)
    $current = [IO.Path]::GetPathRoot($fullPath)
    foreach ($part in $fullPath.Substring($current.Length).Split([char[]]@('\', '/'), [StringSplitOptions]::RemoveEmptyEntries)) {
        $current = [IO.Path]::Combine($current, $part)
        if ([IO.File]::Exists($current) -or [IO.Directory]::Exists($current)) {
            if (([IO.File]::GetAttributes($current) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw ('Reparse points are not allowed in update paths: ' + $current) }
        }
    }
    return $fullPath
}

function Get-UpdateRoot {
    param([string]$InstallRoot)
    $root = Assert-UpdatePath $InstallRoot
    if (-not [IO.Directory]::Exists($root)) { throw 'Installation folder does not exist.' }
    if ($root.TrimEnd([char[]]@('\', '/')) -eq [IO.Path]::GetPathRoot($root).TrimEnd([char[]]@('\', '/'))) { throw 'A filesystem root cannot be an application installation folder.' }
    return $root.TrimEnd([char[]]@('\', '/'))
}

function Open-UpdateLock {
    param([string]$Root)
    $work = Assert-UpdatePath ([IO.Path]::Combine($Root, 'update-work'))
    [IO.Directory]::CreateDirectory($work) | Out-Null
    $lockPath = Assert-UpdatePath ([IO.Path]::Combine($work, 'update.lock'))
    return [IO.File]::Open($lockPath, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
}

function Get-UpdateDirectoryManifest {
    param([string]$Directory)
    $Directory = Assert-UpdatePath $Directory
    if (-not [IO.Directory]::Exists($Directory)) { throw 'Application folder is missing.' }
    $entries = @([IO.Directory]::GetFileSystemEntries($Directory))
    if ($entries.Count -ne $script:MedAssistAppFiles.Count) { throw 'Unexpected application folder contents.' }
    $manifest = @()
    foreach ($name in $script:MedAssistAppFiles) {
        $file = Assert-UpdatePath ([IO.Path]::Combine($Directory, $name))
        if (-not [IO.File]::Exists($file)) { throw ('Missing application file: ' + $name) }
        $manifest += [pscustomobject]@{ name = $name; sha256 = Get-UpdateHash ([IO.File]::ReadAllBytes($file)) }
    }
    return ,$manifest
}

function Assert-UpdateManifest {
    param($Manifest)
    if ($Manifest -isnot [array] -or $Manifest.Count -ne $script:MedAssistAppFiles.Count) { throw 'Invalid recovery manifest.' }
    $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
    foreach ($entry in $Manifest) {
        Assert-UpdateProperties $entry @('name', 'sha256')
        if ($entry.name -isnot [string] -or $script:MedAssistAppFiles -cnotcontains $entry.name -or -not $seen.Add($entry.name) -or $entry.sha256 -isnot [string] -or $entry.sha256 -notmatch '^[0-9a-fA-F]{64}$') { throw 'Invalid recovery file entry.' }
    }
}

function Test-UpdateManifest {
    param([string]$Directory, $Manifest)
    $actual = Get-UpdateDirectoryManifest $Directory
    foreach ($entry in $actual) {
        $expected = @($Manifest | Where-Object { $_.name -ceq $entry.name })
        if ($expected.Count -ne 1 -or $entry.sha256 -ine $expected[0].sha256) { return $false }
    }
    return $true
}

function Move-UpdateDirectory {
    param([string]$Source, [string]$Destination)
    $Source = Assert-UpdatePath $Source
    $Destination = Assert-UpdatePath $Destination
    [IO.Directory]::Move($Source, $Destination)
}

function Invoke-UpdateRecovery {
    param([string]$Root)
    $work = Assert-UpdatePath ([IO.Path]::Combine($Root, 'update-work'))
    $journalPath = Assert-UpdatePath ([IO.Path]::Combine($work, 'pending.json'))
    if (-not [IO.File]::Exists($journalPath)) { return [pscustomobject]@{ Status = 'none' } }
    if ((New-Object IO.FileInfo($journalPath)).Length -gt 32768) { throw 'Recovery journal is too large.' }
    $journal = ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($journalPath)) -ErrorAction Stop
    Assert-UpdateProperties $journal @('format', 'formatVersion', 'transactionId', 'previousVersion', 'nextVersion', 'oldManifest', 'newManifest')
    if ($journal.format -isnot [string] -or $journal.format -cne 'medassist-update-journal' -or $journal.transactionId -isnot [string] -or $journal.transactionId -cnotmatch '^[0-9a-f]{32}$') { throw 'Invalid recovery journal.' }
    Assert-UpdateInteger $journal.formatVersion 1
    Assert-UpdateVersion $journal.previousVersion
    Assert-UpdateVersion $journal.nextVersion
    if ([version]$journal.nextVersion -le [version]$journal.previousVersion) { throw 'Invalid recovery version order.' }
    Assert-UpdateManifest $journal.oldManifest
    Assert-UpdateManifest $journal.newManifest
    $transaction = Assert-UpdatePath ([IO.Path]::Combine($work, $journal.transactionId))
    if (-not [IO.Directory]::Exists($transaction)) { throw 'Recovery transaction folder is missing.' }
    foreach ($child in [IO.Directory]::GetFileSystemEntries($transaction)) {
        $null = Assert-UpdatePath $child
        if (@('staged', 'backup', 'displaced') -cnotcontains [IO.Path]::GetFileName($child) -or -not [IO.Directory]::Exists($child)) { throw 'Unexpected recovery transaction contents.' }
    }
    $appPath = Assert-UpdatePath ([IO.Path]::Combine($Root, 'app'))
    $backup = Assert-UpdatePath ([IO.Path]::Combine($transaction, 'backup'))
    $staged = Assert-UpdatePath ([IO.Path]::Combine($transaction, 'staged'))
    $displaced = Assert-UpdatePath ([IO.Path]::Combine($transaction, 'displaced'))
    if ([IO.Directory]::Exists($staged) -and -not (Test-UpdateManifest $staged $journal.newManifest)) { throw 'Staged application no longer matches the recovery journal.' }
    if ([IO.Directory]::Exists($displaced) -and -not (Test-UpdateManifest $displaced $journal.newManifest)) { throw 'Displaced application no longer matches the recovery journal.' }
    if ([IO.Directory]::Exists($backup)) {
        if (-not (Test-UpdateManifest $backup $journal.oldManifest)) { throw 'Backup no longer matches the recovery journal.' }
        if ([IO.Directory]::Exists($appPath)) {
            if ([IO.Directory]::Exists($staged) -or [IO.Directory]::Exists($displaced) -or -not (Test-UpdateManifest $appPath $journal.newManifest)) { throw 'Unexpected application state during recovery.' }
            Move-UpdateDirectory $appPath $displaced
        }
        Move-UpdateDirectory $backup $appPath
    }
    if (-not [IO.Directory]::Exists($appPath) -or -not (Test-UpdateManifest $appPath $journal.oldManifest)) { throw 'Previous application could not be recovered safely.' }
    [IO.File]::Delete($journalPath)
    return [pscustomobject]@{ Status = 'recovered'; Version = $journal.previousVersion }
}

function Recover-MedAssistUpdate {
    param([Parameter(Mandatory = $true)][string]$InstallRoot)
    $root = Get-UpdateRoot $InstallRoot
    $lock = Open-UpdateLock $root
    try { return Invoke-UpdateRecovery $root }
    finally { $lock.Dispose() }
}

function Apply-MedAssistUpdate {
    param([Parameter(Mandatory = $true)][string]$InstallRoot, [Parameter(Mandatory = $true)]$Package)
    $validated = Load-UpdatePackage $Package.Json
    $root = Get-UpdateRoot $InstallRoot
    $lock = Open-UpdateLock $root
    try {
        $null = Invoke-UpdateRecovery $root
        $appPath = Assert-UpdatePath ([IO.Path]::Combine($root, 'app'))
        $localVersionPath = Assert-UpdatePath ([IO.Path]::Combine($appPath, 'version.json'))
        $local = Read-UpdateVersionJson ([IO.File]::ReadAllText($localVersionPath))
        if ([version]$validated.Version -lt [version]$local.version) { throw 'An older version cannot replace the installed application.' }
        if ([version]$validated.Version -eq [version]$local.version) { return [pscustomobject]@{ Status = 'current'; Version = $local.version } }
        $oldManifest = Get-UpdateDirectoryManifest $appPath
        $transactionId = [Guid]::NewGuid().ToString('N')
        $work = [IO.Path]::Combine($root, 'update-work')
        $transaction = Assert-UpdatePath ([IO.Path]::Combine($work, $transactionId))
        $staged = [IO.Path]::Combine($transaction, 'staged')
        $backup = [IO.Path]::Combine($transaction, 'backup')
        [IO.Directory]::CreateDirectory($staged) | Out-Null
        foreach ($file in $validated.Files) { [IO.File]::WriteAllBytes([IO.Path]::Combine($staged, $file.Name), $file.Bytes) }
        $newManifest = @($validated.Files | ForEach-Object { [pscustomobject]@{ name = $_.Name; sha256 = $_.Sha256 } })
        if (-not (Test-UpdateManifest $staged $newManifest) -or -not (Test-UpdateManifest $appPath $oldManifest)) { throw 'Application files changed during update preparation.' }
        $journal = [ordered]@{ format = 'medassist-update-journal'; formatVersion = 1; transactionId = $transactionId; previousVersion = $local.version; nextVersion = $validated.Version; oldManifest = $oldManifest; newManifest = $newManifest }
        $journalPath = Assert-UpdatePath ([IO.Path]::Combine($work, 'pending.json'))
        $journalTemp = [IO.Path]::Combine($transaction, 'journal.tmp')
        [IO.File]::WriteAllText($journalTemp, ($journal | ConvertTo-Json -Depth 8 -Compress), (New-Object Text.UTF8Encoding($false)))
        [IO.File]::Move($journalTemp, $journalPath)
        try {
            Move-UpdateDirectory $appPath $backup
            Move-UpdateDirectory $staged $appPath
            if (-not (Test-UpdateManifest $appPath $newManifest)) { throw 'Installed application failed checksum verification.' }
            [IO.File]::Delete($journalPath)
        }
        catch {
            $originalError = $_.Exception.Message
            try { $null = Invoke-UpdateRecovery $root }
            catch { throw ($originalError + ' Recovery also failed: ' + $_.Exception.Message + ' Keep the update-work folder for recovery.') }
            throw ($originalError + ' The previous application was restored.')
        }
        return [pscustomobject]@{ Status = 'updated'; Version = $validated.Version; PreviousVersion = $local.version; BackupPath = $backup }
    }
    finally { $lock.Dispose() }
}
