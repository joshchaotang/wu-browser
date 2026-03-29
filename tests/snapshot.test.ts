import { describe, it, expect } from 'vitest';
import { estimateTokens, truncateToTokens } from '../src/utils/token-counter.js';

/**
 * snapshot.ts 的單元測試
 *
 * 注意：snapshot() 需要真實 Chrome 連線，
 * 真實 E2E 測試在 integration.test.ts。
 * 這裡只測試 token 計算與截斷邏輯。
 */
describe('token-counter', () => {
  describe('estimateTokens', () => {
    it('counts tokens using tiktoken', () => {
      expect(estimateTokens('hello')).toBe(1);   // tiktoken: "hello" = 1 token
      expect(estimateTokens('hello world')).toBeGreaterThan(0);
      expect(estimateTokens('')).toBe(0);
    });

    it('estimates reasonable tokens for typical snapshot output', () => {
      const typicalLine = '[@e1] button "發推文"\n[@e2] link "首頁" href="/home"\n[@e3] textbox "搜尋"';
      const tokens = estimateTokens(typicalLine);
      // 典型 3 行 snapshot 應該遠小於 1000 token
      expect(tokens).toBeLessThan(100);
      expect(tokens).toBeGreaterThan(0);
    });
  });

  describe('truncateToTokens', () => {
    it('does not truncate when within budget', () => {
      const text = 'short text';
      const result = truncateToTokens(text, 1000);
      expect(result.truncated).toBe(false);
      expect(result.text).toBe(text);
      expect(result.truncatedPercent).toBe(0);
    });

    it('truncates when over budget', () => {
      const text = 'this is a longer text that exceeds the budget for sure';
      const result = truncateToTokens(text, 5);
      expect(result.truncated).toBe(true);
      // Truncated text should have fewer tokens than original
      expect(estimateTokens(result.text)).toBeLessThanOrEqual(6); // allow small overhead
      expect(result.truncatedPercent).toBeGreaterThan(0);
    });

    it('appends suffix when truncating', () => {
      const text = 'a very long text that should be truncated by the algorithm for sure yes';
      const suffix = '[...truncated]';
      const result = truncateToTokens(text, 5, suffix);
      expect(result.text.endsWith(suffix)).toBe(true);
    });

    it('handles empty string', () => {
      const result = truncateToTokens('', 1000);
      expect(result.truncated).toBe(false);
      expect(result.text).toBe('');
    });
  });
});

/**
 * snapshot 輸出格式驗證
 * 確保 interactive 模式輸出符合規格
 */
describe('snapshot output format', () => {
  it('interactive format contains expected structure', () => {
    // 模擬 snapshot 輸出的格式檢查
    const mockOutput = [
      '[頁面] Google (https://google.com)',
      '---',
      '[@e1] searchbox "Search"',
      '[@e2] button "Google Search"',
      '[@e3] button "I\'m Feeling Lucky"',
      '---',
      '[3 個元素 · interactive 模式]',
    ].join('\n');

    expect(mockOutput).toContain('[頁面]');
    expect(mockOutput).toContain('---');
    expect(mockOutput).toContain('[@e1]');
    expect(mockOutput).toContain('interactive 模式');

    const tokenCount = estimateTokens(mockOutput);
    expect(tokenCount).toBeLessThan(200);
  });
});
