import { describe, it, expect } from 'vitest';
import { scoreElement, scoreAndSort, splitLayers } from '../src/snapshot/importance-scorer.js';
import { type RawElement } from '../src/dom/pruner.js';

describe('importance scoring', () => {
  it('buttons/inputs score higher than links', () => {
    const button: RawElement = { ref: '@e1', role: 'button', name: 'Submit', region: 'main' };
    const link: RawElement = { ref: '@e2', role: 'link', name: 'About', href: '/about', region: 'main' };
    expect(scoreElement(button)).toBeGreaterThan(scoreElement(link));
  });

  it('links with href score higher than links without', () => {
    const real: RawElement = { ref: '@e1', role: 'link', name: 'Home', href: '/home', region: 'main' };
    const fake: RawElement = { ref: '@e2', role: 'link', name: 'Toggle', region: 'main' };
    expect(scoreElement(real)).toBeGreaterThan(scoreElement(fake));
  });

  it('main region gets bonus, footer gets penalty', () => {
    const mainBtn: RawElement = { ref: '@e1', role: 'button', name: 'Go', region: 'main' };
    const footerBtn: RawElement = { ref: '@e2', role: 'button', name: 'Go', region: 'footer' };
    expect(scoreElement(mainBtn)).toBeGreaterThan(scoreElement(footerBtn));
  });

  it('decoration patterns get penalized', () => {
    const normal: RawElement = { ref: '@e1', role: 'link', name: 'About Us', href: '/about', region: 'footer' };
    const deco: RawElement = { ref: '@e2', role: 'link', name: '© 2026 Corp', href: '/legal', region: 'footer' };
    expect(scoreElement(normal)).toBeGreaterThan(scoreElement(deco));
  });

  it('disabled elements score lower', () => {
    const active: RawElement = { ref: '@e1', role: 'button', name: 'Submit', region: 'main' };
    const disabled: RawElement = { ref: '@e2', role: 'button', name: 'Submit', region: 'main', disabled: true };
    expect(scoreElement(active)).toBeGreaterThan(scoreElement(disabled));
  });

  it('search keyword boosts relevant elements', () => {
    const el: RawElement = { ref: '@e1', role: 'link', name: 'TypeScript tutorial', href: '/ts', region: 'main' };
    const noMatch: RawElement = { ref: '@e2', role: 'link', name: 'Python guide', href: '/py', region: 'main' };
    expect(scoreElement(el, 'typescript')).toBeGreaterThan(scoreElement(noMatch, 'typescript'));
  });

  it('scores are clamped to 0-100', () => {
    const el: RawElement = { ref: '@e1', role: 'link', name: '© cookie', region: 'footer', disabled: true };
    expect(scoreElement(el)).toBeGreaterThanOrEqual(0);
    expect(scoreElement(el)).toBeLessThanOrEqual(100);
  });
});

describe('scoreAndSort', () => {
  it('sorts elements by score descending', () => {
    const elements: RawElement[] = [
      { ref: '@e1', role: 'link', name: 'Footer link', href: '/f', region: 'footer' },
      { ref: '@e2', role: 'button', name: 'Main action', region: 'main' },
      { ref: '@e3', role: 'link', name: 'Nav link', href: '/n', region: 'nav' },
    ];
    const sorted = scoreAndSort(elements);
    expect(sorted[0].el.ref).toBe('@e2'); // button in main = highest
    expect(sorted[0].score).toBeGreaterThan(sorted[1].score);
  });
});

describe('splitLayers', () => {
  it('splits into 3 layers by score threshold', () => {
    const elements: RawElement[] = [
      { ref: '@e1', role: 'button', name: 'Go', region: 'main' },     // 40+20=60 → L1
      { ref: '@e2', role: 'link', name: 'More', href: '/m', region: 'main' },   // 30+20=50 → L1
      { ref: '@e3', role: 'heading', name: 'Title', region: 'main' }, // 20+20=40 → L2
      { ref: '@e4', role: 'link', name: 'Footer', href: '/f', region: 'footer' }, // 30-5=25 → L2
      { ref: '@e5', role: 'link', name: 'Toggle', region: 'footer' }, // 10-5=5 → L3
    ];
    const scored = scoreAndSort(elements);
    const { layer1, layer2, layer3 } = splitLayers(scored);

    expect(layer1.length).toBe(3); // button, link, heading all ≥35
    expect(layer2.length).toBe(1); // footer link with href (score 25)
    expect(layer3.length).toBe(1); // footer link no href (score 5)
    expect(layer1.some(e => e.ref === '@e1')).toBe(true);
    expect(layer3[0].ref).toBe('@e5');
  });

  it('Google homepage: search box and buttons in layer 1', () => {
    const googleEls: RawElement[] = [
      { ref: '@e1', role: 'link', name: 'Gmail', href: 'https://mail.google.com', region: 'header' },
      { ref: '@e6', role: 'combobox', name: 'Search', region: 'main' },
      { ref: '@e9', role: 'button', name: 'Google Search', region: 'main' },
      { ref: '@e10', role: 'button', name: "I'm Feeling Lucky", region: 'main' },
      { ref: '@e11', role: 'link', name: 'Advertising', href: 'https://ads.google.com', region: 'footer' },
      { ref: '@e15', role: 'button', name: 'Settings', region: 'footer' },
    ];
    const scored = scoreAndSort(googleEls);
    const { layer1 } = splitLayers(scored);

    // Search box and main buttons should be in layer 1
    const l1Refs = layer1.map(e => e.ref);
    expect(l1Refs).toContain('@e6');  // search box
    expect(l1Refs).toContain('@e9');  // Google Search button
    expect(l1Refs).toContain('@e10'); // I'm Feeling Lucky
  });
});
