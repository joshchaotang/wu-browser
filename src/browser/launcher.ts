import { exec, type ChildProcess } from 'child_process';
import { promisify } from 'util';
import { mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { info, warn } from '../utils/logger.js';

const execAsync = promisify(exec);

/** Track launched Chrome processes for cleanup */
const launchedProcesses: ChildProcess[] = [];

function registerCleanup() {
  const cleanup = () => {
    for (const proc of launchedProcesses) {
      if (proc.pid && !proc.killed) {
        try { process.kill(proc.pid); } catch {}
      }
    }
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(130); });
  process.on('SIGTERM', () => { cleanup(); process.exit(143); });
}

let cleanupRegistered = false;

const CHROME_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
];

export async function launchChrome(port = 9222): Promise<void> {
  // 先確認是否已在運行
  try {
    const res = await fetch(`http://localhost:${port}/json/version`);
    if (res.ok) {
      info(`Chrome already running on port ${port}`);
      return;
    }
  } catch {}

  // 找 Chrome binary
  const chromePath = await findChrome();
  if (!chromePath) {
    throw new Error('Chrome not found. Install Google Chrome or set CHROME_PATH env var.');
  }

  const profileDir = process.env.WU_BROWSER_PROFILE ?? join(homedir(), '.wu-browser', 'chrome-profile');
  mkdirSync(profileDir, { recursive: true });

  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=Translate',
    '--window-size=1920,1080',
  ].join(' ');

  info(`Launching Chrome: ${chromePath}`);
  const child = exec(`"${chromePath}" ${args}`);
  child.unref();
  launchedProcesses.push(child);
  if (!cleanupRegistered) {
    registerCleanup();
    cleanupRegistered = true;
  }

  // 等待 Chrome 啟動
  for (let i = 0; i < 15; i++) {
    await sleep(1000);
    try {
      const res = await fetch(`http://localhost:${port}/json/version`);
      if (res.ok) {
        info(`Chrome started on port ${port}`);
        return;
      }
    } catch {}
  }

  throw new Error('Chrome did not start within 15 seconds');
}

export async function findChrome(): Promise<string | null> {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;

  for (const p of CHROME_PATHS) {
    try {
      await execAsync(`test -f "${p}"`);
      return p;
    } catch {}
  }

  // Try which
  try {
    const { stdout } = await execAsync('which google-chrome chromium-browser chromium 2>/dev/null | head -1');
    const path = stdout.trim();
    if (path) return path;
  } catch {}

  warn('Chrome not found in standard locations');
  return null;
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
