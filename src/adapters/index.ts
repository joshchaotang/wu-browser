/**
 * adapters/index.ts — Adapter loader
 *
 * Discovers and loads site adapters from the sites/ directory.
 * Adapters are matched by domain to provide platform-specific commands.
 */

import type { SiteAdapter } from './types.js';

// Registry of loaded adapters
const adapters: SiteAdapter[] = [];

/** Register a site adapter */
export function registerAdapter(adapter: SiteAdapter): void {
  adapters.push(adapter);
}

/** List all registered adapters */
export function listAdapters(): SiteAdapter[] {
  return [...adapters];
}

/** Find adapter matching a URL */
export function findAdapter(url: string): SiteAdapter | null {
  try {
    const hostname = new URL(url).hostname;
    return adapters.find(a =>
      a.domains.some(d => hostname === d || hostname.endsWith('.' + d))
    ) ?? null;
  } catch {
    return null;
  }
}

/** Execute an adapter command: "twitter/search" → adapter=twitter, command=search */
export async function executeAdapterCommand(
  path: string,
  args: string[],
  page: unknown
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  const [adapterName, commandName] = path.split('/');
  const adapter = adapters.find(a => a.name === adapterName);
  if (!adapter) {
    return { success: false, error: `Adapter "${adapterName}" not found. Use "wu-browser site list" to see available adapters.` };
  }
  const command = adapter.commands.find(c => c.name === commandName);
  if (!command) {
    return { success: false, error: `Command "${commandName}" not found in adapter "${adapterName}". Available: ${adapter.commands.map(c => c.name).join(', ')}` };
  }
  try {
    const result = await command.execute(args, page);
    return { success: true, result };
  } catch (err) {
    return { success: false, error: `Command failed: ${err}` };
  }
}

export type { SiteAdapter, AdapterCommand } from './types.js';
