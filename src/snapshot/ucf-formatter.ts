/**
 * snapshot/ucf-formatter.ts — Ultra-Compact Format
 *
 * 目標：~5 tokens/element（業界最低）
 *
 * 格式：
 *   <url>|<count>
 *   e1:a Gmail|e2:a Images|e3:b Apps|e10:c Search|...
 *
 * Role codes（單字母）：
 *   a=link b=button c=input/combobox/textbox/searchbox
 *   h1/h2/h3=heading s=select k=checkbox r=radio
 *   m=menu i=image g=group n=navigation f=form l=list x=other
 */

import { type RawElement } from '../dom/pruner.js';
import { estimateTokens } from '../utils/token-counter.js';

/** Map full ARIA role to UCF code */
const ROLE_MAP: Record<string, string> = {
  link: 'a',
  button: 'b',
  combobox: 'c',
  textbox: 'c',
  searchbox: 'c',
  input: 'c',
  select: 's',
  checkbox: 'k',
  radio: 'r',
  menuitem: 'm',
  menu: 'm',
  img: 'i',
  image: 'i',
  heading: 'h',
  navigation: 'n',
  form: 'f',
  list: 'l',
  listitem: 'l',
  group: 'g',
  region: 'g',
  tab: 'b',        // tabs are clickable, treat as button
  option: 's',     // options are selectable
  slider: 'c',     // sliders are input-like
  spinbutton: 'c',
};

/** Get UCF role code from RawElement */
function getRoleCode(el: RawElement): string {
  const role = el.role.toLowerCase();

  // Heading with level: detect from tag (h1, h2, h3, etc.)
  if (role === 'heading' || /^h[1-6]$/.test(role)) {
    return role.startsWith('h') && role.length === 2 ? role : 'h';
  }

  return ROLE_MAP[role] ?? 'x';
}

/**
 * Get UCF state code from RawElement.
 * Returns empty string if no state applies.
 *
 * ✓ = checked/selected/expanded
 * - = unchecked/collapsed (only when attribute exists but is false)
 * ○ = disabled
 * ! = required
 */
function getStateCode(el: RawElement): string {
  let state = '';

  // checked / expanded → ✓ or -
  if (el.checked === 'true' || el.checked === 'mixed') {
    state += '✓';
  } else if (el.checked === 'false') {
    state += '-';
  }

  if (el.expanded === 'true') {
    state += '✓';
  } else if (el.expanded === 'false' && !state) {
    // Only add - for expanded if no checked state already present
    state += '-';
  }

  // disabled
  if (el.disabled) {
    state += '○';
  }

  // required
  if (el.required) {
    state += '!';
  }

  return state;
}

