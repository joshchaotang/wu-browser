/**
 * permissions/engine.ts — 四級權限引擎
 *
 * 所有瀏覽器操作在執行前必須通過此引擎檢查。
 */

import {
  classifyAction,
  classifyClick,
  classifyType,
  isDomainBlacklisted,
  extractDomain,
  makeActionKey,
  type PermLevel,
} from './rules.js';
import { getUserChoice, recordUserChoice, loadBlacklist } from './store.js';
import { audit } from '../utils/logger.js';

export { PermLevel, extractDomain };

export interface PermissionCheck {
  allowed: boolean;
  level: PermLevel;
  reason: string;
  requiresConfirmation: boolean;
  confirmationMessage?: string;
}

/**
 * 檢查動作是否被允許。
 *
 * @param action  動作名稱（navigate / click / type / scroll 等）
 * @param url     當前頁面 URL
 * @param elementInfo  元素資訊（role + name）
 */
export function checkPermission(
  action: string,
  url: string,
  elementInfo?: { role: string; name: string; inputType?: string }
): PermissionCheck {
  // 先看用戶自訂黑名單
  const userBlacklist = loadBlacklist();
  const domain = extractDomain(url);
  if (userBlacklist.some(d => domain === d || domain.endsWith('.' + d))) {
    return blackBlocked(domain, 'User blacklist');
  }

  // 域名黑名單（內建）
  if (isDomainBlacklisted(url)) {
    return blackBlocked(domain, 'Financial domain — blocked for safety');
  }

  // 動作級別判定
  let level: PermLevel;

  if (action === 'click' && elementInfo) {
    level = classifyClick(elementInfo.role, elementInfo.name, url);
  } else if (action === 'type' && elementInfo) {
    level = classifyType(elementInfo.inputType ?? 'text', elementInfo.name, url);
  } else {
    level = classifyAction(action);
  }

  if (level === 'black') {
    return blackBlocked(domain, 'Action blocked by rules');
  }

  if (level === 'green') {
    audit(action.toUpperCase(), `${elementInfo?.name ?? ''} ${url}`, '[GREEN]');
    return {
      allowed: true,
      level: 'green',
      reason: 'Read/navigation action',
      requiresConfirmation: false,
    };
  }

  if (level === 'red') {
    const msg = buildConfirmMessage('red', action, elementInfo, url);
    return {
      allowed: false,
      level: 'red',
      reason: 'Potentially destructive or financial action',
      requiresConfirmation: true,
      confirmationMessage: msg,
    };
  }

  // 黃區：查看是否之前記住了
  if (level === 'yellow' && elementInfo) {
    const actionKey = makeActionKey(elementInfo.role, elementInfo.name);
    const remembered = getUserChoice(domain, actionKey);
    if (remembered === true) {
      audit(action.toUpperCase(), `${elementInfo.name}`, '[YELLOW:REMEMBERED]');
      return {
        allowed: true,
        level: 'yellow',
        reason: 'Previously approved',
        requiresConfirmation: false,
      };
    }
    if (remembered === false) {
      return {
        allowed: false,
        level: 'yellow',
        reason: 'Previously denied',
        requiresConfirmation: false,
      };
    }
    // 首次遇到 → 需要確認
    const msg = buildConfirmMessage('yellow', action, elementInfo, url);
    return {
      allowed: false,
      level: 'yellow',
      reason: 'First-time action requiring confirmation',
      requiresConfirmation: true,
      confirmationMessage: msg,
    };
  }

  // 黃區但沒有元素資訊
  return {
    allowed: true,
    level: 'yellow',
    reason: 'Action allowed',
    requiresConfirmation: false,
  };
}

/** 記錄用戶確認結果（黃區持久化）*/
export function approveYellowAction(
  domain: string,
  role: string,
  name: string,
  allowed: boolean
): void {
  const actionKey = makeActionKey(role, name);
  recordUserChoice(domain, actionKey, allowed);
  audit('PERMISSION', `${domain} ${actionKey} = ${allowed}`, allowed ? '[YELLOW:ALLOWED]' : '[YELLOW:DENIED]');
}

// ─── 工具 ─────────────────────────────────────────────────────

function blackBlocked(domain: string, reason: string): PermissionCheck {
  audit('BLOCKED', domain, '[BLACK]');
  return {
    allowed: false,
    level: 'black',
    reason,
    requiresConfirmation: false,
    confirmationMessage: `This domain (${domain}) is blocked for safety. To allow, edit ~/.wu-browser/blacklist.json`,
  };
}

function buildConfirmMessage(
  level: 'yellow' | 'red',
  action: string,
  elementInfo?: { role: string; name: string },
  url?: string
): string {
  const el = elementInfo ? `"${elementInfo.name}" (${elementInfo.role})` : action;
  const domain = url ? extractDomain(url) : '';

  if (level === 'red') {
    return `⚠️ RED action: ${action} ${el} on ${domain}\n` +
      `This action (purchase/delete/transfer) requires confirmation every time.\n` +
      `Approve with: approveAction(true) | Deny with: approveAction(false)`;
  }

  return `🟡 YELLOW action: ${action} ${el} on ${domain}\n` +
    `First time performing this action. Allow and remember?\n` +
    `Approve: approveAction(true) | Deny: approveAction(false) | One-time: approveAction(true, false)`;
}
