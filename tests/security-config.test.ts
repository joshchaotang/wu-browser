import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadSecurityConfig,
  saveSecurityConfig,
  resetConfigCache,
  getDomainLevel,
  setDomainRule,
  removeDomainRule,
  type SecurityConfig,
} from '../src/permissions/security-config.js';

describe('security-config', () => {
  beforeEach(() => {
    resetConfigCache();
  });

  it('should return default config when no file exists', () => {
    const config = loadSecurityConfig();
    expect(config.permissionLevel).toBe('balanced');
    expect(config.autoCloseCookies).toBe(true);
    expect(config.contentBoundaries).toBe(false);
    expect(config.promptInjectionDetection).toBe(true);
  });

  it('getDomainLevel returns null for unknown domains', () => {
    expect(getDomainLevel('random-site.com')).toBeNull();
  });

  it('getDomainLevel matches exact domain', () => {
    const config = loadSecurityConfig();
    config.domainRules['github.com'] = 'GREEN';
    saveSecurityConfig(config);
    resetConfigCache();

    expect(getDomainLevel('github.com')).toBe('GREEN');
  });

  it('getDomainLevel matches wildcard', () => {
    const config = loadSecurityConfig();
    config.domainRules['*.bank.com'] = 'BLACK';
    saveSecurityConfig(config);
    resetConfigCache();

    expect(getDomainLevel('chase.bank.com')).toBe('BLACK');
    expect(getDomainLevel('bank.com')).toBe('BLACK');
    expect(getDomainLevel('notabank.com')).toBeNull();
  });

  it('setDomainRule and removeDomainRule work', () => {
    setDomainRule('example.com', 'YELLOW');
    resetConfigCache();
    expect(getDomainLevel('example.com')).toBe('YELLOW');

    removeDomainRule('example.com');
    resetConfigCache();
    expect(getDomainLevel('example.com')).toBeNull();
  });

  it('permissionLevel accepts valid values', () => {
    const config = loadSecurityConfig();
    config.permissionLevel = 'strict';
    saveSecurityConfig(config);
    resetConfigCache();

    expect(loadSecurityConfig().permissionLevel).toBe('strict');

    // Reset back
    config.permissionLevel = 'balanced';
    saveSecurityConfig(config);
    resetConfigCache();
  });
});
