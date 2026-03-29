#!/bin/bash
# chrome-ai.sh — 啟動帶 remote debugging 的 Chrome
# 保留用戶 profile，開機自動啟動（安裝到 LaunchAgent 後）

PROFILE_DIR="${WU_BROWSER_PROFILE:-$HOME/.wu-browser/chrome-profile}"
PORT="${WU_BROWSER_CHROME_PORT:-9222}"

# 如果已在跑，不重複啟動
if curl -s "http://localhost:$PORT/json/version" > /dev/null 2>&1; then
    echo "✅ Chrome AI 已在運行（port $PORT）"
    exit 0
fi

mkdir -p "$PROFILE_DIR"

CHROME_PATHS=(
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    "/Applications/Chromium.app/Contents/MacOS/Chromium"
    "/usr/bin/google-chrome"
    "/usr/bin/chromium-browser"
)

CHROME=""
for path in "${CHROME_PATHS[@]}"; do
    if [ -f "$path" ]; then
        CHROME="$path"
        break
    fi
done

if [ -z "$CHROME" ]; then
    echo "❌ Chrome not found. Install Google Chrome first."
    exit 1
fi

"$CHROME" \
    --remote-debugging-port="$PORT" \
    --user-data-dir="$PROFILE_DIR" \
    --no-first-run \
    --no-default-browser-check \
    --disable-features=Translate \
    --window-size=1920,1080 \
    &

echo "✅ Chrome AI 啟動中（port $PORT，profile: $PROFILE_DIR）"
