import { describe, it, expect, beforeEach } from 'vitest';
import { checkPermission, approveYellowAction } from '../src/permissions/engine.js';
import {
  classifyClick, classifyType, classifyAction,
  isDomainBlacklisted, extractDomain,
} from '../src/permissions/rules.js';

describe('permissions/rules', () => {
  describe('classifyAction', () => {
    it('marks navigation as green', () => {
      expect(classifyAction('navigate')).toBe('green');
      expect(classifyAction('scroll')).toBe('green');
      expect(classifyAction('snapshot')).toBe('green');
      expect(classifyAction('go_back')).toBe('green');
    });

    it('marks unknown actions as yellow', () => {
      expect(classifyAction('some_unknown_action')).toBe('yellow');
    });
  });

  describe('classifyClick', () => {
    it('marks link click as green', () => {
      expect(classifyClick('link', '首頁', 'https://example.com')).toBe('green');
      expect(classifyClick('menuitem', 'About', 'https://example.com')).toBe('green');
    });

    it('marks purchase button as red', () => {
      expect(classifyClick('button', 'Buy Now', 'https://shop.com')).toBe('red');
      expect(classifyClick('button', 'Purchase', 'https://shop.com')).toBe('red');
      expect(classifyClick('button', '購買', 'https://shop.com')).toBe('red');
      expect(classifyClick('button', 'Delete', 'https://app.com')).toBe('red');
      expect(classifyClick('button', '刪除', 'https://app.com')).toBe('red');
    });

    it('marks submit button as yellow', () => {
      expect(classifyClick('button', 'Submit', 'https://form.com')).toBe('yellow');
      expect(classifyClick('button', 'Post comment', 'https://blog.com')).toBe('yellow');
      expect(classifyClick('button', '發布', 'https://blog.com')).toBe('yellow');
    });

    it('blocks banking domains', () => {
      expect(classifyClick('button', 'Transfer', 'https://chase.com/transfer')).toBe('black');
      expect(classifyClick('link', 'Login', 'https://binance.com/login')).toBe('black');
    });
  });

  describe('classifyType', () => {
    it('marks search input as green', () => {
      expect(classifyType('search', 'Search', 'https://google.com')).toBe('green');
    });

    it('marks form fields as yellow', () => {
      expect(classifyType('text', 'Username', 'https://app.com')).toBe('yellow');
      expect(classifyType('email', 'Email', 'https://app.com')).toBe('yellow');
      expect(classifyType('password', 'Password', 'https://app.com')).toBe('yellow');
    });
  });

  describe('isDomainBlacklisted', () => {
    it('blocks banking domains', () => {
      expect(isDomainBlacklisted('https://chase.com/login')).toBe(true);
      expect(isDomainBlacklisted('https://www.wellsfargo.com')).toBe(true);
    });

    it('blocks crypto exchanges', () => {
      expect(isDomainBlacklisted('https://binance.com')).toBe(true);
      expect(isDomainBlacklisted('https://coinbase.com')).toBe(true);
    });

    it('allows normal sites', () => {
      expect(isDomainBlacklisted('https://google.com')).toBe(false);
      expect(isDomainBlacklisted('https://github.com')).toBe(false);
      expect(isDomainBlacklisted('https://twitter.com')).toBe(false);
    });
  });

  describe('extractDomain', () => {
    it('extracts hostname', () => {
      expect(extractDomain('https://github.com/user/repo')).toBe('github.com');
      expect(extractDomain('https://www.google.com')).toBe('www.google.com');
    });

    it('handles invalid URLs gracefully', () => {
      expect(extractDomain('not-a-url')).toBe('not-a-url');
    });
  });
});

describe('permissions/engine', () => {
  it('allows navigation (green)', () => {
    const result = checkPermission('navigate', 'https://google.com');
    expect(result.allowed).toBe(true);
    expect(result.level).toBe('green');
    expect(result.requiresConfirmation).toBe(false);
  });

  it('blocks banking domains (black)', () => {
    const result = checkPermission('click', 'https://chase.com', {
      role: 'button',
      name: 'Transfer funds',
    });
    expect(result.allowed).toBe(false);
    expect(result.level).toBe('black');
  });

  it('requires confirmation for red actions', () => {
    const result = checkPermission('click', 'https://amazon.com', {
      role: 'button',
      name: 'Buy Now',
    });
    expect(result.allowed).toBe(false);
    expect(result.level).toBe('red');
    expect(result.requiresConfirmation).toBe(true);
    expect(result.confirmationMessage).toBeTruthy();
  });

  it('requires first-time confirmation for yellow actions', () => {
    const result = checkPermission('click', 'https://blog.example.com', {
      role: 'button',
      name: 'Post unique comment xyz12345',
    });
    expect(result.level).toBe('yellow');
    expect(result.requiresConfirmation).toBe(true);
  });
});
