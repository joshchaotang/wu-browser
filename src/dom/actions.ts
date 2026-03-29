/**
 * dom/actions.ts — 頁面操作模組
 *
 * 所有寫操作都透過 CDP Input/Runtime domain 執行。
 * 每次操作後等待頁面穩定。
 */

import { getClient } from '../browser/connection.js';
import { audit, debug } from '../utils/logger.js';
import { listTabs } from '../browser/session.js';
import { miniSnapshot, sessionStats } from './snapshot.js';

export interface ActionResult {
  success: boolean;
  message: string;
  newUrl?: string;
  pageChanged?: boolean;
  newTabId?: string;
  /** Mini-snapshot context after the action */
  context?: string;
}

// ─── Ref 解析 ───────────────────────────────────────────────────

const FIND_REF = (ref: string) => `(function() {
  var el = window.__wuRefs && window.__wuRefs[${JSON.stringify(ref)}];
  if (!el) return null;
  var rect = el.getBoundingClientRect();
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
    width: rect.width,
    height: rect.height,
    tag: el.tagName.toLowerCase(),
    type: el.getAttribute('type') || '',
    visible: rect.width > 0 || rect.height > 0
  };
})()`;

async function resolveRef(ref: string): Promise<{
  x: number; y: number; width: number; height: number;
  tag: string; type: string; visible: boolean;
} | null> {
  const client = await getClient();
  const { Runtime } = client;
  const result = await Runtime.evaluate({
    expression: FIND_REF(ref),
    returnByValue: true,
  });
  return result.result.value ?? null;
}

// ─── 操作函數 ───────────────────────────────────────────────────

export async function click(ref: string): Promise<ActionResult> {
  sessionStats.actions++;
  const client = await getClient();
  const { Runtime, Input } = client;

  const elInfo = await resolveRef(ref);
  if (!elInfo) {
    return {
      success: false,
      message: `Ref ${ref} not found. Please take a new snapshot to get current refs.`,
    };
  }

  debug(`Clicking ${ref} at (${elInfo.x}, ${elInfo.y})`);

  // 記錄操作前的 URL
  const beforeUrl = await getCurrentUrl();

  // 記錄操作前的 tab 數
  const tabsBefore = await listTabs();

  // 用 JS click（繞過 fixed element 遮擋）
  await Runtime.evaluate({
    expression: `(function() {
      var el = window.__wuRefs[${JSON.stringify(ref)}];
      if (el) {
        el.scrollIntoView({ behavior: 'instant', block: 'center' });
        el.click();
        return true;
      }
      return false;
    })()`,
    returnByValue: true,
  });

  await waitForStable();

  const afterUrl = await getCurrentUrl();
  const tabsAfter = await listTabs();

  const newTab = tabsAfter.find(t => !tabsBefore.find(b => b.id === t.id));

  audit('CLICK', `${ref}`, '[YELLOW:ALLOWED]');

  // Mini-snapshot: URL change + dialog detection
  const mini = await miniSnapshot();
  let context = `[動作完成] click ${ref}`;
  if (afterUrl !== beforeUrl) {
    context += ` → 導航到 ${afterUrl}`;
    if (mini.title) context += ` · 標題："${mini.title}"`;
  } else if (mini.dialogs.length > 0) {
    const d = mini.dialogs[0];
    context += ` → ⚠️ 彈出對話框："${d.text.substring(0, 60)}"`;
    if (d.buttons.length > 0) context += `\n  按鈕：${d.buttons.map(b => `"${b}"`).join(' / ')}`;
  } else {
    context += ' → 頁面無變化';
  }
  if (newTab) context += `\n  [新分頁已開啟]`;

  return {
    success: true,
    message: `Clicked ${ref}`,
    newUrl: afterUrl !== beforeUrl ? afterUrl : undefined,
    pageChanged: afterUrl !== beforeUrl,
    newTabId: newTab?.id,
    context,
  };
}

export async function typeText(
  ref: string,
  text: string,
  opts: { clear?: boolean; slowly?: boolean } = {}
): Promise<ActionResult> {
  sessionStats.actions++;
  const client = await getClient();
  const { Runtime } = client;

  const elInfo = await resolveRef(ref);
  if (!elInfo) {
    return {
      success: false,
      message: `Ref ${ref} not found. Please take a new snapshot.`,
    };
  }

  debug(`Typing into ${ref}: "${text.substring(0, 20)}..."`);

  // 先 focus，再清空（若需要），再輸入
  await Runtime.evaluate({
    expression: `(function() {
      var el = window.__wuRefs[${JSON.stringify(ref)}];
      if (!el) return false;
      el.scrollIntoView({ behavior: 'instant', block: 'center' });
      el.focus();
      if (${opts.clear !== false}) {
        el.value = '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return true;
    })()`,
    returnByValue: true,
  });

  // 逐字輸入（觸發 keydown/keypress/keyup 事件）
  await Runtime.evaluate({
    expression: `(function() {
      var el = window.__wuRefs[${JSON.stringify(ref)}];
      if (!el) return;
      var text = ${JSON.stringify(text)};
      // 設定值
      var nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
      if (nativeInputValueSetter && nativeInputValueSetter.set) {
        nativeInputValueSetter.set.call(el, (el.value || '') + text);
      } else {
        el.value = (el.value || '') + text;
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    })()`,
    returnByValue: true,
  });

  await waitForStable(500);

  audit('TYPE', `${ref} "${text.substring(0, 20)}"`, '[YELLOW:ALLOWED]');

  // Mini-snapshot: check for dialogs after typing
  const mini = await miniSnapshot();
  let context = `[動作完成] type ${ref} "${text.substring(0, 30)}"`;
  if (mini.dialogs.length > 0) {
    const d = mini.dialogs[0];
    context += ` → ⚠️ 彈出對話框："${d.text.substring(0, 60)}"`;
  } else {
    context += ' → 完成';
  }

  return {
    success: true,
    message: `Typed into ${ref}`,
    context,
  };
}

