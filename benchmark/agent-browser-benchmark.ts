/**
 * benchmark/agent-browser-benchmark.ts — agent-browser token measurement
 *
 * 用 agent-browser CLI 的 stdout，統一用 js-tiktoken 計 token。
 */

import { execSync } from 'node:child_process';
import { estimateTokens } from '../src/utils/token-counter.js';
import { writeFileSync } from 'node:fs';

function agentBrowserCmd(cmd: string, timeout = 15000): string {
  try {
    return execSync(`agent-browser ${cmd}`, { encoding: 'utf-8', timeout }).trim();
  } catch (e: any) {
    return e.stdout?.trim() ?? `ERROR: ${e.message}`;
  }
}

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

async function run() {
  // Connect to existing Chrome
  agentBrowserCmd('connect 9222');

  const results: Record<string, { output: string; tokens: number; lines: number }> = {};

  // S1: Google homepage
  console.log('S1: Google homepage...');
  agentBrowserCmd('open "https://www.google.com"');
  await new Promise(r => setTimeout(r, 2000));
  const s1Output = stripAnsi(agentBrowserCmd('snapshot'));
  const s1Tokens = estimateTokens(s1Output);
  results['S1_google_homepage'] = { output: s1Output, tokens: s1Tokens, lines: s1Output.split('\n').length };
  console.log(`  agent-browser: ${s1Tokens} tokens, ${s1Output.split('\n').length} lines`);

  // S2: Same page re-read
  console.log('S2: Same page re-read...');
  const s2Output = stripAnsi(agentBrowserCmd('snapshot'));
  const s2Tokens = estimateTokens(s2Output);
  results['S2_reread'] = { output: s2Output, tokens: s2Tokens, lines: s2Output.split('\n').length };
  console.log(`  agent-browser: ${s2Tokens} tokens (no incremental = same as S1)`);

  // S3: Search results
  console.log('S3: Search results...');
  agentBrowserCmd('open "https://www.google.com/search?q=wu+browser+ai"');
  await new Promise(r => setTimeout(r, 3000));
  const s3Output = stripAnsi(agentBrowserCmd('snapshot'));
  const s3Tokens = estimateTokens(s3Output);
  results['S3_search_results'] = { output: s3Output, tokens: s3Tokens, lines: s3Output.split('\n').length };
  console.log(`  agent-browser: ${s3Tokens} tokens, ${s3Output.split('\n').length} lines`);

  // S4: GitHub repo (large page)
  console.log('S4: GitHub repo...');
  agentBrowserCmd('open "https://github.com/anthropics/claude-code"');
  await new Promise(r => setTimeout(r, 3000));
  const s4Output = stripAnsi(agentBrowserCmd('snapshot'));
  const s4Tokens = estimateTokens(s4Output);
  results['S4_github_repo'] = { output: s4Output, tokens: s4Tokens, lines: s4Output.split('\n').length };
  console.log(`  agent-browser: ${s4Tokens} tokens, ${s4Output.split('\n').length} lines`);

  // Save results
  const summary: Record<string, number> = {};
  for (const [key, val] of Object.entries(results)) {
    summary[key] = val.tokens;
  }
  writeFileSync('benchmark/results/agent-browser.json', JSON.stringify(summary, null, 2));
  console.log('\nResults saved to benchmark/results/agent-browser.json');

  // Summary
  console.log('\n=== agent-browser Token Summary ===');
  for (const [key, val] of Object.entries(results)) {
    console.log(`  ${key}: ${val.tokens} tokens`);
  }

  // Close agent-browser
  try { agentBrowserCmd('close'); } catch {}
}

run().catch(err => { console.error(err); process.exit(1); });
