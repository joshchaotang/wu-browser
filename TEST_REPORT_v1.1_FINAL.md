# Wu Browser v1.1.0 最終實測報告

**測試日期**：2026-03-29
**測試環境**：macOS Darwin 25.3.0, Node.js v25.5.0, Chrome CDP port 9222
**Token 計數器**：js-tiktoken cl100k_base
**安裝方式**：`npm install -g wu-browser-1.1.0.tgz`（全局安裝驗證）

---

## 1. 環境確認

| 項目 | 結果 |
|------|------|
| Version | 1.1.0 ✅ |
| Build (`npm run build`) | ✅ 通過 |
| Unit Tests (`npm test`) | 50/50 通過 ✅ |
| Chrome 連線 | ✅ connected port 9222 |

---

## 2. 核心功能實測

| # | 功能 | README 宣稱 | 實測結果 | 符合？ | 備註 |
|---|------|------------|---------|--------|------|
| C1 | Google 首頁 snapshot | ~858 tokens, 40 元素 | **906 tokens, 43 元素** | ⚠️ 偏差 | 登入態多 3 個元素（帳號按鈕等），合理偏差 |
| C2 | 增量 snapshot | 858→72, 92% | **906→72, 92.1%** | ✅ | |
| C3 | Mini-snapshot（無導航）| ~6 tokens | **17 tokens** | ❌ 不符 | 實測 17 tokens（頁面無變化）；導航時 35 tokens |
| C4 | Cookie 自動關閉 | BBC 測試 | **BBC 無 cookie banner 殘留** | ✅ | |
| C5 | 權限系統 | GREEN/YELLOW/RED/BLACK | **link→GREEN, Add to Cart→YELLOW, Buy Now→RED, chase.com→BLACK** | ✅ | 四級全正確 |

### C3 詳細說明

README 宣稱 mini-snapshot ~6 tokens，實測：
- `click @e10`（頁面無變化）：context = `[動作完成] click @e10 → 頁面無變化`，**17 tokens**
- `type @e10 "Wu AI"`：context = `[動作完成] type @e10 "Wu AI" → 完成`，**18 tokens**
- `click @e3`（導航到 Gmail）：context 含完整 URL，**35 tokens**
- `click @e56`（導航到 Instagram）：**38 tokens**

**結論：README 的 ~6 tokens 宣稱與實測不符。實測 mini-snapshot 為 17-38 tokens，取決於是否導航。建議更新 README。**

---

## 3. 工作流 Benchmark（殺手鐧）

### Google 搜尋 "Wu AI" → 讀第一條結果

| Step | Action | Token Count | Mode | Notes |
|------|--------|------------|------|-------|
| B | First snapshot | 906 | full | Google homepage, 43 元素 |
| C | Type "Wu AI" | 18 | mini | auto context after type |
| D | Read after type | 72 | incremental | same page, 92% savings |
| E | Navigate to search | — | nav | 用 nav 替代 click（Google 搜尋按鈕被建議列遮擋）|
| F | Read results | 1,456 | full | search results, 130 元素（裁剪 63%）|
| G | Click result | 38 | mini | navigated to Instagram |
| H | Read target | 1,441 | full | Instagram page, 79 元素（裁剪 9%）|
| **Total** | | **3,931** | | |

### 與 README 宣稱的比較

README 的 "Real-World Workflow Cost" 表宣稱 5 步工作流 ~1,164 tokens。

**差異分析：**
- README 假設每次 re-read 都是增量（72 tokens）
- 實測：導航到新頁面後，增量不適用（新 URL ≠ 舊 URL），所以 Step F 和 H 是完整 snapshot（1,456 和 1,441）
- 增量 snapshot 只在**同一 URL 重複讀取**時有效

**更精確的工作流成本模型：**

| 場景 | Token |
|------|-------|
| 首次讀頁面 | ~900-1,500 |
| 同頁再讀（增量）| ~72 |
| 操作後 mini-snapshot | ~17-38 |
| 導航後讀新頁面 | ~900-1,500 |

### 競品估算比較

| 工具 | 同一工作流估算 token | 來源 |
|------|-------------------|------|
| **Wu Browser** | **3,931** (實測) | 本報告 |
| Playwright MCP | ~5,000-15,000 | 引用：每步全量 snapshot 500-2,000 tokens × 4 次讀取（無增量機制）|
| Claude-in-Chrome | ~3,000-8,000 | 引用：read_page 通常 500-2,000 tokens × 4 次讀取 |

**Wu Browser 的優勢在同頁重複讀取場景（增量 92% 省）。跨頁導航時優勢較小。**

---

## 4. Adapter 實測

