#!/usr/bin/env bash
set -euo pipefail

# Colors
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info()  { echo -e "${BLUE}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()   { echo -e "${RED}[ERROR]${NC} $*"; }

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

echo ""
echo "=== Influencer Scout Setup ==="
echo ""

# 1. Detect platform
info "Detecting platform..."
if [[ "$OSTYPE" == "darwin"* ]]; then
    ok "macOS detected"
elif [[ "$OSTYPE" == "linux"* ]]; then
    ok "Linux detected"
else
    warn "Unknown platform: $OSTYPE — proceeding anyway"
fi

# 2. Install uv if missing
info "Checking for uv..."
if command -v uv &>/dev/null; then
    ok "uv found: $(uv --version)"
else
    info "Installing uv..."
    curl -LsSf https://astral.sh/uv/install.sh | sh
    export PATH="$HOME/.local/bin:$PATH"
    if command -v uv &>/dev/null; then
        ok "uv installed: $(uv --version)"
    else
        err "uv installation failed. Install manually: https://docs.astral.sh/uv/"
        exit 1
    fi
fi

# 3. Create .agent/.env from .env.example
info "Setting up .agent/.env..."
if [[ ! -f .agent/.env ]]; then
    cp .agent/.env.example .agent/.env
    ok "Created .agent/.env from template"
fi

# Open .env for editing if API key is not yet set
if ! grep -q 'TIKHUB_API_KEY=.' .agent/.env 2>/dev/null; then
    warn "TIKHUB_API_KEY is not set. Opening .agent/.env for you to fill in..."
    warn "Get your key at: https://tikhub.io"
    sleep 1
    if command -v open &>/dev/null; then
        open .agent/.env
    elif command -v xdg-open &>/dev/null; then
        xdg-open .agent/.env
    else
        warn "Could not open the file automatically. Edit it manually at: $(pwd)/.agent/.env"
    fi
    echo ""
    read -rp "Press Enter once you have saved your TIKHUB_API_KEY to continue... "
fi

# Validate API key
if grep -q 'TIKHUB_API_KEY=.' .agent/.env 2>/dev/null; then
    ok "TIKHUB_API_KEY is set"
else
    warn "TIKHUB_API_KEY still appears empty — you can add it later to .agent/.env"
fi

# 4. Check Gmail credentials
info "Checking Gmail credentials..."
if [[ -f .agent/credentials/credentials.json ]]; then
    ok "Gmail credentials.json found"
    if [[ -f .agent/credentials/token.json ]]; then
        ok "Gmail token.json found (already authenticated)"
    else
        info "Running Gmail OAuth flow — a browser window will open..."
        uv run .agent/skills/scout/scripts/cli.py setup-gmail 2>&1 || {
            warn "Gmail OAuth failed. You can retry later with: uv run .agent/skills/scout/scripts/cli.py setup-gmail"
        }
    fi
else
    warn "Gmail credentials.json not found."
    warn "Place the credentials.json file shared with you at:"
    warn "  $(pwd)/.agent/credentials/credentials.json"
    warn "Then re-run this script to complete Gmail OAuth setup."
fi

# 5. Create data/ directory
info "Setting up data directory..."
mkdir -p data
ok "data/ directory ready"

# 6. Platform-specific wiring
info "Setting up agent platform integration..."
if [[ -d .claude ]] || command -v claude &>/dev/null; then
    # Claude Code detected — symlink skills
    mkdir -p .claude
    if [[ -L .claude/skills ]]; then
        ok "Skills symlink already exists"
    elif [[ -d .claude/skills ]]; then
        warn ".claude/skills/ already exists as directory — skipping symlink"
    else
        ln -s ../.agent/skills .claude/skills
        ok "Created symlink: .claude/skills → .agent/skills"
    fi
else
    info "Not a Claude Code environment. For other agents, point to .agent/skills/ manually."
fi

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Quick start:"
echo "  /scout _example       — run scouting on the example campaign"
echo "  /lookup @username     — find similar creators"
echo "  /outreach _example    — send outreach emails"
echo ""
