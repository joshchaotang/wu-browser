/**
 * model-sense/calibrate.ts — 自動校準
 *
 * 用不同 profile 設定跑 snapshot，比較 token 數，
 * 找出最佳設定。結果存 ~/.wu-browser/calibration.json。
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { type ModelProfile, BUILTIN_PROFILES, getProfile } from './profiles.js';

const WU_BROWSER_DIR = join(homedir(), '.wu-browser');
const CALIBRATION_PATH = join(WU_BROWSER_DIR, 'calibration.json');

export interface CalibrationResult {
  model: string;
  timestamp: string;
  results: Array<{
    strategy: string;
    tokenCount: number;
    elementCount: number;
    savingsPercent: number;
  }>;
  recommended: string;
}

/**
 * Run calibration with given elements.
 * Returns results for each pruning strategy.
 */
export function calibrate(
  elements: Array<{ ref: string; role: string; name: string; href?: string; type?: string; region?: string }>,
  modelName: string,
  formatFn: (els: typeof elements, profile: ModelProfile) => { tokenCount: number; elementCount: number },
): CalibrationResult {
  const profile = getProfile(modelName);

  const strategies: Array<{ name: string; profile: ModelProfile }> = [
    {
      name: 'minimal',
      profile: { ...profile, pruningStrategy: 'minimal', optimalMaxTokens: 5000, snapshotFormat: { includeHref: true, includeRegion: true, refFormat: 'full', depthLimit: 0 } },
    },
    {
      name: 'balanced',
      profile: { ...profile, pruningStrategy: 'balanced', optimalMaxTokens: 2000, snapshotFormat: { includeHref: true, includeRegion: false, refFormat: 'full', depthLimit: 0 } },
    },
    {
      name: 'aggressive',
      profile: { ...profile, pruningStrategy: 'aggressive', optimalMaxTokens: 800, snapshotFormat: { includeHref: false, includeRegion: false, refFormat: 'compact', depthLimit: 3 } },
    },
  ];

  const fullResult = formatFn(elements, strategies[0].profile);
  const results = strategies.map(s => {
    const r = formatFn(elements, s.profile);
    return {
      strategy: s.name,
      tokenCount: r.tokenCount,
      elementCount: r.elementCount,
      savingsPercent: fullResult.tokenCount > 0
        ? Math.round((1 - r.tokenCount / fullResult.tokenCount) * 100)
        : 0,
    };
  });

  // Pick recommended: balanced if context < 200K, minimal if >= 200K
  const recommended = profile.contextWindow >= 200000 ? 'balanced' : 'aggressive';

  const calibrationResult: CalibrationResult = {
    model: modelName,
    timestamp: new Date().toISOString(),
    results,
    recommended,
  };

  // Save
  try {
    mkdirSync(WU_BROWSER_DIR, { recursive: true });
    writeFileSync(CALIBRATION_PATH, JSON.stringify(calibrationResult, null, 2), 'utf-8');
  } catch {
    // Non-critical
  }

  return calibrationResult;
}

/** Load previous calibration result */
export function loadCalibration(): CalibrationResult | null {
  try {
    return JSON.parse(readFileSync(CALIBRATION_PATH, 'utf-8'));
  } catch {
    return null;
  }
}
