/**
 * benchmark/wu-vs-all.ts — Wu Browser 多格式 benchmark
 *
 * 跑 rich + ucf 格式，加 GitHub repo 頁面。
 */

import { connect } from '../src/browser/connection.js';
import { snapshot, loadSnapshotCache } from '../src/dom/snapshot.js';
import { detectModel } from '../src/model-sense/index.js';
import { navigate } from '../src/dom/actions.js';
import { writeFileSync } from 'node:fs';

async function run() {
  await connect({ port: 9222 });
  detectModel({});

  const results: Record<string, Record<string, number>> = {};

  async function measure(label: string, url: string) {
    console.log(`${label}: ${url}`);
    results[label] = {};

    // Rich format
    loadSnapshotCache({});
    await navigate(url);
    await new Promise(r => setTimeout(r, 3000));
    const rich = await snapshot({ mode: 'interactive', maxTokens: 5000, format: 'rich' });
    results[label]['rich'] = rich.tokenCount;
    results[label]['rich_elements'] = rich.elementCount;
    console.log(`  rich: ${rich.tokenCount}t / ${rich.elementCount} elements`);

    // UCF format
    loadSnapshotCache({});
    const ucf = await snapshot({ mode: 'interactive', maxTokens: 5000, format: 'ucf' });
    results[label]['ucf'] = ucf.tokenCount;
    results[label]['ucf_elements'] = ucf.elementCount;
    console.log(`  ucf:  ${ucf.tokenCount}t / ${ucf.elementCount} elements`);

    // Same-page incremental (rich)
    const incr = await snapshot({ mode: 'interactive', maxTokens: 5000, format: 'rich' });
    results[label]['rich_incremental'] = incr.tokenCount;
    console.log(`  rich_incremental: ${incr.tokenCount}t`);
  }

  await measure('google_homepage', 'https://www.google.com');
  await measure('google_search', 'https://www.google.com/search?q=wu+browser+ai');
  await measure('github_repo', 'https://github.com/anthropics/claude-code');

  writeFileSync('benchmark/results/wu-browser-v1.5.json', JSON.stringify(results, null, 2));
  console.log('\nResults saved to benchmark/results/wu-browser-v1.5.json');

  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
