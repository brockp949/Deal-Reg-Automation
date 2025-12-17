<#
.SYNOPSIS
    Automate ingestion of transcript files to Git

.DESCRIPTION
    This script:
    1. Checks for new files in input_transcripts/
    2. Adds them to git staging
    3. Commits with a timestamped message
    4. Pushes to remote (triggering GitHub Actions)

.PARAMETER DryRun
    Show what would be done without making changes

.PARAMETER NoPush
    Commit but don't push to remote

.PARAMETER MessagePrefix
    Custom commit message prefix

.EXAMPLE
    .\scripts\ingest-files.ps1
    Ingest all new files and push to remote

.EXAMPLE
    .\scripts\ingest-files.ps1 -DryRun
    Show what would be done without making changes

.EXAMPLE
    .\scripts\ingest-files.ps1 -NoPush
    Commit changes but don't push to remote
#>

param(
    [switch]$DryRun,
    [switch]$NoPush,
    [string]$MessagePrefix = "chore: ingest"
)

# Configuration
$InputDir = "input_transcripts"
$Branch = "main"

# Helper functions
function Write-Info {
    param([string]$Message)
    Write-Host "[INFO] " -ForegroundColor Green -NoNewline
    Write-Host $Message
}

function Write-Warn {
    param([string]$Message)
    Write-Host "[WARN] " -ForegroundColor Yellow -NoNewline
    Write-Host $Message
}

function Write-Err {
    param([string]$Message)
    Write-Host "[ERROR] " -ForegroundColor Red -NoNewline
    Write-Host $Message
}

# Check if we're in a git repository
try {
    $null = git rev-parse --is-inside-work-tree 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw "Not in a git repository"
    }
} catch {
    Write-Err "Not in a git repository"
    exit 1
}

# Navigate to repository root
$RepoRoot = git rev-parse --show-toplevel
Set-Location $RepoRoot

# Check if input directory exists
if (-not (Test-Path $InputDir)) {
    Write-Err "Input directory '$InputDir' does not exist"
    Write-Info "Creating directory structure..."
    New-Item -ItemType Directory -Force -Path "$InputDir/mbox" | Out-Null
    New-Item -ItemType Directory -Force -Path "$InputDir/pdf" | Out-Null
    New-Item -ItemType Directory -Force -Path "$InputDir/docx" | Out-Null
    New-Item -ItemType Directory -Force -Path "$InputDir/txt" | Out-Null
    New-Item -ItemType Directory -Force -Path "$InputDir/processed" | Out-Null
}

# Get timestamp for commit message
$Timestamp = Get-Date -Format "yyyyMMdd_HHmmss"

# Check for new/modified files
$StatusOutput = git status --porcelain $InputDir 2>$null | Where-Object { $_ -notmatch "processed/" }

$NewFiles = ($StatusOutput | Where-Object { $_ -match "^\?\?" }).Count
$ModifiedFiles = ($StatusOutput | Where-Object { $_ -match "^.M|^M." }).Count
$TotalFiles = $NewFiles + $ModifiedFiles

if ($TotalFiles -eq 0) {
    Write-Info "No new or modified files in $InputDir"
    exit 0
}

Write-Info "Found $NewFiles new file(s) and $ModifiedFiles modified file(s)"

# List the files
Write-Host ""
Write-Host "Files to be ingested:"
foreach ($line in $StatusOutput) {
    $status = $line.Substring(0, 2).Trim()
    $file = $line.Substring(3)
    switch -Regex ($status) {
        '^\?\?' { Write-Host "  [NEW] $file" }
        'M' { Write-Host "  [MOD] $file" }
        default { Write-Host "  [$status] $file" }
    }
}
Write-Host ""

# Dry run mode
if ($DryRun) {
    Write-Warn "DRY RUN - No changes will be made"
    Write-Info "Would add files to staging"
    Write-Info "Would commit with message: '$MessagePrefix $TotalFiles transcript(s) - $Timestamp'"
    if (-not $NoPush) {
        Write-Info "Would push to $Branch"
    }
    exit 0
}

# Add files to staging (excluding processed directory)
Write-Info "Adding files to staging..."
git add $InputDir --ignore-removal
git reset "$InputDir/processed" 2>$null

# Check if there's anything to commit
$StagedChanges = git diff --cached --quiet 2>$null
if ($LASTEXITCODE -eq 0) {
    Write-Warn "No changes staged for commit"
    exit 0
}

# Create commit message
if ($TotalFiles -eq 1) {
    # Get the single file name for a more descriptive message
    $FileName = ($StatusOutput | Select-Object -First 1) -replace '^.{3}', ''
    $FileBase = Split-Path $FileName -Leaf
    $CommitMsg = "$MessagePrefix transcript: $FileBase"
} else {
    $CommitMsg = "$MessagePrefix $TotalFiles transcript(s) - $Timestamp"
}

# Commit changes
Write-Info "Committing changes..."
git commit -m $CommitMsg

# Push to remote
if ($NoPush) {
    Write-Info "Skipping push (-NoPush flag set)"
} else {
    Write-Info "Pushing to $Branch..."
    git push origin $Branch
    Write-Info "Files committed and pushed. GitHub Actions workflow should trigger automatically."
}

Write-Host ""
Write-Info "Ingestion complete!"
$ShortHash = git rev-parse --short HEAD
Write-Host "  - Files ingested: $TotalFiles"
Write-Host "  - Commit: $ShortHash"
Write-Host "  - Message: $CommitMsg"
