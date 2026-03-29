# Changelog

## v1.6.0 (2026-03-29)

### Core Breakthrough
- **State Codes**: Conditional status indicators in UCF (✓ checked, - unchecked, ○ disabled, ! required)
  - Zero token increase on stateless pages; ~10t on form pages
  - LLM can see checkbox/radio/select state without extra round-trip
- **Domain Hints**: External links show `→domain` target
  - Same-domain links unchanged; external links add ~2t each
  - Eliminates "where does this link go?" follow-up queries
- **Smart Name Truncation**: Token-aware name truncation (8 token budget per name)
  - Chinese pages: ~10t/el → ~7-8t/el
  - Binary search with js-tiktoken for precise CJK truncation
- **Importance Scoring**: Elements scored 0-100 by role + region
  - Pruning now removes least important elements first (not by DOM order)
  - `src/snapshot/importance-scorer.ts` — deterministic, no ML
- **Progressive Snapshot**: 3-layer disclosure
  - Layer 1: core interactive (~200t on Google)
  - Layer 2: full interactive (~320t)
  - Layer 3: all elements (~406t)
  - `--progressive`, `-2`, `--all` on CLI; `progressive: 1|2|3` on MCP
- **Session Legend**: Auto-attached on first UCF snapshot in MCP session (~50t one-time)
  - Subsequent snapshots skip legend (amortized 2.5t/snapshot over 20 calls)

### Benchmark (三方公平對比)

| 場景 | Wu UCF v1.6 | Wu UCF v1.5 | agent-browser | Playwright |
|------|-------------|-------------|---------------|------------|
| Google 首頁 | **406t** | 433t | 259t | 544t |
| Google 搜尋 | **1,317t** | 1,752t | 1,859t | 8,356t |
| GitHub repo | **1,624t** | 1,708t | 4,382t | N/A |
| 同頁再讀 | **72t** | 72t | 259t | 544t |
| 表單頁（state codes）| **169t** | N/A | N/A | N/A |

### Progressive Snapshot 效果

| 場景 | Full UCF | Progressive L1 | 省 |
|------|----------|----------------|-----|
| Google 首頁 | 406t | 207t | 49% |
| Google 搜尋 | 1,317t | 908t | 31% |
| GitHub repo | 1,624t | 1,560t | 4% |

### v1.6 vs v1.5 Token 改善

| 場景 | v1.5 UCF | v1.6 UCF | 改善 |
|------|----------|----------|------|
| Google 首頁 | 433t | 406t | -6% |
| Google 搜尋 | 1,752t | 1,317t | -25% |
| GitHub repo | 1,708t | 1,624t | -5% |

## v1.5.0 (2026-03-29)

### Core Breakthrough
- **UCF (Ultra-Compact Format)**: ~10 tokens/element (industry lowest)
  - Single-letter role codes, pipe-separated, no href
  - Google homepage: 433t (vs Playwright 544t, agent-browser 428t)
  - `--format ucf` on CLI, `snapshotFormat: "ucf"` on MCP
  - Auto-enabled for local-8k, local-32k, gpt-4o-mini profiles

### New Features
- **Context-Aware Pruning**: Adjusts element priority based on last action
  - After type → boost search result links, demote nav/footer
  - After click → boost main content area
- **Predictive Structural Diff**: Lower threshold (50%) for pagination
  - URL query-only changes (e.g. ?page=2) trigger structural diff more aggressively

### Benchmark (三方公平對比)

| 場景 | Wu UCF | Wu Rich | agent-browser | Playwright |
|------|--------|---------|---------------|------------|
| Google 首頁 | **433t** | 908t | 428t | 544t |
| Google 搜尋 | **1,752t** | 4,674t | 3,981t | 8,356t |
| GitHub repo | **1,708t** | 5,087t | 7,425t | N/A |
| 同頁再讀 | **72t** | 72t | 428t | 544t |

## v1.4.0 (2026-03-29)

### New Features
- **ModelSense**: Intelligent LLM version adaptation — 9 builtin profiles (Claude/GPT/Gemini/local)
  - `--model` flag on CLI and MCP
  - `wu-browser calibrate` auto-calibration
  - `wu-browser model --list` to see all profiles
  - gpt-4o-mini profile: 558t vs Playwright 544t (nearly matched)
  - local-8k profile: 339t on Google homepage (63% less than default)
- **Encrypted Session Persistence**: `wu-browser session save/restore/list/delete`
  - AES-256-GCM encryption with `WU_BROWSER_ENCRYPTION_KEY`
  - Saves cookies + localStorage
- **Security Config**: `~/.wu-browser/security.json` with human-friendly settings
  - `permissionLevel`: strict / balanced / permissive
  - `domainRules`: wildcard support (`*.bank.com → BLACK`)
  - CLI: `wu-browser security show/set/allow/block`

### Benchmark
- S1 single read: default 908t, mini profile 558t, Playwright 544t
- S2 same-page re-read: 72t vs Playwright 544t (87% savings)
- S4 4-step workflow: 2,984t vs Playwright 14,736t (80% savings)
- S7 ModelSense: Google search results opus 4,560t → local-8k 358t (92% savings)

## v1.3.0 (2026-03-29)

### New Features
- **Content Boundaries** (B1): `--content-boundaries` wraps output in nonce-tagged markers for prompt injection safety
- **Batch Commands** (B2): `wu-browser batch` executes multiple commands from stdin JSON array, with `--bail`
- **Output Token Budget** (B3): `--max-output` alias for small model friendly token limits
- **Structural Incremental** (B4, experimental): Level 3 skeleton-based diff for structurally similar pages
- **Annotated Screenshots** (B5): `wu-browser screenshot --annotate` overlays ref labels for vision models
- **iframe Traversal** (B6): Same-origin iframe elements visible with `@f1.eN` refs

### Benchmark
- Fair comparison vs Playwright ariaSnapshot (same tiktoken counter)
- S2 same-page re-read: Wu Browser 78 vs Playwright 544 tokens (86% savings)
- S4 4-step workflow: Wu Browser 2,541 vs Playwright 14,736 tokens (83% savings)
- S1 single read: Playwright 544 vs Wu Browser 912 (Playwright wins by 40%)

## v1.2.0 (2026-03-29)

### Fixes
- README mini-snapshot corrected from ~6 to ~17 tokens (honest numbers)
- Workflow cost table split into same-page (75% saving) and cross-page (4% saving)

### New Features
- **Domain-Level Incremental** (experimental): Skip shared elements across same-domain pages
- **Semantic Find**: `wu-browser find --role button --name "搜尋"` — find by meaning, not selectors
- **Token Cost Awareness**: Every MCP response includes `_tokenCost`
- **MCP tool**: `wu_find` for semantic element search
- **MCP tool**: `wu_site_command` for adapter execution

## v1.1.0 (2026-03-29)

### New Features
- 3 site adapters: Google Search, GitHub repo/issues, Form detect/fill
- JSON output sanitization (control character fix)
- Action counting moved to action layer

### Publishing
- npm pack ready (59KB)
- Global install verified

## v1.0.0 (2026-03-27)

Initial release.
- DOM-based page reading (interactive/content/full modes)
- Incremental snapshot (92% token savings)
- Mini-snapshot after actions (~17 tokens)
- 4-level permission system (GREEN/YELLOW/RED/BLACK)
- Auto cookie consent dismissal
- JSON output with jq filtering
- MCP stdio server (17 tools)
- HTTP API server (Fastify)
- Network request capture
- Chrome launcher + CDP connection management
