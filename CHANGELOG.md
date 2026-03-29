# Changelog

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
