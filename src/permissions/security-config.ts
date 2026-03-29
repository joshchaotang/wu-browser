/**
 * permissions/security-config.ts — 用戶安全設定
 *
 * ~/.wu-browser/security.json
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const WU_DIR = join(homedir(), '.wu-browser');
const SECURITY_PATH = join(WU_DIR, 'security.json');

export type PermissionLevel = 'strict' | 'balanced' | 'permissive';
export type DomainLevel = 'GREEN' | 'YELLOW' | 'RED' | 'BLACK';

export interface SecurityConfig {
  /** Global permission level */
  permissionLevel: PermissionLevel;
  /** Per-domain rules (supports wildcards like *.bank.com) */
  domainRules: Record<string, DomainLevel>;
  /** Auto-wrap output in content boundaries */
  contentBoundaries: boolean;
  /** Auto-close cookie banners */
  autoCloseCookies: boolean;
  /** Detect prompt injection attempts in page content */
  promptInjectionDetection: boolean;
}

const DEFAULT_CONFIG: SecurityConfig = {
  permissionLevel: 'balanced',
  domainRules: {},
  contentBoundaries: false,
  autoCloseCookies: true,
  promptInjectionDetection: true,
};

let cachedConfig: SecurityConfig | null = null;

/** Load security config (cached after first read) */
export function loadSecurityConfig(): SecurityConfig {
  if (cachedConfig) return cachedConfig;
  try {
    const raw = JSON.parse(readFileSync(SECURITY_PATH, 'utf-8'));
    cachedConfig = { ...DEFAULT_CONFIG, ...raw };
    return cachedConfig!;
  } catch {
    cachedConfig = { ...DEFAULT_CONFIG };
    return cachedConfig;
  }
}

/** Save security config */
export function saveSecurityConfig(config: SecurityConfig): void {
  mkdirSync(WU_DIR, { recursive: true });
  writeFileSync(SECURITY_PATH, JSON.stringify(config, null, 2), 'utf-8');
  cachedConfig = config;
}

/** Reset cache (for testing) */
export function resetConfigCache(): void {
  cachedConfig = null;
}

/** Check domain rules — supports wildcards */
export function getDomainLevel(domain: string): DomainLevel | null {
  const config = loadSecurityConfig();
  const rules = config.domainRules;

  // Exact match first
  if (rules[domain]) return rules[domain];

  // Wildcard match
  for (const [pattern, level] of Object.entries(rules)) {
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(1); // ".bank.com"
      if (domain.endsWith(suffix) || domain === pattern.slice(2)) {
        return level;
      }
    }
  }

  return null;
}

/** Set a specific config key */
export function setConfigValue(key: keyof SecurityConfig, value: unknown): void {
  const config = loadSecurityConfig();
  (config as any)[key] = value;
  saveSecurityConfig(config);
}

/** Set a domain rule */
export function setDomainRule(domain: string, level: DomainLevel): void {
  const config = loadSecurityConfig();
  config.domainRules[domain] = level;
  saveSecurityConfig(config);
}

/** Remove a domain rule */
export function removeDomainRule(domain: string): void {
  const config = loadSecurityConfig();
  delete config.domainRules[domain];
  saveSecurityConfig(config);
}
