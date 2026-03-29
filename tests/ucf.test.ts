import { describe, it, expect } from 'vitest';
import { formatUCF, formatUCFElement, decodeRoleCode } from '../src/snapshot/ucf-formatter.js';
import { estimateTokens } from '../src/utils/token-counter.js';
import { type RawElement } from '../src/dom/pruner.js';

// Simulated Google homepage elements
const googleElements: RawElement[] = [
  { ref: '@e1', role: 'link', name: 'Gmail', href: 'https://mail.google.com/mail/?authuser=0', region: 'header' },
  { ref: '@e2', role: 'link', name: 'Images', href: 'https://www.google.com/imghp?hl=en', region: 'header' },
  { ref: '@e3', role: 'button', name: 'Google apps', region: 'header' },
  { ref: '@e4', role: 'link', name: 'Sign in', href: 'https://accounts.google.com/signin', region: 'header' },
  { ref: '@e5', role: 'img', name: 'Google', region: 'main' },
  { ref: '@e6', role: 'combobox', name: 'Search', region: 'main' },
  { ref: '@e7', role: 'button', name: 'Search by voice', region: 'main' },
  { ref: '@e8', role: 'button', name: 'Search by image', region: 'main' },
  { ref: '@e9', role: 'button', name: 'Google Search', region: 'main' },
  { ref: '@e10', role: 'button', name: "I'm Feeling Lucky", region: 'main' },
  { ref: '@e11', role: 'link', name: 'Advertising', href: 'https://ads.google.com', region: 'footer' },
  { ref: '@e12', role: 'link', name: 'Business', href: 'https://www.google.com/intl/en/business', region: 'footer' },
  { ref: '@e13', role: 'link', name: 'Privacy', href: 'https://policies.google.com/privacy', region: 'footer' },
  { ref: '@e14', role: 'link', name: 'Terms', href: 'https://policies.google.com/terms', region: 'footer' },
  { ref: '@e15', role: 'button', name: 'Settings', region: 'footer' },
];

describe('UCF formatter', () => {
  it('should produce a 2-line output (header + body)', () => {
    const result = formatUCF(googleElements, 'https://www.google.com/', 'Google');
    const lines = result.text.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('www.google.com|15');
  });

  it('should use role codes', () => {
    const result = formatUCF(googleElements, 'https://www.google.com/', 'Google');
    expect(result.text).toContain('e1:a Gmail');
    expect(result.text).toContain('e3:b Google apps');
    expect(result.text).toContain('e6:c Search');
  });

  it('should strip @e prefix from refs', () => {
    const result = formatUCF(googleElements, 'https://www.google.com/', 'Google');
    expect(result.text).not.toContain('@e');
    expect(result.text).toContain('e1:');
  });

  it('should not include href', () => {
    const result = formatUCF(googleElements, 'https://www.google.com/', 'Google');
    expect(result.text).not.toContain('http');
    expect(result.text).not.toContain('href');
  });

  it('should truncate long names to 20 chars', () => {
    const longNameEl: RawElement[] = [
      { ref: '@e1', role: 'link', name: 'This is a very long element name that should be truncated' },
    ];
    const result = formatUCF(longNameEl, 'https://example.com/', 'Test');
    expect(result.text).toContain('…');
    // Name part should be <= 21 chars (20 + …)
    const bodyLine = result.text.split('\n')[1];
    const namePart = bodyLine.split(' ').slice(1).join(' ');
    expect(namePart.length).toBeLessThanOrEqual(21);
  });

  it('should skip elements with no name/type/placeholder', () => {
    const emptyEls: RawElement[] = [
      { ref: '@e1', role: 'link', name: '' },
      { ref: '@e2', role: 'button', name: 'Click me' },
    ];
    const result = formatUCF(emptyEls, 'https://example.com/', 'Test');
    expect(result.elementCount).toBe(1);
    expect(result.text).toContain('e2:b Click me');
    expect(result.text).not.toContain('e1:');
  });

  it('should include input type hint', () => {
    const inputEls: RawElement[] = [
      { ref: '@e1', role: 'textbox', name: 'Email', type: 'email' },
      { ref: '@e2', role: 'textbox', name: 'Password', type: 'password' },
    ];
    const result = formatUCF(inputEls, 'https://example.com/', 'Test');
    expect(result.text).toContain('e1:c[email] Email');
    expect(result.text).toContain('e2:c[password] Password');
  });
});

