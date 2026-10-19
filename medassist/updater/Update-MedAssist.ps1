[CmdletBinding()]
param([switch]$CheckOnly)

$ErrorActionPreference = 'Stop'
$installRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'Update-Core.ps1')

function Show-UpdateMessage([string]$Text, [string]$Kind = 'Information') {
    [void][System.Windows.Forms.MessageBox]::Show($Text, 'МедАссистент — обновление', 'OK', $Kind)
}

try {
    if (-not $CheckOnly) { Add-Type -AssemblyName System.Windows.Forms }
    $recovery = Recover-MedAssistUpdate -InstallRoot $installRoot
    $channel = Get-Content -LiteralPath (Join-Path $installRoot 'update-channel.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if (-not ($channel.feedUrl -is [string]) -or [string]::IsNullOrWhiteSpace($channel.feedUrl)) {
        $message = 'Интернет-канал обновлений ещё не подключён. Приложение можно использовать офлайн. Для включения обновлений нужно один раз опубликовать подготовленную версию и подключить её постоянный адрес.'
        if ($CheckOnly) { [pscustomobject]@{ Status = 'not-configured'; Message = $message }; return }
        Show-UpdateMessage $message
        return
    }
    $progressWindow = $null
    try {
        if (-not $CheckOnly) {
            $progressWindow = New-Object System.Windows.Forms.Form
            $progressWindow.Text = 'МедАссистент — проверка обновлений'
            $progressWindow.Width = 430
            $progressWindow.Height = 150
            $progressWindow.StartPosition = 'CenterScreen'
            $progressWindow.FormBorderStyle = 'FixedDialog'
            $progressWindow.ControlBox = $false
            $statusLabel = New-Object System.Windows.Forms.Label
            $statusLabel.Text = 'Получаем опубликованную версию из интернета…'
            $statusLabel.AutoSize = $true
            $statusLabel.Left = 20
            $statusLabel.Top = 20
            $progressBar = New-Object System.Windows.Forms.ProgressBar
            $progressBar.Style = 'Marquee'
            $progressBar.SetBounds(20, 55, 370, 20)
            $progressWindow.Controls.AddRange(@($statusLabel, $progressBar))
            $progressWindow.Show()
            $progressWindow.Refresh()
            [System.Windows.Forms.Application]::DoEvents()
        }
        $package = Get-MedAssistUpdate -FeedUrl $channel.feedUrl
    } finally {
        if ($null -ne $progressWindow) { $progressWindow.Close(); $progressWindow.Dispose() }
    }
    $current = Get-Content -LiteralPath (Join-Path $installRoot 'app/version.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ([version]$package.Version -lt [version]$current.version) { throw 'Сервер предлагает более старую версию. Установленная программа сохранена.' }
    if ([version]$package.Version -eq [version]$current.version) {
        if ($CheckOnly) { [pscustomobject]@{ Status = 'current'; Version = $current.version }; return }
        Show-UpdateMessage ('У вас последняя опубликованная версия: ' + $current.version + '.')
        return
    }
    if ($CheckOnly) { [pscustomobject]@{ Status = 'available'; Version = $package.Version; CurrentVersion = $current.version }; return }
    $question = 'Доступна версия ' + $package.Version + '. Сейчас установлена ' + $current.version + ".`r`n`r`nСохраните резервную копию JSON и закройте окна МедАссистента перед установкой. Интернет нужен только для получения обновления.`r`n`r`nОкна программы закрыты, установить обновление?"
    $answer = [System.Windows.Forms.MessageBox]::Show($question, 'МедАссистент — новая версия', 'YesNo', 'Question', 'Button2')
    if ($answer -ne 'Yes') { return }
    $result = Apply-MedAssistUpdate -InstallRoot $installRoot -Package $package
    Show-UpdateMessage ('Установлена версия ' + $result.Version + ".`r`nТеперь откройте МедАссистент обычным ярлыком. Записи остаются в прежнем браузере; файлы прежней версии сохранены в папке update-work.")
} catch {
    if ($CheckOnly) { throw }
    Show-UpdateMessage ("Обновление не завершено. Можно продолжить использовать прежнюю версию, если её файлы доступны. При прерывании установки повторите запуск обновления: сначала оно восстановит целостную папку.`r`n`r`n" + $_.Exception.Message) 'Error'
    exit 1
}
