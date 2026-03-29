import { exec, execSync, type ChildProcess } from 'child_process';
import { promisify } from 'util';
import { info, warn, error as logError } from '../utils/logger.js';

const execAsync = promisify(exec);

// --- Process Tracking (Cleanup-as-Contract) ---

const trackedProcesses = new Map<number, ChildProcess>();

function cleanupAll() {
  for (const [pid, proc] of trackedProcesses) {
    if (!proc.killed) {
      try { process.kill(pid, 'SIGTERM'); } catch {}
    }
  }
  trackedProcesses.clear();
}

let cleanupRegistered = false;
function registerGlobalCleanup() {
  if (cleanupRegistered) return;
  cleanupRegistered = true;

  process.on('exit', cleanupAll);
  process.on('SIGINT', () => { cleanupAll(); process.exit(130); });
  process.on('SIGTERM', () => { cleanupAll(); process.exit(143); });
}

// --- Resource Budget ---

const MIN_MEMORY_MB = 2000;
const WARN_MEMORY_MB = 4000;

export async function getAvailableMemoryMB(): Promise<number> {
  try {
    if (process.platform === 'darwin') {
      const vmstat = execSync('vm_stat', { encoding: 'utf-8' });
      const pageSize = parseInt(execSync('pagesize', { encoding: 'utf-8' }).trim(), 10);
      const free = parseInt(vmstat.match(/Pages free:\s+(\d+)/)?.[1] ?? '0', 10);
      const inactive = parseInt(vmstat.match(/Pages inactive:\s+(\d+)/)?.[1] ?? '0', 10);
      return Math.floor((free + inactive) * pageSize / 1024 / 1024);
    }
    if (process.platform === 'linux') {
      const meminfo = execSync('cat /proc/meminfo', { encoding: 'utf-8' });
      const available = parseInt(meminfo.match(/MemAvailable:\s+(\d+)/)?.[1] ?? '0', 10);
      return Math.floor(available / 1024);
    }
  } catch {}
  return 99999; // Cannot determine → assume sufficient
}

// --- Chrome Discovery ---

const CHROME_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
];

export async function findChrome(): Promise<string | null> {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;

  for (const p of CHROME_PATHS) {
    try {
      await execAsync(`test -f "${p}"`);
      return p;
    } catch {}
  }

  try {
    const { stdout } = await execAsync('which google-chrome chromium-browser chromium 2>/dev/null | head -1');
    const path = stdout.trim();
    if (path) return path;
  } catch {}

  warn('Chrome not found in standard locations');
  return null;
}

// --- Connect-First: Detect → Connect → Launch ---

/**
 * Connect-First entry point.
 * 1. Detect existing Chrome on port → connect
 * 2. Check resource budget
 * 3. Launch new Chrome only if needed and safe
 */
export async function connectOrLaunch(port = 9222): Promise<void> {
  // Step 1: Detect existing Chrome
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`http://localhost:${port}/json/version`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (res.ok) {
      info(`Chrome already running on port ${port} (Connect-First: reusing)`);
      return;
    }
  } catch {
    // No Chrome running, proceed to launch
  }

  // Step 2: Resource Budget check
  const availMB = await getAvailableMemoryMB();
  if (availMB < MIN_MEMORY_MB) {
    throw new Error(
      `RESOURCE_BUDGET_EXCEEDED: Available memory ${availMB}MB < ${MIN_MEMORY_MB}MB minimum. ` +
      `Cannot safely launch Chrome. Close other applications first.`
    );
  }
  if (availMB < WARN_MEMORY_MB) {
    warn(`Low memory: ${availMB}MB available. Chrome will launch but monitor closely.`);
  }

  // Step 3: Launch new Chrome (no --user-data-dir, use default profile)
  await launchChrome(port);
}

/**
 * Launch Chrome with remote debugging.
 * Prefer connectOrLaunch() instead — this is the internal launch path.
 */
export async function launchChrome(port = 9222): Promise<void> {
  // Final safety: check again in case called directly
  try {
    const res = await fetch(`http://localhost:${port}/json/version`);
    if (res.ok) {
      info(`Chrome already running on port ${port}`);
      return;
    }
  } catch {}

  const chromePath = await findChrome();
  if (!chromePath) {
    throw new Error('Chrome not found. Install Google Chrome or set CHROME_PATH env var.');
  }

  // Connect-First principle: no --user-data-dir by default.
  // Only use custom profile if explicitly set via env var.
  const args = [
    `--remote-debugging-port=${port}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=Translate',
    '--window-size=1920,1080',
  ];

  if (process.env.WU_BROWSER_PROFILE) {
    args.push(`--user-data-dir=${process.env.WU_BROWSER_PROFILE}`);
  }

  info(`Launching Chrome: ${chromePath} (port ${port})`);
  const child = exec(`"${chromePath}" ${args.join(' ')}`);
  child.unref();

  if (child.pid) {
    trackedProcesses.set(child.pid, child);
    child.on('exit', () => {
      if (child.pid) trackedProcesses.delete(child.pid);
    });
  }
  registerGlobalCleanup();

  // Wait for Chrome to start
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

/** Get count of tracked processes (for testing/teardown) */
export function getTrackedProcessCount(): number {
  return trackedProcesses.size;
}

/** Clean up all tracked processes */
export async function cleanupTrackedProcesses(): Promise<void> {
  cleanupAll();
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
