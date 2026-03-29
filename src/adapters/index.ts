/**
 * adapters/index.ts — Adapter loader
 *
 * Discovers and loads site adapters from the sites/ directory.
 * Adapters are matched by domain to provide platform-specific commands.
 */

import type { SiteAdapter, BrowserAPI } from './types.js';
import { navigate, click, typeText, waitFor } from '../dom/actions.js';
import { snapshot, snapshotToJson, getText } from '../dom/snapshot.js';

// Registry of loaded adapters
const adapters: SiteAdapter[] = [];

/** Browser API implementation for adapters */
export function createBrowserAPI(): BrowserAPI {
  return {
    navigate: (url) => navigate(url),
    click: (ref) => click(ref),
    type: (ref, text, opts) => typeText(ref, text, opts),
    snapshot: (opts) => snapshot({
      mode: opts?.mode ?? 'interactive',
      maxTokens: opts?.maxTokens ?? 1500,
    }),
    snapshotJson: async (opts) => {
      const mode = opts?.mode ?? 'interactive';
      const result = await snapshot({
        mode,
        maxTokens: opts?.maxTokens ?? 1500,
      });
      return snapshotToJson(result, mode);
    },
    waitFor: (selector, timeoutMs) => waitFor(selector, timeoutMs),
    getText: (selector) => getText(selector),
    sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
  };
}

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
      a.domains.some(d => d === '*' || hostname === d || hostname.endsWith('.' + d))
    ) ?? null;
  } catch {
    return null;
  }
}

/** Execute an adapter command: "google/search" → adapter=google, command=search */
export async function executeAdapterCommand(
  path: string,
  args: string[],
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
    const browser = createBrowserAPI();
    const result = await command.execute(args, browser);
    return { success: true, result };
  } catch (err) {
    return { success: false, error: `Command failed: ${err}` };
  }
}

/** Load all built-in adapters from sites/ directory */
export async function loadBuiltinAdapters(): Promise<void> {
  // Static imports for built-in adapters (dynamic import of directory not reliable in all envs)
  try {
    const { default: google } = await import('./sites/google.js');
    registerAdapter(google);
  } catch { /* adapter not available */ }

  try {
    const { default: github } = await import('./sites/github.js');
    registerAdapter(github);
  } catch { /* adapter not available */ }

  try {
    const { default: formFiller } = await import('./sites/form-filler.js');
    registerAdapter(formFiller);
  } catch { /* adapter not available */ }
}

export type { SiteAdapter, AdapterCommand, BrowserAPI } from './types.js';
