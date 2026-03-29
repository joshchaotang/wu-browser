/**
 * _template.ts — Adapter template
 *
 * Copy this file to create a new site adapter.
 * Rename to your-site.ts and implement the commands.
 *
 * Example: cp _template.ts twitter.ts
 */

import type { SiteAdapter, BrowserAPI } from '../types.js';

const adapter: SiteAdapter = {
  name: 'template',
  domains: ['example.com'],
  commands: [
    {
      name: 'search',
      description: 'Search on this platform',
      async execute(args, browser) {
        const query = args.join(' ');
        // Use browser API to interact with the page:
        // await browser.navigate('https://example.com');
        // const snap = await browser.snapshotJson();
        // await browser.type(snap.elements[0].ref, query);
        // await browser.click(snap.elements[1].ref);
        return { query, results: [] };
      },
    },
  ],
};

export default adapter;
