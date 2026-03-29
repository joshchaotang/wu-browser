/**
 * benchmark/measure.js — Token counting and timing utilities
 *
 * Uses js-tiktoken cl100k_base for consistent token counting across all tools.
 */

import { getEncoding } from 'js-tiktoken';

let encoder;
try {
  encoder = getEncoding('cl100k_base');
} catch {
  encoder = null;
}

export function countTokens(text) {
  if (!text) return 0;
  if (encoder) {
    return encoder.encode(text).length;
  }
  // Fallback
  return Math.ceil(text.length / 4);
}

export function measureTime(fn) {
  const start = performance.now();
  return fn().then(result => ({
    result,
    durationMs: Math.round(performance.now() - start),
  }));
}

export function median(arr) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
