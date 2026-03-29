/**
 * snapshot/importance-scorer.ts — Element Importance Scoring
 *
 * 為每個元素計算重要性分數（0-100），用於：
 * 1. 裁剪時從低分開始砍（而非按 DOM 順序）
 * 2. Progressive snapshot 分層
 *
 * 計分規則基於 role + region，不用 ML。
 */

import { type RawElement } from '../dom/pruner.js';

/** Known decoration patterns in element names */
const DECORATION_PATTERNS = [
  /^©/,
  /^powered by/i,
  /^cookie/i,
  /^privacy/i,
  /^terms/i,
  /^copyright/i,
];

export interface ScoredElement {
  el: RawElement;
  score: number;
}

/**
 * Score a single element's importance (0-100).
 */
export function scoreElement(el: RawElement, searchKeyword?: string): number {
  let score = 0;
  const role = el.role.toLowerCase();
  const region = el.region ?? 'other';
  const name = (el.name ?? '').toLowerCase();

  // ─── Base role scores ───────────────────────────────────────
  // Interactive elements that users can act on
  if (['button', 'textbox', 'combobox', 'searchbox', 'input', 'select', 'checkbox', 'radio', 'slider', 'spinbutton'].includes(role)) {
    score += 40;
  }
  // Real navigation links (href exists and is not # or javascript:)
  else if (role === 'link' && el.href) {
    score += 30;
  }
  // Headings provide structure
  else if (role === 'heading' || /^h[1-6]$/.test(role)) {
    score += 20;
  }
  // Fake links (no real href)
  else if (role === 'link') {
    score += 10;
  }
  // Menu items
  else if (role === 'menuitem' || role === 'menu') {
    score += 15;
  }
  // Tab (clickable)
  else if (role === 'tab') {
    score += 25;
  }

  // ─── Region adjustments ─────────────────────────────────────
  if (region === 'main') score += 20;
  else if (region === 'header') score += 5;
  else if (region === 'nav') score += 3;
  else if (region === 'aside') score += 0;
  else if (region === 'footer') score -= 5;

  // ─── Content relevance adjustments ──────────────────────────
  // Search keyword boost
  if (searchKeyword && name.includes(searchKeyword.toLowerCase())) {
    score += 10;
  }

  // Decoration penalty
  if (DECORATION_PATTERNS.some(p => p.test(name))) {
    score -= 10;
  }

  // Disabled elements are less useful
  if (el.disabled) {
    score -= 15;
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * Score and sort elements by importance (descending).
 */
export function scoreAndSort(elements: RawElement[], searchKeyword?: string): ScoredElement[] {
  return elements
    .map(el => ({ el, score: scoreElement(el, searchKeyword) }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Get elements split into importance layers for progressive snapshot.
 *
 * Layer 1: score >= 35 (core interactive: buttons, inputs, links with href)
 * Layer 2: score >= 15 (secondary: headings, nav links, footer links)
 * Layer 3: all remaining (decoration, disabled, etc.)
 *
 * Thresholds tuned for real-world sites where many pages
 * don't use semantic landmarks like <main>.
 */
export function splitLayers(scored: ScoredElement[]): {
  layer1: RawElement[];
  layer2: RawElement[];
  layer3: RawElement[];
} {
  const layer1: RawElement[] = [];
  const layer2: RawElement[] = [];
  const layer3: RawElement[] = [];

  for (const { el, score } of scored) {
    if (score >= 35) layer1.push(el);
    else if (score >= 15) layer2.push(el);
    else layer3.push(el);
  }

  return { layer1, layer2, layer3 };
}
