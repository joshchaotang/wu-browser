import { describe, it, expect } from 'vitest';
import { progressiveSnapshot } from '../src/snapshot/progressive.js';
import { type RawElement } from '../src/dom/pruner.js';

const testElements: RawElement[] = [
  // Layer 1 candidates (score ≥ 50): buttons/inputs in main
  { ref: '@e1', role: 'combobox', name: 'Search', region: 'main' },
  { ref: '@e2', role: 'button', name: 'Google Search', region: 'main' },
  { ref: '@e3', role: 'button', name: "I'm Feeling Lucky", region: 'main' },
  // Layer 2 candidates (score 20-49): links with href in main/header, headings
  { ref: '@e4', role: 'link', name: 'Gmail', href: 'https://mail.google.com', region: 'header' },
  { ref: '@e5', role: 'link', name: 'Images', href: 'https://www.google.com/imghp', region: 'header' },
  { ref: '@e6', role: 'heading', name: 'Welcome', region: 'main' },
  { ref: '@e7', role: 'link', name: 'Sign in', href: 'https://accounts.google.com', region: 'header' },
  // Layer 3 candidates (score < 20): footer, decorative
  { ref: '@e8', role: 'link', name: 'Privacy', href: 'https://policies.google.com', region: 'footer' },
  { ref: '@e9', role: 'link', name: 'Terms', href: 'https://policies.google.com', region: 'footer' },
  { ref: '@e10', role: 'link', name: '© 2026 Google', region: 'footer' },
];

describe('progressive snapshot', () => {
  it('layer 1 should only include high-importance elements', () => {
    const result = progressiveSnapshot(testElements, 'https://www.google.com/', 'Google', 1);
    expect(result.layer).toBe(1);
    expect(result.elementCount).toBeLessThan(testElements.length);
    expect(result.hasMore).toBe(true);
    // Search box and main buttons should be included
    expect(result.text).toContain('Search');
    expect(result.text).toContain('Google Search');
    console.log(`Layer 1: ${result.elementCount} elements, ${result.tokenCount} tokens`);
  });

  it('layer 2 should include more elements than layer 1', () => {
    const l1 = progressiveSnapshot(testElements, 'https://www.google.com/', 'Google', 1);
    const l2 = progressiveSnapshot(testElements, 'https://www.google.com/', 'Google', 2);
    expect(l2.elementCount).toBeGreaterThan(l1.elementCount);
    expect(l2.tokenCount).toBeGreaterThan(l1.tokenCount);
    console.log(`Layer 2: ${l2.elementCount} elements, ${l2.tokenCount} tokens`);
  });

  it('layer 3 should include all elements', () => {
    const l3 = progressiveSnapshot(testElements, 'https://www.google.com/', 'Google', 3);
    expect(l3.elementCount).toBe(testElements.length);
    expect(l3.hasMore).toBe(false);
    console.log(`Layer 3: ${l3.elementCount} elements, ${l3.tokenCount} tokens`);
  });

  it('layer info footer should indicate remaining elements', () => {
    const l1 = progressiveSnapshot(testElements, 'https://www.google.com/', 'Google', 1);
    expect(l1.text).toContain('layer 1');
    expect(l1.text).toContain('more available');
  });

  it('layerCounts should be accurate', () => {
    const result = progressiveSnapshot(testElements, 'https://www.google.com/', 'Google', 1);
    expect(result.layerCounts.layer1 + result.layerCounts.layer2 + result.layerCounts.layer3)
      .toBe(testElements.length);
  });

  it('token savings: layer 1 should be significantly less than full', () => {
    const l1 = progressiveSnapshot(testElements, 'https://www.google.com/', 'Google', 1);
    const l3 = progressiveSnapshot(testElements, 'https://www.google.com/', 'Google', 3);
    const savings = 1 - (l1.tokenCount / l3.tokenCount);
    expect(savings).toBeGreaterThan(0.2); // At least 20% savings
    console.log(`Progressive savings: L1=${l1.tokenCount}t vs Full=${l3.tokenCount}t (${(savings * 100).toFixed(0)}% saved)`);
  });
});
