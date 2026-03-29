/**
 * snapshot/progressive.ts — Progressive (Layered) Snapshot
 *
 * 按重要性分層披露元素：
 * Layer 1: 核心互動 (importance ≥ 50) — ~150-200t
 * Layer 2: 完整互動 (importance ≥ 20) — ~300-400t
 * Layer 3: 全部 — ~430t+
 *
 * LLM 先拿 Layer 1，不夠再 --more / --all。
 */

import { type RawElement } from '../dom/pruner.js';
import { scoreAndSort, splitLayers } from './importance-scorer.js';
import { formatUCF, type UCFOptions } from './ucf-formatter.js';
import { estimateTokens } from '../utils/token-counter.js';

export type ProgressiveLayer = 1 | 2 | 3;

export interface ProgressiveResult {
  text: string;
  tokenCount: number;
  elementCount: number;
  layer: ProgressiveLayer;
  totalElements: number;
  layerCounts: { layer1: number; layer2: number; layer3: number };
  hasMore: boolean;
}

/**
 * Generate a progressive snapshot at the specified layer.
 */
export function progressiveSnapshot(
  elements: RawElement[],
  url: string,
  title: string,
  layer: ProgressiveLayer = 1,
  opts?: UCFOptions,
): ProgressiveResult {
  const scored = scoreAndSort(elements);
  const layers = splitLayers(scored);
  const layerCounts = {
    layer1: layers.layer1.length,
    layer2: layers.layer2.length,
    layer3: layers.layer3.length,
  };

  let selectedElements: RawElement[];
  switch (layer) {
    case 1:
      selectedElements = layers.layer1;
      break;
    case 2:
      selectedElements = [...layers.layer1, ...layers.layer2];
      break;
    case 3:
    default:
      selectedElements = [...layers.layer1, ...layers.layer2, ...layers.layer3];
      break;
  }

  const ucf = formatUCF(selectedElements, url, title, opts);

  // Add layer info footer
  const remaining = elements.length - selectedElements.length;
  const footer = remaining > 0
    ? `\n[layer ${layer}: ${selectedElements.length} elements | ${remaining} more available${layer === 1 ? ' --more' : layer === 2 ? ' --all' : ''}]`
    : `\n[layer ${layer}: ${selectedElements.length} elements | complete]`;

  const text = ucf.text + footer;
  const tokenCount = estimateTokens(text);

  return {
    text,
    tokenCount,
    elementCount: selectedElements.length,
    layer,
    totalElements: elements.length,
    layerCounts,
    hasMore: remaining > 0,
  };
}
