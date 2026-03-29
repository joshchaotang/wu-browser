/**
 * benchmark/modelsense-test.ts — ModelSense 實測腳本
 *
 * 同一頁面用不同 model profile 跑 snapshot，比較 token 數。
 */

import { connect } from '../src/browser/connection.js';
import { snapshot, loadSnapshotCache, saveSnapshotCache } from '../src/dom/snapshot.js';
import { detectModel, getCurrentProfile, listProfiles, BUILTIN_PROFILES } from '../src/model-sense/index.js';
import { estimateTokens } from '../src/utils/token-counter.js';
import { navigate } from '../src/dom/actions.js';

async function run() {
  await connect({ port: 9222 });

  // Navigate to Google first
  await navigate('https://www.google.com');
  await new Promise(r => setTimeout(r, 2000));

  const profilesToTest = ['claude-opus-4.6', 'claude-sonnet-4.6', 'gpt-4o', 'gpt-4o-mini', 'local-8k'];
  const results: Array<{ model: string; tokens: number; elements: number; maxTokens: number }> = [];

  console.log('=== ModelSense Benchmark: Google Homepage ===\n');

  for (const modelName of profilesToTest) {
    // Clear snapshot cache so no incremental
    loadSnapshotCache({});

    // Set profile
    detectModel({ flag: modelName });
    const profile = getCurrentProfile();

    const result = await snapshot({
      mode: 'interactive',
      maxTokens: profile.optimalMaxTokens,
    });

    results.push({
      model: modelName,
      tokens: result.tokenCount,
      elements: result.elementCount,
      maxTokens: profile.optimalMaxTokens,
    });

    console.log(`${modelName.padEnd(20)} | ${String(result.tokenCount).padStart(5)} tokens | ${String(result.elementCount).padStart(3)} elements | budget: ${profile.optimalMaxTokens}`);
  }

  // Also test no-model (default)
  loadSnapshotCache({});
  detectModel({});
  const defaultResult = await snapshot({ mode: 'interactive' });
  console.log(`${'(default)'.padEnd(20)} | ${String(defaultResult.tokenCount).padStart(5)} tokens | ${String(defaultResult.elementCount).padStart(3)} elements | budget: 1500`);

  // Now test Google search results page
  console.log('\n=== ModelSense Benchmark: Google Search Results ===\n');

  await navigate('https://www.google.com/search?q=wu+browser+ai');
  await new Promise(r => setTimeout(r, 3000));

  for (const modelName of profilesToTest) {
    loadSnapshotCache({});
    detectModel({ flag: modelName });
    const profile = getCurrentProfile();

    const result = await snapshot({
      mode: 'interactive',
      maxTokens: profile.optimalMaxTokens,
    });

    console.log(`${modelName.padEnd(20)} | ${String(result.tokenCount).padStart(5)} tokens | ${String(result.elementCount).padStart(3)} elements | budget: ${profile.optimalMaxTokens}`);
  }

  // Output JSON for report
  console.log('\n=== JSON Results ===');
  console.log(JSON.stringify(results, null, 2));

  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
