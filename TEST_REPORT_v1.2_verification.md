# Wu Browser v1.2 驗收報告

**日期**：2026-03-29
**環境**：macOS Darwin 25.3.0, Node.js v25.5.0, Chrome 146.0.7680.165

## 驗收結果

| # | 功能 | 結果 | 證據 |
|---|------|------|------|
| A1 | README 數據修正 | ✅ | mini-snapshot 全改 ~17t，~6t 殘留 = 0，工作流表分同頁(75%省)/跨頁(4%省) |
| A2 | 域級增量 | ⚠️ experimental | 觸發成功：61 共用元素省略 → 39 新元素送出（元素省 59%）。但 token 省 ≈ 0%（新元素內容重） |
| A3 | 語意定位 wu_find | ✅ | `find --role combobox --name 搜尋` → @e10 score:30。`find --role button --name 搜尋` → @e22 score:20 |
| A4 | 代價感知 | ✅ | CLI stderr: `tokens: 906 · session: 906 · avg: 906/snap` |
| Unit Tests | 50/50 | ✅ | vitest run |

## A2 域級增量詳細數據

- Page 1 (Google search "test"): 1450 tokens, 95 elements
- Page 2 (Google search "Wu AI"): 1453 tokens, 39 element lines (domain-incremental)
- Token savings: 0%
- Element savings: 59%
- 結論：機制正確但 token 節省取決於場景。Google 搜尋結果每條都是獨特的長文字鏈接，即使只送 39 個也填滿 maxTokens。
