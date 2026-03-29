# Wu Browser

> Your AI spends 80% of its tokens reading web pages. Wu Browser cuts that by 77%.

## What it does

Wu Browser gives AI agents a smarter way to read web pages.
Instead of dumping the entire accessibility tree every time,
it sends only what changed — in a format designed for LLMs, not humans.

## Proof

| Page | Wu Browser | agent-browser | Playwright | Savings |
|------|-----------|---------------|------------|---------|
| Google Search | 1,317 tokens | 1,859 tokens | 8,356 tokens | 29-84% |
| GitHub Repo | 1,624 tokens | 4,382 tokens | N/A | 63% |
| Same page again | 72 tokens | 259 tokens | 544 tokens | 72-87% |

Honest note: On simple pages (Google homepage), agent-browser's aggressive
filtering (259t) beats our 406t. We keep more elements for reliability.
On complex pages, we win significantly.

All benchmarks use the same token counter (js-tiktoken, cl100k_base).
Source code in `benchmark/`.

## Install

```bash
npm install -g wu-browser
```

## Use

```bash
# Start Chrome with remote debugging
wu-browser chrome

# Snapshot any page
wu-browser nav https://github.com
wu-browser snap                    # Full snapshot
wu-browser snap --format ucf       # Ultra-compact format (~10 tokens/element)
wu-browser snap --diff             # Incremental (only changes)

# Interact
wu-browser click @e3               # Click element by ref
wu-browser type @e6 "search query" # Type into input
wu-browser snap --diff             # See what changed (~72 tokens)
```

### As a library

```typescript
import { createBrowserManager } from 'wu-browser';

const manager = await createBrowserManager();
const page = await manager.navigate('https://github.com');
const snapshot = await page.snapshot({ format: 'ucf' });
console.log(snapshot.text);  // ~1,624 tokens for GitHub repo page
```

### As an MCP server

```bash
wu-browser mcp  # Connects to Claude Chat, Claude Code, or any MCP client
```

## What makes it different

**1. Incremental snapshots** — Only sends changes. Second read = 72 tokens, not 544.
No other tool does this.

**2. UCF format** — 10 tokens per element (vs 21 in standard accessibility tree).
Single-letter role codes, pipe-separated, no href bloat. Designed for LLMs, not screen readers.

**3. Progressive disclosure** — Layer 1 gives you 30% of elements that handle 90% of tasks.
Ask for more only when needed. Google homepage: 207t (Layer 1) vs 406t (full).

```bash
wu-browser snap --progressive      # Layer 1: core interactive
wu-browser snap -2                 # Layer 2: + secondary elements
wu-browser snap --all              # Layer 3: everything
```

**4. State codes** — Form elements show their state inline: `✓` checked, `-` unchecked,
`○` disabled, `!` required. Zero token cost on pages without forms.

**5. Model-aware** — Automatically adjusts output for your LLM's context window.
GPT-4o gets rich format. Local 8K models get ultra-compact.

```bash
wu-browser snap --model gpt-4o-mini   # Optimized for small models
wu-browser snap --model local-8k      # Maximum compression
```

**6. Importance scoring** — Elements ranked 0-100 by role and region.
Pruning removes least important elements first, not by DOM order.

**7. Encrypted sessions** — AES-256-GCM. Save and restore browser sessions securely.

```bash
wu-browser session save mysite
wu-browser session restore mysite
```

## v1.6 Highlights

- **State Codes**: ✓○!- status indicators for form elements
- **Domain Hints**: External links show `→domain` target
- **Smart Truncation**: Token-aware name trimming (8-token cap), CJK optimized
- **Progressive Snapshot**: 3-layer disclosure (L1 saves 31-49% tokens)
- **Session Legend**: 50t one-time format guide, then +0 per snapshot

## Architecture

```
CLI / MCP Server / HTTP API
        │
   Snapshot Engine (UCF / Rich / Incremental)
        │
   DOM Extractor (CDP → Chrome DevTools Protocol)
        │
   Chrome (port 9222)
```

134 tests. MIT license.

## Coming in v1.7

MCP Server improvements — enhanced tool descriptions and streaming support.

## License

MIT

---

# 中文說明

> 你的 AI 花 80% 的 token 在讀網頁。Wu Browser 幫你省掉 77%。

## 這是什麼

Wu Browser 讓 AI 用更聰明的方式讀網頁。
不是每次都倒整棵 accessibility tree 給 AI，
而是只傳「變了什麼」— 用 LLM 看得懂的格式，不是給人看的格式。

## 證據

| 頁面 | Wu Browser | agent-browser | Playwright | 節省 |
|------|-----------|---------------|------------|------|
| Google 搜尋 | 1,317 tokens | 1,859 tokens | 8,356 tokens | 29-84% |
| GitHub Repo | 1,624 tokens | 4,382 tokens | N/A | 63% |
| 同頁再讀 | 72 tokens | 259 tokens | 544 tokens | 72-87% |

誠實說明：簡單頁面（Google 首頁）agent-browser 的激進過濾（259t）比我們（406t）少。
我們保留更多元素確保可靠性。複雜頁面我們大幅領先。

所有 benchmark 使用同一個 token 計數器（js-tiktoken, cl100k_base），原始碼在 `benchmark/`。

## 安裝

```bash
npm install -g wu-browser
```

一行搞定。不需要 Docker，不需要設定檔。

## 使用

```bash
wu-browser chrome                     # 啟動 Chrome
wu-browser nav https://github.com     # 導航
wu-browser snap --format ucf          # UCF 快照（~10 tokens/元素）
wu-browser snap --diff                # 增量（只傳變化）
wu-browser click @e3                  # 點擊
wu-browser snap --diff                # 看變化（~72 tokens）
```

## 核心差異

1. **增量快照** — 只傳變化。第二次讀同一頁 = 72 tokens。全市場唯一。
2. **UCF 格式** — 每個元素 10 tokens（標準 21 tokens）。為 LLM 設計。
3. **分層披露** — 先給你 30% 的關鍵元素。不夠再展開。Google 首頁：207t（L1）vs 406t（全部）。
4. **狀態碼** — 表單元素直接顯示 ✓○!- 狀態。無表單頁面零成本。
5. **模型自適應** — 自動偵測你的 LLM 調整輸出格式。
6. **重要性評分** — 裁剪從最不重要的元素開始，不是按 DOM 順序。
7. **加密 Session** — AES-256-GCM。你的瀏覽資料不外洩。

## v1.7 預告

MCP Server 增強 — 改進工具描述和串流支援。

## 授權

MIT
