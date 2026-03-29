/**
 * benchmark/v1.6-benchmark.ts — Wu Browser v1.6 complete benchmark
 *
 * S1: Single page read (Google homepage)
 * S2: Same-page re-read (incremental)
 * S3: Google search results
 * S4: GitHub repo page
 * S5: Form page (state codes test)
 * S6: Progressive vs Full comparison
 * S7: Chinese page smart truncation test
 */

import { connect } from '../src/browser/connection.js';
import { snapshot, loadSnapshotCache } from '../src/dom/snapshot.js';
import { detectModel } from '../src/model-sense/index.js';
import { navigate } from '../src/dom/actions.js';
import { progressiveSnapshot } from '../src/snapshot/progressive.js';
import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface BenchmarkResult {
  scenario: string;
  wu_ucf: number;
  wu_rich: number;
  wu_progressive_l1?: number;
  wu_progressive_l2?: number;
  wu_incremental?: number;
  elements: number;
  notes: string;
}

const results: BenchmarkResult[] = [];

async function measure(label: string, url: string, waitMs = 3000): Promise<{
  richTokens: number;
  ucfTokens: number;
  incrementalTokens: number;
  elements: number;
  rawElements: any[];
}> {
  console.log(`\n${label}: ${url}`);

  // Fresh snapshot (no cache)
  loadSnapshotCache({});
  await navigate(url);
  await new Promise(r => setTimeout(r, waitMs));

  // Rich format
  const rich = await snapshot({ mode: 'interactive', maxTokens: 5000, format: 'rich' });
  console.log(`  rich: ${rich.tokenCount}t / ${rich.elementCount} elements`);

  // UCF format (fresh — reset cache to get non-incremental)
  loadSnapshotCache({});
  const ucf = await snapshot({ mode: 'interactive', maxTokens: 5000, format: 'ucf' });
  console.log(`  ucf:  ${ucf.tokenCount}t / ${ucf.elementCount} elements`);

  // Save rawElements from UCF (before incremental overwrite)
  const rawEls = [...(ucf.rawElements ?? [])];

  // Incremental (same page re-read — uses the cache from ucf)
  const incr = await snapshot({ mode: 'interactive', maxTokens: 5000, format: 'rich' });
  console.log(`  incremental: ${incr.tokenCount}t`);

  return {
    richTokens: rich.tokenCount,
    ucfTokens: ucf.tokenCount,
    incrementalTokens: incr.tokenCount,
    elements: ucf.elementCount,
    rawElements: rawEls,
  };
}

async function run() {
  await connect({ port: 9222 });
  detectModel({});

  // S1: Google homepage
  const s1 = await measure('S1: Google homepage', 'https://www.google.com');
  const s1prog = progressiveSnapshot(s1.rawElements, 'https://www.google.com', 'Google', 1);
  const s1prog2 = progressiveSnapshot(s1.rawElements, 'https://www.google.com', 'Google', 2);
  results.push({
    scenario: 'S1: Google homepage',
    wu_ucf: s1.ucfTokens,
    wu_rich: s1.richTokens,
    wu_progressive_l1: s1prog.tokenCount,
    wu_progressive_l2: s1prog2.tokenCount,
    wu_incremental: s1.incrementalTokens,
    elements: s1.elements,
    notes: `UCF with state codes + domain hints + smart truncation + importance sorting`,
  });
  console.log(`  progressive L1: ${s1prog.tokenCount}t (${s1prog.elementCount} elements)`);
  console.log(`  progressive L2: ${s1prog2.tokenCount}t (${s1prog2.elementCount} elements)`);

  // S2: Same-page re-read
  results.push({
    scenario: 'S2: Same-page re-read',
    wu_ucf: s1.incrementalTokens,
    wu_rich: s1.incrementalTokens,
    elements: s1.elements,
    notes: 'Incremental mode (identical page)',
  });

  // S3: Google search results
  const s3 = await measure('S3: Google search results', 'https://www.google.com/search?q=wu+browser+ai');
  const s3prog = progressiveSnapshot(s3.rawElements, 'https://www.google.com/search?q=wu+browser+ai', 'Google Search', 1);
  results.push({
    scenario: 'S3: Google search',
    wu_ucf: s3.ucfTokens,
    wu_rich: s3.richTokens,
    wu_progressive_l1: s3prog.tokenCount,
    wu_incremental: s3.incrementalTokens,
    elements: s3.elements,
    notes: 'Search results with domain hints on result links',
  });
  console.log(`  progressive L1: ${s3prog.tokenCount}t (${s3prog.elementCount} elements)`);

  // S4: GitHub repo
  const s4 = await measure('S4: GitHub repo', 'https://github.com/anthropics/claude-code');
  const s4prog = progressiveSnapshot(s4.rawElements, 'https://github.com/anthropics/claude-code', 'GitHub', 1);
  results.push({
    scenario: 'S4: GitHub repo',
    wu_ucf: s4.ucfTokens,
    wu_rich: s4.richTokens,
    wu_progressive_l1: s4prog.tokenCount,
    wu_incremental: s4.incrementalTokens,
    elements: s4.elements,
    notes: 'Large page with many links',
  });
  console.log(`  progressive L1: ${s4prog.tokenCount}t (${s4prog.elementCount} elements)`);

  // S5: Form page (local)
  const formPath = join(__dirname, 'fixtures', 'form.html');
  const s5 = await measure('S5: Form page', `file://${formPath}`, 1000);
  results.push({
    scenario: 'S5: Form page (state codes)',
    wu_ucf: s5.ucfTokens,
    wu_rich: s5.richTokens,
    elements: s5.elements,
    notes: 'State codes: ✓ checked, - unchecked, ○ disabled, ! required',
  });

  // Load v1.5 results for comparison
  let v15Results: Record<string, Record<string, number>> = {};
  try {
    v15Results = JSON.parse(readFileSync(join(__dirname, 'results', 'wu-browser-v1.5.json'), 'utf-8'));
  } catch {
    console.log('Note: v1.5 results not found for comparison');
  }

  // Save raw results
  const outputPath = join(__dirname, 'results', 'wu-browser-v1.6.json');
  writeFileSync(outputPath, JSON.stringify(results, null, 2));
  console.log(`\nResults saved to ${outputPath}`);

  // Print comparison table
  console.log('\n═══ v1.6 vs v1.5 Comparison ═══');
  console.log('Scenario | v1.6 UCF | v1.5 UCF | Δ | v1.6 Progressive L1');
  console.log('---------|----------|----------|---|-------------------');
  for (const r of results) {
    const v15key = r.scenario.includes('homepage') ? 'google_homepage'
      : r.scenario.includes('search') ? 'google_search'
      : r.scenario.includes('GitHub') ? 'github_repo'
      : null;
    const v15ucf = v15key && v15Results[v15key] ? v15Results[v15key].ucf : '-';
    const delta = v15ucf !== '-' ? `${r.wu_ucf - (v15ucf as number)}` : '-';
    console.log(`${r.scenario} | ${r.wu_ucf}t | ${v15ucf}t | ${delta} | ${r.wu_progressive_l1 ?? '-'}t`);
  }

  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
