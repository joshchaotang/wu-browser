/**
 * mcp/server.ts — MCP server
 *
 * 暴露 16 個 tools 給 Claude Code / Cowork 使用。
 * 透過 stdio transport 運行。
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { connect, isConnected } from '../browser/connection.js';
import { snapshot, getText, snapshotToJson, sessionStats, getTokenCost } from '../dom/snapshot.js';
import { estimateTokens } from '../utils/token-counter.js';
import {
  click, typeText, scroll, navigate,
  goBack, goForward, selectOption, hover,
  waitFor, takeScreenshot, executeJs,
} from '../dom/actions.js';
import {
  listTabs, activateTab, closeTab, newTab,
} from '../browser/session.js';
import { checkPermission, approveYellowAction, extractDomain } from '../permissions/engine.js';
import {
  startCapture, stopCapture, getCapturedRequests, isCapturing,
} from '../browser/network.js';
import { executeAdapterCommand, listAdapters, loadBuiltinAdapters } from '../adapters/index.js';
import { findBySemantics } from '../dom/semantics.js';
import { audit, info } from '../utils/logger.js';
import { detectModel, getCurrentProfile, getDetectionSource } from '../model-sense/index.js';
import { getLegendIfNeeded } from '../snapshot/session-legend.js';
import { progressiveSnapshot, type ProgressiveLayer } from '../snapshot/progressive.js';

// Session tracking
const startTime = Date.now();

function uptimeStr(): string {
  const ms = Date.now() - startTime;
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `${h}h ${m}m`;
}

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'wu-browser',
    version: '1.6.0',
  });

  // ─── 輔助：取得當前 URL ──────────────────────────────────────

  async function getCurrentUrl(): Promise<string> {
    try {
      const { text } = await getText();
      return text;
    } catch {
      return '';
    }
  }

  // ─── 導航工具 ────────────────────────────────────────────────

  server.registerTool('wu_navigate', {
    description: 'Navigate to a URL in the current Chrome tab',
    inputSchema: { url: z.string().describe('URL to navigate to') },
  }, async ({ url }) => {
    const result = await navigate(url);
    return {
      content: [{ type: 'text', text: result.success ? `Navigated to ${result.newUrl}` : result.message }],
    };
  });

  server.registerTool('wu_go_back', {
    description: 'Go back in browser history',
    inputSchema: {},
  }, async () => {
    const result = await goBack();
    return { content: [{ type: 'text', text: result.message }] };
  });

  server.registerTool('wu_go_forward', {
    description: 'Go forward in browser history',
    inputSchema: {},
  }, async () => {
    const result = await goForward();
    return { content: [{ type: 'text', text: result.message }] };
  });

  // ─── 讀取工具 ────────────────────────────────────────────────

  server.registerTool('wu_snapshot', {
    description: 'Read the current page as a structured accessibility tree. Use mode="interactive" to see clickable elements (default, <800 tokens), mode="content" for text content, mode="full" for complete tree.',
    inputSchema: {
      mode: z.enum(['interactive', 'content', 'full']).default('interactive').describe('Snapshot mode'),
      maxTokens: z.number().default(1500).describe('Maximum tokens in output'),
      selector: z.string().optional().describe('CSS selector to limit scope'),
      outputFormat: z.enum(['text', 'json']).default('text').describe('Output format: "text" (default) or "json"'),
      snapshotFormat: z.enum(['rich', 'ucf']).default('rich').describe('Snapshot format: "rich" (detailed) or "ucf" (ultra-compact, ~5 tokens/element)'),
      progressive: z.number().min(1).max(3).optional().describe('Progressive layer (1=core, 2=more, 3=all). Returns most important elements first.'),
      contentBoundaries: z.boolean().default(false).describe('Wrap output in content boundary markers for prompt injection safety'),
    },
  }, async ({ mode, maxTokens, selector, outputFormat, snapshotFormat, progressive, contentBoundaries }) => {
    // Use profile default if not explicitly set
    const profile = getCurrentProfile();
    const format = snapshotFormat === 'rich' ? (profile.defaultFormat as any) : snapshotFormat;
    const result = await snapshot({ mode, maxTokens, selector, format });
    sessionStats.actions++;
    const cost = getTokenCost(result.tokenCount);

    let text: string;
    if (progressive && result.rawElements) {
      // Progressive mode: use layered output
      const layer = progressive as ProgressiveLayer;
      const prog = progressiveSnapshot(result.rawElements, result.url, result.title, layer);
      const legend = (format === 'ucf') ? getLegendIfNeeded() : null;
      const legendPrefix = legend ? legend + '\n' : '';
      text = `${legendPrefix}${prog.text}\n[_tokenCost: this=${prog.tokenCount} session=${cost.sessionTotal} avg=${cost.avgTokensPerSnapshot}/snap]`;
    } else if (outputFormat === 'json') {
      const jsonResult = snapshotToJson(result, mode);
      text = JSON.stringify({ ...jsonResult, _tokenCost: cost }, null, 2);
    } else {
      // Prepend UCF legend on first UCF snapshot in session
      const legend = (format === 'ucf') ? getLegendIfNeeded() : null;
      const legendPrefix = legend ? legend + '\n' : '';
      text = `${legendPrefix}${result.tree}\n[_tokenCost: this=${cost.thisAction} session=${cost.sessionTotal} avg=${cost.avgTokensPerSnapshot}/snap]`;
    }

    if (contentBoundaries) {
      const nonce = Math.random().toString(36).substring(2, 18);
      text = `--- WU_BROWSER_PAGE_CONTENT nonce=${nonce} origin=${result.url} ---\n${text}\n--- END WU_BROWSER_PAGE_CONTENT nonce=${nonce} ---`;
    }

    return { content: [{ type: 'text', text }] };
  });

  server.registerTool('wu_get_text', {
    description: 'Get plain text content of the page or a specific element. More token-efficient than snapshot for reading text.',
    inputSchema: {
      selector: z.string().optional().describe('CSS selector (optional, defaults to full page)'),
    },
  }, async ({ selector }) => {
    const result = await getText(selector);
    sessionStats.actions++;
    return {
      content: [{ type: 'text', text: `[${result.title}] (${result.url})\n\n${result.text}` }],
    };
  });

  // ─── 操作工具 ────────────────────────────────────────────────

  server.registerTool('wu_click', {
    description: 'Click an element by its ref (from wu_snapshot). Always take a snapshot first to get current refs.',
    inputSchema: {
      ref: z.string().describe('Element ref from snapshot, e.g. "@e1"'),
    },
  }, async ({ ref }) => {
    const result = await click(ref);

    let msg = result.context ?? (result.success ? `Clicked ${ref}` : result.message);
    if (result.newTabId) msg += `\n  [New tab: ${result.newTabId}]`;
    if (result.success && !result.context) msg += '\n\nTake a new snapshot to see the updated page.';

    const tokens = estimateTokens(result.context ?? '');
    const cost = getTokenCost(tokens);
    msg += `\n[_tokenCost: this=${cost.thisAction} session=${cost.sessionTotal}]`;

    return { content: [{ type: 'text', text: msg }] };
  });

  server.registerTool('wu_type', {
    description: 'Type text into an input field by its ref. Use wu_snapshot first to get the ref.',
    inputSchema: {
      ref: z.string().describe('Element ref from snapshot, e.g. "@e3"'),
      text: z.string().describe('Text to type'),
      clear: z.boolean().default(true).describe('Clear existing text first'),
    },
  }, async ({ ref, text, clear }) => {
    const result = await typeText(ref, text, { clear });
    const tokens = estimateTokens(result.context ?? '');
    const cost = getTokenCost(tokens);
    return { content: [{ type: 'text', text: `${result.context ?? result.message}\n[_tokenCost: this=${cost.thisAction} session=${cost.sessionTotal}]` }] };
  });

  server.registerTool('wu_scroll', {
    description: 'Scroll the page in a direction',
    inputSchema: {
      direction: z.enum(['up', 'down', 'left', 'right']).describe('Scroll direction'),
      amount: z.number().default(500).describe('Scroll amount in pixels'),
    },
  }, async ({ direction, amount }) => {
    const result = await scroll(direction, amount);
    return { content: [{ type: 'text', text: result.message }] };
  });

  server.registerTool('wu_select', {
    description: 'Select an option in a dropdown by its ref',
    inputSchema: {
      ref: z.string().describe('Element ref from snapshot'),
      value: z.string().describe('Option value to select'),
    },
  }, async ({ ref, value }) => {
    const result = await selectOption(ref, value);
    return { content: [{ type: 'text', text: result.message }] };
  });

  server.registerTool('wu_hover', {
    description: 'Hover over an element to trigger tooltips or dropdowns',
    inputSchema: {
      ref: z.string().describe('Element ref from snapshot'),
    },
  }, async ({ ref }) => {
    const result = await hover(ref);
    return { content: [{ type: 'text', text: result.message }] };
  });

  // ─── Tab 管理 ────────────────────────────────────────────────

  server.registerTool('wu_list_tabs', {
    description: 'List all open Chrome tabs',
    inputSchema: {},
  }, async () => {
    const tabs = await listTabs();
    const text = tabs.map((t, i) => `[${i}] ${t.title} — ${t.url}`).join('\n');
    return { content: [{ type: 'text', text: text || 'No tabs open' }] };
  });

  server.registerTool('wu_switch_tab', {
    description: 'Switch to a different Chrome tab by index (from wu_list_tabs)',
    inputSchema: {
      index: z.number().describe('Tab index from wu_list_tabs'),
    },
  }, async ({ index }) => {
    const tabs = await listTabs();
    if (index < 0 || index >= tabs.length) {
      return { content: [{ type: 'text', text: `Tab index ${index} out of range (0-${tabs.length - 1})` }] };
    }
    await activateTab(tabs[index].id);
    sessionStats.actions++;
    return { content: [{ type: 'text', text: `Switched to tab ${index}: ${tabs[index].title}` }] };
  });

  server.registerTool('wu_close_tab', {
    description: 'Close a Chrome tab by index (defaults to current/last tab)',
    inputSchema: {
      index: z.number().optional().describe('Tab index to close (optional)'),
    },
  }, async ({ index }) => {
    const tabs = await listTabs();
    const idx = index ?? tabs.length - 1;
    if (idx < 0 || idx >= tabs.length) {
      return { content: [{ type: 'text', text: 'Invalid tab index' }] };
    }
    await closeTab(tabs[idx].id);
    sessionStats.actions++;
    return { content: [{ type: 'text', text: `Closed tab: ${tabs[idx].title}` }] };
  });

  server.registerTool('wu_new_tab', {
    description: 'Open a new Chrome tab, optionally navigating to a URL',
    inputSchema: {
      url: z.string().optional().describe('URL to open (optional)'),
    },
  }, async ({ url }) => {
    const tab = await newTab(url);
    sessionStats.actions++;
    return { content: [{ type: 'text', text: `Opened new tab: ${tab.id} — ${tab.url}` }] };
  });

  // ─── 工具 ────────────────────────────────────────────────────

  server.registerTool('wu_screenshot', {
    description: 'Take a screenshot (fallback — prefer wu_snapshot to save tokens). Use annotate=true to overlay ref labels for vision models.',
    inputSchema: {
      fullPage: z.boolean().default(false).describe('Capture full page'),
      annotate: z.boolean().default(false).describe('Overlay ref labels on interactive elements'),
    },
  }, async ({ fullPage, annotate }) => {
    if (annotate) {
      await snapshot({ mode: 'interactive', maxTokens: 3000 });
    }
    const base64 = await takeScreenshot({ fullPage, annotate });
    sessionStats.actions++;
    return {
      content: [{
        type: 'image',
        data: base64,
        mimeType: 'image/png',
      }],
    };
  });

  server.registerTool('wu_wait', {
    description: 'Wait for an element to appear on the page',
    inputSchema: {
      selector: z.string().describe('CSS selector to wait for'),
      timeout: z.number().default(5000).describe('Timeout in ms'),
    },
  }, async ({ selector, timeout }) => {
    const result = await waitFor(selector, timeout);
    return { content: [{ type: 'text', text: result.message }] };
  });

  server.registerTool('wu_execute_js', {
    description: 'Execute JavaScript in the current page context (advanced)',
    inputSchema: {
      code: z.string().describe('JavaScript code to execute'),
    },
  }, async ({ code }) => {
    const result = await executeJs(code);
    sessionStats.actions++;
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  });

  // ─── Network 工具 ──────────────────────────────────────────────

  server.registerTool('wu_network', {
    description: 'Control network request capture. Use action="start" to begin, "requests" to list captured requests, "stop" to end.',
    inputSchema: {
      action: z.enum(['start', 'requests', 'stop']).describe('Network capture action'),
    },
  }, async ({ action }) => {
    if (action === 'start') {
      await startCapture();
      return { content: [{ type: 'text', text: 'Network capture started. Navigate to pages, then use action="requests" to see captured traffic.' }] };
    } else if (action === 'stop') {
      await stopCapture();
      return { content: [{ type: 'text', text: 'Network capture stopped.' }] };
    } else {
      const requests = getCapturedRequests();
      return { content: [{ type: 'text', text: JSON.stringify(requests, null, 2) }] };
    }
  });

  // ─── Semantic Find 工具 ──────────────────────────────────────────

  server.registerTool('wu_find', {
    description: 'Find elements by semantic meaning (role + name), not CSS selectors. Resilient to website updates. Take a snapshot first.',
    inputSchema: {
      role: z.string().optional().describe('Element role: button, link, textbox, combobox, etc.'),
      name: z.string().optional().describe('Element name/label to search for'),
      contains: z.string().optional().describe('Text the element name must contain'),
      type: z.string().optional().describe('Input type (text, email, password, etc.)'),
      near: z.string().optional().describe('Find elements near this element (by name)'),
    },
  }, async ({ role, name, contains, type, near }) => {
    const result = await snapshot({ mode: 'interactive', maxTokens: 3000 });
    if (!result.rawElements || result.rawElements.length === 0) {
      return { content: [{ type: 'text', text: 'No elements found. Is a page loaded?' }] };
    }
    const matches = findBySemantics(result.rawElements, { role, name, contains, type, near });
    if (matches.length === 0) {
      return { content: [{ type: 'text', text: `No elements match query: role=${role ?? '*'} name=${name ?? '*'}` }] };
    }
    const lines = matches.slice(0, 10).map(m =>
      `${m.ref} ${m.role} "${m.name}"${m.href ? ` href="${m.href}"` : ''}${m.type ? ` type=${m.type}` : ''} (score:${m.score})`
    );
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  });

  // ─── Site Adapter 工具 ──────────────────────────────────────────

  server.registerTool('wu_site_command', {
    description: 'Run a site adapter command. Use adapter="google", command="search", args=["query"]. Run with adapter="list" to see available adapters.',
    inputSchema: {
      adapter: z.string().describe('Adapter name (e.g. "google", "github", "form") or "list" to list adapters'),
      command: z.string().optional().describe('Command name (e.g. "search", "repo", "detect")'),
      args: z.array(z.string()).default([]).describe('Command arguments'),
    },
  }, async ({ adapter: adapterName, command: commandName, args: cmdArgs }) => {
    if (adapterName === 'list') {
      const adapters = listAdapters();
      if (adapters.length === 0) {
        return { content: [{ type: 'text', text: 'No adapters installed.' }] };
      }
      const text = adapters.map(a =>
        `${a.name} (${a.domains.join(', ')})\n` +
        a.commands.map(c => `  ${a.name}/${c.name} — ${c.description}`).join('\n')
      ).join('\n\n');
      return { content: [{ type: 'text', text }] };
    }

    if (!commandName) {
      return { content: [{ type: 'text', text: `Missing command. Usage: adapter="${adapterName}", command="<command>"` }] };
    }

    const result = await executeAdapterCommand(`${adapterName}/${commandName}`, cmdArgs);
    sessionStats.actions++;
    if (result.success) {
      return { content: [{ type: 'text', text: JSON.stringify(result.result, null, 2) }] };
    }
    return { content: [{ type: 'text', text: `Error: ${result.error}` }] };
  });

  server.registerTool('wu_status', {
    description: 'Check Wu Browser status: Chrome connection, current tab, usage stats',
    inputSchema: {},
  }, async () => {
    const connected = isConnected();
    const tabs = connected ? await listTabs().catch(() => []) : [];
    const current = tabs[0];

    const avgTokens = sessionStats.snapshots > 0
      ? Math.round(sessionStats.totalTokens / sessionStats.snapshots)
      : 0;

    const status = {
      chrome: connected ? 'connected' : 'disconnected',
      port: parseInt(process.env.WU_BROWSER_CHROME_PORT ?? '9222'),
      currentTab: current ? { url: current.url, title: current.title } : null,
      tabCount: tabs.length,
      uptime: uptimeStr(),
      sessionStats: {
        actionsThisSession: sessionStats.actions,
        snapshotsThisSession: sessionStats.snapshots,
        totalTokensThisSession: sessionStats.totalTokens,
        avgTokensPerSnapshot: avgTokens,
        cookieBannersAutoClosed: sessionStats.cookieBannersClosed,
        permissionPrompts: sessionStats.permissionPrompts,
      },
      lastSnapshot: sessionStats.lastSnapshot,
    };

    audit('STATUS', JSON.stringify(status));
    return { content: [{ type: 'text', text: JSON.stringify(status, null, 2) }] };
  });

  return server;
}

export async function startMcpServer(): Promise<void> {
  const port = parseInt(process.env.WU_BROWSER_CHROME_PORT ?? '9222');

  // Load built-in adapters
  await loadBuiltinAdapters();

  // 嘗試連接 Chrome（允許失敗，後續工具呼叫會重試）
  try {
    await connect({ port });
    info(`MCP server ready. Chrome connected on port ${port}`);
  } catch {
    info(`MCP server ready. Chrome not connected — will connect on first tool call`);
  }

  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
