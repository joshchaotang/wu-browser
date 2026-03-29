import { describe, it, expect, beforeEach } from 'vitest';
import { getLegendIfNeeded, isLegendSent, resetLegend, getLegendText } from '../src/snapshot/session-legend.js';
import { estimateTokens } from '../src/utils/token-counter.js';

describe('session legend', () => {
  beforeEach(() => {
    resetLegend();
  });

  it('first call returns legend text', () => {
    const legend = getLegendIfNeeded();
    expect(legend).not.toBeNull();
    expect(legend).toContain('UCF legend');
    expect(legend).toContain('a=link');
    expect(legend).toContain('b=button');
  });

  it('second call returns null (legend already sent)', () => {
    getLegendIfNeeded();
    const second = getLegendIfNeeded();
    expect(second).toBeNull();
  });

  it('isLegendSent tracks state', () => {
    expect(isLegendSent()).toBe(false);
    getLegendIfNeeded();
    expect(isLegendSent()).toBe(true);
  });

  it('resetLegend clears state', () => {
    getLegendIfNeeded();
    resetLegend();
    expect(isLegendSent()).toBe(false);
    const legend = getLegendIfNeeded();
    expect(legend).not.toBeNull();
  });

  it('getLegendText always returns legend', () => {
    const text = getLegendText();
    expect(text).toContain('UCF legend');
    // Includes v1.6 features
    expect(text).toContain('✓=checked/expanded');
    expect(text).toContain('○=disabled');
    expect(text).toContain('→domain=external link target');
  });

  it('legend is about 50 tokens', () => {
    const tokens = estimateTokens(getLegendText());
    expect(tokens).toBeGreaterThan(20);
    expect(tokens).toBeLessThan(80);
    console.log(`Legend tokens: ${tokens}`);
  });
});
