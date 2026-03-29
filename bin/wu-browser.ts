#!/usr/bin/env node
/**
 * bin/wu-browser.ts — CLI 入口
 *
 * 使用方式：
 *   wu-browser              # 啟動 MCP server（預設）
 *   wu-browser --mcp        # 明確指定 MCP stdio server
 *   wu-browser --http       # 啟動 HTTP server
 *   wu-browser --port 9867  # 自訂 HTTP port
 *   wu-browser snap         # CLI 取 snapshot
 *   wu-browser snap -i      # interactive 模式
 *   wu-browser snap -c      # content 模式
 *   wu-browser nav <url>    # 導航
 *   wu-browser click <ref>  # 點擊
 *   wu-browser type <ref> "text" # 輸入
 *   wu-browser tabs         # 列出 tabs
 *   wu-browser status       # 狀態
 *   wu-browser chrome       # 啟動/連接 Chrome
 */

import { Command } from 'commander';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';
import { connect, isConnected } from '../src/browser/connection.js';
import { launchChrome } from '../src/browser/launcher.js';
import { snapshot, loadSnapshotCache, saveSnapshotCache, snapshotToJson, sessionStats, getTokenCost } from '../src/dom/snapshot.js';
import { click, typeText, navigate } from '../src/dom/actions.js';
import { listTabs } from '../src/browser/session.js';
import { startMcpServer } from '../src/mcp/server.js';
import { startHttpServer } from '../src/http/server.js';
import { loadBuiltinAdapters } from '../src/adapters/index.js';
import { findBySemantics } from '../src/dom/semantics.js';

// Load adapters at startup
await loadBuiltinAdapters();

const SNAPSHOT_CACHE_PATH = '/tmp/wu-browser-snapshot-cache.json';

const program = new Command();

program
  .name('wu-browser')
  .description('Browser automation via CDP — MCP server + CLI')
  .version('1.2.0');

// ─── 全域選項 ────────────────────────────────────────────────────

program
  .option('--mcp', 'Start MCP stdio server (default)')
  .option('--http', 'Start HTTP API server')
  .option('--port <port>', 'HTTP server port', '9867')
  .option('--chrome-port <port>', 'Chrome remote debugging port', '9222');

// ─── snap ──────────────────────────────────────────────────────

program
  .command('snap')
  .description('Snapshot the current page')
  .option('-i, --interactive', 'Interactive mode (default)')
  .option('-c, --content', 'Content mode')
  .option('-f, --full', 'Full mode')
  .option('--max-tokens <n>', 'Max tokens', '1500')
  .option('--selector <sel>', 'Limit to CSS selector')
  .option('--json', 'Output as JSON')
  .option('--jq <expr>', 'Filter JSON output with jq expression')
  .option('--content-boundaries', 'Wrap output in content boundary markers')
  .action(async (opts) => {
    await ensureConnected();

    // Load previous snapshot cache for incremental mode
    try {
      const cacheData = readFileSync(SNAPSHOT_CACHE_PATH, 'utf-8');
      loadSnapshotCache(JSON.parse(cacheData));
    } catch {
      // No cache yet, that's fine
    }

    const mode = opts.content ? 'content' : opts.full ? 'full' : 'interactive';
    const result = await snapshot({
      mode,
      maxTokens: parseInt(opts.maxTokens),
      selector: opts.selector,
    });

    // Save snapshot cache for next CLI invocation
    try {
      writeFileSync(SNAPSHOT_CACHE_PATH, JSON.stringify(saveSnapshotCache()), 'utf-8');
    } catch {
      // Non-critical
    }

    let output: string;
    if (opts.json) {
      const jsonResult = snapshotToJson(result, mode);
      output = JSON.stringify(jsonResult, null, 2);

      if (opts.jq) {
        try {
          output = execSync(`jq ${JSON.stringify(opts.jq)}`, {
            input: output,
            encoding: 'utf-8',
          }).trim();
        } catch {
          console.error('jq filter failed. Is jq installed? (brew install jq)');
          process.exit(1);
        }
      }
    } else {
      output = `${result.tree}\n\n[Tokens: ~${result.tokenCount}]`;
    }

    if (opts.contentBoundaries) {
      const nonce = randomBytes(8).toString('hex');
      const origin = result.url;
      console.log(`--- WU_BROWSER_PAGE_CONTENT nonce=${nonce} origin=${origin} ---`);
      console.log(output);
      console.log(`--- END WU_BROWSER_PAGE_CONTENT nonce=${nonce} ---`);
    } else {
      console.log(output);
    }
    const cost = getTokenCost(result.tokenCount);
    process.stderr.write(`[wu-browser] tokens: ${cost.thisAction} · session: ${cost.sessionTotal} · avg: ${cost.avgTokensPerSnapshot}/snap\n`);
    process.exit(0);
  });

