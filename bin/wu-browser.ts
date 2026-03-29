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
import { detectModel, listProfiles, getCurrentProfile } from '../src/model-sense/index.js';

// Load adapters at startup
await loadBuiltinAdapters();

const SNAPSHOT_CACHE_PATH = '/tmp/wu-browser-snapshot-cache.json';

const program = new Command();

program
  .name('wu-browser')
  .description('Browser automation via CDP — MCP server + CLI')
  .version('1.4.0');

// ─── 全域選項 ────────────────────────────────────────────────────

program
  .option('--mcp', 'Start MCP stdio server (default)')
  .option('--http', 'Start HTTP API server')
  .option('--port <port>', 'HTTP server port', '9867')
  .option('--chrome-port <port>', 'Chrome remote debugging port', '9222')
  .option('--model <name>', 'LLM model profile (e.g. claude-opus-4.6, gpt-4o, local-8k)')
  .hook('preAction', () => {
    // Detect model before any command runs
    const opts = program.opts();
    detectModel({ flag: opts.model });
  });

// ─── snap ──────────────────────────────────────────────────────

program
  .command('snap')
  .description('Snapshot the current page')
  .option('-i, --interactive', 'Interactive mode (default)')
  .option('-c, --content', 'Content mode')
  .option('-f, --full', 'Full mode')
  .option('--max-tokens <n>', 'Max tokens', '1500')
  .option('--max-output <n>', 'Alias for --max-tokens (small model friendly)')
  .option('--selector <sel>', 'Limit to CSS selector')
  .option('--json', 'Output as JSON')
  .option('--jq <expr>', 'Filter JSON output with jq expression')
  .option('--content-boundaries', 'Wrap output in content boundary markers')
  .option('--format <fmt>', 'Output format: rich (default), ucf (ultra-compact)', 'rich')
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
    const tokenBudget = parseInt(opts.maxOutput ?? opts.maxTokens);
    // Determine format: CLI flag > profile default > 'rich'
    const profile = getCurrentProfile();
    const format = (opts.format !== 'rich' ? opts.format : profile.defaultFormat) as 'rich' | 'ucf';
    const result = await snapshot({
      mode,
      maxTokens: tokenBudget,
      selector: opts.selector,
      format,
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

// ─── screenshot ───────────────────────────────────────────────

program
  .command('screenshot [path]')
  .description('Take a screenshot, optionally with ref annotations')
  .option('--annotate', 'Overlay ref labels on interactive elements')
  .option('--full', 'Capture full page')
  .action(async (path: string | undefined, opts) => {
    await ensureConnected();

    // Need a snapshot first to populate __wuRefs
    if (opts.annotate) {
      await snapshot({ mode: 'interactive', maxTokens: 3000 });
    }

    const { takeScreenshot } = await import('../src/dom/actions.js');
    const base64 = await takeScreenshot({ fullPage: opts.full, annotate: opts.annotate });

    const outPath = path ?? `wu-screenshot-${Date.now()}.png`;
    writeFileSync(outPath, Buffer.from(base64, 'base64'));
    console.log(`Screenshot saved: ${outPath}${opts.annotate ? ' (annotated)' : ''}`);
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

// ─── batch ────────────────────────────────────────────────────

program
  .command('batch')
  .description('Execute multiple commands from stdin JSON array. E.g. [["snap","-i"],["click","@e1"]]')
  .option('--json', 'Output results as JSON array')
  .option('--bail', 'Stop on first failure')
  .action(async (opts) => {
    await ensureConnected();

    // Load snapshot cache
    try {
      const cacheData = readFileSync(SNAPSHOT_CACHE_PATH, 'utf-8');
      loadSnapshotCache(JSON.parse(cacheData));
    } catch {}

    // Read stdin
    let input = '';
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer);
    }
    input = Buffer.concat(chunks).toString('utf-8').trim();

    let commands: string[][];
    try {
      commands = JSON.parse(input);
      if (!Array.isArray(commands)) throw new Error('not array');
    } catch {
      console.error('Invalid JSON array on stdin. Expected: [["snap","-i"],["click","@e1"]]');
      process.exit(1);
    }

    const results: Array<{ command: string[]; success: boolean; output: string }> = [];

    for (const cmd of commands) {
      const [action, ...args] = cmd;
      let output = '';
      let success = true;

      try {
        switch (action) {
          case 'snap': {
            const mode = args.includes('-c') ? 'content' : args.includes('-f') ? 'full' : 'interactive';
            const maxIdx = args.indexOf('--max-tokens');
            const maxTokens = maxIdx >= 0 ? parseInt(args[maxIdx + 1]) : 1500;
            const result = await snapshot({ mode, maxTokens });
            output = opts.json ? JSON.stringify(snapshotToJson(result, mode)) : result.tree;
            break;
          }
          case 'click': {
            const result = await click(args[0]);
            output = result.context ?? result.message;
            success = result.success;
            break;
          }
          case 'type': {
            const result = await typeText(args[0], args[1]);
            output = result.context ?? result.message;
            success = result.success;
            break;
          }
          case 'nav': {
            const result = await navigate(args[0]);
            output = result.message;
            success = result.success;
            break;
          }
          default:
            output = `Unknown command: ${action}`;
            success = false;
        }
      } catch (err) {
        output = `Error: ${err}`;
        success = false;
      }

      results.push({ command: cmd, success, output });

      if (!success && opts.bail) {
        results.push({ command: ['(remaining commands skipped)'], success: false, output: 'bail' });
        break;
      }
    }

    // Save cache
    try {
      writeFileSync(SNAPSHOT_CACHE_PATH, JSON.stringify(saveSnapshotCache()), 'utf-8');
    } catch {}

    if (opts.json) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      for (const r of results) {
        console.log(`[${r.success ? '✅' : '❌'}] ${r.command.join(' ')}`);
        if (r.output && r.output !== 'bail') {
          const preview = r.output.split('\n').slice(0, 3).join('\n');
          console.log(preview);
        }
        console.log('');
      }
    }

    process.exit(results.every(r => r.success) ? 0 : 1);
  });

// ─── security ────────────────────────────────────────────────

const securityCmd = program
  .command('security')
  .description('Security settings management');

securityCmd
  .command('show')
  .description('Show current security settings')
  .action(async () => {
    const { loadSecurityConfig } = await import('../src/permissions/security-config.js');
    const config = loadSecurityConfig();
    console.log(`Permission level: ${config.permissionLevel}`);
    console.log(`Content boundaries: ${config.contentBoundaries}`);
    console.log(`Auto-close cookies: ${config.autoCloseCookies}`);
    console.log(`Prompt injection detection: ${config.promptInjectionDetection}`);
    const rules = Object.entries(config.domainRules);
    if (rules.length > 0) {
      console.log('\nDomain rules:');
      for (const [domain, level] of rules) {
        console.log(`  ${domain} → ${level}`);
      }
    } else {
      console.log('\nNo custom domain rules.');
    }
    process.exit(0);
  });

securityCmd
  .command('set <key> <value>')
  .description('Set a security config value (permissionLevel, contentBoundaries, etc.)')
  .action(async (key: string, value: string) => {
    const { setConfigValue } = await import('../src/permissions/security-config.js');
    const parsed = value === 'true' ? true : value === 'false' ? false : value;
    setConfigValue(key as any, parsed);
    console.log(`Set ${key} = ${parsed}`);
    process.exit(0);
  });

securityCmd
  .command('allow <domain>')
  .description('Set domain to GREEN (always allow)')
  .action(async (domain: string) => {
    const { setDomainRule } = await import('../src/permissions/security-config.js');
    setDomainRule(domain, 'GREEN');
    console.log(`${domain} → GREEN (always allow)`);
    process.exit(0);
  });

securityCmd
  .command('block <domain>')
  .description('Set domain to BLACK (always block)')
  .action(async (domain: string) => {
    const { setDomainRule } = await import('../src/permissions/security-config.js');
    setDomainRule(domain, 'BLACK');
    console.log(`${domain} → BLACK (always block)`);
    process.exit(0);
  });

// ─── session ─────────────────────────────────────────────────

const sessionCmd = program
  .command('session')
  .description('Encrypted session management (cookies + localStorage)');

sessionCmd
  .command('save <name>')
  .description('Save current browser session')
  .action(async (name: string) => {
    await ensureConnected();
    const { saveSession } = await import('../src/session/manager.js');
    const result = await saveSession(name);
    console.log(`Session "${name}" saved (${result.cookieCount} cookies, ${result.encrypted ? 'encrypted' : 'plaintext'})`);
    process.exit(0);
  });

sessionCmd
  .command('restore <name>')
  .description('Restore a saved session')
  .action(async (name: string) => {
    await ensureConnected();
    const { restoreSession } = await import('../src/session/manager.js');
    const result = await restoreSession(name);
    console.log(`Session "${name}" restored (${result.cookieCount} cookies, ${result.url})`);
    process.exit(0);
  });

sessionCmd
  .command('list')
  .description('List all saved sessions')
  .action(async () => {
    const { listSessions } = await import('../src/session/manager.js');
    const sessions = listSessions();
    if (sessions.length === 0) {
      console.log('No saved sessions. Use: wu-browser session save <name>');
    } else {
      for (const s of sessions) {
        console.log(`  ${s.name} — ${s.timestamp} ${s.encrypted ? '🔒' : '📝'}`);
      }
    }
    process.exit(0);
  });

sessionCmd
  .command('delete <name>')
  .description('Delete a saved session')
  .action(async (name: string) => {
    const { deleteSession } = await import('../src/session/manager.js');
    if (deleteSession(name)) {
      console.log(`Session "${name}" deleted.`);
    } else {
      console.error(`Session "${name}" not found.`);
      process.exit(1);
    }
    process.exit(0);
  });

// ─── model ───────────────────────────────────────────────────

program
  .command('model')
  .description('Show current ModelSense profile or list available profiles')
  .option('--list', 'List all available profiles')
  .action(async (opts) => {
    if (opts.list) {
      console.log('Available ModelSense profiles:\n');
      const { BUILTIN_PROFILES } = await import('../src/model-sense/profiles.js');
      for (const name of listProfiles()) {
        const p = BUILTIN_PROFILES[name];
        console.log(`  ${name}`);
        console.log(`    context: ${(p.contextWindow / 1000).toFixed(0)}K · maxTokens: ${p.optimalMaxTokens} · pruning: ${p.pruningStrategy}`);
        console.log(`    href: ${p.snapshotFormat.includeHref} · region: ${p.snapshotFormat.includeRegion} · ref: ${p.snapshotFormat.refFormat} · depth: ${p.snapshotFormat.depthLimit || '∞'}`);
        console.log('');
      }
    } else {
      const profile = getCurrentProfile();
      console.log(`Current profile: ${profile.name}`);
      console.log(`  Context window: ${(profile.contextWindow / 1000).toFixed(0)}K`);
      console.log(`  Optimal maxTokens: ${profile.optimalMaxTokens}`);
      console.log(`  Pruning: ${profile.pruningStrategy}`);
      console.log(`  Format: href=${profile.snapshotFormat.includeHref} region=${profile.snapshotFormat.includeRegion} ref=${profile.snapshotFormat.refFormat}`);
    }
    process.exit(0);
  });

// ─── calibrate ───────────────────────────────────────────────

program
  .command('calibrate')
  .description('Run ModelSense calibration against the current page')
  .action(async () => {
    await ensureConnected();

    const profile = getCurrentProfile();
    console.log(`Calibrating for ${profile.name}...\n`);

    // Get raw elements from current page
    const result = await snapshot({ mode: 'interactive', maxTokens: 10000 });
    const elements = result.rawElements ?? [];

    if (elements.length === 0) {
      console.log('No elements found. Navigate to a page first.');
      process.exit(1);
    }

    const { calibrate } = await import('../src/model-sense/calibrate.js');
    const { formatElement: fmtEl, pruneElements: pruneEls } = await import('../src/dom/pruner.js');
    const { estimateTokens: countTokens } = await import('../src/utils/token-counter.js');

    const calResult = calibrate(
      elements,
      profile.name,
      (els, p) => {
        const { elements: pruned } = pruneEls(els as any, p.optimalMaxTokens, p.snapshotFormat);
        const text = pruned.map(e => fmtEl(e, p.snapshotFormat)).join('\n');
        return { tokenCount: countTokens(text), elementCount: pruned.length };
      },
    );

    for (const r of calResult.results) {
      const bar = r.savingsPercent > 0 ? ` (${r.savingsPercent}% less)` : '';
      console.log(`  ${r.strategy}: ${r.tokenCount} tokens, ${r.elementCount} elements${bar}`);
    }
    console.log(`\n→ Recommended: ${calResult.recommended}`);
    console.log(`Saved to ~/.wu-browser/calibration.json`);
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
