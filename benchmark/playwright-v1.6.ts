/**
 * benchmark/playwright-v1.6.ts — Playwright ariaSnapshot comparison
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { encodingForModel } from 'js-tiktoken';

const enc = encodingForModel('gpt-4o');
function countTokens(text: string): number {
  return enc.encode(text).length;
}

const __dirname = dirname(fileURLToPath(import.meta.url));

// Use Playwright's CDP connect
async function run() {
  const { chromium } = await import('playwright');
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const contexts = browser.contexts();
  const page = contexts[0]?.pages()[0];
  if (!page) {
    console.error('No page found');
    process.exit(1);
  }

  const results: { scenario: string; tokens: number }[] = [];

  async function measure(label: string, url: string) {
    console.log(`${label}: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(2000);
    const snap = await page.accessibility.snapshot();
    const text = JSON.stringify(snap, null, 2);
    const tokens = countTokens(text);
    results.push({ scenario: label, tokens });
    console.log(`  playwright: ${tokens}t`);
  }

  await measure('S1: Google homepage', 'https://www.google.com');
  await measure('S3: Google search', 'https://www.google.com/search?q=wu+browser+ai');
  await measure('S4: GitHub repo', 'https://github.com/anthropics/claude-code');

  const outputPath = join(__dirname, 'results', 'playwright-v1.6.json');
  writeFileSync(outputPath, JSON.stringify(results, null, 2));
  console.log(`\nResults saved to ${outputPath}`);

  await browser.close();
}

run().catch(err => { console.error(err); process.exit(1); });
