/**
 * permissions/store.ts — 用戶選擇持久化
 *
 * 儲存在 ~/.wu-browser/permissions.json
 * 格式：{ "domain": { "action_key": true/false } }
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const WU_DIR = join(homedir(), '.wu-browser');
const PERM_FILE = join(WU_DIR, 'permissions.json');
const BLACKLIST_FILE = join(WU_DIR, 'blacklist.json');

type PermStore = Record<string, Record<string, boolean>>;

function load(file: string, fallback: unknown = {}): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return fallback;
  }
}

function save(file: string, data: unknown): void {
  mkdirSync(WU_DIR, { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
}

/** 記錄用戶選擇（黃區：首次記住）*/
export function recordUserChoice(domain: string, actionKey: string, allowed: boolean): void {
  const store = load(PERM_FILE, {}) as PermStore;
  if (!store[domain]) store[domain] = {};
  store[domain][actionKey] = allowed;
  save(PERM_FILE, store);
}

/** 查詢之前記住的選擇（null = 沒有記錄）*/
export function getUserChoice(domain: string, actionKey: string): boolean | null {
  const store = load(PERM_FILE, {}) as PermStore;
  const domainStore = store[domain];
  if (!domainStore || !(actionKey in domainStore)) return null;
  return domainStore[actionKey];
}

/** 清除特定域名的所有記錄 */
export function clearDomainChoices(domain: string): void {
  const store = load(PERM_FILE, {}) as PermStore;
  delete store[domain];
  save(PERM_FILE, store);
}

/** 讀取黑名單（用戶自訂域名）*/
export function loadBlacklist(): string[] {
  return load(BLACKLIST_FILE, []) as string[];
}

/** 加入黑名單 */
export function addToBlacklist(domain: string): void {
  const list = loadBlacklist();
  if (!list.includes(domain)) {
    list.push(domain);
    save(BLACKLIST_FILE, list);
  }
}
