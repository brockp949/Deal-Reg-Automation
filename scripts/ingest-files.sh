#!/bin/bash
#
# ingest-files.sh - Automate ingestion of transcript files to Git
#
# This script:
# 1. Checks for new files in input_transcripts/
# 2. Adds them to git staging
# 3. Commits with a timestamped message
# 4. Pushes to remote (triggering GitHub Actions)
#
# Usage:
#   ./scripts/ingest-files.sh [options]
#
# Options:
#   --dry-run    Show what would be done without making changes
#   --no-push    Commit but don't push to remote
#   --message    Custom commit message prefix
#

set -e

# Configuration
INPUT_DIR="input_transcripts"
BRANCH="main"

# Parse arguments
DRY_RUN=false
NO_PUSH=false
MESSAGE_PREFIX="chore: ingest"

while [[ $# -gt 0 ]]; do
    case $1 in
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --no-push)
            NO_PUSH=true
            shift
            ;;
        --message)
            MESSAGE_PREFIX="$2"
            shift 2
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Helper functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if we're in a git repository
if ! git rev-parse --is-inside-work-tree > /dev/null 2>&1; then
    log_error "Not in a git repository"
    exit 1
fi

# Navigate to repository root
REPO_ROOT=$(git rev-parse --show-toplevel)
cd "$REPO_ROOT"

# Check if input directory exists
if [ ! -d "$INPUT_DIR" ]; then
    log_error "Input directory '$INPUT_DIR' does not exist"
    log_info "Creating directory structure..."
    mkdir -p "$INPUT_DIR"/{mbox,pdf,docx,txt,processed}
fi

# Get timestamp for commit message
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Check for new/modified files
NEW_FILES=$(git status --porcelain "$INPUT_DIR" | grep -E "^\?\?" | wc -l | tr -d ' ')
MODIFIED_FILES=$(git status --porcelain "$INPUT_DIR" | grep -E "^.M" | wc -l | tr -d ' ')

TOTAL_FILES=$((NEW_FILES + MODIFIED_FILES))

if [ "$TOTAL_FILES" -eq 0 ]; then
    log_info "No new or modified files in $INPUT_DIR"
    exit 0
fi

log_info "Found $NEW_FILES new file(s) and $MODIFIED_FILES modified file(s)"

# List the files
echo ""
echo "Files to be ingested:"
git status --porcelain "$INPUT_DIR" | grep -v "processed/" | while read -r line; do
    status="${line:0:2}"
    file="${line:3}"
    case "$status" in
        "??") echo "  [NEW] $file" ;;
        " M") echo "  [MOD] $file" ;;
        "M ") echo "  [MOD] $file" ;;
        *) echo "  [$status] $file" ;;
    esac
done
echo ""

# Dry run mode
if [ "$DRY_RUN" = true ]; then
    log_warn "DRY RUN - No changes will be made"
    log_info "Would add files to staging"
    log_info "Would commit with message: '$MESSAGE_PREFIX $TOTAL_FILES transcript(s) - $TIMESTAMP'"
    if [ "$NO_PUSH" = false ]; then
        log_info "Would push to $BRANCH"
    fi
    exit 0
fi

# Add files to staging (excluding processed directory)
log_info "Adding files to staging..."
git add "$INPUT_DIR" --ignore-removal
git reset "$INPUT_DIR/processed" 2>/dev/null || true

# Check if there's anything to commit
if git diff --cached --quiet; then
    log_warn "No changes staged for commit"
    exit 0
fi

# Create commit message
if [ "$TOTAL_FILES" -eq 1 ]; then
    # Get the single file name for a more descriptive message
    FILE_NAME=$(git status --porcelain "$INPUT_DIR" | grep -v "processed/" | head -1 | awk '{print $2}')
    FILE_BASE=$(basename "$FILE_NAME")
    COMMIT_MSG="$MESSAGE_PREFIX transcript: $FILE_BASE"
else
    COMMIT_MSG="$MESSAGE_PREFIX $TOTAL_FILES transcript(s) - $TIMESTAMP"
fi

# Commit changes
log_info "Committing changes..."
git commit -m "$COMMIT_MSG"

# Push to remote
if [ "$NO_PUSH" = true ]; then
    log_info "Skipping push (--no-push flag set)"
else
    log_info "Pushing to $BRANCH..."
    git push origin "$BRANCH"
    log_info "Files committed and pushed. GitHub Actions workflow should trigger automatically."
fi

echo ""
log_info "Ingestion complete!"
echo "  - Files ingested: $TOTAL_FILES"
echo "  - Commit: $(git rev-parse --short HEAD)"
echo "  - Message: $COMMIT_MSG"
