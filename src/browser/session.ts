import CDP from 'chrome-remote-interface';
import { getClient } from './connection.js';
import { info, debug } from '../utils/logger.js';

export interface Tab {
  id: string;
  url: string;
  title: string;
  type: string;
  active?: boolean;
}

/** 列出所有 tab（只顯示 page 類型）*/
export async function listTabs(): Promise<Tab[]> {
  const host = 'localhost';
  const port = parseInt(process.env.WU_BROWSER_CHROME_PORT ?? '9222');

  const targets = await CDP.List({ host, port });
  return targets
    .filter(t => t.type === 'page')
    .map((t, i) => ({
      id: t.id,
      url: t.url,
      title: t.title,
      type: t.type,
      active: i === 0,
    }));
}

/** 啟動特定 tab（帶到前台）*/
export async function activateTab(tabId: string): Promise<void> {
  const port = parseInt(process.env.WU_BROWSER_CHROME_PORT ?? '9222');
  await CDP.Activate({ id: tabId, port });
  info(`Activated tab: ${tabId}`);
}

/** 關閉 tab */
export async function closeTab(tabId: string): Promise<void> {
  const port = parseInt(process.env.WU_BROWSER_CHROME_PORT ?? '9222');
  await CDP.Close({ id: tabId, port });
  info(`Closed tab: ${tabId}`);
}

/** 開新 tab */
export async function newTab(url?: string): Promise<Tab> {
  const port = parseInt(process.env.WU_BROWSER_CHROME_PORT ?? '9222');
  const target = await CDP.New({ url: url ?? 'about:blank', port });
  info(`Opened new tab: ${target.id}`);
  return {
    id: target.id,
    url: target.url,
    title: target.title,
    type: target.type,
  };
}

/** 等待頁面穩定（network idle + 短暫 DOM 穩定期）*/
export async function waitForPageStable(timeoutMs = 5000): Promise<void> {
  const client = await getClient();
  const { Page, Network } = client;

  await Promise.race([
    new Promise<void>(resolve => {
      Network.loadingFinished(() => setTimeout(resolve, 300));
      setTimeout(resolve, timeoutMs);
    }),
    sleep(timeoutMs),
  ]);
}

/** 連接到特定 tab 的 CDP session */
export async function connectToTab(tabId: string): Promise<CDP.Client> {
  const port = parseInt(process.env.WU_BROWSER_CHROME_PORT ?? '9222');
  const client = await CDP({ target: tabId, port });
  debug(`Connected to tab ${tabId}`);
  return client;
}

/** 取得目前活躍的 tab（第一個 page 類型 target）*/
export async function getActiveTab(): Promise<Tab | null> {
  const tabs = await listTabs();
  return tabs[0] ?? null;
}

function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}
