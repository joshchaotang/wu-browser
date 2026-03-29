/** Token counting using cl100k_base (closest to Claude's tokenizer) */

import { getEncoding as tiktokenGetEncoding } from 'js-tiktoken';

let _enc: ReturnType<typeof tiktokenGetEncoding> | null = null;

function getEncoding() {
  if (!_enc) {
    _enc = tiktokenGetEncoding('cl100k_base');
  }
  return _enc;
}

/** Count tokens using cl100k_base tokenizer */
export function estimateTokens(text: string): number {
  try {
    return getEncoding().encode(text).length;
  } catch {
    // Fallback to char/4 if tiktoken fails
    return Math.ceil(text.length / 4);
  }
}

/**
 * Truncate text to fit within maxTokens, preserving space for suffix.
 */
export function truncateToTokens(
  text: string,
  maxTokens: number,
  suffix = ''
): { text: string; truncated: boolean; truncatedPercent: number } {
  const suffixTokens = suffix ? estimateTokens(suffix) : 0;
  const budget = maxTokens - suffixTokens;

  if (estimateTokens(text) <= budget) {
    return { text, truncated: false, truncatedPercent: 0 };
  }

  // Binary search for cutoff point
  let lo = 0;
  let hi = text.length;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (estimateTokens(text.substring(0, mid)) <= budget) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  const pct = Math.round(((text.length - lo) / text.length) * 100);
  return { text: text.substring(0, lo) + suffix, truncated: true, truncatedPercent: pct };
}
