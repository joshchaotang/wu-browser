/**
 * adapters/types.ts — Site adapter interface
 *
 * Adapters provide platform-specific commands for sites like
 * Twitter, YouTube, etc. Each adapter declares which domains
 * it handles and what commands it supports.
 */

export interface AdapterCommand {
  name: string;
  description: string;
  execute(args: string[], page: unknown): Promise<unknown>;
}

export interface SiteAdapter {
  name: string;
  domains: string[];
  commands: AdapterCommand[];
}
