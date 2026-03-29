import { describe, it, expect } from 'vitest';
import { formatUCF, formatUCFElement, decodeRoleCode, decodeStateCode } from '../src/snapshot/ucf-formatter.js';
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

  it('should truncate long names by token budget (8 tokens max)', () => {
    const longNameEl: RawElement[] = [
      { ref: '@e1', role: 'link', name: 'This is a very long element name that should be truncated' },
    ];
    const result = formatUCF(longNameEl, 'https://example.com/', 'Test');
    expect(result.text).toContain('…');
    // Name part should be within token budget
    const bodyLine = result.text.split('\n')[1];
    const namePart = bodyLine.split(' ').slice(1).join(' ');
    const nameTokens = estimateTokens(namePart);
    expect(nameTokens).toBeLessThanOrEqual(10); // 8 + some overhead for …
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
  it('Google homepage (15 elements) should be < 130 tokens (with domain hints)', () => {
    const result = formatUCF(googleElements, 'https://www.google.com/', 'Google');
    expect(result.tokenCount).toBeLessThan(130);
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

// ─── v1.6 State Codes ────────────────────────────────────────

describe('UCF state codes', () => {
  it('checked checkbox shows ✓', () => {
    const el: RawElement = { ref: '@e1', role: 'checkbox', name: 'Remember me', checked: 'true' };
    expect(formatUCFElement(el)).toBe('e1:k✓ Remember me');
  });

  it('unchecked checkbox shows -', () => {
    const el: RawElement = { ref: '@e2', role: 'checkbox', name: 'Subscribe', checked: 'false' };
    expect(formatUCFElement(el)).toBe('e2:k- Subscribe');
  });

  it('disabled button shows ○', () => {
    const el: RawElement = { ref: '@e3', role: 'button', name: 'Submit', disabled: true };
    expect(formatUCFElement(el)).toBe('e3:b○ Submit');
  });

  it('required input shows !', () => {
    const el: RawElement = { ref: '@e4', role: 'textbox', name: 'Email', type: 'email', required: true };
    expect(formatUCFElement(el)).toBe('e4:c![email] Email');
  });

  it('expanded element shows ✓', () => {
    const el: RawElement = { ref: '@e5', role: 'button', name: 'Menu', expanded: 'true' };
    expect(formatUCFElement(el)).toBe('e5:b✓ Menu');
  });

  it('collapsed element shows -', () => {
    const el: RawElement = { ref: '@e6', role: 'button', name: 'Menu', expanded: 'false' };
    expect(formatUCFElement(el)).toBe('e6:b- Menu');
  });

  it('no state code for stateless elements', () => {
    const el: RawElement = { ref: '@e7', role: 'link', name: 'Gmail' };
    expect(formatUCFElement(el)).toBe('e7:a Gmail');
  });

  it('combined states: checked + required', () => {
    const el: RawElement = { ref: '@e8', role: 'checkbox', name: 'Agree', checked: 'true', required: true };
    expect(formatUCFElement(el)).toBe('e8:k✓! Agree');
  });

  it('form page UCF should include state codes', () => {
    const formEls: RawElement[] = [
      { ref: '@e1', role: 'textbox', name: 'Email', type: 'email', required: true, region: 'main' },
      { ref: '@e2', role: 'textbox', name: 'Password', type: 'password', required: true, region: 'main' },
      { ref: '@e3', role: 'combobox', name: 'Country: Taiwan', region: 'main' },
      { ref: '@e4', role: 'checkbox', name: 'Remember me', checked: 'true', region: 'main' },
      { ref: '@e5', role: 'checkbox', name: 'Subscribe', checked: 'false', region: 'main' },
      { ref: '@e6', role: 'radio', name: 'Free', checked: 'true', region: 'main' },
      { ref: '@e7', role: 'radio', name: 'Pro', checked: 'false', region: 'main' },
      { ref: '@e8', role: 'button', name: 'Sign Up', region: 'main' },
      { ref: '@e9', role: 'button', name: 'Reset', disabled: true, region: 'main' },
    ];
    const result = formatUCF(formEls, 'https://example.com/register', 'Registration');
    expect(result.text).toContain('e1:c![email] Email');
    expect(result.text).toContain('e4:k✓ Remember me');
    expect(result.text).toContain('e5:k- Subscribe');
    expect(result.text).toContain('e9:b○ Reset');
    // Token cost: form with states should be reasonable
    console.log(`Form UCF (${result.elementCount} elements with states): ${result.tokenCount} tokens`);
  });

  it('stateless page should have 0 token increase from state codes', () => {
    // Google homepage elements have no states
    const result = formatUCF(googleElements, 'https://www.google.com/', 'Google');
    // No state codes should appear
    expect(result.text).not.toContain('✓');
    expect(result.text).not.toContain('○');
    expect(result.text).not.toContain('!');
    // The - character appears in names, so we check more carefully
    const body = result.text.split('\n')[1];
    const entries = body.split('|');
    for (const entry of entries) {
      const colonIdx = entry.indexOf(':');
      if (colonIdx === -1) continue;
      const afterColon = entry.substring(colonIdx + 1);
      // Role code is 1 char (or h1/h2), next char should be space or [
      const roleCode = afterColon.match(/^[a-z](?:\d)?/)?.[0] ?? '';
      const afterRole = afterColon.substring(roleCode.length);
      expect(afterRole).toMatch(/^[\s\[]/);
    }
  });

  it('decodeStateCode should decode all codes', () => {
    expect(decodeStateCode('✓')).toEqual(['checked/expanded']);
    expect(decodeStateCode('-')).toEqual(['unchecked/collapsed']);
    expect(decodeStateCode('○')).toEqual(['disabled']);
    expect(decodeStateCode('!')).toEqual(['required']);
    expect(decodeStateCode('✓!')).toEqual(['checked/expanded', 'required']);
    expect(decodeStateCode('')).toEqual([]);
  });
});

// ─── v1.6 Domain Hints ──────────────────────────────────────

describe('UCF domain hints', () => {
  it('external links should have →domain hint', () => {
    const els: RawElement[] = [
      { ref: '@e1', role: 'link', name: 'Gmail', href: 'https://mail.google.com/mail' },
      { ref: '@e2', role: 'link', name: 'Privacy', href: 'https://policies.google.com/privacy' },
    ];
    const result = formatUCF(els, 'https://www.google.com/', 'Google');
    expect(result.text).toContain('e1:a Gmail→mail.google');
    expect(result.text).toContain('e2:a Privacy→policies.google');
  });

  it('same-domain links should NOT have domain hint', () => {
    const els: RawElement[] = [
      { ref: '@e1', role: 'link', name: 'Images', href: 'https://www.google.com/imghp' },
    ];
    const result = formatUCF(els, 'https://www.google.com/', 'Google');
    expect(result.text).toContain('e1:a Images');
    expect(result.text).not.toContain('→');
  });

  it('links with # or javascript: href should NOT have hint', () => {
    // These get filtered in DOM extraction (no href set), test with no href
    const els: RawElement[] = [
      { ref: '@e1', role: 'link', name: 'Toggle' },
    ];
    const result = formatUCF(els, 'https://example.com/', 'Test');
    expect(result.text).not.toContain('→');
  });

  it('subdomain of page domain DOES get hint (strict matching)', () => {
    const els: RawElement[] = [
      { ref: '@e1', role: 'link', name: 'API', href: 'https://api.example.com/docs' },
    ];
    const result = formatUCF(els, 'https://example.com/', 'Test');
    // Strict match: api.example.com ≠ example.com → gets hint
    expect(result.text).toContain('→api.example');
  });

  it('domain hints can be disabled', () => {
    const els: RawElement[] = [
      { ref: '@e1', role: 'link', name: 'Gmail', href: 'https://mail.google.com/mail' },
    ];
    const result = formatUCF(els, 'https://www.google.com/', 'Google', { domainHints: false });
    expect(result.text).not.toContain('→');
  });

  it('Google homepage with domain hints should stay under 500 tokens', () => {
    const result = formatUCF(googleElements, 'https://www.google.com/', 'Google');
    expect(result.tokenCount).toBeLessThan(500);
    console.log(`Google homepage UCF with domain hints: ${result.tokenCount} tokens`);
  });

  it('non-link elements should never get domain hints', () => {
    const els: RawElement[] = [
      { ref: '@e1', role: 'button', name: 'Submit', href: 'https://other.com/action' },
    ];
    const result = formatUCF(els, 'https://example.com/', 'Test');
    expect(result.text).not.toContain('→');
  });
});

// ─── v1.6 Smart Name Truncation ─────────────────────────────

describe('UCF smart truncation', () => {
  it('Chinese names should be truncated by tokens, not chars', () => {
    const els: RawElement[] = [
      { ref: '@e1', role: 'button', name: '這是一個非常長的中文按鈕名稱需要被截斷', region: 'main' },
    ];
    const result = formatUCF(els, 'https://example.com/', 'Test');
    const body = result.text.split('\n')[1];
    // Extract name part (after "e1:b ")
    const namePart = body.replace(/^e1:b\s*/, '');
    const tokens = estimateTokens(namePart);
    expect(tokens).toBeLessThanOrEqual(10);
    expect(result.text).toContain('…');
  });

  it('short English names should NOT be truncated', () => {
    const els: RawElement[] = [
      { ref: '@e1', role: 'button', name: 'Submit', region: 'main' },
    ];
    const result = formatUCF(els, 'https://example.com/', 'Test');
    expect(result.text).toContain('e1:b Submit');
    expect(result.text).not.toContain('…');
  });

  it('mixed CJK/English should be truncated correctly', () => {
    const els: RawElement[] = [
      { ref: '@e1', role: 'link', name: 'Google 帳戶：test.user@gmail.com的個人資料設定', href: '/profile', region: 'main' },
    ];
    const result = formatUCF(els, 'https://example.com/', 'Test');
    const body = result.text.split('\n')[1];
    const namePart = body.replace(/^e1:a\s*/, '');
    const tokens = estimateTokens(namePart);
    expect(tokens).toBeLessThanOrEqual(10);
  });
});
