#!/usr/bin/env node
/**
 * benchmark/run.js — Wu Browser vs competitors benchmark
 *
 * Runs 5 scenarios × 3 iterations for Wu Browser.
 * Then runs the same for Playwright MCP snapshot (if available).
 * agent-browser tested separately due to different architecture.
 *
 * Usage: node benchmark/run.js
 */

import { execSync } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import { countTokens, median } from './measure.js';

const RESULTS_DIR = new URL('./results/', import.meta.url).pathname;
const ITERATIONS = 3;
const CACHE_PATH = '/tmp/wu-browser-snapshot-cache.json';

function wuSnap(args = '') {
  try {
    rmSync(CACHE_PATH, { force: true });
  } catch {}
  return execSync(`npx tsx bin/wu-browser.ts snap -i ${args}`, {
    encoding: 'utf-8',
    timeout: 20000,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function wuNav(url) {
  return execSync(`npx tsx bin/wu-browser.ts nav "${url}"`, {
    encoding: 'utf-8',
    timeout: 15000,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function wuSnapIncremental(args = '') {
  // Don't clear cache — let incremental work
  return execSync(`npx tsx bin/wu-browser.ts snap -i ${args}`, {
    encoding: 'utf-8',
    timeout: 20000,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function playwrightSnapshot() {
  // Playwright MCP browser_snapshot equivalent via CLI
  try {
    const output = execSync(`npx playwright screenshot --wait-for-timeout 2000 --full-page - 2>/dev/null | wc -c`, {
      encoding: 'utf-8',
      timeout: 20000,
    });
    return output.trim();
  } catch {
    return null;
  }
}

// Run Wu Browser scenarios
async function runWuScenarios() {
  const results = {};

  console.log('=== Wu Browser Benchmark ===\n');

  // S1: Single page read
  console.log('S1: Single page read (Google)');
  const s1Tokens = [];
  for (let i = 0; i < ITERATIONS; i++) {
    wuNav('https://www.google.com');
    const output = wuSnap();
    const tokens = countTokens(output);
    s1Tokens.push(tokens);
    console.log(`  Run ${i + 1}: ${tokens} tokens`);
  }
  results.S1 = { tokens: s1Tokens, median: median(s1Tokens) };

  // S2: Same page re-read (incremental)
  console.log('\nS2: Same page re-read (Google)');
  const s2Tokens = [];
  for (let i = 0; i < ITERATIONS; i++) {
    wuNav('https://www.google.com');
    wuSnap(); // First read (populates cache)
    const output = wuSnapIncremental(); // Second read (incremental)
    const tokens = countTokens(output);
    s2Tokens.push(tokens);
    console.log(`  Run ${i + 1}: ${tokens} tokens`);
  }
  results.S2 = { tokens: s2Tokens, median: median(s2Tokens) };

  // S3: Cross-page navigation
  console.log('\nS3: Cross-page (Google → search results)');
  const s3Tokens = [];
  for (let i = 0; i < ITERATIONS; i++) {
    wuNav('https://www.google.com');
    const firstRead = wuSnap();
    const t1 = countTokens(firstRead);
    wuNav('https://www.google.com/search?q=test');
    await sleep(1500);
    const secondRead = wuSnap();
    const t2 = countTokens(secondRead);
    const total = t1 + t2;
    s3Tokens.push(total);
    console.log(`  Run ${i + 1}: ${t1} + ${t2} = ${total} tokens`);
  }
  results.S3 = { tokens: s3Tokens, median: median(s3Tokens) };

  // S4: 5-step workflow
  console.log('\nS4: 5-step workflow (Google search)');
  const s4Tokens = [];
  for (let i = 0; i < ITERATIONS; i++) {
    wuNav('https://www.google.com');
    const step1 = countTokens(wuSnap());
    const step2 = countTokens(wuSnapIncremental()); // re-read
    wuNav('https://www.google.com/search?q=Wu+AI');
    await sleep(1500);
    const step3 = countTokens(wuSnap()); // new page
    const step4 = countTokens(wuSnapIncremental()); // re-read
    const total = step1 + step2 + step3 + step4;
    s4Tokens.push(total);
    console.log(`  Run ${i + 1}: ${step1}+${step2}+${step3}+${step4} = ${total} tokens`);
  }
  results.S4 = { tokens: s4Tokens, median: median(s4Tokens) };

  // S5: Form interaction (Google search box)
  console.log('\nS5: Form interaction (detect + fill)');
  const s5Tokens = [];
  for (let i = 0; i < ITERATIONS; i++) {
    wuNav('https://www.google.com');
    const detect = execSync(`npx tsx bin/wu-browser.ts site run form/detect`, {
      encoding: 'utf-8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'],
    });
    const snap = wuSnap();
    const total = countTokens(detect) + countTokens(snap);
    s5Tokens.push(total);
    console.log(`  Run ${i + 1}: ${total} tokens`);
  }
  results.S5 = { tokens: s5Tokens, median: median(s5Tokens) };

  return results;
}

// Run Playwright MCP scenarios
async function runPlaywrightScenarios() {
  const results = {};

  console.log('\n=== Playwright MCP Benchmark ===\n');

  // Check if Playwright can connect to CDP
  try {
    // Use Playwright's accessibility snapshot via Node API
    const testCode = `
      const { chromium } = require('playwright');
      (async () => {
        const browser = await chromium.connectOverCDP('http://localhost:9222');
        const contexts = browser.contexts();
        const page = contexts[0]?.pages()[0];
        if (!page) { console.log('NO_PAGE'); process.exit(1); }
        const snap = await page.accessibility.snapshot();
        console.log(JSON.stringify(snap).length);
        await browser.close();
      })();
    `;
    execSync(`node -e "${testCode.replace(/\n/g, ' ')}"`, {
      encoding: 'utf-8',
      timeout: 15000,
    });
  } catch (e) {
    console.log('Playwright cannot connect to Chrome CDP. Skipping.');
    console.log('Reason:', e.message?.substring(0, 100));
    return null;
  }

  // S1
  console.log('S1: Single page read');
  const s1Tokens = [];
  for (let i = 0; i < ITERATIONS; i++) {
    try {
      const output = execSync(`node -e "
        const { chromium } = require('playwright');
        (async () => {
          const b = await chromium.connectOverCDP('http://localhost:9222');
          const p = b.contexts()[0].pages()[0];
          await p.goto('https://www.google.com');
          await p.waitForTimeout(1500);
          const s = await p.accessibility.snapshot();
          const text = JSON.stringify(s, null, 2);
          console.log(text);
          await b.close();
        })();
      "`, { encoding: 'utf-8', timeout: 20000, stdio: ['pipe', 'pipe', 'pipe'] });
      const tokens = countTokens(output);
      s1Tokens.push(tokens);
      console.log(`  Run ${i + 1}: ${tokens} tokens`);
    } catch (e) {
      console.log(`  Run ${i + 1}: ERROR - ${e.message?.substring(0, 60)}`);
    }
  }
  if (s1Tokens.length > 0) {
    results.S1 = { tokens: s1Tokens, median: median(s1Tokens) };
  }

  return results;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Main
const wuResults = await runWuScenarios();
writeFileSync(`${RESULTS_DIR}/wu-browser.json`, JSON.stringify(wuResults, null, 2));
console.log('\n--- Wu Browser Summary ---');
for (const [key, val] of Object.entries(wuResults)) {
  console.log(`${key}: median ${val.median} tokens`);
}

let playwrightResults = null;
try {
  playwrightResults = await runPlaywrightScenarios();
  if (playwrightResults) {
    writeFileSync(`${RESULTS_DIR}/playwright.json`, JSON.stringify(playwrightResults, null, 2));
    console.log('\n--- Playwright Summary ---');
    for (const [key, val] of Object.entries(playwrightResults)) {
      console.log(`${key}: median ${val.median} tokens`);
    }
  }
} catch (e) {
  console.log('Playwright benchmark failed:', e.message?.substring(0, 100));
}

console.log('\nBenchmark complete. Results saved to benchmark/results/');
