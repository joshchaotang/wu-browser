# Wu Browser v1.4 vs 競品 — 公平 Benchmark 報告

## 測試環境

- **日期**：2026-03-29
- **OS**：macOS Darwin 25.3.0
- **Node.js**：v25.5.0
- **Chrome**：146.0.7680.165 (CDP port 9222)
- **Token 計數器**：js-tiktoken cl100k_base（所有工具統一）
- **每場景跑 3 次取中位數**

## 版本

| 工具 | 版本 |
|------|------|
| Wu Browser | v1.4.0 (with ModelSense) |
| Playwright | v1.58.2 (`page.locator('body').ariaSnapshot()` via CDP) |

---

## 結果總表

| 場景 | Wu Browser (default) | Wu Browser (gpt-4o-mini) | Playwright | Wu 優勢 |
|------|---------------------|-------------------------|------------|---------|
| S1 單頁讀取 | **908 t** | **558 t** | **544 t** | default -67% / mini +3% |
| S2 同頁再讀 | **72 t** | **72 t** | **544 t** | **87%** |
| S3 跨頁（2 頁）| **2,823 t** | — | **8,900 t** | **68%** |
| S4 4 步工作流 | **2,984 t** | — | **14,736 t** | **80%** |

### 新增場景

| 場景 | 結果 | 說明 |
|------|------|------|
| S6 Batch vs Sequential | 12ms vs 20ms | in-process batch 快 40% |
| S7 ModelSense (Google) | opus 908 → local-8k 339 | **63% 省 token** |
| S7b ModelSense (Search) | opus 4560 → local-8k 358 | **92% 省 token** |

---

## 關鍵發現

### 1. ModelSense 解決了 S1 敗北問題

v1.3 的 S1 用 912t 輸給 Playwright 的 544t。v1.4 用 gpt-4o-mini profile（不含 href）降到 **558t**，與 Playwright 的 544t **僅差 14t（+3%）**——幾乎打平，但 Wu Browser 多了可操作的 ref。

### 2. 增量優勢持續碾壓

同頁再讀 72t vs 544t = 省 87%。4 步工作流 2,984t vs 14,736t = 省 80%。

### 3. ModelSense 在複雜頁面效果巨大

Google 搜尋結果頁：
- opus（完整）：4,560 tokens / 118 elements
- sonnet（平衡）：1,915 tokens / 31 elements（省 58%）
- gpt-4o-mini（精簡）：729 tokens / 20 elements（省 84%）
- local-8k（極限）：358 tokens / 11 elements（省 92%）

**同一頁面，不同 LLM 看到不同密度的資訊**——這是全市場獨有的能力。

---

## S7: ModelSense Profile 實測數據

### Google 首頁（43 個互動元素）

| Profile | Budget | Tokens | Elements | vs Full |
|---------|--------|--------|----------|---------|
| claude-opus-4.6 | 5000 | 908 | 43 | baseline |
| claude-sonnet-4.6 | 2000 | 908 | 43 | 0% |
| gpt-4o | 1500 | 865 | 43 | -5% |
| gpt-4o-mini | 800 | 558 | 43 | -39% |
| local-8k | 400 | 339 | 24 | -63% |

**分析**：Google 首頁元素少（43 個），opus/sonnet 都不需要裁剪。gpt-4o-mini 靠省略 href 省 39%。local-8k 靠 budget 限制 + 省略 href/region 省 63%（只留 24 個元素）。

### Google 搜尋結果（118 個互動元素）

| Profile | Budget | Tokens | Elements | vs Full |
|---------|--------|--------|----------|---------|
| claude-opus-4.6 | 5000 | 4560 | 118 | baseline |
| claude-sonnet-4.6 | 2000 | 1915 | 31 | -58% |
| gpt-4o | 1500 | 1405 | 26 | -69% |
| gpt-4o-mini | 800 | 729 | 20 | -84% |
| local-8k | 400 | 358 | 11 | -92% |

**分析**：這才是 ModelSense 的真正戰場。118 個元素在 opus 下完整呈現（4560t），但 local-8k 只需要 11 個互動元素（358t）。這讓 8K context 的小模型也能操作 Google 搜尋。

---

## 場景詳細數據

### S1: 單頁讀取（Google 首頁）

| 工具 | Run 1 | Run 2 | Run 3 | 中位數 |
|------|-------|-------|-------|-------|
| Wu Browser (default) | 908 | 908 | 908 | **908** |
| Wu Browser (mini) | 558 | 558 | 558 | **558** |
| Playwright | 544 | 544 | 544 | **544** |

**結論**：Default profile 908t（比 Playwright 多 67%），但 gpt-4o-mini profile 558t（僅多 3%）。Wu Browser 輸出包含可操作的 ref。

