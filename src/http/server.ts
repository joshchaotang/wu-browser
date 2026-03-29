/**
 * http/server.ts — HTTP API server
 *
 * 所有 MCP tools 都有對應的 POST /api/{tool} endpoint。
 * 除 /api/status 外，所有 endpoint 需要 Bearer token 認證。
 */

import Fastify from 'fastify';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { randomBytes } from 'crypto';
import { homedir } from 'os';
import { join } from 'path';
import { connect } from '../browser/connection.js';
import { snapshot, getText } from '../dom/snapshot.js';
import {
  click, typeText, scroll, navigate,
  goBack, goForward, selectOption, hover,
  waitFor, takeScreenshot, executeJs,
} from '../dom/actions.js';
import {
  listTabs, activateTab, closeTab, newTab,
} from '../browser/session.js';
import { info, error } from '../utils/logger.js';

const WU_DIR = join(homedir(), '.wu-browser');
const TOKEN_FILE = join(WU_DIR, 'token');

function getOrCreateToken(): string {
  mkdirSync(WU_DIR, { recursive: true });
  if (existsSync(TOKEN_FILE)) {
    return readFileSync(TOKEN_FILE, 'utf-8').trim();
  }
  const token = randomBytes(32).toString('hex');
  writeFileSync(TOKEN_FILE, token, 'utf-8');
  return token;
}

const startTime = Date.now();

export async function startHttpServer(port = 9867): Promise<void> {
  const token = getOrCreateToken();
  const app = Fastify({ logger: false });

  // ─── 認證中介層 ─────────────────────────────────────────────

  app.addHook('preHandler', async (req, reply) => {
    // /api/status 無需認證
    if (req.url === '/api/status') return;

    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      reply.code(401).send({ error: 'Missing Bearer token' });
      return;
    }
    if (auth.slice(7) !== token) {
      reply.code(403).send({ error: 'Invalid token' });
      return;
    }
  });

  // ─── Status（公開）──────────────────────────────────────────

  app.get('/api/status', async () => {
    const tabs = await listTabs().catch(() => []);
    const ms = Date.now() - startTime;
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return {
      chrome: 'connected',
      port: parseInt(process.env.WU_BROWSER_CHROME_PORT ?? '9222'),
      currentTab: tabs[0] ?? null,
      tabCount: tabs.length,
      uptime: `${h}h ${m}m`,
    };
  });

  // ─── 導航 ────────────────────────────────────────────────────

  app.post('/api/wu_navigate', async (req, reply) => {
    const { url } = req.body as { url: string };
    if (!url) return reply.code(400).send({ error: 'url required' });
    const result = await navigate(url);
    return result;
  });

  app.post('/api/wu_go_back', async () => goBack());
  app.post('/api/wu_go_forward', async () => goForward());

  // ─── 讀取 ────────────────────────────────────────────────────

  app.post('/api/wu_snapshot', async (req) => {
    const { mode = 'interactive', maxTokens = 1000, selector } = (req.body ?? {}) as {
      mode?: 'interactive' | 'content' | 'full';
      maxTokens?: number;
      selector?: string;
    };
    return snapshot({ mode, maxTokens, selector });
  });

  app.post('/api/wu_get_text', async (req) => {
    const { selector } = (req.body ?? {}) as { selector?: string };
    return getText(selector);
  });

  // ─── 操作 ────────────────────────────────────────────────────

  app.post('/api/wu_click', async (req, reply) => {
    const { ref } = req.body as { ref: string };
    if (!ref) return reply.code(400).send({ error: 'ref required' });
    return click(ref);
  });

  app.post('/api/wu_type', async (req, reply) => {
    const { ref, text, clear } = req.body as { ref: string; text: string; clear?: boolean };
    if (!ref || !text) return reply.code(400).send({ error: 'ref and text required' });
    return typeText(ref, text, { clear });
  });

  app.post('/api/wu_scroll', async (req) => {
    const { direction = 'down', amount = 500 } = (req.body ?? {}) as {
      direction?: 'up' | 'down' | 'left' | 'right';
      amount?: number;
    };
    return scroll(direction, amount);
  });

  app.post('/api/wu_select', async (req, reply) => {
    const { ref, value } = req.body as { ref: string; value: string };
    if (!ref || !value) return reply.code(400).send({ error: 'ref and value required' });
    return selectOption(ref, value);
  });

  app.post('/api/wu_hover', async (req, reply) => {
    const { ref } = req.body as { ref: string };
    if (!ref) return reply.code(400).send({ error: 'ref required' });
    return hover(ref);
  });

  // ─── Tab 管理 ────────────────────────────────────────────────

  app.get('/api/wu_list_tabs', async () => ({ tabs: await listTabs() }));

  app.post('/api/wu_switch_tab', async (req, reply) => {
    const { index } = req.body as { index: number };
    if (index == null) return reply.code(400).send({ error: 'index required' });
    const tabs = await listTabs();
    if (index < 0 || index >= tabs.length) return reply.code(400).send({ error: 'Invalid tab index' });
    await activateTab(tabs[index].id);
    return { success: true, tab: tabs[index] };
  });

  app.post('/api/wu_close_tab', async (req) => {
    const { index } = (req.body ?? {}) as { index?: number };
    const tabs = await listTabs();
    const idx = index ?? tabs.length - 1;
    await closeTab(tabs[idx].id);
    return { success: true };
  });

  app.post('/api/wu_new_tab', async (req) => {
    const { url } = (req.body ?? {}) as { url?: string };
    return newTab(url);
  });

  // ─── 工具 ────────────────────────────────────────────────────

  app.post('/api/wu_screenshot', async (req) => {
    const { fullPage = false } = (req.body ?? {}) as { fullPage?: boolean };
    const data = await takeScreenshot({ fullPage });
    return { data, mimeType: 'image/png' };
  });

  app.post('/api/wu_wait', async (req, reply) => {
    const { selector, timeout = 5000 } = req.body as { selector: string; timeout?: number };
    if (!selector) return reply.code(400).send({ error: 'selector required' });
    return waitFor(selector, timeout);
  });

  app.post('/api/wu_execute_js', async (req, reply) => {
    const { code } = req.body as { code: string };
    if (!code) return reply.code(400).send({ error: 'code required' });
    const result = await executeJs(code);
    return { result };
  });

  await app.listen({ port, host: '0.0.0.0' });
  info(`HTTP server listening on port ${port}`);
  info(`API token: ${token.substring(0, 8)}... (full token in ~/.wu-browser/token)`);
}
