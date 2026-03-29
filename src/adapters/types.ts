/**
 * adapters/types.ts — Site adapter interface
 *
 * Adapters provide platform-specific commands for sites like
 * Google, GitHub, etc. Each adapter declares which domains
 * it handles and what commands it supports.
 */

import type { ActionResult } from '../dom/actions.js';
import type { SnapshotResult, SnapshotJsonResult } from '../dom/snapshot.js';

/** Browser API available to adapters */
export interface BrowserAPI {
  navigate(url: string): Promise<ActionResult>;
  click(ref: string): Promise<ActionResult>;
  type(ref: string, text: string, opts?: { clear?: boolean }): Promise<ActionResult>;
  snapshot(opts?: { mode?: 'interactive' | 'content' | 'full'; maxTokens?: number }): Promise<SnapshotResult>;
  snapshotJson(opts?: { mode?: 'interactive' | 'content' | 'full'; maxTokens?: number }): Promise<SnapshotJsonResult>;
  waitFor(selector: string, timeoutMs?: number): Promise<ActionResult>;
  getText(selector?: string): Promise<{ text: string; url: string; title: string }>;
  sleep(ms: number): Promise<void>;
}

export interface AdapterCommand {
  name: string;
  description: string;
  execute(args: string[], browser: BrowserAPI): Promise<unknown>;
}

export interface SiteAdapter {
  name: string;
  domains: string[];
  commands: AdapterCommand[];
}
