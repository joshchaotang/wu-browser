/**
 * dom/semantics.ts — Semantic element finder
 *
 * Find elements by semantic meaning (role + name), not CSS selectors.
 * Survives website updates as long as the element's purpose doesn't change.
 */

import type { RawElement } from './pruner.js';

export interface SemanticQuery {
  role?: string;
  name?: string;
  contains?: string;
  type?: string;
  near?: string;
}

export interface SemanticMatch {
  ref: string;
  role: string;
  name: string;
  href: string | null;
  type: string | null;
  score: number;
  region?: string;
}

/**
 * Find elements matching a semantic query.
 * Returns matches sorted by relevance score (highest first).
 */
export function findBySemantics(
  elements: RawElement[],
  query: SemanticQuery
): SemanticMatch[] {
  const matches: SemanticMatch[] = [];

  for (const el of elements) {
    let score = 0;

    // Role match
    if (query.role) {
      if (el.role === query.role) {
        score += 10;
      } else if (el.role.includes(query.role) || query.role.includes(el.role)) {
        score += 5;
      } else {
        continue; // Role is required — skip if no match
      }
    }

    // Name match
    if (query.name) {
      const queryName = query.name.toLowerCase();
      const elName = (el.name ?? '').toLowerCase();

      if (elName === queryName) {
        score += 20; // Exact
      } else if (elName.includes(queryName) || queryName.includes(elName)) {
        score += 10; // Partial
      } else {
        // Fuzzy: Levenshtein distance
        const dist = levenshtein(queryName, elName);
        if (dist <= 3 && elName.length > 0) {
          score += 5; // Fuzzy
        } else {
          if (query.name) continue; // Name required, no match
        }
      }
    }

    // Contains match (substring in name)
    if (query.contains) {
      const lower = query.contains.toLowerCase();
      if ((el.name ?? '').toLowerCase().includes(lower)) {
        score += 8;
      } else {
        continue;
      }
    }

    // Type match
    if (query.type) {
      if ((el.type ?? '') === query.type) {
        score += 5;
      }
    }

    if (score > 0) {
      matches.push({
        ref: el.ref,
        role: el.role,
        name: el.name ?? '',
        href: el.href ?? null,
        type: el.type ?? null,
        score,
        region: el.region,
      });
    }
  }

  // Sort by score descending
  matches.sort((a, b) => b.score - a.score);

  // If 'near' is specified, re-sort by proximity to the near element
  if (query.near && matches.length > 0) {
    const nearLower = query.near.toLowerCase();
    const nearIdx = elements.findIndex(
      el => (el.name ?? '').toLowerCase().includes(nearLower)
    );

    if (nearIdx >= 0) {
      // Re-sort by DOM distance (index proximity)
      matches.sort((a, b) => {
        const aIdx = elements.findIndex(el => el.ref === a.ref);
        const bIdx = elements.findIndex(el => el.ref === b.ref);
        return Math.abs(aIdx - nearIdx) - Math.abs(bIdx - nearIdx);
      });
    }
  }

  return matches;
}

/** Simple Levenshtein distance */
function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Limit to short strings for performance
  if (a.length > 50 || b.length > 50) return 999;

  const matrix: number[][] = [];
  for (let i = 0; i <= a.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= b.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }

  return matrix[a.length][b.length];
}