export async function scroll(
  direction: 'up' | 'down' | 'left' | 'right',
  amount = 500
): Promise<ActionResult> {
  sessionStats.actions++;
  const client = await getClient();
  const { Runtime } = client;

  const [dx, dy] = {
    up: [0, -amount],
    down: [0, amount],
    left: [-amount, 0],
    right: [amount, 0],
  }[direction];

  await Runtime.evaluate({
    expression: `window.scrollBy(${dx}, ${dy})`,
  });

  await sleep(200);

  audit('SCROLL', direction);

  return { success: true, message: `Scrolled ${direction} ${amount}px` };
}

export async function navigate(url: string): Promise<ActionResult> {
  sessionStats.actions++;
  const client = await getClient();
  const { Page } = client;

  audit('NAVIGATE', url, '[GREEN]');
  debug(`Navigating to ${url}`);

  await Page.navigate({ url });
  await waitForLoad();

  const newUrl = await getCurrentUrl();

  return {
    success: true,
    message: `Navigated to ${newUrl}`,
    newUrl,
    pageChanged: true,
  };
}

export async function goBack(): Promise<ActionResult> {
  sessionStats.actions++;
  const client = await getClient();
  const { Runtime } = client;

  await Runtime.evaluate({ expression: 'window.history.back()' });
  await waitForLoad();

  const url = await getCurrentUrl();
  audit('BACK', url, '[GREEN]');

  return { success: true, message: `Went back to ${url}`, newUrl: url, pageChanged: true };
}

export async function goForward(): Promise<ActionResult> {
  sessionStats.actions++;
  const client = await getClient();
  const { Runtime } = client;

  await Runtime.evaluate({ expression: 'window.history.forward()' });
  await waitForLoad();

  const url = await getCurrentUrl();
  audit('FORWARD', url, '[GREEN]');

  return { success: true, message: `Went forward to ${url}`, newUrl: url, pageChanged: true };
}

export async function selectOption(ref: string, value: string): Promise<ActionResult> {
  sessionStats.actions++;
  const client = await getClient();
  const { Runtime } = client;

  const elInfo = await resolveRef(ref);
  if (!elInfo) {
    return {
      success: false,
      message: `Ref ${ref} not found. Please take a new snapshot.`,
    };
  }

  await Runtime.evaluate({
    expression: `(function() {
      var el = window.__wuRefs[${JSON.stringify(ref)}];
      if (!el) return false;
      el.value = ${JSON.stringify(value)};
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`,
    returnByValue: true,
  });

  audit('SELECT', `${ref} = ${value}`, '[YELLOW:ALLOWED]');

  return { success: true, message: `Selected ${value} in ${ref}` };
}

export async function hover(ref: string): Promise<ActionResult> {
  sessionStats.actions++;
  const client = await getClient();
  const { Input, Runtime } = client;

  const elInfo = await resolveRef(ref);
  if (!elInfo) {
    return {
      success: false,
      message: `Ref ${ref} not found. Please take a new snapshot.`,
    };
  }

  await Input.dispatchMouseEvent({
    type: 'mouseMoved',
    x: elInfo.x,
    y: elInfo.y,
  });

  // 也觸發 mouseenter/mouseover
  await Runtime.evaluate({
    expression: `(function() {
      var el = window.__wuRefs[${JSON.stringify(ref)}];
      if (el) {
        el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      }
    })()`,
  });

  await sleep(300);

  return { success: true, message: `Hovered over ${ref}` };
}

export async function waitFor(selector: string, timeoutMs = 5000): Promise<ActionResult> {
  const client = await getClient();
  const { Runtime } = client;

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await Runtime.evaluate({
      expression: `!!document.querySelector(${JSON.stringify(selector)})`,
      returnByValue: true,
    });
    if (result.result.value) {
      return { success: true, message: `Element ${selector} appeared` };
    }
    await sleep(300);
  }

  return { success: false, message: `Timeout waiting for ${selector}` };
}

export async function takeScreenshot(opts: { fullPage?: boolean; selector?: string } = {}): Promise<string> {
  const client = await getClient();
  const { Page } = client;

  const result = await Page.captureScreenshot({
    format: 'png',
    ...(opts.fullPage ? { captureBeyondViewport: true } : {}),
  });

  audit('SCREENSHOT', opts.selector ?? 'viewport');
  return result.data; // base64
}

export async function executeJs(code: string): Promise<unknown> {
  const client = await getClient();
  const { Runtime } = client;

  const result = await Runtime.evaluate({
    expression: code,
    returnByValue: true,
    awaitPromise: true,
  });

  if (result.exceptionDetails) {
    throw new Error(`JS execution failed: ${result.exceptionDetails.text}`);
  }

  return result.result.value;
}

// ─── 工具函數 ───────────────────────────────────────────────────

async function getCurrentUrl(): Promise<string> {
  try {
    const client = await getClient();
    const { Runtime } = client;
    const result = await Runtime.evaluate({
      expression: 'window.location.href',
      returnByValue: true,
    });
    return result.result.value as string;
  } catch {
    return '';
  }
}

async function waitForLoad(timeoutMs = 8000): Promise<void> {
  const client = await getClient();
  const { Page } = client;

  await Promise.race([
    new Promise<void>(resolve => {
      Page.loadEventFired(() => resolve());
    }),
    sleep(timeoutMs),
  ]);

  await sleep(300);
}

async function waitForStable(ms = 800): Promise<void> {
  await sleep(ms);
}

function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}
