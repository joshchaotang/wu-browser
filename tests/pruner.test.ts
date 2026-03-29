import { describe, it, expect } from 'vitest';
import { pruneElements, formatElement, isJunkSelector, type RawElement } from '../src/dom/pruner.js';

describe('pruner', () => {
  describe('formatElement', () => {
    it('formats a basic button', () => {
      const el: RawElement = { ref: '@e1', role: 'button', name: '送出' };
      expect(formatElement(el)).toBe('[@e1] button "送出"');
    });

    it('includes href for links', () => {
      const el: RawElement = { ref: '@e2', role: 'link', name: '首頁', href: '/home' };
      expect(formatElement(el)).toBe('[@e2] link "首頁" href="/home"');
    });

    it('includes type and placeholder for inputs', () => {
      const el: RawElement = {
        ref: '@e3', role: 'textbox', name: '搜尋',
        type: 'email', placeholder: 'email@example.com'
      };
      expect(formatElement(el)).toBe('[@e3] textbox "搜尋" type=email placeholder="email@example.com"');
    });
  });

  describe('pruneElements', () => {
    it('returns all elements when within token budget', () => {
      const els: RawElement[] = [
        { ref: '@e1', role: 'button', name: 'OK', region: 'main' },
        { ref: '@e2', role: 'link', name: 'Home', region: 'header' },
      ];
      const result = pruneElements(els, 1000);
      expect(result.elements).toHaveLength(2);
      expect(result.truncated).toBe(false);
    });

    it('truncates when over token budget', () => {
      // 每個元素約 10 token，設定預算 15 → 應截斷第 2 個之後
      const els: RawElement[] = Array.from({ length: 50 }, (_, i) => ({
        ref: `@e${i + 1}`,
        role: 'button',
        name: `Button Number ${i + 1}`,
        region: 'main' as const,
      }));
      const result = pruneElements(els, 50);
      expect(result.truncated).toBe(true);
      expect(result.elements.length).toBeLessThan(50);
      expect(result.truncatedPercent).toBeGreaterThan(0);
    });

    it('prioritizes main region over footer', () => {
      // footer 元素 10 個，main 元素 1 個
      // budget 只夠幾個元素 → main 元素應優先進入
      const footerEls: RawElement[] = Array.from({ length: 10 }, (_, i) => ({
        ref: `@e${i + 1}`,
        role: 'link' as const,
        name: `Footer link ${i + 1}`,
        region: 'footer' as const,
      }));
      const mainEl: RawElement = { ref: '@e11', role: 'button', name: 'Main action', region: 'main' };
      const els = [...footerEls, mainEl];

      // budget=200 → 200-100=100 tokens for elements, enough for main + some footer
      const result = pruneElements(els, 200);
      expect(result.elements.map(e => e.ref)).toContain('@e11');
      // main should come first (before footer)
      const mainIdx = result.elements.findIndex(e => e.ref === '@e11');
      expect(mainIdx).toBe(0); // main region first
      // Should be truncated (10 footer won't all fit)
      expect(result.truncated).toBe(true);
    });

    it('returns empty array for empty input', () => {
      const result = pruneElements([], 1000);
      expect(result.elements).toHaveLength(0);
      expect(result.truncated).toBe(false);
    });
  });

  describe('isJunkSelector', () => {
    it('detects cookie consent classes', () => {
      expect(isJunkSelector('cookie-consent')).toBe(true);
      expect(isJunkSelector('CookieConsent')).toBe(true);
      expect(isJunkSelector('gdpr-banner')).toBe(true);
      expect(isJunkSelector('cc-banner')).toBe(true);
    });

    it('detects ad classes', () => {
      expect(isJunkSelector('adsbygoogle')).toBe(true);
      expect(isJunkSelector('ad-banner')).toBe(true);
    });

    it('passes legitimate selectors', () => {
      expect(isJunkSelector('main-content')).toBe(false);
      expect(isJunkSelector('hero-section')).toBe(false);
      expect(isJunkSelector('nav-menu')).toBe(false);
    });
  });
});