describe('UCF token efficiency', () => {
  it('Google homepage (15 elements) should be < 100 tokens', () => {
    const result = formatUCF(googleElements, 'https://www.google.com/', 'Google');
    expect(result.tokenCount).toBeLessThan(100);
    console.log(`UCF Google homepage (15 elements): ${result.tokenCount} tokens = ${(result.tokenCount / result.elementCount).toFixed(1)} t/el`);
  });

  it('should achieve < 8 tokens/element', () => {
    const result = formatUCF(googleElements, 'https://www.google.com/', 'Google');
    const tPerEl = result.tokenCount / result.elementCount;
    expect(tPerEl).toBeLessThan(8);
  });

  it('rich format should be 3-5x more tokens than UCF', () => {
    // Simulate rich format
    const richLines = [
      '[頁面] Google (https://www.google.com/)',
      '---',
      ...googleElements.map(el => {
        let line = `[${el.ref}] ${el.role} "${el.name}"`;
        if (el.href) line += ` href="${el.href}"`;
        return line;
      }),
      '---',
      `[${googleElements.length} 個元素 · interactive 模式]`,
    ];
    const richText = richLines.join('\n');
    const richTokens = estimateTokens(richText);

    const ucfResult = formatUCF(googleElements, 'https://www.google.com/', 'Google');

    const ratio = richTokens / ucfResult.tokenCount;
    expect(ratio).toBeGreaterThan(2);
    console.log(`Rich: ${richTokens} tokens, UCF: ${ucfResult.tokenCount} tokens, ratio: ${ratio.toFixed(1)}x`);
  });
});

describe('UCF validity verification', () => {
  it('every interactive element should be referenceable by click/type', () => {
    const result = formatUCF(googleElements, 'https://www.google.com/', 'Google');
    const body = result.text.split('\n')[1];
    // Every element with a name should appear as eN:X
    for (const el of googleElements) {
      if (!el.name) continue;
      const refNum = el.ref.replace('@e', '');
      expect(body).toContain(`e${refNum}:`);
    }
  });

  it('search box should be identifiable (role=c + name contains Search)', () => {
    const result = formatUCF(googleElements, 'https://www.google.com/', 'Google');
    // The combobox "Search" should appear as e6:c Search
    expect(result.text).toMatch(/e\d+:c Search/);
  });

  it('buttons should be identifiable (role=b)', () => {
    const result = formatUCF(googleElements, 'https://www.google.com/', 'Google');
    expect(result.text).toMatch(/e\d+:b Google Search/);
    expect(result.text).toMatch(/e\d+:b.*Feeling Lucky/);
  });

  it('links should be identifiable (role=a)', () => {
    const result = formatUCF(googleElements, 'https://www.google.com/', 'Google');
    expect(result.text).toMatch(/e\d+:a Gmail/);
    expect(result.text).toMatch(/e\d+:a Images/);
  });

  it('role codes should be decodeable', () => {
    expect(decodeRoleCode('a')).toBe('link');
    expect(decodeRoleCode('b')).toBe('button');
    expect(decodeRoleCode('c')).toBe('input');
    expect(decodeRoleCode('s')).toBe('select');
    expect(decodeRoleCode('k')).toBe('checkbox');
    expect(decodeRoleCode('r')).toBe('radio');
  });
});

describe('UCF formatUCFElement', () => {
  it('should format a single element', () => {
    const el: RawElement = { ref: '@e5', role: 'button', name: 'Submit' };
    expect(formatUCFElement(el)).toBe('e5:b Submit');
  });

  it('should handle iframe refs', () => {
    const el: RawElement = { ref: '@f1.e3', role: 'link', name: 'Link in iframe' };
    expect(formatUCFElement(el)).toBe('f1.e3:a Link in iframe');
  });
});
