import { describe, it, expect, beforeEach } from 'vitest';
import {
  BUILTIN_PROFILES, DEFAULT_PROFILE, getProfile, listProfiles,
  type ModelProfile,
} from '../src/model-sense/profiles.js';
import { detectModel, getCurrentProfile, getDetectionSource, setProfile } from '../src/model-sense/detector.js';
import { calibrate } from '../src/model-sense/calibrate.js';
import { formatElement } from '../src/dom/pruner.js';

describe('ModelSense profiles', () => {
  it('should have at least 9 builtin profiles', () => {
    expect(Object.keys(BUILTIN_PROFILES).length).toBeGreaterThanOrEqual(9);
  });

  it('should return default profile for unknown model', () => {
    const profile = getProfile('unknown-model-xyz');
    expect(profile.name).toBe(DEFAULT_PROFILE.name);
  });

  it('should find exact match', () => {
    const profile = getProfile('gpt-4o');
    expect(profile.name).toBe('gpt-4o');
    expect(profile.contextWindow).toBe(128000);
  });

  it('should find partial match', () => {
    const profile = getProfile('opus');
    expect(profile.name).toBe('claude-opus-4.6');
  });

  it('should list all profile names', () => {
    const names = listProfiles();
    expect(names).toContain('claude-opus-4.6');
    expect(names).toContain('gpt-4o');
    expect(names).toContain('local-8k');
  });

  it('local-8k should have aggressive pruning and low token budget', () => {
    const p = BUILTIN_PROFILES['local-8k'];
    expect(p.pruningStrategy).toBe('aggressive');
    expect(p.optimalMaxTokens).toBeLessThanOrEqual(400);
    expect(p.snapshotFormat.includeHref).toBe(false);
    expect(p.snapshotFormat.includeRegion).toBe(false);
    expect(p.snapshotFormat.refFormat).toBe('compact');
    expect(p.snapshotFormat.depthLimit).toBeLessThanOrEqual(2);
  });

  it('claude-opus-4.6 should have minimal pruning and high budget', () => {
    const p = BUILTIN_PROFILES['claude-opus-4.6'];
    expect(p.pruningStrategy).toBe('minimal');
    expect(p.optimalMaxTokens).toBeGreaterThanOrEqual(5000);
    expect(p.snapshotFormat.includeHref).toBe(true);
    expect(p.snapshotFormat.includeRegion).toBe(true);
  });
});

describe('ModelSense detector', () => {
  beforeEach(() => {
    // Reset to default
    setProfile(DEFAULT_PROFILE);
    delete process.env.WU_BROWSER_MODEL;
  });

  it('should detect from explicit flag', () => {
    const { profile, source } = detectModel({ flag: 'gpt-4o' });
    expect(profile.name).toBe('gpt-4o');
    expect(source).toContain('flag');
  });

  it('should detect from env variable', () => {
    process.env.WU_BROWSER_MODEL = 'local-8k';
    const { profile, source } = detectModel();
    expect(profile.name).toBe('local-8k');
    expect(source).toContain('env');
    delete process.env.WU_BROWSER_MODEL;
  });

  it('flag takes priority over env', () => {
    process.env.WU_BROWSER_MODEL = 'local-8k';
    const { profile } = detectModel({ flag: 'gpt-4o' });
    expect(profile.name).toBe('gpt-4o');
    delete process.env.WU_BROWSER_MODEL;
  });

  it('should fallback to default when nothing set', () => {
    const { profile, source } = detectModel();
    expect(profile.name).toBe(DEFAULT_PROFILE.name);
    expect(source).toContain('default');
  });

  it('getCurrentProfile returns the last detected profile', () => {
    detectModel({ flag: 'local-8k' });
    expect(getCurrentProfile().name).toBe('local-8k');
  });

  it('getDetectionSource returns the method used', () => {
    detectModel({ flag: 'gpt-4o-mini' });
    expect(getDetectionSource()).toBe('flag');
  });
});

describe('ModelSense formatElement integration', () => {
  const testElement = {
    ref: '@e1',
    role: 'link',
    name: 'Home',
    href: 'https://example.com/',
    region: 'nav' as const,
  };

  it('full format includes href', () => {
    const line = formatElement(testElement, {
      includeHref: true, includeRegion: true, refFormat: 'full', depthLimit: 0,
    });
    expect(line).toContain('[@e1]');
    expect(line).toContain('href="https://example.com/"');
  });

  it('compact format uses @1 and omits href', () => {
    const line = formatElement(testElement, {
      includeHref: false, includeRegion: false, refFormat: 'compact', depthLimit: 0,
    });
    expect(line).toContain('[@1]');
    expect(line).not.toContain('href=');
  });

  it('compact format saves tokens vs full format', () => {
    const full = formatElement(testElement, {
      includeHref: true, includeRegion: true, refFormat: 'full', depthLimit: 0,
    });
    const compact = formatElement(testElement, {
      includeHref: false, includeRegion: false, refFormat: 'compact', depthLimit: 0,
    });
    expect(compact.length).toBeLessThan(full.length);
  });
});

describe('ModelSense calibration', () => {
  const mockElements = Array.from({ length: 20 }, (_, i) => ({
    ref: `@e${i + 1}`,
    role: i % 3 === 0 ? 'button' : 'link',
    name: `Element ${i + 1}`,
    href: i % 3 !== 0 ? `https://example.com/page${i}` : undefined,
    type: undefined,
    region: i < 10 ? 'main' : 'nav',
  }));

  it('should produce 3 strategy results', () => {
    const result = calibrate(mockElements, 'claude-sonnet-4.6', (els, p) => {
      const kept = els.slice(0, Math.min(els.length, Math.floor(p.optimalMaxTokens / 20)));
      return { tokenCount: kept.length * 20, elementCount: kept.length };
    });

    expect(result.results).toHaveLength(3);
    expect(result.results.map(r => r.strategy)).toEqual(['minimal', 'balanced', 'aggressive']);
    expect(result.model).toBe('claude-sonnet-4.6');
    expect(result.recommended).toBeDefined();
  });

  it('aggressive should have fewer tokens than minimal', () => {
    const result = calibrate(mockElements, 'gpt-4o-mini', (els, p) => {
      const kept = els.slice(0, Math.min(els.length, Math.floor(p.optimalMaxTokens / 20)));
      return { tokenCount: kept.length * 20, elementCount: kept.length };
    });

    const minimal = result.results.find(r => r.strategy === 'minimal')!;
    const aggressive = result.results.find(r => r.strategy === 'aggressive')!;
    expect(aggressive.tokenCount).toBeLessThanOrEqual(minimal.tokenCount);
  });
});
