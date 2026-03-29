# Wu Browser

The missing browser layer for Claude. Read pages as DOM, not screenshots.

**Incremental snapshot: 92% token reduction. Mini-snapshot after action: ~6 tokens.**

## Why Wu Browser?

| Problem | Current Tools | Wu Browser |
|---------|--------------|------------|
| Token waste | 2,000-10,000 tokens/page | ~858 tokens (Google homepage) |
| Repeated snapshots | Full page every time | Incremental: 858 → 72 tokens (92% savings) |
| Blind after action | Need full re-snapshot | Auto mini-snapshot: ~6 tokens |
| No safety guardrails | Full trust or full block | 4-level permission system |
| No structured output | Text only | `--json` + `--jq` filtering |

## Quick Start

```bash
npm install -g wu-browser
wu-browser chrome          # Start Chrome with remote debugging
wu-browser nav https://google.com
wu-browser snap -i         # See the page (~858 tokens)
wu-browser click @e3       # Click an element
```

## One-Minute Demo: Google Search in 1,164 Tokens

```bash
# Install
npm install -g wu-browser

# Start Chrome (if not already running)
wu-browser chrome

# The workflow
wu-browser nav https://google.com          # Navigate
wu-browser snap -i                          # First read: 858 tokens
wu-browser type @e10 "Wu AI"               # Type (mini-snapshot: 6 tokens)
wu-browser snap -i                          # Incremental read: 72 tokens
wu-browser click @e12                       # Click search (mini-snapshot: 6 tokens)
wu-browser snap -i                          # New page read: ~858 tokens
# Total: ~1,800 tokens for a complete search workflow
```

With any other tool, this would cost ~5,000+ tokens.

## MCP Integration (Claude Code)

```json
{
  "mcpServers": {
    "wu-browser": {
      "command": "wu-browser",
      "args": ["--mcp"]
    }
  }
}
```

## Performance (Real Measurements)

Measured with `wu-browser snap -i --json`, token count via js-tiktoken cl100k_base.

| Page | Elements | Tokens | Truncated | Mode |
|------|----------|--------|-----------|------|
| Google Homepage | 40 | 858 | No | interactive |
| Google Search Results | 48 | 1,439 | Yes (74%) | interactive |
| Amazon Product Page | 70 | 1,498 | Yes (76%) | interactive |
| BBC Homepage | 50 | 1,469 | Yes (76%) | interactive |

Default max tokens: 1,500. Adjustable with `--max-tokens`.

### Incremental Snapshot

Second snapshot of same page: **92% token reduction** (858 → 72 tokens)

### Mini-Snapshot after Action

Automatic context after click/type: **~6 tokens**

```
[動作完成] click @e10 → 頁面無變化
```

## Real-World Workflow Cost

A typical 5-step agent workflow: open page → read → click → read → fill form → read → submit.

| Step | Traditional Tool | Wu Browser | Savings |
|------|-----------------|------------|---------|
| 1. First snapshot | ~1,000 tokens | 858 tokens | 14% |
| 2. Click + re-read | ~1,000 tokens | 6 + 72 = 78 tokens | 92% |
| 3. Type + re-read | ~1,000 tokens | 6 + 72 = 78 tokens | 92% |
| 4. Click + re-read | ~1,000 tokens | 6 + 72 = 78 tokens | 92% |
| 5. Final read | ~1,000 tokens | 72 tokens | 93% |
| **Total** | **~5,000 tokens** | **~1,164 tokens** | **77%** |

The magic: incremental snapshots (92% reduction) + mini-snapshots (~6 tokens after every action).
No other browser tool does this.

## Features

- **DOM-based reading** — No screenshots, no vision models needed
- **Incremental snapshots** — Only send what changed (92% savings)
- **Mini-snapshots** — 6-token status after every action
- **4-level permissions** — Green/Yellow/Red/Black safety system
- **Auto cookie consent** — Dismiss banners automatically
- **JSON output** — Structured data with `--jq` filtering
- **MCP + HTTP + CLI** — Works with Claude Code, Cowork, and remote
- **Adapter system** — Extensible platform-specific commands
- **Network capture** — Intercept and inspect HTTP requests via CDP

## CLI Reference

