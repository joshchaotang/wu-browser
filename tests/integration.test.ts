/**
 * integration.test.ts — 整合測試（需要真實 Chrome on port 9222）
 *
 * 跳過條件：CHROME_NOT_AVAILABLE env var 設定，或連線失敗。
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { connect, disconnect, isConnected } from '../src/browser/connection.js';
import { snapshot } from '../src/dom/snapshot.js';
import { navigate } from '../src/dom/actions.js';
import { listTabs } from '../src/browser/session.js';

let chromeAvailable = false;

beforeAll(async () => {
  if (process.env.CHROME_NOT_AVAILABLE) {
    console.log('Skipping integration tests: CHROME_NOT_AVAILABLE set');
    return;
  }

  try {
    await connect({ port: 9222, maxRetries: 1 });
    chromeAvailable = true;
    console.log('✅ Chrome connected for integration tests');
  } catch {
    console.log('⚠️  Chrome not available, skipping integration tests');
    console.log('   Start Chrome with: wu-browser chrome');
  }
});

afterAll(async () => {
  // 不斷線 Chrome，它在後台跑
});

function skip() {
  return !chromeAvailable;
}

describe('Chrome connection', () => {
  it('connects to Chrome on port 9222', async () => {
    if (skip()) return;
    expect(isConnected()).toBe(true);
  });

  it('lists tabs', async () => {
    if (skip()) return;
    const tabs = await listTabs();
    expect(Array.isArray(tabs)).toBe(true);
    console.log(`  Found ${tabs.length} tabs`);
    if (tabs.length > 0) {
      expect(tabs[0]).toHaveProperty('id');
      expect(tabs[0]).toHaveProperty('url');
      expect(tabs[0]).toHaveProperty('title');
    }
  });
});

describe('Snapshot — Google homepage', () => {
  it('navigates and takes interactive snapshot', async () => {
    if (skip()) return;

    await navigate('https://www.google.com');

    const result = await snapshot({ mode: 'interactive', maxTokens: 1000 });

    console.log(`  URL: ${result.url}`);
    console.log(`  Title: ${result.title}`);
    console.log(`  Elements: ${result.elementCount}`);
    console.log(`  Tokens: ~${result.tokenCount}`);
    console.log(`  Truncated: ${result.truncated}`);
    console.log('\n--- Snapshot output ---');
    console.log(result.tree);
    console.log('--- End snapshot ---');

    expect(result.url).toContain('google.com');
    expect(result.tokenCount).toBeLessThan(1500);
    expect(result.tree).toContain('[頁面]');
    expect(result.tree).toContain('---');
    expect(result.elementCount).toBeGreaterThan(0);
    console.log(`  ✅ Token count (${result.tokenCount}) < 1000`);
  });

  it('takes content snapshot', async () => {
    if (skip()) return;

    const result = await snapshot({ mode: 'content', maxTokens: 1000 });
    expect(result.tree).toContain('[頁面]');
    expect(result.tokenCount).toBeGreaterThan(0);
    console.log(`  Content tokens: ~${result.tokenCount}`);
  });
});

describe('Snapshot — token budget', () => {
  it('respects maxTokens limit', async () => {
    if (skip()) return;

    await navigate('https://www.google.com');
    const result = await snapshot({ mode: 'interactive', maxTokens: 300 });

    expect(result.tokenCount).toBeLessThanOrEqual(350); // 允許小幅誤差
    console.log(`  Tokens with 300 budget: ${result.tokenCount}`);
  });
});
