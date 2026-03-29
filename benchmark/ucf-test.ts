import { connect } from '../src/browser/connection.js';
import { snapshot, loadSnapshotCache } from '../src/dom/snapshot.js';
import { detectModel } from '../src/model-sense/index.js';
import { navigate } from '../src/dom/actions.js';

async function run() {
  await connect({ port: 9222 });
  detectModel({});

  // Google homepage
  await navigate('https://www.google.com');
  await new Promise(r => setTimeout(r, 2000));

  loadSnapshotCache({});
  const rich = await snapshot({ mode: 'interactive', maxTokens: 5000, format: 'rich' });
  loadSnapshotCache({});
  const ucf = await snapshot({ mode: 'interactive', maxTokens: 5000, format: 'ucf' });

  console.log('=== Google Homepage ===');
  console.log(`Rich: ${rich.tokenCount} tokens, ${rich.elementCount} elements, ${(rich.tokenCount / rich.elementCount).toFixed(1)} t/el`);
  console.log(`UCF:  ${ucf.tokenCount} tokens, ${ucf.elementCount} elements, ${(ucf.tokenCount / ucf.elementCount).toFixed(1)} t/el`);
  console.log(`Savings: ${Math.round((1 - ucf.tokenCount / rich.tokenCount) * 100)}%`);
  console.log();
  console.log('UCF output:');
  console.log(ucf.tree);
  console.log();

  // Google search results
  await navigate('https://www.google.com/search?q=wu+browser+ai');
  await new Promise(r => setTimeout(r, 3000));

  loadSnapshotCache({});
  const rich2 = await snapshot({ mode: 'interactive', maxTokens: 5000, format: 'rich' });
  loadSnapshotCache({});
  const ucf2 = await snapshot({ mode: 'interactive', maxTokens: 5000, format: 'ucf' });

  console.log('=== Google Search Results ===');
  console.log(`Rich: ${rich2.tokenCount} tokens, ${rich2.elementCount} elements, ${(rich2.tokenCount / rich2.elementCount).toFixed(1)} t/el`);
  console.log(`UCF:  ${ucf2.tokenCount} tokens, ${ucf2.elementCount} elements, ${(ucf2.tokenCount / ucf2.elementCount).toFixed(1)} t/el`);
  console.log(`Savings: ${Math.round((1 - ucf2.tokenCount / rich2.tokenCount) * 100)}%`);
  console.log();
  console.log('UCF output preview (first 500 chars):');
  console.log(ucf2.tree.substring(0, 500));

  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
