# Wu Browser Architecture

## Philosophy

AI reads a page like a doctor reads a patient — focus on what's changed, not what's the same.

Every token costs money and context window. Wu Browser's job is to give AI the minimum information needed to act, and no more.

## Core Differentiators (things no competitor does)

1. **Three-level incremental**: URL-level (92%) → Domain-level (experimental) → Cross-domain structural (planned)
2. **Semantic element addressing**: role + name, not CSS selectors. Survives website updates.
3. **Token-aware agent**: every action reports cost. Agent can budget.
4. **4-level permission system**: safety built in, not bolted on.
5. **Predictive prefetch**: mini-snapshot includes likely next targets (planned).

---

## Three-Level Incremental Architecture

```
Level 1 — URL Incremental (v1.0, production)
  Same URL, re-read → only changed elements
  Mechanism: role:name:region tuple matching, ≥70% match → incremental
  Savings: 92% (906 → 72 tokens, verified)
  Best for: Form filling, SPA state changes, polling

Level 2 — Domain Incremental (v1.2, experimental)
  Same domain, different page → skip shared nav/header/footer
  Mechanism: role:name:href hash matching on raw elements (pre-prune)
  Savings: Element count reduction 58% (95 → 40), token reduction varies
  Best for: E-commerce product browsing, search result pagination
  Limitation: Token savings depend on content density of new elements

Level 3 — Structural Incremental (v2.0, planned)
  Cross-domain → skip common web patterns
  Mechanism: Shared "web component dictionary" of common patterns
    - Cookie banners → already handled by auto-dismiss
    - Social share widgets → pattern: role=button, name=/share|tweet|pin/
    - Ad containers → pattern: region=aside, role=link, href=*/ad/*
    - Login prompts → pattern: role=dialog, contains=/login|sign in/
  Savings: 10-20% (smaller but universal)
  Validation: Measure on 10 popular sites, must save >10% average
```

---

## Semantic Element Addressing

### Problem

CSS selectors break when sites update. `#search-btn-v2` → `#search-button-new` = adapter breaks.

### Solution

Wu Browser addresses elements by **what they are**, not **where they are**:

```
Traditional:  document.querySelector('#search-btn-v2')     // breaks on update
Wu Browser:   findBySemantics({ role: 'button', name: '搜尋' })  // survives update
```

### Matching Algorithm (v1.2)

```
1. Exact role match: +10 points
2. Exact name match: +20 points
3. Partial name match (contains): +10 points
4. Fuzzy name match (Levenshtein ≤ 3): +5 points
5. Near-element proximity: re-sort by DOM index distance
```

### Self-Healing Adapter Spec (v2.0, planned)

Adapters describe workflows as semantic steps, not selector chains:

```json
{
  "name": "google-search",
  "domain": "google.com",
  "steps": [
    { "find": { "role": "combobox", "name": "/search|搜尋/i" }, "action": "type", "value": "{query}" },
    { "find": { "role": "button", "name": "/search|搜尋/i" }, "action": "click" },
    { "wait": "navigation" },
    { "find": { "role": "link", "region": "main" }, "action": "collect", "fields": ["name", "href"] }
  ]
}
```

**Degradation chain**:
1. Exact semantic match → proceed
2. Fuzzy match (Levenshtein ≤ 3) → proceed with warning
3. No match → return candidates + "element not found", don't crash

**Validation**: Run adapter against 3 snapshots from different dates. Must find target in all 3.

---

## Token Cost Awareness

### Problem

AI agents have no visibility into how much a browser action costs. They over-read, re-read full pages, waste context window.

### Solution (v1.2)

Every MCP response includes `_tokenCost`:

```json
{
  "_tokenCost": {
    "thisAction": 72,
    "sessionTotal": 2340,
    "snapshotsInSession": 5,
    "avgTokensPerSnapshot": 468
  }
}
```

CLI outputs to stderr:
```
[wu-browser] tokens: 72 · session: 2,340 · avg: 468/snap
```

### Agent Budgeting (v2.0, planned)

```
wu_snapshot({ maxTokens: "auto" })
→ System checks remaining context window (if available)
→ Adjusts maxTokens dynamically
→ Reports: "Using 800 tokens (context budget: 40% remaining)"
```

**Validation**: Compare token usage of an agent with vs without cost awareness on a 10-step task.

---

## Predictive Prefetch (v2.0, planned)

### Problem