```bash
# Snapshots
wu-browser snap -i                    # Interactive mode (default)
wu-browser snap -c                    # Content mode (text)
wu-browser snap -f                    # Full mode (tree)
wu-browser snap -i --max-tokens 800   # Limit tokens
wu-browser snap -i --json             # JSON output
wu-browser snap -i --json --jq '.elements[] | select(.role=="button")'

# Navigation & Actions
wu-browser nav <url>                  # Navigate
wu-browser click @e1                  # Click element
wu-browser type @e3 "hello"           # Type into input
wu-browser tabs                       # List tabs

# Network
wu-browser network start              # Start capturing requests
wu-browser network requests --json    # List captured requests
wu-browser network stop               # Stop capturing

# Adapters
wu-browser site list                  # List installed adapters
wu-browser site run twitter/search "AI"  # Run adapter command

# Server modes
wu-browser                            # MCP stdio server (default)
wu-browser --mcp                      # Explicit MCP mode
wu-browser --http --port 9867         # HTTP API server
wu-browser chrome                     # Launch Chrome with CDP
wu-browser status                     # Connection status
```

## Snapshot Format

```
[頁面] Google (https://www.google.com/)
---
[@e3] link "Gmail" href="https://mail.google.com/mail/&ogbl"
[@e10] combobox "搜尋"
[@e22] button "Google 搜尋"
---
[40 個元素 · interactive 模式]
```

### JSON Format

```bash
wu-browser snap -i --json
```

```json
{
  "url": "https://www.google.com/",
  "title": "Google",
  "mode": "interactive",
  "tokenCount": 858,
  "elementCount": 40,
  "truncated": false,
  "incremental": false,
  "elements": [
    { "ref": "@e3", "role": "link", "name": "Gmail", "href": "https://mail.google.com/...", "type": null }
  ]
}
```

## Permission System

| Level | Actions | Behavior |
|-------|---------|----------|
| Green | Read, navigate, scroll | Always allowed |
| Yellow | Post, fill forms, login | Ask once, remember |
| Red | Buy, delete, transfer | Ask every time |
| Black | Banking, crypto exchanges | Always blocked |

## vs Other Tools

| | Wu Browser | Claude-in-Chrome | Playwright MCP | bb-browser |
|---|---|---|---|---|
| Single snapshot | ~858 tokens | ~500-800 | ~500-2000 | varies |
| **5-step workflow** | **~1,164 tokens** | **~3,000-5,000** (estimated) | **~3,000-10,000** (estimated) | **~3,000-5,000** (estimated) |
| Incremental snapshot | ✅ 92% savings | ❌ | ❌ | ❌ |
| Mini-snapshot | ✅ ~6 tokens | ❌ | ❌ | ❌ |
| Permission system | ✅ 4-level | ❌ | ❌ | ❌ |
| Cookie auto-dismiss | ✅ | ❌ | ❌ | partial |
| JSON + jq | ✅ | ❌ | ❌ | ✅ |
| Platform adapters | 🔧 extensible | N/A | N/A | ✅ 36 |
| Installation | `npm i -g` | Chrome extension | npm | npm |

## Architecture

```
src/
  browser/    CDP connection + Chrome launcher + tab management
  dom/        Snapshot extraction + pruning + actions
  permissions/ 4-level permission engine
  mcp/        MCP stdio server (17 tools)
  http/       Fastify HTTP API server
  adapters/   Platform-specific command system
  utils/      Logger + token counter
bin/          CLI entry point
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `WU_BROWSER_CHROME_PORT` | `9222` | Chrome remote debugging port |
| `WU_BROWSER_PROFILE` | `~/.wu-browser/chrome-profile` | Chrome profile directory |
| `WU_DEBUG` | unset | Enable debug logging |

## License

MIT

---

## 中文說明

Wu Browser 是為 Claude 設計的瀏覽器中間層。用 DOM 讀頁面，不用截圖。

### 核心優勢

- **Token 節省**：Google 首頁僅 858 tokens（對比 Playwright MCP 2,000-5,000）
- **增量快照**：同頁面第二次僅 72 tokens（節省 92%）
- **操作後迷你快照**：點擊/輸入後自動回報狀態（~6 tokens）
- **四級權限**：綠/黃/紅/黑，保護敏感操作
- **JSON 輸出**：支援 `--json` + `--jq` 過濾
- **網路攔截**：透過 CDP Network domain 監控 HTTP 請求

### 安裝

```bash
npm install -g wu-browser
wu-browser chrome    # 啟動 Chrome（需要遠端除錯）
wu-browser snap -i   # 讀取頁面
```

### MCP 整合

在 Claude Code 設定中加入：

```json
{
  "mcpServers": {
    "wu-browser": {
      "command": "wu-browser",
      "args": ["--mcp"]
    }
  }
}
```
