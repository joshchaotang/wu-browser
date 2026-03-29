import { describe, it, expect } from 'vitest';
import { getAvailableMemoryMB, findChrome, getTrackedProcessCount } from '../src/browser/launcher.js';

describe('Connect-First launcher', () => {
  it('getAvailableMemoryMB returns a positive number on macOS/Linux', async () => {
    const mb = await getAvailableMemoryMB();
    expect(mb).toBeGreaterThan(0);
    expect(mb).toBeLessThan(999999);
  });

  it('findChrome locates Chrome binary', async () => {
    const path = await findChrome();
    // On dev machines Chrome should be installed
    if (process.platform === 'darwin') {
      expect(path).toContain('Chrome');
    }
    // On CI it might not exist, so we just check it returns string or null
    expect(path === null || typeof path === 'string').toBe(true);
  });

  it('trackedProcesses starts at 0', () => {
    expect(getTrackedProcessCount()).toBe(0);
  });
});

describe('Resource Budget', () => {
  it('returns memory in reasonable range for 24GB machine', async () => {
    const mb = await getAvailableMemoryMB();
    // Should be between 100MB and 24000MB on a real machine
    expect(mb).toBeGreaterThan(100);
    expect(mb).toBeLessThan(30000);
  });
});
