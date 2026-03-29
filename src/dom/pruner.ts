/**
 * dom/pruner.ts — 智能裁剪引擎
 *
 * 負責將 DOM 提取結果壓縮到 maxTokens 預算內。
 * 優先級：main/article > header nav > sidebar > footer
 */

import { estimateTokens } from '../utils/token-counter.js';
import { type SnapshotFormatConfig } from '../model-sense/profiles.js';

export interface RawElement {
  ref: string;
  role: string;
  name: string;
  href?: string;
  type?: string;
  placeholder?: string;
  value?: string;
  /** 元素在頁面中的區域 */
  region?: 'main' | 'header' | 'nav' | 'aside' | 'footer' | 'other';
  /** 是否來自 Shadow DOM */
  shadow?: boolean;
}

// 已知垃圾區域的 CSS class/id pattern
const JUNK_PATTERNS = [
  /cookie[-_]?(consent|banner|notice|bar|popup|modal)/i,
  /consent[-_]?(popup|banner|modal|overlay)/i,
  /gdpr[-_]?(banner|notice|modal)/i,
  /cc[-_]?banner/i,
  /CookieConsent/i,
  /cookie[-_]?law/i,
  /adsbygoogle/i,
  /ad[-_]?(banner|container|wrapper|slot)/i,
  /google[-_]?ads/i,
  /analytics/i,
  /tracking/i,
];

export function isJunkSelector(selector: string): boolean {
  return JUNK_PATTERNS.some(p => p.test(selector));
}

/**
 * 將元素按優先區域分組，超過 maxTokens 時依序裁剪低優先級區域。
 */
export function pruneElements(
  elements: RawElement[],
  maxTokens: number,
  fmt?: SnapshotFormatConfig
): { elements: RawElement[]; truncated: boolean; truncatedPercent: number; totalElements: number } {
  if (elements.length === 0) {
    return { elements: [], truncated: false, truncatedPercent: 0, totalElements: 0 };
  }

  // 按優先級分組
  const groups: Record<string, RawElement[]> = {
    main: [],
    header: [],
    nav: [],
    other: [],
    aside: [],
    footer: [],
  };

  for (const el of elements) {
    const region = el.region ?? 'other';
    const bucket = groups[region] ?? groups['other'];
    bucket.push(el);
  }

  // 優先級順序
  const priority = ['main', 'header', 'nav', 'other', 'aside', 'footer'];
  const result: RawElement[] = [];

  // 用 tiktoken 精確計算元素格式化後的 token 消耗
  function elTokens(el: RawElement): number {
    return estimateTokens(formatElement(el, fmt) + '\n');
  }

  // 預留 header + footer 的 token 預算
  // header: [頁面] title (url)\n---\n ≈ 40-60 tokens
  // footer: ---\n[統計行]\n ≈ 30-40 tokens
  let tokenBudget = maxTokens - 100;
  const totalInput = elements.length;

  for (const region of priority) {
    const bucket = groups[region] ?? [];
    for (const el of bucket) {
      const cost = elTokens(el);
      if (tokenBudget - cost < 0) {
        const used = result.length;
        const truncatedPercent =
          totalInput > 0 ? Math.round(((totalInput - used) / totalInput) * 100) : 0;
        return { elements: result, truncated: true, truncatedPercent, totalElements: totalInput };
      }
      tokenBudget -= cost;
      result.push(el);
    }
  }

  return { elements: result, truncated: false, truncatedPercent: 0, totalElements: totalInput };
}

/** 格式化單個元素為壓縮文字表示 */
export function formatElement(el: RawElement, fmt?: SnapshotFormatConfig): string {
  // ref format: compact "@1" vs full "@e1"
  const ref = fmt?.refFormat === 'compact' ? el.ref.replace(/@e/, '@') : el.ref;
  let line = `[${ref}] ${el.role} "${el.name}"`;
  if (el.shadow) line += ' [shadow]';
  if (el.href && (fmt?.includeHref ?? true)) line += ` href="${el.href}"`;
  if (el.type) line += ` type=${el.type}`;
  if (el.placeholder) line += ` placeholder="${el.placeholder}"`;
  if (el.value) line += ` value="${el.value}"`;
  return line;
}
