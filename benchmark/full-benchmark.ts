/**
 * benchmark/full-benchmark.ts — 完整 Benchmark 腳本
 *
 * S1-S7 全場景測試，結果存 JSON。
 */

import { connect } from '../src/browser/connection.js';
import { snapshot, loadSnapshotCache, saveSnapshotCache } from '../src/dom/snapshot.js';
import { detectModel, getCurrentProfile } from '../src/model-sense/index.js';
import { estimateTokens } from '../src/utils/token-counter.js';
import { navigate, click } from '../src/dom/actions.js';

interface ScenarioResult {
  scenario: string;
  runs: number[];
  median: number;
  details?: Record<string, number>;
}

function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function run() {
  await connect({ port: 9222 });
  const results: ScenarioResult[] = [];

  // Reset to default profile for S1-S5
  detectModel({});

  // ─── S1: 單頁讀取 ─────────────────────
  console.log('S1: Single page read (Google homepage)...');
  const s1Runs: number[] = [];
  for (let i = 0; i < 3; i++) {
    loadSnapshotCache({});
    await navigate('https://www.google.com');
    await sleep(2000);
    const r = await snapshot({ mode: 'interactive', maxTokens: 2000 });
    s1Runs.push(r.tokenCount);
    console.log(`  Run ${i + 1}: ${r.tokenCount} tokens`);
  }
  results.push({ scenario: 'S1 Single Page', runs: s1Runs, median: median(s1Runs) });

  // ─── S2: 同頁再讀（增量）────────────────
  console.log('S2: Same-page re-read (incremental)...');
  const s2Runs: number[] = [];
  for (let i = 0; i < 3; i++) {
    loadSnapshotCache({});
    await navigate('https://www.google.com');
    await sleep(2000);
    // First read
    await snapshot({ mode: 'interactive', maxTokens: 2000 });
    // Second read (incremental)
    const r2 = await snapshot({ mode: 'interactive', maxTokens: 2000 });
    s2Runs.push(r2.tokenCount);
    console.log(`  Run ${i + 1}: ${r2.tokenCount} tokens`);
  }
  results.push({ scenario: 'S2 Same-Page Re-read', runs: s2Runs, median: median(s2Runs) });

  // ─── S3: 跨頁導航 ─────────────────────
  console.log('S3: Cross-page (Google → Search results)...');
  const s3Runs: number[] = [];
  for (let i = 0; i < 3; i++) {
    loadSnapshotCache({});
    await navigate('https://www.google.com');
    await sleep(2000);
    const r1 = await snapshot({ mode: 'interactive', maxTokens: 2000 });
    await navigate('https://www.google.com/search?q=wu+browser+ai');
    await sleep(3000);
    const r2 = await snapshot({ mode: 'interactive', maxTokens: 2000 });
    const total = r1.tokenCount + r2.tokenCount;
    s3Runs.push(total);
    console.log(`  Run ${i + 1}: ${r1.tokenCount} + ${r2.tokenCount} = ${total} tokens`);
  }
  results.push({ scenario: 'S3 Cross-Page', runs: s3Runs, median: median(s3Runs) });

  // ─── S4: 4 步工作流 ────────────────────
  console.log('S4: 4-step workflow...');
  const s4Runs: number[] = [];
  for (let i = 0; i < 3; i++) {
    loadSnapshotCache({});
    await navigate('https://www.google.com');
    await sleep(2000);
    const step1 = await snapshot({ mode: 'interactive', maxTokens: 2000 });
    const step2 = await snapshot({ mode: 'interactive', maxTokens: 2000 }); // re-read
    await navigate('https://www.google.com/search?q=wu+browser+ai');
    await sleep(3000);
    const step3 = await snapshot({ mode: 'interactive', maxTokens: 2000 });
    const step4 = await snapshot({ mode: 'interactive', maxTokens: 2000 }); // re-read search
    const total = step1.tokenCount + step2.tokenCount + step3.tokenCount + step4.tokenCount;
    s4Runs.push(total);
    console.log(`  Run ${i + 1}: ${step1.tokenCount}+${step2.tokenCount}+${step3.tokenCount}+${step4.tokenCount} = ${total}`);
  }
  results.push({ scenario: 'S4 4-Step Workflow', runs: s4Runs, median: median(s4Runs) });

  // ─── S6: Batch vs Sequential ────────────
  console.log('S6: Batch efficiency (timing only)...');
  // We measure round-trip time, not tokens
  await navigate('https://www.google.com');
  await sleep(2000);
  loadSnapshotCache({});

  const seqStart = Date.now();
  for (let j = 0; j < 3; j++) {
    await snapshot({ mode: 'interactive', maxTokens: 2000 });
  }
  const seqTime = Date.now() - seqStart;

  loadSnapshotCache({});
  const batchStart = Date.now();
  // Simulate batch: 3 snapshots in same process
  const batchResults = [];
  for (let j = 0; j < 3; j++) {
    batchResults.push(await snapshot({ mode: 'interactive', maxTokens: 2000 }));
  }
  const batchTime = Date.now() - batchStart;

  console.log(`  Sequential: ${seqTime}ms | Batch (in-process): ${batchTime}ms`);
  results.push({
    scenario: 'S6 Batch vs Sequential',
    runs: [seqTime, batchTime],
    median: batchTime,
    details: { sequentialMs: seqTime, batchMs: batchTime },
  });

  // ─── S7: ModelSense profile comparison ──
  console.log('S7: ModelSense profiles on Google homepage...');
  await navigate('https://www.google.com');
  await sleep(2000);

  const profileResults: Record<string, number> = {};
  for (const model of ['claude-opus-4.6', 'claude-sonnet-4.6', 'gpt-4o', 'gpt-4o-mini', 'local-8k']) {
    loadSnapshotCache({});
    detectModel({ flag: model });
    const profile = getCurrentProfile();
    const r = await snapshot({ mode: 'interactive', maxTokens: profile.optimalMaxTokens });
    profileResults[model] = r.tokenCount;
    console.log(`  ${model}: ${r.tokenCount} tokens`);
  }

  // Reset to default
  detectModel({});

  results.push({
    scenario: 'S7 ModelSense Profiles (Google)',
    runs: Object.values(profileResults),
    median: profileResults['claude-sonnet-4.6'],
    details: profileResults,
  });

  // ─── S7b: ModelSense on search results ──
  console.log('S7b: ModelSense profiles on search results...');
  await navigate('https://www.google.com/search?q=wu+browser+ai');
  await sleep(3000);

  const profileResults2: Record<string, number> = {};
  for (const model of ['claude-opus-4.6', 'claude-sonnet-4.6', 'gpt-4o', 'gpt-4o-mini', 'local-8k']) {
    loadSnapshotCache({});
    detectModel({ flag: model });
    const profile = getCurrentProfile();
    const r = await snapshot({ mode: 'interactive', maxTokens: profile.optimalMaxTokens });
    profileResults2[model] = r.tokenCount;
    console.log(`  ${model}: ${r.tokenCount} tokens`);
  }

  detectModel({});

  results.push({
    scenario: 'S7b ModelSense Profiles (Search)',
    runs: Object.values(profileResults2),
    median: profileResults2['claude-sonnet-4.6'],
    details: profileResults2,
  });

  // Save results
  const { writeFileSync } = await import('node:fs');
  writeFileSync('benchmark/results/full-benchmark.json', JSON.stringify(results, null, 2));
  console.log('\n=== Results saved to benchmark/results/full-benchmark.json ===');

  // Summary table
  console.log('\n=== SUMMARY ===\n');
  for (const r of results) {
    console.log(`${r.scenario.padEnd(35)} | median: ${r.median}`);
    if (r.details) {
      for (const [k, v] of Object.entries(r.details)) {
        console.log(`  ${k}: ${v}`);
      }
    }
  }

  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