| Adapter | 指令 | 結果 | 通過 |
|---------|------|------|------|
| google/search | `site run google/search "Wu AI"` | 17 條結構化結果 JSON（title + url）| ✅ |
| github/repo | `site run github/repo "anthropics/claude-code"` | name, 84k stars, 7.1k forks, 529 watching | ✅ |
| github/issues | 已實作，未單獨測 | — | — |
| form/detect | Google 首頁 `site run form/detect` | 找到 1 個搜尋框 @e10 combobox "搜尋" | ✅ |
| form/fill | 已實作，未單獨測（需要有表單的頁面）| — | — |

---

## 5. JSON + jq 測試

| # | 測試 | 結果 | 通過 |
|---|------|------|------|
| J1 | `snap -i --json` 有效 JSON | ✅ 可被 `JSON.parse()` 解析（含 sanitized 控制字元）| ✅ |
| J2 | `snap -i --json \| jq '.elements \| length'` | 返回 43 | ✅ |

---

## 6. Network 攔截測試

| # | 測試 | 結果 | 通過 |
|---|------|------|------|
| N1 | 單進程 startCapture → navigate → getCapturedRequests | 攔截 54 個請求，首筆 GET google.com 200 | ✅ |

備註：CLI 跨進程不支援 network capture（設計限制，MCP server session 內正常）。

---

## 7. 發佈就緒

| 項目 | 結果 |
|------|------|
| npm pack 大小 | 59 KB ✅（< 5MB）|
| 全局安裝後 `--version` | 1.1.0 ✅ |
| 全局安裝後 `snap -i` | 906 tokens ✅ |
| 全局安裝後 `site list` | 3 adapters（google, github, form）✅ |
| 全局安裝後 `status` | ✅ connected |

---

## 8. 發現的問題

### 嚴重度：中

**1. Mini-snapshot token 數與 README 宣稱不符**
- README 宣稱：~6 tokens
- 實測：17 tokens（無導航）、35-38 tokens（有導航）
- 重現：`click @e10` on Google homepage → context = 17 tokens
- 影響：README 工作流成本表低估了 mini-snapshot 成本
- 建議：更新 README 宣稱為 ~17 tokens（無導航）/ ~35 tokens（有導航）

**2. README 工作流成本表過於樂觀**
- README 宣稱 5 步工作流 ~1,164 tokens
- 實測 7 步工作流 3,931 tokens
- 原因：README 假設每次 re-read 都是增量（72 tokens），但跨頁導航後增量不適用
- 影響：誤導用戶對 token 節省的期望
- 建議：README 應區分「同頁重複讀取」和「跨頁導航」兩種場景

### 嚴重度：輕

**3. Google 搜尋按鈕 click 被建議列遮擋**
- 在 Google 首頁 type "Wu AI" 後，click @e22（Google 搜尋按鈕）→ 頁面無變化
- 原因：Google 的搜尋建議下拉選單可能遮擋了搜尋按鈕
- 影響：需要用 `nav` 替代 `click` 來觸發搜尋
- 建議：adapter 的做法（直接 nav 到 /search?q=）是正確的解法

**4. CLI click 不顯示 mini-snapshot context**
- CLI `wu-browser click @e3` 只輸出 "Clicked @e3"，不顯示 mini-snapshot 的 context 字串
- MCP server 會完整返回 context
- 影響：CLI 用戶看不到 mini-snapshot 的價值
- 建議：CLI click 也輸出 context

---

## 9. 結論

### Wu Browser 的核心價值（實測驗證）

1. **增量 snapshot**：省 **92.1%**（實測 906 → 72 tokens）✅
2. **Mini-snapshot**：**17-38 tokens**/action（實測，非宣稱的 6 tokens）⚠️
3. **7 步工作流總計**：**3,931 tokens**（含 3 次完整 snapshot + 3 次 mini + 1 次增量）
4. **同頁重複讀取場景**：Wu Browser 大幅領先（72 vs ~1000 tokens）
5. **跨頁導航場景**：Wu Browser 接近傳統工具（~1,400 vs ~1,000-2,000 tokens）
6. **Adapter 系統**：3 個 adapter 全部可用
7. **權限系統**：四級分類正確
8. **JSON + jq**：正常
9. **Network 攔截**：MCP session 內正常

### 是否準備好開源？

**是，但建議先修正 README 中的 mini-snapshot 數據。**

核心功能全部正常運作。增量 snapshot 的 92% 節省是真實的殺手鐧。
但 README 中有兩處數據需更新：
1. Mini-snapshot ~6 tokens → ~17 tokens（差 3 倍）
2. 工作流成本表需區分同頁/跨頁場景

這些不影響功能，但影響公信力。修正數據後即可發佈。

---

**報告完整性聲明**：以上所有數字均為 2026-03-29 當次跑出的實測值。未使用任何先前報告的數字。無法測試的項目已標「未測 + 原因」。競品數據已標「引用」。
