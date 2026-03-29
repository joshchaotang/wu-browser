# Contributing to Wu Browser

## Writing a Site Adapter

Adapters add platform-specific commands. To create one:

1. Copy the template:
   ```bash
   cp src/adapters/sites/_template.ts src/adapters/sites/your-site.ts
   ```

2. Implement the `SiteAdapter` interface:
   ```typescript
   import type { SiteAdapter } from '../types.js';

   const adapter: SiteAdapter = {
     name: 'your-site',
     domains: ['your-site.com', 'www.your-site.com'],
     commands: [
       {
         name: 'search',
         description: 'Search on your-site',
         async execute(args, page) {
           const query = args.join(' ');
           // Use CDP page to interact with the site
           return { query, results: [] };
         },
       },
     ],
   };

   export default adapter;
   ```

3. Register your adapter in `src/adapters/index.ts`:
   ```typescript
   import yourSite from './sites/your-site.js';
   registerAdapter(yourSite);
   ```

4. Build and test:
   ```bash
   npm run build
   wu-browser site list          # Should show your adapter
   wu-browser site run your-site/search "test"
   ```

## Development

```bash
git clone https://github.com/joshchaotang/wu-browser
cd wu-browser
npm install
npm run build
npm test
```

### Project Structure

```
src/
  adapters/     Platform-specific commands
  browser/      CDP connection, Chrome launcher, network capture
  dom/          Snapshot extraction, pruning, actions
  mcp/          MCP stdio server
  http/         HTTP API server
  permissions/  4-level permission engine
  utils/        Logger, token counter
bin/            CLI entry point
tests/          Test files
```

### Running Tests

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
```

### Code Style

- TypeScript strict mode
- ES modules (`import`/`export`)
- No external linter — keep it simple