### S2: 同頁再讀（增量）

| 工具 | Run 1 | Run 2 | Run 3 | 中位數 |
|------|-------|-------|-------|-------|
| Wu Browser | 72 | 72 | 72 | **72** |
| Playwright | 544 | 544 | 544 | **544** |

**結論**：增量模式省 87%。Playwright 沒有增量。

### S3: 跨頁導航

| 工具 | 頁面 1 | 頁面 2 | 總計 |
|------|-------|-------|------|
| Wu Browser | 908 | 1,915 | **2,823** |
| Playwright | 544 | 8,356 | **8,900** |

**結論**：Wu Browser 省 68%。

### S4: 4 步工作流

| 工具 | Step 1 | Step 2 | Step 3 | Step 4 | 總計 |
|------|--------|--------|--------|--------|------|
| Wu Browser | 908 | 72 | 1,915 | 89 | **2,984** |
| Playwright | 544 | 544 | 8,356 | 5,292 | **14,736** |

**結論**：Wu Browser 省 80%。Step 2 增量 72t vs 全量 544t，Step 4 增量 89t vs 全量 5,292t。

---

## 功能差異矩陣

| 功能 | Wu Browser v1.4 | Playwright |
|------|----------------|------------|
| URL 增量 snapshot | ✅ 87% savings | ❌ 每次全量 |
| 域級增量 | ⚠️ experimental | ❌ |
| Structural diff | ⚠️ experimental | ❌ |
| **ModelSense（LLM 適配）** | **✅ 9 profiles** | **❌** |
| **Calibrate 自校準** | **✅** | **❌** |
| Token 裁剪 | ✅ maxTokens 預算 | ❌ 完整輸出 |
| 元素 ref（可點擊）| ✅ @eN | ❌ |
| 語意定位 | ✅ wu_find | ❌ |
| 權限系統 | ✅ 4 級 | ❌ |
| **安全設定（domain rules）** | **✅ 萬用字元** | **❌** |
| Content boundaries | ✅ | ❌ |
| Batch commands | ✅ | ❌ |
| Annotated screenshots | ✅ | ✅（內建）|
| **加密 Session 持久化** | **✅ AES-256-GCM** | **❌** |
| iframe 穿透 | ✅ same-origin | ✅ 完整 |
| Shadow DOM | ✅ open roots | ✅ |
| 代價感知 | ✅ _tokenCost | ❌ |
| MCP server | ✅ | ✅ |
| Cookie 自動關閉 | ✅ | ❌ |
| Adapters | 3 | N/A |

---

## 誠實聲明

### Wu Browser 贏的場景
- **S2 同頁再讀**：87% 省——增量 snapshot 核心差異化
- **S3 跨頁**：68% 省——裁剪 + 域級比對
- **S4 工作流**：80% 省——增量 + 裁剪的組合效果
- **S7 ModelSense**：同頁面 opus 908t → local-8k 339t（63% 省）

### Wu Browser 輸的場景
- **S1 單頁讀取（default profile）**：比 Playwright 多 67% tokens
- **S1 用 mini profile**：僅多 3%，但代價是少了 href 資訊
- **完整性**：裁剪可能遺漏重要元素。Playwright 給完整 AX tree。

### 數據來源
- 所有數字為 2026-03-29 實測（`benchmark/results/` 目錄有原始 JSON）
- Token 計數統一使用 js-tiktoken cl100k_base
- 每場景跑 3 次，結果完全一致（deterministic）
- Playwright 數據來自 v1.3 benchmark（同日、同環境）

### 已知限制
1. Playwright 的 `ariaSnapshot()` 不包含 href——如果 AI 需要點擊鏈接，Playwright 需要額外查詢
2. ModelSense 的 profile 是靜態設定，不是動態推理
3. local-8k profile 在搜尋結果頁只留 11 元素——可能不夠用
4. 測試只用了 Google——其他網站可能有不同比例
5. Batch 效率測試在 in-process 模式，CLI 多進程的 round-trip 差異更大

---

## 結論

**Wu Browser v1.4 的兩大突破：**

1. **ModelSense 解決了首次讀取輸 Playwright 的問題**：gpt-4o-mini profile 558t vs Playwright 544t，幾乎打平。

2. **同一頁面自動適配不同 LLM**：搜尋結果頁從 4,560t（opus）到 358t（local-8k），讓 8K 小模型也能操作複雜頁面。

**推薦使用場景**：
- 多次讀取工作流 → Wu Browser（80-87% 省）
- 大模型（1M context）→ `--model claude-opus-4.6`（完整資訊）
- 小模型（8K-32K）→ `--model local-8k`（極限裁剪）
- 安全敏感場景 → Wu Browser（權限系統 + 加密 session + domain rules）