After clicking a form field, the agent needs to take a full snapshot just to see the next field.

### Solution

Mini-snapshot upgrade: include the next likely interaction target.

```
Current:
  [動作完成] click @e5 → 頁面無變化                     # 17 tokens

Planned:
  [動作完成] click @e5 → 頁面無變化
  [下一步] @e6 textbox "Email" (空) · @e7 button "提交"   # ~47 tokens
```

### Logic

1. Find the just-operated element's DOM position
2. Walk to the next sibling interactive element (same form / same region)
3. Include up to 2 next elements in mini-snapshot
4. Cost: +30 tokens per action
5. Value: saves a 72-token incremental snapshot when the agent can act directly

### Validation

Measure on 5 multi-step forms:
- Baseline: actions without prefetch (each action → full incremental snap → next action)
- Prefetch: actions with next-element hint (some actions skip the incremental snap)
- Must save >20% total tokens to ship

---

## Permission System Architecture

```
┌─────────┐
│ Action   │ → classifyAction(action) → GREEN (navigate, scroll, snapshot)
└────┬────┘
     │ click/type
     ▼
┌─────────┐
│ Domain   │ → isDomainBlacklisted(url) → BLACK (banks, crypto)
└────┬────┘
     │ not blacklisted
     ▼
┌─────────┐
│ Element  │ → classifyClick(role, name, url)
│ Content  │     RED: buy, delete, transfer, withdraw
│          │     GREEN: link, tab, menuitem
│          │     YELLOW: everything else (ask once, remember)
└─────────┘
```

**Design principle**: Safety is not a feature toggle. It's structural.

---

## Data Flow

```
Chrome (CDP port 9222)
  ↓ Runtime.evaluate()
DOM Elements (raw: 100-2000 elements)
  ↓ pruneElements(maxTokens)
Pruned Elements (40-100 elements)
  ↓ computeIncremental / computeDomainIncremental
Incremental Elements (0-40 elements, or full)
  ↓ formatElement()
Text Tree (72-1500 tokens)
  ↓ estimateTokens(tiktoken)
Token Count
  ↓
MCP Response + _tokenCost
```

---

## File Map

```
src/
├── browser/
│   ├── connection.ts    # CDP connect/reconnect, getClient()
│   ├── launcher.ts      # Chrome discovery + launch
│   ├── network.ts       # Network domain capture
│   └── session.ts       # Tab management
├── dom/
│   ├── snapshot.ts      # Core: 3-level incremental engine
│   ├── pruner.ts        # Token budget enforcement
│   ├── actions.ts       # click/type/navigate + mini-snapshot
│   └── semantics.ts     # Semantic element finder
├── mcp/
│   └── server.ts        # MCP stdio server (19 tools)
├── http/
│   └── server.ts        # Fastify HTTP API
├── permissions/
│   ├── engine.ts        # Permission check orchestration
│   ├── rules.ts         # GREEN/YELLOW/RED/BLACK classification
│   └── store.ts         # User choice memory
├── adapters/
│   ├── types.ts         # SiteAdapter + BrowserAPI interfaces
│   ├── index.ts         # Registry + loader + executor
│   └── sites/
│       ├── google.ts    # Google Search
│       ├── github.ts    # GitHub repo + issues
│       └── form-filler.ts  # Universal form detect + fill
└── utils/
    ├── logger.ts        # audit/info/warn/error
    └── token-counter.ts # js-tiktoken cl100k_base
```

---

## Version Roadmap

| Version | Focus | Key Feature | Validation |
|---------|-------|-------------|------------|
| v1.0 | Foundation | URL incremental, mini-snapshot, permissions | 92% savings verified |
| v1.1 | Ecosystem | 3 adapters, npm publish ready | 50/50 tests, npm pack 59KB |
| v1.2 | Honesty + Tools | Corrected README, domain incremental, semantic find, token cost | README numbers match reality |
| v2.0 | Intelligence | Self-healing adapters, predictive prefetch, agent budgeting | Planned |

---

## Design Principles

1. **Measure, don't estimate**. Every number in README comes from `TEST_REPORT_v1.1_FINAL.md`.
2. **Degrade gracefully**. Semantic find → fuzzy → candidates. Never crash.
3. **Cost transparency**. Every action tells you what it cost.
4. **Safety is structural**. Permissions are in the data flow, not bolted on.
5. **Incremental by default**. Full snapshot is the fallback, not the norm.