// ─── nav ───────────────────────────────────────────────────────

program
  .command('nav <url>')
  .description('Navigate to URL')
  .action(async (url: string) => {
    await ensureConnected();
    const { navigate } = await import('../src/dom/actions.js');
    const result = await navigate(url);
    console.log(result.message);
    process.exit(0);
  });

// ─── click ─────────────────────────────────────────────────────

program
  .command('click <ref>')
  .description('Click an element by ref (e.g. @e1)')
  .action(async (ref: string) => {
    await ensureConnected();
    const result = await click(ref);
    console.log(result.message);
    process.exit(0);
  });

// ─── type ──────────────────────────────────────────────────────

program
  .command('type <ref> <text>')
  .description('Type text into an element by ref')
  .action(async (ref: string, text: string) => {
    await ensureConnected();
    const result = await typeText(ref, text);
    console.log(result.message);
    process.exit(0);
  });

// ─── tabs ──────────────────────────────────────────────────────

program
  .command('tabs')
  .description('List open Chrome tabs')
  .action(async () => {
    await ensureConnected();
    const tabs = await listTabs();
    tabs.forEach((t, i) => {
      console.log(`[${i}] ${t.title}`);
      console.log(`    ${t.url}`);
    });
    process.exit(0);
  });

// ─── status ────────────────────────────────────────────────────

program
  .command('status')
  .description('Show Wu Browser status')
  .action(async () => {
    const chromePort = parseInt(process.env.WU_BROWSER_CHROME_PORT ?? '9222');
    let connected = false;
    let tabs: Array<{ url: string; title: string }> = [];

    try {
      await connect({ port: chromePort });
      connected = true;
      tabs = await listTabs();
    } catch {}

    console.log(`Chrome: ${connected ? '✅ connected' : '❌ disconnected'} (port ${chromePort})`);
    if (tabs.length > 0) {
      console.log(`Current: ${tabs[0].title} — ${tabs[0].url}`);
      console.log(`Tabs: ${tabs.length}`);
    }
    process.exit(0);
  });

// ─── chrome ────────────────────────────────────────────────────

program
  .command('chrome')
  .description('Launch Chrome with remote debugging (or connect if already running)')
  .action(async () => {
    const port = parseInt(process.env.WU_BROWSER_CHROME_PORT ?? '9222');
    try {
      await launchChrome(port);
      console.log(`✅ Chrome ready on port ${port}`);
    } catch (err) {
      console.error(`❌ Failed: ${err}`);
      process.exit(1);
    }
    process.exit(0);
  });

// ─── find ─────────────────────────────────────────────────────

program
  .command('find')
  .description('Find elements by semantic meaning (role + name)')
  .option('--role <role>', 'Element role: button, link, textbox, etc.')
  .option('--name <name>', 'Element name/label')
  .option('--contains <text>', 'Element name contains this text')
  .option('--type <type>', 'Input type')
  .option('--near <name>', 'Find elements near this element')
  .action(async (opts) => {
    await ensureConnected();
    const result = await snapshot({ mode: 'interactive', maxTokens: 3000 });
    if (!result.rawElements || result.rawElements.length === 0) {
      console.log('No elements found. Is a page loaded?');
      process.exit(1);
    }
    const matches = findBySemantics(result.rawElements, {
      role: opts.role,
      name: opts.name,
      contains: opts.contains,
      type: opts.type,
      near: opts.near,
    });
    if (matches.length === 0) {
      console.log(`No elements match: role=${opts.role ?? '*'} name=${opts.name ?? '*'}`);
      process.exit(0);
    }
    for (const m of matches.slice(0, 10)) {
      const parts = [`${m.ref} ${m.role} "${m.name}"`];
      if (m.href) parts.push(`href="${m.href}"`);
      if (m.type) parts.push(`type=${m.type}`);
      parts.push(`(score:${m.score})`);
      console.log(parts.join(' '));
    }
    process.exit(0);
  });

