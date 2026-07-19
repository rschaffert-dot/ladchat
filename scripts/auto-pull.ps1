# Körs schemalagt (Windows Task Scheduler) var 5:e minut.
# Pullar bara om arbetsträdet är rent, så att ej committade ändringar aldrig skrivs över.
Set-Location -Path (Split-Path -Parent $PSScriptRoot)

$status = git status --porcelain
if ($status) {
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -Path "$PSScriptRoot\..\.git-autopull.log" -Value "$timestamp hoppar över pull: ej committade ändringar finns"
    exit 0
}

$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
$result = git pull --ff-only origin main 2>&1
Add-Content -Path "$PSScriptRoot\..\.git-autopull.log" -Value "$timestamp $result"
