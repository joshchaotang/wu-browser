/**
 * model-sense/profiles.ts — LLM 模型最佳設定檔
 *
 * 每個 profile 定義該 LLM 的 context window、tokenizer、
 * 最佳輸出格式，讓 snapshot 引擎自動適配。
 */

export interface SnapshotFormatConfig {
  /** 是否在元素輸出中包含 href */
  includeHref: boolean;
  /** 是否輸出 region 標記 */
  includeRegion: boolean;
  /** ref 格式：'compact' = "@1", 'full' = "@e1" */
  refFormat: 'compact' | 'full';
  /** 深度限制（0 = 不限）。小模型用 2-3 層 */
  depthLimit: number;
}

export interface ModelProfile {
  name: string;
  contextWindow: number;
  tokenizer: string;
  /** snapshot 的預設 maxTokens */
  optimalMaxTokens: number;
  snapshotFormat: SnapshotFormatConfig;
  pruningStrategy: 'aggressive' | 'balanced' | 'minimal';
}

/**
 * 內建 profiles。出廠預設，不需要 calibrate。
 *
 * pruningStrategy 說明：
 * - aggressive：只留互動元素 + 標題（適合 8K 小模型）
 * - balanced：互動 + 標題 + 導航（適合 128K-200K）
 * - minimal：幾乎全留（適合 1M context）
 */
export const BUILTIN_PROFILES: Record<string, ModelProfile> = {
  'claude-opus-4.6': {
    name: 'claude-opus-4.6',
    contextWindow: 1000000,
    tokenizer: 'cl100k_base',
    optimalMaxTokens: 5000,
    snapshotFormat: { includeHref: true, includeRegion: true, refFormat: 'full', depthLimit: 0 },
    pruningStrategy: 'minimal',
  },
  'claude-sonnet-4.6': {
    name: 'claude-sonnet-4.6',
    contextWindow: 200000,
    tokenizer: 'cl100k_base',
    optimalMaxTokens: 2000,
    snapshotFormat: { includeHref: true, includeRegion: true, refFormat: 'full', depthLimit: 0 },
    pruningStrategy: 'balanced',
  },
  'claude-haiku-4.5': {
    name: 'claude-haiku-4.5',
    contextWindow: 200000,
    tokenizer: 'cl100k_base',
    optimalMaxTokens: 1500,
    snapshotFormat: { includeHref: true, includeRegion: false, refFormat: 'full', depthLimit: 5 },
    pruningStrategy: 'balanced',
  },
  'gpt-4o': {
    name: 'gpt-4o',
    contextWindow: 128000,
    tokenizer: 'o200k_base',
    optimalMaxTokens: 1500,
    snapshotFormat: { includeHref: true, includeRegion: false, refFormat: 'compact', depthLimit: 5 },
    pruningStrategy: 'balanced',
  },
  'gpt-4o-mini': {
    name: 'gpt-4o-mini',
    contextWindow: 128000,
    tokenizer: 'o200k_base',
    optimalMaxTokens: 800,
    snapshotFormat: { includeHref: false, includeRegion: false, refFormat: 'compact', depthLimit: 3 },
    pruningStrategy: 'aggressive',
  },
  'gemini-2.5-pro': {
    name: 'gemini-2.5-pro',
    contextWindow: 1000000,
    tokenizer: 'cl100k_base',
    optimalMaxTokens: 4000,
    snapshotFormat: { includeHref: true, includeRegion: true, refFormat: 'full', depthLimit: 0 },
    pruningStrategy: 'minimal',
  },
  'gemini-2.5-flash': {
    name: 'gemini-2.5-flash',
    contextWindow: 1000000,
    tokenizer: 'cl100k_base',
    optimalMaxTokens: 3000,
    snapshotFormat: { includeHref: true, includeRegion: false, refFormat: 'full', depthLimit: 0 },
    pruningStrategy: 'balanced',
  },
  'local-8k': {
    name: 'local-8k',
    contextWindow: 8192,
    tokenizer: 'cl100k_base',
    optimalMaxTokens: 400,
    snapshotFormat: { includeHref: false, includeRegion: false, refFormat: 'compact', depthLimit: 2 },
    pruningStrategy: 'aggressive',
  },
  'local-32k': {
    name: 'local-32k',
    contextWindow: 32768,
    tokenizer: 'cl100k_base',
    optimalMaxTokens: 800,
    snapshotFormat: { includeHref: false, includeRegion: false, refFormat: 'compact', depthLimit: 4 },
    pruningStrategy: 'balanced',
  },
};

/** Default profile when no model is specified */
export const DEFAULT_PROFILE: ModelProfile = BUILTIN_PROFILES['claude-sonnet-4.6'];

/** Get a profile by name, fallback to default */
export function getProfile(modelName: string): ModelProfile {
  // Exact match
  if (BUILTIN_PROFILES[modelName]) return BUILTIN_PROFILES[modelName];

  // Partial match (e.g. "opus" matches "claude-opus-4.6")
  const lower = modelName.toLowerCase();
  for (const [key, profile] of Object.entries(BUILTIN_PROFILES)) {
    if (key.includes(lower) || lower.includes(key)) return profile;
  }

  return DEFAULT_PROFILE;
}

/** List all available profile names */
export function listProfiles(): string[] {
  return Object.keys(BUILTIN_PROFILES);
}
