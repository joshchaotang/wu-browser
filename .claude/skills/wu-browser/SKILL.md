# Wu Browser

Control a real Chrome browser with saved login sessions.
Read pages as structured text (~200-800 tokens), not screenshots.

## Setup

Add to Claude Code MCP settings:
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

## Quick Start

```
wu_navigate({ url: "https://example.com" })  # Go to URL
wu_snapshot({ mode: "interactive" })          # Read page elements
wu_click({ ref: "@e5" })                      # Click element
wu_type({ ref: "@e3", text: "hello" })        # Type text
wu_snapshot()                                  # Verify result
```

## Workflow

1. `wu_navigate({ url })` → go to page
2. `wu_snapshot({ mode: "interactive" })` → see clickable elements
3. `wu_click({ ref: "@e5" })` → interact
4. `wu_snapshot()` → verify result

## Modes

- `interactive` (default): Buttons, links, inputs only (~200-800 tokens)
- `content`: Main text content (~500-1500 tokens)
- `full`: Everything (~2000-5000 tokens, use sparingly)

## All Tools

| Tool | Description |
|------|-------------|
| `wu_navigate` | Go to URL |
| `wu_go_back` | Browser back |
| `wu_go_forward` | Browser forward |
| `wu_snapshot` | Read page (main tool) |
| `wu_get_text` | Plain text only (most token-efficient) |
| `wu_click` | Click by ref |
| `wu_type` | Type into input |
| `wu_scroll` | Scroll up/down |
| `wu_select` | Select dropdown option |
| `wu_hover` | Hover over element |
| `wu_list_tabs` | List open tabs |
| `wu_switch_tab` | Switch tab by index |
| `wu_new_tab` | Open new tab |
| `wu_close_tab` | Close tab |
| `wu_screenshot` | Screenshot (fallback, costs tokens) |
| `wu_wait` | Wait for CSS selector |
| `wu_execute_js` | Run JavaScript |
| `wu_status` | Connection status |

## Rules

- Always snapshot BEFORE clicking (refs change between pages)
- The browser has real login sessions — be careful
- Purchases/deletions trigger permission confirmation
- Prefer `wu_snapshot` over `wu_screenshot` — 10x fewer tokens
- Refs look like `@e1`, `@e2`, etc. — they reset on each snapshot

## Permission Levels

- GREEN (auto-allow): navigate, scroll, snapshot, links
- YELLOW (first-time confirm): forms, submit buttons, posting
- RED (always confirm): buy, delete, transfer
- BLACK (blocked): banking domains, crypto exchanges

## Example: Google Search

```
wu_navigate({ url: "https://google.com" })
wu_snapshot({ mode: "interactive" })
# See: [@e1] searchbox "Search"
wu_type({ ref: "@e1", text: "Wu AI browser" })
wu_click({ ref: "@e2" })  # Submit/search button
wu_snapshot()
```
