#!/bin/bash
set -e

echo "Installing Wu Browser..."

# 1. Build
echo "Building..."
npm run build

# 2. 全域安裝（npm link）
echo "Linking globally..."
npm link

# 3. 設定目錄
mkdir -p "$HOME/.wu-browser"

# 4. 複製 Chrome 啟動腳本
cp scripts/chrome-ai.sh "$HOME/.wu-browser/chrome-ai.sh"
chmod +x "$HOME/.wu-browser/chrome-ai.sh"

# 5. 生成 HTTP API token
if [ ! -f "$HOME/.wu-browser/token" ]; then
    openssl rand -hex 32 > "$HOME/.wu-browser/token"
    echo "Generated API token"
fi

# 6. 設定 Claude Code skill
SKILL_DIR="$HOME/.claude/skills/wu-browser"
mkdir -p "$SKILL_DIR"
cp .claude/skills/wu-browser/SKILL.md "$SKILL_DIR/"
echo "Installed skill to $SKILL_DIR"

# 7. MCP config 提示
CLAUDE_CONFIG="$HOME/.claude/claude_desktop_config.json"
echo ""
echo "✅ Wu Browser installed!"
echo ""
echo "Usage:"
echo "  wu-browser chrome     # Launch Chrome"
echo "  wu-browser --mcp      # Start MCP server"
echo "  wu-browser snap       # Snapshot current page"
echo ""
echo "Add to Claude Code MCP settings (~/.claude/claude_desktop_config.json):"
echo '  {'
echo '    "mcpServers": {'
echo '      "wu-browser": {'
echo '        "command": "wu-browser",'
echo '        "args": ["--mcp"]'
echo '      }'
echo '    }'
echo '  }'
echo ""
echo "HTTP API token: $(cat $HOME/.wu-browser/token | head -c 16)..."
echo "(Full token in ~/.wu-browser/token)"
