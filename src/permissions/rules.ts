/**
 * permissions/rules.ts — 四級權限預設規則
 *
 * 🟢 GREEN：永不問
 * 🟡 YELLOW：首次問，記住
 * 🔴 RED：每次問
 * ⚫ BLACK：永久封鎖
 */

export type PermLevel = 'green' | 'yellow' | 'red' | 'black';

// ─── 綠區動作（永不問）────────────────────────────────────────

const GREEN_ACTIONS = new Set([
  'navigate', 'scroll', 'snapshot', 'go_back', 'go_forward',
  'list_tabs', 'switch_tab', 'status', 'get_text', 'wait', 'hover',
]);

// 綠區角色：點擊這些角色的元素不需要確認
const GREEN_ROLES = new Set([
  'link', 'tab', 'menuitem', 'option', 'treeitem',
]);

// 搜尋框 type=search 輸入不需要確認
const GREEN_INPUT_TYPES = new Set(['search']);

// ─── 黃區關鍵字（首次問）──────────────────────────────────────

// 按鈕文字包含這些 → 黃區
const YELLOW_BTN_PATTERNS = [
  /\b(submit|send|post|publish|like|share|follow|subscribe|login|sign\s*in|register|save|update|upload|comment|reply)\b/i,
  /(發布|發文|留言|回覆|分享|追蹤|訂閱|登入|登錄|上傳|儲存|更新|提交|發送)/,
];

// 表單輸入（非搜尋）→ 黃區
const YELLOW_INPUT_TYPES = new Set([
  'text', 'email', 'password', 'tel', 'number', 'url', 'date',
  'time', 'datetime-local', 'textarea',
]);

// ─── 紅區關鍵字（每次問）──────────────────────────────────────

const RED_BTN_PATTERNS = [
  /\b(buy|purchase|pay|checkout|order|confirm\s*order|place\s*order)\b/i,
  /\b(delete|remove|unsubscribe|cancel|deactivate|terminate|close\s*account)\b/i,
  /\b(transfer|send\s*money|withdraw|wire\s*transfer)\b/i,
  /(購買|付款|結帳|下訂|確認訂單|刪除|移除|取消訂閱|轉帳|付錢|匯款|提款)/,
];

// ─── 黑區域名（永久封鎖）──────────────────────────────────────

const BLACK_DOMAINS = [
  // 銀行
  'chase.com', 'wellsfargo.com', 'bankofamerica.com', 'citibank.com',
  'usbank.com', 'schwab.com', 'fidelity.com', 'vanguard.com',
  'tdbank.com', 'capitalone.com', 'pnc.com', 'suntrust.com',
  'hsbc.com', 'barclays.co.uk', 'lloydsbank.com', 'natwest.com',
  // 加密貨幣交易所
  'binance.com', 'coinbase.com', 'kraken.com', 'bitfinex.com',
  'bybit.com', 'okx.com', 'kucoin.com', 'huobi.com',
  // 通用 .bank
  '.bank',
];

// ─── 判斷函數 ─────────────────────────────────────────────────

export function classifyAction(action: string): PermLevel {
  if (GREEN_ACTIONS.has(action)) return 'green';
  return 'yellow';
}

export function classifyClick(role: string, elementName: string, url: string): PermLevel {
  // 先看域名黑名單
  if (isDomainBlacklisted(url)) return 'black';

  // 紅區關鍵字
  const combinedText = `${role} ${elementName}`.toLowerCase();
  if (RED_BTN_PATTERNS.some(p => p.test(combinedText))) return 'red';

  // 綠區角色
  if (GREEN_ROLES.has(role)) return 'green';

  // 黃區關鍵字
  if (YELLOW_BTN_PATTERNS.some(p => p.test(combinedText))) return 'yellow';

  // 其餘點擊預設黃區
  return 'yellow';
}

export function classifyType(inputType: string, elementName: string, url: string): PermLevel {
  if (isDomainBlacklisted(url)) return 'black';
  if (GREEN_INPUT_TYPES.has(inputType)) return 'green';
  if (YELLOW_INPUT_TYPES.has(inputType) || !inputType) return 'yellow';
  return 'yellow';
}

export function isDomainBlacklisted(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    return BLACK_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d) || d.startsWith('.') && hostname.endsWith(d));
  } catch {
    return false;
  }
}

export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/** 生成 Yellow 區的 action key（用於持久化記憶）*/
export function makeActionKey(role: string, elementName: string): string {
  return `${role}:${elementName.toLowerCase().trim().substring(0, 30)}`;
}
