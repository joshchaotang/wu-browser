/**
 * benchmark/agent-browser-v1.6.ts — agent-browser comparison for v1.6
 */
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Use js-tiktoken for fair token counting
import { encodingForModel } from 'js-tiktoken';
const enc = encodingForModel('gpt-4o');

function countTokens(text: string): number {
  return enc.encode(text).length;
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

const __dirname = dirname(fileURLToPath(import.meta.url));

interface ABResult {
  scenario: string;
  tokens: number;
}

const results: ABResult[] = [];

function measureAB(label: string, url: string): void {
  console.log(`${label}: ${url}`);
  try {
    // Navigate then snapshot using CDP port 9222
    execSync(`agent-browser --cdp 9222 open "${url}"`, {
      encoding: 'utf-8',
      timeout: 15000,
    });
    // Wait a bit for page to load
    execSync('sleep 3');
    const raw = execSync(`agent-browser --cdp 9222 snapshot -i`, {
      encoding: 'utf-8',
      timeout: 15000,
    });
    const clean = stripAnsi(raw);
    const tokens = countTokens(clean);
    results.push({ scenario: label, tokens });
    console.log(`  agent-browser: ${tokens}t`);
  } catch (e: any) {
    console.log(`  agent-browser: FAILED (${e.message?.substring(0, 80)})`);
    results.push({ scenario: label, tokens: -1 });
  }
}

measureAB('S1: Google homepage', 'https://www.google.com');
measureAB('S3: Google search', 'https://www.google.com/search?q=wu+browser+ai');
measureAB('S4: GitHub repo', 'https://github.com/anthropics/claude-code');

const outputPath = join(__dirname, 'results', 'agent-browser-v1.6.json');
writeFileSync(outputPath, JSON.stringify(results, null, 2));
console.log(`\nResults saved to ${outputPath}`);
