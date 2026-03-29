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

/** Truncate name to maxLen, add … if truncated */
function truncName(name: string, maxLen: number): string {
  if (!name) return '';
  // Clean whitespace
  const clean = name.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLen) return clean;
  return clean.substring(0, maxLen) + '…';
}

export interface UCFOptions {
  /** Max name length (default: 20) */
  maxNameLen?: number;
  /** Include type hint for inputs (default: true) */
  includeType?: boolean;
  /** Separator between elements (default: '|') */
  separator?: string;
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

  // Header: compact URL (strip protocol)
  const shortUrl = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const header = `${shortUrl}|${elements.length}`;

  // Elements
  const parts: string[] = [];
  for (const el of elements) {
    if (!el.name && !el.type && !el.placeholder) continue; // skip decoration

    const ref = el.ref.replace(/@e/, 'e').replace(/@/, '');
    const code = getRoleCode(el);
    const name = truncName(el.name || el.placeholder || '', maxNameLen);

    let entry = `${ref}:${code}`;

    // Add type hint for inputs
    if (includeType && code === 'c' && el.type && el.type !== 'text') {
      entry += `[${el.type}]`;
    }

    if (name) entry += ` ${name}`;

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
  const name = truncName(el.name || el.placeholder || '', maxNameLen);
  let entry = `${ref}:${code}`;
  if (code === 'c' && el.type && el.type !== 'text') {
    entry += `[${el.type}]`;
  }
  if (name) entry += ` ${name}`;
  return entry;
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
