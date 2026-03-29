/**
 * model-sense/detector.ts — 三層模型偵測
 *
 * Layer 1：CLI --model flag / 環境變數 WU_BROWSER_MODEL
 * Layer 2：MCP client info（如果有）
 * Layer 3：~/.wu-browser/config.json
 * Fallback：DEFAULT_PROFILE（balanced）
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { type ModelProfile, getProfile, DEFAULT_PROFILE } from './profiles.js';

const WU_BROWSER_DIR = join(homedir(), '.wu-browser');
const CONFIG_PATH = join(WU_BROWSER_DIR, 'config.json');

/** Current detected model (set by detect()) */
let currentProfile: ModelProfile = DEFAULT_PROFILE;
let detectedSource: 'flag' | 'env' | 'mcp' | 'config' | 'default' = 'default';

/**
 * Detect the active model profile.
 *
 * Priority: flag > env > mcp > config > default
 */
export function detectModel(options?: {
  flag?: string;       // --model CLI flag
  mcpClientInfo?: string; // from MCP handshake
}): { profile: ModelProfile; source: string } {
  // Layer 1a: explicit flag
  if (options?.flag) {
    currentProfile = getProfile(options.flag);
    detectedSource = 'flag';
    return { profile: currentProfile, source: `flag: ${options.flag}` };
  }

  // Layer 1b: environment variable
  const envModel = process.env.WU_BROWSER_MODEL;
  if (envModel) {
    currentProfile = getProfile(envModel);
    detectedSource = 'env';
    return { profile: currentProfile, source: `env: ${envModel}` };
  }

  // Layer 2: MCP client info
  if (options?.mcpClientInfo) {
    currentProfile = getProfile(options.mcpClientInfo);
    detectedSource = 'mcp';
    return { profile: currentProfile, source: `mcp: ${options.mcpClientInfo}` };
  }

  // Layer 3: config file
  try {
    const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
    if (config.model) {
      currentProfile = getProfile(config.model);
      detectedSource = 'config';
      return { profile: currentProfile, source: `config: ${config.model}` };
    }
  } catch {
    // No config file, that's fine
  }

  // Fallback
  currentProfile = DEFAULT_PROFILE;
  detectedSource = 'default';
  return { profile: currentProfile, source: 'default (balanced)' };
}

/** Get the currently active profile */
export function getCurrentProfile(): ModelProfile {
  return currentProfile;
}

/** Get how the current profile was detected */
export function getDetectionSource(): string {
  return detectedSource;
}

/** Override the current profile (for calibration or testing) */
export function setProfile(profile: ModelProfile): void {
  currentProfile = profile;
  detectedSource = 'flag';
}
