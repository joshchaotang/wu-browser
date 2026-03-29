/**
 * _template.ts — Adapter template
 *
 * Copy this file to create a new site adapter.
 * Rename to your-site.ts and implement the commands.
 *
 * Example: cp _template.ts twitter.ts
 */

import type { SiteAdapter } from '../types.js';

const adapter: SiteAdapter = {
  name: 'template',
  domains: ['example.com'],
  commands: [
    {
      name: 'search',
      description: 'Search on this platform',
      async execute(args, _page) {
        const query = args.join(' ');
        return { query, results: [] };
      },
    },
  ],
};

export default adapter;
