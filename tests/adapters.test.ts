/**
 * tests/adapters.test.ts — Adapter system unit tests
 *
 * Tests adapter registration, lookup, and command execution
 * without requiring a live Chrome instance.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  registerAdapter, listAdapters, findAdapter,
  executeAdapterCommand, loadBuiltinAdapters,
} from '../src/adapters/index.js';
import type { SiteAdapter } from '../src/adapters/types.js';

describe('Adapter registry', () => {
  it('should register and list adapters', () => {
    const before = listAdapters().length;
    const testAdapter: SiteAdapter = {
      name: 'test-adapter',
      domains: ['test.example.com'],
      commands: [{
        name: 'ping',
        description: 'Test ping',
        execute: async () => ({ pong: true }),
      }],
    };
    registerAdapter(testAdapter);
    const after = listAdapters();
    expect(after.length).toBe(before + 1);
    expect(after.find(a => a.name === 'test-adapter')).toBeTruthy();
  });

  it('should find adapter by domain', () => {
    const found = findAdapter('https://test.example.com/page');
    expect(found).toBeTruthy();
    expect(found!.name).toBe('test-adapter');
  });

  it('should not find adapter for unknown domain', () => {
    const found = findAdapter('https://unknown-site.org');
    expect(found).toBeNull();
  });

  it('should execute adapter command', async () => {
    const result = await executeAdapterCommand('test-adapter/ping', []);
    expect(result.success).toBe(true);
    expect(result.result).toEqual({ pong: true });
  });

  it('should return error for unknown adapter', async () => {
    const result = await executeAdapterCommand('nonexistent/cmd', []);
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('should return error for unknown command', async () => {
    const result = await executeAdapterCommand('test-adapter/nonexistent', []);
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });
});

describe('Built-in adapters', () => {
  beforeAll(async () => {
    await loadBuiltinAdapters();
  });

  it('should load google adapter', () => {
    const adapters = listAdapters();
    const google = adapters.find(a => a.name === 'google');
    expect(google).toBeTruthy();
    expect(google!.domains).toContain('google.com');
    expect(google!.commands.find(c => c.name === 'search')).toBeTruthy();
  });

  it('should load github adapter', () => {
    const adapters = listAdapters();
    const github = adapters.find(a => a.name === 'github');
    expect(github).toBeTruthy();
    expect(github!.domains).toContain('github.com');
    expect(github!.commands.find(c => c.name === 'repo')).toBeTruthy();
    expect(github!.commands.find(c => c.name === 'issues')).toBeTruthy();
  });

  it('should load form-filler adapter', () => {
    const adapters = listAdapters();
    const form = adapters.find(a => a.name === 'form');
    expect(form).toBeTruthy();
    expect(form!.domains).toContain('*');
    expect(form!.commands.find(c => c.name === 'detect')).toBeTruthy();
    expect(form!.commands.find(c => c.name === 'fill')).toBeTruthy();
  });

  it('should find form adapter for any URL (wildcard domain)', () => {
    const found = findAdapter('https://any-random-site.com/form');
    // form-filler uses '*' domain — should match anything
    expect(found).toBeTruthy();
    expect(found!.name).toBe('form');
  });

  it('should list at least 3 adapters', () => {
    const adapters = listAdapters();
    const builtinNames = ['google', 'github', 'form'];
    for (const name of builtinNames) {
      expect(adapters.find(a => a.name === name)).toBeTruthy();
    }
  });
});