// ─── network ──────────────────────────────────────────────────

const networkCmd = program
  .command('network')
  .description('Network request interception');

networkCmd
  .command('start')
  .description('Start capturing network requests')
  .action(async () => {
    await ensureConnected();
    const { startCapture } = await import('../src/browser/network.js');
    await startCapture();
    console.log('Network capture started. Navigate to a page, then run: wu-browser network requests --json');
    // Don't exit — keep process alive to capture
  });

networkCmd
  .command('requests')
  .description('List captured network requests')
  .option('--json', 'Output as JSON')
  .action(async () => {
    const { getCapturedRequests } = await import('../src/browser/network.js');
    const requests = getCapturedRequests();
    if (requests.length === 0) {
      console.log('No requests captured. Run "wu-browser network start" first, then navigate.');
      process.exit(0);
    }
    const opts = networkCmd.commands.find(c => c.name() === 'requests')!.opts();
    if (opts.json) {
      console.log(JSON.stringify(requests, null, 2));
    } else {
      for (const r of requests) {
        const status = r.status ? `${r.status}` : '...';
        console.log(`[${status}] ${r.method} ${r.url.substring(0, 100)}`);
      }
    }
    process.exit(0);
  });

networkCmd
  .command('stop')
  .description('Stop capturing network requests')
  .action(async () => {
    await ensureConnected();
    const { stopCapture } = await import('../src/browser/network.js');
    await stopCapture();
    console.log('Network capture stopped.');
    process.exit(0);
  });

// ─── site ─────────────────────────────────────────────────────

const siteCmd = program
  .command('site')
  .description('Platform adapter commands');

siteCmd
  .command('list')
  .description('List installed site adapters')
  .action(async () => {
    const { listAdapters } = await import('../src/adapters/index.js');
    const adapters = listAdapters();
    if (adapters.length === 0) {
      console.log('No adapters installed.');
      console.log('See CONTRIBUTING.md to create one, or copy src/adapters/sites/_template.ts');
    } else {
      for (const a of adapters) {
        console.log(`${a.name} (${a.domains.join(', ')})`);
        for (const c of a.commands) {
          console.log(`  ${a.name}/${c.name} — ${c.description}`);
        }
      }
    }
    process.exit(0);
  });

siteCmd
  .command('run <path> [args...]')
  .description('Run an adapter command (e.g. twitter/search "AI")')
  .action(async (path: string, args: string[]) => {
    await ensureConnected();
    const { executeAdapterCommand } = await import('../src/adapters/index.js');
    const result = await executeAdapterCommand(path, args);
    if (result.success) {
      console.log(JSON.stringify(result.result, null, 2));
    } else {
      console.error(result.error);
      process.exit(1);
    }
    process.exit(0);
  });

// ─── 預設行為（無子命令）────────────────────────────────────────

program.action(async () => {
  const opts = program.opts();

  // 設定 Chrome port 環境變數
  if (opts.chromePort) {
    process.env.WU_BROWSER_CHROME_PORT = opts.chromePort;
  }

  if (opts.http) {
    const port = parseInt(opts.port);
    await startHttpServer(port);
  } else {
    // 預設：MCP stdio server
    await startMcpServer();
  }
});

program.parse();

// ─── 工具函數 ────────────────────────────────────────────────────

async function ensureConnected(): Promise<void> {
  const port = parseInt(process.env.WU_BROWSER_CHROME_PORT ?? '9222');
  if (!isConnected()) {
    try {
      await connect({ port });
    } catch (err) {
      console.error(`❌ Cannot connect to Chrome on port ${port}`);
      console.error(`   Run: wu-browser chrome`);
      process.exit(1);
    }
  }
}
