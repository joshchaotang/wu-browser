/**
 * snapshot/context-pruner.ts — Context-Aware Pruning
 *
 * 根據上一步動作，調整下一次 snapshot 的裁剪策略。
 * 例如：剛在搜尋框輸入 → 保留搜尋結果 link/heading，裁剪 nav/footer。
 */

import { type RawElement } from '../dom/pruner.js';

export interface PruningContext {
  lastAction: 'navigate' | 'type' | 'click' | 'select' | 'scroll' | 'none';
  lastTarget?: string;  // role:name of last interacted element
  lastUrl?: string;
}

// Module-level state
let currentContext: PruningContext = { lastAction: 'none' };

/** Update the pruning context after an action */
export function updatePruningContext(action: PruningContext['lastAction'], target?: string, url?: string): void {
  currentContext = { lastAction: action, lastTarget: target, lastUrl: url };
}

/** Get current context */
export function getPruningContext(): PruningContext {
  return currentContext;
}

/** Reset context */
export function resetPruningContext(): void {
  currentContext = { lastAction: 'none' };
}

/**
 * Apply context-aware pruning to elements.
 *
 * Returns elements reordered by relevance to the current context.
 * The pruner will then apply token budget from the top, naturally
 * keeping the most relevant elements.
 */
export function contextAwarePrune(elements: RawElement[], ctx: PruningContext): RawElement[] {
  if (ctx.lastAction === 'none' || ctx.lastAction === 'navigate') {
    // No context yet, or fresh navigation — keep original order
    return elements;
  }

  // Score each element based on context relevance
  const scored = elements.map(el => ({
    el,
    score: scoreElement(el, ctx),
  }));

  // Sort by score descending (most relevant first), preserve relative order for ties
  scored.sort((a, b) => b.score - a.score);

  return scored.map(s => s.el);
}

function scoreElement(el: RawElement, ctx: PruningContext): number {
  let score = 0;
  const role = el.role.toLowerCase();
  const region = el.region ?? 'other';
  const name = (el.name ?? '').toLowerCase();

  // Base region scores
  if (region === 'main') score += 10;
  if (region === 'header') score += 2;
  if (region === 'nav') score += 1;
  if (region === 'aside') score += 0;
  if (region === 'footer') score += 0;

  // Context-specific boosts
  if (ctx.lastAction === 'type') {
    // User just typed something (likely search) → boost results
    if (role === 'link') score += 8;        // search result links
    if (role === 'heading') score += 6;     // result titles
    if (role === 'button' && name.includes('next')) score += 5; // pagination
    if (role === 'button' && name.includes('page')) score += 5;
    // Demote non-result elements
    if (region === 'nav') score -= 3;
    if (region === 'footer') score -= 3;
    if (region === 'aside') score -= 2;
  }

  if (ctx.lastAction === 'click') {
    // User clicked something → boost main content
    if (region === 'main') score += 5;
    // Check if clicked a link (likely navigated to content page)
    if (ctx.lastTarget?.startsWith('link:')) {
      if (role === 'heading') score += 4;    // article headings
      // Demote navigation (user is reading content)
      if (region === 'nav') score -= 4;
      if (region === 'footer') score -= 4;
    }
    // Check if clicked a button (likely form submission)
    if (ctx.lastTarget?.startsWith('button:')) {
      if (role === 'button' || role === 'link') score += 3; // action results
      // Boost dialogs/alerts
      if (name.includes('ok') || name.includes('confirm') || name.includes('cancel')) score += 6;
    }
  }

  if (ctx.lastAction === 'select') {
    // User selected an option → boost related form elements
    if (role === 'button' || role === 'combobox' || role === 'textbox') score += 3;
  }

  if (ctx.lastAction === 'scroll') {
    // User scrolled → boost main content below fold
    if (region === 'main') score += 3;
    if (region === 'footer') score += 1; // might be scrolling to footer
  }

  return score;
}
