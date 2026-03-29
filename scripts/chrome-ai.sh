#!/bin/bash
# chrome-ai.sh — Connect-First Chrome launcher
# Principle: Detect existing Chrome → Connect. Only launch if none found.
# No --user-data-dir by default (uses user's existing Chrome profile + login sessions).

PORT="${WU_BROWSER_CHROME_PORT:-9222}"

# Step 1: Connect-First — detect existing Chrome
if curl -s --connect-timeout 2 "http://localhost:$PORT/json/version" > /dev/null 2>&1; then
    echo "✅ Chrome already running on port $PORT. Connecting."
    curl -s "http://localhost:$PORT/json/version" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f\"  Browser: {d.get('Browser','?')}\")" 2>/dev/null
    exit 0
fi

# Step 2: Resource Budget check (macOS)
if [ "$(uname)" = "Darwin" ]; then
    AVAIL_MB=$(vm_stat | awk '/Pages free|Pages inactive/ {gsub(/\./,"",$NF); sum += $NF} END {print int(sum * 16384 / 1024 / 1024)}')
    if [ "$AVAIL_MB" -lt 2000 ]; then
        echo "❌ RESOURCE_BUDGET: Only ${AVAIL_MB}MB available. Need 2000MB+. Close apps first."
        exit 1
    fi
    if [ "$AVAIL_MB" -lt 4000 ]; then
        echo "⚠️ Low memory: ${AVAIL_MB}MB. Chrome will launch but monitor closely."
    fi
    echo "📊 Available memory: ${AVAIL_MB}MB"
fi

# Step 3: Find Chrome
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

# Step 4: Launch Chrome — no --user-data-dir (use default profile with login sessions)
# Only use custom profile if WU_BROWSER_PROFILE is explicitly set
EXTRA_ARGS=""
if [ -n "$WU_BROWSER_PROFILE" ]; then
    mkdir -p "$WU_BROWSER_PROFILE"
    EXTRA_ARGS="--user-data-dir=$WU_BROWSER_PROFILE"
fi

"$CHROME" \
    --remote-debugging-port="$PORT" \
    --no-first-run \
    --no-default-browser-check \
    --disable-features=Translate \
    --window-size=1920,1080 \
    $EXTRA_ARGS \
    &

CHROME_PID=$!
echo "🚀 Chrome launching (PID: $CHROME_PID, port: $PORT)"

# Wait for Chrome to be ready
for i in {1..10}; do
    if curl -s --connect-timeout 1 "http://localhost:$PORT/json/version" > /dev/null 2>&1; then
        echo "✅ Chrome ready on port $PORT"
        exit 0
    fi
    sleep 1
done
echo "⚠️ Chrome started (PID $CHROME_PID) but CDP not responding after 10s."