/** Extract short domain from URL (strip www., common TLDs for brevity) */
function extractDomain(href: string, baseUrl?: string): string | null {
  try {
    // Resolve relative URLs
    const resolved = baseUrl ? new URL(href, baseUrl) : new URL(href);
    return resolved.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** Get domain hint for a link element. Returns '' if same domain or not applicable. */
function getDomainHint(el: RawElement, pageDomain: string): string {
  if (!el.href) return '';
  const linkDomain = extractDomain(el.href);
  if (!linkDomain) return '';
  // Same exact domain (after www. strip) → no hint
  if (linkDomain === pageDomain) return '';
  // Shorten: remove common suffixes for brevity
  const short = linkDomain
    .replace(/\.com$/, '')
    .replace(/\.org$/, '')
    .replace(/\.net$/, '');
  return `→${short}`;
}

/** Max tokens per element name (token-aware truncation) */
const MAX_NAME_TOKENS = 8;

/**
 * Truncate name to stay within token budget.
 *
 * Strategy:
 * 1. Short English names (< 15 chars) → skip (always < 8 tokens)
 * 2. Estimate: Chinese chars × 2.5 + English words × 1.2
 * 3. If estimate > MAX_NAME_TOKENS → binary search with tokenizer
 * 4. Fallback to char limit if all else fails
 */
function truncName(name: string, _maxLen: number): string {
  if (!name) return '';
  const clean = name.replace(/\s+/g, ' ').trim();
  if (!clean) return '';

  // Fast path: short ASCII-only text is always under budget
  if (clean.length <= 12 && !/[\u4e00-\u9fff\u3400-\u4dbf]/.test(clean)) {
    return clean;
  }

  // Estimate token count without calling tokenizer
  const cjkCount = (clean.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) ?? []).length;
  const nonCjkLen = clean.length - cjkCount;
  const estimate = cjkCount * 2.5 + nonCjkLen * 0.3;

  if (estimate <= MAX_NAME_TOKENS) return clean;

  // Over budget — use tokenizer for precise truncation
  const actual = estimateTokens(clean);
  if (actual <= MAX_NAME_TOKENS) return clean;

  // Binary search for the right truncation point
  let lo = 1;
  let hi = clean.length;
  let best = Math.min(clean.length, 8); // fallback

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const sub = clean.substring(0, mid);
    const tokens = estimateTokens(sub);
    if (tokens <= MAX_NAME_TOKENS) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  if (best >= clean.length) return clean;

  // Don't break in the middle of a CJK character (shouldn't happen with substring)
  // but do try to break at a word boundary for English
  let cutPoint = best;
  if (!/[\u4e00-\u9fff\u3400-\u4dbf]/.test(clean[cutPoint - 1] ?? '')) {
    // Try to find a space to break at
    const lastSpace = clean.lastIndexOf(' ', cutPoint);
    if (lastSpace > cutPoint * 0.5) {
      cutPoint = lastSpace;
    }
  }

  return clean.substring(0, cutPoint) + '…';
}

export interface UCFOptions {
  /** Max name length (default: 20) */
  maxNameLen?: number;
  /** Include type hint for inputs (default: true) */
  includeType?: boolean;
  /** Separator between elements (default: '|') */
  separator?: string;
  /** Include domain hints for external links (default: true) */
  domainHints?: boolean;
}

/**
 * Format elements into UCF string.
 *
 * Output:
 *   <url>|<count>
 *   e1:a Gmail|e2:a Images|e3:b Apps
 */
export function formatUCF(
  elements: RawElement[],
  url: string,
  title: string,
  opts?: UCFOptions,
): { text: string; tokenCount: number; elementCount: number } {
  const maxNameLen = opts?.maxNameLen ?? 20;
  const sep = opts?.separator ?? '|';
  const includeType = opts?.includeType ?? true;
  const useDomainHints = opts?.domainHints ?? true;

  // Header: compact URL (strip protocol)
  const shortUrl = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const header = `${shortUrl}|${elements.length}`;

  // Page domain for domain hints
  const pageDomain = extractDomain(url) ?? '';

  // Elements
  const parts: string[] = [];
  for (const el of elements) {
    if (!el.name && !el.type && !el.placeholder) continue; // skip decoration

    const ref = el.ref.replace(/@e/, 'e').replace(/@/, '');
    const code = getRoleCode(el);
    const state = getStateCode(el);
    const name = truncName(el.name || el.placeholder || '', maxNameLen);

    let entry = `${ref}:${code}${state}`;

    // Add type hint for inputs
    if (includeType && code === 'c' && el.type && el.type !== 'text') {
      entry += `[${el.type}]`;
    }

    if (name) entry += ` ${name}`;

    // Domain hint for external links
    if (useDomainHints && code === 'a' && el.href) {
      const hint = getDomainHint(el, pageDomain);
      if (hint) entry += hint;
    }

    parts.push(entry);
  }

  const body = parts.join(sep);
  const text = `${header}\n${body}`;
  const tokenCount = estimateTokens(text);

  return { text, tokenCount, elementCount: parts.length };
}

/**
 * Format a single element in UCF style (for incremental diffs).
 */
export function formatUCFElement(el: RawElement, maxNameLen = 20): string {
  const ref = el.ref.replace(/@e/, 'e').replace(/@/, '');
  const code = getRoleCode(el);
  const state = getStateCode(el);
  const name = truncName(el.name || el.placeholder || '', maxNameLen);
  let entry = `${ref}:${code}${state}`;
  if (code === 'c' && el.type && el.type !== 'text') {
    entry += `[${el.type}]`;
  }
  if (name) entry += ` ${name}`;
  return entry;
}

/** Decode a UCF state code (for documentation/testing) */
export function decodeStateCode(code: string): string[] {
  const states: string[] = [];
  for (const ch of code) {
    if (ch === '✓') states.push('checked/expanded');
    else if (ch === '-') states.push('unchecked/collapsed');
    else if (ch === '○') states.push('disabled');
    else if (ch === '!') states.push('required');
  }
  return states;
}

/** Decode a UCF role code back to full role name (for documentation/testing) */
export function decodeRoleCode(code: string): string {
  const reverseMap: Record<string, string> = {
    a: 'link', b: 'button', c: 'input', s: 'select',
    k: 'checkbox', r: 'radio', m: 'menu', i: 'image',
    h: 'heading', h1: 'heading-1', h2: 'heading-2', h3: 'heading-3',
    n: 'navigation', f: 'form', l: 'list', g: 'group', x: 'other',
  };
  return reverseMap[code] ?? 'unknown';
}
